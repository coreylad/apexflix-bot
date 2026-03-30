/* ============================================================
   ApexFlix  Media Server Dashboard    app.js
   ============================================================ */

/*  helpers  */
async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** type: 'ok' | 'err' | 'info' */
function setMsg(id, text, type = "ok") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg" + (text ? ` ${type}` : "");
}

function clearMsg(id) {
  setMsg(id, "");
}

function fmtDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/*  status badge helpers  */
const STATUS_LABELS = {
  0: ["badge-muted", "Unknown"],
  1: ["badge-blue", "Pending"],
  2: ["badge-blue", "Approved"],
  3: ["badge-red", "Declined"],
  4: ["badge-green", "Available"],
  5: ["badge-orange", "Processing"],
  6: ["badge-teal", "Partial"],
  7: ["badge-red", "Failed"],
  8: ["badge-green", "Completed"]
};

function statusBadge(code) {
  const numeric = Number(code);
  const [cls, label] = STATUS_LABELS[numeric] || ["badge-muted", "Unknown"];
  return `<span class="badge ${cls}">${label}</span>`;
}

const ISSUE_TYPE_LABELS = { 1: "Video", 2: "Audio", 3: "Subtitle", 4: "Other" };
const ISSUE_STATUS_LABELS = {
  1: ["badge-orange", "Open"],
  2: ["badge-green", "Resolved"]
};

function issueTypeBadge(code) {
  return `<span class="badge badge-blue">${ISSUE_TYPE_LABELS[Number(code)] || "Unknown"}</span>`;
}

function issueStatusBadge(code) {
  const [cls, label] = ISSUE_STATUS_LABELS[Number(code)] || ["badge-muted", "Unknown"];
  return `<span class="badge ${cls}">${label}</span>`;
}

const LIDARR_MONITOR_OPTIONS = [
  ["all", "All"],
  ["future", "Future"],
  ["missing", "Missing"],
  ["existing", "Existing"],
  ["first", "First"],
  ["latest", "Latest"],
  ["none", "None"]
];

const LIDARR_MONITOR_NEW_ITEMS_OPTIONS = [
  ["all", "All"],
  ["new", "New Only"],
  ["none", "None"]
];

const BOOLEAN_OPTIONS = [
  ["true", "True"],
  ["false", "False"]
];

let envAllowedKeysCache = [];
let envValuesCache = {};
let lidarrEnvOptionsCache = null;
let jellyfinEnvDefaultsCache = null;

