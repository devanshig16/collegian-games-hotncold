import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Confetti from "react-confetti";
import { ExternalLink, Loader } from "lucide-react";
import DisclaimerFooter from "./components/DisclaimerFooter";
import EmailSignup from "./components/EmailSignup";
import useGameAnalytics from "./hooks/useGameAnalytics";

const DAILY_WORDS_ENDPOINT = "/.netlify/functions/get-hotncold-daily-words";
const SIMILARITY_API_ENDPOINT = "/.netlify/functions/word-similarity";
const DAILY_LIMIT = 1;
const MAX_GUESSES_PER_DAY = 10;
/** Single secret per UTC day; progress shape v2. */
const DAILY_STORAGE_KEY = "hotncold_daily_progress_v2";

/** Same pattern as Redacted `hh_news_cache`: sessionStorage + TTL. */
const DAILY_WORDS_SESSION_CACHE_KEY = "hotncold_daily_words_v4";
const SIMILARITY_SESSION_CACHE_KEY = "hotncold_similarity_v1";
const DAILY_WORDS_SESSION_TTL_MS = 60 * 60 * 1000;
const SIMILARITY_ENTRY_CAP = 500;

const getTodayKey = () => new Date().toISOString().slice(0, 10);

/** @param {unknown} raw */
function normalizeArticle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = "url" in raw && typeof raw.url === "string" ? raw.url.trim() : "";
  if (!url) return null;
  const headline =
    "headline" in raw && typeof raw.headline === "string" ? raw.headline.trim() : "";
  return { url, headline };
}

function readDailyWordsSessionCache(todayKey) {
  try {
    const raw = sessionStorage.getItem(DAILY_WORDS_SESSION_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o.dateKey !== todayKey) return null;
    if (Date.now() - o.timestamp > DAILY_WORDS_SESSION_TTL_MS) return null;
    if (!Array.isArray(o.words) || o.words.length < DAILY_LIMIT) return null;
    if (!o.meta || typeof o.meta !== "object") return null;
    return { words: o.words, meta: o.meta };
  } catch {
    return null;
  }
}

function writeDailyWordsSessionCache(payload) {
  sessionStorage.setItem(
    DAILY_WORDS_SESSION_CACHE_KEY,
    JSON.stringify({ ...payload, timestamp: Date.now() })
  );
}

function similaritySessionStorageKey(secretNorm, guessNorm) {
  return `${secretNorm}||${guessNorm}`;
}

function readSimilaritySessionEntries(todayKey) {
  try {
    const raw = sessionStorage.getItem(SIMILARITY_SESSION_CACHE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (o.dateKey !== todayKey) return {};
    return typeof o.entries === "object" && o.entries != null ? o.entries : {};
  } catch {
    return {};
  }
}

function writeSimilaritySessionEntries(todayKey, entries) {
  const keys = Object.keys(entries);
  let trimmed = entries;
  if (keys.length > SIMILARITY_ENTRY_CAP) {
    trimmed = {};
    keys.slice(-SIMILARITY_ENTRY_CAP).forEach((k) => {
      trimmed[k] = entries[k];
    });
  }
  sessionStorage.setItem(
    SIMILARITY_SESSION_CACHE_KEY,
    JSON.stringify({ dateKey: todayKey, entries: trimmed })
  );
}

function readSavedProgress() {
  try {
    const raw = localStorage.getItem(DAILY_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.date !== getTodayKey()) return null;
    return data;
  } catch {
    return null;
  }
}

/** @param {string} a @param {string} b */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () =>
    new Uint16Array(n + 1)
  );
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
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

/**
 * Distance from the secret on a 0–100 scale: **higher = farther**, **0 = exact match**.
 * Derived from the same similarity `score` in [0, 1] used for Hot / Cold bands.
 */
function distanceOff(score) {
  const clamped = Math.min(1, Math.max(0, Number(score) || 0));
  return Math.round((1 - clamped) * 100);
}

