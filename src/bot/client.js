const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const { buildCommands } = require("./commands");

function createDiscordBot({ config, logger, db, overseerr, jellyfin }) {
  let online = false;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessages
    ]
  });

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
      await interaction.reply({
        content: `No Overseerr user found for: ${username}`,
        ephemeral: true
      });
      return;
    }

    db.upsertUserLink({
      discordUserId: interaction.user.id,
      overseerrUserId: user.id,
      overseerrUsername: user.username || user.displayName || username
    });

    await interaction.reply({
      content: `Linked to Overseerr user: ${user.displayName || user.username} (id ${user.id})`,
      ephemeral: true
    });
  }

  async function handleSearch(interaction) {
    const query = interaction.options.getString("query", true);
    const mediaType = interaction.options.getString("media_type") || "all";
    const results = await overseerr.searchMedia(query, mediaType);

    await interaction.reply({
      content: formatSearchResults(results),
      ephemeral: true
    });
  }

  async function handleRequest(interaction) {
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

    await interaction.reply({
      content: `Request submitted: ${title} (request id ${requestId || "unknown"}, status ${overseerr.getRequestStatusText(status)}).`,
      ephemeral: true
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

    await interaction.reply({
      content: `Request #${request.id}: ${title} is currently ${statusText}.`,
      ephemeral: true
    });
  }

  async function handleRecent(interaction) {
    const latest = await jellyfin.getLatestItems(8);
    if (latest.length === 0) {
      await interaction.reply({
        content: "No recent Jellyfin items found.",
        ephemeral: true
      });
      return;
    }

    const lines = latest
      .map((item) => `• ${item.name} (${item.type}${item.productionYear ? `, ${item.productionYear}` : ""})`)
      .join("\n");

    await interaction.reply({
      content: `Latest from Jellyfin:\n${lines}`,
      ephemeral: true
    });
  }

  async function notifyDiscordUser(discordUserId, message) {
    if (!online) {
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
          await interaction.reply({
            content: "Unknown command.",
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error(`Command handling error: ${error.message}`);
      const response = {
        content: `Command failed: ${error.message}`,
        ephemeral: true
      };

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
    getClient: () => client
  };
}

module.exports = { createDiscordBot };
