/**
 * Lightweight checks for Hot & Cold word pool + shuffle + client-side similarity math.
 * Run: node scripts/test-hotncold-algorithms.mjs
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const {
  extractWordPoolFromArticles,
  extractWordPoolWithSources,
  seededShuffle,
  getTodayKeyUtc,
} = require("../netlify/functions/hotncoldWordUtils.cjs");

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarityScore(guess, secret) {
  const g = guess.trim().toLowerCase();
  const s = secret.toLowerCase();
  if (!g || !s) return 0;
  const dist = levenshtein(g, s);
  const maxLen = Math.max(g.length, s.length, 1);
  return 1 - dist / maxLen;
}

function assertDeepEqual(a, b, msg) {
  assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
}

console.log("Hot & Cold algorithm tests\n");

// --- extractWordPoolFromArticles ---
const withSrc = extractWordPoolWithSources([
  {
    headline: "Penn State wins big",
    content: "<p>The offense scored forty points.</p>",
    link: "https://www.psucollegian.com/test-article",
  },
]);
assert.equal(withSrc.sourceByWord.penn.url, "https://www.psucollegian.com/test-article");
assert.ok(withSrc.sourceByWord.offense.url, "body token maps to same article url");

const pool1 = extractWordPoolFromArticles([
  { headline: "Penn State wins big", content: "<p>The offense scored forty points.</p>" },
]);
assert.ok(pool1.includes("penn"), "headline token");
assert.ok(pool1.includes("offense"), "body token after HTML strip");
assert.ok(!pool1.includes("the"), "stop word excluded");
assert.ok(!pool1.includes("big"), "short word (<4) excluded");

const poolDedup = extractWordPoolFromArticles([
  { headline: "Unique token here", content: "<p>Unique token repeats</p>" },
]);
assert.equal(poolDedup.filter((w) => w === "unique").length, 1, "dedupe across headline + body");

// --- seededShuffle determinism ---
const items = ["apple", "banana", "cherry", "date", "elderberry", "fig", "grape"];
const seed = 20240412;
const sh1 = seededShuffle([...items], seed);
const sh2 = seededShuffle([...items], seed);
assertDeepEqual(sh1, sh2, "same seed → identical shuffle order");

const sh3 = seededShuffle([...items], seed + 1);
assert.notDeepEqual(sh1, sh3, "different seed → different order (almost certainly)");

// --- date seed matches client convention ---
const dateKey = "2026-04-12";
const seedFromKey = Number(dateKey.replace(/-/g, ""));
assert.equal(seedFromKey, 20260412, "UTC date string → numeric seed");

const shDaily = seededShuffle(["w1", "w2", "w3", "w4", "w5", "w6"], seedFromKey);
assert.equal(shDaily.length, 6, "shuffle preserves length");
const dailyOne = shDaily.slice(0, 1);
assert.equal(dailyOne.length, 1, "daily game uses one word");

// --- Levenshtein / similarity (browser fallback path) ---
assert.equal(similarityScore("hello", "hello"), 1, "exact string similarity");
assert.equal(similarityScore("HELLO", "hello"), 1, "case-insensitive via caller lowercasing in game");
assert.ok(similarityScore("team", "beam") > 0.4 && similarityScore("team", "beam") < 1, "near match partial score");
assert.ok(similarityScore("aaaa", "zzzz") < 0.3, "unrelated strings low score");

function distanceOff(score) {
  const clamped = Math.min(1, Math.max(0, Number(score) || 0));
  return Math.round((1 - clamped) * 100);
}
assert.equal(distanceOff(1), 0, "exact → 0 off");
assert.equal(distanceOff(0), 100, "zero similarity → 100 off");
assert.equal(distanceOff(0.5), 50, "mid similarity → 50 off");

// --- order independence of pool array for extraction (first-seen wins) ---
const orderA = extractWordPoolFromArticles([
  { headline: "alpha beta", content: "" },
  { headline: "gamma delta", content: "" },
]);
const orderB = extractWordPoolFromArticles([
  { headline: "gamma delta", content: "" },
  { headline: "alpha beta", content: "" },
]);
assert.ok(orderA.length >= 4 && orderB.length >= 4, "both have four words");
assert.notDeepEqual(orderA, orderB, "article order changes unique word order (deterministic pipeline)");

// --- getTodayKeyUtc format ---
assert.match(getTodayKeyUtc(), /^\d{4}-\d{2}-\d{2}$/, "UTC date key format");

console.log("All algorithm checks passed.");
