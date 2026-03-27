const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function initializeDatabase(logger) {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "app.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_links (
      discord_user_id TEXT PRIMARY KEY,
      overseerr_user_id INTEGER NOT NULL,
      overseerr_username TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_events (
      request_id INTEGER PRIMARY KEY,
      media_type TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status INTEGER NOT NULL,
      status_text TEXT NOT NULL,
      requested_by INTEGER,
      last_checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS web_sessions (
      session_token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES admin_users(id)
    );
  `);

  logger.info(`SQLite database initialized at ${dbPath}`);

  const upsertLinkStmt = db.prepare(`
    INSERT INTO user_links (discord_user_id, overseerr_user_id, overseerr_username, created_at)
    VALUES (@discordUserId, @overseerrUserId, @overseerrUsername, @createdAt)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      overseerr_user_id=excluded.overseerr_user_id,
      overseerr_username=excluded.overseerr_username
  `);

  const findLinkByDiscordStmt = db.prepare(
    "SELECT * FROM user_links WHERE discord_user_id = ?"
  );

  const findLinkByOverseerrStmt = db.prepare(
    "SELECT * FROM user_links WHERE overseerr_user_id = ?"
  );

  const upsertRequestStmt = db.prepare(`
    INSERT INTO request_events (
      request_id, media_type, media_id, title, status, status_text, requested_by, last_checked_at
    ) VALUES (
      @requestId, @mediaType, @mediaId, @title, @status, @statusText, @requestedBy, @lastCheckedAt
    )
    ON CONFLICT(request_id) DO UPDATE SET
      status=excluded.status,
      status_text=excluded.status_text,
      last_checked_at=excluded.last_checked_at,
      title=excluded.title,
      requested_by=excluded.requested_by,
      media_type=excluded.media_type,
      media_id=excluded.media_id
  `);

  const getRequestByIdStmt = db.prepare(
    "SELECT * FROM request_events WHERE request_id = ?"
  );

  const getRecentRequestsStmt = db.prepare(
    "SELECT * FROM request_events ORDER BY last_checked_at DESC LIMIT ?"
  );

  const findAdminByUsernameStmt = db.prepare(
    "SELECT * FROM admin_users WHERE username = ?"
  );

  const findAdminByIdStmt = db.prepare("SELECT * FROM admin_users WHERE id = ?");

  const countAdminsStmt = db.prepare("SELECT COUNT(*) AS count FROM admin_users");

  const insertAdminStmt = db.prepare(
    "INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)"
  );

  const createSessionStmt = db.prepare(
    "INSERT INTO web_sessions (session_token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  );

  const findSessionStmt = db.prepare(
    "SELECT * FROM web_sessions WHERE session_token = ?"
  );

  const deleteSessionStmt = db.prepare(
    "DELETE FROM web_sessions WHERE session_token = ?"
  );

  const pruneSessionsStmt = db.prepare(
    "DELETE FROM web_sessions WHERE datetime(expires_at) <= datetime('now')"
  );

  const updateAdminPasswordStmt = db.prepare(
    "UPDATE admin_users SET password_hash = ? WHERE id = ?"
  );

  return {
    upsertUserLink: ({ discordUserId, overseerrUserId, overseerrUsername }) => {
      upsertLinkStmt.run({
        discordUserId,
        overseerrUserId,
        overseerrUsername,
        createdAt: new Date().toISOString()
      });
    },
    getUserLinkByDiscordId: (discordUserId) =>
      findLinkByDiscordStmt.get(discordUserId) || null,
    getUserLinkByOverseerrId: (overseerrUserId) =>
      findLinkByOverseerrStmt.get(overseerrUserId) || null,
    upsertRequestEvent: (record) => {
      upsertRequestStmt.run({
        requestId: record.requestId,
        mediaType: record.mediaType,
        mediaId: record.mediaId,
        title: record.title,
        status: record.status,
        statusText: record.statusText,
        requestedBy: record.requestedBy || null,
        lastCheckedAt: new Date().toISOString()
      });
    },
    getRequestEventById: (requestId) => getRequestByIdStmt.get(requestId) || null,
    getRecentRequestEvents: (limit = 20) => getRecentRequestsStmt.all(limit),
    countAdminUsers: () => countAdminsStmt.get()?.count || 0,
    createAdminUser: ({ username, passwordHash }) => {
      const result = insertAdminStmt.run(username, passwordHash, new Date().toISOString());
      return result.lastInsertRowid;
    },
    findAdminByUsername: (username) => findAdminByUsernameStmt.get(username) || null,
    findAdminById: (id) => findAdminByIdStmt.get(id) || null,
    createSession: ({ token, userId, expiresAt }) => {
      createSessionStmt.run(token, userId, expiresAt, new Date().toISOString());
    },
    getSessionByToken: (token) => findSessionStmt.get(token) || null,
    deleteSession: (token) => {
      deleteSessionStmt.run(token);
    },
    pruneExpiredSessions: () => {
      pruneSessionsStmt.run();
    },
    updateAdminPassword: ({ userId, passwordHash }) => {
      updateAdminPasswordStmt.run(passwordHash, userId);
    }
  };
}

module.exports = { initializeDatabase };
