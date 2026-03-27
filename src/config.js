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

function optionalBoolean(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function optional(name, fallback = "") {
  return process.env[name] || fallback;
}

function firstDefined(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return fallback;
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

  config.overseerr.url = firstDefined(["OVERSEERR_URL", "OVERSEERR_BASE_URL"]).replace(/\/$/, "");
  config.overseerr.apiKey = optional("OVERSEERR_API_KEY");
  config.overseerr.defaultUserId = optionalNumber("OVERSEERR_DEFAULT_USER_ID", 1);
  config.overseerr.allowInsecureTls = optionalBoolean("OVERSEERR_ALLOW_INSECURE_TLS", false);

  config.jellyfin.url = firstDefined(["JELLYFIN_URL", "JELLYFIN_BASE_URL"]).replace(/\/$/, "");
  config.jellyfin.apiKey = optional("JELLYFIN_API_KEY");
  config.jellyfin.userId = optional("JELLYFIN_USER_ID");
  config.jellyfin.username = optional("JELLYFIN_USERNAME");
  config.jellyfin.clientName = optional("JELLYFIN_CLIENT_NAME", "ApexFlix");
  config.jellyfin.deviceName = optional("JELLYFIN_DEVICE_NAME", "ApexFlix Bot");
  config.jellyfin.deviceId = optional("JELLYFIN_DEVICE_ID", "apexflix-bot");
  config.jellyfin.clientVersion = optional("JELLYFIN_CLIENT_VERSION", "1.0.0");
  config.jellyfin.allowInsecureTls = optionalBoolean("JELLYFIN_ALLOW_INSECURE_TLS", false);
  config.jellyfin.ffmpegLogDir = optional("JELLYFIN_FFMPEG_LOG_DIR", "/var/log/jellyfin");

  config.app.port = optionalNumber("PORT", 1337);
  config.app.requestStatusPollSeconds = optionalNumber("REQUEST_STATUS_POLL_SECONDS", 60);
  config.app.logLevel = optional("LOG_LEVEL", "info").toLowerCase();
  config.app.logFile = optional("LOG_FILE", "logs/apexflix.log");
  config.app.logBufferSize = optionalNumber("LOG_BUFFER_SIZE", 2000);
  config.app.trustProxy = optionalBoolean("TRUST_PROXY", true);
  config.app.basePath = optional("APP_BASE_PATH", "/") || "/";
}

refreshConfigFromProcess();

module.exports = config;
module.exports.refreshConfigFromProcess = refreshConfigFromProcess;
