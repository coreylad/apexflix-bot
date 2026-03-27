const axios = require("axios");

function createJellyfinClient(config) {
  function ensureConfigured() {
    if (!config.baseUrl || !config.apiKey || !config.userId) {
      throw new Error("Jellyfin is not configured yet. Set JELLYFIN_BASE_URL, JELLYFIN_API_KEY, and JELLYFIN_USER_ID.");
    }
  }

  function getClient() {
    ensureConfigured();
    return axios.create({
      baseURL: config.baseUrl,
      headers: {
        "X-Emby-Token": config.apiKey,
        "Content-Type": "application/json"
      },
      timeout: 15000
    });
  }

  return {
    getLatestItems: async (limit = 12) => {
      const client = getClient();
      const response = await client.get(`/Users/${config.userId}/Items/Latest`, {
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
