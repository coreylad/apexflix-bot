const express = require("express");
const fs = require("fs");
const path = require("path");
const { generateSessionToken, verifyPassword, hashPassword } = require("../../services/security");

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

function createApiRouter({ db, overseerr, jellyfin, config, envManager, bot }) {
  const router = express.Router();
  const authMiddleware = requireAuth(db);

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
          const status = Number(details.status || 0);

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
            statusText: overseerr.getRequestStatusText(status),
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

  router.use(authMiddleware);

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
      const { mediaType, mediaId, discordUserId } = req.body;

      if (!["movie", "tv"].includes(mediaType)) {
        return res.status(400).json({ error: "mediaType must be movie or tv" });
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

  return router;
}

module.exports = { createApiRouter };
