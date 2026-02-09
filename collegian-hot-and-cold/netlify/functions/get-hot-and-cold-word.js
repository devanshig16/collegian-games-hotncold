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
  "Penn",
  "State",
  "penn",
  "state",
  "student",
  "students",
  "university",
  "college",
  "campus",
  "collegian",
  "daily",
  "psu",
  "said",
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
          `SELECT guid as id, title, url, content as body
           FROM articles
           WHERE category = $1 AND pub_date >= NOW() - INTERVAL '24 hours'`,
          [cat]
        );
        return rows;
      }
      // No category column: use all articles from last 24 hours
      const { rows } = await client.query(
        `SELECT guid as id, title, url, content as body
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

    const freq = new Map();

    for (const article of articles) {
      const text = `${article.title || ""} ${article.body || ""}`;
      const tokens = tokenize(text);
      const seenInThisArticle = new Set();

      for (const token of tokens) {
        if (STOPWORDS.has(token)) continue;
        if (token.length < 4) continue;
        if (seenInThisArticle.has(token)) continue;
        seenInThisArticle.add(token);

        if (!freq.has(token)) {
          freq.set(token, { count: 0, articleIds: new Set() });
        }
        const entry = freq.get(token);
        entry.count += 1;
        entry.articleIds.add(article.id);
      }
    }

    if (freq.size === 0) {
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

    let maxCount = 0;
    for (const { count } of freq.values()) {
      if (count > maxCount) maxCount = count;
    }
    const topWords = [];
    for (const [word, { count, articleIds }] of freq.entries()) {
      if (count === maxCount) {
        topWords.push({ word, articleIds });
      }
    }

    // Deterministic choice among tied words: sort alphabetically and take first.
    topWords.sort((a, b) => a.word.localeCompare(b.word));
    const chosen = topWords[0];

    const articleIdList = Array.from(chosen.articleIds);
    const relatedArticles = articles.filter((a) => articleIdList.includes(a.id));

    const responseBody = {
      date: todayKey,
      category,
      targetWord: chosen.word,
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

