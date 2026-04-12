/** Shared word pool logic for Hot & Cold (Netlify functions only). */

const STOP_WORD_LIST = [
  "a", "an", "the", "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his",
  "she", "her", "hers", "it", "its", "we", "us", "our", "ours", "they", "them", "their",
  "theirs", "myself", "yourself", "himself", "herself", "itself", "ourselves", "yourselves",
  "themselves", "this", "that", "these", "those", "what", "which", "who", "whom", "whose",
  "when", "where", "why", "how", "whatever", "whoever", "whomever", "whichever", "anyone",
  "anything", "anybody", "anywhere", "everyone", "everything", "everybody", "everywhere",
  "someone", "something", "somebody", "somewhere", "nobody", "nothing", "nowhere", "none",
  "each", "either", "neither", "both", "another", "other", "such", "in", "on", "at", "to",
  "for", "of", "with", "by", "from", "into", "onto", "upon", "over", "under", "above",
  "below", "between", "among", "through", "during", "before", "after", "since", "until",
  "within", "without", "against", "toward", "towards", "about", "around", "across", "along",
  "behind", "beyond", "inside", "outside", "near", "off", "out", "up", "down", "and", "but",
  "or", "nor", "so", "yet", "as", "if", "than", "then", "because", "although", "though",
  "while", "whether", "is", "am", "are", "was", "were", "be", "been", "being", "has",
  "have", "had", "having", "do", "does", "did", "doing", "done", "will", "would", "shall",
  "should", "can", "could", "may", "might", "must", "said", "says", "new", "more", "most",
  "some", "no", "not", "just", "like", "also", "only", "even", "very", "too", "here", "there",
  "now", "again", "once", "ever", "never", "always", "often", "still", "already", "rather",
  "quite", "much", "many", "few", "less", "least", "every", "own", "same",
];

const STOP_WORDS = new Set(STOP_WORD_LIST);

function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/gi, " ");
}

function pushTokensFromText(text, seen, words) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/);
  for (const t of tokens) {
    const w = t.replace(/^['-]+|['-]+$/g, "");
    if (w.length >= 4 && w.length <= 12 && !STOP_WORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      words.push(w);
    }
  }
}

/**
 * First article (headline before body, row order) wins for each token — matches pool order.
 * @param {string} articleUrl
 * @param {string} articleHeadline
 */
function pushTokensFromTextWithSource(text, seen, words, sourceByWord, articleUrl, articleHeadline) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/);
  for (const t of tokens) {
    const w = t.replace(/^['-]+|['-]+$/g, "");
    if (w.length >= 4 && w.length <= 12 && !STOP_WORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      words.push(w);
      sourceByWord[w] = {
        url: typeof articleUrl === "string" ? articleUrl.trim() : "",
        headline: typeof articleHeadline === "string" ? articleHeadline.trim().slice(0, 240) : "",
      };
    }
  }
}

/**
 * @param {Array<{ headline?: string, title?: string, content?: string, link?: string, url?: string }>} articles
 * @returns {{ words: string[], sourceByWord: Record<string, { url: string, headline: string }> }}
 */
function extractWordPoolWithSources(articles) {
  const seen = new Set();
  const words = [];
  /** @type {Record<string, { url: string, headline: string }>} */
  const sourceByWord = {};
  for (const a of articles) {
    const headline = a.headline || a.title || "";
    const link = (a.link || a.url || "").trim();
    pushTokensFromTextWithSource(headline, seen, words, sourceByWord, link, headline);
    const body = stripHtml(a.content || "");
    if (body) pushTokensFromTextWithSource(body, seen, words, sourceByWord, link, headline);
  }
  return { words, sourceByWord };
}

/**
 * @param {Array<{ headline?: string, title?: string, content?: string, link?: string, url?: string }>} articles
 * @returns {string[]}
 */
function extractWordPoolFromArticles(articles) {
  return extractWordPoolWithSources(articles).words;
}

const createSeededRandom = (seed) => {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
};

const seededShuffle = (items, seed) => {
  const random = createSeededRandom(seed);
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

module.exports = {
  STOP_WORDS,
  extractWordPoolFromArticles,
  extractWordPoolWithSources,
  seededShuffle,
  getTodayKeyUtc: () => new Date().toISOString().slice(0, 10),
};
