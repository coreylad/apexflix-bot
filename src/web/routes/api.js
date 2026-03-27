const express = require("express");
const fs = require("fs");
const path = require("path");
const { generateSessionToken, verifyPassword, hashPassword } = require("../../services/security");
const { createLidarrClient } = require("../../services/lidarr");
const { createOverseerrClient } = require("../../services/overseerr");
const { createJellyfinClient } = require("../../services/jellyfin");

const DEFAULT_BOT_CONFIG = {
  requestsChannelId: "",
  uploadsChannelId: "",
  updatesChannelId: "",
  newsChannelId: "",
  reportsChannelId: "",
  jellyfinNowPlayingChannelId: "",
  jellyfinStatsChannelId: "",
  newMoviesChannelId: "",
  newShowsChannelId: "",
  newEpisodesChannelId: "",
  generalChannelId: "",
  welcomeChannelId: "",
  suggestionsChannelId: "",
  cuttingBoardChannelId: "",
  botTestingChannelId: "",
  requestRoleId: "",
  adminRoleId: "",
  defaultMemberRoleId: "",
  enforceRequestChannel: "false",
  announceOnRequestCreated: "true",
  announceOnAvailable: "true",
  announceOnAnyStatus: "false",
  dailyNewsEnabled: "true",
  dailyNewsHourLocal: "9",
  dmOnStatusChange: "true",
  mentionRequesterInChannel: "true",
  useRichEmbeds: "true",
  requestAnnouncementTemplate:
    "{{event}}\nTitle: {{subject}}\nType: {{media_type}}\nRequest ID: {{request_id}}\nRequested by: {{requestedBy_username}}",
  availableAnnouncementTemplate:
    "{{event}}\nTitle: {{subject}}\nStatus: {{media_status}}\nRequest ID: {{request_id}}",
  statusAnnouncementTemplate:
    "{{event}}\nTitle: {{subject}}\nStatus: {{media_status}}\nRequest ID: {{request_id}}"
};

function asBoolString(value, fallback = "false") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return "true";
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return "false";
  }
  return fallback;
}

function normalizeId(value) {
  const raw = String(value ?? "").trim();
  return /^\d+$/.test(raw) ? raw : "";
}

function normalizeBotConfig(input) {
  const source = input || {};
  const rawHour = Number(String(source.dailyNewsHourLocal ?? DEFAULT_BOT_CONFIG.dailyNewsHourLocal).trim());
  const newsHour =
    Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23
      ? String(rawHour)
      : DEFAULT_BOT_CONFIG.dailyNewsHourLocal;

  return {
    requestsChannelId: normalizeId(source.requestsChannelId),
    uploadsChannelId: normalizeId(source.uploadsChannelId),
    updatesChannelId: normalizeId(source.updatesChannelId),
    newsChannelId: normalizeId(source.newsChannelId),
    reportsChannelId: normalizeId(source.reportsChannelId),
    jellyfinNowPlayingChannelId: normalizeId(source.jellyfinNowPlayingChannelId),
    jellyfinStatsChannelId: normalizeId(source.jellyfinStatsChannelId),
    newMoviesChannelId: normalizeId(source.newMoviesChannelId),
    newShowsChannelId: normalizeId(source.newShowsChannelId),
    newEpisodesChannelId: normalizeId(source.newEpisodesChannelId),
    generalChannelId: normalizeId(source.generalChannelId),
    welcomeChannelId: normalizeId(source.welcomeChannelId),
    suggestionsChannelId: normalizeId(source.suggestionsChannelId),
    cuttingBoardChannelId: normalizeId(source.cuttingBoardChannelId),
    botTestingChannelId: normalizeId(source.botTestingChannelId),
    requestRoleId: normalizeId(source.requestRoleId),
    adminRoleId: normalizeId(source.adminRoleId),
    defaultMemberRoleId: normalizeId(source.defaultMemberRoleId),
    enforceRequestChannel: asBoolString(source.enforceRequestChannel, DEFAULT_BOT_CONFIG.enforceRequestChannel),
    announceOnRequestCreated: asBoolString(source.announceOnRequestCreated, DEFAULT_BOT_CONFIG.announceOnRequestCreated),
    announceOnAvailable: asBoolString(source.announceOnAvailable, DEFAULT_BOT_CONFIG.announceOnAvailable),
    announceOnAnyStatus: asBoolString(source.announceOnAnyStatus, DEFAULT_BOT_CONFIG.announceOnAnyStatus),
    dailyNewsEnabled: asBoolString(source.dailyNewsEnabled, DEFAULT_BOT_CONFIG.dailyNewsEnabled),
    dailyNewsHourLocal: newsHour,
    dmOnStatusChange: asBoolString(source.dmOnStatusChange, DEFAULT_BOT_CONFIG.dmOnStatusChange),
    mentionRequesterInChannel: asBoolString(source.mentionRequesterInChannel, DEFAULT_BOT_CONFIG.mentionRequesterInChannel),
    useRichEmbeds: asBoolString(source.useRichEmbeds, DEFAULT_BOT_CONFIG.useRichEmbeds),
    requestAnnouncementTemplate:
      String(source.requestAnnouncementTemplate || DEFAULT_BOT_CONFIG.requestAnnouncementTemplate).trim(),
    availableAnnouncementTemplate:
      String(source.availableAnnouncementTemplate || DEFAULT_BOT_CONFIG.availableAnnouncementTemplate).trim(),
    statusAnnouncementTemplate:
      String(source.statusAnnouncementTemplate || DEFAULT_BOT_CONFIG.statusAnnouncementTemplate).trim()
  };
}

