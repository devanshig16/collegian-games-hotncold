const { Client } = require("pg");
const {
  extractWordPoolWithSources,
  seededShuffle,
  getTodayKeyUtc,
} = require("./hotncoldWordUtils.cjs");

const DAILY_LIMIT = 1;
const MODERATION_MODEL = "text-moderation-latest";

/** Netlify CDN + browser cache (same pattern as collegian-overunder cfb-stats, timemachine IIIF). */
function cacheControlUtcDay() {
  const now = Date.now();
  const nextUtcMidnight = new Date(now);
  nextUtcMidnight.setUTCHours(24, 0, 0, 0);
  const secondsUntilUtcMidnight = Math.max(60, Math.floor((nextUtcMidnight - now) / 1000));
  const browserMax = Math.min(secondsUntilUtcMidnight, 600);
  return `public, s-maxage=${secondsUntilUtcMidnight}, max-age=${browserMax}`;
}
/** Words per OpenAI moderations request (short strings; well under token limits). */
const MODERATION_BATCH = 120;
/** Stop scanning / moderating after this many words from the shuffled pool (then unmoderated fill). */
const MAX_POOL_SCAN = 4000;
/** Cap sequential moderation HTTP calls to stay within serverless time limits. */
const MAX_MODERATION_CALLS = 25;

/**
 * @param {string} apiKey
 * @param {string[]} words
 * @returns {Promise<boolean[] | null>} flagged status per word (true = blocked), or null on transport failure
 */
async function fetchModerationFlags(apiKey, words) {
  if (words.length === 0) return [];
  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODERATION_MODEL,
      input: words,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    console.error("OpenAI moderations error:", res.status, detail);
    return null;
  }
  const data = await res.json();
  const results = data.results || [];
  if (results.length !== words.length) {
    console.error("moderations: unexpected results length", results.length, words.length);
    return null;
  }
  return results.map((r) => r.flagged === true);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }

  const client = new Client({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const result = await client.query(`
      SELECT title as headline, url as link, image_url as image, COALESCE(content, '') as content
      FROM articles
      WHERE pub_date > NOW() - INTERVAL '7 days'
      AND image_url IS NOT NULL
      ORDER BY pub_date DESC
    `);

    const rows = result.rows || [];
    const { words: pool, sourceByWord } = extractWordPoolWithSources(rows);
    if (pool.length < DAILY_LIMIT) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({
          words: [],
          article: null,
          poolSize: pool.length,
          message: `Need at least ${DAILY_LIMIT} playable words from Collegian headlines and article text; found ${pool.length}.`,
        }),
      };
    }

    const dateKey = getTodayKeyUtc();
    const seed = Number(dateKey.replace(/-/g, ""));
    const shuffled = seededShuffle(pool, seed);

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const selected = [];
    let moderationCalls = 0;
    let moderationSkipped = !apiKey;

    if (apiKey) {
      for (
        let offset = 0;
        offset < shuffled.length &&
        offset < MAX_POOL_SCAN &&
        selected.length < DAILY_LIMIT &&
        moderationCalls < MAX_MODERATION_CALLS;
        offset += MODERATION_BATCH
      ) {
        const batch = shuffled.slice(offset, offset + MODERATION_BATCH);
        if (batch.length === 0) break;
        moderationCalls += 1;
        const flags = await fetchModerationFlags(apiKey, batch);
        if (flags == null) {
          moderationSkipped = true;
          break;
        }
        for (let i = 0; i < batch.length && selected.length < DAILY_LIMIT; i += 1) {
          if (!flags[i]) selected.push(batch[i]);
        }
      }
    }

    if (selected.length < DAILY_LIMIT) {
      for (const w of shuffled) {
        if (selected.length >= DAILY_LIMIT) break;
        if (!selected.includes(w)) selected.push(w);
      }
    }

    const words = selected.slice(0, DAILY_LIMIT);
    const dailyWord = words[0];
    const rawArticle = dailyWord ? sourceByWord[dailyWord] : null;
    const article =
      rawArticle && rawArticle.url
        ? {
            url: rawArticle.url,
            headline: rawArticle.headline || "",
            image: rawArticle.image || "",
          }
        : null;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": cacheControlUtcDay(),
      },
      body: JSON.stringify({
        words,
        article,
        dateKey,
        poolSize: pool.length,
        moderationSkipped,
        moderationModel: apiKey ? MODERATION_MODEL : null,
        moderationBatches: moderationCalls,
      }),
    };
  } catch (err) {
    console.error("get-hotncold-daily-words:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        message: err.message || "Database error",
        detail: process.env.NETLIFY_DEV ? String(err) : undefined,
      }),
    };
  } finally {
    await client.end();
  }
};