function temperatureFromScore(score) {
  // Match the categories from your provided frontend design.
  // `score` is in [0..1] where 1 is exact match.
  if (score >= 1) {
    return {
      key: "exact",
      label: "Correct",
      sub: "Exact match",
      bar: 100,
      heatClass: "from-orange-500 to-red-600",
      textClass: "text-red-700",
      heatValue: 5,
      color: "#c8102e",
    };
  }
  if (score > 0.75) {
    return {
      key: "very-hot",
      label: "Very Hot",
      sub: "You're very close",
      bar: 88,
      heatClass: "from-orange-400 to-red-500",
      textClass: "text-orange-700",
      heatValue: 4,
      color: "#c8102e",
    };
  }
  if (score > 0.5) {
    return {
      key: "warm",
      label: "Warm",
      sub: "In the ballpark",
      bar: 48,
      heatClass: "from-yellow-300 to-amber-400",
      textClass: "text-yellow-800",
      heatValue: 3,
      color: "#ff8c00",
    };
  }
  if (score > 0.25) {
    return {
      key: "cold",
      label: "Cold",
      sub: "Keep trying",
      bar: 28,
      heatClass: "from-sky-300 to-cyan-400",
      textClass: "text-sky-800",
      heatValue: 2,
      color: "#0074d9",
    };
  }
  return {
    key: "freezing",
    label: "Freezing",
    sub: "Far from the word",
    bar: 10,
    heatClass: "from-slate-300 to-blue-400",
    textClass: "text-slate-700",
    heatValue: 1,
    color: "#777777",
  };
}

/** Next puzzle when UTC date rolls (matches `getTodayKey()` / server `dateKey`). */
const getTimeUntilReset = () => {
  const now = new Date();
  const nextUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
  const diffMs = Math.max(nextUtcMidnight - now, 0);
  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
};

/** How each guess was scored (for analytics / debugging) */
/** @typedef {'openai' | 'openai-session-cache' | 'openai-server-cache' | 'levenshtein' | 'exact'} ScoreSource */

/** @param {ScoreSource | null | undefined} s */
function similaritySourceLabel(s) {
  if (s === "openai") return "OpenAI embeddings — live API (word-similarity)";
  if (s === "openai-session-cache")
    return "OpenAI score — sessionStorage cache (no network; same day)";
  if (s === "openai-server-cache")
    return "OpenAI embeddings — function in-memory cache (X-Cache: HIT)";
  if (s === "levenshtein") return "Browser Levenshtein only (similarity API unavailable or error)";
  if (s === "exact") return "Exact match (no embedding call)";
  return "—";
}

