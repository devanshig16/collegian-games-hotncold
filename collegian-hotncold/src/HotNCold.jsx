import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Confetti from "react-confetti";
import { Loader } from "lucide-react";
import DisclaimerFooter from "./components/DisclaimerFooter";
import EmailSignup from "./components/EmailSignup";
import useGameAnalytics from "./hooks/useGameAnalytics";

const DB_API_ENDPOINT = "/.netlify/functions/get-articles";
const SIMILARITY_API_ENDPOINT = "/.netlify/functions/word-similarity";
const DAILY_LIMIT = 5;
const MAX_GUESSES_PER_ROUND = 10;
const DAILY_STORAGE_KEY = "hotncold_daily_progress";

/** Articles, pronouns, determiners, and common function words — never used as secret answers */
const STOP_WORDS = new Set([
  // articles
  "a",
  "an",
  "the",
  // personal / possessive / reflexive pronouns
  "i",
  "me",
  "my",
  "mine",
  "you",
  "your",
  "yours",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "it",
  "its",
  "we",
  "us",
  "our",
  "ours",
  "they",
  "them",
  "their",
  "theirs",
  "myself",
  "yourself",
  "himself",
  "herself",
  "itself",
  "ourselves",
  "yourselves",
  "themselves",
  // demonstratives & interrogatives (often 4+ chars in headlines)
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "whatever",
  "whoever",
  "whomever",
  "whichever",
  // indefinite / distributive
  "anyone",
  "anything",
  "anybody",
  "anywhere",
  "everyone",
  "everything",
  "everybody",
  "everywhere",
  "someone",
  "something",
  "somebody",
  "somewhere",
  "nobody",
  "nothing",
  "nowhere",
  "none",
  "each",
  "either",
  "neither",
  "both",
  "another",
  "other",
  "such",
  // common prepositions / particles
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "into",
  "onto",
  "upon",
  "over",
  "under",
  "above",
  "below",
  "between",
  "among",
  "through",
  "during",
  "before",
  "after",
  "since",
  "until",
  "within",
  "without",
  "against",
  "toward",
  "towards",
  "about",
  "around",
  "across",
  "along",
  "behind",
  "beyond",
  "inside",
  "outside",
  "near",
  "off",
  "out",
  "up",
  "down",
  // conjunctions & helpers
  "and",
  "but",
  "or",
  "nor",
  "so",
  "yet",
  "as",
  "if",
  "than",
  "then",
  "because",
  "although",
  "though",
  "while",
  "whether",
  // auxiliary / be-verbs
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "having",
  "do",
  "does",
  "did",
  "doing",
  "done",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  // misc function words
  "said",
  "says",
  "new",
  "more",
  "most",
  "some",
  "no",
  "not",
  "just",
  "like",
  "also",
  "only",
  "even",
  "very",
  "too",
  "here",
  "there",
  "now",
  "again",
  "once",
  "ever",
  "never",
  "always",
  "often",
  "still",
  "already",
  "rather",
  "quite",
  "much",
  "many",
  "few",
  "less",
  "least",
  "every",
  "own",
  "same",
]);

function extractWordsFromArticles(articles) {
  const seen = new Set();
  const words = [];
  for (const a of articles) {
    const headline = a.headline || a.title || "";
    const tokens = headline.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/);
    for (const t of tokens) {
      const w = t.replace(/^['-]+|['-]+$/g, "");
      if (w.length >= 4 && w.length <= 12 && !STOP_WORDS.has(w) && !seen.has(w)) {
        seen.add(w);
        words.push(w);
      }
    }
  }
  return words;
}

const getTodayKey = () => new Date().toISOString().slice(0, 10);

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

const getTimeUntilReset = () => {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setHours(24, 0, 0, 0);
  const diffMs = Math.max(nextReset - now, 0);
  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
};

/** How each guess was scored (for analytics / debugging) */
/** @typedef {'openai' | 'levenshtein' | 'exact'} ScoreSource */

