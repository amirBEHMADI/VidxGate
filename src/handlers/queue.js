const { stmts } = require("../database/db");
const { getPermissions } = require("../utils/permissions");
const logger = require("../utils/logger");

// Status labels in Persian (no emojis)
const STATUS_LABELS = {
  downloading: "در حال دانلود",
  downloaded: "دانلود شده (منتظر آپلود)",
  uploading: "در حال آپلود",
  uploaded: "آپلود شده",
  error: "خطا",
  cancelled: "لغو شده",
};

/**
 * Format a single queue entry for display
 */
function formatQueueEntry(entry) {
  const statusLabel = STATUS_LABELS[entry.status] || entry.status;
  let text = `<b>کد:</b> <code>${entry.code}</code>\n`;
  text += `<b>وضعیت:</b> ${statusLabel}\n`;
  text += `<b>تاریخ:</b> ${entry.created_at}\n`;

  if (entry.temp_path) {
    text += `<b>فایل موقت:</b> <code>${entry.temp_path}</code>\n`;
  }
  if (entry.file_id) {
    text += `<b>شناسه فایل:</b> <code>${entry.file_id}</code>\n`;
  }
  if (entry.error_msg) {
    text += `<b>پیام خطا:</b> <code>${entry.error_msg}</code>\n`;
  }

  return text;
}

/**
 * Register queue/status tracking commands for admins
 */
function registerQueueHandler(bot) {
  // /queue - Show summary of all video statuses
  bot.command("queue", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    const statusCounts = stmts.getQueueCountByStatus.all();
    if (!statusCounts || statusCounts.length === 0) {
      await ctx.reply("<b>صف ویدیو خالی است.</b>\nهیچ ویدیویی در صف پردازش وجود ندارد.", {
        parse_mode: "HTML",
      });
      return;
    }

    let text = "<b>-- خلاصه وضعیت صف ویدیوها --</b>\n\n";
    let total = 0;
    for (const row of statusCounts) {
      const label = STATUS_LABELS[row.status] || row.status;
      text += `${label}: <b>${row.count}</b>\n`;
      total += row.count;
    }
    text += `\n<b>مجموع:</b> ${total}\n\n`;
    text += "<i>دستورات مرتبط:</i>\n";
    text += "/pending - ویدیوهای در حال دانلود/آپلود\n";
    text += "/downloaded - ویدیوهای دانلود شده\n";
    text += "/uploaded - ویدیوهای آپلود شده\n";
    text += "/failed - ویدیوهای با خطا\n";
    text += "/vstatus [code] - وضعیت یک ویدیو";

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /pending - Show downloading/uploading videos
  bot.command("pending", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    const downloading = stmts.getQueueByStatus.all("downloading");
    const uploading = stmts.getQueueByStatus.all("uploading");
    const items = [...downloading, ...uploading];

    if (items.length === 0) {
      await ctx.reply("<b>هیچ ویدیویی در حال پردازش نیست.</b>", {
        parse_mode: "HTML",
      });
      return;
    }

    let text = `<b>-- ویدیوهای در حال پردازش (${items.length}) --</b>\n\n`;
    for (const entry of items.slice(0, 20)) {
      text += formatQueueEntry(entry) + "\n";
    }
    if (items.length > 20) {
      text += `<i>... و ${items.length - 20} مورد دیگر</i>`;
    }

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /downloaded - Show downloaded but not yet uploaded videos
  bot.command("downloaded", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    const items = stmts.getQueueByStatus.all("downloaded");

    if (items.length === 0) {
      await ctx.reply("<b>هیچ ویدیوی دانلود شده منتظر آپلود نیست.</b>", {
        parse_mode: "HTML",
      });
      return;
    }

    let text = `<b>-- ویدیوهای دانلود شده منتظر آپلود (${items.length}) --</b>\n\n`;
    for (const entry of items.slice(0, 20)) {
      text += formatQueueEntry(entry) + "\n";
    }
    if (items.length > 20) {
      text += `<i>... و ${items.length - 20} مورد دیگر</i>`;
    }

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /uploaded - Show successfully uploaded videos
  bot.command("uploaded", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    const items = stmts.getQueueByStatus.all("uploaded");

    if (items.length === 0) {
      await ctx.reply("<b>هیچ ویدیوی آپلود شده ای ثبت نشده.</b>", {
        parse_mode: "HTML",
      });
      return;
    }

    let text = `<b>-- ویدیوهای آپلود شده (${items.length}) --</b>\n\n`;
    for (const entry of items.slice(0, 20)) {
      text += formatQueueEntry(entry) + "\n";
    }
    if (items.length > 20) {
      text += `<i>... و ${items.length - 20} مورد دیگر</i>`;
    }

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /failed - Show videos with errors
  bot.command("failed", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    const items = stmts.getQueueByStatus.all("error");

    if (items.length === 0) {
      await ctx.reply("<b>هیچ ویدیویی با خطا ثبت نشده.</b>", {
        parse_mode: "HTML",
      });
      return;
    }

    let text = `<b>-- ویدیوهای با خطا (${items.length}) --</b>\n\n`;
    for (const entry of items.slice(0, 20)) {
      text += formatQueueEntry(entry) + "\n";
    }
    if (items.length > 20) {
      text += `<i>... و ${items.length - 20} مورد دیگر</i>`;
    }

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /vstatus <code> - Show status of a specific video by code
  bot.command("vstatus", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isAdmin) return;

    const args = ctx.message.text.split(/\s+/).slice(1);
    const code = args[0];

    if (!code) {
      await ctx.reply(
        "<b>استفاده:</b> <code>/vstatus [code]</code>\n\n" +
          "<i>مثال:</i> <code>/vstatus abc123</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const entry = stmts.getQueueByCode.get(code);

    if (!entry) {
      await ctx.reply(
        `<b>هیچ رکوردی با کد</b> <code>${code}</code> <b>در صف یافت نشد.</b>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    let text = "<b>-- جزئیات وضعیت ویدیو --</b>\n\n";
    text += formatQueueEntry(entry);

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /clearqueue - Clear completed (uploaded) entries from queue
  bot.command("clearqueue", async (ctx) => {
    const perms = getPermissions(ctx.from.id);
    if (!perms.isOwner) {
      await ctx.reply("فقط مالک اصلی اجازه پاکسازی صف را دارد.", {
        parse_mode: "HTML",
      });
      return;
    }

    const uploaded = stmts.getQueueByStatus.all("uploaded");
    for (const entry of uploaded) {
      stmts.deleteQueue.run(entry.code);
    }

    await ctx.reply(
      `<b>${uploaded.length}</b> رکورد آپلود شده از صف پاک شد.`,
      { parse_mode: "HTML" }
    );
  });
}

module.exports = { registerQueueHandler };