/*  env form renderer  */
function renderEnvForm(targetId, allowedKeys, values) {
  const form = document.getElementById(targetId);
  if (!form) return;

  const groups = [
    { title: "Discord", keys: ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"] },
    {
      title: "Overseerr",
      keys: [
        "OVERSEERR_URL",
        "OVERSEERR_BASE_URL",
        "OVERSEERR_API_KEY",
        "OVERSEERR_DEFAULT_USER_ID",
        "OVERSEERR_ALLOW_INSECURE_TLS"
      ]
    },
    {
      title: "TMDB",
      keys: ["TMDB_API_READ_TOKEN", "TMDB_BASE_URL"]
    },
    {
      title: "Lidarr",
      keys: [
        "LIDARR_URL",
        "LIDARR_BASE_URL",
        "LIDARR_API_KEY",
        "LIDARR_ALLOW_INSECURE_TLS",
        "LIDARR_ROOT_FOLDER",
        "LIDARR_QUALITY_PROFILE_ID",
        "LIDARR_METADATA_PROFILE_ID",
        "LIDARR_MONITOR",
        "LIDARR_MONITOR_NEW_ITEMS",
        "LIDARR_MONITORED",
        "LIDARR_SEARCH_FOR_MISSING_ALBUMS"
      ]
    },
    {
      title: "Jellyfin",
      keys: [
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
        "JELLYFIN_LOG_DIR"
      ]
    },
    {
      title: "App & Reverse Proxy",
      keys: ["PORT", "REQUEST_STATUS_POLL_SECONDS", "LOG_LEVEL", "TRUST_PROXY", "APP_BASE_PATH"]
    }
  ];

  const seen = new Set(groups.flatMap((g) => g.keys));
  const extras = (allowedKeys || []).filter((k) => !seen.has(k));
  if (extras.length) groups.push({ title: "Other", keys: extras });

  const allowedSet = new Set(allowedKeys || []);

  function renderSelectField(key, label, value, options) {
    const renderedOptions = (options || [])
      .map(([optionValue, optionLabel]) => {
        const selected = String(optionValue) === String(value ?? "") ? " selected" : "";
        return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(optionLabel)}</option>`;
      })
      .join("");
    return `<label>${label}<select name="${key}">${renderedOptions}</select></label>`;
  }

  function renderEnvField(key, rawValue) {
    const safeVal = escapeHtml(rawValue || "");
    const label = key.endsWith("BASE_URL") ? `${key} (legacy)` : key;
    const lidarrOptions = targetId === "envForm" ? lidarrEnvOptionsCache : null;

    if (targetId === "envForm") {
      if (key === "LIDARR_ALLOW_INSECURE_TLS" || key === "LIDARR_MONITORED" || key === "LIDARR_SEARCH_FOR_MISSING_ALBUMS") {
        return renderSelectField(key, label, String(rawValue || "false"), BOOLEAN_OPTIONS);
      }

      if (key === "LIDARR_MONITOR") {
        return renderSelectField(key, label, String(rawValue || "all"), LIDARR_MONITOR_OPTIONS);
      }

      if (key === "LIDARR_MONITOR_NEW_ITEMS") {
        return renderSelectField(key, label, String(rawValue || "all"), LIDARR_MONITOR_NEW_ITEMS_OPTIONS);
      }

      if (key === "JELLYFIN_ALLOW_INSECURE_TLS") {
        return renderSelectField(key, label, String(rawValue || "false"), BOOLEAN_OPTIONS);
      }

      if (lidarrOptions?.rootFolders?.length && key === "LIDARR_ROOT_FOLDER") {
        return renderSelectField(
          key,
          label,
          rawValue,
          lidarrOptions.rootFolders.map((item) => [item.path, item.name ? `${item.name} (${item.path})` : item.path])
        );
      }

      if (lidarrOptions?.qualityProfiles?.length && key === "LIDARR_QUALITY_PROFILE_ID") {
        return renderSelectField(
          key,
          label,
          String(rawValue || ""),
          lidarrOptions.qualityProfiles.map((item) => [String(item.id), item.name])
        );
      }

      if (lidarrOptions?.metadataProfiles?.length && key === "LIDARR_METADATA_PROFILE_ID") {
        return renderSelectField(
          key,
          label,
          String(rawValue || ""),
          lidarrOptions.metadataProfiles.map((item) => [String(item.id), item.name])
        );
      }
    }

    if (key === "JELLYFIN_API_KEY" || key === "TMDB_API_READ_TOKEN") {
      return `<label>${label}<input name="${key}" type="password" autocomplete="off" value="${safeVal}" /></label>`;
    }

    return `<label>${label}<input name="${key}" type="text" value="${safeVal}" /></label>`;
  }

  form.innerHTML = groups
    .map((group) => {
      const keys = group.keys.filter((k) => allowedSet.has(k));
      if (!keys.length) return "";
      const fields = keys
        .map((key) => renderEnvField(key, values?.[key] || ""))
        .join("");

      let appActions = "";
      if (targetId === "envForm" && group.title === "Overseerr") {
        appActions = `<div class="btn-row" style="margin-top:0.9rem"><button type="button" class="btn-secondary" id="testOverseerrEnvBtn">Test Overseerr Connection</button><div id="testOverseerrEnvStatus" class="msg" style="margin:0;flex:1 1 280px"></div></div>`;
      }
      if (targetId === "envForm" && group.title === "TMDB") {
        appActions = `<div class="btn-row" style="margin-top:0.9rem"><button type="button" class="btn-secondary" id="testTmdbEnvBtn">Test TMDB Connection</button><div id="testTmdbEnvStatus" class="msg" style="margin:0;flex:1 1 280px"></div></div>`;
      }
      if (targetId === "envForm" && group.title === "Jellyfin") {
        appActions = `<div class="btn-row" style="margin-top:0.9rem"><button type="button" class="btn-secondary" id="testJellyfinEnvBtn">Test Jellyfin Connection</button><button type="button" class="btn-secondary" id="loadJellyfinDefaultsBtn">Load Jellyfin Defaults</button><div id="testJellyfinEnvStatus" class="msg" style="margin:0;flex:1 1 280px"></div></div>`;
      }
      if (targetId === "envForm" && group.title === "Lidarr") {
        appActions = `<div class="btn-row" style="margin-top:0.9rem"><button type="button" class="btn-secondary" id="testLidarrEnvBtn">Test Lidarr Connection</button><div id="testLidarrEnvStatus" class="msg" style="margin:0;flex:1 1 280px"></div></div>`;
      }

      return `<div class="settings-section"><div class="settings-title">${group.title}</div><div class="settings-grid">${fields}</div>${appActions}</div>`;
    })
    .join("");
}

function setAppTestButtonState(app, { busy = false, text = "", type = "info" } = {}) {
  const key = String(app || "").toLowerCase();
  const map = {
    overseerr: { buttonId: "testOverseerrEnvBtn", statusId: "testOverseerrEnvStatus", label: "Test Overseerr Connection" },
    tmdb: { buttonId: "testTmdbEnvBtn", statusId: "testTmdbEnvStatus", label: "Test TMDB Connection" },
    jellyfin: { buttonId: "testJellyfinEnvBtn", statusId: "testJellyfinEnvStatus", label: "Test Jellyfin Connection" },
    lidarr: { buttonId: "testLidarrEnvBtn", statusId: "testLidarrEnvStatus", label: "Test Lidarr Connection" }
  };

  const entry = map[key];
  if (!entry) return;

  const button = document.getElementById(entry.buttonId);
  const status = document.getElementById(entry.statusId);
  if (button) {
    button.disabled = busy;
    button.textContent = busy ? "Testing..." : entry.label;
  }
  if (status) {
    setMsg(entry.statusId, text, type);
  }
}

function setLidarrTestButtonState({ busy = false, text = "", type = "info" } = {}) {
  setAppTestButtonState("lidarr", { busy, text, type });
}

function collectFormValues(formId) {
  const form = document.getElementById(formId);
  if (!form) return {};

  const values = {};
  for (const el of form.querySelectorAll("input[name], select[name], textarea[name]")) {
    values[el.name] = el.value;
  }
  return values;
}

/*  tab router  */
const TAB_TITLES = {
  tabDashboard: "Dashboard",
  tabRequests: "Requests",
  tabJellyfin: "Jellyfin",
  tabReports: "Reports",
  tabBotConfig: "Bot Configuration",
  tabChannels: "Channels & Roles",
  tabEnvironment: "Environment",
  tabDonations: "Donations",
  tabLogs: "Logs",
  tabJellyfinLogs: "Jellyfin Logs",
  tabSystem: "System"
};

let activeTab = "tabDashboard";
let logEventSource = null;
let logUnreadCount = 0;
let jellyfinLogsAutoRefreshTimer = null;
let lidarrArtistResults = [];
let discoverMetaCache = null;
let discoverResultsCache = [];
let jellyfinUserPresetCache = [];

function switchTab(id) {
  if (activeTab === id) return;
  activeTab = id;

  document.querySelectorAll(".nav-btn[data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === id)
  );
  document.querySelectorAll(".tab-pane").forEach((p) =>
    p.classList.toggle("active", p.id === id)
  );

  const titleEl = document.getElementById("topBarTitle");
  if (titleEl) titleEl.textContent = TAB_TITLES[id] || id;

  onTabActivated(id);
}

function onTabActivated(id) {
  switch (id) {
    case "tabDashboard":
      refreshDashboard();
      break;
    case "tabRequests":
      loadRequestsTable();
      loadDiscoverMeta();
      loadDiscoverResults();
      loadLidarrOptions();
      loadLidarrLibraryStats();
      loadLidarrArtists();
      loadLidarrGenres();
      break;
    case "tabJellyfin":
      loadJellyfinStats();
      loadJellyfinNowPlaying();
      loadJellyfinLibraries();
      loadJellyfinUsers();
      break;
    case "tabReports":
      loadReports();
      break;
    case "tabBotConfig":
      loadBotConfig();
      break;
    case "tabChannels":
      loadChannels();
      break;
    case "tabEnvironment":
      loadEnvSettings();
      break;
    case "tabDonations":
      loadDonationSettings();
      break;
    case "tabLogs":
      // Load recent logs when user views the Logs tab
      try { loadLogs(); } catch (e) { /* ignore */ }
      logUnreadCount = 0;
      const _badge = document.getElementById("badgeLogs");
      if (_badge) _badge.textContent = "";
      break;
    case "tabJellyfinLogs":
      loadJellyfinLogFiles();
      break;
    case "tabSystem":
      loadHealth();
      break;
    default:
      break;
  }
}

/*  status pills  */
async function updateStatusPills() {
  const pill = (id, online) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `status-pill ${online ? "online" : "offline"}`;
  };

  // Bot  server is responding = online
  pill("pillBot", true);

  try {
    await fetchJson("api/jellyfin/stats");
    pill("pillJellyfin", true);
  } catch {
    pill("pillJellyfin", false);
  }

  try {
    await fetchJson("api/requests/recent?limit=1");
    pill("pillOverseerr", true);
  } catch {
    pill("pillOverseerr", false);
  }

  try {
    await fetchJson("api/lidarr/stats");
    pill("pillLidarr", true);
  } catch {
    pill("pillLidarr", false);
  }
}

/*  dashboard  */
async function refreshDashboard() {
  loadDashboardStats();
  loadDashboardNowPlaying();
  loadDashboardLatest();
  loadDashboardRequests();
}

async function loadDashboardStats() {
  try {
    const data = await fetchJson("api/jellyfin/stats");
    document.getElementById("statMovies").textContent = data.movieCount ?? "";
    document.getElementById("statSeries").textContent = data.seriesCount ?? "";
    document.getElementById("statEpisodes").textContent = data.episodeCount ?? "";
    document.getElementById("statMusic").textContent = data.songCount ?? "";
    document.getElementById("statStreams").textContent = data.activeSessions ?? "";
  } catch {
    ["statMovies", "statSeries", "statEpisodes", "statMusic", "statStreams"].forEach(
      (id) => (document.getElementById(id).textContent = "")
    );
  }
}

function renderNowPlayingHtml(nowPlaying) {
  if (!nowPlaying?.length) {
    return `<div class="empty-state"><div class="empty-icon"></div>No active playback</div>`;
  }
  return nowPlaying
    .map((s) => {
      const pct = Math.round(Number(s.playbackPercent || 0));
      const pauseLabel = s.paused
        ? `<span class="badge badge-orange">Paused</span>`
        : `<span class="badge badge-green">Playing</span>`;
      return `
        <div class="session-row">
          <div class="session-info">
            <span class="session-title">${escapeHtml(s.name || "Unknown")}</span>
            ${s.type ? `<span class="badge badge-blue">${escapeHtml(s.type)}</span>` : ""}
            ${pauseLabel}
            <span class="badge badge-muted">${escapeHtml(s.playMethod || "")}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="session-pct">${pct}%</div>
        </div>`;
    })
    .join("");
}

async function loadDashboardNowPlaying() {
  const el = document.getElementById("dashNowPlaying");
  if (!el) return;
  try {
    const data = await fetchJson("api/jellyfin/now-playing");
    el.innerHTML = renderNowPlayingHtml(data.nowPlaying);
  } catch {
    el.innerHTML = `<div class="empty-state">Could not load sessions</div>`;
  }
}

async function loadDashboardLatest() {
  const tbody = document.getElementById("dashLatest");
  if (!tbody) return;
  try {
    const data = await fetchJson("api/jellyfin/latest?limit=8");
    if (!data.items?.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No items</td></tr>`;
      return;
    }
    tbody.innerHTML = data.items
      .map(
        (item) => `<tr>
          <td>${escapeHtml(item.name || "")}</td>
          <td><span class="badge badge-blue">${escapeHtml(item.type || "")}</span></td>
          <td>${escapeHtml(String(item.productionYear || ""))}</td>
        </tr>`
      )
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Failed to load</td></tr>`;
  }
}

async function loadDashboardRequests() {
  const tbody = document.getElementById("dashRequests");
  const badge = document.getElementById("badgeRequests");
  if (!tbody) return;
  try {
    const data = await fetchJson("api/requests/recent?limit=8");
    const rows = data.rows || [];
    if (badge) badge.textContent = rows.length ? String(rows.length) : "";
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No requests yet</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => {
          let statusDisplay = statusBadge(r.status ?? r.status_code);
          if (r.media_type === "music" && r.lidarr_status) {
            const monitored = r.lidarr_monitored ? `<span class="text-sm muted-text">(monitored)</span>` : "";
            statusDisplay = `<span class="badge badge-orange">${escapeHtml(r.lidarr_status)}</span> ${monitored}`;
          }
          return `<tr>
            <td class="mono">#${r.request_id}</td>
            <td>${escapeHtml(r.title || "")}</td>
            <td><span class="badge badge-purple">${escapeHtml(r.media_type || "")}</span></td>
            <td>${statusDisplay}</td>
            <td class="muted-text">${fmtDate(r.updated_at)}</td>
          </tr>`;
        }
      )
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load</td></tr>`;
  }
}

/*  requests tab  */
async function loadRequestsTable() {
  const tbody = document.getElementById("reqTableBody");
  if (!tbody) return;
  try {
    const data = await fetchJson("api/requests/recent?limit=50");
    const rows = data.rows || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No requests found</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => {
          let statusDisplay = statusBadge(r.status ?? r.status_code);
          if (r.media_type === "music" && r.lidarr_status) {
            const monitored = r.lidarr_monitored ? `<span class="text-sm muted-text">(monitored)</span>` : "";
            statusDisplay = `<span class="badge badge-orange">${escapeHtml(r.lidarr_status)}</span> ${monitored}`;
          }
          return `<tr>
            <td class="mono">#${r.request_id}</td>
            <td>${escapeHtml(r.title || "")}</td>
            <td><span class="badge badge-purple">${escapeHtml(r.media_type || "")}</span></td>
            <td>${statusDisplay}</td>
          </tr>`;
        }
      )
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load</td></tr>`;
  }
}

function wireRequestForm() {
  const form = document.getElementById("requestForm");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";

  // Toggle season field visibility based on media type
  const mediaTypeSelect = form.querySelector("select[name='mediaType']");
  const seasonLabel = document.getElementById("seasonLabel");
  
  function updateSeasonVisibility() {
    const mediaType = mediaTypeSelect.value;
    seasonLabel.style.display = mediaType === "tv" ? "block" : "none";
  }
  
  if (mediaTypeSelect) {
    mediaTypeSelect.addEventListener("change", updateSeasonVisibility);
    updateSeasonVisibility(); // Initial state
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("requestMsg");
    const fd = new FormData(form);
    const mediaType = String(fd.get("mediaType") || "movie");
    const rawInput = String(fd.get("mediaId") || "").trim();
    const seasonInput = String(fd.get("season") || "").trim();

    const payload = { mediaType };

    if (mediaType === "music") {
      if (!rawInput) {
        setMsg("requestMsg", "Enter an artist name, MBID, or MusicBrainz URL.", "err");
        return;
      }
      payload.mediaQuery = rawInput;
    } else {
      // Extract numeric TMDB ID from URL or plain number
      const match = rawInput.match(/(\d+)\/?$/);
      const mediaId = match ? Number(match[1]) : NaN;

      if (!mediaId || !Number.isInteger(mediaId) || mediaId <= 0) {
        setMsg("requestMsg", "Enter a valid TMDB ID or TMDB URL.", "err");
        return;
      }

      payload.mediaId = mediaId;
      if (mediaType === "tv" && seasonInput) {
        payload.season = seasonInput;
      }
    }

    try {
      const data = await fetchJson("api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      setMsg("requestMsg", `Submitted "${data.title || "request"}"  ${data.statusText || "pending"}`, "ok");
      form.reset();
      loadRequestsTable();
      loadLidarrLibraryStats();
    } catch (err) {
      setMsg("requestMsg", err.message, "err");
    }
  });
}

function setRequestFormValues({ mediaType, mediaId, season = "" }) {
  const form = document.getElementById("requestForm");
  if (!form) return;
  const mediaTypeSelect = form.querySelector("select[name='mediaType']");
  const mediaIdInput = form.querySelector("input[name='mediaId']");
  const seasonInput = form.querySelector("input[name='season']");
  const seasonLabel = document.getElementById("seasonLabel");

  if (mediaTypeSelect) mediaTypeSelect.value = mediaType || "movie";
  if (mediaIdInput) mediaIdInput.value = mediaId ? String(mediaId) : "";
  if (seasonInput) seasonInput.value = season || "";
  if (seasonLabel) seasonLabel.style.display = mediaType === "tv" ? "block" : "none";
}

function populateDiscoverCategoryOptions() {
  const mediaType = document.getElementById("discoverMediaType")?.value || "movie";
  const select = document.getElementById("discoverCategory");
  if (!select || !discoverMetaCache?.categories) return;

  const categories = discoverMetaCache.categories[mediaType] || [];
  const current = String(select.value || "");
  select.innerHTML = categories
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value.replace(/_/g, " "))}</option>`)
    .join("");
  select.value = categories.includes(current) ? current : categories[0] || "popular";
}

