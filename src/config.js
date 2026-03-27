const dotenv = require("dotenv");

dotenv.config();

function optionalNumber(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function optional(name, fallback = "") {
  return process.env[name] || fallback;
}

const config = {
  discord: {},
  overseerr: {},
  jellyfin: {},
  app: {}
};

function refreshConfigFromProcess() {
  config.discord.token = optional("DISCORD_TOKEN");
  config.discord.clientId = optional("DISCORD_CLIENT_ID");
  config.discord.guildId = optional("DISCORD_GUILD_ID");

  config.overseerr.baseUrl = optional("OVERSEERR_BASE_URL").replace(/\/$/, "");
  config.overseerr.apiKey = optional("OVERSEERR_API_KEY");
  config.overseerr.defaultUserId = optionalNumber("OVERSEERR_DEFAULT_USER_ID", 1);

  config.jellyfin.baseUrl = optional("JELLYFIN_BASE_URL").replace(/\/$/, "");
  config.jellyfin.apiKey = optional("JELLYFIN_API_KEY");
  config.jellyfin.userId = optional("JELLYFIN_USER_ID");

  config.app.port = optionalNumber("PORT", 1337);
  config.app.requestStatusPollSeconds = optionalNumber("REQUEST_STATUS_POLL_SECONDS", 60);
  config.app.logLevel = optional("LOG_LEVEL", "info").toLowerCase();
}

refreshConfigFromProcess();

module.exports = config;
module.exports.refreshConfigFromProcess = refreshConfigFromProcess;
