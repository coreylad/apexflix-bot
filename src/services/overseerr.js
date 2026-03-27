const axios = require("axios");
const https = require("https");

const STATUS_TEXT = {
  0: "Unknown",
  1: "Pending",
  2: "Approved",
  3: "Declined",
  4: "Available",
  5: "Processing",
  6: "Partially Available",
  7: "Failed",
  8: "Completed"
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

  function firstNonEmpty(values, fallback = "") {
    for (const value of values || []) {
      if (value === undefined || value === null) {
        continue;
      }

      const normalized = String(value).trim();
      if (normalized) {
        return normalized;
      }
    }

    return fallback;
  }

  function normalizeRequestStatus(value) {
    const numeric = Number(value);
    if (Number.isInteger(numeric)) {
      // Overseerr MediaRequestStatus: 1 Pending, 2 Approved, 3 Declined, 4 Failed, 5 Completed
      if (numeric === 4) {
        return 7;
      }
      if (numeric === 5) {
        return 8;
      }
      if (numeric >= 1 && numeric <= 3) {
        return numeric;
      }
    }

    const normalized = String(value || "").trim().toUpperCase();
    const map = {
      PENDING: 1,
      APPROVED: 2,
      DECLINED: 3,
      FAILED: 7,
      COMPLETED: 8
    };

    return map[normalized] ?? 0;
  }

  function mediaStatusToCode(value) {
    if (value === undefined || value === null) {
      return 0;
    }

    if (Number.isInteger(value)) {
      // Overseerr MediaStatus: 1 Unknown, 2 Pending, 3 Processing, 4 Partially Available, 5 Available, 6 Deleted
      const numericMap = {
        1: 0,
        2: 1,
        3: 5,
        4: 6,
        5: 4,
        6: 0
      };
      return numericMap[value] ?? 0;
    }

    const normalized = String(value).trim().toUpperCase();
    const map = {
      UNKNOWN: 0,
      PENDING: 1,
      APPROVED: 2,
      DECLINED: 3,
      PROCESSING: 5,
      PARTIALLY_AVAILABLE: 6,
      AVAILABLE: 4,
      DELETED: 0
    };

    return map[normalized] ?? 0;
  }

  function resolveEffectiveStatus(item) {
    const requestStatus = normalizeRequestStatus(item?.status);
    const mediaStatusCode = mediaStatusToCode(
      item?.media?.status || item?.mediaStatus || item?.media?.status4k || item?.mediaStatus4k
    );

    if (requestStatus === 3) {
      return 3;
    }

    if (requestStatus === 7) {
      return 7;
    }

    if (requestStatus === 8) {
      // Treat completed request as available for downstream channel routing.
      return 4;
    }

    if ([4, 5, 6].includes(mediaStatusCode)) {
      return mediaStatusCode;
    }

    if (requestStatus > 0) {
      return requestStatus;
    }

    if (mediaStatusCode > 0) {
      return mediaStatusCode;
    }

    return 0;
  }

  function formatProgressValue(entry) {
    const size = Number(entry?.size);
    const sizeLeft = Number(entry?.sizeLeft ?? entry?.sizeleft);
    if (Number.isFinite(size) && size > 0 && Number.isFinite(sizeLeft) && sizeLeft >= 0) {
      const progressFromSize = ((size - sizeLeft) / size) * 100;
      const clampedFromSize = Math.max(0, Math.min(100, progressFromSize));
      return `${Math.round(clampedFromSize)}%`;
    }

    const candidates = [
      entry?.progress,
      entry?.percentage,
      entry?.percent,
      entry?.completion,
      entry?.downloadPercentage
    ];

    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric >= 0) {
        const clamped = Math.max(0, Math.min(100, numeric));
        return `${Math.round(clamped)}%`;
      }
    }

    return "";
  }

  function formatEtaValue(entry) {
    const rawTimeLeft = String(entry?.timeLeft ?? entry?.timeleft ?? "").trim();
    if (rawTimeLeft) {
      return rawTimeLeft;
    }

    const completion = entry?.estimatedCompletionTime;
    if (completion) {
      const date = new Date(completion);
      if (!Number.isNaN(date.getTime())) {
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${hours}:${minutes}`;
      }
    }

    return "";
  }

  function formatEpisodeTag(entry) {
    const season = Number(entry?.episode?.seasonNumber);
    const episode = Number(entry?.episode?.episodeNumber);
    if (Number.isInteger(season) && Number.isInteger(episode) && season > 0 && episode > 0) {
      return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    }

    const absolute = Number(entry?.episode?.absoluteEpisodeNumber);
    if (Number.isInteger(absolute) && absolute > 0) {
      return `Episode ${absolute}`;
    }

    return "";
  }

  function summarizeDownloadStatus(entries, fallbackTitle = "") {
    const rows = coerceArray(entries).slice(0, 2);
    if (rows.length === 0) {
      return "";
    }

    const baseTitle = firstNonEmpty([fallbackTitle], "Item");
    const chunks = rows
      .map((entry) => {
        const episodeTag = formatEpisodeTag(entry);
        const label = episodeTag ? `${baseTitle} ${episodeTag}` : baseTitle;
        const progress = formatProgressValue(entry);
        const eta = formatEtaValue(entry);
        const state = firstNonEmpty([entry?.state, entry?.status], "");

        if (progress && eta) {
          return `${label} ${progress} ETA ${eta}`;
        }

        if (progress) {
          return `${label} ${progress}`;
        }

        if (eta) {
          return `${label} ETA ${eta}`;
        }

        if (state) {
          return `${label} ${state}`;
        }

        return label;
      })
      .filter(Boolean);

    return chunks.join("; ");
  }

  function resolveStatusSnapshot(item) {
    const status = resolveEffectiveStatus(item);
    const base = STATUS_TEXT[status] || `Unknown (${status})`;
    const canonicalTitle = firstNonEmpty(
      [
        item?.media?.title,
        item?.media?.name,
        item?.subject,
        item?.title
      ],
      "Item"
    );
    const downloadSummary = summarizeDownloadStatus(
      item?.media?.downloadStatus || item?.media?.downloadStatus4k || item?.downloadStatus,
      canonicalTitle
    );

    if (downloadSummary && status === 5) {
      return {
        status,
        statusText: `${base} (${downloadSummary})`
      };
    }

    return {
      status,
      statusText: base
    };
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
    getRequestStatusText: (status) => {
      const parsed = Number(status);
      if (Number.isInteger(parsed) && STATUS_TEXT[parsed]) {
        return STATUS_TEXT[parsed];
      }

      const fromRequest = normalizeRequestStatus(status);
      if (STATUS_TEXT[fromRequest]) {
        return STATUS_TEXT[fromRequest];
      }

      const fromMedia = mediaStatusToCode(status);
      if (STATUS_TEXT[fromMedia]) {
        return STATUS_TEXT[fromMedia];
      }

      return `Unknown (${status})`;
    },
    resolveEffectiveStatus,
    resolveStatusSnapshot,
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
