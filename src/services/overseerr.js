const axios = require("axios");
const https = require("https");

const REQUEST_STATUS = {
  1: "Pending",
  2: "Approved",
  3: "Declined",
  4: "Available",
  5: "Processing",
  6: "Partially Available"
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

  function isOverseerrFilterCrash(error) {
    const status = error?.response?.status;
    const message = String(
      error?.response?.data?.message || error?.response?.data?.error || error?.message || ""
    ).toLowerCase();
    return status === 500 && message.includes("reading 'filter'");
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
    const row = item || {};
    return {
      id: row.id,
      mediaType: row.mediaType,
      title: row.title || row.name || "Unknown title",
      overview: row.overview || "",
      releaseDate: row.releaseDate || row.firstAirDate || "",
      posterPath: row.posterPath || ""
    };
  }

  function coerceArray(maybeArray) {
    if (Array.isArray(maybeArray)) {
      return maybeArray;
    }
    return [];
  }

  function extractSeasonNumbersFromNode(node, out) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        extractSeasonNumbersFromNode(item, out);
      }
      return;
    }

    if (Number.isInteger(node.seasonNumber) && node.seasonNumber > 0) {
      out.add(node.seasonNumber);
    }

    if (Array.isArray(node.seasons)) {
      for (const season of node.seasons) {
        if (Number.isInteger(season?.seasonNumber) && season.seasonNumber > 0) {
          out.add(season.seasonNumber);
        }
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        extractSeasonNumbersFromNode(value, out);
      }
    }
  }

  function extractMediaSnapshot(node) {
    if (!node || typeof node !== "object") {
      return null;
    }

    const media = node.media && typeof node.media === "object" ? node.media : node;
    const title =
      media.title ||
      media.name ||
      media.originalTitle ||
      node.subject ||
      node.title ||
      "";
    const mediaType = String(media.mediaType || media.type || node.mediaType || node.type || "").toLowerCase();
    const tmdbId = Number(media.tmdbId || media.id || node.tmdbId || node.id || 0);

    if (!title && !tmdbId) {
      return null;
    }

    return {
      title: String(title || "").trim(),
      mediaType: mediaType === "movie" || mediaType === "tv" ? mediaType : "unknown",
      mediaId: tmdbId > 0 ? tmdbId : 0,
      posterPath: media.posterPath || media.poster || ""
    };
  }

  return {
    getRequestStatusText: (status) => REQUEST_STATUS[status] || `Unknown (${status})`,
    searchMedia: async (query, mediaType = "all") => {
      const client = getClient();
      const rawQuery = String(query || "").trim();
      const normalizedType = String(mediaType || "all").toLowerCase();
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

      const all = coerceArray(response?.data?.results ?? response?.data);
      const filtered =
        normalizedType === "all"
          ? all
          : all.filter((item) => String(item?.mediaType || "").toLowerCase() === normalizedType);

      return filtered.map(normalizeResult);
    },
    requestMedia: async ({ mediaType, mediaId, userId, seasons }) => {
      const client = getClient();
      const normalizedType = String(mediaType || "").toLowerCase();
      const requestedSeasons = coerceArray(seasons)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      const hasSeasons = normalizedType === "tv" && requestedSeasons.length > 0;

      const basePayload = {
        mediaType: normalizedType,
        mediaId,
        userId
      };

      if (hasSeasons) {
        basePayload.seasons = requestedSeasons;
      }

      try {
        const response = await client.post(buildEndpoint("api/v1/request"), basePayload);
        return response.data;
      } catch (error) {
        if (!(normalizedType === "tv" && isOverseerrFilterCrash(error))) {
          throw error;
        }

        // Some Overseerr builds crash when seasons is omitted for TV requests.
        try {
          const response = await client.post(buildEndpoint("api/v1/request"), {
            ...basePayload,
            seasons: hasSeasons ? requestedSeasons : []
          });
          return response.data;
        } catch (retryError) {
          const response = await client.post(buildEndpoint("api/v1/request"), {
            ...basePayload,
            seasons: hasSeasons ? requestedSeasons : [1]
          });
          return response.data;
        }
      }
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
      return coerceArray(response?.data?.results ?? response?.data);
    },
    getTvSeasonNumbers: async (mediaId) => {
      const client = getClient();
      const id = Number(mediaId);
      const seasonSet = new Set();

      const endpoints = [
        buildEndpoint(`api/v1/tv/${id}`),
        buildEndpoint(`api/v1/media/${id}`)
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await client.get(endpoint);
          extractSeasonNumbersFromNode(response?.data, seasonSet);
          if (seasonSet.size > 0) {
            break;
          }
        } catch (error) {
          // Try fallback endpoint when one route is unavailable in a given Seerr build.
        }
      }

      return Array.from(seasonSet).sort((a, b) => a - b);
    },
    getMediaByTmdbId: async (mediaId, mediaTypeHint = "") => {
      const client = getClient();
      const id = Number(mediaId);
      if (!Number.isInteger(id) || id <= 0) {
        return null;
      }

      const hint = String(mediaTypeHint || "").toLowerCase();
      const preferred = hint === "movie" || hint === "tv" ? [hint] : [];
      const remaining = ["movie", "tv"].filter((kind) => !preferred.includes(kind));
      const kindOrder = preferred.concat(remaining);

      for (const kind of kindOrder) {
        try {
          const response = await client.get(buildEndpoint(`api/v1/${kind}/${id}`));
          const snapshot = extractMediaSnapshot(response?.data);
          if (snapshot?.title || snapshot?.mediaId) {
            return {
              ...snapshot,
              mediaType: kind
            };
          }
        } catch (error) {
          // Try next endpoint; route availability differs between Seerr builds.
        }
      }

      try {
        const response = await client.get(buildEndpoint(`api/v1/media/${id}`));
        const snapshot = extractMediaSnapshot(response?.data);
        if (snapshot?.title || snapshot?.mediaId) {
          return snapshot;
        }
      } catch (error) {
        // No generic media endpoint available or media not found.
      }

      return null;
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

      const target = String(username || "").toLowerCase();
      const users = coerceArray(response?.data?.results ?? response?.data);
      const match = users.find(
        (user) =>
          user.username?.toLowerCase() === target ||
          user.displayName?.toLowerCase() === target
      );

      return match || null;
    }
  };
}

module.exports = { createOverseerrClient };
