const axios = require("axios");
const https = require("https");

function createJellyfinClient(config) {
  let authBackoffUntil = 0;
  const AUTH_BACKOFF_MS = 2 * 60 * 1000;

  function normalizedApiKey() {
    const raw = String(config.apiKey || "").trim();
    const quoted = raw.match(/^(["'])(.*)\1$/);
    return quoted ? quoted[2].trim() : raw;
  }

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
    if (!base || !normalizedApiKey()) {
      throw new Error("Jellyfin is not configured yet. Set JELLYFIN_URL and JELLYFIN_API_KEY.");
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

  function escapeHeaderValue(value) {
    return String(value || "").replace(/\"/g, "");
  }

  function buildAuthorizationHeader() {
    const apiKey = normalizedApiKey();
    return [
      `MediaBrowser Token=\"${escapeHeaderValue(apiKey)}\"`,
      `Client=\"${escapeHeaderValue(config.clientName || "ApexFlix")}\"`,
      `Device=\"${escapeHeaderValue(config.deviceName || "ApexFlix Bot")}\"`,
      `DeviceId=\"${escapeHeaderValue(config.deviceId || "apexflix-bot")}\"`,
      `Version=\"${escapeHeaderValue(config.clientVersion || "1.0.0")}\"`
    ].join(", ");
  }

  function describeAxiosError(error) {
    const status = error?.response?.status;
    const body = error?.response?.data;
    if (!status) {
      return error.message;
    }

    if (typeof body === "string") {
      return `HTTP ${status}: ${body}`;
    }

    if (body && typeof body === "object") {
      const detail = body.message || body.error || JSON.stringify(body);
      return `HTTP ${status}: ${detail}`;
    }

    return `HTTP ${status}: ${error.message}`;
  }

  function getClient() {
    const now = Date.now();
    if (authBackoffUntil > now) {
      const retryInSeconds = Math.max(1, Math.ceil((authBackoffUntil - now) / 1000));
      throw new Error(
        `Jellyfin authentication failed recently (invalid token). Retry in ${retryInSeconds}s or update JELLYFIN_API_KEY.`
      );
    }

    const base = normalizedBaseUrl();
    ensureConfigured();
    const httpsAgent =
      config.allowInsecureTls && base.startsWith("https://")
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    const apiKey = normalizedApiKey();

    const client = axios.create({
      headers: {
        Authorization: buildAuthorizationHeader(),
        "X-Emby-Token": apiKey,
        "Content-Type": "application/json"
      },
      timeout: 15000,
      httpsAgent
    });

    client.interceptors.response.use(
      (response) => {
        authBackoffUntil = 0;
        return response;
      },
      (error) => {
        const status = Number(error?.response?.status || 0);
        if (status === 401 || status === 403) {
          authBackoffUntil = Date.now() + AUTH_BACKOFF_MS;
        }
        return Promise.reject(error);
      }
    );

    return client;
  }

  async function resolveUserId(client) {
    if (config.userId) {
      return config.userId;
    }

    try {
      const response = await client.get(buildEndpoint("Users"));
      const users = Array.isArray(response.data) ? response.data : [];

      if (config.username) {
        const match = users.find(
          (user) =>
            String(user.Name || "").toLowerCase() ===
            String(config.username || "").toLowerCase()
        );

        if (match?.Id) {
          return match.Id;
        }
      }

      if (users[0]?.Id) {
        return users[0].Id;
      }
    } catch (error) {
      throw new Error(`Failed to resolve Jellyfin user: ${describeAxiosError(error)}`);
    }

    throw new Error(
      "No Jellyfin user could be resolved. Set JELLYFIN_USER_ID or JELLYFIN_USERNAME."
    );
  }

  function normalizeItem(item) {
    return {
      id: item?.Id,
      name: item?.Name || "Unknown",
      type: item?.Type || "Unknown",
      productionYear: item?.ProductionYear || null,
      runTimeTicks: Number(item?.RunTimeTicks || 0),
      seriesName: item?.SeriesName || "",
      indexNumber: Number(item?.IndexNumber || 0),
      parentIndexNumber: Number(item?.ParentIndexNumber || 0)
    };
  }

  function ticksToDuration(ticks) {
    const totalSeconds = Math.max(0, Math.floor(Number(ticks || 0) / 10000000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
  }

  function computePlaybackPercent(positionTicks, runtimeTicks) {
    const position = Number(positionTicks || 0);
    const runtime = Number(runtimeTicks || 0);
    if (!Number.isFinite(position) || !Number.isFinite(runtime) || runtime <= 0) {
      return null;
    }

    const pct = Math.max(0, Math.min(100, (position / runtime) * 100));
    return Math.round(pct);
  }

  return {
    getServerInfo: async () => {
      const client = getClient();

      try {
        const publicResponse = await client.get(buildEndpoint("System/Info/Public"));
        const data = publicResponse?.data || {};
        return {
          id: data.Id || data.ServerId || "",
          serverName: data.ServerName || data.Name || "",
          version: data.Version || "",
          productName: data.ProductName || data.Product || "Jellyfin"
        };
      } catch (publicError) {
        const privateResponse = await client.get(buildEndpoint("System/Info"));
        const data = privateResponse?.data || {};
        return {
          id: data.Id || data.ServerId || "",
          serverName: data.ServerName || data.Name || "",
          version: data.Version || "",
          productName: data.ProductName || data.Product || "Jellyfin"
        };
      }
    },
    getUsers: async () => {
      const client = getClient();
      const response = await client.get(buildEndpoint("Users"));
      const users = Array.isArray(response?.data) ? response.data : [];
      return users.map((user) => ({
        id: String(user?.Id || ""),
        name: String(user?.Name || "").trim()
      }));
    },
    getLatestItems: async (limit = 12) => {
      const client = getClient();
      const userId = await resolveUserId(client);

      let response;
      try {
        response = await client.get(buildEndpoint(`Users/${userId}/Items/Latest`), {
          params: { Limit: limit }
        });
      } catch (firstError) {
        // Some reverse-proxy or Jellyfin setups work better with Items/Latest + UserId query.
        try {
          response = await client.get(buildEndpoint("Items/Latest"), {
            params: {
              Limit: limit,
              UserId: userId,
              Fields: "PremiereDate,ProductionYear"
            }
          });
        } catch (secondError) {
          throw new Error(
            `Jellyfin latest items failed. Primary: ${describeAxiosError(firstError)}. Fallback: ${describeAxiosError(secondError)}`
          );
        }
      }

      const items = Array.isArray(response.data) ? response.data : [];
      return items.map((item) => ({
        id: item.Id,
        name: item.Name,
        type: item.Type,
        premiereDate: item.PremiereDate,
        productionYear: item.ProductionYear
      }));
    },
    getUsageStats: async () => {
      const client = getClient();
      const userId = await resolveUserId(client);
      const stats = {
        movieCount: 0,
        seriesCount: 0,
        episodeCount: 0,
        songCount: 0,
        playedItemsCount: 0,
        activeSessions: 0
      };

      try {
        const countsResponse = await client.get(buildEndpoint("Items/Counts"));
        const counts = countsResponse?.data || {};
        stats.movieCount = Number(counts.MovieCount || 0);
        stats.seriesCount = Number(counts.SeriesCount || 0);
        stats.episodeCount = Number(counts.EpisodeCount || 0);
        stats.songCount = Number(counts.SongCount || 0);
      } catch (error) {
        // Keep defaults when endpoint is unavailable on a specific Jellyfin setup.
      }

      try {
        const playedResponse = await client.get(buildEndpoint(`Users/${userId}/Items`), {
          params: {
            Recursive: true,
            Limit: 1,
            Filters: "IsPlayed",
            IncludeItemTypes: "Movie,Episode"
          }
        });

        stats.playedItemsCount = Number(playedResponse?.data?.TotalRecordCount || 0);
      } catch (error) {
        // Keep defaults when played-items aggregate is unavailable.
      }

      try {
        const sessionsResponse = await client.get(buildEndpoint("Sessions"));
        const sessions = Array.isArray(sessionsResponse?.data) ? sessionsResponse.data : [];
        stats.activeSessions = sessions.length;
      } catch (error) {
        // Keep defaults when session endpoint is unavailable.
      }

      return stats;
    },
    searchItems: async ({ query, mediaType = "all", limit = 8 }) => {
      const client = getClient();
      const userId = await resolveUserId(client);
      const normalizedLimit = Math.max(1, Math.min(20, Number(limit || 8)));
      const normalizedType = String(mediaType || "all").toLowerCase();
      const searchTerm = String(query || "").trim();
      if (!searchTerm) {
        return [];
      }
      const includeTypeMap = {
        all: "Movie,Series,Episode,Audio,MusicAlbum,MusicVideo,Video",
        movie: "Movie",
        series: "Series",
        tv: "Series",
        episode: "Episode",
        audio: "Audio,MusicAlbum,MusicVideo"
      };

      const commonParams = {
        SearchTerm: searchTerm,
        Recursive: true,
        Limit: normalizedLimit,
        IncludeItemTypes: includeTypeMap[normalizedType] || includeTypeMap.all,
        Fields: "ProductionYear,RunTimeTicks,SeriesName,IndexNumber,ParentIndexNumber"
      };

      async function requestItems(pathname, params) {
        try {
          const response = await client.get(buildEndpoint(pathname), { params });
          const rows = Array.isArray(response?.data?.Items) ? response.data.Items : [];
          return rows;
        } catch {
          return [];
        }
      }

      // Primary: user-scoped query
      let rows = await requestItems(`Users/${userId}/Items`, commonParams);

      // Fallback: global Items endpoint scoped by UserId query parameter
      if (rows.length === 0) {
        rows = await requestItems("Items", {
          ...commonParams,
          UserId: userId
        });
      }

      // Final fallback: global search without UserId for reverse-proxy edge cases
      if (rows.length === 0) {
        rows = await requestItems("Items", commonParams);
      }

      return rows.map(normalizeItem);
    },
    getNowPlaying: async (limit = 8) => {
      const client = getClient();
      const normalizedLimit = Math.max(1, Math.min(20, Number(limit || 8)));

      const response = await client.get(buildEndpoint("Sessions"), {
        params: {
          ActiveWithinSeconds: 3600
        }
      });

      const sessions = Array.isArray(response?.data) ? response.data : [];
      const nowPlaying = sessions
        .filter((session) => session?.NowPlayingItem)
        .map((session) => {
          const item = normalizeItem(session.NowPlayingItem);
          const percent = computePlaybackPercent(
            session?.PlayState?.PositionTicks,
            session?.NowPlayingItem?.RunTimeTicks
          );

          return {
            ...item,
            playbackPercent: percent,
            playMethod: session?.PlayState?.PlayMethod || "Unknown",
            paused: Boolean(session?.PlayState?.IsPaused)
          };
        })
        .slice(0, normalizedLimit);

      return {
        activeSessions: sessions.length,
        nowPlaying
      };
    },
    getLibrarySections: async () => {
      const client = getClient();

      const response = await client.get(buildEndpoint("Library/VirtualFolders"));
      const folders = Array.isArray(response?.data) ? response.data : [];

      return folders.map((folder) => ({
        name: folder?.Name || "Unnamed",
        collectionType: folder?.CollectionType || "mixed",
        pathCount: Array.isArray(folder?.Locations) ? folder.Locations.length : 0
      }));
    },
    ticksToDuration
  };
}

module.exports = { createJellyfinClient };
