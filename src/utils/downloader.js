const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const logger = require("./logger");

/**
 * Resolve the path to the yt-dlp binary
 */
function getYtDlpPath() {
  const localAppData = process.env.LOCALAPPDATA;
  const candidate = localAppData
    ? path.join(localAppData, "Programs", "yt-dlp", "yt-dlp.exe")
    : null;

  if (candidate && fs.existsSync(candidate)) {
    return candidate;
  }
  return "yt-dlp";
}

/**
 * Detect URL type based on pattern
 * @param {string} url
 * @returns {"direct" | "generic"}
 */
function detectUrlType(url) {
  if (!url || typeof url !== "string") return "generic";
  const trimmed = url.trim();

  if (/\.(mp4|mkv|mov|webm|avi)(\?.*)?$/i.test(trimmed)) return "direct";

  return "generic";
}

/**
 * Download video using yt-dlp for generic video platforms
 * @param {string} url
 * @param {string} outputPath
 * @param {Function} [onProgress]
 */
function downloadWithYtDlp(url, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const ytDlpBinary = getYtDlpPath();
    logger.info(`Running yt-dlp (${ytDlpBinary}) for ${url}`);

    const args = [
      "--proxy",
      "",
      "--no-playlist",
      "-f",
      "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "-o",
      outputPath,
      "--newline",
      url,
    ];

    const proc = spawn(ytDlpBinary, args, {
      windowsHide: true,
      env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "" },
    });

    let stdoutData = "";
    let stderrData = "";

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      stdoutData += text;

      // Parse yt-dlp progress percentage
      const match = text.match(/\[download\]\s+([0-9.]+)%/);
      if (match && onProgress) {
        const percent = parseFloat(match[1]);
        onProgress(Math.min(99, Math.round(percent)));
      }
    });

    proc.stderr.on("data", (data) => {
      stderrData += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({
          filePath: outputPath,
          title: path.basename(outputPath),
        });
      } else {
        reject(
          new Error(
            `yt-dlp failed with code ${code}: ${stderrData.slice(-300) || stdoutData.slice(-300)}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to launch yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Download stream from a URL to local disk with progress tracking
 * @param {string} directUrl
 * @param {string} targetPath
 * @param {object} headers
 * @param {Function} [onProgress] (percent, downloadedBytes, totalBytes)
 */
async function streamUrlToFile(directUrl, targetPath, headers = {}, onProgress) {
  const response = await fetch(directUrl, { headers });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status} (${response.statusText})`);
  }

  const contentLength = Number(response.headers.get("content-length")) || 0;
  const fileStream = fs.createWriteStream(targetPath);

  let downloadedBytes = 0;
  let lastReportedTime = 0;

  const reader = response.body.getReader();

  return new Promise((resolve, reject) => {
    fileStream.on("error", reject);

    async function pump() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            fileStream.end(() => {
              if (onProgress) onProgress(100, downloadedBytes, contentLength);
              resolve({
                filePath: targetPath,
                size: downloadedBytes,
              });
            });
            break;
          }

          downloadedBytes += value.length;
          fileStream.write(Buffer.from(value));

          // Throttle progress updates to at most once every 2 seconds
          const now = Date.now();
          if (now - lastReportedTime > 2000 && onProgress) {
            lastReportedTime = now;
            const percent = contentLength > 0 ? Math.round((downloadedBytes / contentLength) * 100) : 0;
            onProgress(percent, downloadedBytes, contentLength);
          }
        }
      } catch (err) {
        fileStream.destroy();
        reject(err);
      }
    }

    pump();
  });
}

/**
 * High-level video downloader supporting all link types
 * @param {string} url
 * @param {string} tempDir
 * @param {Function} [onProgress]
 * @returns {Promise<{ filePath: string, title: string, size: number }>}
 */
async function downloadVideo(url, tempDir, onProgress) {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const type = detectUrlType(url);
  const randomSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const targetPath = path.join(tempDir, `video_${randomSuffix}.mp4`);

  logger.info(`Detected link type: ${type} for ${url}`);

  if (type === "direct") {
    const result = await streamUrlToFile(url, targetPath, {}, onProgress);
    return {
      filePath: result.filePath,
      title: path.basename(url.split("?")[0]) || "Video",
      size: result.size,
    };
  }

  // Generic fallback (e.g. YouTube or other platforms)
  const result = await downloadWithYtDlp(url, targetPath, onProgress);
  const stat = fs.statSync(result.filePath);
  return {
    filePath: result.filePath,
    title: result.title,
    size: stat.size,
  };
}

/**
 * Safely remove temporary file from disk
 * @param {string} filePath
 */
function cleanupFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Cleaned up temp file: ${filePath}`);
    }
  } catch (err) {
    logger.warn(`Could not delete temp file ${filePath}: ${err.message}`);
  }
}

module.exports = {
  detectUrlType,
  downloadVideo,
  streamUrlToFile,
  cleanupFile,
  getYtDlpPath,
};
