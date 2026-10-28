const { InputFile } = require("grammy");
const { stmts } = require("../database/db");
const config = require("../config");
const logger = require("../utils/logger");
const { getPermissions } = require("../utils/permissions");
const {
  generateVideoCode,
  formatNumber,
  formatProgressBar,
  formatBytes,
} = require("../utils/helpers");
const {
  buildCancelKeyboard,
  buildPostPreviewKeyboard,
  buildChannelPostKeyboard,
  buildQualityKeyboard,
  buildActiveCancelKeyboard,
  buildThumbnailKeyboard,
  buildNoThumbnailsKeyboard,
} = require("../utils/keyboard");
const downloader = require("../utils/downloader");
const uploader = require("../utils/uploader");
const scraper = require("../utils/scraper");
const imageSearch = require("../utils/imageSearch");

// In-memory conversation state for each admin during post creation
const postStates = new Map();

/**
 * Get current post creation state for an admin
 */
function getPostState(userId) {
  return postStates.get(userId);
}

/**
 * Reset and cleanup post creation state
 */
function resetPostState(userId) {
  const state = postStates.get(userId);
  if (state?.abortController) {
    try {
      state.abortController.abort();
    } catch (_) {}
  }
  if (state?.data?.tempFilePath) {
    downloader.cleanupFile(state.data.tempFilePath);
  }
  postStates.delete(userId);
}

/**
 * Send interactive post preview to admin
 */