function firstNonEmpty(values, fallback = "") {
  for (const value of values) {
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

function asOptionalNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) ? parsed : fallback;
}

function asOptionalBoolean(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseCookies(cookieHeader) {
  const result = {};
  const raw = cookieHeader || "";
  const parts = raw.split(";");

  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      continue;
    }
    result[key] = decodeURIComponent(rest.join("="));
  }

  return result;
}

function requireAuth(db) {
  return (req, res, next) => {
    db.pruneExpiredSessions();

    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies.apexflix_session;
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = db.getSessionByToken(token);
    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const user = db.findAdminById(session.user_id);
    if (!user) {
      return res.status(401).json({ error: "Session user no longer exists" });
    }

    req.auth = {
      token,
      user: {
        id: user.id,
        username: user.username
      }
    };
    next();
  };
}

function createApiRouter({ db, overseerr, lidarr, jellyfin, config, envManager, bot, logger }) {
  const router = express.Router();
  const authMiddleware = requireAuth(db);

  function buildOverseerrConfigFromValues(values = {}) {
    return {
      url: firstNonEmpty([values.OVERSEERR_URL, values.OVERSEERR_BASE_URL], config?.overseerr?.url || "").replace(/\/$/, ""),
      apiKey: firstNonEmpty([values.OVERSEERR_API_KEY], config?.overseerr?.apiKey || ""),
      defaultUserId: asOptionalNumber(values.OVERSEERR_DEFAULT_USER_ID, config?.overseerr?.defaultUserId || 1),
      allowInsecureTls: asOptionalBoolean(values.OVERSEERR_ALLOW_INSECURE_TLS, config?.overseerr?.allowInsecureTls || false)
    };
  }

  function buildJellyfinConfigFromValues(values = {}) {
    return {
      url: firstNonEmpty([values.JELLYFIN_URL, values.JELLYFIN_BASE_URL], config?.jellyfin?.url || "").replace(/\/$/, ""),
      apiKey: firstNonEmpty([values.JELLYFIN_API_KEY], config?.jellyfin?.apiKey || ""),
      userId: firstNonEmpty([values.JELLYFIN_USER_ID], config?.jellyfin?.userId || ""),
      username: firstNonEmpty([values.JELLYFIN_USERNAME], config?.jellyfin?.username || ""),
      clientName: firstNonEmpty([values.JELLYFIN_CLIENT_NAME], config?.jellyfin?.clientName || "ApexFlix"),
      deviceName: firstNonEmpty([values.JELLYFIN_DEVICE_NAME], config?.jellyfin?.deviceName || "ApexFlix Bot"),
      deviceId: firstNonEmpty([values.JELLYFIN_DEVICE_ID], config?.jellyfin?.deviceId || "apexflix-bot"),
      clientVersion: firstNonEmpty([values.JELLYFIN_CLIENT_VERSION], config?.jellyfin?.clientVersion || "1.0.0"),
      allowInsecureTls: asOptionalBoolean(values.JELLYFIN_ALLOW_INSECURE_TLS, config?.jellyfin?.allowInsecureTls || false)
    };
  }

  function buildLidarrConfigFromValues(values = {}) {
    return {
      url: firstNonEmpty([values.LIDARR_URL, values.LIDARR_BASE_URL], config?.lidarr?.url || "").replace(/\/$/, ""),
      apiKey: firstNonEmpty([values.LIDARR_API_KEY], config?.lidarr?.apiKey || ""),
      allowInsecureTls: asOptionalBoolean(values.LIDARR_ALLOW_INSECURE_TLS, config?.lidarr?.allowInsecureTls || false),
      rootFolderPath: firstNonEmpty([values.LIDARR_ROOT_FOLDER], config?.lidarr?.rootFolderPath || ""),
      qualityProfileId: asOptionalNumber(values.LIDARR_QUALITY_PROFILE_ID, config?.lidarr?.qualityProfileId || 0),
      metadataProfileId: asOptionalNumber(values.LIDARR_METADATA_PROFILE_ID, config?.lidarr?.metadataProfileId || 0),
      monitor: firstNonEmpty([values.LIDARR_MONITOR], config?.lidarr?.monitor || "all").toLowerCase(),
      monitorNewItems: firstNonEmpty([values.LIDARR_MONITOR_NEW_ITEMS], config?.lidarr?.monitorNewItems || "all").toLowerCase(),
      monitored: asOptionalBoolean(values.LIDARR_MONITORED, config?.lidarr?.monitored !== false),
      searchForMissingAlbums: asOptionalBoolean(
        values.LIDARR_SEARCH_FOR_MISSING_ALBUMS,
        config?.lidarr?.searchForMissingAlbums !== false
      )
    };
  }

  function resolveJellyfinLogDir() {
    const raw = String(config?.jellyfin?.logDir || "").trim() || "/var/log/jellyfin";
    return path.resolve(raw);
  }

  function safeResolveLogFile(baseDir, fileName) {
    const cleaned = path.basename(String(fileName || "").trim());
    if (!cleaned) {
      return "";
    }

    const resolved = path.resolve(baseDir, cleaned);
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== path.join(baseDir, cleaned)) {
      return "";
    }

    return resolved;
  }

  function readTailLines(filePath, maxLines = 500) {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    return lines.slice(-Math.max(1, maxLines)).join("\n");
  }

  function sanitizeServiceName(value) {
    const raw = String(value || "apexflix").trim();
    return /^[a-zA-Z0-9_.@-]+$/.test(raw) ? raw : "";
  }

  function sanitizeAccountName(value, fallback) {
    const raw = String(value || fallback || "").trim();
    return /^[a-z_][a-z0-9_-]*\$?$/i.test(raw) ? raw : "";
  }

  function buildSystemdUnit({ serviceName, user, group, workingDirectory, execStart, nodeEnv }) {
    return [
      "[Unit]",
      `Description=${serviceName} service`,
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      `User=${user}`,
      `Group=${group}`,
      `WorkingDirectory=${workingDirectory}`,
      `Environment=NODE_ENV=${nodeEnv}`,
      `ExecStart=${execStart}`,
      "Restart=always",
      "RestartSec=5",
      "KillSignal=SIGINT",
      "TimeoutStopSec=20",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      ""
    ].join("\n");
  }

  function buildSessionCookie(req, value, maxAgeSeconds) {
    const secure = req.secure ? "; Secure" : "";
    const maxAge = Number.isInteger(maxAgeSeconds) ? `; Max-Age=${maxAgeSeconds}` : "";
    return `apexflix_session=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax${maxAge}${secure}`;
  }

  function issueSession(req, res, userId, username) {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    db.createSession({ token, userId, expiresAt });

    res.setHeader("Set-Cookie", buildSessionCookie(req, token, 604800));

    return res.json({ ok: true, username });
  }

  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "apexflix-community-bot",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  router.get("/setup/status", (req, res) => {
    const setupRequired = db.countAdminUsers() === 0;
    res.json({
      ok: true,
      setupRequired,
      allowedKeys: envManager.allowedKeys,
      values: envManager.getCurrentSettings()
    });
  });

  router.post("/setup/initialize", (req, res) => {
    if (db.countAdminUsers() > 0) {
      return res.status(409).json({ error: "Setup is already complete" });
    }

    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const values = req.body?.values;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    if (!values || typeof values !== "object") {
      return res.status(400).json({ error: "Configuration values are required" });
    }

    if (db.findAdminByUsername(username)) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const userId = db.createAdminUser({
      username,
      passwordHash: hashPassword(password)
    });

    envManager.saveSettings(values);
    if (typeof config.refreshConfigFromProcess === "function") {
      config.refreshConfigFromProcess();
    }

    return issueSession(req, res, Number(userId), username);
  });

  router.post("/auth/login", (req, res) => {
    if (db.countAdminUsers() === 0) {
      return res.status(409).json({ error: "Setup is not complete yet" });
    }

    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const user = db.findAdminByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    return issueSession(req, res, user.id, user.username);
  });

  router.post("/auth/logout", authMiddleware, (req, res) => {
    db.deleteSession(req.auth.token);
    res.setHeader("Set-Cookie", buildSessionCookie(req, "", 0));
    res.json({ ok: true });
  });

  router.get("/auth/me", authMiddleware, (req, res) => {
    res.json({ ok: true, user: req.auth.user });
  });

  router.post("/auth/change-password", authMiddleware, (req, res) => {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const user = db.findAdminById(req.auth.user.id);
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    db.updateAdminPassword({ userId: user.id, passwordHash: hashPassword(newPassword) });
    return res.json({ ok: true });
  });

  router.get("/admin/env", authMiddleware, (req, res) => {
    res.json({
      ok: true,
      allowedKeys: envManager.allowedKeys,
      values: envManager.getCurrentSettings()
    });
  });

  router.get("/admin/bot-config", authMiddleware, (req, res) => {
    const merged = {
      ...DEFAULT_BOT_CONFIG,
      ...normalizeBotConfig(db.getBotConfig())
    };

    res.json({ ok: true, values: merged });
  });

  router.post("/admin/bot-config", authMiddleware, (req, res) => {
    const values = req.body?.values;
    if (!values || typeof values !== "object") {
      return res.status(400).json({ error: "values object is required" });
    }

    const normalized = normalizeBotConfig(values);
    db.saveBotConfig(normalized);

    return res.json({
      ok: true,
      message: "Discord bot configuration saved.",
      values: normalized
    });
  });

  router.post("/admin/news/send", authMiddleware, async (req, res, next) => {
    try {
      if (!bot || typeof bot.sendDailyNewsReport !== "function") {
        return res.status(503).json({ error: "Discord bot is not ready for daily news dispatch." });
      }

      const result = await bot.sendDailyNewsReport({ forced: true });
      if (!result?.ok) {
        return res.status(400).json({ error: result?.message || "Daily news report could not be sent." });
      }

      return res.json({
        ok: true,
        message: `Daily news report sent to channel ${result.channelId}.`,
        details: {
          availableCount: result.availableCount,
          usage: result.usage
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/jellyfin/publish-now-playing", authMiddleware, async (req, res, next) => {
    try {
      if (!bot || typeof bot.publishJellyfinNowPlayingSnapshot !== "function") {
        return res.status(503).json({ error: "Discord bot is not ready for Jellyfin publish actions." });
      }

      const result = await bot.publishJellyfinNowPlayingSnapshot({ forced: true });
      if (!result?.ok) {
        return res.status(400).json({ error: result?.message || "Now playing publish failed." });
      }

      return res.json({
        ok: true,
        message: `Now playing snapshot sent to channel ${result.channelId}.`,
        details: result
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/jellyfin/publish-stats", authMiddleware, async (req, res, next) => {
    try {
      if (!bot || typeof bot.publishJellyfinStatsSnapshot !== "function") {
        return res.status(503).json({ error: "Discord bot is not ready for Jellyfin publish actions." });
      }

      const result = await bot.publishJellyfinStatsSnapshot({ forced: true });
      if (!result?.ok) {
        return res.status(400).json({ error: result?.message || "Jellyfin stats publish failed." });
      }

      return res.json({
        ok: true,
        message: `Jellyfin stats snapshot sent to channel ${result.channelId}.`,
        details: result
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/jellyfin/logs/files", authMiddleware, (req, res, next) => {
    try {
      const dir = resolveJellyfinLogDir();
      if (!fs.existsSync(dir)) {
        return res.status(404).json({
          error: `Jellyfin log directory not found: ${dir}`,
          directory: dir,
          files: []
        });
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => {
          const fullPath = path.join(dir, e.name);
          const stat = fs.statSync(fullPath);
          return {
            name: e.name,
            size: stat.size,
            mtime: stat.mtime.toISOString()
          };
        })
        .filter((f) => /\.log$/i.test(f.name) || /(jellyfin|transcode)/i.test(f.name))
        .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
        .slice(0, 200);

      return res.json({ ok: true, directory: dir, files });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/jellyfin/logs/read", authMiddleware, (req, res, next) => {
    try {
      const dir = resolveJellyfinLogDir();
      const file = String(req.query.file || "").trim();
      const lines = Math.min(Math.max(Number(req.query.lines) || 400, 20), 5000);

      if (!file) {
        return res.status(400).json({ error: "file query is required" });
      }

      const filePath = safeResolveLogFile(dir, file);
      if (!filePath) {
        return res.status(400).json({ error: "Invalid file name." });
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `Log file not found: ${file}` });
      }

      const content = readTailLines(filePath, lines);
      return res.json({
        ok: true,
        directory: dir,
        file,
        content
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/notifications/test", authMiddleware, async (req, res, next) => {
    try {
      const target = String(req.body?.target || "").trim();
      if (!target) {
        return res.status(400).json({ error: "target is required" });
      }

      if (!bot || typeof bot.sendManualChannelTest !== "function") {
        return res.status(503).json({ error: "Discord bot is not ready for manual test notifications." });
      }

      const result = await bot.sendManualChannelTest({ target });
      if (!result?.ok) {
        return res.status(400).json({ error: result?.message || "Manual test send failed." });
      }

      return res.json({
        ok: true,
        message: `Manual test sent to ${result.channelKey}.`,
        details: result
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/systemd/deploy", authMiddleware, async (req, res, next) => {
    try {
      if (process.platform !== "linux") {
        return res.status(400).json({
          error: "Systemd deployment is only supported on Linux hosts.",
          details: { platform: process.platform }
        });
      }

      const requested = req.body || {};
      const serviceName = sanitizeServiceName(requested.serviceName || "apexflix");
      if (!serviceName) {
        return res.status(400).json({ error: "serviceName contains invalid characters." });
      }

      const currentUser = String(process.env.USER || process.env.LOGNAME || "apexflix");
      const user = sanitizeAccountName(requested.user, currentUser);
      const group = sanitizeAccountName(requested.group, user || currentUser);
      if (!user || !group) {
        return res.status(400).json({ error: "user/group contains invalid characters." });
      }

      const workingDirectory = path.resolve(String(requested.workingDirectory || process.cwd()));
      if (!fs.existsSync(workingDirectory)) {
        return res.status(400).json({ error: `Working directory does not exist: ${workingDirectory}` });
      }

      const execStart = String(requested.execStart || "/usr/bin/npm start").trim();
      if (!execStart) {
        return res.status(400).json({ error: "execStart is required." });
      }

      const nodeEnv = String(requested.nodeEnv || "production").trim() || "production";

      const unit = buildSystemdUnit({
        serviceName,
        user,
        group,
        workingDirectory,
        execStart,
        nodeEnv
      });

      const workspaceUnitPath = path.join(process.cwd(), "deploy", "systemd", `${serviceName}.service`);
      fs.mkdirSync(path.dirname(workspaceUnitPath), { recursive: true });
      fs.writeFileSync(workspaceUnitPath, unit, "utf8");

      const installPath = `/etc/systemd/system/${serviceName}.service`;

      return res.json({
        ok: true,
        message: `Systemd unit file generated at ${workspaceUnitPath}. No service actions were run from web UI.`,
        serviceName,
        workspaceUnitPath,
        installPath,
        mode: "generate-only",
        recommendedManualCommands: [
          "# Stop the currently running foreground bot first to avoid port conflicts",
          "# Example: pkill -f \"node src/index.js\"",
          `sudo cp ${workspaceUnitPath} ${installPath}`,
          "sudo systemctl daemon-reload",
          `sudo systemctl enable ${serviceName}`,
          `sudo systemctl restart ${serviceName}`,
          `sudo systemctl status ${serviceName}`
        ],
        unit
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/requests/backfill", authMiddleware, async (req, res, next) => {
    try {
      const requestIds = db.getAllRequestIds();
      let updated = 0;
      let skipped = 0;

      for (const requestId of requestIds) {
        try {
          const details = await overseerr.getRequestById(requestId);
          if (!details || typeof details !== "object") {
            skipped += 1;
            continue;
          }

          const media = details.media || details.request?.media || {};
          let title =
            media.title ||
            media.name ||
            details.subject ||
            details.title ||
            "Unknown title";

          let mediaType =
            String(details.type || media.mediaType || media.type || "unknown").toLowerCase();
          const mediaId = Number(media.tmdbId || media.id || details.mediaId || 0);
          const snapshot =
            typeof overseerr.resolveStatusSnapshot === "function"
              ? overseerr.resolveStatusSnapshot(details)
              : {
                  status: Number(details.status || 0),
                  statusText: overseerr.getRequestStatusText(Number(details.status || 0))
                };
          const status = Number(snapshot.status || 0);

          if (title === "Unknown title" && mediaId > 0) {
            const fallback = await overseerr.getMediaByTmdbId(mediaId, mediaType);
            if (fallback) {
              title = firstNonEmpty([fallback.title, title], "Unknown title");
              mediaType = firstNonEmpty([fallback.mediaType, mediaType], "unknown").toLowerCase();
            }
          }

          db.upsertRequestEvent({
            requestId: details.id || requestId,
            mediaType: mediaType === "movie" || mediaType === "tv" ? mediaType : "unknown",
            mediaId,
            title,
            status,
            statusText: snapshot.statusText || overseerr.getRequestStatusText(status),
            requestedBy: details.requestedBy?.id
          });

          updated += 1;
        } catch (error) {
          skipped += 1;
        }
      }

      return res.json({
        ok: true,
        updated,
        skipped,
        total: requestIds.length,
        message: `Backfill complete. Updated ${updated} request rows; skipped ${skipped}.`
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/env", authMiddleware, (req, res) => {
    const values = req.body?.values;
    if (!values || typeof values !== "object") {
      return res.status(400).json({ error: "values object is required" });
    }

    const next = envManager.saveSettings(values);
    if (typeof config.refreshConfigFromProcess === "function") {
      config.refreshConfigFromProcess();
    }

    return res.json({
      ok: true,
      message:
        "Saved to .env and applied to runtime. Discord token/client/guild changes require app restart to reconnect bot.",
      values: next
    });
  });

  router.post("/admin/overseerr/test", authMiddleware, async (req, res, next) => {
    try {
      const values = req.body?.values;
      if (!values || typeof values !== "object") {
        return res.status(400).json({ error: "values object is required" });
      }

      const testClient = createOverseerrClient(buildOverseerrConfigFromValues(values));
      const recent = await testClient.getRecentRequests(1);
      return res.json({
        ok: true,
        message: "Connected to Overseerr.",
        details: {
          recentRequestsChecked: Array.isArray(recent) ? recent.length : 0
        }
      });
    } catch (error) {
      next(new Error(`Overseerr test failed: ${error.message}`));
    }
  });

  router.post("/admin/jellyfin/test", authMiddleware, async (req, res, next) => {
    try {
      const values = req.body?.values;
      if (!values || typeof values !== "object") {
        return res.status(400).json({ error: "values object is required" });
      }

      const testClient = createJellyfinClient(buildJellyfinConfigFromValues(values));
      const [stats, sections] = await Promise.all([
        testClient.getUsageStats(),
        testClient.getLibrarySections()
      ]);

      return res.json({
        ok: true,
        message: "Connected to Jellyfin.",
        details: {
          activeSessions: Number(stats?.activeSessions || 0),
          movieCount: Number(stats?.movieCount || 0),
          seriesCount: Number(stats?.seriesCount || 0),
          librarySections: Array.isArray(sections) ? sections.length : 0
        }
      });
    } catch (error) {
      next(new Error(`Jellyfin test failed: ${error.message}`));
    }
  });

  router.post("/admin/lidarr/test", authMiddleware, async (req, res, next) => {
    try {
      const values = req.body?.values;
      if (!values || typeof values !== "object") {
        return res.status(400).json({ error: "values object is required" });
      }

      const testClient = createLidarrClient(buildLidarrConfigFromValues(values));
      const options = await testClient.getOptions();

      return res.json({
        ok: true,
        message: `Connected to Lidarr. Loaded ${options.rootFolders.length} root folders, ${options.qualityProfiles.length} quality profiles, and ${options.metadataProfiles.length} metadata profiles.`,
        ...options
      });
    } catch (error) {
      next(new Error(`Lidarr test failed: ${error.message}`));
    }
  });

  router.use(authMiddleware);

  // ---- Logs endpoints -------------------------------------------------
  router.get("/admin/logs", (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 500, 5000);
      const level = String(req.query.level || "").trim();
      const search = String(req.query.search || "").trim();

      if (!logger || typeof logger.getRecentLogs !== "function") {
        return res.status(503).json({ error: "Logging service unavailable." });
      }

      const logs = logger.getRecentLogs({ limit, level, search });
      return res.json({ ok: true, logs, filePath: logger.filePath || "" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/logs/clear", (req, res, next) => {
    try {
      if (!logger || typeof logger.clearLogs !== "function") {
        return res.status(503).json({ error: "Logging service unavailable." });
      }

      logger.clearLogs();
      return res.json({ ok: true, message: "Logs cleared." });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/logs/download", (req, res, next) => {
    try {
      if (!logger || !logger.filePath) {
        return res.status(503).json({ error: "Logging service unavailable." });
      }

      const filePath = logger.filePath;
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Log file not found." });
      }

      return res.download(filePath, path.basename(filePath));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/logs/stream", (req, res, next) => {
    try {
      if (!logger || !logger.events) {
        return res.status(503).json({ error: "Logging service unavailable." });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders && res.flushHeaders();

      const onLog = (entry) => {
        try {
          res.write(`data: ${JSON.stringify(entry)}\n\n`);
        } catch (e) {
          // ignore
        }
      };

      const onCleared = () => {
        try {
          res.write(`event: cleared\ndata: {}\n\n`);
        } catch (e) {}
      };

      logger.events.on("log", onLog);
      logger.events.on("cleared", onCleared);

      req.on("close", () => {
        logger.events.removeListener("log", onLog);
        logger.events.removeListener("cleared", onCleared);
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/requests/recent", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = db.getRecentRequestEvents(limit);
    res.json({ count: rows.length, rows });
  });

  router.get("/jellyfin/latest", async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 12, 50);
      const items = await jellyfin.getLatestItems(limit);
      res.json({ count: items.length, items });
    } catch (error) {
      next(new Error(`Jellyfin latest failed: ${error.message}`));
    }
  });

  router.get("/jellyfin/stats", async (req, res, next) => {
    try {
      const stats = await jellyfin.getUsageStats();
      res.json({ ok: true, ...stats });
    } catch (error) {
      next(new Error(`Jellyfin stats failed: ${error.message}`));
    }
  });

  router.get("/jellyfin/now-playing", async (req, res, next) => {
    try {
      const data = await jellyfin.getNowPlaying();
      res.json({ ok: true, activeSessions: data.activeSessions, nowPlaying: data.nowPlaying });
    } catch (error) {
      next(new Error(`Jellyfin now-playing failed: ${error.message}`));
    }
  });

  router.get("/jellyfin/libraries", async (req, res, next) => {
    try {
      const libraries = await jellyfin.getLibrarySections();
      res.json({ ok: true, libraries });
    } catch (error) {
      next(new Error(`Jellyfin libraries failed: ${error.message}`));
    }
  });

  router.get("/seerr/issues", async (req, res, next) => {
    try {
      const issues = await overseerr.getRecentIssues(50);
      res.json({ ok: true, issues });
    } catch (error) {
      next(new Error(`Overseerr issues failed: ${error.message}`));
    }
  });

  router.post("/seerr/issues/:id/comment", async (req, res, next) => {
    try {
      const issueId = Number(req.params.id);
      const message = String(req.body?.message || "").trim();

      if (!Number.isInteger(issueId) || issueId <= 0) {
        return res.status(400).json({ error: "Invalid issue ID." });
      }
      if (!message) {
        return res.status(400).json({ error: "Message cannot be empty." });
      }

      const result = await overseerr.createIssueComment(issueId, message);
      return res.json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/request", async (req, res, next) => {
    try {
      const { mediaType, mediaId, mediaQuery, discordUserId } = req.body;

      if (mediaType === "music") {
        const query = String(mediaQuery || mediaId || "").trim();
        if (!query) {
          return res.status(400).json({ error: "mediaQuery is required for music requests" });
        }

        if (!lidarr || typeof lidarr.searchArtists !== "function" || typeof lidarr.addArtist !== "function") {
          return res.status(503).json({ error: "Lidarr service is unavailable." });
        }

        const results = await lidarr.searchArtists(query);
        if (!results.length) {
          return res.status(404).json({ error: `No Lidarr artist found for: ${query}` });
        }

        const selected = results.find((item) => !item.inLibrary) || results[0];
        if (selected.inLibrary) {
          return res.json({
            ok: true,
            requestId: null,
            status: 4,
            statusText: "Already in Lidarr",
            title: selected.artistName || query
          });
        }

        const created = await lidarr.addArtist({
          artist: selected.payload,
          options: lidarr.getDefaults()
        });

        const title = String(created.artistName || selected.artistName || query).trim();
        const localArtistId = Number(created.id || 0);
        const requestId = -Math.max(localArtistId || Date.now(), 1);

        db.upsertRequestEvent({
          requestId,
          mediaType: "music",
          mediaId: localArtistId > 0 ? localArtistId : 0,
          title,
          status: 2,
          statusText: "Added to Lidarr",
          requestedBy: null
        });

        return res.json({
          ok: true,
          requestId,
          status: 2,
          statusText: "Added to Lidarr",
          title
        });
      }

      if (!["movie", "tv"].includes(mediaType)) {
        return res.status(400).json({ error: "mediaType must be movie, tv, or music" });
      }

      if (!Number.isInteger(mediaId) || mediaId <= 0) {
        return res.status(400).json({ error: "mediaId must be a positive integer" });
      }

      let userId = config.overseerr.defaultUserId;
      if (discordUserId) {
        const linked = db.getUserLinkByDiscordId(String(discordUserId));
        if (linked) {
          userId = linked.overseerr_user_id;
        }
      }

      const request = await overseerr.requestMedia({ mediaType, mediaId, userId });
      const requestId = request.id || request.request?.id;
      const status = request.status || request.request?.status || 1;
      const title =
        request.media?.title || request.media?.name || `TMDB ${mediaType} ${mediaId}`;

      if (requestId) {
        db.upsertRequestEvent({
          requestId,
          mediaType,
          mediaId,
          title,
          status,
          statusText: overseerr.getRequestStatusText(status),
          requestedBy: userId
        });
      }

      return res.json({
        ok: true,
        requestId,
        status,
        statusText: overseerr.getRequestStatusText(status),
        title
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/lidarr/options", async (req, res, next) => {
    try {
      if (!lidarr || typeof lidarr.getOptions !== "function") {
        return res.status(503).json({ error: "Lidarr service is unavailable." });
      }

      const options = await lidarr.getOptions();
      return res.json({ ok: true, ...options });
    } catch (error) {
      next(new Error(`Lidarr options failed: ${error.message}`));
    }
  });

  router.get("/lidarr/stats", async (req, res, next) => {
    try {
      if (!lidarr || typeof lidarr.getLibraryStats !== "function") {
        return res.status(503).json({ error: "Lidarr service is unavailable." });
      }

      const stats = await lidarr.getLibraryStats();
      return res.json({ ok: true, ...stats });
    } catch (error) {
      next(new Error(`Lidarr stats failed: ${error.message}`));
    }
  });

  router.get("/lidarr/artists", async (req, res, next) => {
    try {
      if (!lidarr || typeof lidarr.getRecentArtists !== "function") {
        return res.status(503).json({ error: "Lidarr service is unavailable." });
      }

      const limit = Math.min(Number(req.query.limit) || 12, 50);
      const artists = await lidarr.getRecentArtists(limit);
      return res.json({ ok: true, count: artists.length, artists });
    } catch (error) {
      next(new Error(`Lidarr artists failed: ${error.message}`));
    }
  });

  router.get("/lidarr/genres", async (req, res, next) => {
    try {
      if (!lidarr || typeof lidarr.getTopGenres !== "function") {
        return res.status(503).json({ error: "Lidarr service is unavailable." });
      }

      const limit = Math.min(Number(req.query.limit) || 8, 20);
      const genres = await lidarr.getTopGenres(limit);
      return res.json({ ok: true, count: genres.length, genres });
    } catch (error) {
      next(new Error(`Lidarr genres failed: ${error.message}`));
    }
  });

  router.get("/lidarr/search", async (req, res, next) => {
    try {
      if (!lidarr || typeof lidarr.searchArtists !== "function") {
        return res.status(503).json({ error: "Lidarr service is unavailable." });
      }

      const query = String(req.query.query || "").trim();
      if (!query) {
        return res.status(400).json({ error: "query is required" });
      }

      const results = await lidarr.searchArtists(query);
      return res.json({ ok: true, count: results.length, results });
    } catch (error) {
      next(new Error(`Lidarr search failed: ${error.message}`));
    }
  });

  router.post("/lidarr/request", async (req, res, next) => {
    try {
      if (!lidarr || typeof lidarr.addArtist !== "function") {
        return res.status(503).json({ error: "Lidarr service is unavailable." });
      }

      const artist = req.body?.artist;
      const options = req.body?.options || {};
      if (!artist || typeof artist !== "object") {
        return res.status(400).json({ error: "artist payload is required" });
      }

      const created = await lidarr.addArtist({ artist, options });
      const localArtistId = Number(created.id || 0);
      const title = String(created.artistName || artist.artistName || artist.sortName || "Unknown artist").trim();
      const requestId = -Math.max(localArtistId || Date.now(), 1);

      db.upsertRequestEvent({
        requestId,
        mediaType: "music",
        mediaId: localArtistId > 0 ? localArtistId : 0,
        title,
        status: 2,
        statusText: "Added to Lidarr",
        requestedBy: req.auth?.user?.id || null
      });

      return res.json({
        ok: true,
        requestId,
        title,
        status: 2,
        statusText: "Added to Lidarr",
        artist: created
      });
    } catch (error) {
      next(new Error(`Lidarr request failed: ${error.message}`));
    }
  });

  return router;
}

module.exports = { createApiRouter };
