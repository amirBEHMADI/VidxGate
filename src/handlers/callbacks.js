const { stmts } = require("../database/db");
const config = require("../config");
const logger = require("../utils/logger");
const { getPermissions } = require("../utils/permissions");
const { formatNumber } = require("../utils/helpers");
const { checkMembership } = require("../middlewares/membership");
const { sendVideoToUser } = require("./start");
const {
  buildAdminKeyboard,
  buildCancelKeyboard,
  buildSponsorKeyboard,
  buildSponsorManageKeyboard,
  buildAdminManageKeyboard,
} = require("../utils/keyboard");
const { adminState, resetAdminState } = require("./admin");


/**
 * هندلر Callback Query ها
 */
function registerCallbackHandler(bot) {
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    // Re-check membership (regular user)
    if (data.startsWith("check_")) {
      await handleCheckMembership(ctx, data);
      return;
    }

    // Admin permissions check
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) {
      logger.warn(`Unauthorized callback query attempt from ID: ${ctx.from.id}`);
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
      return;
    }

    switch (data) {
      case "admin_stats":
        await handleStats(ctx);
        break;
      case "admin_videos":
        if (!perms.canManageVideos) return ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
        await handleVideoList(ctx);
        break;
      case "admin_sponsors":
        if (!perms.canManageSponsors) return ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
        await handleSponsorList(ctx);
        break;
      case "admin_broadcast":
        if (!perms.canBroadcast) return ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
        await handleBroadcastStart(ctx);
        break;
      case "admin_delete_video":
        if (!perms.canManageVideos) return ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
        await handleDeleteVideoStart(ctx);
        break;
      case "admin_manage_admins":
        if (!perms.isOwner) return ctx.answerCallbackQuery({ text: "⛔ فقط مالک دسترسی دارد!" });
        await handleAdminList(ctx);
        break;
      case "add_admin_start":
        if (!perms.isOwner) return ctx.answerCallbackQuery({ text: "⛔ فقط مالک دسترسی دارد!" });
        await handleAddAdminStart(ctx);
        break;
      case "admin_cancel":
        await handleCancel(ctx, perms);
        break;
      case "admin_back":
        await handleBack(ctx, perms);
        break;
      case "add_sponsor":
        if (!perms.canManageSponsors) return ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
        await handleAddSponsorStart(ctx);
        break;
      default:
        // Dynamic sponsor buttons
        if (data.startsWith("toggle_sponsor_")) {
          if (!perms.canManageSponsors) return ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
          await handleToggleSponsor(ctx, data);
        } else if (data.startsWith("delete_sponsor_")) {
          if (!perms.canManageSponsors) return ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
          await handleDeleteSponsor(ctx, data);
        } else if (data.startsWith("delete_admin_")) {
          if (!perms.isOwner) return ctx.answerCallbackQuery({ text: "⛔ فقط مالک دسترسی دارد!" });
          await handleDeleteAdmin(ctx, data);
        }
    }
  });
}

// Re-check membership handler
async function handleCheckMembership(ctx, data) {
  const videoCode = data.replace("check_", "");
  const userId = ctx.from.id;

  logger.info(`User ${userId} clicked "Check Membership" for video [${videoCode}]`);
  const { isMember, notJoined } = await checkMembership(ctx.api, userId);

  if (!isMember) {
    logger.action(`User ${userId} still not joined ${notJoined.length} channels.`);
    const keyboard = buildSponsorKeyboard(notJoined, videoCode);
    await ctx.answerCallbackQuery({
      text: "❌ هنوز در همه کانال‌ها عضو نشدید!",
      show_alert: true,
    });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    } catch (editError) {
      // Ignore "message is not modified" error from Telegram API
      if (!editError.message?.includes("message is not modified")) {
        logger.error("Error updating reply markup:", editError.message);
      }
    }
    return;
  }

  // Membership confirmed - send video
  logger.success(`Membership confirmed for user ${userId}. Sending video [${videoCode}].`);
  await ctx.answerCallbackQuery({ text: "✅ عضویت تأیید شد!" });
  await ctx.deleteMessage();

  const video = stmts.getVideoByCode.get(videoCode);
  if (!video) {
    await ctx.reply("❌ ویدیو مورد نظر پیدا نشد یا حذف شده!");
    return;
  }

  await sendVideoToUser(ctx, video);
}