function populateDiscoverGenreOptions() {
  const mediaType = document.getElementById("discoverMediaType")?.value || "movie";
  const select = document.getElementById("discoverGenre");
  if (!select) return;

  const genres = discoverMetaCache?.genres?.[mediaType] || [];
  const current = String(select.value || "");
  select.innerHTML = [`<option value="">All Genres</option>`]
    .concat(genres.map((genre) => `<option value="${escapeHtml(String(genre.id || ""))}">${escapeHtml(genre.name || "Unknown")}</option>`))
    .join("");
  select.value = genres.some((genre) => String(genre.id) === current) ? current : "";
}

async function loadDiscoverMeta() {
  if (discoverMetaCache) {
    populateDiscoverCategoryOptions();
    populateDiscoverGenreOptions();
    return;
  }

  try {
    const data = await fetchJson("api/discover/meta");
    discoverMetaCache = data;
    populateDiscoverCategoryOptions();
    populateDiscoverGenreOptions();
  } catch (err) {
    setMsg("discoverMsg", err.message, "err");
  }
}

function renderDiscoverResults(items) {
  const box = document.getElementById("discoverResults");
  if (!box) return;

  if (!items.length) {
    box.innerHTML = `<div class="empty-state col-span-2">No TMDB results found.</div>`;
    return;
  }

  box.innerHTML = items
    .map((item, index) => {
      const overview = String(item.overview || "").trim();
      const release = item.releaseDate ? item.releaseDate.slice(0, 4) : "TBA";
      const rating = item.voteAverage ? item.voteAverage.toFixed(1) : "n/a";
      const poster = item.posterPath ? `https://image.tmdb.org/t/p/w300${item.posterPath}` : "";
      return `
        <div class="card">
          <div style="display:grid;grid-template-columns:${poster ? "92px 1fr" : "1fr"};gap:1rem;align-items:start">
            ${poster ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(item.title || "Poster")}" style="width:92px;height:138px;object-fit:cover;border-radius:14px;background:rgba(255,255,255,0.05)" />` : ""}
            <div style="display:grid;gap:0.65rem">
              <div>
                <div class="card-title" style="font-size:1rem">${escapeHtml(item.title || "Unknown title")}</div>
                <div class="muted-text">${escapeHtml(item.mediaType || "movie")} • ${escapeHtml(release)} • Rating ${escapeHtml(String(rating))} • TMDB ${escapeHtml(String(item.id || ""))}</div>
              </div>
              <div class="text-sm muted-text">${escapeHtml(overview || "No overview available.")}</div>
              <div class="btn-row">
                <button type="button" class="btn-secondary btn-sm discover-use-btn" data-index="${index}">Use In Request Form</button>
              </div>
            </div>
          </div>
        </div>`;
    })
    .join("");
}

async function loadDiscoverResults() {
  const mediaType = document.getElementById("discoverMediaType")?.value || "movie";
  const category = document.getElementById("discoverCategory")?.value || "popular";
  const genre = document.getElementById("discoverGenre")?.value || "";
  const query = String(document.getElementById("discoverQuery")?.value || "").trim();
  const page = Number(document.getElementById("discoverPage")?.value || 1) || 1;

  setMsg("discoverMsg", "Loading TMDB results...", "info");
  try {
    const qs = new URLSearchParams({
      mediaType,
      category,
      page: String(page)
    });
    if (genre) qs.set("genre", genre);
    if (query) qs.set("query", query);

    const data = await fetchJson(`api/discover?${qs.toString()}`);
    discoverResultsCache = data.results || [];
    renderDiscoverResults(discoverResultsCache);
    setMsg(
      "discoverMsg",
      `Loaded ${discoverResultsCache.length} result${discoverResultsCache.length === 1 ? "" : "s"} from TMDB page ${data.page || page}.`,
      "ok"
    );
  } catch (err) {
    discoverResultsCache = [];
    renderDiscoverResults([]);
    setMsg("discoverMsg", err.message, "err");
  }
}

function wireDiscoverForm() {
  const form = document.getElementById("discoverForm");
  if (form && !form.dataset.wired) {
    form.dataset.wired = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await loadDiscoverResults();
    });
  }

  const mediaType = document.getElementById("discoverMediaType");
  if (mediaType && !mediaType.dataset.wired) {
    mediaType.dataset.wired = "1";
    mediaType.addEventListener("change", () => {
      populateDiscoverCategoryOptions();
      populateDiscoverGenreOptions();
    });
  }

  const results = document.getElementById("discoverResults");
  if (results && !results.dataset.wired) {
    results.dataset.wired = "1";
    results.addEventListener("click", (e) => {
      const button = e.target.closest(".discover-use-btn");
      if (!button) return;
      const index = Number(button.dataset.index);
      const item = discoverResultsCache[index];
      if (!item) return;
      setRequestFormValues({ mediaType: item.mediaType || "movie", mediaId: item.id || "", season: item.mediaType === "tv" ? "latest" : "" });
      setMsg(
        "requestMsg",
        item.mediaType === "tv"
          ? `Loaded ${item.title} into the request form. Adjust the season if needed, then submit.`
          : `Loaded ${item.title} into the request form. Submit when ready.`,
        "info"
      );
      document.getElementById("requestForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function renderSelectOptions(elementId, items, selectedValue, valueKey, labelKey) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const rows = Array.isArray(items) ? items : [];
  el.innerHTML = rows
    .map((item) => {
      const value = String(item?.[valueKey] ?? "");
      const label = String(item?.[labelKey] ?? value);
      const selected = value === String(selectedValue ?? "") ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

async function loadLidarrOptions() {
  try {
    const data = await fetchJson("api/lidarr/options");
    applyLidarrOptions(data);
  } catch (err) {
    const hint = document.getElementById("lidarrOptionsHint");
    if (hint) hint.textContent = "";
    setMsg("lidarrMsg", err.message, "err");
  }
}

async function loadLidarrLibraryStats() {
  try {
    const data = await fetchJson("api/lidarr/stats");
    const map = [
      ["lidarrArtistsCount", data.artistCount],
      ["lidarrMonitoredCount", data.monitoredArtistCount],
      ["lidarrAlbumsCount", data.albumCount],
      ["lidarrRootFoldersCount", data.rootFolderCount]
    ];

    for (const [id, value] of map) {
      const el = document.getElementById(id);
      if (el) el.textContent = value ?? "";
    }
  } catch {
    ["lidarrArtistsCount", "lidarrMonitoredCount", "lidarrAlbumsCount", "lidarrRootFoldersCount"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "";
    });
  }
}

async function loadLidarrArtists() {
  const tbody = document.getElementById("lidarrArtistsBody");
  if (!tbody) return;

  try {
    const data = await fetchJson("api/lidarr/artists?limit=12");
    const artists = data.artists || [];
    if (!artists.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No Lidarr artists found</td></tr>`;
      return;
    }

    tbody.innerHTML = artists
      .map((artist) => {
        const status = artist.monitored
          ? `<span class="badge badge-green">Monitored</span>`
          : `<span class="badge badge-muted">Unmonitored</span>`;
        return `<tr>
          <td>${escapeHtml(artist.artistName || "Unknown artist")}</td>
          <td>${status}</td>
          <td class="muted-text">${Number(artist.albumCount || 0)}</td>
          <td class="muted-text">${fmtDate(artist.added)}</td>
        </tr>`;
      })
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load</td></tr>`;
  }
}

async function loadLidarrGenres() {
  const tbody = document.getElementById("lidarrGenresBody");
  if (!tbody) return;

  try {
    const data = await fetchJson("api/lidarr/genres?limit=10");
    const genres = data.genres || [];
    if (!genres.length) {
      tbody.innerHTML = `<tr><td colspan="2" class="empty-state">No genre data available</td></tr>`;
      return;
    }

    tbody.innerHTML = genres
      .map((row) => `<tr><td>${escapeHtml(row.genre || "Unknown")}</td><td class="muted-text">${Number(row.artistCount || 0)}</td></tr>`)
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="2" class="empty-state">Failed to load</td></tr>`;
  }
}