export default function HotNCold() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [headlinesError, setHeadlinesError] = useState(null);

  const seed = Number(getTodayKey().replace(/-/g, ""));
  const dailyWords = useMemo(() => {
    if (articles.length === 0) return [];
    const pool = extractWordsFromArticles(articles);
    if (pool.length < DAILY_LIMIT) return [];
    return seededShuffle(pool, seed).slice(0, DAILY_LIMIT);
  }, [articles, seed]);

  const [roundIndex, setRoundIndex] = useState(
    () => readSavedProgress()?.roundIndex ?? 0
  );
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

  const analytics = useGameAnalytics("hot-n-cold", roundIndex);
  const secretWord = dailyWords[roundIndex] ?? "";

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
    const fetchArticles = async () => {
      setHeadlinesError(null);
      try {
        const res = await fetch(DB_API_ENDPOINT);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          throw new Error(
            import.meta.env.DEV
              ? "get-articles did not return JSON. Use `netlify dev` and open http://localhost:8888 — `npm run dev` (Vite only) does not run Netlify functions."
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
        const cleaned = (data || []).filter((a) => a?.headline);
        const pool = extractWordsFromArticles(cleaned);
        if (pool.length < DAILY_LIMIT) {
          setHeadlinesError(
            `Need at least ${DAILY_LIMIT} playable words from Collegian headlines; found ${pool.length}. Words are not taken from anywhere else.`
          );
          setArticles([]);
        } else {
          setArticles(cleaned);
        }
      } catch (err) {
        console.error("Hot & Cold: failed to fetch articles", err);
        const fallback =
          "Could not load headlines from The Daily Collegian articles database (Postgres). Check your connection and try again.";
        const msg = err instanceof Error && err.message ? err.message : fallback;
        setHeadlinesError(msg);
        setArticles([]);
      } finally {
        setLoading(false);
      }
    };
    fetchArticles();
  }, []);

  useEffect(() => {
    if (gameStartLoggedRef.current) return;
    if (readSavedProgress()) return;
    gameStartLoggedRef.current = true;
    analytics.logStart({ difficulty: "daily" });
  }, [analytics]);

  // Keep feedback focused on the current round.
  useEffect(() => {
    setFeedback("");
  }, [roundIndex]);

  useEffect(() => {
    if (readSavedProgress()?.completed) return;
    saveProgress({
      roundIndex,
      score,
      completed: gameState === "daily-complete",
    });
  }, [gameState, roundIndex, saveProgress, score]);

  const advanceOrFinish = useCallback(
    (won) => {
      if (roundCompletedRef.current) return;
      roundCompletedRef.current = true;

      if (won) {
        analytics.logWin({ guesses_used: guesses.length + 1 });
        const nextScore = score + 1;
        setScore(nextScore);
        if (roundIndex + 1 >= DAILY_LIMIT) {
          if (!dailyCompleteLoggedRef.current) {
            dailyCompleteLoggedRef.current = true;
            analytics.logAction("daily_complete", {
              final_score: nextScore,
              total_rounds: DAILY_LIMIT,
            });
          }
          setShowConfetti(true);
          setGameState("daily-complete");
          saveProgress({
            roundIndex: DAILY_LIMIT,
            score: nextScore,
            completed: true,
          });
        } else {
          roundCompletedRef.current = false;
          setGuesses([]);
          setInput("");
          setRoundIndex((r) => r + 1);
        }
      } else {
        analytics.logLoss({ reason: "max_guesses" });
        if (roundIndex + 1 >= DAILY_LIMIT) {
          if (!dailyCompleteLoggedRef.current) {
            dailyCompleteLoggedRef.current = true;
            analytics.logAction("daily_complete", {
              final_score: score,
              total_rounds: DAILY_LIMIT,
            });
          }
          setGameState("daily-complete");
          saveProgress({
            roundIndex: DAILY_LIMIT,
            score,
            completed: true,
          });
        } else {
          roundCompletedRef.current = false;
          setGuesses([]);
          setInput("");
          setRoundIndex((r) => r + 1);
        }
      }
    },
    [analytics, guesses.length, roundIndex, saveProgress, score]
  );

  const submitGuess = async (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || gameState !== "playing" || guessLoading) return;

    if (guesses.length >= MAX_GUESSES_PER_ROUND) return;

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
            scoreSource = "openai";
            setOpenAiErrorHint(null);
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
    } finally {
      setGuessLoading(false);
    }

    const temp = temperatureFromScore(scoreVal);
    const entry = { text: trimmed, score: scoreVal, temp, scoreSource };
    setGuesses((g) => [...g, entry]);
    setInput("");

    if (trimmed.toLowerCase() === secretWord.toLowerCase()) {
      setFeedback("Correct! You found today's word.");
      advanceOrFinish(true);
      return;
    }

    setFeedback(temp.label);

    if (guesses.length + 1 >= MAX_GUESSES_PER_ROUND) {
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
              Secret words are <span className="font-bold">only</span> taken from headline text in
              the Postgres <code className="text-xs bg-slate-100 px-1 rounded">articles</code> table
              (via <code className="text-xs bg-slate-100 px-1 rounded">get-articles</code>). There is
              no backup word list.
            </p>
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
              {score}/{DAILY_LIMIT} · Round {Math.min(roundIndex + 1, DAILY_LIMIT)}/
              {DAILY_LIMIT}
            </div>

            <p className="description">
              Guess today’s word! After each guess, you’ll be told how "warm" or "cold" you are.
            </p>

            {import.meta.env.DEV ? (
              <div className="correct-word">
                Correct word: <span style={{ fontWeight: 800 }}>{secretWord}</span>
              </div>
            ) : null}

            {openAiErrorHint ? (
              <div className="openai-debug">
                <span style={{ fontWeight: 800 }}>OpenAI debug:</span> {openAiErrorHint}
              </div>
            ) : null}

        {gameState === "daily-complete" ? (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-black text-slate-900">Daily complete</h2>
              <p className="text-slate-600 mt-2">
                You scored <span className="font-bold text-blue-600">{score}</span> out of{" "}
                {DAILY_LIMIT} today.
              </p>
              <p className="text-slate-500 text-sm mt-4">
                Next puzzle in{" "}
                <span className="font-bold text-slate-800">
                  {resetCountdown.hours}h {resetCountdown.minutes}m
                </span>
              </p>
              <p className="text-slate-500 text-xs mt-4 text-center">
                Today’s secret words came from The Daily Collegian{" "}
                <code className="bg-slate-100 px-1 rounded">articles</code> database.
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
                disabled={guesses.length >= MAX_GUESSES_PER_ROUND || guessLoading}
              />
              <button
                type="submit"
                disabled={
                  !input.trim() ||
                  guesses.length >= MAX_GUESSES_PER_ROUND ||
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
                      displayGuesses.map((g) => (
                        <div
                          key={`${g.text}-${g.score}-${g.scoreSource ?? "legacy"}`}
                          className="guess-item"
                        >
                          <span>{g.text}</span>
                          <span style={{ color: g?.temp?.color ?? "#777777" }}>
                            {g.temp.label}
                          </span>
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
