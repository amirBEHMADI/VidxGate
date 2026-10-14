const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "..", "data", "bot.db");

// Create data directory if it does not exist
const fs = require("fs");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Table creation

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY,
    username      TEXT,
    first_name    TEXT,
    joined_at     DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT UNIQUE NOT NULL,
    file_id       TEXT NOT NULL,
    caption       TEXT DEFAULT '',
    views         INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sponsors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id    TEXT NOT NULL UNIQUE,
    channel_name  TEXT NOT NULL,
    channel_link  TEXT NOT NULL,
    is_active     INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS download_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    video_code    TEXT NOT NULL,
    downloaded_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS admins (
    user_id       INTEGER PRIMARY KEY,
    name          TEXT DEFAULT '',
    can_manage_videos   INTEGER DEFAULT 1,
    can_manage_sponsors INTEGER DEFAULT 0,
    can_broadcast       INTEGER DEFAULT 0,
    added_at      DATETIME DEFAULT (datetime('now'))
  );
`);

// Prepared statements

const stmts = {
  // Users
  upsertUser: db.prepare(`
    INSERT INTO users (user_id, username, first_name)
    VALUES (@user_id, @username, @first_name)
    ON CONFLICT(user_id) DO UPDATE SET
      username = @username,
      first_name = @first_name
  `),

  getUser: db.prepare(`SELECT * FROM users WHERE user_id = ?`),

  getUserCount: db.prepare(`SELECT COUNT(*) as count FROM users`),

  // Videos
  insertVideo: db.prepare(`
    INSERT INTO videos (code, file_id, caption)
    VALUES (@code, @file_id, @caption)
  `),

  getVideoByCode: db.prepare(`SELECT * FROM videos WHERE code = ?`),

  incrementViews: db.prepare(`UPDATE videos SET views = views + 1 WHERE code = ?`),

  getAllVideos: db.prepare(`SELECT * FROM videos ORDER BY created_at DESC`),

  getVideoCount: db.prepare(`SELECT COUNT(*) as count FROM videos`),

  deleteVideo: db.prepare(`DELETE FROM videos WHERE code = ?`),

  // Sponsors
  insertSponsor: db.prepare(`
    INSERT INTO sponsors (channel_id, channel_name, channel_link)
    VALUES (@channel_id, @channel_name, @channel_link)
  `),

  getActiveSponsors: db.prepare(`SELECT * FROM sponsors WHERE is_active = 1`),

  getAllSponsors: db.prepare(`SELECT * FROM sponsors ORDER BY id DESC`),

  toggleSponsor: db.prepare(`UPDATE sponsors SET is_active = @is_active WHERE id = @id`),

  deleteSponsor: db.prepare(`DELETE FROM sponsors WHERE id = ?`),

  // Download log
  logDownload: db.prepare(`
    INSERT INTO download_log (user_id, video_code)
    VALUES (@user_id, @video_code)
  `),

  getDailyDownloadCount: db.prepare(`
    SELECT COUNT(*) as count FROM download_log
    WHERE user_id = ? AND downloaded_at >= datetime('now', '-1 day')
  `),

  getTotalDownloads: db.prepare(`SELECT COUNT(*) as count FROM download_log`),

  // Admins
  upsertAdmin: db.prepare(`
    INSERT INTO admins (user_id, name, can_manage_videos, can_manage_sponsors, can_broadcast)
    VALUES (@user_id, @name, @can_manage_videos, @can_manage_sponsors, @can_broadcast)
    ON CONFLICT(user_id) DO UPDATE SET
      name = @name,
      can_manage_videos = @can_manage_videos,
      can_manage_sponsors = @can_manage_sponsors,
      can_broadcast = @can_broadcast
  `),

  getAdmin: db.prepare(`SELECT * FROM admins WHERE user_id = ?`),

  getAllAdmins: db.prepare(`SELECT * FROM admins ORDER BY added_at DESC`),

  deleteAdmin: db.prepare(`DELETE FROM admins WHERE user_id = ?`),
};

module.exports = { db, stmts };

