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
 * @param {object} [options]
 */
function downloadWithYtDlp(url, outputPath, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    const ytDlpBinary = getYtDlpPath();
    logger.info(`Running yt-dlp (${ytDlpBinary}) for ${url}`);

    const format =
      options.formatSelection ||
      (options.qualityId
        ? `bestvideo[height<=${options.qualityId.replace("p", "")}]+bestaudio/best[height<=${options.qualityId.replace("p", "")}]/best`
        : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");

    const args = [
      "--proxy",
      "",
      "--no-playlist",
      "-f",
      format,
      "-o",
      outputPath,
      "--newline",
      url,
    ];

    const proc = spawn(ytDlpBinary, args, {
      windowsHide: true,
      env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "" },
    });

    if (options.onProcessSpawn) {
      options.onProcessSpawn(proc);
    }

    let isAborted = false;
    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        isAborted = true;
        try {
          proc.kill("SIGKILL");
        } catch (_) {}
        cleanupFile(outputPath);
        reject(new Error("Download aborted by user"));
      });
    }

    let stdoutData = "";
    let stderrData = "";
    let lastReportedTime = 0;

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      stdoutData += text;

      // Parse yt-dlp progress percentage and bytes
      // Pattern e.g.: [download]  45.0% of ~500.00MiB at 10.00MiB/s
      const percentMatch = text.match(/\[download\]\s+([0-9.]+)%/);
      const totalMatch = text.match(/of\s+~?([0-9.]+)\s*([KMG]iB)/i);

      if (percentMatch && onProgress) {
        const percent = parseFloat(percentMatch[1]);
        let totalBytes = 0;
        let downloadedBytes = 0;

        if (totalMatch) {
          const val = parseFloat(totalMatch[1]);
          const unit = totalMatch[2].toUpperCase();
          const multiplier = unit === "GIB" ? 1024 * 1024 * 1024 : unit === "MIB" ? 1024 * 1024 : 1024;
          totalBytes = Math.round(val * multiplier);
          downloadedBytes = Math.round((percent / 100) * totalBytes);
        }

        const now = Date.now();
        if (now - lastReportedTime > 1500) {
          lastReportedTime = now;
          onProgress(Math.min(99, Math.round(percent)), downloadedBytes, totalBytes);
        }
      }
    });

    proc.stderr.on("data", (data) => {
      stderrData += data.toString();
    });

    proc.on("close", (code) => {
      if (isAborted) return;
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({
          filePath: outputPath,
          title: path.basename(outputPath),
        });
      } else {
        cleanupFile(outputPath);
        reject(
          new Error(
            `yt-dlp failed with code ${code}: ${stderrData.slice(-300) || stdoutData.slice(-300)}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      if (isAborted) return;
      cleanupFile(outputPath);
      reject(new Error(`Failed to launch yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Download stream from a URL to local disk with progress tracking and abort support
 * @param {string} directUrl
 * @param {string} targetPath
 * @param {object} headers
 * @param {Function} [onProgress] (percent, downloadedBytes, totalBytes)
 * @param {object} [options]
 */
async function streamUrlToFile(directUrl, targetPath, headers = {}, onProgress, options = {}) {
  const signal = options.abortSignal;
  const response = await fetch(directUrl, { headers, signal });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status} (${response.statusText})`);
  }

  const contentLength = Number(response.headers.get("content-length")) || 0;
  const fileStream = fs.createWriteStream(targetPath);

  let downloadedBytes = 0;
  let lastReportedTime = 0;

  const reader = response.body.getReader();

  return new Promise((resolve, reject) => {
    let aborted = false;

    if (signal) {
      signal.addEventListener("abort", () => {
        aborted = true;
        try {
          reader.cancel();
          fileStream.destroy();
          cleanupFile(targetPath);
        } catch (_) {}
        reject(new Error("Download aborted by user"));
      });
    }

    fileStream.on("error", (err) => {
      cleanupFile(targetPath);
      reject(err);
    });

    async function pump() {
      try {
        while (true) {
          if (aborted) break;
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

          // Throttle progress updates to at most once every 1.5 seconds
          const now = Date.now();
          if (now - lastReportedTime > 1500 && onProgress) {
            lastReportedTime = now;
            const percent = contentLength > 0 ? Math.round((downloadedBytes / contentLength) * 100) : 0;
            onProgress(percent, downloadedBytes, contentLength);
          }
        }
      } catch (err) {
        fileStream.destroy();
        cleanupFile(targetPath);
        reject(err);
      }
    }

    pump();
  });
}

/**
 * High-level video downloader supporting all link types, cancellation, and quality options
 * @param {string} url
 * @param {string} tempDir
 * @param {Function} [onProgress]
 * @param {object} [options]
 * @returns {Promise<{ filePath: string, title: string, size: number }>}
 */
async function downloadVideo(url, tempDir, onProgress, options = {}) {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const targetUrl = options.directUrl || url;
  const type = options.directUrl ? "direct" : detectUrlType(targetUrl);
  const randomSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const targetPath = path.join(tempDir, `video_${randomSuffix}.mp4`);

  logger.info(`Detected link type: ${type} for ${targetUrl}`);

  if (type === "direct") {
    const result = await streamUrlToFile(targetUrl, targetPath, {}, onProgress, options);
    return {
      filePath: result.filePath,
      title: path.basename(targetUrl.split("?")[0]) || "Video",
      size: result.size,
    };
  }

  // Generic fallback (e.g. YouTube or other platforms via yt-dlp)
  const result = await downloadWithYtDlp(targetUrl, targetPath, onProgress, options);
  const stat = fs.statSync(result.filePath);
  return {
    filePath: result.filePath,
    title: result.title,
    size: stat.size,
  };
}

/**
 * Probe available video format resolutions and approximate sizes with yt-dlp
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<Array<{ id: string, label: string, formatId: string, sizeBytes: number, sizeFormatted: string }>>}
 */
function probeYtDlpFormats(url, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const ytDlpBinary = getYtDlpPath();
    const args = ["--proxy", "", "--no-playlist", "-J", url];
    const proc = spawn(ytDlpBinary, args, {
      windowsHide: true,
      env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "" },
    });

    let stdout = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch (_) {}
      resolve([]);
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve([]);
      try {
        const info = JSON.parse(stdout);
        const formats = info.formats || [];
        const qualitiesMap = new Map();
        const { formatBytes } = require("./helpers");

        for (const f of formats) {
          if (!f.height || f.height < 480) continue;
          const label = `${f.height}p`;
          const sizeBytes = f.filesize || f.filesize_approx || 0;
          if (!qualitiesMap.has(label) || (sizeBytes > 0 && !qualitiesMap.get(label).sizeBytes)) {
            qualitiesMap.set(label, {
              id: label,
              label,
              formatId: f.format_id,
              sizeBytes,
              sizeFormatted: sizeBytes > 0 ? formatBytes(sizeBytes) : "",
            });
          }
        }
        resolve(Array.from(qualitiesMap.values()));
      } catch (_) {
        resolve([]);
      }
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
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
  downloadWithYtDlp,
  probeYtDlpFormats,
  cleanupFile,
  getYtDlpPath,
};
