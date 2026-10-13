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

module.exports = {
  generateVideoCode,
  formatNumber,
  buildDeepLink,
  escapeMarkdownV2,
  delay,
};
