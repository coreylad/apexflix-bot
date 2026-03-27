const axios = require("axios");
const https = require("https");

const REQUEST_STATUS = {
  1: "Pending",
  2: "Approved",
  3: "Declined",
  4: "Available"
};

function createOverseerrClient(config) {
  function ensureConfigured() {
    if (!config.baseUrl || !config.apiKey) {
      throw new Error("Overseerr is not configured yet. Set OVERSEERR_BASE_URL and OVERSEERR_API_KEY.");
    }
  }

  function getClient() {
    ensureConfigured();
    const httpsAgent =
      config.allowInsecureTls && config.baseUrl.startsWith("https://")
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    return axios.create({
      baseURL: config.baseUrl,
      headers: {
        "X-Api-Key": config.apiKey,
        "Content-Type": "application/json"
      },
      timeout: 15000,
      httpsAgent
    });
  }

  function normalizeResult(item) {
    return {
      id: item.id,
      mediaType: item.mediaType,
      title: item.title || item.name || "Unknown title",
      overview: item.overview || "",
      releaseDate: item.releaseDate || item.firstAirDate || "",
      posterPath: item.posterPath || ""
    };
  }

  return {
    getRequestStatusText: (status) => REQUEST_STATUS[status] || `Unknown (${status})`,
    searchMedia: async (query, mediaType = "all") => {
      const client = getClient();
      const response = await client.get("/api/v1/search", {
        params: { query }
      });

      const all = response.data?.results || [];
      const filtered =
        mediaType === "all"
          ? all
          : all.filter((item) => item.mediaType === mediaType);

      return filtered.map(normalizeResult);
    },
    requestMedia: async ({ mediaType, mediaId, userId }) => {
      const client = getClient();
      const response = await client.post("/api/v1/request", {
        mediaType,
        mediaId,
        userId
      });
      return response.data;
    },
    getRequestById: async (requestId) => {
      const client = getClient();
      const response = await client.get(`/api/v1/request/${requestId}`);
      return response.data;
    },
    getRecentRequests: async (take = 20) => {
      const client = getClient();
      const response = await client.get("/api/v1/request", {
        params: { take, skip: 0 }
      });
      return response.data?.results || [];
    },
    findUserByUsername: async (username) => {
      const client = getClient();
      const response = await client.get("/api/v1/user", {
        params: { take: 100, skip: 0, sort: "created" }
      });

      const users = response.data?.results || [];
      const match = users.find(
        (user) =>
          user.username?.toLowerCase() === username.toLowerCase() ||
          user.displayName?.toLowerCase() === username.toLowerCase()
      );

      return match || null;
    }
  };
}

module.exports = { createOverseerrClient };
