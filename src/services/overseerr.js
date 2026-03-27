const axios = require("axios");
const https = require("https");

const REQUEST_STATUS = {
  1: "Pending",
  2: "Approved",
  3: "Declined",
  4: "Available"
};

function createOverseerrClient(config) {
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

  function withQuery(pathname, params) {
    const base = buildEndpoint(pathname);
    const pairs = [];

    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      const encodedKey = encodeURIComponent(String(key));
      const encodedValue = encodeURIComponent(String(value));
      pairs.push(`${encodedKey}=${encodedValue}`);
    }

    if (pairs.length === 0) {
      return base;
    }

    return `${base}?${pairs.join("&")}`;
  }

  function isEncodingError(error) {
    const status = error?.response?.status;
    const message = String(error?.response?.data?.message || error?.message || "").toLowerCase();
    return status === 400 && message.includes("must be url encoded");
  }

  function ensureConfigured() {
    const base = normalizedBaseUrl();
    if (!base || !config.apiKey) {
      throw new Error("Overseerr is not configured yet. Set OVERSEERR_URL and OVERSEERR_API_KEY.");
    }

    try {
      const parsed = new URL(base);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch (error) {
      throw new Error(
        "Invalid OVERSEERR_URL. Use a full URL such as https://apexflix.xyz/coreylad/overseerr"
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
      const rawQuery = String(query || "").trim();
      let response;

      try {
        response = await client.get(
          withQuery("api/v1/search", {
            query: rawQuery
          })
        );
      } catch (error) {
        if (!isEncodingError(error)) {
          throw error;
        }

        // Some reverse proxies decode query values before forwarding; retry with double-encoding.
        response = await client.get(
          withQuery("api/v1/search", {
            query: encodeURIComponent(rawQuery)
          })
        );
      }

      const all = response.data?.results || [];
      const filtered =
        mediaType === "all"
          ? all
          : all.filter((item) => item.mediaType === mediaType);

      return filtered.map(normalizeResult);
    },
    requestMedia: async ({ mediaType, mediaId, userId }) => {
      const client = getClient();
      const response = await client.post(buildEndpoint("api/v1/request"), {
        mediaType,
        mediaId,
        userId
      });
      return response.data;
    },
    getRequestById: async (requestId) => {
      const client = getClient();
      const response = await client.get(buildEndpoint(`api/v1/request/${requestId}`));
      return response.data;
    },
    getRecentRequests: async (take = 20) => {
      const client = getClient();
      const response = await client.get(
        withQuery("api/v1/request", {
          take,
          skip: 0
        })
      );
      return response.data?.results || [];
    },
    findUserByUsername: async (username) => {
      const client = getClient();
      const response = await client.get(
        withQuery("api/v1/user", {
          take: 100,
          skip: 0,
          sort: "created"
        })
      );

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
