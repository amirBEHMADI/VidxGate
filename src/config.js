const path = require("path");
require("dotenv").config();

module.exports = {
  // Bot token
  BOT_TOKEN: process.env.BOT_TOKEN,

  // Admin Telegram ID
  ADMIN_ID: Number(process.env.ADMIN_ID),

  // Main channel ID
  MAIN_CHANNEL_ID: process.env.MAIN_CHANNEL_ID,

  // Post channel ID (where banners are published)
  POST_CHANNEL_ID: process.env.POST_CHANNEL_ID || process.env.MAIN_CHANNEL_ID,

  // Storage channel ID (where big video files are uploaded to get file_id)
  STORAGE_CHANNEL_ID: process.env.STORAGE_CHANNEL_ID || process.env.MAIN_CHANNEL_ID,

  // Telegram API ID & Hash for GramJS (uploading up to 2GB)
  TELEGRAM_API_ID: process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : null,
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || null,

  // Temporary download directory
  TEMP_DIR: process.env.TEMP_DIR || path.join(__dirname, "..", "temp"),

  // Video deletion delay in seconds
  VIDEO_DELETE_DELAY: Number(process.env.VIDEO_DELETE_DELAY) || 30,

  // Daily download limit (0 = unlimited)
  DAILY_LIMIT: Number(process.env.DAILY_LIMIT) || 0,

  // GramJS upload settings
  UPLOAD_TIMEOUT_MINUTES: Number(process.env.UPLOAD_TIMEOUT_MINUTES) || 0,
  UPLOAD_WORKERS: Number(process.env.UPLOAD_WORKERS) || 4,
};

