const { stmts } = require("../database/db");
const config = require("../config");
const logger = require("../utils/logger");
const { getPermissions } = require("../utils/permissions");
const { generateVideoCode, formatNumber, buildDeepLink } = require("../utils/helpers");
const {
  buildAdminKeyboard,
  buildCancelKeyboard,
  buildChannelPostKeyboard,
  buildSponsorManageKeyboard,
} = require("../utils/keyboard");

// Admin conversation state (simple state machine)
const adminState = {
  current: null, // null | 'waiting_video' | 'waiting_broadcast' | 'waiting_sponsor' | 'waiting_delete_code' | 'waiting_admin'
  data: {},
};

/**
 * ریست کردن وضعیت ادمین
 */
function resetAdminState() {
  adminState.current = null;
  adminState.data = {};
}

/**
 * هندلرهای پنل ادمین
 */
function registerAdminHandler(bot) {
  // /panel command
  bot.command("panel", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    resetAdminState();
    await ctx.reply(`🔧 <b>پنل مدیریت ربات</b>\nنقش: <b>${perms.isOwner ? "مالک اصلی (Owner)" : perms.name}</b>`, {
      parse_mode: "HTML",
      reply_markup: buildAdminKeyboard(perms),
    });
  });

  // /add command - start process to add a new video
  bot.command("add", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.canManageVideos) {
      await ctx.reply("⛔ شما دسترسی مدیریت ویدیوها را ندارید.");
      return;
    }

    adminState.current = "waiting_video";
    await ctx.reply(
      "🎬 <b>ویدیو جدید</b>\n\n" +
        "لطفاً ویدیو رو با کپشن دلخواه ارسال کنید.\n" +
        "کپشن ویدیو به عنوان توضیحات ذخیره می‌شه.",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Receive video from admin
  bot.on("message:video", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.canManageVideos) return;
    if (adminState.current !== "waiting_video") return;

    const fileId = ctx.message.video.file_id;
    const caption = ctx.message.caption || "";
    const code = generateVideoCode();

    // Save video in database
    stmts.insertVideo.run({
      code,
      file_id: fileId,
      caption,
    });

    const botInfo = await ctx.api.getMe();
    const deepLink = buildDeepLink(botInfo.username, code);

    resetAdminState();

    logger.success(`Video added by ${ctx.from.id} with code [${code}]`);

    await ctx.reply(
      `✅ <b>ویدیو با موفقیت ذخیره شد!</b>\n\n` +
        `📎 <b>کد ویدیو:</b> <code>${code}</code>\n` +
        `🔗 <b>لینک مستقیم:</b>\n<code>${deepLink}</code>\n\n` +
        `💡 <i>می‌تونی از دکمه زیر برای ارسال خودکار به کانال استفاده کنی:</i>`,
      { parse_mode: "HTML" }
    );

    // Show channel post preview
    await ctx.reply(`🎓 ویدیو آموزشی جدید!\n\n${caption}`, {
      reply_markup: buildChannelPostKeyboard(botInfo.username, code),
    });
  });

  // Receive text message from admin (broadcast / sponsor / delete / admin add)
  bot.on("message:text", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    // Broadcast mode
    if (adminState.current === "waiting_broadcast") {
      if (!perms.canBroadcast) {
        await ctx.reply("⛔ دسترسی برودکست ندارید.");
        return;
      }
      const text = ctx.message.text;
      resetAdminState();
      await doBroadcast(ctx, text);
      return;
    }

    // Add sponsor mode
    if (adminState.current === "waiting_sponsor") {
      if (!perms.canManageSponsors) {
        await ctx.reply("⛔ دسترسی مدیریت اسپانسرها را ندارید.");
        return;
      }
      await handleAddSponsor(ctx);
      return;
    }

    // Delete video mode
    if (adminState.current === "waiting_delete_code") {
      if (!perms.canManageVideos) {
        await ctx.reply("⛔ دسترسی حذف ویدیو را ندارید.");
        return;
      }
      const code = ctx.message.text.trim();
      const video = stmts.getVideoByCode.get(code);

      resetAdminState();

      if (!video) {
        await ctx.reply("❌ ویدیویی با این کد پیدا نشد!");
        return;
      }

      stmts.deleteVideo.run(code);
      logger.info(`Video [${code}] deleted by admin ${ctx.from.id}`);
      await ctx.reply(`✅ ویدیو با کد <code>${code}</code> حذف شد.`, {
        parse_mode: "HTML",
      });
      return;
    }

    // Add new sub-admin mode (Only owner)
    if (adminState.current === "waiting_admin") {
      if (!perms.isOwner) {
        await ctx.reply("⛔ فقط مالک اصلی اجازه افزودن ادمین دارد.");
        return;
      }
      await handleAddAdminSubmit(ctx);
      return;
    }
  });
}

