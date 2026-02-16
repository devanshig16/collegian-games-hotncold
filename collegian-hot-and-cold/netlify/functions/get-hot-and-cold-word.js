const { Client } = require("pg");

// NOTE: This is a stub implementation that you can adapt
// to your actual Daily Collegian article schema.

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const CATEGORY_BY_DAY = () => {
  const day = new Date().getDay(); // 0=Sun..6=Sat
  switch (day) {
    case 1:
      return "News"; // Monday
    case 2:
      return "Sports"; // Tuesday
    case 3:
      return "Lifestyle"; // Wednesday
    case 4:
      return "Opinion"; // Thursday
    case 5:
      return "THON"; // Friday (adjust seasonally if needed)
    case 6:
      return "Multimedia"; // Saturday
    case 0:
    default:
      return "Wrestling"; // Sunday or fallback
  }
};

// Simple English + PSU-specific stopwords – extend as needed.
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "have",
  "your",
  "about",
  "into",
  "there",
  "their",
  "what",
  "when",
  "where",
  "which",
  "would",
  "could",
  "should",
  "been",
  "will",
  "they",
  "them",
  "said",
  "like",
  "just",
  "very",
  "also",
  "than",
  "then",
  "over",
  "under",
  "after",
  "before",
  "while",
  "because",
  "through",
  "during",
  "between",
  "other",
  "more",
  "most",
  "such",
  "only",
  "both",
  "each",
  "many",
  "some",
  "few",
  "much",
  "every",
  "any",
  "all",
  "who",
  "whom",
  "whose",
  "why",
  "how",
  // PSU-specific / publication words
  "penn",
  "state",
  "pennsylvania",
  "university",
  "college",
  "campus",
  "students",
  "student",
  "collegian",
  "daily",
  "psu",
  "lions",
  "nittany",
  // very common verbs / fillers
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "did",
  "does",
  "has",
  "have",
  "had",
  "says",
  "said",
  "told",
  "report",
  "reports",
  "reported",
  // generic nouns / time words
  "year",
  "years",
  "time",
  "day",
  "days",
  "week",
  "weeks",
  "people",
  "person",
  "things",
  "way",
]);

const tokenize = (text) => {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }

  const client = new Client({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });

  try {
    const todayKey = getTodayKey();
    let category = CATEGORY_BY_DAY();

    await client.connect();

    // Schema: same as repo scraper — guid, title, content, url, pub_date.
    // Optional: if your table has a "category" column, use the query with category filter below.
    const hasCategoryColumn = process.env.ARTICLES_HAVE_CATEGORY === "true";

    const queryForCategory = async (cat) => {
      if (hasCategoryColumn) {
        const { rows } = await client.query(
          `SELECT guid as id, title, url, content as body, pub_date
           FROM articles
           WHERE category = $1 AND pub_date >= NOW() - INTERVAL '24 hours'`,
          [cat]
        );
        return rows;
      }
      // No category column: use all articles from last 24 hours
      const { rows } = await client.query(
        `SELECT guid as id, title, url, content as body, pub_date
         FROM articles
         WHERE pub_date >= NOW() - INTERVAL '24 hours'`
      );
      return rows;
    };

    let articles = await queryForCategory(category);

    if (hasCategoryColumn && (!articles || articles.length === 0)) {
      const fallbackArticles = await queryForCategory("News");
      if (fallbackArticles && fallbackArticles.length > 0) {
        category = "News";
        articles = fallbackArticles;
      }
    }

    if (!articles || articles.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: todayKey,
          category,
          targetWord: "collegian",
          articles: [],
          note: "No recent articles found; using fallback word.",
        }),
      };
    }

    const totalArticles = articles.length;

    // Helper: determine if a token is a good candidate for the target word
    const isGoodToken = (token) => {
      if (!token) return false;
      if (STOPWORDS.has(token)) return false;
      if (!/^[a-z]+$/.test(token)) return false; // letters only
      if (token.length < 4 || token.length > 12) return false; // avoid too short/long
      return true;
    };

    // Precompute, for each article, its filtered tokens and global article counts
    const articleTokens = new Map(); // id -> array of filtered tokens (with duplicates)
    const globalArticleCount = new Map(); // token -> in how many articles it appears

    for (const article of articles) {
      const text = `${article.title || ""} ${article.body || ""}`;
      const rawTokens = tokenize(text);
      const filteredTokens = [];
      const seenInThisArticle = new Set();

      for (const token of rawTokens) {
        if (!isGoodToken(token)) continue;
        filteredTokens.push(token);
        if (!seenInThisArticle.has(token)) {
          seenInThisArticle.add(token);
          globalArticleCount.set(
            token,
            (globalArticleCount.get(token) || 0) + 1
          );
        }
      }

      if (filteredTokens.length > 0) {
        articleTokens.set(article.id, filteredTokens);
      }
    }

    if (articleTokens.size === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: todayKey,
          category,
          targetWord: "collegian",
          articles: [],
          note: "No suitable words found; using fallback word.",
        }),
      };
    }

    // 1) Choose a main article for today (most recent in the chosen category)
    const [mainArticle] = [...articles].sort(
      (a, b) => new Date(b.pub_date) - new Date(a.pub_date)
    );

    const mainTokens = articleTokens.get(mainArticle.id) || [];

    if (mainTokens.length === 0) {
      // Fallback: if main article has no good tokens, fall back to any article tokens
      const firstEntry = articleTokens.values().next().value;
      if (!firstEntry || firstEntry.length === 0) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: todayKey,
            category,
            targetWord: "collegian",
            articles: [],
            note: "No suitable words found; using fallback word.",
          }),
        };
      }
    }

    // 2) Count frequencies in the main article and compute a distinctiveness score
    const freqHere = new Map();
    for (const token of mainTokens) {
      freqHere.set(token, (freqHere.get(token) || 0) + 1);
    }

    let bestWord = null;
    let bestScore = -Infinity;

    for (const [word, count] of freqHere.entries()) {
      const inArticles = globalArticleCount.get(word) || 1;
      const score = count * Math.log((totalArticles + 1) / (1 + inArticles));
      if (score > bestScore) {
        bestScore = score;
        bestWord = word;
      }
    }

    if (!bestWord) {
      // As a final fallback, pick the most frequent token in main article
      let fallbackWord = null;
      let fallbackCount = -1;
      for (const [word, count] of freqHere.entries()) {
        if (count > fallbackCount) {
          fallbackCount = count;
          fallbackWord = word;
        }
      }
      bestWord = fallbackWord || "collegian";
    }

    // 3) Collect all articles where this word appears (always include mainArticle first)
    const relatedArticles = [];
    const addedIds = new Set();

    if (bestWord && mainArticle) {
      relatedArticles.push(mainArticle);
      addedIds.add(mainArticle.id);
    }

    for (const article of articles) {
      if (addedIds.has(article.id)) continue;
      const tokens = articleTokens.get(article.id);
      if (tokens && tokens.includes(bestWord)) {
        relatedArticles.push(article);
        addedIds.add(article.id);
      }
    }

    const responseBody = {
      date: todayKey,
      category,
      targetWord: bestWord,
      articles: relatedArticles.map((a) => ({
        id: a.id,
        title: a.title,
        url: a.url,
      })),
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    console.error("get-hot-and-cold-word error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Server error" }),
    };
  } finally {
    await client.end();
  }
};

