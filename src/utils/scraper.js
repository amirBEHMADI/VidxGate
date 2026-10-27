const cheerio = require("cheerio");
const logger = require("./logger");

/**
 * Convert ISO 8601 duration (e.g., PT1H0M14S, PT0H31M52S, PT41M) to formatted minutes string (e.g. "41Min")
 * @param {string} durationStr
 * @returns {string}
 */
function parseIsoDuration(durationStr) {
  if (!durationStr || typeof durationStr !== "string") return "";
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return "";

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  let totalMinutes = hours * 60 + minutes;
  if (totalMinutes === 0 && seconds > 0) {
    totalMinutes = Math.round(seconds / 60) || 1;
  }

  return totalMinutes > 0 ? `${totalMinutes}Min` : "";
}

/**
 * Clean string to be a valid Telegram hashtag without spaces or invalid punctuation
 * @param {string} str
 * @returns {string}
 */
function toHashtag(str) {
  if (!str || typeof str !== "string") return "";
  const cleaned = str
    .replace(/^#+/, "")
    .replace(/[\s\-_'".&,;:!?()[\]{}]+/g, "");
  return cleaned ? `#${cleaned}` : "";
}

/**
 * Parse metadata from watchporn.to HTML
 * @param {string} html
 * @param {string} [url]
 * @returns {object}
 */
function parseWatchPorn(html, url) {
  const $ = cheerio.load(html);

  // Parse JSON-LD VideoObject if available
  let jsonLdVideo = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      if (data && data["@type"] === "VideoObject") {
        jsonLdVideo = data;
      }
    } catch (_) {}
  });

  // 1. Company
  let company = "";
  if (jsonLdVideo?.publisher?.name) {
    company = jsonLdVideo.publisher.name.trim();
  } else {
    company = $("a.wp-studio").first().clone().children().remove().end().text().trim();
  }

  // 2. Title
  let rawTitle =
    jsonLdVideo?.name ||
    $("h1.wp-vi__title").first().text().trim() ||
    $("title").text().trim();

  let title = rawTitle;
  if (company && title.toLowerCase().endsWith(` - ${company.toLowerCase()}`)) {
    title = title.slice(0, -(company.length + 3)).trim();
  }

  // 3. Actors
  let actors = [];
  if (Array.isArray(jsonLdVideo?.actor)) {
    actors = jsonLdVideo.actor
      .map((a) => (typeof a === "string" ? a : a?.name))
      .filter(Boolean)
      .map((a) => a.trim());
  }

  if (actors.length === 0) {
    $(".wp-perf a").each((_, el) => {
      const name = $(el).text().trim();
      if (name && !actors.includes(name)) {
        actors.push(name);
      }
    });
  }

  if (actors.length === 0) {
    const titleParts = title.split(" - ");
    if (titleParts.length > 1) {
      actors = [titleParts[0].trim()];
    }
  }

  // 4. Categories
  let categories = [];
  if (Array.isArray(jsonLdVideo?.genre)) {
    categories = jsonLdVideo.genre.map((g) => g.trim()).filter(Boolean);
  } else {
    $("a.wp-vchip").each((_, el) => {
      const cat = $(el).text().trim();
      if (cat && !categories.includes(cat)) {
        categories.push(cat);
      }
    });
  }

  // 5. Resolution
  let resolution = "720p";
  const hdText = $(".wp-hd").first().text().trim();
  if (/1080p?/i.test(hdText)) {
    resolution = "1080p";
  } else if (/720p?/i.test(hdText)) {
    resolution = "720p";
  } else {
    const flashvarsMatch = html.match(/flashvars\s*=\s*({[\s\S]*?});/);
    if (flashvarsMatch) {
      if (/1080/i.test(flashvarsMatch[1])) {
        resolution = "1080p";
      } else if (/720/i.test(flashvarsMatch[1])) {
        resolution = "720p";
      }
    }
  }

  // 6. Duration
  let duration = "";
  if (jsonLdVideo?.duration) {
    duration = parseIsoDuration(jsonLdVideo.duration);
  }
  if (!duration) {
    const durationMatch = html.match(/(\d+):(\d{2})/);
    if (durationMatch) {
      const mins = parseInt(durationMatch[1], 10);
      duration = `${mins}Min`;
    }
  }

  // 7. Release Year
  let releaseYear = "";
  const uploadDate =
    jsonLdVideo?.uploadDate ||
    $('meta[property="video:release_date"]').attr("content") ||
    $('meta[property="og:video:release_date"]').attr("content");

  if (uploadDate) {
    const yearMatch = uploadDate.match(/^(\d{4})/);
    if (yearMatch) {
      releaseYear = yearMatch[1];
    }
  }
  if (!releaseYear) {
    releaseYear = new Date().getFullYear().toString();
  }

  return {
    title,
    company,
    actors,
    resolution,
    duration,
    releaseYear,
    categories,
  };
}

/**
 * Parse metadata from sxyprn.net HTML
 * @param {string} html
 * @param {string} [url]
 * @returns {object}
 */