function applyLidarrOptions(data) {
  const hint = document.getElementById("lidarrOptionsHint");
  const defaults = data.defaults || {};
  const rootFolders = (data.rootFolders || []).map((item) => ({
      path: item.path,
      label: item.name ? `${item.name} (${item.path})` : item.path
    }));
  const qualityProfiles = (data.qualityProfiles || []).map((item) => ({ id: String(item.id), label: item.name }));
  const metadataProfiles = (data.metadataProfiles || []).map((item) => ({ id: String(item.id), label: item.name }));

  renderSelectOptions("lidarrRootFolder", rootFolders, defaults.rootFolderPath, "path", "label");
  renderSelectOptions(
    "lidarrQualityProfile",
    qualityProfiles,
    String(defaults.qualityProfileId || ""),
    "id",
    "label"
  );
  renderSelectOptions(
    "lidarrMetadataProfile",
    metadataProfiles,
    String(defaults.metadataProfileId || ""),
    "id",
    "label"
  );

  const monitor = document.getElementById("lidarrMonitor");
  const monitorNewItems = document.getElementById("lidarrMonitorNewItems");
  const monitored = document.getElementById("lidarrMonitored");
  const searchMissing = document.getElementById("lidarrSearchForMissingAlbums");
  if (monitor) monitor.value = defaults.monitor || "all";
  if (monitorNewItems) monitorNewItems.value = defaults.monitorNewItems || "all";
  if (monitored) monitored.value = String(defaults.monitored !== false);
  if (searchMissing) searchMissing.checked = defaults.searchForMissingAlbums !== false;

  if (hint) {
    hint.textContent = `Loaded ${rootFolders.length} root folders, ${qualityProfiles.length} quality profiles, and ${metadataProfiles.length} metadata profiles from Lidarr.`;
  }
}

function getLidarrRequestOptions() {
  return {
    rootFolderPath: document.getElementById("lidarrRootFolder")?.value || "",
    qualityProfileId: Number(document.getElementById("lidarrQualityProfile")?.value || 0),
    metadataProfileId: Number(document.getElementById("lidarrMetadataProfile")?.value || 0),
    monitor: document.getElementById("lidarrMonitor")?.value || "all",
    monitorNewItems: document.getElementById("lidarrMonitorNewItems")?.value || "all",
    monitored: (document.getElementById("lidarrMonitored")?.value || "true") === "true",
    searchForMissingAlbums: Boolean(document.getElementById("lidarrSearchForMissingAlbums")?.checked)
  };
}

function renderLidarrResults(results) {
  const tbody = document.getElementById("lidarrResultsBody");
  if (!tbody) return;

  if (!results.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No Lidarr artist results found</td></tr>`;
    return;
  }

  tbody.innerHTML = results
    .map((artist, index) => {
      const status = artist.inLibrary
        ? `<span class="badge badge-green">In Library</span>`
        : `<span class="badge badge-blue">Available</span>`;
      const meta = [artist.artistType, artist.status, artist.disambiguation].filter(Boolean).join(" • ");
      const subtitle = meta ? `<div class="muted-text">${escapeHtml(meta)}</div>` : "";
      return `<tr>
        <td>
          <div>${escapeHtml(artist.artistName || "Unknown artist")}</div>
          ${subtitle}
        </td>
        <td>${status}</td>
        <td><button type="button" class="btn-secondary btn-sm lidarr-add-btn" data-index="${index}"${artist.inLibrary ? " disabled" : ""}>Add to Lidarr</button></td>
      </tr>`;
    })
    .join("");
}

async function searchLidarrArtists() {
  const query = String(document.getElementById("lidarrArtistQuery")?.value || "").trim();
  if (!query) {
    setMsg("lidarrMsg", "Enter an artist name or MusicBrainz URL/ID.", "err");
    return;
  }

  setMsg("lidarrMsg", "Searching Lidarr", "info");
  try {
    const qs = new URLSearchParams({ query });
    const data = await fetchJson(`api/lidarr/search?${qs.toString()}`);
    lidarrArtistResults = data.results || [];
    renderLidarrResults(lidarrArtistResults);
    setMsg("lidarrMsg", `Found ${lidarrArtistResults.length} Lidarr artist result${lidarrArtistResults.length === 1 ? "" : "s"}.`, "ok");
  } catch (err) {
    lidarrArtistResults = [];
    renderLidarrResults([]);
    setMsg("lidarrMsg", err.message, "err");
  }
}

async function requestLidarrArtist(index) {
  const artist = lidarrArtistResults[index];
  if (!artist?.payload) {
    setMsg("lidarrMsg", "Selected Lidarr result is no longer available. Search again.", "err");
    return;
  }

  setMsg("lidarrMsg", `Adding ${artist.artistName} to Lidarr`, "info");
  try {
    const data = await fetchJson("api/lidarr/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artist: artist.payload,
        options: getLidarrRequestOptions()
      })
    });
    setMsg("lidarrMsg", data.message || `Added ${data.title || artist.artistName} to Lidarr.`, "ok");
    lidarrArtistResults[index].inLibrary = true;
    renderLidarrResults(lidarrArtistResults);
    loadRequestsTable();
    loadLidarrLibraryStats();
    loadLidarrArtists();
    loadLidarrGenres();
  } catch (err) {
    setMsg("lidarrMsg", err.message, "err");
  }
}

function wireLidarrForm() {
  const form = document.getElementById("lidarrSearchForm");
  if (form && !form.dataset.wired) {
    form.dataset.wired = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await searchLidarrArtists();
    });
  }

  const results = document.getElementById("lidarrResultsBody");
  if (results && !results.dataset.wired) {
    results.dataset.wired = "1";
    results.addEventListener("click", (e) => {
      const btn = e.target.closest(".lidarr-add-btn");
      if (!btn) return;
      e.preventDefault();
      requestLidarrArtist(Number(btn.dataset.index));
    });
  }
}

/*  jellyfin tab  */
async function loadJellyfinStats() {
  try {
    const data = await fetchJson("api/jellyfin/stats");
    document.getElementById("jellyMovies").textContent = data.movieCount ?? "";
    document.getElementById("jellySeries").textContent = data.seriesCount ?? "";
    document.getElementById("jellyEpisodes").textContent = data.episodeCount ?? "";
    document.getElementById("jellySongs").textContent = data.songCount ?? "";
    document.getElementById("jellyPlayed").textContent = data.playedItemsCount ?? "";
    document.getElementById("jellyActive").textContent = data.activeSessions ?? "";
  } catch {
    ["jellyMovies", "jellySeries", "jellyEpisodes", "jellySongs", "jellyPlayed", "jellyActive"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "";
      }
    );
  }
}

async function loadJellyfinNowPlaying() {
  const el = document.getElementById("jellyNowPlaying");
  if (!el) return;
  try {
    const data = await fetchJson("api/jellyfin/now-playing");
    el.innerHTML = renderNowPlayingHtml(data.nowPlaying);
  } catch {
    el.innerHTML = `<div class="empty-state">Could not load sessions</div>`;
  }
}

async function loadJellyfinLibraries() {
  const tbody = document.getElementById("jellyLibsBody");
  if (!tbody) return;
  try {
    const data = await fetchJson("api/jellyfin/libraries");
    const libs = data.libraries || [];
    if (!libs.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No libraries found</td></tr>`;
      return;
    }
    tbody.innerHTML = libs
      .map(
        (lib) => `<tr>
          <td>${escapeHtml(lib.name)}</td>
          <td><span class="badge badge-blue">${escapeHtml(lib.collectionType)}</span></td>
          <td class="muted-text">${lib.pathCount} path${lib.pathCount !== 1 ? "s" : ""}</td>
        </tr>`
      )
      .join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Failed to load</td></tr>`;
  }
}

function renderJellyfinPresetOptions(presets) {
  const select = document.getElementById("jellyfinPresetSelect");
  if (!select) return;

  const rows = Array.isArray(presets) ? presets : [];
  select.innerHTML = rows.length
    ? rows.map((preset) => `<option value="${escapeHtml(preset.id || "")}">${escapeHtml(preset.name || preset.id || "Preset")}</option>`).join("")
    : `<option value="default">Default</option>`;
}

async function loadJellyfinUsers() {
  const tbody = document.getElementById("jellyUsersBody");
  if (!tbody) return;

  try {
    const data = await fetchJson("api/admin/jellyfin/users");
    const users = data.users || [];
    jellyfinUserPresetCache = data.presets || [];
    renderJellyfinPresetOptions(jellyfinUserPresetCache);

    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No Jellyfin users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = users
      .map((user) => {
        const admin = user.isAdministrator
          ? `<span class="badge badge-green">Admin</span>`
          : `<span class="badge badge-muted">Member</span>`;
        const status = user.isDisabled
          ? `<span class="badge badge-red">Disabled</span>`
          : `<span class="badge badge-blue">Active</span>`;
        const access = user.enableAllFolders
          ? "All libraries"
          : user.enabledFolders?.length
            ? `${user.enabledFolders.length} selected libraries`
            : "No folders assigned";
        return `<tr>
          <td>${escapeHtml(user.name || "Unknown")}</td>
          <td>${admin}</td>
          <td>${status}</td>
          <td class="muted-text">${escapeHtml(access)}</td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
    setMsg("jellyUsersMsg", err.message, "err");
  }
}

