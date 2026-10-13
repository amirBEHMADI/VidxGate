require("dotenv").config();

module.exports = {
  // Bot token
  BOT_TOKEN: process.env.BOT_TOKEN,

  // Admin Telegram ID
  ADMIN_ID: Number(process.env.ADMIN_ID),

  // Main channel ID
  MAIN_CHANNEL_ID: process.env.MAIN_CHANNEL_ID,

  // Video deletion delay in seconds
  VIDEO_DELETE_DELAY: Number(process.env.VIDEO_DELETE_DELAY) || 30,

  // Daily download limit (0 = unlimited)
  DAILY_LIMIT: Number(process.env.DAILY_LIMIT) || 0,
};
