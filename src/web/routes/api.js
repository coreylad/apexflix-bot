const express = require("express");
const { generateSessionToken, verifyPassword, hashPassword } = require("../../services/security");

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

function createApiRouter({ db, overseerr, jellyfin, config, envManager }) {
  const router = express.Router();
  const authMiddleware = requireAuth(db);

  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "apexflix-community-bot",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  router.post("/auth/login", (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const user = db.findAdminByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    db.createSession({ token, userId: user.id, expiresAt });

    res.setHeader(
      "Set-Cookie",
      `apexflix_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`
    );

    return res.json({ ok: true, username: user.username });
  });

  router.post("/auth/logout", authMiddleware, (req, res) => {
    db.deleteSession(req.auth.token);
    res.setHeader(
      "Set-Cookie",
      "apexflix_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
    );
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
