const { stmts } = require("../database/db");
const config = require("../config");
const { generateVideoCode, formatNumber, buildDeepLink } = require("../utils/helpers");
const {
  buildAdminKeyboard,
  buildCancelKeyboard,
  buildChannelPostKeyboard,
  buildSponsorManageKeyboard,
} = require("../utils/keyboard");

// Admin conversation state (simple state machine)
const adminState = {
  current: null, // null | 'waiting_video' | 'waiting_broadcast' | 'waiting_sponsor' | 'waiting_delete_code'
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
    if (ctx.from.id !== config.ADMIN_ID) return;

    resetAdminState();
    await ctx.reply("🔧 <b>پنل مدیریت ربات</b>", {
      parse_mode: "HTML",
      reply_markup: buildAdminKeyboard(),
    });
  });

  // /add command - start process to add a new video
  bot.command("add", async (ctx) => {
    if (ctx.from.id !== config.ADMIN_ID) return;

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
    if (ctx.from.id !== config.ADMIN_ID) return;
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

  // Receive text message from admin (broadcast / sponsor / delete)
  bot.on("message:text", async (ctx) => {
    if (ctx.from.id !== config.ADMIN_ID) return;

    // Broadcast mode
    if (adminState.current === "waiting_broadcast") {
      const text = ctx.message.text;
      resetAdminState();
      await doBroadcast(ctx, text);
      return;
    }

    // Add sponsor mode
    if (adminState.current === "waiting_sponsor") {
      await handleAddSponsor(ctx);
      return;
    }

    // Delete video mode
    if (adminState.current === "waiting_delete_code") {
      const code = ctx.message.text.trim();
      const video = stmts.getVideoByCode.get(code);

      resetAdminState();

      if (!video) {
        await ctx.reply("❌ ویدیویی با این کد پیدا نشد!");
        return;
      }

      stmts.deleteVideo.run(code);
      await ctx.reply(`✅ ویدیو با کد <code>${code}</code> حذف شد.`, {
        parse_mode: "HTML",
      });
      return;
    }
  });
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
