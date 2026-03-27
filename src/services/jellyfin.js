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
    if (!base || !config.apiKey) {
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
    return [
      `MediaBrowser Token=\"${escapeHeaderValue(config.apiKey)}\"`,
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
    const base = normalizedBaseUrl();
    ensureConfigured();
    const httpsAgent =
      config.allowInsecureTls && base.startsWith("https://")
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    return axios.create({
      headers: {
        Authorization: buildAuthorizationHeader(),
        "X-Emby-Token": config.apiKey,
        "Content-Type": "application/json"
      },
      timeout: 15000,
      httpsAgent
    });
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

  return {
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
    }
  };
}

module.exports = { createJellyfinClient };
