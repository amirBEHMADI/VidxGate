const { InlineKeyboard } = require("grammy");

/**
 * ساخت کیبورد کانال‌های اسپانسر + دکمه بررسی مجدد
 * @param {Array} sponsors - لیست کانال‌های اسپانسر
 * @param {string} videoCode - کد ویدیو برای callback
 * @returns {InlineKeyboard}
 */
function buildSponsorKeyboard(sponsors, videoCode) {
  const keyboard = new InlineKeyboard();

  for (const sponsor of sponsors) {
    keyboard.url(`📢 ${sponsor.channel_name}`, sponsor.channel_link).row();
  }

  keyboard.text("✅ عضو شدم • بررسی مجدد", `check_${videoCode}`);

  return keyboard;
}

/**
 * ساخت کیبورد دکمه دریافت ویدیو (برای پست کانال)
 * @param {string} botUsername - یوزرنیم ربات
 * @param {string} videoCode - کد ویدیو
 * @returns {InlineKeyboard}
 */
function buildChannelPostKeyboard(botUsername, videoCode) {
  return new InlineKeyboard().url(
    "🎬 دریافت ویدیو",
    `https://t.me/${botUsername}?start=${videoCode}`
  );
}

/**
 * ساخت کیبورد پنل ادمین
 * @returns {InlineKeyboard}
 */
function buildAdminKeyboard() {
  return new InlineKeyboard()
    .text("📊 آمار", "admin_stats")
    .text("📋 لیست ویدیوها", "admin_videos")
    .row()
    .text("📢 مدیریت اسپانسرها", "admin_sponsors")
    .text("📣 برودکست", "admin_broadcast")
    .row()
    .text("🗑️ حذف ویدیو", "admin_delete_video");
}

/**
 * ساخت کیبورد لغو عملیات
 * @returns {InlineKeyboard}
 */
function buildCancelKeyboard() {
  return new InlineKeyboard().text("❌ لغو", "admin_cancel");
}

/**
 * ساخت کیبورد مدیریت اسپانسرها
 * @param {Array} sponsors - لیست اسپانسرها
 * @returns {InlineKeyboard}
 */
function buildSponsorManageKeyboard(sponsors) {
  const keyboard = new InlineKeyboard();

  for (const s of sponsors) {
    const status = s.is_active ? "✅" : "❌";
    keyboard
      .text(
        `${status} ${s.channel_name}`,
        `toggle_sponsor_${s.id}`
      )
      .text("🗑️", `delete_sponsor_${s.id}`)
      .row();
  }

  keyboard.text("➕ افزودن اسپانسر جدید", "add_sponsor").row();
  keyboard.text("🔙 بازگشت", "admin_back");

  return keyboard;
}

module.exports = {
  buildSponsorKeyboard,
  buildChannelPostKeyboard,
  buildAdminKeyboard,
  buildCancelKeyboard,
  buildSponsorManageKeyboard,
};
