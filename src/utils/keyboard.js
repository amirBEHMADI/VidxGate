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
 * ساخت کیبورد پنل ادمین بر اساس دسترسی
 * @param {{isOwner: boolean, canManageVideos: boolean, canManageSponsors: boolean, canBroadcast: boolean}} perms
 * @returns {InlineKeyboard}
 */
function buildAdminKeyboard(perms = { isOwner: true, canManageVideos: true, canManageSponsors: true, canBroadcast: true }) {
  const keyboard = new InlineKeyboard();

  if (perms.canManageVideos) {
    keyboard.text("پست خودکار جدید", "admin_post_start");
  }
  keyboard.text("📊 آمار", "admin_stats").row();

  if (perms.canManageVideos) {
    keyboard.text("📋 لیست ویدیوها", "admin_videos");
    keyboard.text("🗑️ حذف ویدیو", "admin_delete_video");
    keyboard.row();
  }

  if (perms.canManageSponsors) {
    keyboard.text("📢 مدیریت اسپانسرها", "admin_sponsors");
  }
  if (perms.canBroadcast) {
    keyboard.text("📣 برودکست", "admin_broadcast");
  }
  keyboard.row();

  // Only Owner can manage sub-admins
  if (perms.isOwner) {
    keyboard.text("👥 مدیریت ادمین‌ها", "admin_manage_admins").row();
  }

  keyboard.text("📋 راهنمای دستورات", "admin_commands_guide");

  return keyboard;
}

/**
 * ساخت کیبورد مدیریت ادمین‌ها
 * @param {Array} admins
 * @returns {InlineKeyboard}
 */
function buildAdminManageKeyboard(admins) {
  const keyboard = new InlineKeyboard();

  for (const a of admins) {
    const roles = [];
    if (a.can_manage_videos) roles.push("🎬");
    if (a.can_manage_sponsors) roles.push("📢");
    if (a.can_broadcast) roles.push("📣");

    keyboard
      .text(`${a.name || a.user_id} [${roles.join(" ")}]`, `admin_detail_${a.user_id}`)
      .text("🗑️", `delete_admin_${a.user_id}`)
      .row();
  }

  keyboard.text("➕ افزودن ادمین جدید", "add_admin_start").row();
  keyboard.text("🔙 بازگشت", "admin_back");

  return keyboard;
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

/**
 * Build post preview keyboard for admin confirmation before channel publishing
 * @param {string} botUsername
 * @param {string} videoCode
 * @returns {InlineKeyboard}
 */
function buildPostPreviewKeyboard(botUsername, videoCode) {
  const keyboard = new InlineKeyboard();

  keyboard.url("دریافت ویدیو (پیش‌نمایش دکمه)", `https://t.me/${botUsername}?start=${videoCode}`).row();
  keyboard.text("تأیید و ارسال به کانال", "post_confirm").row();
  keyboard
    .text("ویرایش متن", "post_edit_caption")
    .text("تغییر عکس", "post_change_photo")
    .row();
  keyboard.text("انصراف و لغو", "post_cancel");

  return keyboard;
}

module.exports = {
  buildSponsorKeyboard,
  buildChannelPostKeyboard,
  buildAdminKeyboard,
  buildCancelKeyboard,
  buildSponsorManageKeyboard,
  buildAdminManageKeyboard,
  buildPostPreviewKeyboard,
};