function wireJellyfinUserForm() {
  const form = document.getElementById("jellyfinUserForm");
  if (form && !form.dataset.wired) {
    form.dataset.wired = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsg("jellyUsersMsg");
      const username = String(document.getElementById("jellyfinNewUsername")?.value || "").trim();
      const password = String(document.getElementById("jellyfinNewPassword")?.value || "");
      const presetId = String(document.getElementById("jellyfinPresetSelect")?.value || "default").trim();

      if (!username || !password) {
        setMsg("jellyUsersMsg", "Username and password are required.", "err");
        return;
      }

      setMsg("jellyUsersMsg", `Creating Jellyfin user ${username}...`, "info");
      try {
        const data = await fetchJson("api/admin/jellyfin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, presetId })
        });
        setMsg("jellyUsersMsg", data.message || `Created Jellyfin user ${username}.`, "ok");
        form.reset();
        renderJellyfinPresetOptions(jellyfinUserPresetCache);
        await loadJellyfinUsers();
      } catch (err) {
        setMsg("jellyUsersMsg", err.message, "err");
      }
    });
  }
}

/*  reports tab  */
async function loadReports() {
  const tbody = document.getElementById("reportsTableBody");
  const badge = document.getElementById("badgeReports");
  if (!tbody) return;
  try {
    const data = await fetchJson("api/seerr/issues");
    const issues = data.issues || [];
    if (badge) badge.textContent = issues.filter((i) => Number(i.status) === 1).length || "";
    if (!issues.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No issues reported</td></tr>`;
      return;
    }
    tbody.innerHTML = issues
      .map(
        (i) => `<tr>
          <td class="mono">#${i.id}</td>
          <td>${escapeHtml(i.subject || "")}</td>
          <td>${issueTypeBadge(i.issueType)}</td>
          <td>${issueStatusBadge(i.status)}</td>
          <td class="muted-text">${i.commentCount ?? 0}</td>
          <td class="muted-text">${fmtDate(i.createdAt)}</td>
          <td><button class="btn-secondary btn-sm" onclick="quickFillIssue(${i.id})">Reply</button></td>
        </tr>`
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function quickFillIssue(id) {
  const el = document.getElementById("respondIssueId");
  if (el) { el.value = id; }
  document.getElementById("respondMessage")?.focus();
}

/*  bot config  */
const BOT_BOOL_FIELDS = [
  "enforceRequestChannel",
  "announceOnRequestCreated",
  "announceOnAvailable",
  "announceOnAnyStatus",
  "dailyNewsEnabled",
  "dmOnStatusChange",
  "mentionRequesterInChannel",
  "useRichEmbeds"
];

const BOT_TEXT_FIELDS = [
  "dailyNewsHourLocal",
  "jellyfinAdminRoleIds",
  "jellyfinUserGroupPresets",
  "requestAnnouncementTemplate",
  "availableAnnouncementTemplate",
  "statusAnnouncementTemplate"
];

const CHANNEL_FIELDS = [
  "requestsChannelId",
  "uploadsChannelId",
  "updatesChannelId",
  "newsChannelId",
  "reportsChannelId",
  "jellyfinNowPlayingChannelId",
  "jellyfinStatsChannelId",
  "newMoviesChannelId",
  "newShowsChannelId",
  "newEpisodesChannelId",
  "newMusicChannelId",
  "generalChannelId",
  "welcomeChannelId",
  "suggestionsChannelId",
  "cuttingBoardChannelId",
  "botTestingChannelId",
  "requestRoleId",
  "adminRoleId",
  "defaultMemberRoleId"
];

let _botConfigCache = {};

async function loadBotConfig() {
  try {
    const data = await fetchJson("api/admin/bot-config");
    _botConfigCache = data.values || {};
    _populateBotConfigForm(_botConfigCache);
  } catch (err) {
    setMsg("botConfigMsg", `Failed to load: ${err.message}`, "err");
  }
}

function _populateBotConfigForm(values) {
  const form = document.getElementById("botConfigForm");
  if (!form) return;
  for (const name of BOT_TEXT_FIELDS) {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.value = values[name] ?? "";
  }
  for (const name of BOT_BOOL_FIELDS) {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.checked = String(values[name] ?? "false") === "true";
  }
}

async function loadChannels() {
  try {
    const data = await fetchJson("api/admin/bot-config");
    _botConfigCache = data.values || {};
    _populateChannelsForm(_botConfigCache);
  } catch (err) {
    setMsg("channelsMsg", `Failed to load: ${err.message}`, "err");
  }
}

function _populateChannelsForm(values) {
  const form = document.getElementById("channelsForm");
  if (!form) return;
  for (const name of CHANNEL_FIELDS) {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.value = values[name] ?? "";
  }
}

function _collectAllValues() {
  const values = { ..._botConfigCache };

  const botForm = document.getElementById("botConfigForm");
  if (botForm) {
    for (const name of BOT_TEXT_FIELDS) {
      const el = botForm.querySelector(`[name="${name}"]`);
      if (el) values[name] = el.value;
    }
    for (const name of BOT_BOOL_FIELDS) {
      const el = botForm.querySelector(`[name="${name}"]`);
      if (el) values[name] = el.checked ? "true" : "false";
    }
  }

  const chanForm = document.getElementById("channelsForm");
  if (chanForm) {
    for (const name of CHANNEL_FIELDS) {
      const el = chanForm.querySelector(`[name="${name}"]`);
      if (el) values[name] = el.value;
    }
  }

  return values;
}

async function saveBotConfig() {
  const values = _collectAllValues();
  try {
    const data = await fetchJson("api/admin/bot-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    _botConfigCache = data.values || values;
    setMsg("botConfigMsg", "Bot configuration saved.", "ok");
  } catch (err) {
    setMsg("botConfigMsg", err.message, "err");
  }
}

async function saveChannels() {
  const values = _collectAllValues();
  try {
    const data = await fetchJson("api/admin/bot-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    _botConfigCache = data.values || values;
    setMsg("channelsMsg", "Channels & roles saved.", "ok");
  } catch (err) {
    setMsg("channelsMsg", err.message, "err");
  }
}

async function sendManualChannelTest(target) {
  try {
    setMsg("channelsMsg", `Sending test to ${target}...`, "info");
    const data = await fetchJson("api/admin/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target })
    });
    setMsg("channelsMsg", data.message || `Test sent to ${target}.`, "ok");
  } catch (err) {
    setMsg("channelsMsg", err.message, "err");
  }
}

/*  environment  */
async function loadEnvSettings() {
  try {
    const data = await fetchJson("api/admin/env");
    envAllowedKeysCache = data.allowedKeys || [];
    envValuesCache = { ...(data.values || {}) };
    renderEnvForm("envForm", data.allowedKeys, data.values);
    
    // Automatically test connection status for each service
    setTimeout(() => {
      if (envValuesCache.OVERSEERR_URL && envValuesCache.OVERSEERR_API_KEY) {
        testOverseerrEnvConnection();
      }
      if (envValuesCache.TMDB_API_READ_TOKEN) {
        testTmdbEnvConnection();
      }
      if (envValuesCache.JELLYFIN_URL && envValuesCache.JELLYFIN_API_KEY) {
        testJellyfinEnvConnection();
      }
      if (envValuesCache.LIDARR_URL && envValuesCache.LIDARR_API_KEY) {
        testLidarrEnvConnection();
      }
    }, 500);
  } catch (err) {
    setMsg("envMsg", `Failed to load: ${err.message}`, "err");
  }
}

async function saveEnvSettings() {
  const values = collectFormValues("envForm");
  try {
    const data = await fetchJson("api/admin/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    envValuesCache = { ...(data.values || values) };
    setMsg("envMsg", data.message || "Environment saved.", "ok");
  } catch (err) {
    setMsg("envMsg", err.message, "err");
  }
}

function normalizeKofiUrl(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return "";
  }

  const withProtocol =
    !/^https?:\/\//i.test(raw) && /ko-?fi\.com/i.test(raw)
      ? `https://${raw}`
      : raw;

  let username = "";

  if (/^https?:\/\//i.test(withProtocol)) {
    try {
      const parsed = new URL(withProtocol);
      const host = String(parsed.hostname || "").toLowerCase();
      if (host === "ko-fi.com" || host === "www.ko-fi.com") {
        username = parsed.pathname
          .split("/")
          .map((part) => part.trim())
          .filter(Boolean)[0] || "";
      }
    } catch (error) {
      // Fall through to non-URL normalization.
    }
  }

  if (!username) {
    username = raw
      .replace(/^@/, "")
      .replace(/^https?:\/\/(www\.)?ko-?fi\.com\//i, "")
      .replace(/^(www\.)?ko-?fi\.com\//i, "")
      .replace(/^ko-?fi\//i, "")
      .split(/[/?#]/)[0]
      .trim();
  }

  return username ? `https://ko-fi.com/${username}` : "";
}

function renderDonationPreview() {
  const preview = document.getElementById("donationPreview");
  if (!preview) return;

  const message = String(document.getElementById("donationMessage")?.value || "").trim();

  const platforms = [
    { label: "Ko-fi", url: normalizeKofiUrl(String(document.getElementById("koFiUrl")?.value || "")) },
    { label: "PayPal", url: String(document.getElementById("paypalUrl")?.value || "").trim() },
    { label: "Buy Me a Coffee", url: String(document.getElementById("buyMeCoffeeUrl")?.value || "").trim() },
    { label: "Patreon", url: String(document.getElementById("patreonUrl")?.value || "").trim() },
    { label: "GitHub Sponsors", url: String(document.getElementById("githubSponsorsUrl")?.value || "").trim() }
  ].filter(p => p.url);

  if (!platforms.length) {
    preview.innerHTML = `<div class="empty-state">Fill in platform URLs to see the /donate preview.</div>`;
    return;
  }

  const links = platforms.map(p =>
    `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(p.label)}: ${escapeHtml(p.url)}</a>`
  ).join("");
  preview.innerHTML = `<div style="display:grid;gap:0.55rem"><div>${escapeHtml(message || "Support the server with a donation!")}</div>${links}</div>`;
}

async function loadDonationSettings() {
  try {
    const [envData, botData] = await Promise.all([
      fetchJson("api/admin/env"),
      fetchJson("api/admin/bot-config")
    ]);
    const v = envData.values || {};
    const b = botData.config || {};

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
    set("koFiUrl",           v.KO_FI_URL);
    set("paypalUrl",         v.PAYPAL_URL);
    set("buyMeCoffeeUrl",    v.BUYMEACOFFEE_URL);
    set("patreonUrl",        v.PATREON_URL);
    set("githubSponsorsUrl", v.GITHUB_SPONSORS_URL);
    set("donationMessage",   v.DONATION_MESSAGE || "Support the server with a donation!");
    set("kofiWebhookSecret", v.KOFI_WEBHOOK_SECRET);
    set("donationChannelId",  b.donationChannelId);
    set("donorTier1Amount",   b.donorTier1Amount);
    set("donorTier1RoleId",   b.donorTier1RoleId);
    set("donorTier2Amount",   b.donorTier2Amount);
    set("donorTier2RoleId",   b.donorTier2RoleId);
    set("donorTier3Amount",   b.donorTier3Amount);
    set("donorTier3RoleId",   b.donorTier3RoleId);

    const webhookEl = document.getElementById("kofiWebhookUrl");
    if (webhookEl) webhookEl.textContent = window.location.origin + "/api/webhooks/kofi";

    renderDonationPreview();
    await loadDonationLog();
  } catch (err) {
    setMsg("donationsMsg", `Failed to load: ${err.message}`, "err");
  }
}

async function saveDonationSettings() {
  clearMsg("donationsMsg");

  const rawKofi = String(document.getElementById("koFiUrl")?.value || "").trim();
  const normalizedKofi = normalizeKofiUrl(rawKofi);
  if (rawKofi && !normalizedKofi) {
    setMsg("donationsMsg", "Enter a valid Ko-fi URL or username.", "err");
    return;
  }

  const get = (id) => String(document.getElementById(id)?.value || "").trim();

  try {
    await Promise.all([
      fetchJson("api/admin/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            KO_FI_URL:            normalizedKofi,
            PAYPAL_URL:           get("paypalUrl"),
            BUYMEACOFFEE_URL:     get("buyMeCoffeeUrl"),
            PATREON_URL:          get("patreonUrl"),
            GITHUB_SPONSORS_URL:  get("githubSponsorsUrl"),
            DONATION_MESSAGE:     get("donationMessage") || "Support the server with a donation!",
            KOFI_WEBHOOK_SECRET:  get("kofiWebhookSecret")
          }
        })
      }),
      fetchJson("api/admin/bot-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            donationChannelId:  get("donationChannelId"),
            donorTier1Amount:   get("donorTier1Amount"),
            donorTier1RoleId:   get("donorTier1RoleId"),
            donorTier2Amount:   get("donorTier2Amount"),
            donorTier2RoleId:   get("donorTier2RoleId"),
            donorTier3Amount:   get("donorTier3Amount"),
            donorTier3RoleId:   get("donorTier3RoleId")
          }
        })
      })
    ]);
    setMsg("donationsMsg", "Donation settings saved.", "ok");
    renderDonationPreview();
  } catch (err) {
    setMsg("donationsMsg", err.message, "err");
  }
}