// Bot statistics
async function handleStats(ctx) {
  const { count: userCount } = stmts.getUserCount.get();
  const { count: videoCount } = stmts.getVideoCount.get();
  const { count: downloadCount } = stmts.getTotalDownloads.get();
  const sponsorCount = stmts.getActiveSponsors.all().length;

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `📊 <b>آمار ربات</b>\n\n` +
      `👥 کاربران: <b>${formatNumber(userCount)}</b>\n` +
      `🎬 ویدیوها: <b>${formatNumber(videoCount)}</b>\n` +
      `📥 کل دانلودها: <b>${formatNumber(downloadCount)}</b>\n` +
      `📢 اسپانسرهای فعال: <b>${formatNumber(sponsorCount)}</b>`,
    {
      parse_mode: "HTML",
      reply_markup: new (require("grammy").InlineKeyboard)().text("🔙 بازگشت", "admin_back"),
    }
  );
}

// Video list
async function handleVideoList(ctx) {
  const videos = stmts.getAllVideos.all();
  await ctx.answerCallbackQuery();

  if (videos.length === 0) {
    await ctx.editMessageText("📋 هیچ ویدیویی ثبت نشده!", {
      reply_markup: new (require("grammy").InlineKeyboard)().text("🔙 بازگشت", "admin_back"),
    });
    return;
  }

  // Display up to 15 recent videos
  const list = videos.slice(0, 15).map((v, i) => {
    const caption = v.caption ? v.caption.substring(0, 30) : "بدون کپشن";
    return `${i + 1}. <code>${v.code}</code> — ${caption} (👁 ${v.views})`;
  });

  await ctx.editMessageText(
    `📋 <b>لیست ویدیوها</b> (${formatNumber(videos.length)} ویدیو)\n\n` +
      list.join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: new (require("grammy").InlineKeyboard)().text("🔙 بازگشت", "admin_back"),
    }
  );
}

// Sponsor management
async function handleSponsorList(ctx) {
  const sponsors = stmts.getAllSponsors.all();
  await ctx.answerCallbackQuery();

  const keyboard = buildSponsorManageKeyboard(sponsors);

  await ctx.editMessageText(
    `📢 <b>مدیریت اسپانسرها</b>\n\n` +
      (sponsors.length === 0
        ? "هنوز اسپانسری اضافه نشده."
        : `${formatNumber(sponsors.length)} اسپانسر ثبت شده.\n✅ فعال | ❌ غیرفعال`),
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
    }
  );
}

// Toggle sponsor status
async function handleToggleSponsor(ctx, data) {
  const sponsorId = Number(data.replace("toggle_sponsor_", ""));
  const sponsors = stmts.getAllSponsors.all();
  const sponsor = sponsors.find((s) => s.id === sponsorId);

  if (sponsor) {
    stmts.toggleSponsor.run({
      is_active: sponsor.is_active ? 0 : 1,
      id: sponsorId,
    });
  }

  // Refresh sponsor list
  await handleSponsorList(ctx);
}

// Delete sponsor
async function handleDeleteSponsor(ctx, data) {
  const sponsorId = Number(data.replace("delete_sponsor_", ""));
  stmts.deleteSponsor.run(sponsorId);

  await ctx.answerCallbackQuery({ text: "🗑️ اسپانسر حذف شد!" });
  await handleSponsorList(ctx);
}

