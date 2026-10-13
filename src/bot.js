const { Bot } = require("grammy");
const config = require("./config");
const { registerStartHandler } = require("./handlers/start");
const { registerAdminHandler } = require("./handlers/admin");
const { registerCallbackHandler } = require("./handlers/callbacks");

// Check bot token
if (!config.BOT_TOKEN) {
  console.error("BOT_TOKEN is not configured! Please check your .env file.");
  process.exit(1);
}

// Initialize bot instance
const bot = new Bot(config.BOT_TOKEN);

// Error handler
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error handling update ${ctx.update.update_id}:`);
  console.error(err.error);
});

// Register handlers
registerStartHandler(bot);
registerAdminHandler(bot);
registerCallbackHandler(bot);

// Start bot polling
bot.start({
  onStart: (botInfo) => {
    console.log("======================================");
    console.log(`Bot @${botInfo.username} is active!`);
    console.log(`Admin ID: ${config.ADMIN_ID}`);
    console.log(`Channel ID: ${config.MAIN_CHANNEL_ID}`);
    console.log(`Video delete delay: ${config.VIDEO_DELETE_DELAY} seconds`);
    console.log("======================================");
  },
});

// Graceful shutdown
const stopSignals = ["SIGINT", "SIGTERM"];
stopSignals.forEach((signal) => {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}. Shutting down bot gracefully...`);
    bot.stop();
    process.exit(0);
  });
});
