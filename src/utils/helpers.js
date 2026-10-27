const crypto = require("crypto");

/**
 * تولید کد یکتا برای ویدیو
 * @param {number} length - طول کد (پیش‌فرض: 8)
 * @returns {string}
 */
function generateVideoCode(length = 8) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

/**
 * فرمت عدد با جداکننده هزارگان
 * @param {number} num
 * @returns {string}
 */
function formatNumber(num) {
  return num.toLocaleString("fa-IR");
}

/**
 * ساخت Deep Link برای ربات
 * @param {string} botUsername - یوزرنیم ربات
 * @param {string} videoCode - کد ویدیو
 * @returns {string}
 */
function buildDeepLink(botUsername, videoCode) {
  return `https://t.me/${botUsername}?start=${videoCode}`;
}

/**
 * اسکیپ کردن کاراکترهای خاص MarkdownV2
 * @param {string} text
 * @returns {string}
 */
function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * تاخیر (Promise-based)
 * @param {number} ms - میلی‌ثانیه
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ساخت نوار پیشرفت بصری
 * @param {number} percent - درصد بین 0 تا 100
 * @param {number} length - طول نوار (پیش‌فرض: 10)
 * @returns {string}
 */
function formatProgressBar(percent, length = 10) {
  const safePercent = Math.min(100, Math.max(0, percent || 0));
  const filled = Math.min(length, Math.max(0, Math.round((safePercent / 100) * length)));
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * فرمت بایت به رشته خوانا (MB یا GB)
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

module.exports = {
  generateVideoCode,
  formatNumber,
  buildDeepLink,
  escapeMarkdownV2,
  delay,
  formatProgressBar,
  formatBytes,
};
