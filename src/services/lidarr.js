const axios = require("axios");
const https = require("https");

const MONITOR_OPTIONS = new Set(["all", "future", "missing", "existing", "first", "latest", "none"]);
const MONITOR_NEW_ITEMS_OPTIONS = new Set(["all", "new", "none"]);

function createLidarrClient(config) {
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
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      query.set(key, String(value));
    }

    const rendered = query.toString();
    return rendered ? `${base}?${rendered}` : base;
  }

  function ensureConfigured() {
    const base = normalizedBaseUrl();
    if (!base || !config.apiKey) {
      throw new Error("Lidarr is not configured yet. Set LIDARR_URL and LIDARR_API_KEY.");
    }

    try {
      const parsed = new URL(base);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch (error) {
      throw new Error("Invalid LIDARR_URL. Use a full URL such as https://media.example.com/lidarr");
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

  function asPositiveInteger(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
  }

  function asBoolean(value, fallback = false) {
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = String(value ?? "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  function normalizeMonitor(value, fallback = "all") {
    const normalized = String(value || "").trim().toLowerCase();
    return MONITOR_OPTIONS.has(normalized) ? normalized : fallback;
  }

  function normalizeMonitorNewItems(value, fallback = "all") {
    const normalized = String(value || "").trim().toLowerCase();
    return MONITOR_NEW_ITEMS_OPTIONS.has(normalized) ? normalized : fallback;
  }

  function normalizeQuery(query) {
    const raw = String(query || "").trim();
    const mbidMatch = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    return mbidMatch ? mbidMatch[0] : raw;
  }

  function normalizeArtistResult(row) {
    const artist = row || {};
    const image = Array.isArray(artist.images)
      ? artist.images.find((entry) => entry?.remoteUrl || entry?.url)
      : null;

    return {
      foreignArtistId: String(artist.foreignArtistId || artist.mbId || "").trim(),
      artistName: String(artist.artistName || artist.sortName || artist.artist || "Unknown artist").trim(),
      artistType: String(artist.artistType || "Artist").trim(),
      status: String(artist.status || "").trim(),
      overview: String(artist.overview || "").trim(),
      disambiguation: String(artist.disambiguation || "").trim(),
      monitored: Boolean(artist.monitored),
      inLibrary: Boolean(artist.id),
      remotePoster: String(artist.remotePoster || image?.remoteUrl || image?.url || "").trim(),
      genres: Array.isArray(artist.genres) ? artist.genres : [],
      payload: artist
    };
  }

  function getDefaults() {
    return {
      rootFolderPath: String(config.rootFolderPath || "").trim(),
      qualityProfileId: asPositiveInteger(config.qualityProfileId, 0),
      metadataProfileId: asPositiveInteger(config.metadataProfileId, 0),
      monitor: normalizeMonitor(config.monitor, "all"),
      monitorNewItems: normalizeMonitorNewItems(config.monitorNewItems, "all"),
      monitored: asBoolean(config.monitored, true),
      searchForMissingAlbums: asBoolean(config.searchForMissingAlbums, true)
    };
  }

  async function getRootFolders() {
    const client = getClient();
    const response = await client.get(buildEndpoint("api/v1/rootfolder"));
    return Array.isArray(response?.data) ? response.data : [];
  }

  async function getQualityProfiles() {
    const client = getClient();
    const response = await client.get(buildEndpoint("api/v1/qualityprofile"));
    return Array.isArray(response?.data) ? response.data : [];
  }

  async function getMetadataProfiles() {
    const client = getClient();
    const response = await client.get(buildEndpoint("api/v1/metadataprofile"));
    return Array.isArray(response?.data) ? response.data : [];
  }

  return {
    getDefaults,
    getOptions: async () => {
      const [rootFolders, qualityProfiles, metadataProfiles] = await Promise.all([
        getRootFolders(),
        getQualityProfiles(),
        getMetadataProfiles()
      ]);

      return {
        rootFolders: rootFolders.map((item) => ({
          id: asPositiveInteger(item.id, 0),
          path: String(item.path || "").trim(),
          name: String(item.name || item.path || "").trim(),
          accessible: item.accessible !== false
        })),
        qualityProfiles: qualityProfiles.map((item) => ({
          id: asPositiveInteger(item.id, 0),
          name: String(item.name || `Profile ${item.id || ""}`).trim()
        })),
        metadataProfiles: metadataProfiles.map((item) => ({
          id: asPositiveInteger(item.id, 0),
          name: String(item.name || `Profile ${item.id || ""}`).trim()
        })),
        defaults: getDefaults()
      };
    },
    searchArtists: async (query) => {
      const client = getClient();
      const term = normalizeQuery(query);
      if (!term) {
        return [];
      }

      const response = await client.get(withQuery("api/v1/artist/lookup", { term }));
      const rows = Array.isArray(response?.data) ? response.data : [];
      const seen = new Set();

      return rows
        .map(normalizeArtistResult)
        .filter((item) => {
          if (!item.foreignArtistId || seen.has(item.foreignArtistId)) {
            return false;
          }
          seen.add(item.foreignArtistId);
          return true;
        });
    },
    addArtist: async ({ artist, options = {} }) => {
      const client = getClient();
      if (!artist || typeof artist !== "object") {
        throw new Error("Artist payload is required.");
      }

      const defaults = getDefaults();
      const rootFolderPath = String(options.rootFolderPath || defaults.rootFolderPath || "").trim();
      const qualityProfileId = asPositiveInteger(options.qualityProfileId, defaults.qualityProfileId);
      const metadataProfileId = asPositiveInteger(options.metadataProfileId, defaults.metadataProfileId);

      if (!rootFolderPath) {
        throw new Error("Lidarr root folder is required.");
      }
      if (!qualityProfileId) {
        throw new Error("Lidarr quality profile is required.");
      }
      if (!metadataProfileId) {
        throw new Error("Lidarr metadata profile is required.");
      }

      const payload = {
        ...artist,
        monitored: asBoolean(options.monitored, defaults.monitored),
        monitorNewItems: normalizeMonitorNewItems(options.monitorNewItems, defaults.monitorNewItems),
        qualityProfileId,
        metadataProfileId,
        rootFolderPath,
        addOptions: {
          ...(artist.addOptions || {}),
          monitor: normalizeMonitor(options.monitor, defaults.monitor),
          searchForMissingAlbums: asBoolean(options.searchForMissingAlbums, defaults.searchForMissingAlbums)
        }
      };

      if (!payload.artistType) {
        payload.artistType = "Artist";
      }

      const response = await client.post(buildEndpoint("api/v1/artist"), payload);
      return response?.data || {};
    }
  };
}

module.exports = { createLidarrClient };