// Start adding sponsor
async function handleAddSponsorStart(ctx) {
  adminState.current = "waiting_sponsor";
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `➕ <b>افزودن اسپانسر جدید</b>\n\n` +
      `لطفاً اطلاعات کانال رو به این فرمت ارسال کنید:\n\n` +
      `<code>آیدی عددی کانال | نام کانال | لینک کانال</code>\n\n` +
      `مثال:\n` +
      `<code>-1001234567890 | کانال ما | https://t.me/our_channel</code>\n\n` +
      `💡 <i>آیدی عددی کانال رو میتونی از ربات @userinfobot بگیری.</i>`,
    {
      parse_mode: "HTML",
      reply_markup: buildCancelKeyboard(),
    }
  );
}

// Start broadcast
async function handleBroadcastStart(ctx) {
  adminState.current = "waiting_broadcast";
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `📣 <b>برودکست</b>\n\n` +
      `متن پیام رو ارسال کنید.\n` +
      `<i>از HTML برای فرمت‌دهی استفاده کنید.</i>`,
    {
      parse_mode: "HTML",
      reply_markup: buildCancelKeyboard(),
    }
  );
}

// Start video deletion
async function handleDeleteVideoStart(ctx) {
  adminState.current = "waiting_delete_code";
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `🗑️ <b>حذف ویدیو</b>\n\n` + `کد ویدیو رو ارسال کنید:`,
    {
      parse_mode: "HTML",
      reply_markup: buildCancelKeyboard(),
    }
  );
}

// Admin list management (Owner only)
async function handleAdminList(ctx) {
  const admins = stmts.getAllAdmins.all();
  await ctx.answerCallbackQuery();

  const keyboard = buildAdminManageKeyboard(admins);
  await ctx.editMessageText(
    `👥 <b>مدیریت ادمین‌ها</b>\n\n` +
      `📌 <b>راهنمای نشانه‌ها:</b>\n` +
      `🎬 = مدیریت ویدیوها\n` +
      `📢 = مدیریت اسپانسرها\n` +
      `📣 = ارسال پیام همگانی (برودکست)\n\n` +
      (admins.length === 0
        ? "هیچ ادمین فرعی تعریف نشده است."
        : `${formatNumber(admins.length)} ادمین ثبت شده است:`),
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
    }
  );
}

// Start adding new admin (Owner only)
async function handleAddAdminStart(ctx) {
  adminState.current = "waiting_admin";
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `➕ <b>افزودن ادمین جدید</b>\n\n` +
      `لطفاً اطلاعات ادمین را به فرمت زیر ارسال کنید:\n\n` +
      `<code>آیدی عددی | نام ادمین | سطح دسترسی (1 یا 2 یا 3)</code>\n\n` +
      `<b>انواع سطح دسترسی:</b>\n` +
      `<b>1</b> = فقط ارسال و حذف ویدیو\n` +
      `<b>2</b> = فقط مدیریت اسپانسرها\n` +
      `<b>3</b> = دسترسی کامل (ویدیو + اسپانسر + برودکست)\n\n` +
      `<i>مثال:</i>\n` +
      `<code>123456789 | علی | 1</code>`,
    {
      parse_mode: "HTML",
      reply_markup: buildCancelKeyboard(),
    }
  );
}

// Delete admin (Owner only)
async function handleDeleteAdmin(ctx, data) {
  const adminId = Number(data.replace("delete_admin_", ""));
  stmts.deleteAdmin.run(adminId);
  logger.info(`Admin ${adminId} removed by owner.`);

  await ctx.answerCallbackQuery({ text: "🗑️ ادمین حذف شد!" });
  await handleAdminList(ctx);
}

// Cancel operation
async function handleCancel(ctx, perms) {
  resetAdminState();
  await ctx.answerCallbackQuery({ text: "❌ لغو شد!" });
  await ctx.editMessageText("❌ عملیات لغو شد.", {
    reply_markup: buildAdminKeyboard(perms),
  });
}

// Return to main admin menu
async function handleBack(ctx, perms) {
  resetAdminState();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `🔧 <b>پنل مدیریت ربات</b>\nنقش: <b>${perms.isOwner ? "مالک اصلی (Owner)" : perms.name}</b>`,
    {
      parse_mode: "HTML",
      reply_markup: buildAdminKeyboard(perms),
    }
  );
}

module.exports = { registerCallbackHandler };

