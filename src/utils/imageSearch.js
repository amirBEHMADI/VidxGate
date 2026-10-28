const cheerio = require("cheerio");
const logger = require("./logger");

/**
 * Clean and format actor name for searching
 * @param {string} actorName
 * @returns {string}
 */
function cleanActorName(actorName) {
  if (!actorName || typeof actorName !== "string") return "";
  return actorName
    .replace(/^#+/, "")
    .replace(/[_\-]+/g, " ")
    .trim();
}

/**
 * Search high-quality images for an actor (prioritizing Instagram and model photos)
 * @param {string} actorName - Name of the performer/actor
 * @param {object} [options]
 * @param {number} [options.page=1] - Results page
 * @param {number} [options.limit=10] - Number of images to return
 * @returns {Promise<Array<{ title: string, highResUrl: string, directUrl: string, thumbUrl: string }>>}
 */
async function searchActorImages(actorName, options = {}) {
  const cleaned = cleanActorName(actorName);
  if (!cleaned) return [];

  const page = Math.max(1, parseInt(options.page || 1, 10));
  const limit = Math.max(1, Math.min(20, parseInt(options.limit || 10, 10)));
  const first = (page - 1) * 25 + 1;

  logger.info(`Searching images for actor "${cleaned}" (page ${page}, limit ${limit})...`);

  const queries = [
    `"${cleaned}" site:instagram.com`,
    `"${cleaned}" instagram`,
    `"${cleaned}" model photoshoot`,
  ];

  const results = [];
  const seenUrls = new Set();

  for (const q of queries) {
    if (results.length >= limit) break;

    try {
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=${first}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!response.ok) {
        logger.warn(`Bing images search returned status ${response.status} for query: ${q}`);
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      $("a.iusc").each((_, el) => {
        if (results.length >= limit) return false;

        try {
          const mAttr = $(el).attr("m");
          if (!mAttr) return;

          const m = JSON.parse(mAttr);
          const directUrl = m.murl;
          const thumbUrl = m.turl;
          const title = (m.t || m.desc || "").trim();

          if (!thumbUrl && !directUrl) return;

          // Convert Bing thumbUrl to crisp high-res version (1080x1350 with high quality jpeg)
          let highResUrl = thumbUrl;
          if (thumbUrl && thumbUrl.includes("/th?id=")) {
            highResUrl = thumbUrl.replace(/&pid=[^&]+/, "") + "&w=1080&h=1350&c=7&rs=1&qlt=90";
          } else if (!highResUrl && directUrl) {
            highResUrl = directUrl;
          }

          const dedupeKey = (thumbUrl || directUrl).split("?")[0];
          if (!seenUrls.has(dedupeKey)) {
            seenUrls.add(dedupeKey);
            results.push({
              title,
              highResUrl,
              directUrl,
              thumbUrl,
            });
          }
        } catch (_) {}
      });
    } catch (err) {
      logger.warn(`Error during image search query "${q}": ${err.message}`);
    }
  }

  logger.info(`Found ${results.length} images for "${cleaned}"`);
  return results.slice(0, limit);
}

/**
 * Safely fetch image buffer with timeout and fallback
 * @param {string} url
 * @param {string} [fallbackUrl]
 * @returns {Promise<Buffer|null>}
 */
async function fetchImageBuffer(url, fallbackUrl = null) {
  const tryFetch = async (targetUrl) => {
    if (!targetUrl) return null;
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  };

  try {
    const buffer = await tryFetch(url);
    if (buffer && buffer.length > 0) return buffer;
  } catch (_) {}

  if (fallbackUrl && fallbackUrl !== url) {
    try {
      const buffer = await tryFetch(fallbackUrl);
      if (buffer && buffer.length > 0) return buffer;
    } catch (_) {}
  }

  return null;
}

module.exports = {
  cleanActorName,
  searchActorImages,
  fetchImageBuffer,
};