/**
 * پردازش افزودن ادمین جدید
 * فرمت: user_id | نام | سطح دسترسی (1, 2 یا 3)
 * سطوح:
 * 1: فقط مدیریت ویدیوها
 * 2: فقط مدیریت اسپانسرها
 * 3: دسترسی کامل (ویدیو + اسپانسر + برودکست)
 */
async function handleAddAdminSubmit(ctx) {
  const parts = ctx.message.text.split("|").map((s) => s.trim());
  if (parts.length < 2) {
    await ctx.reply(
      "❌ لطفاً فرمت را رعایت کنید:\n\n" +
        "<code>آیدی عددی | نام | نوع دسترسی (1 یا 2 یا 3)</code>\n\n" +
        "<b>انواع دسترسی:</b>\n" +
        "1 = فقط ویدیوها\n" +
        "2 = فقط اسپانسرها\n" +
        "3 = مدیر کل (ویدیو + اسپانسر + برودکست)\n\n" +
        "<i>مثال:</i>\n<code>123456789 | علی | 1</code>",
      { parse_mode: "HTML", reply_markup: buildCancelKeyboard() }
    );
    return;
  }

  const userId = Number(parts[0]);
  const name = parts[1];
  const level = parts[2] ? parts[2] : "1";

  if (isNaN(userId)) {
    await ctx.reply("❌ آیدی عددی کاربر نامعتبر است!");
    return;
  }

  let canVideos = 0, canSponsors = 0, canBroadcast = 0;
  if (level === "1") {
    canVideos = 1;
  } else if (level === "2") {
    canSponsors = 1;
  } else if (level === "3") {
    canVideos = 1;
    canSponsors = 1;
    canBroadcast = 1;
  } else {
    canVideos = 1;
  }

  stmts.upsertAdmin.run({
    user_id: userId,
    name: name,
    can_manage_videos: canVideos,
    can_manage_sponsors: canSponsors,
    can_broadcast: canBroadcast,
  });

  resetAdminState();
  logger.success(`Admin ${userId} (${name}) registered with level ${level}`);

  await ctx.reply(
    `✅ ادمین <b>${name}</b> با موفقیت ذخیره شد!\n\n` +
      `👤 شناسه: <code>${userId}</code>\n` +
      `🎬 مدیریت ویدیو: ${canVideos ? "✅" : "❌"}\n` +
      `📢 مدیریت اسپانسر: ${canSponsors ? "✅" : "❌"}\n` +
      `📣 برودکست: ${canBroadcast ? "✅" : "❌"}`,
    { parse_mode: "HTML" }
  );
}


/**
 * پردازش اضافه کردن اسپانسر
 * فرمت: channel_id | channel_name | channel_link
 */
async function handleAddSponsor(ctx) {
  const parts = ctx.message.text.split("|").map((s) => s.trim());

  if (parts.length !== 3) {
    await ctx.reply(
      "❌ فرمت اشتباهه!\n\n" +
        "لطفاً به این فرمت ارسال کنید:\n" +
        "<code>آیدی عددی کانال | نام کانال | لینک کانال</code>\n\n" +
        "مثال:\n" +
        "<code>-1001234567890 | کانال ما | https://t.me/our_channel</code>",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
    return;
  }

  const [channelId, channelName, channelLink] = parts;

  try {
    stmts.insertSponsor.run({
      channel_id: channelId,
      channel_name: channelName,
      channel_link: channelLink,
    });

    resetAdminState();

    await ctx.reply(
      `✅ اسپانسر <b>${channelName}</b> با موفقیت اضافه شد!`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      await ctx.reply("⚠️ این کانال قبلاً اضافه شده!");
    } else {
      await ctx.reply("❌ خطا در ذخیره اسپانسر: " + error.message);
    }
  }
}

/**
 * ارسال پیام به همه کاربران (برودکست)
 */
async function doBroadcast(ctx, text) {
  const users = require("../database/db").db
    .prepare("SELECT user_id FROM users")
    .all();

  let success = 0;
  let failed = 0;

  const statusMsg = await ctx.reply(
    `📣 <b>شروع ارسال به ${formatNumber(users.length)} کاربر...</b>`,
    { parse_mode: "HTML" }
  );

  for (const user of users) {
    try {
      await ctx.api.sendMessage(user.user_id, text, { parse_mode: "HTML" });
      success++;
    } catch {
      failed++;
    }

    // Delay to respect Telegram rate limits (~20 messages per second)
    await new Promise((r) => setTimeout(r, 50));
  }

  await ctx.api.editMessageText(
    ctx.chat.id,
    statusMsg.message_id,
    `📣 <b>برودکست تمام شد!</b>\n\n` +
      `✅ موفق: ${formatNumber(success)}\n` +
      `❌ ناموفق: ${formatNumber(failed)}`,
    { parse_mode: "HTML" }
  );
}

module.exports = { registerAdminHandler, adminState, resetAdminState };
