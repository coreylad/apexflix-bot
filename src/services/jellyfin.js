const axios = require("axios");
const https = require("https");

function createJellyfinClient(config) {
  function normalizedBaseUrl() {
    const raw = String(config.url || "").trim();
    if (!raw) {
      return "";
    }

    return raw.replace(/\/+$/, "");
  }

  function buildEndpoint(pathname) {
    const base = normalizedBaseUrl();
    const path = String(pathname || "").replace(/^\/+/, "");
    return `${base}/${path}`;
  }

  function ensureConfigured() {
    const base = normalizedBaseUrl();
    if (!base || !config.apiKey || !config.userId) {
      throw new Error("Jellyfin is not configured yet. Set JELLYFIN_URL, JELLYFIN_API_KEY, and JELLYFIN_USER_ID.");
    }

    try {
      const parsed = new URL(base);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch (error) {
      throw new Error(
        "Invalid JELLYFIN_URL. Use a full URL such as https://apexflix.xyz/coreylad/jellyfin"
      );
    }
  }

  function getClient() {
    const base = normalizedBaseUrl();
    ensureConfigured();
    const httpsAgent =
      config.allowInsecureTls && base.startsWith("https://")
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    return axios.create({
      headers: {
        "X-Emby-Token": config.apiKey,
        "Content-Type": "application/json"
      },
      timeout: 15000,
      httpsAgent
    });
  }

  return {
    getLatestItems: async (limit = 12) => {
      const client = getClient();
      const response = await client.get(buildEndpoint(`Users/${config.userId}/Items/Latest`), {
        params: { Limit: limit }
      });

      const items = response.data || [];
      return items.map((item) => ({
        id: item.Id,
        name: item.Name,
        type: item.Type,
        premiereDate: item.PremiereDate,
        productionYear: item.ProductionYear
      }));
    }
  };
}

module.exports = { createJellyfinClient };