async function loadDonationLog() {
  const msgEl = document.getElementById("donationLogMsg");
  const tbody = document.getElementById("donationLogBody");
  if (!tbody) return;
  try {
    const data = await fetchJson("api/admin/donations");
    const rows = data.donations || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No donations recorded yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const assigned = r.role_assigned ? `<span class="badge badge-green">Assigned</span>` : `
        <div style="display:flex;gap:0.4rem;align-items:center">
          <input class="donor-discord-id" data-id="${escapeHtml(String(r.id))}" type="text"
            placeholder="Discord User ID" value="${escapeHtml(r.discord_user_id || "")}"
            style="width:14rem" />
          <button class="btn-primary btn-sm assign-donor-role-btn" data-id="${escapeHtml(String(r.id))}">Assign</button>
        </div>`;
      return `<tr>
        <td>${escapeHtml(fmtDate(r.created_at))}</td>
        <td>${escapeHtml(r.platform || "")}</td>
        <td>${escapeHtml(r.from_name || "")}</td>
        <td>${escapeHtml(r.currency || "")} ${escapeHtml(String(r.amount || ""))}</td>
        <td>${escapeHtml(r.discord_username || "")}</td>
        <td title="${escapeHtml(r.message || "")}">${escapeHtml((r.message || "").slice(0, 40))}${(r.message || "").length > 40 ? "…" : ""}</td>
        <td>${assigned}</td>
        <td>${r.role_assigned ? "" : `<span class="badge badge-muted">Manual</span>`}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    if (msgEl) setMsg("donationLogMsg", `Failed to load: ${err.message}`, "err");
  }
}

async function testLidarrEnvConnection() {
  const values = collectFormValues("envForm");
  setLidarrTestButtonState({ busy: true, text: "Testing Lidarr connection...", type: "info" });
  setMsg("envMsg", "", "info");
  try {
    const data = await fetchJson("api/admin/lidarr/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    lidarrEnvOptionsCache = {
      rootFolders: data.rootFolders || [],
      qualityProfiles: data.qualityProfiles || [],
      metadataProfiles: data.metadataProfiles || []
    };
    const mergedValues = {
      ...envValuesCache,
      ...values,
      LIDARR_ROOT_FOLDER: values.LIDARR_ROOT_FOLDER || data.defaults?.rootFolderPath || envValuesCache.LIDARR_ROOT_FOLDER || "",
      LIDARR_QUALITY_PROFILE_ID:
        values.LIDARR_QUALITY_PROFILE_ID || String(data.defaults?.qualityProfileId || envValuesCache.LIDARR_QUALITY_PROFILE_ID || ""),
      LIDARR_METADATA_PROFILE_ID:
        values.LIDARR_METADATA_PROFILE_ID || String(data.defaults?.metadataProfileId || envValuesCache.LIDARR_METADATA_PROFILE_ID || "")
    };
    envValuesCache = mergedValues;
    renderEnvForm("envForm", envAllowedKeysCache, mergedValues);
    applyLidarrOptions(data);
    setLidarrTestButtonState({ busy: false, text: data.message || "Connected to Lidarr.", type: "ok" });
  } catch (err) {
    setLidarrTestButtonState({ busy: false, text: err.message, type: "err" });
  }
}

async function testOverseerrEnvConnection() {
  const values = collectFormValues("envForm");
  setAppTestButtonState("overseerr", { busy: true, text: "Testing Overseerr connection...", type: "info" });
  try {
    const data = await fetchJson("api/admin/overseerr/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    setAppTestButtonState("overseerr", { busy: false, text: data.message || "Connected to Overseerr.", type: "ok" });
  } catch (err) {
    setAppTestButtonState("overseerr", { busy: false, text: err.message, type: "err" });
  }
}

async function testTmdbEnvConnection() {
  const values = collectFormValues("envForm");
  setAppTestButtonState("tmdb", { busy: true, text: "Testing TMDB connection...", type: "info" });
  try {
    const data = await fetchJson("api/admin/tmdb/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    setAppTestButtonState("tmdb", { busy: false, text: data.message || "Connected to TMDB.", type: "ok" });
  } catch (err) {
    setAppTestButtonState("tmdb", { busy: false, text: err.message, type: "err" });
  }
}

async function testJellyfinEnvConnection() {
  const values = collectFormValues("envForm");
  setAppTestButtonState("jellyfin", { busy: true, text: "Testing Jellyfin connection...", type: "info" });
  try {
    const data = await fetchJson("api/admin/jellyfin/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    jellyfinEnvDefaultsCache = data.defaults || null;
    setAppTestButtonState("jellyfin", { busy: false, text: data.message || "Connected to Jellyfin.", type: "ok" });
  } catch (err) {
    setAppTestButtonState("jellyfin", { busy: false, text: err.message, type: "err" });
  }
}

async function loadJellyfinEnvDefaults() {
  const values = collectFormValues("envForm");
  setAppTestButtonState("jellyfin", { busy: true, text: "Loading Jellyfin defaults...", type: "info" });
  try {
    const data = await fetchJson("api/admin/jellyfin/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });

    const defaults = data.defaults || jellyfinEnvDefaultsCache || {};
    const mergedValues = {
      ...envValuesCache,
      ...values,
      JELLYFIN_USER_ID: values.JELLYFIN_USER_ID || defaults.userId || envValuesCache.JELLYFIN_USER_ID || "",
      JELLYFIN_USERNAME: values.JELLYFIN_USERNAME || defaults.username || envValuesCache.JELLYFIN_USERNAME || "",
      JELLYFIN_CLIENT_NAME: values.JELLYFIN_CLIENT_NAME || defaults.clientName || envValuesCache.JELLYFIN_CLIENT_NAME || "ApexFlix",
      JELLYFIN_DEVICE_NAME: values.JELLYFIN_DEVICE_NAME || defaults.deviceName || envValuesCache.JELLYFIN_DEVICE_NAME || "ApexFlix Bot",
      JELLYFIN_DEVICE_ID: values.JELLYFIN_DEVICE_ID || defaults.deviceId || envValuesCache.JELLYFIN_DEVICE_ID || "apexflix-bot",
      JELLYFIN_CLIENT_VERSION: values.JELLYFIN_CLIENT_VERSION || defaults.clientVersion || envValuesCache.JELLYFIN_CLIENT_VERSION || "1.0.0"
    };

    envValuesCache = mergedValues;
    jellyfinEnvDefaultsCache = defaults;
    renderEnvForm("envForm", envAllowedKeysCache, mergedValues);
    setAppTestButtonState("jellyfin", { busy: false, text: data.message || "Loaded Jellyfin defaults.", type: "ok" });
  } catch (err) {
    setAppTestButtonState("jellyfin", { busy: false, text: err.message, type: "err" });
  }
}

/*  system  */
async function loadHealth() {
  const box = document.getElementById("healthBox");
  if (!box) return;
  try {
    const data = await fetchJson("api/health");
    box.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    box.textContent = `Error: ${err.message}`;
  }
}

async function generateSystemdUnit() {
  const form = document.getElementById("systemdForm");
  if (!form) return;
  const fd = new FormData(form);
  const payload = {
    serviceName: String(fd.get("serviceName") || "apexflix").trim(),
    user: String(fd.get("serviceUser") || "").trim(),
    group: String(fd.get("serviceGroup") || "").trim(),
    workingDirectory: String(fd.get("workingDirectory") || "").trim(),
    execStart: String(fd.get("execStart") || "").trim(),
    nodeEnv: String(fd.get("nodeEnv") || "production").trim()
  };
  try {
    const data = await fetchJson("api/admin/systemd/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setMsg("systemdMsg", data.message || "Generated.", "ok");
    const cmds = document.getElementById("systemdCommands");
    const unit = document.getElementById("systemdUnitPreview");
    if (cmds) cmds.textContent = (data.recommendedManualCommands || []).join("\n");
    if (unit) unit.textContent = data.unit || "";
  } catch (err) {
    setMsg("systemdMsg", err.message, "err");
  }
}

/*  logs utilities  */
function formatLogEntry(entry) {
  if (!entry) return "";
  if (entry.raw) return String(entry.raw);
  const ts = entry.timestamp || "";
  const level = (entry.level || "").toUpperCase();
  const msg = entry.message || "";
  return `[${ts}] [${level}] ${msg}`;
}

function appendToLogsBox(line) {
  const box = document.getElementById("logsBox");
  if (!box) return;
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
  box.textContent = box.textContent ? box.textContent + "\n" + line : line;
  if (atBottom) box.scrollTop = box.scrollHeight;
}

async function loadLogs() {
  const level = document.getElementById("logsLevelFilter")?.value || "";
  const limit = Number(document.getElementById("logsLimit")?.value) || 200;
  const search = document.getElementById("logsSearch")?.value || "";
  setMsg("logsMsg", "Loading logs", "info");
  try {
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    if (level) qs.set("level", level);
    if (search) qs.set("search", search);
    const data = await fetchJson("api/admin/logs?" + qs.toString());
    const arr = data.logs || [];
    const box = document.getElementById("logsBox");
    if (box) {
      box.textContent = arr.map((l) => l.raw || formatLogEntry(l)).join("\n");
      box.scrollTop = box.scrollHeight;
    }
    setMsg("logsMsg", `Loaded ${arr.length} log lines.`, "ok");
    const badge = document.getElementById("badgeLogs");
    if (badge) badge.textContent = arr.length ? String(arr.length) : "";
    logUnreadCount = 0;
  } catch (err) {
    setMsg("logsMsg", err.message, "err");
  }
}

function startLogTail() {
  if (logEventSource) return;
  try {
    const es = new EventSource("/api/admin/logs/stream");
    logEventSource = es;
    document.getElementById("logsTailToggleBtn")?.classList.add("active");
    const tailBtn = document.getElementById("logsTailToggleBtn");
    if (tailBtn) tailBtn.textContent = "Stop Tail";

    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data);
        const line = obj.raw || formatLogEntry(obj);
        if (activeTab === "tabLogs") {
          appendToLogsBox(line);
        } else {
          logUnreadCount += 1;
          const badge = document.getElementById("badgeLogs");
          if (badge) badge.textContent = String(logUnreadCount);
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    es.addEventListener("cleared", () => {
      const box = document.getElementById("logsBox");
      if (box) box.textContent = "";
      setMsg("logsMsg", "Logs cleared", "ok");
    });

    es.onerror = () => {
      setMsg("logsMsg", "Log stream disconnected or errored.", "err");
      stopLogTail();
    };
  } catch (err) {
    setMsg("logsMsg", `Failed to start tail: ${err.message}`, "err");
  }
}

function stopLogTail() {
  if (!logEventSource) return;
  try {
    logEventSource.close();
  } catch (e) {}
  logEventSource = null;
  document.getElementById("logsTailToggleBtn")?.classList.remove("active");
  const tailBtn = document.getElementById("logsTailToggleBtn");
  if (tailBtn) tailBtn.textContent = "Start Tail";
}

function toggleLogTail() {
  if (logEventSource) stopLogTail();
  else startLogTail();
}

async function clearLogs() {
  if (!confirm("Clear all logs on server? This cannot be undone.")) return;
  try {
    await fetchJson("api/admin/logs/clear", { method: "POST" });
    const box = document.getElementById("logsBox");
    if (box) box.textContent = "";
    setMsg("logsMsg", "Logs cleared.", "ok");
    const badge = document.getElementById("badgeLogs");
    if (badge) badge.textContent = "";
  } catch (err) {
    setMsg("logsMsg", err.message, "err");
  }
}

function downloadLogs() {
  // trigger a download via navigation
  window.location = "/api/admin/logs/download";
}

/*  jellyfin logs viewer  */
async function loadJellyfinLogFiles() {
  try {
    setMsg("jellyfinLogsMsg", "Loading Jellyfin log files...", "info");
    const data = await fetchJson("api/admin/jellyfin/logs/files");
    const select = document.getElementById("jellyfinLogsFileSelect");
    const dirEl = document.getElementById("jellyfinLogsDirLabel");
    if (dirEl) dirEl.textContent = `Directory: ${data.directory || "(unknown)"}`;
    if (!select) return;

    const files = data.files || [];
    if (!files.length) {
      select.innerHTML = "";
      const box = document.getElementById("jellyfinLogsBox");
      if (box) box.textContent = "No Jellyfin log files found in configured directory.";
      setMsg("jellyfinLogsMsg", "No Jellyfin log files found.", "err");
      return;
    }

    select.innerHTML = files
      .map((f) => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)} (${Math.round((f.size || 0) / 1024)} KB)</option>`)
      .join("");

    setMsg("jellyfinLogsMsg", `Loaded ${files.length} Jellyfin log files.`, "ok");
    await loadJellyfinLogFile();
  } catch (err) {
    setMsg("jellyfinLogsMsg", err.message, "err");
  }
}

