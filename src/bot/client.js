const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes
} = require("discord.js");
const { buildCommands } = require("./commands");

function createDiscordBot({ config, logger, db, overseerr, jellyfin }) {
  const DEFAULT_BOT_CONFIG = {
    requestsChannelId: "",
    uploadsChannelId: "",
    updatesChannelId: "",
    requestRoleId: "",
    enforceRequestChannel: false,
    announceOnRequestCreated: true,
    announceOnAvailable: true,
    announceOnAnyStatus: false,
    dmOnStatusChange: true,
    mentionRequesterInChannel: true,
    useRichEmbeds: true
  };

  let online = false;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessages
    ]
  });

  function toEphemeralResponse(content) {
    return {
      content,
      flags: MessageFlags.Ephemeral
    };
  }

  function asBoolean(value, fallback) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
    return fallback;
  }

  function normalizeId(value) {
    const raw = String(value ?? "").trim();
    return /^\d+$/.test(raw) ? raw : "";
  }

  function getBotConfig() {
    const stored = db.getBotConfig();
    return {
      requestsChannelId: normalizeId(stored.requestsChannelId || DEFAULT_BOT_CONFIG.requestsChannelId),
      uploadsChannelId: normalizeId(stored.uploadsChannelId || DEFAULT_BOT_CONFIG.uploadsChannelId),
      updatesChannelId: normalizeId(stored.updatesChannelId || DEFAULT_BOT_CONFIG.updatesChannelId),
      requestRoleId: normalizeId(stored.requestRoleId || DEFAULT_BOT_CONFIG.requestRoleId),
      enforceRequestChannel: asBoolean(stored.enforceRequestChannel, DEFAULT_BOT_CONFIG.enforceRequestChannel),
      announceOnRequestCreated: asBoolean(stored.announceOnRequestCreated, DEFAULT_BOT_CONFIG.announceOnRequestCreated),
      announceOnAvailable: asBoolean(stored.announceOnAvailable, DEFAULT_BOT_CONFIG.announceOnAvailable),
      announceOnAnyStatus: asBoolean(stored.announceOnAnyStatus, DEFAULT_BOT_CONFIG.announceOnAnyStatus),
      dmOnStatusChange: asBoolean(stored.dmOnStatusChange, DEFAULT_BOT_CONFIG.dmOnStatusChange),
      mentionRequesterInChannel: asBoolean(stored.mentionRequesterInChannel, DEFAULT_BOT_CONFIG.mentionRequesterInChannel),
      useRichEmbeds: asBoolean(stored.useRichEmbeds, DEFAULT_BOT_CONFIG.useRichEmbeds)
    };
  }

  async function sendToChannel(channelId, payload) {
    if (!online || !channelId) {
      return;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return;
      }

      await channel.send(payload);
    } catch (error) {
      logger.warn(`Failed to send message to channel ${channelId}: ${error.message}`);
    }
  }

  function buildAnnouncementPayload({ title, description, color, fields, mention }) {
    const cfg = getBotConfig();
    if (!cfg.useRichEmbeds) {
      const flat = [title, description]
        .concat((fields || []).map((field) => `${field.name}: ${field.value}`))
        .filter(Boolean)
        .join("\n");
      return {
        content: mention ? `${mention} ${flat}` : flat
      };
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || "")
      .setColor(color || 0x6ae3b9)
      .setTimestamp(new Date());

    if (fields?.length) {
      embed.addFields(fields);
    }

    return {
      content: mention || undefined,
      embeds: [embed]
    };
  }

  async function announceRequestCreated({ title, mediaType, requestId, requesterDiscordId }) {
    const cfg = getBotConfig();
    if (!cfg.announceOnRequestCreated || !cfg.requestsChannelId) {
      return;
    }

    const mention = cfg.requestRoleId
      ? `<@&${cfg.requestRoleId}>`
      : cfg.mentionRequesterInChannel && requesterDiscordId
        ? `<@${requesterDiscordId}>`
        : "";

    const payload = buildAnnouncementPayload({
      title: "New Media Request",
      description: `${title} was requested and sent to Overseerr.`,
      color: 0x4cc9f0,
      mention,
      fields: [
        { name: "Type", value: mediaType || "unknown", inline: true },
        { name: "Request ID", value: String(requestId || "unknown"), inline: true }
      ]
    });

    await sendToChannel(cfg.requestsChannelId, payload);
  }

  async function announceRequestStatusChange({ title, requestId, statusText, status, requesterDiscordId }) {
    const cfg = getBotConfig();
    const isAvailable = Number(status) === 4;

    const mention = cfg.mentionRequesterInChannel && requesterDiscordId ? `<@${requesterDiscordId}>` : "";

    if (isAvailable && cfg.announceOnAvailable && cfg.uploadsChannelId) {
      const payload = buildAnnouncementPayload({
        title: "Media Is Now Available",
        description: `${title} is now available in your media server.`,
        color: 0x2ecc71,
        mention,
        fields: [
          { name: "Request ID", value: String(requestId || "unknown"), inline: true },
          { name: "Status", value: statusText || "Available", inline: true }
        ]
      });
      await sendToChannel(cfg.uploadsChannelId, payload);
    }

    if (cfg.announceOnAnyStatus && cfg.updatesChannelId) {
      const payload = buildAnnouncementPayload({
        title: "Request Status Updated",
        description: `${title} changed status.`,
        color: 0xf9c74f,
        mention,
        fields: [
          { name: "Request ID", value: String(requestId || "unknown"), inline: true },
          { name: "Status", value: statusText || "Unknown", inline: true }
        ]
      });
      await sendToChannel(cfg.updatesChannelId, payload);
    }
  }

  function describeCommandError(error) {
    const status = error?.response?.status;
    const data = error?.response?.data;

    if (!status) {
      return error.message;
    }

    if (typeof data === "string") {
      return `HTTP ${status}: ${data}`;
    }

    if (data && typeof data === "object") {
      const detail = data.message || data.error || JSON.stringify(data);
      return `HTTP ${status}: ${detail}`;
    }

    return `HTTP ${status}: ${error.message}`;
  }

  async function registerSlashCommands() {
    const commands = buildCommands().map((command) => command.toJSON());
    const rest = new REST({ version: "10" }).setToken(config.discord.token);

    await rest.put(
      Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId
      ),
      { body: commands }
    );

    logger.info(`Registered ${commands.length} slash commands.`);
  }

  function formatSearchResults(results) {
    if (results.length === 0) {
      return "No results found.";
    }

    const top = results.slice(0, 5);
    return top
      .map(
        (item) =>
          `• ${item.title} [${item.mediaType}] - TMDB ID: ${item.id}`
      )
      .join("\n");
  }

  async function resolveOverseerrUserId(discordUserId) {
    const linked = db.getUserLinkByDiscordId(discordUserId);
    if (linked) {
      return linked.overseerr_user_id;
    }

    return config.overseerr.defaultUserId;
  }

  async function handleLink(interaction) {
    const username = interaction.options.getString("overseerr_username", true);
    const user = await overseerr.findUserByUsername(username);

    if (!user) {
      await interaction.reply(toEphemeralResponse(`No Overseerr user found for: ${username}`));
      return;
    }

    db.upsertUserLink({
      discordUserId: interaction.user.id,
      overseerrUserId: user.id,
      overseerrUsername: user.username || user.displayName || username
    });

    await interaction.reply(
      toEphemeralResponse(
        `Linked to Overseerr user: ${user.displayName || user.username} (id ${user.id})`
      )
    );
  }

  async function handleSearch(interaction) {
    const query = interaction.options.getString("query", true);
    const mediaType = interaction.options.getString("media_type") || "all";
    const results = await overseerr.searchMedia(query, mediaType);

    await interaction.reply(toEphemeralResponse(formatSearchResults(results)));
  }

  async function handleRequest(interaction) {
    const botConfig = getBotConfig();
    if (
      botConfig.enforceRequestChannel &&
      botConfig.requestsChannelId &&
      interaction.channelId !== botConfig.requestsChannelId
    ) {
      await interaction.reply(
        toEphemeralResponse(`Requests are restricted to <#${botConfig.requestsChannelId}>.`)
      );
      return;
    }

    const mediaId = interaction.options.getInteger("media_id", true);
    const mediaType = interaction.options.getString("media_type", true);
    const userId = await resolveOverseerrUserId(interaction.user.id);

    const response = await overseerr.requestMedia({ mediaType, mediaId, userId });

    const requestId = response.id || response.request?.id;
    const status = response.status || response.request?.status || 1;
    const title =
      response.media?.title || response.media?.name || `TMDB ${mediaType} ${mediaId}`;

    if (requestId) {
      db.upsertRequestEvent({
        requestId,
        mediaType,
        mediaId,
        title,
        status,
        statusText: overseerr.getRequestStatusText(status),
        requestedBy: userId
      });
    }

    await interaction.reply(
      toEphemeralResponse(
        `Request submitted: ${title} (request id ${requestId || "unknown"}, status ${overseerr.getRequestStatusText(status)}).`
      )
    );

    await announceRequestCreated({
      title,
      mediaType,
      requestId,
      requesterDiscordId: interaction.user.id
    });
  }

  async function handleStatus(interaction) {
    const requestId = interaction.options.getInteger("request_id", true);
    const request = await overseerr.getRequestById(requestId);

    const title = request.media?.title || request.media?.name || "Unknown title";
    const statusText = overseerr.getRequestStatusText(request.status);

    db.upsertRequestEvent({
      requestId: request.id,
      mediaType: request.type || request.media?.mediaType || "unknown",
      mediaId: request.media?.tmdbId || 0,
      title,
      status: request.status,
      statusText,
      requestedBy: request.requestedBy?.id
    });

    await interaction.reply(toEphemeralResponse(`Request #${request.id}: ${title} is currently ${statusText}.`));
  }

  async function handleRecent(interaction) {
    const latest = await jellyfin.getLatestItems(8);
    if (latest.length === 0) {
      await interaction.reply(toEphemeralResponse("No recent Jellyfin items found."));
      return;
    }

    const lines = latest
      .map((item) => `• ${item.name} (${item.type}${item.productionYear ? `, ${item.productionYear}` : ""})`)
      .join("\n");

    await interaction.reply(toEphemeralResponse(`Latest from Jellyfin:\n${lines}`));
  }

  async function notifyDiscordUser(discordUserId, message) {
    if (!online) {
      return;
    }

    const cfg = getBotConfig();
    if (!cfg.dmOnStatusChange) {
      return;
    }

    try {
      const user = await client.users.fetch(discordUserId);
      await user.send(message);
    } catch (error) {
      logger.warn(`Failed to DM Discord user ${discordUserId}: ${error.message}`);
    }
  }

  client.once("clientReady", async () => {
    logger.info(`Discord bot logged in as ${client.user.tag}`);

    try {
      await registerSlashCommands();
    } catch (error) {
      logger.error(`Failed to register slash commands: ${error.message}`);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      switch (interaction.commandName) {
        case "link":
          await handleLink(interaction);
          break;
        case "search":
          await handleSearch(interaction);
          break;
        case "request":
          await handleRequest(interaction);
          break;
        case "status":
          await handleStatus(interaction);
          break;
        case "recent":
          await handleRecent(interaction);
          break;
        default:
          await interaction.reply(toEphemeralResponse("Unknown command."));
      }
    } catch (error) {
      const detail = describeCommandError(error);
      logger.error(`Command handling error: ${detail}`);
      const response = toEphemeralResponse(`Command failed: ${detail}`);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  });

  return {
    start: async () => {
      if (!config.discord.token || !config.discord.clientId || !config.discord.guildId) {
        logger.warn(
          "Discord bot is not configured yet. Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID in the web UI to enable it."
        );
        return;
      }

      await client.login(config.discord.token);
      online = true;
    },
    notifyDiscordUser,
    announceRequestStatusChange,
    getClient: () => client
  };
}

module.exports = { createDiscordBot };
