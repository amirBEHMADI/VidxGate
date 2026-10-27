const { getPermissions } = require("./permissions");
const logger = require("./logger");

// Commands visible to all regular users
const USER_COMMANDS = [
  { command: "start", description: "🚀 شروع ربات و دریافت ویدیو" },
  { command: "help", description: "💡 راهنمای دریافت ویدیوها" },
];

// Commands visible to admins
const ADMIN_BASE_COMMANDS = [
  { command: "panel", description: "🔧 پنل شیشه‌ای مدیریت" },
  { command: "post", description: "🎬 ایجاد پست خودکار جدید کانال" },
  { command: "queue", description: "📊 خلاصه وضعیت صف ویدیوها" },
  { command: "pending", description: "⏳ ویدیوهای در حال پردازش" },
  { command: "failed", description: "⚠️ لیست خطاهای دانلود یا آپلود" },
  { command: "downloaded", description: "📥 ویدیوهای دانلود شده آماده آپلود" },
  { command: "uploaded", description: "✅ ویدیوهای با موفقیت آپلود شده" },
  { command: "vstatus", description: "🔍 استعلام وضعیت ویدیو با کد" },
  { command: "stats", description: "📈 آمار کاربران، ویدیوها و سیستم" },
  { command: "add", description: "➕ ثبت و آپلود دستی ویدیو" },
  { command: "delete", description: "🗑️ حذف ویدیو از ربات با کد" },
  { command: "sponsors", description: "📢 مدیریت کانال‌های اسپانسر" },
  { command: "broadcast", description: "📨 ارسال پیام همگانی به کاربران" },
  { command: "help", description: "📋 راهنمای جامع دستورات" },
];

// Extra commands exclusive to bot owner
const OWNER_EXTRA_COMMANDS = [
  { command: "admins", description: "👥 مدیریت ادمین‌ها و دسترسی‌ها" },
  { command: "clearqueue", description: "🧹 پاکسازی رکوردهای موفق صف" },
];

/**
 * Initialize default bot commands for all general users
 * @param {object} botApi - grammY bot.api instance
 */
async function initDefaultCommands(botApi) {
  try {
    await botApi.setMyCommands(USER_COMMANDS, {
      scope: { type: "default" },
    });
    logger.info("Default user commands registered successfully.");
  } catch (err) {
    logger.warn(`Failed to set default commands: ${err.message}`);
  }
}

/**
 * Sync custom Telegram command autocomplete list based on user role
 * @param {object} botApi - grammY bot.api instance
 * @param {number|string} userId - User Telegram numerical ID
 */
async function syncUserCommands(botApi, userId) {
  if (!userId) return;
  const numId = Number(userId);

  try {
    const perms = getPermissions(numId);

    if (perms.isOwner) {
      await botApi.setMyCommands([...ADMIN_BASE_COMMANDS, ...OWNER_EXTRA_COMMANDS], {
        scope: { type: "chat", chat_id: numId },
      });
      logger.info(`Synced owner command menu for ID: ${numId}`);
    } else if (perms.isAdmin) {
      await botApi.setMyCommands(ADMIN_BASE_COMMANDS, {
        scope: { type: "chat", chat_id: numId },
      });
      logger.info(`Synced admin command menu for ID: ${numId}`);
    } else {
      // Clear chat-specific scope so user inherits default commands
      try {
        await botApi.deleteMyCommands({
          scope: { type: "chat", chat_id: numId },
        });
      } catch (_) {}
    }
  } catch (err) {
    logger.warn(`Could not sync commands for user ${userId}: ${err.message}`);
  }
}

/**
 * Formatted HTML guide of commands for admins
 * @param {object} perms
 * @returns {string}
 */
function getAdminHelpMessage(perms = { isOwner: false }) {
  let text =
    `<b>📋 راهنمای دستورات مدیریت ربات VidxGate</b>\n\n` +
    `<i>تمامی دستورات زیر در کادر پیام با زدن کاراکتر <code>/</code> یا لمس دکمه منوی پایین (☰) به همراه توضیحات در دسترس هستند:</i>\n\n` +
    `<b>🎬 مدیریت ویدیو و ارسال پست:</b>\n` +
    `• /post — ایجاد پست خودکار جدید کانال (دانلود، استخراج متادیتا و کپشن)\n` +
    `• /add — ثبت دستی ویدیو با ارسال مستقیم یا فوروارد\n` +
    `• /delete <code>[کد]</code> — حذف یک ویدیو از دیتابیس با کد اختصاصی\n\n` +
    `<b>📊 پیگیری و نظارت بر صف ویدیوها:</b>\n` +
    `• /queue — نمایش خلاصه آماری وضعیت صف دانلود و آپلود\n` +
    `• /pending — لیست ویدیوهای در حال دانلود یا آپلود در لحظه\n` +
    `• /failed — لیست ویدیوهایی که با خطا مواجه شدند (با علت خطا)\n` +
    `• /downloaded — ویدیوهای دانلود شده که منتظر آپلود هستند\n` +
    `• /uploaded — آرشیو ویدیوهای با موفقیت آپلود شده\n` +
    `• /vstatus <code>[کد]</code> — مشاهده وضعیت دقیق یک ویدیو بر اساس کد\n\n` +
    `<b>⚙️ تنظیمات و مدیریت عمومی:</b>\n` +
    `• /panel — باز کردن منوی شیشه‌ای پنل مدیریت\n` +
    `• /stats — نمایش آمار کلی کاربران، ویدیوها و دانلودها\n` +
    `• /sponsors — مدیریت کانال‌های اسپانسر (افزودن و حذف قفل اسپانسر)\n` +
    `• /broadcast — ارسال پیام همگانی به اعضای ربات\n` +
    `• /help — نمایش مجدد این راهنما\n`;

  if (perms.isOwner) {
    text +=
      `\n<b>👑 دستورات ویژه مالک ربات:</b>\n` +
      `• /admins — مدیریت سطوح دسترسی و افزودن/حذف ادمین‌های فرعی\n` +
      `• /clearqueue — پاکسازی رکوردهای آپلود شده از دیتابیس صف\n`;
  }

  return text;
}

/**
 * Formatted HTML guide for general regular users
 * @returns {string}
 */
function getUserHelpMessage() {
  return (
    `<b>💡 راهنمای دریافت ویدیوهای آموزشی</b>\n\n` +
    `برای دریافت ویدیوها کافیست مراحل زیر را طی کنید:\n\n` +
    `1️⃣ در کانال ما، روی دکمه شیشه‌ای <b>«🎬 دریافت ویدیو»</b> زیر پست مورد نظرتان کلیک کنید.\n` +
    `2️⃣ در صورتی که عضو کانال‌های اسپانسر نیستید، ابتدا در آنها عضو شده و دکمه <b>«✅ عضو شدم • بررسی مجدد»</b> را بزنید.\n` +
    `3️⃣ ویدیو برای شما ارسال می‌شود. لطفاً بلافاصله آن را در Saved Messages ذخیره کنید چون طبق قوانین کانال پس از ۳۰ ثانیه به صورت خودکار پاک خواهد شد.\n\n` +
    `دستور /start — شروع ربات و بررسی وضعیت`
  );
}

module.exports = {
  USER_COMMANDS,
  ADMIN_BASE_COMMANDS,
  OWNER_EXTRA_COMMANDS,
  initDefaultCommands,
  syncUserCommands,
  getAdminHelpMessage,
  getUserHelpMessage,
};
