const { stmts } = require("../database/db");
const config = require("../config");
const { formatNumber } = require("../utils/helpers");
const { checkMembership } = require("../middlewares/membership");
const { sendVideoToUser } = require("./start");
const {
  buildAdminKeyboard,
  buildCancelKeyboard,
  buildSponsorKeyboard,
  buildSponsorManageKeyboard,
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

    // Admin buttons
    if (ctx.from.id !== config.ADMIN_ID) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی ندارید!" });
      return;
    }

    switch (data) {
      case "admin_stats":
        await handleStats(ctx);
        break;
      case "admin_videos":
        await handleVideoList(ctx);
        break;
      case "admin_sponsors":
        await handleSponsorList(ctx);
        break;
      case "admin_broadcast":
        await handleBroadcastStart(ctx);
        break;
      case "admin_delete_video":
        await handleDeleteVideoStart(ctx);
        break;
      case "admin_cancel":
        await handleCancel(ctx);
        break;
      case "admin_back":
        await handleBack(ctx);
        break;
      case "add_sponsor":
        await handleAddSponsorStart(ctx);
        break;
      default:
        // Dynamic sponsor buttons
        if (data.startsWith("toggle_sponsor_")) {
          await handleToggleSponsor(ctx, data);
        } else if (data.startsWith("delete_sponsor_")) {
          await handleDeleteSponsor(ctx, data);
        }
    }
  });
}

// Re-check membership handler
async function handleCheckMembership(ctx, data) {
  const videoCode = data.replace("check_", "");
  const userId = ctx.from.id;

  const { isMember, notJoined } = await checkMembership(ctx.api, userId);

  if (!isMember) {
    const keyboard = buildSponsorKeyboard(notJoined, videoCode);
    await ctx.answerCallbackQuery({
      text: "❌ هنوز در همه کانال‌ها عضو نشدید!",
      show_alert: true,
    });
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    return;
  }

  // Membership confirmed - send video
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

// Cancel operation
async function handleCancel(ctx) {
  resetAdminState();
  await ctx.answerCallbackQuery({ text: "❌ لغو شد!" });
  await ctx.editMessageText("❌ عملیات لغو شد.", {
    reply_markup: buildAdminKeyboard(),
  });
}

// Return to main admin menu
async function handleBack(ctx) {
  resetAdminState();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("🔧 <b>پنل مدیریت ربات</b>", {
    parse_mode: "HTML",
    reply_markup: buildAdminKeyboard(),
  });
}

module.exports = { registerCallbackHandler };
