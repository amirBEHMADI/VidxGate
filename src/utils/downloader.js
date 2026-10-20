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
 * @returns {"watchporn" | "sxyprn" | "direct" | "generic"}
 */
function detectUrlType(url) {
  if (!url || typeof url !== "string") return "generic";
  const trimmed = url.trim();

  if (/watchporn\.to/i.test(trimmed)) return "watchporn";
  if (/sxyprn\.net/i.test(trimmed)) return "sxyprn";
  if (/\.(mp4|mkv|mov|webm|avi)(\?.*)?$/i.test(trimmed)) return "direct";

  return "generic";
}

/**
 * Extract direct video URL from watchporn.to
 * @param {string} pageUrl
 */
async function extractWatchPorn(pageUrl) {
  logger.info(`Extracting watchporn.to: ${pageUrl}`);
  const response = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch watchporn page: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Extract page title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let title = titleMatch ? titleMatch[1].replace(/\s*-\s*watchporn\.to.*/i, "").trim() : "WatchPorn Video";

  // Extract 1080p and 720p stream links from flashvars
  const videoAltMatch = html.match(/video_alt_url:\s*['"]([^'"]+)['"]/);
  const videoMatch = html.match(/video_url:\s*['"]([^'"]+)['"]/);

  const directUrl = (videoAltMatch && videoAltMatch[1]) || (videoMatch && videoMatch[1]);

  if (!directUrl) {
    throw new Error("Could not find video_url or video_alt_url in watchporn.to page");
  }

  return {
    directUrl,
    title,
    headers: {
      Referer: pageUrl,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  };
}

/**
 * Sxyprn decryption helper functions
 */
function ssut51(arg) {
  const str = String(arg).replace(/[^0-9]/g, "");
  let sut = 0;
  for (let i = 0; i < str.length; i++) {
    sut += parseInt(str.charAt(i), 10);
  }
  return sut;
}

function boo(ss, es, host) {
  const b = Buffer.from(`${ss}-${host}-${es}`).toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ".");
}

function preda(arg) {
  arg[5] = (
    parseInt(arg[5], 10) -
    (parseInt(ssut51(arg[6]), 10) + parseInt(ssut51(arg[7]), 10))
  ).toString();
  return arg;
}

/**
 * Extract full quality video URL from sxyprn.net without a headless browser
 * @param {string} pageUrl
 */
async function extractSxyPrn(pageUrl) {
  logger.info(`Extracting sxyprn.net: ${pageUrl}`);
  const response = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sxyprn page: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Extract page title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let title = titleMatch ? titleMatch[1].replace(/\s*on\s*SexyPorn.*/i, "").trim() : "SxyPrn Video";

  // Extract vnfo data from vidsnfo element
  const vnfoMatch = html.match(/data-vnfo='([^']+)'/i) || html.match(/data-vnfo="([^"]+)"/i);

  if (!vnfoMatch) {
    throw new Error("Could not find data-vnfo in sxyprn page");
  }

  let vnfoData;
  try {
    vnfoData = JSON.parse(vnfoMatch[1]);
  } catch (err) {
    throw new Error(`Failed to parse sxyprn data-vnfo JSON: ${err.message}`);
  }

  const keys = Object.keys(vnfoData);
  if (!keys.length) {
    throw new Error("sxyprn data-vnfo object is empty");
  }

  const rawSrc = vnfoData[keys[0]];
  const host = "www.sxyprn.net";

  const tmp = rawSrc.split("/");
  tmp[1] += `5/${boo(ssut51(tmp[6]), ssut51(tmp[7]), host)}`;
  const modified = preda(tmp);
  const intermediateUrl = `https://${host}${modified.join("/")}`;

  // Fetch location header (HTTP 302 to CDN)
  const headRes = await fetch(intermediateUrl, {
    method: "HEAD",
    redirect: "manual",
    headers: {
      Referer: pageUrl,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  let directUrl = headRes.headers.get("location");
  if (!directUrl) {
    directUrl = intermediateUrl;
  } else if (directUrl.startsWith("//")) {
    directUrl = `https:${directUrl}`;
  }

  return {
    directUrl,
    title,
    headers: {
      Referer: pageUrl,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  };
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

  if (type === "watchporn") {
    const extracted = await extractWatchPorn(url);
    const result = await streamUrlToFile(extracted.directUrl, targetPath, extracted.headers, onProgress);
    return {
      filePath: result.filePath,
      title: extracted.title,
      size: result.size,
    };
  }

  if (type === "sxyprn") {
    const extracted = await extractSxyPrn(url);
    const result = await streamUrlToFile(extracted.directUrl, targetPath, extracted.headers, onProgress);
    return {
      filePath: result.filePath,
      title: extracted.title,
      size: result.size,
    };
  }

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
  extractWatchPorn,
  extractSxyPrn,
  downloadVideo,
  streamUrlToFile,
  cleanupFile,
  getYtDlpPath,
};
