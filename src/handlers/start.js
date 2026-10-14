const { stmts } = require("../database/db");
const { checkMembership } = require("../middlewares/membership");
const { buildSponsorKeyboard } = require("../utils/keyboard");
const { delay } = require("../utils/helpers");
const logger = require("../utils/logger");
const config = require("../config");

/**
 * هندلر دستور /start
 * پشتیبانی از Deep Link برای دریافت ویدیو
 */
function registerStartHandler(bot) {
  bot.command("start", async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || "";
    const firstName = ctx.from.first_name || "";

    // Save or update user
    stmts.upsertUser.run({
      user_id: userId,
      username,
      first_name: firstName,
    });

    // Extract video code from deep link
    const videoCode = ctx.match;

    // If opened without deep link, show welcome message
    if (!videoCode) {
      logger.info(`User ${userId} started bot without deep link.`);
      await ctx.reply(
        `سلام ${firstName} عزیز! 👋\n\n` +
          `🎓 به ربات ویدیوهای آموزشی خوش اومدی!\n\n` +
          `📌 برای دریافت ویدیوها، روی لینک‌های کانال کلیک کن.\n\n` +
          `💡 هر ویدیو فقط ۳۰ ثانیه قابل مشاهده‌ست، پس سریع ذخیره کن!`,
        { parse_mode: "HTML" }
      );
      return;
    }

    logger.info(`User ${userId} requested video with code: [${videoCode}]`);

    // Find video by code
    const video = stmts.getVideoByCode.get(videoCode);
    if (!video) {
      logger.warn(`Video with code [${videoCode}] not found in database.`);
      await ctx.reply("❌ ویدیو مورد نظر پیدا نشد یا حذف شده!");
      return;
    }

    // Check daily download limit
    if (config.DAILY_LIMIT > 0) {
      const { count } = stmts.getDailyDownloadCount.get(userId);
      if (count >= config.DAILY_LIMIT) {
        logger.warn(`User ${userId} reached daily download limit (${count}/${config.DAILY_LIMIT}).`);
        await ctx.reply(
          `⚠️ شما امروز به حداکثر تعداد دانلود (${config.DAILY_LIMIT} ویدیو) رسیدید.\n` +
            `فردا دوباره تلاش کنید.`
        );
        return;
      }
    }

    // Check membership in sponsor channels
    const { isMember, notJoined } = await checkMembership(ctx.api, userId);

    if (!isMember) {
      logger.action(`User ${userId} has not joined ${notJoined.length} sponsor channel(s). Sending join gate.`);
      const keyboard = buildSponsorKeyboard(notJoined, videoCode);
      await ctx.reply(
        `📢 <b>برای دریافت ویدیو، ابتدا در کانال‌های زیر عضو شوید:</b>\n\n` +
          `پس از عضویت، دکمه «بررسی مجدد» را بزنید.`,
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
        }
      );
      return;
    }

    logger.success(`Membership verified for user ${userId}. Delivering video [${videoCode}]...`);
    // Send video to user
    await sendVideoToUser(ctx, video);
  });
}

/**
 * ارسال ویدیو به کاربر و حذف بعد از مدت مشخص
 */
async function sendVideoToUser(ctx, video) {
  const userId = ctx.from.id;

  try {
    // Send warning message
    const warningMsg = await ctx.reply(
      `⏳ <b>توجه!</b> ویدیو بعد از <b>${config.VIDEO_DELETE_DELAY} ثانیه</b> حذف خواهد شد.\n` +
        `📥 <i>سریعاً ذخیره کنید!</i>`,
      { parse_mode: "HTML" }
    );

    // Send video
    logger.info(`Sending video [${video.code}] to user ${userId}...`);
    const sentVideo = await ctx.api.sendVideo(userId, video.file_id, {
      caption: video.caption || "",
      parse_mode: "HTML",
    });
    logger.success(`Video [${video.code}] successfully sent to user ${userId} (message_id: ${sentVideo.message_id}).`);

    // Increment view count and log download
    stmts.incrementViews.run(video.code);
    stmts.logDownload.run({ user_id: userId, video_code: video.code });

    // Delete after delay (run asynchronously without blocking request handling)
    (async () => {
      try {
        await delay(config.VIDEO_DELETE_DELAY * 1000);
        await ctx.api.deleteMessage(ctx.chat.id, sentVideo.message_id);
        await ctx.api.deleteMessage(ctx.chat.id, warningMsg.message_id);
        await ctx.reply("🗑️ ویدیو حذف شد. امیدوارم مفید بوده باشه! 🙏");
        logger.info(`Deleted video [${video.code}] messages for user ${userId} after ${config.VIDEO_DELETE_DELAY}s delay.`);
      } catch (deleteError) {
        logger.warn(`Could not delete video message for user ${userId}: ${deleteError.message}`);
      }
    })();
  } catch (error) {
    logger.error(`Error sending video [${video.code}] to user ${userId}:`, error.message);
    await ctx.reply("❌ متأسفانه در ارسال ویدیو خطایی رخ داد. لطفاً دوباره تلاش کنید.");
  }
}

module.exports = { registerStartHandler, sendVideoToUser };