async function loadJellyfinLogFile() {
  const select = document.getElementById("jellyfinLogsFileSelect");
  const lines = Number(document.getElementById("jellyfinLogsLines")?.value) || 400;
  if (!select || !select.value) {
    setMsg("jellyfinLogsMsg", "No Jellyfin log file selected.", "err");
    return;
  }

  try {
    const qs = new URLSearchParams({
      file: String(select.value),
      lines: String(lines)
    });
    const data = await fetchJson(`api/admin/jellyfin/logs/read?${qs.toString()}`);
    const box = document.getElementById("jellyfinLogsBox");
    if (box) {
      box.textContent = data.content || "(empty file)";
      box.scrollTop = box.scrollHeight;
    }
    setMsg("jellyfinLogsMsg", `Loaded ${select.value}.`, "ok");
  } catch (err) {
    setMsg("jellyfinLogsMsg", err.message, "err");
  }
}

function toggleJellyfinLogsAutoRefresh() {
  const btn = document.getElementById("jellyfinLogsAutoRefreshBtn");
  if (jellyfinLogsAutoRefreshTimer) {
    clearInterval(jellyfinLogsAutoRefreshTimer);
    jellyfinLogsAutoRefreshTimer = null;
    if (btn) btn.textContent = "Auto Refresh Off";
    return;
  }

  jellyfinLogsAutoRefreshTimer = setInterval(() => {
    if (activeTab === "tabJellyfinLogs") {
      loadJellyfinLogFile();
    }
  }, 4000);
  if (btn) btn.textContent = "Auto Refresh On";
}

function bindButtonClick(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", (e) => {
    e.preventDefault();
    handler(e);
  });
}