function parseSxyPrn(html, url) {
  const $ = cheerio.load(html);

  // 1. Company
  let company = $("b.sub_cat_s, .sub_cat_s").first().text().trim();

  // 2. Actors: from <a class="ps_link">
  const actors = [];
  $("a.ps_link").each((_, el) => {
    const name = $(el).text().trim();
    if (name && !actors.includes(name)) {
      actors.push(name);
    }
  });

  // 3. Categories: from <a class="hash_link">
  const categories = [];
  $("a.hash_link").each((_, el) => {
    let cat = $(el).attr("label") || $(el).text();
    cat = cat.replace(/^#/, "").trim();
    if (cat && !categories.includes(cat)) {
      categories.push(cat);
    }
  });

  // 4. Resolution
  let resolution = "720p";
  const shdText = $("span.shd_small, .shd_small").first().text().trim();
  const infoText = $("div.Video_Info, div.video_info, div#video_info").text();
  const fullText = infoText || html;

  if (/1080/i.test(shdText) || /resolution:.*?1080/i.test(fullText)) {
    resolution = "1080p";
  } else if (/720/i.test(shdText) || /HD/i.test(shdText) || /resolution:.*?720/i.test(fullText)) {
    resolution = "720p";
  }

  // 5. Time / Duration
  let duration = "";
  const durationText = $("span.duration_small, .duration_small").first().text().trim();
  const durMatch =
    durationText.match(/(\d+):(\d{2})/) ||
    fullText.match(/duration:\s*(\d+):(\d{2})/i);

  if (durMatch) {
    const mins = parseInt(durMatch[1], 10);
    duration = `${mins}Min`;
  } else {
    const generalDur = html.match(/(\d+)\s*(?:min|mins|minutes)/i);
    if (generalDur) {
      duration = `${generalDur[1]}Min`;
    }
  }

  // 6. Release Date
  let releaseYear = "";
  const uploadDate =
    $("meta[itemprop='uploadDate']").attr("content") ||
    $("meta[property='video:release_date']").attr("content");

  if (uploadDate) {
    const ym = uploadDate.match(/^(\d{4})/);
    if (ym) releaseYear = ym[1];
  }
  if (!releaseYear) {
    const rawTitle = $("title").text();
    const yearMatch = rawTitle.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      releaseYear = yearMatch[1];
    } else {
      releaseYear = new Date().getFullYear().toString();
    }
  }

  // 7. Title
  let rawTitle = $("title").text().trim();
  rawTitle = rawTitle.replace(/\s*[-|]\s*sxyprn.*$/i, "").trim();

  // If company was not found from selector, take first word of title
  if (!company) {
    const firstWordMatch = rawTitle.match(/^([a-zA-Z0-9_\-]+)\s+/);
    if (firstWordMatch) {
      company = firstWordMatch[1];
    }
  }

  let title = rawTitle;
  if (company && title.toLowerCase().startsWith(company.toLowerCase())) {
    title = title.slice(company.length).trim();
  }

  const hashIndex = title.indexOf("#");
  if (hashIndex !== -1) {
    title = title.substring(0, hashIndex).trim();
  }
  title = title.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();

  return {
    title,
    company,
    actors,
    resolution,
    duration,
    releaseYear,
    categories,
  };
}

/**
 * Fetch and extract metadata for supported video page URLs
 * @param {string} url
 * @returns {Promise<object | null>}
 */
async function scrapeMetadata(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    const isWatchPorn = hostname.includes("watchporn.to");
    const isSxyPrn = hostname.includes("sxyprn.net") || hostname.includes("sxyprn.com");

    if (!isWatchPorn && !isSxyPrn) {
      return null;
    }

    logger.info(`Scraping video metadata from ${hostname}...`);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      logger.warn(`Scraper fetch returned status ${response.status} for ${url}`);
      return null;
    }

    const html = await response.text();

    if (isWatchPorn) {
      const metadata = parseWatchPorn(html, url);
      logger.success(`Extracted watchporn.to metadata: "${metadata.title}" [${metadata.company}]`);
      return metadata;
    } else if (isSxyPrn) {
      const metadata = parseSxyPrn(html, url);
      logger.success(`Extracted sxyprn.net metadata: "${metadata.title}" [${metadata.company}]`);
      return metadata;
    }
  } catch (err) {
    logger.warn(`Scraper error for ${url}: ${err.message}`);
    return null;
  }

  return null;
}

/**
 * Generate formatted channel post caption matching exact template
 * @param {object} meta
 * @param {string} botUsername
 * @param {string} code
 * @returns {string}
 */
function generateCaption(meta, botUsername, code) {
  if (!meta) return "";

  const actors = Array.isArray(meta.actors) && meta.actors.length > 0
    ? meta.actors.map(toHashtag).filter(Boolean).join(" ")
    : "";

  const cats = Array.isArray(meta.categories) && meta.categories.length > 0
    ? meta.categories.map(toHashtag).filter(Boolean).join(" ")
    : "";

  const companyTag = meta.company ? toHashtag(meta.company) : "";
  const resolution = meta.resolution || "720p";
  const duration = meta.duration || "";
  const releaseYear = meta.releaseYear || "";
  const title = meta.title || "";

  return [
    `❖ Title: ${title}`,
    `📽 Company: ${companyTag}`,
    `👤 Actors: ${actors}`,
    `🎞 Resolution: ${resolution}`,
    `🕰 Time: ${duration}`,
    `📆 Release Date: ${releaseYear}`,
    `🎬 Categories: ${cats}`,
    `➖➖➖➖➖➖➖➖➖`,
    `🌐 <a href="https://t.me/${botUsername}?start=${code}">${resolution}</a>`,
    `♠️ ${companyTag} - @vidxeducation`,
  ].join("\n");
}

module.exports = {
  scrapeMetadata,
  parseWatchPorn,
  parseSxyPrn,
  generateCaption,
  parseIsoDuration,
  toHashtag,
};
