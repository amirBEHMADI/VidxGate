const { Bot } = require("grammy");
const config = require("./config");
const logger = require("./utils/logger");
const { registerStartHandler } = require("./handlers/start");
const { registerAdminHandler } = require("./handlers/admin");
const { registerPostHandler } = require("./handlers/post");
const { registerCallbackHandler } = require("./handlers/callbacks");

// Check bot token
if (!config.BOT_TOKEN) {
  logger.error("BOT_TOKEN is not configured! Please check your .env file.");
  process.exit(1);
}

// Initialize bot instance
const bot = new Bot(config.BOT_TOKEN);

// Global logging middleware for updates
bot.use(async (ctx, next) => {
  const from = ctx.from ? `${ctx.from.first_name} (@${ctx.from.username || "no_user"}, ID: ${ctx.from.id})` : "Unknown";
  if (ctx.message?.text) {
    logger.info(`Received text: "${ctx.message.text}" from ${from}`);
  } else if (ctx.message?.video) {
    logger.info(`Received video from ${from}`);
  } else if (ctx.callbackQuery) {
    logger.info(`Received callback: "${ctx.callbackQuery.data}" from ${from}`);
  }
  await next();
});

// Error handler
bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Error handling update ${ctx.update.update_id}:`, err.error);
});

// Register handlers
registerStartHandler(bot);
registerPostHandler(bot);
registerAdminHandler(bot);
registerCallbackHandler(bot);


// Start bot polling
bot.start({
  onStart: (botInfo) => {
    console.log("======================================");
    logger.success(`Bot @${botInfo.username} is active!`);
    logger.info(`Admin ID: ${config.ADMIN_ID}`);
    logger.info(`Channel ID: ${config.MAIN_CHANNEL_ID}`);
    logger.info(`Video delete delay: ${config.VIDEO_DELETE_DELAY} seconds`);
    console.log("======================================");
  },
});

// Graceful shutdown
const stopSignals = ["SIGINT", "SIGTERM"];
stopSignals.forEach((signal) => {
  process.on(signal, () => {
    logger.warn(`Received ${signal}. Shutting down bot gracefully...`);
    bot.stop();
    process.exit(0);
  });
});

