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
    useRichEmbeds: true,
    requestAnnouncementTemplate:
      "{{event}}\nTitle: {{subject}}\nType: {{media_type}}\nRequest ID: {{request_id}}\nRequested by: {{requestedBy_username}}",
    availableAnnouncementTemplate:
      "{{event}}\nTitle: {{subject}}\nStatus: {{media_status}}\nRequest ID: {{request_id}}",
    statusAnnouncementTemplate:
      "{{event}}\nTitle: {{subject}}\nStatus: {{media_status}}\nRequest ID: {{request_id}}"
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
      useRichEmbeds: asBoolean(stored.useRichEmbeds, DEFAULT_BOT_CONFIG.useRichEmbeds),
      requestAnnouncementTemplate:
        String(stored.requestAnnouncementTemplate || DEFAULT_BOT_CONFIG.requestAnnouncementTemplate),
      availableAnnouncementTemplate:
        String(stored.availableAnnouncementTemplate || DEFAULT_BOT_CONFIG.availableAnnouncementTemplate),
      statusAnnouncementTemplate:
        String(stored.statusAnnouncementTemplate || DEFAULT_BOT_CONFIG.statusAnnouncementTemplate)
    };
  }

  function renderTemplate(template, context) {
    const source = String(template || "");
    return source.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
      const value = context[key];
      return value === undefined || value === null ? "" : String(value);
    });
  }

  function buildTemplateContext({
    notificationType,
    event,
    subject,
    message,
    image,
    mediaType,
    mediaTmdbId,
    mediaStatus,
    requestId,
    requesterUsername,
    requesterDiscordId,
    seasons
  }) {
    return {
      notification_type: notificationType || "",
      event: event || "",
      subject: subject || "",
      message: message || "",
      image: image || "",
      media_type: mediaType || "",
      media_tmdbid: mediaTmdbId || "",
      media_status: mediaStatus || "",
      request_id: requestId || "",
      requestedBy_username: requesterUsername || "",
      requestedBy_settings_discordId: requesterDiscordId || "",
      extra: seasons || ""
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

  async function announceRequestCreated({
    title,
    mediaType,
    mediaId,
    requestId,
    requesterDiscordId,
    requesterUsername,
    seasons,
    image
  }) {
    const cfg = getBotConfig();
    if (!cfg.announceOnRequestCreated || !cfg.requestsChannelId) {
      return;
    }

    const mention = cfg.requestRoleId
      ? `<@&${cfg.requestRoleId}>`
      : cfg.mentionRequesterInChannel && requesterDiscordId
        ? `<@${requesterDiscordId}>`
        : "";

    const templateContext = buildTemplateContext({
      notificationType: "MEDIA_PENDING",
      event: "Request Pending Approval",
      subject: title,
      message: `${title} was requested and sent to Overseerr.`,
      image,
      mediaType,
      mediaTmdbId: mediaId,
      mediaStatus: "PENDING",
      requestId,
      requesterUsername,
      requesterDiscordId,
      seasons: seasons?.join(",")
    });

    const rendered = renderTemplate(cfg.requestAnnouncementTemplate, templateContext);

    const payload = buildAnnouncementPayload({
      title: "New Media Request",
      description: rendered,
      color: 0x4cc9f0,
      mention,
      fields: [
        { name: "Type", value: mediaType || "unknown", inline: true },
        { name: "Request ID", value: String(requestId || "unknown"), inline: true }
      ]
    });

    await sendToChannel(cfg.requestsChannelId, payload);
  }

  async function announceRequestStatusChange({
    title,
    mediaType,
    mediaId,
    requestId,
    statusText,
    status,
    requesterDiscordId,
    requesterUsername,
    seasons,
    image
  }) {
    const cfg = getBotConfig();
    const isAvailable = Number(status) === 4;

    const mention = cfg.mentionRequesterInChannel && requesterDiscordId ? `<@${requesterDiscordId}>` : "";

    const templateContext = buildTemplateContext({
      notificationType: status === 4 ? "MEDIA_AVAILABLE" : "MEDIA_STATUS_CHANGED",
      event: status === 4 ? "Request Available" : "Request Status Changed",
      subject: title,
      message: `${title} changed status to ${statusText}.`,
      image,
      mediaType,
      mediaTmdbId: mediaId,
      mediaStatus: statusText,
      requestId,
      requesterUsername,
      requesterDiscordId,
      seasons: seasons?.join(",")
    });

    if (isAvailable && cfg.announceOnAvailable && cfg.uploadsChannelId) {
      const rendered = renderTemplate(cfg.availableAnnouncementTemplate, templateContext);
      const payload = buildAnnouncementPayload({
        title: "Media Is Now Available",
        description: rendered,
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
      const rendered = renderTemplate(cfg.statusAnnouncementTemplate, templateContext);
      const payload = buildAnnouncementPayload({
        title: "Request Status Updated",
        description: rendered,
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

  function parseSeasonMode(rawValue) {
    const normalized = String(rawValue || "").trim().toLowerCase();
    if (!normalized) {
      return { mode: "none" };
    }

    if (normalized === "all") {
      return { mode: "all" };
    }

    if (normalized === "latest") {
      return { mode: "latest" };
    }

    if (/^\d+$/.test(normalized)) {
      const seasonNumber = Number(normalized);
      if (Number.isInteger(seasonNumber) && seasonNumber > 0) {
        return { mode: "single", seasonNumber };
      }
    }

    const compact = normalized.replace(/\s+/g, "");
    const match = compact.match(/^season(?:\[(\d+)\]|(\d+))$/);
    if (match) {
      const seasonNumber = Number(match[1] || match[2]);
      if (Number.isInteger(seasonNumber) && seasonNumber > 0) {
        return { mode: "single", seasonNumber };
      }
    }

    return { mode: "invalid", input: rawValue };
  }

  async function handleRequestHelp(interaction) {
    const helpText = [
      "How to use /request",
      "",
      "Movie:",
      "/request media_type:movie media_id:603",
      "",
      "TV (season modes):",
      "/request media_type:tv media_id:1399 season:1",
      "/request media_type:tv media_id:1399 season:all",
      "/request media_type:tv media_id:1399 season:latest",
      "/request media_type:tv media_id:1399 season:season1",
      "/request media_type:tv media_id:1399 season:season[1]",
      "",
      "Notes:",
      "- For TV, season is required.",
      "- For movies, do not set season.",
      "- Seasons are validated against Seerr metadata before requesting."
    ].join("\n");

    await interaction.reply(toEphemeralResponse(helpText));
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
    const seasonInput = interaction.options.getString("season");
    const parsedSeason = parseSeasonMode(seasonInput);

    if (mediaType === "tv" && parsedSeason.mode === "none") {
      await interaction.reply(
        toEphemeralResponse(
          "TV requests require a season mode: 1, all, latest, season1, or season[1]."
        )
      );
      return;
    }

    if (mediaType === "tv" && parsedSeason.mode === "invalid") {
      await interaction.reply(
        toEphemeralResponse(
          "Invalid season format. Use one of: 1, all, latest, season1, season[1]."
        )
      );
      return;
    }

    if (mediaType === "movie" && parsedSeason.mode !== "none") {
      await interaction.reply(
        toEphemeralResponse("Season is only valid when media_type is TV.")
      );
      return;
    }

    let selectedSeasons = [];
    if (mediaType === "tv") {
      const availableSeasons = await overseerr.getTvSeasonNumbers(mediaId);
      if (availableSeasons.length === 0) {
        await interaction.reply(
          toEphemeralResponse(
            "Could not resolve available seasons from Seerr for that TV ID. Verify the TMDB ID and Seerr metadata."
          )
        );
        return;
      }

      if (parsedSeason.mode === "all") {
        selectedSeasons = availableSeasons;
      } else if (parsedSeason.mode === "latest") {
        selectedSeasons = [availableSeasons[availableSeasons.length - 1]];
      } else if (parsedSeason.mode === "single") {
        if (!availableSeasons.includes(parsedSeason.seasonNumber)) {
          await interaction.reply(
            toEphemeralResponse(
              `Season ${parsedSeason.seasonNumber} does not exist for this show in Seerr. Available: ${availableSeasons.join(", ")}`
            )
          );
          return;
        }
        selectedSeasons = [parsedSeason.seasonNumber];
      }
    }

    const userId = await resolveOverseerrUserId(interaction.user.id);

    const response = await overseerr.requestMedia({
      mediaType,
      mediaId,
      userId,
      seasons: selectedSeasons
    });

    const requestObj = response.request || response;
    const mediaObj = response.media || requestObj.media || {};
    const requestId = requestObj.id || response.id;
    const status = requestObj.status || response.status || 1;
    const title = mediaObj.title || mediaObj.name || `TMDB ${mediaType} ${mediaId}`;
    const requesterUsername =
      requestObj.requestedBy?.displayName || requestObj.requestedBy?.username || interaction.user.username;
    const seasons = Array.isArray(requestObj.seasons)
      ? requestObj.seasons
          .map((item) => {
            if (Number.isInteger(item)) {
              return item;
            }
            if (Number.isInteger(item?.seasonNumber)) {
              return item.seasonNumber;
            }
            return null;
          })
          .filter((item) => Number.isInteger(item))
      : selectedSeasons;

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
        `Request submitted: ${title}${
          mediaType === "tv" && seasons.length > 0 ? ` (seasons ${seasons.join(", ")})` : ""
        } (request id ${requestId || "unknown"}, status ${overseerr.getRequestStatusText(status)}).`
      )
    );

    await announceRequestCreated({
      title,
      mediaType,
      mediaId,
      requestId,
      requesterDiscordId: interaction.user.id,
      requesterUsername,
      seasons,
      image: mediaObj.posterPath || mediaObj.poster || ""
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
        case "requesthelp":
          await handleRequestHelp(interaction);
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