export default function HotNCold() {
  const [dailyWords, setDailyWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [headlinesError, setHeadlinesError] = useState(null);
  const [dailyWordsMeta, setDailyWordsMeta] = useState(null);
  const [lastSimilaritySource, setLastSimilaritySource] = useState(null);
  const [dailyWordsFromSessionCache, setDailyWordsFromSessionCache] = useState(false);

  const [score, setScore] = useState(() => readSavedProgress()?.score ?? 0);
  const [gameState, setGameState] = useState(() =>
    readSavedProgress()?.completed ? "daily-complete" : "playing"
  );
  const [input, setInput] = useState("");
  const [guesses, setGuesses] = useState([]);
  const [shake, setShake] = useState(false);
  const [guessLoading, setGuessLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showLatest, setShowLatest] = useState(true);
  /** Why OpenAI wasn’t used (set when API fails so you can debug .env / billing / netlify dev) */
  const [openAiErrorHint, setOpenAiErrorHint] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const roundCompletedRef = useRef(false);
  const dailyCompleteLoggedRef = useRef(false);
  const gameStartLoggedRef = useRef(false);

  const analytics = useGameAnalytics("hot-n-cold", 0);
  const secretWord = dailyWords[0] ?? "";

  const saveProgress = useCallback((next) => {
    localStorage.setItem(
      DAILY_STORAGE_KEY,
      JSON.stringify({ date: getTodayKey(), ...next })
    );
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV && dailyWords.length) console.log("dailyWords", dailyWords);
  }, [dailyWords]);

  useEffect(() => {
    const loadDailyWords = async () => {
      setHeadlinesError(null);
      setDailyWordsFromSessionCache(false);
      const todayKey = getTodayKey();
      const sessionHit = readDailyWordsSessionCache(todayKey);
      if (sessionHit) {
        setDailyWords(sessionHit.words);
        setDailyWordsMeta(sessionHit.meta);
        setDailyWordsFromSessionCache(true);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(DAILY_WORDS_ENDPOINT);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          throw new Error(
            import.meta.env.DEV
              ? "get-hotncold-daily-words did not return JSON. Use `netlify dev` and open http://localhost:8888 — `npm run dev` (Vite only) does not run Netlify functions."
              : "Unexpected response from server."
          );
        }
        const data = await res.json();
        if (!res.ok) {
          const msg =
            typeof data?.message === "string"
              ? data.message
              : `Request failed (${res.status})`;
          throw new Error(
            import.meta.env.DEV && data?.detail ? `${msg} — ${data.detail}` : msg
          );
        }
        const words = Array.isArray(data.words) ? data.words : [];
        const article = normalizeArticle(data.article);
        setDailyWordsMeta({
          poolSize: typeof data.poolSize === "number" ? data.poolSize : null,
          moderationSkipped: data.moderationSkipped === true,
          moderationModel: typeof data.moderationModel === "string" ? data.moderationModel : null,
          moderationBatches:
            typeof data.moderationBatches === "number" ? data.moderationBatches : null,
          dateKey: typeof data.dateKey === "string" ? data.dateKey : null,
          article,
        });
        if (words.length < DAILY_LIMIT) {
          const poolSize =
            typeof data.poolSize === "number" ? data.poolSize : words.length;
          setHeadlinesError(
            typeof data.message === "string" && data.message.length > 0
              ? data.message
              : `Need at least ${DAILY_LIMIT} playable words from Collegian headlines and article text; found ${poolSize}.`
          );
          setDailyWords([]);
        } else {
          setDailyWords(words);
          writeDailyWordsSessionCache({
            dateKey: data.dateKey ?? todayKey,
            words,
            meta: {
              poolSize: typeof data.poolSize === "number" ? data.poolSize : null,
              moderationSkipped: data.moderationSkipped === true,
              moderationModel:
                typeof data.moderationModel === "string" ? data.moderationModel : null,
              moderationBatches:
                typeof data.moderationBatches === "number" ? data.moderationBatches : null,
              dateKey: typeof data.dateKey === "string" ? data.dateKey : null,
              article,
            },
          });
        }
      } catch (err) {
        console.error("Hot & Cold: failed to load daily words", err);
        const fallback =
          "Could not load today’s puzzle from The Daily Collegian articles database (Postgres). Check your connection and try again.";
        const msg = err instanceof Error && err.message ? err.message : fallback;
        setHeadlinesError(msg);
        setDailyWords([]);
        setDailyWordsMeta(null);
      } finally {
        setLoading(false);
      }
    };
    loadDailyWords();
  }, []);

  useEffect(() => {
    if (gameStartLoggedRef.current) return;
    if (readSavedProgress()) return;
    gameStartLoggedRef.current = true;
    analytics.logStart({ difficulty: "daily" });
  }, [analytics]);

  useEffect(() => {
    if (readSavedProgress()?.completed) return;
    saveProgress({
      score,
      completed: gameState === "daily-complete",
    });
  }, [gameState, saveProgress, score]);

  const advanceOrFinish = useCallback(
    (won) => {
      if (roundCompletedRef.current) return;
      roundCompletedRef.current = true;

      if (won) {
        analytics.logWin({ guesses_used: guesses.length + 1 });
        setScore(1);
        if (!dailyCompleteLoggedRef.current) {
          dailyCompleteLoggedRef.current = true;
          analytics.logAction("daily_complete", {
            final_score: 1,
            total_rounds: 1,
          });
        }
        setShowConfetti(true);
        setGameState("daily-complete");
        saveProgress({ score: 1, completed: true });
      } else {
        analytics.logLoss({ reason: "max_guesses" });
        if (!dailyCompleteLoggedRef.current) {
          dailyCompleteLoggedRef.current = true;
          analytics.logAction("daily_complete", {
            final_score: 0,
            total_rounds: 1,
          });
        }
        setScore(0);
        setGameState("daily-complete");
        saveProgress({ score: 0, completed: true });
      }
    },
    [analytics, guesses.length, saveProgress]
  );

  const submitGuess = async (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || gameState !== "playing" || guessLoading) return;

    if (guesses.length >= MAX_GUESSES_PER_DAY) return;

    const prevTexts = new Set(guesses.map((g) => g.text.toLowerCase()));
    if (prevTexts.has(trimmed.toLowerCase())) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    setGuessLoading(true);
    let scoreVal = 0;
    /** @type {ScoreSource} */
    let scoreSource = "levenshtein";

    try {
      if (trimmed.toLowerCase() === secretWord.toLowerCase()) {
        scoreVal = 1;
        scoreSource = "exact";
        setOpenAiErrorHint(null);
      } else {
        const simKey = similaritySessionStorageKey(
          secretWord.toLowerCase(),
          trimmed.toLowerCase()
        );
        const sessionEntries = readSimilaritySessionEntries(getTodayKey());
        const fromSession = sessionEntries[simKey];
        if (typeof fromSession === "number") {
          scoreVal = fromSession;
          scoreSource = "openai-session-cache";
          setOpenAiErrorHint(null);
        } else {
        try {
          const res = await fetch(SIMILARITY_API_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guess: trimmed, secret: secretWord }),
          });
          let data = {};
          try {
            data = await res.json();
          } catch {
            data = {};
          }
          if (res.ok && typeof data.score === "number") {
            scoreVal = data.score;
            const xCache = (res.headers.get("X-Cache") || "").toUpperCase();
            scoreSource = xCache === "HIT" ? "openai-server-cache" : "openai";
            setOpenAiErrorHint(null);
            const nextEntries = readSimilaritySessionEntries(getTodayKey());
            nextEntries[simKey] = scoreVal;
            writeSimilaritySessionEntries(getTodayKey(), nextEntries);
          } else {
            scoreVal = similarityScore(trimmed, secretWord);
            scoreSource = "levenshtein";
            const parts = [data.message, data.detail].filter(
              (x) => typeof x === "string" && x.length > 0
            );
            setOpenAiErrorHint(
              parts.length > 0
                ? parts.join(" — ")
                : `word-similarity returned HTTP ${res.status}`
            );
          }
        } catch {
          scoreVal = similarityScore(trimmed, secretWord);
          scoreSource = "levenshtein";
          setOpenAiErrorHint(
            "Could not reach word-similarity. Use `netlify dev` (not `npm run dev` alone) so functions and OPENAI_API_KEY load."
          );
        }
        }
      }
    } finally {
      setGuessLoading(false);
    }

    const temp = temperatureFromScore(scoreVal);
    const entry = { text: trimmed, score: scoreVal, temp, scoreSource };
    setLastSimilaritySource(scoreSource);
    setGuesses((g) => [...g, entry]);
    setInput("");

    if (trimmed.toLowerCase() === secretWord.toLowerCase()) {
      setFeedback("Correct! You found today's word.");
      advanceOrFinish(true);
      return;
    }

    setFeedback(`${temp.label} — ${distanceOff(scoreVal)} off`);

    if (guesses.length + 1 >= MAX_GUESSES_PER_DAY) {
      advanceOrFinish(false);
    }
  };

  const resetCountdown = getTimeUntilReset();
  const bestSimilarity = useMemo(() => {
    return guesses.reduce((max, g) => Math.max(max, g?.score ?? 0), 0);
  }, [guesses]);

  const bestTemp = useMemo(() => temperatureFromScore(bestSimilarity), [bestSimilarity]);

  const progressWidthPct = Math.max(0, Math.min(100, bestSimilarity * 100));
  const progressBg =
    bestTemp.label === "Very Hot"
      ? "#c8102e"
      : bestTemp.label === "Warm"
        ? "#ff8c00"
        : bestTemp.label === "Cold"
          ? "#0074d9"
          : "#001e44";

  const displayGuesses = useMemo(() => {
    const subset = showLatest ? guesses.slice(-5) : guesses;
    return [...subset].sort(
      (a, b) => (b?.temp?.heatValue ?? 0) - (a?.temp?.heatValue ?? 0)
    );
  }, [guesses, showLatest]);

  const bestScoringGuess = useMemo(() => {
    if (!guesses.length) return null;
    return guesses.reduce((best, g) =>
      (g?.score ?? 0) > (best?.score ?? -1) ? g : best
    );
  }, [guesses]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 p-4 font-sans text-slate-900 flex items-center justify-center">
        <Loader className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  if (headlinesError || dailyWords.length < DAILY_LIMIT) {
    return (
      <div className="min-h-screen bg-slate-100 p-4 font-sans text-slate-900">
        <div className="max-w-xl mx-auto pt-12">
          <div className="bg-white border border-red-200 rounded-xl p-6 shadow-sm space-y-3">
            <h1 className="text-xl font-black text-slate-900">Hot &amp; Cold</h1>
            <p className="text-red-700 font-medium">
              {headlinesError ||
                "Could not build today’s puzzle from The Daily Collegian articles database."}
            </p>
            <p className="text-slate-600 text-sm">
              Secret words are <span className="font-bold">only</span> taken from Collegian article
              headlines and body text in the Postgres{" "}
              <code className="text-xs bg-slate-100 px-1 rounded">articles</code> table (via{" "}
              <code className="text-xs bg-slate-100 px-1 rounded">get-hotncold-daily-words</code>).
              Candidates are filtered with OpenAI&apos;s moderation API when configured. There is no
              backup word list.
            </p>
            {import.meta.env.DEV && dailyWordsMeta ? (
              <div className="dev-debug-panel mt-4 text-left">
                <div className="dev-debug-panel__title">Developer · load meta</div>
                <ul className="dev-debug-panel__list">
                  <li>
                    <code>poolSize</code>: {String(dailyWordsMeta.poolSize)} ·{" "}
                    <code>moderationSkipped</code>: {String(dailyWordsMeta.moderationSkipped)} ·{" "}
                    <code>batches</code>: {String(dailyWordsMeta.moderationBatches)}
                  </li>
                </ul>
              </div>
            ) : null}
          </div>
          <DisclaimerFooter />
        </div>
      </div>
    );
  }

  return (
    <div>
      {showConfetti && (
        <Confetti recycle={false} numberOfPieces={200} gravity={0.3} />
      )}
      <div className="max-w-xl mx-auto">
        <header className="site-header">
          <div className="logo">The Daily Collegian</div>
          <div className="section">Games</div>
        </header>

        <main className="container">
          <article className="game-card">
            <h1>Hot &amp; Cold</h1>

            <div className="meta-line">
              Guesses {guesses.length}/{MAX_GUESSES_PER_DAY} · One word today (UTC day)
            </div>

            <p className="description">
              Each day there is <strong>one</strong> secret word from The Daily Collegian. After each
              guess you get a temperature and an <strong>off</strong> number:{" "}
              <strong>lower is closer</strong> (0 = exact).
            </p>

            {dailyWordsMeta?.article?.url ? (
              <div className="article-source-card">
                <p className="article-source-card__eyebrow">Source story</p>
                <a
                  className="article-source-card__link"
                  href={dailyWordsMeta.article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="article-source-card__title">
                    {dailyWordsMeta.article.headline || "Daily Collegian article"}
                  </span>
                  <ExternalLink
                    className="article-source-card__icon"
                    size={20}
                    strokeWidth={2.25}
                    aria-hidden
                  />
                </a>
                <p className="article-source-card__meta">The Daily Collegian · opens in a new tab</p>
              </div>
            ) : null}

            {import.meta.env.DEV ? (
              <div className="dev-debug-panel">
                <div className="dev-debug-panel__title">Developer · testing HUD</div>
                <ul className="dev-debug-panel__list">
                  <li>
                    <strong>Today’s secret word:</strong>{" "}
                    <code>{secretWord || "—"}</code>
                    {dailyWordsMeta?.article?.url ? (
                      <>
                        {" "}
                        · article{" "}
                        <a href={dailyWordsMeta.article.url} target="_blank" rel="noopener noreferrer">
                          link
                        </a>
                      </>
                    ) : null}
                  </li>
                  <li>
                    <strong>Daily words fetch cache:</strong>{" "}
                    {dailyWordsFromSessionCache
                      ? `sessionStorage hit (${DAILY_WORDS_SESSION_CACHE_KEY}, 1h TTL — same idea as Redacted hh_news_cache)`
                      : "network (GET also carries Cache-Control for Netlify CDN until UTC midnight)"}
                    <br />
                    <strong>Similarity client cache:</strong>{" "}
                    <code>{SIMILARITY_SESSION_CACHE_KEY}</code> · up to {SIMILARITY_ENTRY_CAP}{" "}
                    guess+secret score pairs per UTC day
                  </li>
                  <li>
                    <strong>Daily words (server):</strong>{" "}
                    <code>get-hotncold-daily-words</code>
                    {dailyWordsMeta?.dateKey ? (
                      <>
                        {" "}
                        · UTC date <code>{dailyWordsMeta.dateKey}</code>
                      </>
                    ) : null}
                    {dailyWordsMeta?.poolSize != null ? (
                      <>
                        {" "}
                        · candidate pool <code>{dailyWordsMeta.poolSize}</code> tokens
                      </>
                    ) : null}
                    <br />
                    <strong>Moderation filter:</strong>{" "}
                    {dailyWordsMeta == null
                      ? "—"
                      : dailyWordsMeta.moderationSkipped
                        ? "skipped or failed — list may include words OpenAI would flag (check OPENAI_API_KEY and function logs)."
                        : `ran (${dailyWordsMeta.moderationModel ?? "model ?"}, ${dailyWordsMeta.moderationBatches ?? 0} moderation API batch(es)).`}
                  </li>
                  <li>
                    <strong>Last submitted guess &quot;closeness&quot;:</strong>{" "}
                    {similaritySourceLabel(lastSimilaritySource)}
                    {guessLoading ? " (request in progress…)" : ""}
                  </li>
                  <li>
                    <strong>Progress bar (best today):</strong>{" "}
                    {guesses.length === 0
                      ? "—"
                      : `${bestSimilarity.toFixed(3)} max score · source ${similaritySourceLabel(
                          bestScoringGuess?.scoreSource
                        )}`}
                    <br />
                    <span style={{ fontWeight: 500, fontSize: "12px" }}>
                      <strong>Off</strong> = round((1 − similarity) × 100). Embeddings measure vector
                      similarity, not human categories (e.g. &quot;lace&quot; vs &quot;shoe&quot; can
                      still look &quot;cold&quot;).
                    </span>
                  </li>
                </ul>
                {openAiErrorHint ? (
                  <div className="dev-debug-panel__warn">
                    <strong>word-similarity (embeddings) last error:</strong> {openAiErrorHint}
                  </div>
                ) : null}
              </div>
            ) : null}

        {gameState === "daily-complete" ? (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-black text-slate-900">Daily complete</h2>
              {score >= 1 ? (
                <p className="text-slate-600 mt-2">
                  You found <span className="font-bold text-blue-600">today’s word</span>. Come back
                  tomorrow for a new puzzle.
                </p>
              ) : (
                <p className="text-slate-600 mt-2">
                  Today’s word was{" "}
                  <span className="font-bold text-slate-900">
                    {dailyWords[0] ? (
                      <code className="bg-slate-100 px-2 py-0.5 rounded">{dailyWords[0]}</code>
                    ) : (
                      "—"
                    )}
                  </span>
                  . Next puzzle in{" "}
                  <span className="font-bold text-slate-800">
                    {resetCountdown.hours}h {resetCountdown.minutes}m
                  </span>
                  .
                </p>
              )}
              {score >= 1 ? (
                <p className="text-slate-500 text-sm mt-4">
                  Next puzzle in{" "}
                  <span className="font-bold text-slate-800">
                    {resetCountdown.hours}h {resetCountdown.minutes}m
                  </span>
                </p>
              ) : null}
              <p className="text-slate-500 text-xs mt-4 text-center">
                Today’s word came from The Daily Collegian{" "}
                <code className="bg-slate-100 px-1 rounded">articles</code> headlines and article text
                (moderation-filtered when OpenAI is available).
              </p>
            </div>
            <EmailSignup gameName="Hot & Cold" />
          </div>
        ) : (
          <div className="space-y-5">
            <form
              onSubmit={submitGuess}
              id="guessForm"
              className={shake ? "shake" : ""}
            >
              <input
                id="guessInput"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter your guess"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                disabled={guesses.length >= MAX_GUESSES_PER_DAY || guessLoading}
              />
              <button
                type="submit"
                disabled={
                  !input.trim() ||
                  guesses.length >= MAX_GUESSES_PER_DAY ||
                  guessLoading
                }
              >
                {guessLoading ? <Loader size={18} className="animate-spin" /> : "Submit"}
              </button>
            </form>

            <div id="feedback" className="feedback">
              {feedback}
            </div>

            <div className="game-body">
              <div className="history-container">
                <p className="progress-hint">
                  {guesses.length === 0 ? (
                    <>
                      Off = (1 - similarity) × 100; <strong>lower</strong> is closer (0 = exact).
                    </>
                  ) : (
                    <>
                      Best today: <strong>{distanceOff(bestSimilarity)} off</strong> — lower is
                      closer (same scale as each guess).
                    </>
                  )}
                </p>
                <div className="progress-container">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${progressWidthPct}%`,
                      backgroundColor: progressBg,
                    }}
                  />
                </div>

                <div className="history">
                  <h2>Your Guesses</h2>
                  <div id="historyList">
                    {displayGuesses.length === 0 ? (
                      <div style={{ color: "#777", padding: "8px 0" }}>
                        No guesses yet.
                      </div>
                    ) : (
                      displayGuesses.map((g, idx) => (
                        <div
                          key={`${idx}-${g.text}-${g.score}-${g.scoreSource ?? "x"}-${g.temp?.key ?? ""}`}
                          className="guess-item"
                        >
                          <div className="guess-item__row">
                            <span>{g.text}</span>
                            <span style={{ color: g?.temp?.color ?? "#777777" }}>
                              {g.temp.label} · {distanceOff(g.score)} off
                            </span>
                          </div>
                          {import.meta.env.DEV ? (
                            <div className="guess-source">
                              score {g.score.toFixed(3)} · {g.scoreSource ?? "?"}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="history-buttons">
                  <button
                    id="latestBtn"
                    type="button"
                    onClick={() => setShowLatest(true)}
                    disabled={showLatest}
                  >
                    Latest 5 Guesses
                  </button>
                  <button
                    id="allBtn"
                    type="button"
                    onClick={() => setShowLatest(false)}
                    disabled={!showLatest}
                  >
                    All Guesses
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

          </article>
        </main>

        <DisclaimerFooter />
      </div>
    </div>
  );
}
