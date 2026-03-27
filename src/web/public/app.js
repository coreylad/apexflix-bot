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
        "JELLYFIN_ALLOW_INSECURE_TLS"
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

  form.innerHTML = groups
    .map((group) => {
      const keys = group.keys.filter((k) => allowedSet.has(k));
      if (!keys.length) return "";
      const fields = keys
        .map((key) => {
          const safeVal = escapeHtml(values?.[key] || "");
          const label = key.endsWith("BASE_URL") ? `${key} (legacy)` : key;
          return `<label>${label}<input name="${key}" type="text" value="${safeVal}" /></label>`;
        })
        .join("");
      return `<div class="settings-section"><div class="settings-title">${group.title}</div><div class="settings-grid">${fields}</div></div>`;
    })
    .join("");
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
  tabLogs: "Logs",
  tabSystem: "System"
};

let activeTab = "tabDashboard";
let logEventSource = null;
let logUnreadCount = 0;

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
      break;
    case "tabJellyfin":
      loadJellyfinStats();
      loadJellyfinNowPlaying();
      loadJellyfinLibraries();
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
    case "tabLogs":
      // Load recent logs when user views the Logs tab
      try { loadLogs(); } catch (e) { /* ignore */ }
      logUnreadCount = 0;
      const _badge = document.getElementById("badgeLogs");
      if (_badge) _badge.textContent = "";
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
    document.getElementById("statStreams").textContent = data.activeSessions ?? "";
  } catch {
    ["statMovies", "statSeries", "statEpisodes", "statStreams"].forEach(
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
        (r) => `<tr>
          <td class="mono">#${r.request_id}</td>
          <td>${escapeHtml(r.title || "")}</td>
          <td><span class="badge badge-purple">${escapeHtml(r.media_type || "")}</span></td>
          <td>${statusBadge(r.status ?? r.status_code)}</td>
          <td class="muted-text">${fmtDate(r.updated_at)}</td>
        </tr>`
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
        (r) => `<tr>
          <td class="mono">#${r.request_id}</td>
          <td>${escapeHtml(r.title || "")}</td>
          <td><span class="badge badge-purple">${escapeHtml(r.media_type || "")}</span></td>
          <td>${statusBadge(r.status ?? r.status_code)}</td>
        </tr>`
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg("requestMsg");
    const fd = new FormData(form);
    const mediaType = String(fd.get("mediaType") || "movie");
    const rawId = String(fd.get("mediaId") || "").trim();
    const seasonInput = String(fd.get("season") || "").trim();

    // Extract numeric TMDB ID from URL or plain number
    const match = rawId.match(/(\d+)\/?$/);
    const mediaId = match ? Number(match[1]) : NaN;

    if (!mediaId || !Number.isInteger(mediaId) || mediaId <= 0) {
      setMsg("requestMsg", "Enter a valid TMDB ID or TMDB URL.", "err");
      return;
    }

    const payload = { mediaType, mediaId };
    if (mediaType === "tv" && seasonInput) {
      payload.season = seasonInput;
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
    } catch (err) {
      setMsg("requestMsg", err.message, "err");
    }
  });
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
    renderEnvForm("envForm", data.allowedKeys, data.values);
  } catch (err) {
    setMsg("envMsg", `Failed to load: ${err.message}`, "err");
  }
}

async function saveEnvSettings() {
  const form = document.getElementById("envForm");
  if (!form) return;
  const values = {};
  for (const el of form.querySelectorAll("input[name]")) {
    values[el.name] = el.value;
  }
  try {
    const data = await fetchJson("api/admin/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values })
    });
    setMsg("envMsg", data.message || "Environment saved.", "ok");
  } catch (err) {
    setMsg("envMsg", err.message, "err");
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
    setMsg("dashBackfillMsg", "Running backfill", "info");
    try {
      const data = await fetchJson("api/admin/requests/backfill", { method: "POST" });
      setMsg("dashBackfillMsg", data.message || "Backfill complete.", "ok");
      loadDashboardRequests();
    } catch (err) { setMsg("dashBackfillMsg", err.message, "err"); }
  });

  // Requests
  wireRequestForm();
  bindButtonClick("reqRefreshBtn", loadRequestsTable);

  // Jellyfin
  bindButtonClick("jellyRefreshNP", loadJellyfinNowPlaying);
  bindButtonClick("jellyRefreshLibs", loadJellyfinLibraries);
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
