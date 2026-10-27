const fs = require("fs");
const path = require("path");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { CustomFile } = require("telegram/client/uploads");
const { InputFile } = require("grammy");
const config = require("../config");
const logger = require("./logger");

let gramJsClient = null;

/**
 * Initialize and retrieve GramJS MTProto client authenticated via bot token
 */
async function getGramJsClient() {
  if (gramJsClient && gramJsClient.connected) {
    return gramJsClient;
  }

  if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured in .env to upload files larger than 50MB via GramJS"
    );
  }

  logger.info("Initializing GramJS MTProto client with bot token...");
  gramJsClient = new TelegramClient(
    new StringSession(""),
    Number(config.TELEGRAM_API_ID),
    config.TELEGRAM_API_HASH,
    {
      connectionRetries: 5,
    }
  );

  await gramJsClient.start({
    botAuthToken: config.BOT_TOKEN,
  });

  logger.success("GramJS MTProto client connected successfully!");
  return gramJsClient;
}

/**
 * Smart video uploader to storage channel
 * For files under 50MB: Standard Telegram Bot API
 * For files over 50MB (up to 2GB): GramJS streaming 512KB chunks
 *
 * @param {object} botApi - grammY bot.api instance
 * @param {string} filePath - Path to local video file
 * @param {string} channelId - Destination storage channel ID
 * @param {Function} [onProgress] - Upload progress callback
 * @returns {Promise<{ fileId: string, messageId: number, isMsgRef: boolean }>}
 */
async function uploadVideoToStorage(botApi, filePath, channelId, onProgress) {
  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  const fileName = path.basename(filePath);

  logger.info(`Preparing upload for ${fileName} (${fileSizeMB.toFixed(2)} MB) to storage channel ${channelId}`);

  // Under 50MB and GramJS not configured
  if (fileSizeMB <= 49.5 && !config.TELEGRAM_API_ID) {
    logger.info("File is under 50MB. Uploading via standard Telegram Bot API...");
    if (onProgress) onProgress(20);

    const inputFile = new InputFile(filePath);
    const sent = await botApi.sendVideo(channelId, inputFile, {
      supports_streaming: true,
      caption: `Archived: ${fileName} (${fileSizeMB.toFixed(1)} MB)`,
    });

    if (onProgress) onProgress(100);
    return {
      fileId: sent.video.file_id,
      messageId: sent.message_id,
      isMsgRef: false,
    };
  }

  // Over 50MB (up to 2GB) via GramJS
  logger.info("Uploading via GramJS MTProto client (Stream chunks up to 2GB)...");
  const client = await getGramJsClient();
  const toUpload = new CustomFile(fileName, stats.size, filePath);

  let lastReportedPercent = 0;
  let lastActivityTime = Date.now();

  // Dynamic max timeout: minimum 20 mins, or ~1 min per 20MB (e.g. 1500MB = 75 mins)
  const maxTimeoutMinutes =
    config.UPLOAD_TIMEOUT_MINUTES > 0
      ? config.UPLOAD_TIMEOUT_MINUTES
      : Math.max(20, Math.ceil(fileSizeMB / 20));
  const maxTimeoutMs = maxTimeoutMinutes * 60 * 1000;

  // Inactivity timeout: only fail if no progress received for 4 minutes
  const STALL_TIMEOUT_MS = 4 * 60 * 1000;

  let timerId = null;
  let stallCheckInterval = null;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(
        new Error(
          `Upload timed out after exceeding total limit of ${maxTimeoutMinutes} minutes (${fileSizeMB.toFixed(1)} MB)`
        )
      );
    }, maxTimeoutMs);

    stallCheckInterval = setInterval(() => {
      if (Date.now() - lastActivityTime > STALL_TIMEOUT_MS) {
        reject(
          new Error(
            `Upload stalled: no progress received for ${(STALL_TIMEOUT_MS / 60000).toFixed(0)} minutes`
          )
        );
      }
    }, 15000);
  });

  const uploadWorkers = config.UPLOAD_WORKERS || 4;

  const uploadPromise = client.sendFile(channelId, {
    file: toUpload,
    workers: uploadWorkers,
    videoNote: false,
    supportsStreaming: true,
    caption: `Archived via GramJS: ${fileName} (${fileSizeMB.toFixed(1)} MB)`,
    progressCallback: (progress) => {
      lastActivityTime = Date.now();
      const currentPercent = Math.min(99, Math.round(progress * 100));
      if (currentPercent - lastReportedPercent >= 5 && onProgress) {
        lastReportedPercent = currentPercent;
        onProgress(currentPercent);
      }
    },
  });

  let sentMessage;
  try {
    sentMessage = await Promise.race([uploadPromise, timeoutPromise]);
  } catch (err) {
    logger.error("Video upload failed:", err);
    if (onProgress) onProgress(0);
    throw err;
  } finally {
    if (timerId) clearTimeout(timerId);
    if (stallCheckInterval) clearInterval(stallCheckInterval);
  }

  if (onProgress) onProgress(100);
  logger.success(`Upload complete via GramJS! Storage Message ID: ${sentMessage.id}`);

  // Reference stored as msg:channelId:messageId for copyMessage delivery
  return {
    fileId: `msg:${channelId}:${sentMessage.id}`,
    messageId: sentMessage.id,
    isMsgRef: true,
  };
}

module.exports = {
  getGramJsClient,
  uploadVideoToStorage,
};
