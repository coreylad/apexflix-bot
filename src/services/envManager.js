const fs = require("fs");
const path = require("path");

const ALLOWED_KEYS = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "OVERSEERR_URL",
  "OVERSEERR_BASE_URL",
  "OVERSEERR_API_KEY",
  "OVERSEERR_DEFAULT_USER_ID",
  "OVERSEERR_ALLOW_INSECURE_TLS",
  "JELLYFIN_URL",
  "JELLYFIN_BASE_URL",
  "JELLYFIN_API_KEY",
  "JELLYFIN_USER_ID",
  "JELLYFIN_USERNAME",
  "JELLYFIN_CLIENT_NAME",
  "JELLYFIN_DEVICE_NAME",
  "JELLYFIN_DEVICE_ID",
  "JELLYFIN_CLIENT_VERSION",
  "JELLYFIN_ALLOW_INSECURE_TLS",
  "JELLYFIN_LOG_DIR",
  "PORT",
  "REQUEST_STATUS_POLL_SECONDS",
  "LOG_LEVEL",
  "TRUST_PROXY",
  "APP_BASE_PATH"
];

function parseEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function stringifyEnv(map) {
  const lines = [];

  for (const key of ALLOWED_KEYS) {
    const value = map[key] ?? "";
    lines.push(`${key}=${value}`);
  }

  return `${lines.join("\n")}\n`;
}

function createEnvManager() {
  const envPath = path.join(process.cwd(), ".env");

  function readEnvMap() {
    if (!fs.existsSync(envPath)) {
      return {};
    }

    const raw = fs.readFileSync(envPath, "utf8");
    return parseEnv(raw);
  }

  function getCurrentSettings() {
    const fileMap = readEnvMap();
    const result = {};

    for (const key of ALLOWED_KEYS) {
      result[key] = fileMap[key] ?? process.env[key] ?? "";
    }

    return result;
  }

  function saveSettings(partialMap) {
    const current = getCurrentSettings();

    for (const key of ALLOWED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(partialMap, key)) {
        current[key] = String(partialMap[key] ?? "").trim();
      }
    }

    fs.writeFileSync(envPath, stringifyEnv(current), "utf8");

    for (const key of ALLOWED_KEYS) {
      if (current[key]) {
        process.env[key] = current[key];
      } else {
        delete process.env[key];
      }
    }

    return current;
  }

  return {
    allowedKeys: ALLOWED_KEYS,
    getCurrentSettings,
    saveSettings
  };
}

module.exports = { createEnvManager };