/*  wire all  */
function wireAll(user) {
  const userEl = document.getElementById("sidebarUser");
  if (userEl) userEl.textContent = user.username;

  // Tab navigation
  document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Logout
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try { await fetchJson("api/auth/logout", { method: "POST" }); } finally { location.reload(); }
  });

  // Dashboard
  bindButtonClick("dashRefreshNowPlaying", loadDashboardNowPlaying);
  bindButtonClick("dashRefreshLatest", loadDashboardLatest);
  bindButtonClick("dashRefreshRequests", loadDashboardRequests);
  bindButtonClick("dashBackfillBtn", async () => {
    setMsg("dashBackfillMsg", "Running Seerr + Lidarr backfill", "info");
    try {
      const data = await fetchJson("api/admin/requests/backfill", { method: "POST" });
      setMsg("dashBackfillMsg", data.message || "Backfill complete.", "ok");
      loadDashboardRequests();
    } catch (err) { setMsg("dashBackfillMsg", err.message, "err"); }
  });

  // Requests
  wireRequestForm();
  wireDiscoverForm();
  wireLidarrForm();
  bindButtonClick("reqRefreshBtn", loadRequestsTable);
  bindButtonClick("discoverRefreshBtn", loadDiscoverResults);
  bindButtonClick("lidarrOptionsRefreshBtn", async () => {
    await loadLidarrOptions();
    await loadLidarrLibraryStats();
    await loadLidarrArtists();
    await loadLidarrGenres();
  });

  // Jellyfin
  bindButtonClick("jellyRefreshNP", loadJellyfinNowPlaying);
  bindButtonClick("jellyRefreshLibs", loadJellyfinLibraries);
  bindButtonClick("jellyUsersRefreshBtn", loadJellyfinUsers);
  wireJellyfinUserForm();
  document.getElementById("publishNowPlayingBtn")?.addEventListener("click", async () => {
    setMsg("jellyNPMsg", "Publishing to Discord", "info");
    try {
      const data = await fetchJson("api/admin/jellyfin/publish-now-playing", { method: "POST" });
      setMsg("jellyNPMsg", data.message || "Now playing snapshot sent.", "ok");
    } catch (err) { setMsg("jellyNPMsg", err.message, "err"); }
  });
  document.getElementById("publishJellyStatsBtn")?.addEventListener("click", async () => {
    setMsg("jellyStatsMsg", "Publishing to Discord", "info");
    try {
      const data = await fetchJson("api/admin/jellyfin/publish-stats", { method: "POST" });
      setMsg("jellyStatsMsg", data.message || "Jellyfin stats snapshot sent.", "ok");
    } catch (err) { setMsg("jellyStatsMsg", err.message, "err"); }
  });

  // Reports
  bindButtonClick("reportsRefreshBtn", loadReports);
  document.getElementById("respondSubmitBtn")?.addEventListener("click", async () => {
    clearMsg("respondMsg");
    const issueId = Number(document.getElementById("respondIssueId")?.value || 0);
    const message = String(document.getElementById("respondMessage")?.value || "").trim();
    if (!issueId || !message) {
      setMsg("respondMsg", "Issue ID and message are required.", "err");
      return;
    }
    try {
      await fetchJson(`api/seerr/issues/${issueId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      setMsg("respondMsg", `Comment posted on issue #${issueId}.`, "ok");
      const msgEl = document.getElementById("respondMessage");
      if (msgEl) msgEl.value = "";
      loadReports();
    } catch (err) { setMsg("respondMsg", err.message, "err"); }
  });

  // Bot Config
  document.getElementById("saveBotConfigBtn")?.addEventListener("click", saveBotConfig);
  document.getElementById("sendDailyNewsBtn")?.addEventListener("click", async () => {
    setMsg("dailyNewsMsg", "Sending", "info");
    try {
      const data = await fetchJson("api/admin/news/send", { method: "POST" });
      setMsg("dailyNewsMsg", data.message || "Daily news sent.", "ok");
    } catch (err) { setMsg("dailyNewsMsg", err.message, "err"); }
  });

  // Channels
  document.getElementById("saveChannelsBtn")?.addEventListener("click", saveChannels);
  document.querySelectorAll(".test-channel-btn[data-test-target]").forEach((btn) => {
    btn.addEventListener("click", () => sendManualChannelTest(btn.dataset.testTarget));
  });

  // Environment
  document.getElementById("saveEnvBtn")?.addEventListener("click", saveEnvSettings);
  document.getElementById("envForm")?.addEventListener("click", (e) => {
    const button = e.target.closest("button[id]");
    if (!button) return;
    e.preventDefault();
    if (button.id === "testOverseerrEnvBtn") {
      testOverseerrEnvConnection();
      return;
    }
    if (button.id === "testTmdbEnvBtn") {
      testTmdbEnvConnection();
      return;
    }
    if (button.id === "testJellyfinEnvBtn") {
      testJellyfinEnvConnection();
      return;
    }
    if (button.id === "loadJellyfinDefaultsBtn") {
      loadJellyfinEnvDefaults();
      return;
    }
    if (button.id === "testLidarrEnvBtn") {
      testLidarrEnvConnection();
    }
  });

  // Donations
  document.getElementById("saveDonationsBtn")?.addEventListener("click", saveDonationSettings);
  document.getElementById("donationLogRefreshBtn")?.addEventListener("click", loadDonationLog);
  ["koFiUrl","paypalUrl","buyMeCoffeeUrl","patreonUrl","githubSponsorsUrl","donationMessage"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", renderDonationPreview);
  });
  document.getElementById("donationLogBody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".assign-donor-role-btn");
    if (!btn) return;
    const id = btn.dataset.id;
    const input = document.querySelector(`.donor-discord-id[data-id="${id}"]`);
    const discordUserId = String(input?.value || "").trim();
    clearMsg("donationLogMsg");
    if (!discordUserId) {
      setMsg("donationLogMsg", "Enter a Discord User ID first.", "err");
      return;
    }
    try {
      btn.disabled = true;
      await fetchJson(`api/admin/donations/${encodeURIComponent(id)}/assign-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordUserId })
      });
      setMsg("donationLogMsg", "Role assigned successfully.", "ok");
      await loadDonationLog();
    } catch (err) {
      btn.disabled = false;
      setMsg("donationLogMsg", err.message, "err");
    }
  });

  // System
  bindButtonClick("healthRefreshBtn", loadHealth);
  document.getElementById("generateSystemdBtn")?.addEventListener("click", generateSystemdUnit);
  document.getElementById("passwordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("passwordMsg");
    const fd = new FormData(e.target);
    try {
      await fetchJson("api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(fd.get("currentPassword") || ""),
          newPassword: String(fd.get("newPassword") || "")
        })
      });
      setMsg("passwordMsg", "Password updated.", "ok");
      e.target.reset();
    } catch (err) { setMsg("passwordMsg", err.message, "err"); }
  });

  // Logs
  bindButtonClick("logsRefreshBtn", loadLogs);
  document.getElementById("logsTailToggleBtn")?.addEventListener("click", toggleLogTail);
  document.getElementById("logsClearBtn")?.addEventListener("click", clearLogs);
  document.getElementById("logsDownloadBtn")?.addEventListener("click", downloadLogs);
  document.getElementById("logsLevelFilter")?.addEventListener("change", loadLogs);
  document.getElementById("logsLimit")?.addEventListener("change", loadLogs);
  const logsSearchEl = document.getElementById("logsSearch");
  if (logsSearchEl) {
    logsSearchEl.addEventListener("keypress", (ev) => { if (ev.key === "Enter") loadLogs(); });
  }

  // Jellyfin Logs
  bindButtonClick("jellyfinLogsRefreshFilesBtn", loadJellyfinLogFiles);
  bindButtonClick("jellyfinLogsLoadBtn", loadJellyfinLogFile);
  bindButtonClick("jellyfinLogsAutoRefreshBtn", toggleJellyfinLogsAutoRefresh);
  document.getElementById("jellyfinLogsFileSelect")?.addEventListener("change", loadJellyfinLogFile);
  document.getElementById("jellyfinLogsLines")?.addEventListener("change", loadJellyfinLogFile);

  // Start live updates
  updateStatusPills();
  setInterval(updateStatusPills, 30000);
  refreshDashboard();
  setInterval(refreshDashboard, 60000);
}

/*  auth screens  */
function wireSetupForm() {
  document.getElementById("setupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("setupMsg");
    const fd = new FormData(e.target);
    const password = String(fd.get("password") || "");
    const confirm = String(fd.get("confirmPassword") || "");
    if (password !== confirm) {
      setMsg("setupMsg", "Passwords do not match.", "err");
      return;
    }
    const envValues = {};
    for (const [key, val] of fd.entries()) {
      if (!["username", "password", "confirmPassword"].includes(key)) {
        envValues[key] = String(val || "");
      }
    }
    try {
      const data = await fetchJson("api/setup/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(fd.get("username") || "").trim(),
          password,
          values: envValues
        })
      });
      setMsg("setupMsg", "Setup complete. Reload after updating Discord credentials if you changed them.", "ok");
      showApp({ username: data.username });
    } catch (err) { setMsg("setupMsg", err.message, "err"); }
  });
}

function wireLoginForm() {
  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("loginMsg");
    const fd = new FormData(e.target);
    try {
      const data = await fetchJson("api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(fd.get("username") || "").trim(),
          password: String(fd.get("password") || "")
        })
      });
      showApp({ username: data.username });
    } catch (err) { setMsg("loginMsg", err.message, "err"); }
  });
}

function showApp(user) {
  document.getElementById("setupScreen")?.classList.add("hidden");
  document.getElementById("loginScreen")?.classList.add("hidden");
  document.getElementById("appShell")?.classList.remove("hidden");
  wireAll(user);
}

/*  init  */
async function init() {
  wireSetupForm();
  wireLoginForm();

  try {
    const status = await fetchJson("api/setup/status");
    if (status.setupRequired) {
      renderEnvForm("setupEnvForm", status.allowedKeys, status.values);
      document.getElementById("setupScreen")?.classList.remove("hidden");
      return;
    }
  } catch {
    // fall through to login
  }

  try {
    const me = await fetchJson("api/auth/me");
    showApp(me.user);
    return;
  } catch {
    // not logged in
  }

  document.getElementById("loginScreen")?.classList.remove("hidden");
}

window.addEventListener("DOMContentLoaded", () => init().catch(console.error));