async function sendPostPreview(ctx, state) {
  const botInfo = await ctx.api.getMe();
  const keyboard = buildPostPreviewKeyboard(botInfo.username, state.data.code);

  const previewNotice =
    `<b>پیش‌نمایش پست کانال</b>\n` +
    `--------------------\n` +
    `${state.data.caption}\n` +
    `--------------------\n` +
    `<i>کد ثبت ویدیو:</i> <code>${state.data.code}</code>\n` +
    `<i>وضعیت ویدیو:</i> ذخیره شده در آرشیو (تایید شد)`;

  await ctx.replyWithPhoto(state.data.photoFileId, {
    caption: previewNotice,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  state.step = "preview";
}

/**
 * Search and present actor thumbnails to admin as a media group with interactive buttons
 * @param {object} ctx - grammY context
 * @param {object} state - Admin post state
 * @param {string} actorName - Name of the actor to search
 * @param {number} [page=1] - Results page
 */
async function presentActorThumbnails(ctx, state, actorName, page = 1) {
  const cleanedName = imageSearch.cleanActorName(actorName);
  if (!cleanedName) {
    await ctx.reply("نام بازیگر معتبر نمی‌باشد. لطفاً نام دیگری را ارسال فرمایید.", {
      reply_markup: buildCancelKeyboard(),
    });
    return;
  }

  const statusMsg = await ctx.reply(
    `🔍 <b>در حال جستجوی تصاویر باکیفیت برای «${cleanedName}»...</b>\n<i>(ترجیحاً اینستاگرام و شات‌های مدلینگ)</i>`,
    { parse_mode: "HTML" }
  );

  try {
    const images = await imageSearch.searchActorImages(cleanedName, { page, limit: 10 });

    try {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (_) {}

    if (!images || images.length === 0) {
      state.step = "waiting_post_thumbnail";
      state.data.actorName = cleanedName;
      await ctx.reply(
        `⚠️ <b>تصویری برای بازیگر «${cleanedName}» یافت نشد.</b>\n\n` +
          `می‌توانید:\n` +
          `• <b>نام بازیگر دیگری</b> را تایپ و ارسال کنید.\n` +
          `• یا مستقیماً <b>عکس دلخواه</b> را از گالری ارسال نمایید.`,
        {
          parse_mode: "HTML",
          reply_markup: buildNoThumbnailsKeyboard(state.data.scrapedMetadata?.actors),
        }
      );
      return;
    }

    state.step = "waiting_post_thumbnail";
    state.data.actorName = cleanedName;
    state.data.imagePage = page;
    state.data.searchedImages = images;

    const allActors = state.data.scrapedMetadata?.actors || [];
    const currentActorIndex = allActors.findIndex(
      (a) => a.toLowerCase() === cleanedName.toLowerCase()
    );

    let albumSent = false;
    let sentMessages = [];

    const captionHeader =
      `📸 <b>تصاویر پیشنهادی برای «${cleanedName}»</b> (صفحه ${page})\n` +
      `<i>شماره ثامبنیل دلخواه را از دکمه‌های زیر انتخاب فرمایید:</i>`;

    if (images.length >= 2) {
      try {
        const mediaGroup = images.map((img, idx) => ({
          type: "photo",
          media: img.highResUrl,
          caption: idx === 0 ? captionHeader : undefined,
          parse_mode: "HTML",
        }));
        sentMessages = await ctx.replyWithMediaGroup(mediaGroup);
        albumSent = true;
      } catch (urlErr) {
        logger.warn(`Media group by URL failed: ${urlErr.message}. Trying buffer download...`);
        try {
          const bufferItems = [];
          for (let i = 0; i < images.length; i++) {
            const buf = await imageSearch.fetchImageBuffer(images[i].highResUrl, images[i].thumbUrl);
            if (buf) {
              bufferItems.push({
                type: "photo",
                media: new InputFile(buf, `thumb_${i + 1}.jpg`),
                caption: bufferItems.length === 0 ? captionHeader : undefined,
                parse_mode: "HTML",
              });
            }
          }
          if (bufferItems.length >= 2) {
            sentMessages = await ctx.replyWithMediaGroup(bufferItems);
            albumSent = true;
          }
        } catch (bufErr) {
          logger.error(`Buffer media group failed: ${bufErr.message}`);
        }
      }
    } else if (images.length === 1) {
      try {
        const sent = await ctx.replyWithPhoto(images[0].highResUrl, {
          caption: captionHeader,
          parse_mode: "HTML",
        });
        sentMessages = [sent];
        albumSent = true;
      } catch (_) {}
    }

    // Cache Telegram file_ids from successfully sent media
    if (albumSent && Array.isArray(sentMessages)) {
      sentMessages.forEach((msg, idx) => {
        if (msg?.photo?.length && state.data.searchedImages[idx]) {
          state.data.searchedImages[idx].fileId = msg.photo[msg.photo.length - 1].file_id;
        }
      });
    }

    const keyboard = buildThumbnailKeyboard({
      imageCount: images.length,
      actorName: cleanedName,
      currentPage: page,
      allActors,
      currentActorIndex: currentActorIndex >= 0 ? currentActorIndex : 0,
    });

    await ctx.reply(
      `<b>انتخاب تصویر ثامبنیل برای پست کانال:</b>\n` +
        `👤 بازیگر: <b>${cleanedName}</b>\n` +
        `🔢 تعداد تصاویر: <b>${images.length} تصویر</b> (صفحه ${page})\n\n` +
        `برای انتخاب، روی شماره مورد نظر ضربه بزنید:\n` +
        `<i>(همچنین می‌توانید هر عکسی از گالری ارسال کنید)</i>`,
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
      }
    );
  } catch (err) {
    logger.error(`Error presenting actor thumbnails: ${err.message}`, err);
    try {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (_) {}
    state.step = "waiting_post_thumbnail";
    await ctx.reply(
      `⚠️ خطا در جستجوی تصاویر بازیگر: ${err.message}\nلطفاً عکس یا بنر مورد نظر را ارسال فرمایید.`,
      { reply_markup: buildCancelKeyboard() }
    );
  }
}

/**
 * Handle video download and upload pipeline with progress reporting and cancellation support
 */
async function processVideoDownloadAndUpload(ctx, state, statusMsg, downloadOptions = {}) {
  const abortController = new AbortController();
  state.abortController = abortController;
  state.data.statusMessageId = statusMsg.message_id;

  let lastStatusUpdate = 0;
  const updateProgressMessage = async (stageText, percent, currentBytes, totalBytes) => {
    if (abortController.signal.aborted) return;
    const now = Date.now();
    // Throttle UI updates to 1.5s
    if (now - lastStatusUpdate < 1500 && percent < 100 && percent > 0) {
      return;
    }
    lastStatusUpdate = now;

    const safePercent = Math.min(100, Math.max(0, percent || 0));
    const bar = formatProgressBar(safePercent, 10);
    let sizeDetails = "";
    if (totalBytes && totalBytes > 0) {
      const curFormatted = formatBytes(currentBytes || 0);
      const totFormatted = formatBytes(totalBytes);
      sizeDetails = `\n<i>حجم:</i> <code>${curFormatted} / ${totFormatted}</code>`;
    }

    const text =
      `<b>${stageText}</b>\n\n` +
      `[<code>${bar}</code>] <b>${safePercent}%</b>` +
      sizeDetails;

    try {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, text, {
        parse_mode: "HTML",
        reply_markup: buildActiveCancelKeyboard(),
      });
    } catch (_) {}
  };

  try {
    await updateProgressMessage("در حال شروع دانلود ویدیو بر روی سرور...", 0, 0, downloadOptions.sizeBytes || 0);

    // Initialize queue entry for this video
    stmts.insertQueue.run({ code: state.data.code, temp_path: null, status: 'downloading' });

    const downloadResult = await downloader.downloadVideo(
      state.data.url,
      config.TEMP_DIR,
      async (percent, downloadedBytes, totalBytes) => {
        await updateProgressMessage("در حال دانلود ویدیو بر روی سرور...", percent, downloadedBytes, totalBytes);
      },
      {
        directUrl: downloadOptions.directUrl,
        formatId: downloadOptions.formatId,
        abortSignal: abortController.signal,
      }
    );

    state.data.tempFilePath = downloadResult.filePath;
    state.data.videoTitle = downloadResult.title;
    state.data.videoSize = downloadResult.size;

    // Update queue: download finished, save temp path
    stmts.updateQueueStatus.run({ status: 'downloaded', code: state.data.code });
    stmts.updateQueueTempPath.run({ temp_path: downloadResult.filePath, code: state.data.code });

    await updateProgressMessage("دانلود تکمیل شد! در حال آماده‌سازی آپلود...", 100, downloadResult.size, downloadResult.size);

    // Update queue: uploading
    stmts.updateQueueStatus.run({ status: 'uploading', code: state.data.code });

    const uploadResult = await uploader.uploadVideoToStorage(
      ctx.api,
      downloadResult.filePath,
      config.STORAGE_CHANNEL_ID,
      async (percent, uploadedBytes, totalBytes) => {
        await updateProgressMessage("در حال آپلود ویدیو به چنل استوریج...", percent, uploadedBytes, totalBytes);
      },
      {
        abortSignal: abortController.signal,
      }
    );

    state.data.fileId = uploadResult.fileId;

    // Update queue: upload finished
    stmts.setQueueFileId.run({ file_id: uploadResult.fileId, status: 'uploaded', code: state.data.code });

    // Cleanup temporary video file from disk
    downloader.cleanupFile(downloadResult.filePath);
    state.data.tempFilePath = null;
    state.abortController = null;

    try {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (_) {}

    const targetActor = state.data.actorName || state.data.scrapedMetadata?.actors?.[0];

    if (targetActor) {
      state.data.actorName = targetActor;
      state.data.actorIndex = 0;
      await ctx.reply(
        `<b>ویدیو با موفقیت دانلود و در آرشیو ثبت شد!</b>\n` +
          `حجم: <b>${formatBytes(downloadResult.size)}</b>\n` +
          `👤 بازیگر شناسایی‌شده: <b>${targetActor}</b>\n\n` +
          (state.data.caption ? `<i>✅ کپشن پست به صورت خودکار بر اساس اطلاعات ویدیو آماده شد.</i>\n\n` : "") +
          `<b>مرحله دوم: جستجو و انتخاب ثامبنیل خودکار</b>`,
        { parse_mode: "HTML" }
      );
      await presentActorThumbnails(ctx, state, targetActor, 1);
    } else {
      state.step = "waiting_post_thumbnail";
      const hasCaption = Boolean(state.data.caption && state.data.caption.trim());
      await ctx.reply(
        `<b>ویدیو با موفقیت دانلود و در آرشیو ثبت شد!</b>\n` +
          `حجم: <b>${formatBytes(downloadResult.size)}</b>\n\n` +
          (hasCaption ? `<i>✅ کپشن پست به صورت خودکار بر اساس اطلاعات ویدیو آماده شد.</i>\n\n` : "") +
          `⚠️ <b>نام بازیگر به صورت خودکار شناسایی نشد.</b>\n\n` +
          `<b>مرحله دوم (ثامبنیل):</b>\n` +
          `• <b>نام بازیگر</b> را بنویسید تا عکس‌هایش جستجو شود.\n` +
          `• یا مستقیماً <b>عکس یا بنر پست</b> را از گالری ارسال فرمایید.`,
        {
          parse_mode: "HTML",
          reply_markup: buildCancelKeyboard(),
        }
      );
    }
  } catch (err) {
    if (abortController.signal.aborted || err.message?.includes("aborted")) {
      logger.info(`Operation gracefully cancelled for [${state.data?.code}]`);
      return;
    }
    logger.error("Error in post download/upload:", err);
    // Update queue: error
    if (state.data?.code) {
      stmts.setQueueError.run({ error_msg: err.message, code: state.data.code });
    }
    if (state.data?.tempFilePath) {
      downloader.cleanupFile(state.data.tempFilePath);
      state.data.tempFilePath = null;
    }
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `<b>خطا در پردازش ویدیو:</b>\n<code>${err.message}</code>\n\nلطفاً لینک را بررسی کرده و مجدداً تلاش فرمایید.`,
        { parse_mode: "HTML" }
      );
    } catch (_) {
      await ctx.reply(`خطا: ${err.message}`);
    }
  }
}

/**
 * Register automated channel post handlers
 */
function registerPostHandler(bot) {
  // Command /post
  bot.command("post", async (ctx) => {
    const userId = ctx.from.id;
    const perms = getPermissions(userId);

    if (!perms.canManageVideos) {
      await ctx.reply("شما دسترسی مدیریت ویدیوها و ارسال پست را ندارید.");
      return;
    }

    resetPostState(userId);
    postStates.set(userId, {
      step: "waiting_post_video",
      data: {
        code: generateVideoCode(),
      },
    });

    await ctx.reply(
      "<b>سیستم ایجاد پست خودکار کانال</b>\n\n" +
        "<b>مرحله اول:</b> لطفاً <b>لینک ویدیو</b> را ارسال کنید.\n\n" +
        "<i>پشتیبانی از:\n" +
        "- لینک‌های مستقیم mp4 / mkv\n" +
        "- یوتیوب و سایر پلتفرم‌ها</i>\n\n" +
        "<i>همچنین می‌توانید خود فایل ویدیو را مستقیماً فوروارد یا ارسال کنید.</i>",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Callback from admin panel button
  bot.callbackQuery("admin_post_start", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const perms = getPermissions(userId);

    if (!perms.canManageVideos) {
      await ctx.reply("شما دسترسی مدیریت ویدیوها را ندارید.");
      return;
    }

    resetPostState(userId);
    postStates.set(userId, {
      step: "waiting_post_video",
      data: {
        code: generateVideoCode(),
      },
    });

    await ctx.reply(
      "<b>سیستم ایجاد پست خودکار کانال</b>\n\n" +
        "<b>مرحله اول:</b> لطفاً <b>لینک ویدیو</b> را ارسال کنید.\n\n" +
        "<i>پشتیبانی از:\n" +
        "- لینک‌های مستقیم mp4 / mkv\n" +
        "- یوتیوب و سایر پلتفرم‌ها</i>",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Receive post photo manually from admin
  bot.on("message:photo", async (ctx, next) => {
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (
      !state ||
      (state.step !== "waiting_post_photo" && state.step !== "waiting_post_thumbnail")
    ) {
      return next();
    }

    // Capture highest resolution photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    state.data.photoFileId = photo.file_id;

    // Use caption if provided with the photo
    if (ctx.message.caption && ctx.message.caption.trim()) {
      state.data.caption = ctx.message.caption.trim();
      await sendPostPreview(ctx, state);
      return;
    }

    // Skip manual caption step if auto-generated by scraper
    if (state.data.caption && state.data.caption.trim()) {
      await sendPostPreview(ctx, state);
      return;
    }

    state.step = "waiting_post_caption";
    await ctx.reply(
      "<b>تصویر با موفقیت دریافت شد!</b>\n\n" +
        "<b>مرحله سوم:</b> لطفاً <b>متن کپشن پست</b> را بنویسید و ارسال کنید:\n\n" +
        "<i>(می‌توانید عنوان ویدیو، توضیحات، آیدی چنل و هشتگ‌های دلخواه را قرار دهید)</i>",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Receive video directly from Telegram upload/forward
  bot.on("message:video", async (ctx, next) => {
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (!state || state.step !== "waiting_post_video") {
      return next();
    }

    state.data.fileId = ctx.message.video.file_id;
    state.data.videoTitle = ctx.message.caption || "Telegram Video";
    state.step = "waiting_post_thumbnail";

    await ctx.reply(
      "<b>ویدیو مستقیماً از تلگرام ثبت شد!</b>\n\n" +
        "<b>مرحله دوم (ثامبنیل):</b>\n" +
        "• <b>نام بازیگر</b> را بنویسید تا عکس‌هایش جستجو شود.\n" +
        "• یا مستقیماً <b>عکس یا بنر پست</b> را ارسال فرمایید.",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Handle incoming text from admin during post creation
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (!state) {
      return next();
    }

    // Reset if a different command is issued
    if (ctx.message.text.startsWith("/")) {
      if (ctx.message.text !== "/post") {
        resetPostState(userId);
      }
      return next();
    }

    // Step 1: Video URL submitted
    if (state.step === "waiting_post_video") {
      const url = ctx.message.text.trim();
      if (!/^https?:\/\//i.test(url)) {
        await ctx.reply("لطفاً یک لینک معتبر اینترنتی ارسال کنید (شروع با http یا https).");
        return;
      }

      state.data.url = url;

      const statusMsg = await ctx.reply("<b>در حال اتصال و استخراج اطلاعات ویدیو...</b>", {
        parse_mode: "HTML",
        reply_markup: buildActiveCancelKeyboard(),
      });

      // Attempt to extract video metadata and qualities
      try {
        const metadata = await scraper.scrapeMetadata(url);
        if (metadata) {
          state.data.scrapedMetadata = metadata;
          if (metadata.title) {
            state.data.videoTitle = metadata.title;
          }
        }
      } catch (scrapeErr) {
        logger.warn(`Scraper metadata extraction error: ${scrapeErr.message}`);
      }

      const metadata = state.data.scrapedMetadata;
      const qualities = metadata?.qualities || [];

      // If multiple qualities are detected, prompt admin to select one
      if (qualities.length > 1) {
        state.step = "waiting_post_quality";
        state.data.statusMessageId = statusMsg.message_id;

        const keyboard = buildQualityKeyboard(qualities);
        const videoTitle = metadata?.title ? `\nعنوان: <b>${metadata.title}</b>` : "";
        const compText = metadata?.company ? `\nکمپانی: <b>${metadata.company}</b>` : "";

        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `<b>اطلاعات ویدیو با موفقیت دریافت شد!</b>${videoTitle}${compText}\n\n` +
            `این ویدیو دارای <b>${qualities.length} کیفیت</b> مختلف است.\n` +
            `لطفاً کیفیت مورد نظر را جهت دانلود انتخاب کنید:`,
          {
            parse_mode: "HTML",
            reply_markup: keyboard,
          }
        );
        return;
      }

      // Single quality or fallback
      const defaultQuality = qualities.length === 1 ? qualities[0] : null;
      const botInfo = await ctx.api.getMe();
      if (metadata) {
        state.data.caption = scraper.generateCaption(
          metadata,
          botInfo.username,
          state.data.code,
          defaultQuality?.label
        );
        if (Array.isArray(metadata.actors) && metadata.actors.length > 0) {
          state.data.actorName = metadata.actors[0];
          state.data.actorIndex = 0;
        }
      }

      await processVideoDownloadAndUpload(ctx, state, statusMsg, {
        directUrl: defaultQuality?.directUrl,
        formatId: defaultQuality?.formatId,
        sizeBytes: defaultQuality?.sizeBytes,
      });
      return;
    }

    // Step: Custom actor name search
    if (state.step === "waiting_custom_actor_name") {
      const customName = ctx.message.text.trim();
      await presentActorThumbnails(ctx, state, customName, 1);
      return;
    }

    // Step: While waiting for thumbnail, admin typed a text (actor name)
    if (state.step === "waiting_post_thumbnail") {
      const actorName = ctx.message.text.trim();
      await presentActorThumbnails(ctx, state, actorName, 1);
      return;
    }

    // Step 2: Post caption submitted
    if (state.step === "waiting_post_caption") {
      state.data.caption = ctx.message.text.trim();
      await sendPostPreview(ctx, state);
      return;
    }

    return next();
  });

  // Confirm and publish post to destination channel
  bot.callbackQuery("post_confirm", async (ctx) => {
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (!state || !state.data.fileId || !state.data.photoFileId) {
      await ctx.answerCallbackQuery({ text: "اطلاعات پست یافت نشد یا منقضی شده است." });
      return;
    }

    await ctx.answerCallbackQuery({ text: "در حال انتشار در کانال..." });

    try {
      // 1. Insert video record in SQLite database
      stmts.insertVideo.run({
        code: state.data.code,
        file_id: state.data.fileId,
        caption: state.data.caption || "",
      });

      // 2. Build channel inline keyboard button
      const botInfo = await ctx.api.getMe();
      const channelKeyboard = buildChannelPostKeyboard(botInfo.username, state.data.code);

      // 3. Post photo + caption + inline button to destination channel
      const channelMessage = await ctx.api.sendPhoto(
        config.POST_CHANNEL_ID,
        state.data.photoFileId,
        {
          caption: state.data.caption,
          parse_mode: "HTML",
          reply_markup: channelKeyboard,
        }
      );

      const channelLink = String(config.POST_CHANNEL_ID).startsWith("-100")
        ? `https://t.me/c/${String(config.POST_CHANNEL_ID).replace("-100", "")}/${channelMessage.message_id}`
        : null;

      logger.success(`Post published successfully to channel ${config.POST_CHANNEL_ID} for video [${state.data.code}]`);

      await ctx.reply(
        `<b>پست با موفقیت در کانال منتشر شد!</b>\n\n` +
          `کد اختصاصی ویدیو: <code>${state.data.code}</code>\n` +
          `لینک دریافت در ربات:\nhttps://t.me/${botInfo.username}?start=${state.data.code}\n` +
          (channelLink ? `\nمشاهده پست در کانال: <a href="${channelLink}">کلیک کنید</a>` : ""),
        { parse_mode: "HTML" }
      );

      resetPostState(userId);
    } catch (err) {
      logger.error("Error publishing post to channel:", err);
      await ctx.reply(`خطا در ارسال پست به کانال:\n<code>${err.message}</code>`, {
        parse_mode: "HTML",
      });
    }
  });

  // Re-edit caption from preview
  bot.callbackQuery("post_edit_caption", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (!state) return;
    state.step = "waiting_post_caption";

    await ctx.reply(
      "<b>ویرایش کپشن:</b>\nلطفاً متن جدید کپشن را ارسال فرمایید:",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Change post photo from preview
  bot.callbackQuery("post_change_photo", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (!state) return;

    if (state.data.actorName) {
      await presentActorThumbnails(ctx, state, state.data.actorName, 1);
      return;
    }

    state.step = "waiting_post_thumbnail";
    await ctx.reply(
      "<b>تغییر تصویر پست:</b>\n" +
        "می‌توانید <b>نام بازیگر</b> را بنویسید تا عکس‌های جدیدش جستجو شود، یا <b>عکس جدید</b> را از گالری ارسال فرمایید:",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Cancel post creation
  bot.callbackQuery("post_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "عملیات لغو شد." });
    const userId = ctx.from.id;
    resetPostState(userId);
    await ctx.reply("عملیات ایجاد و ارسال پست لغو گردید.");
  });

  // Handle quality selection callback
  bot.callbackQuery(/^post_quality_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (!state || state.step !== "waiting_post_quality") {
      await ctx.reply("انتخاب کیفیت نامعتبر یا منقضی شده است. لطفاً دستور /post را مجدداً ارسال کنید.");
      return;
    }

    const qualityId = ctx.match[1];
    const metadata = state.data.scrapedMetadata;
    const qualities = metadata?.qualities || [];
    const selected = qualities.find((q) => q.id === qualityId);

    const botInfo = await ctx.api.getMe();
    if (metadata) {
      state.data.caption = scraper.generateCaption(
        metadata,
        botInfo.username,
        state.data.code,
        selected?.label
      );
      if (Array.isArray(metadata.actors) && metadata.actors.length > 0) {
        state.data.actorName = metadata.actors[0];
        state.data.actorIndex = 0;
      }
    }

    const statusMsg = { message_id: ctx.callbackQuery.message.message_id };
    await processVideoDownloadAndUpload(ctx, state, statusMsg, {
      directUrl: selected?.directUrl,
      formatId: selected?.formatId,
      sizeBytes: selected?.sizeBytes,
    });
  });

  // Instant cancellation during active download/upload or quality selection
  bot.callbackQuery("post_cancel_active", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "عملیات لغو شد." });
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (state) {
      if (state.abortController) {
        try {
          state.abortController.abort();
        } catch (_) {}
      }
      if (state.data?.code) {
        try {
          stmts.updateQueueStatus.run({ status: "cancelled", code: state.data.code });
        } catch (_) {}
      }
      if (state.data?.tempFilePath) {
        downloader.cleanupFile(state.data.tempFilePath);
        state.data.tempFilePath = null;
      }
      resetPostState(userId);
    }

    try {
      await ctx.editMessageText(
        "❌ <b>عملیات لغو گردید و فایل‌های موقت پاکسازی شدند.</b>",
        { parse_mode: "HTML" }
      );
    } catch (_) {
      await ctx.reply("❌ عملیات لغو گردید.");
    }
  });

  // Select thumbnail from searched images
  bot.callbackQuery(/^post_thumb_sel_(\d+)$/, async (ctx) => {
    const userId = ctx.from.id;
    const state = getPostState(userId);

    if (!state || !state.data?.searchedImages) {
      await ctx.answerCallbackQuery({
        text: "اطلاعات منقضی شده است. لطفاً دستور /post را مجدداً ارسال کنید.",
      });
      return;
    }

    const selNum = parseInt(ctx.match[1], 10);
    const idx = selNum - 1;
    const chosen = state.data.searchedImages[idx];

    if (!chosen) {
      await ctx.answerCallbackQuery({ text: "تصویر یافت نشد." });
      return;
    }

    await ctx.answerCallbackQuery({ text: `✅ عکس شماره ${selNum} انتخاب شد!` });

    // If file_id is already cached from album
    if (chosen.fileId) {
      state.data.photoFileId = chosen.fileId;
    } else {
      // Fallback: send photo to get file_id
      try {
        const sent = await ctx.replyWithPhoto(chosen.highResUrl, {
          caption: `✅ ثامبنیل انتخابی: عکس شماره ${selNum}`,
        });
        state.data.photoFileId = sent.photo[sent.photo.length - 1].file_id;
      } catch (_) {
        const buf = await imageSearch.fetchImageBuffer(chosen.highResUrl, chosen.thumbUrl);
        if (buf) {
          const sent = await ctx.replyWithPhoto(new InputFile(buf), {
            caption: `✅ ثامبنیل انتخابی: عکس شماره ${selNum}`,
          });
          state.data.photoFileId = sent.photo[sent.photo.length - 1].file_id;
        } else {
          await ctx.reply("خطا در بارگذاری تصویر. لطفاً تصویر دیگری را انتخاب فرمایید.");
          return;
        }
      }
    }

    // Skip manual caption if already generated
    if (state.data.caption && state.data.caption.trim()) {
      await sendPostPreview(ctx, state);
      return;
    }

    state.step = "waiting_post_caption";
    await ctx.reply(
      "<b>تصویر ثامبنیل با موفقیت تنظیم شد!</b>\n\n" +
        "<b>مرحله سوم:</b> لطفاً <b>متن کپشن پست</b> را بنویسید و ارسال کنید:",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Next 10 images
  bot.callbackQuery("post_thumb_next", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال دریافت تصاویر بعدی..." });
    const userId = ctx.from.id;
    const state = getPostState(userId);
    if (!state || !state.data?.actorName) return;

    const nextPage = (state.data.imagePage || 1) + 1;
    await presentActorThumbnails(ctx, state, state.data.actorName, nextPage);
  });

  // Previous 10 images
  bot.callbackQuery("post_thumb_prev", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال بازگشت به صفحه قبل..." });
    const userId = ctx.from.id;
    const state = getPostState(userId);
    if (!state || !state.data?.actorName) return;

    const prevPage = Math.max(1, (state.data.imagePage || 1) - 1);
    await presentActorThumbnails(ctx, state, state.data.actorName, prevPage);
  });

  // Switch to another actor detected in video metadata
  bot.callbackQuery(/^post_thumb_actor_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const state = getPostState(userId);
    const actorIdx = parseInt(ctx.match[1], 10);
    const actors = state?.data?.scrapedMetadata?.actors || [];
    const targetActor = actors[actorIdx];
    if (!targetActor) return;

    state.data.actorName = targetActor;
    state.data.actorIndex = actorIdx;
    await presentActorThumbnails(ctx, state, targetActor, 1);
  });

  // Custom actor name search button
  bot.callbackQuery("post_thumb_search_name", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const state = getPostState(userId);
    if (!state) return;

    state.step = "waiting_custom_actor_name";
    await ctx.reply(
      "🔍 <b>جستجوی نام دلخواه:</b>\n\n" +
        "لطفاً <b>نام بازیگر مورد نظر</b> را تایپ و ارسال کنید:\n" +
        "<i>(ترجیحاً نام انگلیسی بازیگر)</i>",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });

  // Manual photo upload prompt
  bot.callbackQuery("post_thumb_manual", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const state = getPostState(userId);
    if (!state) return;

    state.step = "waiting_post_photo";
    await ctx.reply(
      "📤 <b>ارسال دستی عکس:</b>\n" +
        "لطفاً تصویر مورد نظر خود را از گالری ارسال فرمایید:",
      {
        parse_mode: "HTML",
        reply_markup: buildCancelKeyboard(),
      }
    );
  });
}

module.exports = {
  registerPostHandler,
  getPostState,
  resetPostState,
};

