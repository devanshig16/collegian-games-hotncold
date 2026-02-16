import { useEffect, useState } from "react";
import { Loader, Thermometer, Info } from "lucide-react";
import useGameAnalytics from "./hooks/useGameAnalytics";
import EmailSignup from "./components/EmailSignup";
import DisclaimerFooter from "./components/DisclaimerFooter";

const GAME_ID = "hot-and-cold";
const DAILY_STORAGE_KEY = "hotandcold_daily_progress";

const getTodayKey = () => new Date().toISOString().slice(0, 10);

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

const formatCountdown = ({ hours, minutes }) =>
  `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

const levenshtein = (a, b) => {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
};

const similarityPercent = (guess, target) => {
  const g = guess.trim();
  const t = target.trim();
  if (!g || !t) return 0;
  const maxLen = Math.max(g.length, t.length);
  if (!maxLen) return 0;
  const dist = levenshtein(g, t);
  return Math.max(0, Math.round((1 - dist / maxLen) * 100));
};

const labelForSimilarity = (pct) => {
  if (pct === 100) return "Bullseye!";
  if (pct >= 80) return "On fire!";
  if (pct >= 60) return "Hot";
  if (pct >= 40) return "Warm";
  if (pct >= 20) return "Cold";
  return "Freezing";
};

export default function HotAndCold() {
  const [gameState, setGameState] = useState("loading"); // loading | playing | won
  const [guess, setGuess] = useState("");
  const [targetWord, setTargetWord] = useState(null);
  const [articles, setArticles] = useState([]);
  const [similarity, setSimilarity] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [timeUntilReset, setTimeUntilReset] = useState(getTimeUntilReset);
  const [dailyInfo, setDailyInfo] = useState(null);
  const [hintRevealed, setHintRevealed] = useState(false);

  const analytics = useGameAnalytics(GAME_ID, 0);

  useEffect(() => {
    const load = async () => {
      const todayKey = getTodayKey();

      // Mock data for local dev when the API isn't available (e.g. npm run dev without Netlify)
      const useMockInDev = () => {
        if (!import.meta.env.DEV) return false;
        setTargetWord("football");
        setArticles([
          { id: "mock-1", title: "Sample Collegian article (dev only)", url: "https://www.psucollegian.com" },
        ]);
        setDailyInfo({ date: todayKey, category: "Sports" });
        setGameState("playing");
        analytics.logStart({ category: "Sports", mock: true });

        const stored = localStorage.getItem(DAILY_STORAGE_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.date === todayKey && Array.isArray(parsed.history)) {
              setHistory(parsed.history);
              if (parsed.history.length > 0) {
                const last = parsed.history[parsed.history.length - 1];
                setSimilarity(last.similarity);
                if (parsed.won) setGameState("won");
              }
            }
          } catch {
            // ignore
          }
        }
        return true;
      };

      try {
        const response = await fetch("/api/get-hot-and-cold-word");
        if (!response.ok) throw new Error("Failed to load today's word");
        const data = await response.json();
        setTargetWord(data.targetWord);
        setArticles(data.articles || []);
        setDailyInfo({ date: data.date, category: data.category });
        setGameState("playing");
        setHintRevealed(false);
        analytics.logStart({ category: data.category });

        const stored = localStorage.getItem(DAILY_STORAGE_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.date === data.date && Array.isArray(parsed.history)) {
              setHistory(parsed.history);
              if (parsed.history.length > 0) {
                const last = parsed.history[parsed.history.length - 1];
                setSimilarity(last.similarity);
                if (parsed.won) setGameState("won");
              }
            }
          } catch {
            // ignore
          }
        }
      } catch (e) {
        if (useMockInDev()) return;
        console.error(e);
        setError("Unable to load today's puzzle. Please try again later.");
        setGameState("error");
      }
    };

    load();
  }, [analytics]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeUntilReset(getTimeUntilReset());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!targetWord) return;
    const payload = {
      date: getTodayKey(),
      history,
      won: gameState === "won",
    };
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(payload));
  }, [history, gameState, targetWord]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!guess.trim() || !targetWord || gameState === "loading") return;

    const pct = similarityPercent(guess, targetWord);
    const label = labelForSimilarity(pct);

    const entry = {
      guess: guess.trim(),
      similarity: pct,
      label,
    };

    setHistory((prev) => [...prev, entry]);
    setSimilarity(pct);
    analytics.logAction("guess", { guess: guess.trim(), similarity: pct });

    if (pct === 100) {
      setGameState("won");
      analytics.logWin({ guesses: history.length + 1 });
    }

    setGuess("");
  };

  if (gameState === "loading") {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center">
        <Loader className="animate-spin text-blue-600 mb-4" size={48} />
        <p className="text-slate-500 font-bold">Loading today&apos;s word...</p>
      </div>
    );
  }

  if (gameState === "error") {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center px-4">
        <p className="text-red-600 font-bold mb-2">{error}</p>
        <p className="text-slate-500 text-sm">
          Check your connection or try again later.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 font-sans text-slate-900">
      <div className="max-w-2xl mx-auto mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
            Hot &amp; Cold
          </h1>
          <p className="text-slate-500 text-sm">
            Guess the most important word from the latest Collegian coverage.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
            {dailyInfo?.category && (
              <span className="rounded-full bg-slate-200/70 px-3 py-1">
                Today&apos;s beat: {dailyInfo.category}
              </span>
            )}
            <span className="rounded-full bg-slate-200/70 px-3 py-1">
              New puzzle in {formatCountdown(timeUntilReset)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => analytics.logFeedback()}
          className="bg-white px-3 py-2 rounded-full shadow-sm font-bold text-slate-600 border border-slate-200 flex items-center gap-2 hover:border-blue-200 hover:text-blue-700 transition text-sm self-start"
        >
          <Info size={16} />
          Feedback
        </button>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {articles?.[0] && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
            <h2 className="text-sm font-black text-slate-900 mb-1">
              Today&apos;s article
            </h2>
            <p className="text-xs text-slate-500 mb-2">
              The daily word is chosen from this story.
            </p>
            <a
              href={articles[0].url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline"
            >
              {articles[0].title}
            </a>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md">
              <Thermometer size={20} />
            </div>
            <div>
              <h2 className="font-black text-slate-900 text-lg">
                How close is your guess?
              </h2>
              <p className="text-xs text-slate-500">
                Type a single word. You&apos;ll see how hot or cold you are.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="Your guess (e.g., football, tuition, charity)"
                className="flex-1 px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
              />
              <button
                type="submit"
                className="px-5 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-lg hover:shadow-xl transition-all active:scale-95"
              >
                Submit guess
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative h-2 bg-slate-200 rounded-full">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 -translate-x-1/2">
                Far
              </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 translate-x-1/2">
                Old Main
              </div>
              {similarity !== null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                  style={{ left: `${similarity}%` }}
                >
                  <div className="w-4 h-4 rounded-full bg-blue-600 shadow-md border-2 border-white" />
                </div>
              )}
            </div>
            <div className="mt-3 text-center text-sm text-slate-600 font-medium min-h-[1.5rem]">
              {similarity !== null && (
                <>
                  {similarity}% — {labelForSimilarity(similarity)}
                </>
              )}
            </div>
            {targetWord && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-xs text-slate-500">
                  Today&apos;s word is a single word from recent{" "}
                  {dailyInfo?.category ? dailyInfo.category.toLowerCase() : "coverage"}
                  .
                </div>
                <button
                  type="button"
                  onClick={() => setHintRevealed(true)}
                  disabled={hintRevealed}
                  className="self-start px-3 py-2 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-60 disabled:cursor-not-allowed bg-white"
                >
                  {hintRevealed ? "Hint revealed" : "Get a hint"}
                </button>
              </div>
            )}
            {hintRevealed && targetWord && (
              <p className="mt-2 text-xs text-slate-600">
                Hint: the word is{" "}
                <span className="font-bold">{targetWord.length}</span> letters long and
                starts with{" "}
                <span className="font-bold">
                  &ldquo;{targetWord[0].toUpperCase()}&rdquo;
                </span>
                .
              </p>
            )}
          </div>
        </div>

        {history.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-sm">
            <h3 className="font-black text-slate-900 text-base mb-3">
              Your guesses
            </h3>
            <ul className="space-y-2 text-sm">
              {[...history]
                .sort((a, b) => b.similarity - a.similarity)
                .map((entry, index) => (
                  <li
                    key={`${entry.guess}-${index}`}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                  >
                    <span className="font-semibold text-slate-800">
                      {entry.guess}
                    </span>
                    <span className="text-xs font-bold text-slate-600">
                      {entry.similarity}% • {entry.label}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {gameState === "won" && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 sm:p-6 shadow-sm space-y-3">
            <h2 className="text-xl font-black text-green-700">
              You found it!
            </h2>
            <p className="text-green-800 text-sm">
              Today&apos;s word was{" "}
              <span className="font-black uppercase tracking-wide">
                {targetWord}
              </span>
              .
            </p>
            {articles?.length > 0 && (
              <div className="mt-2 space-y-1 text-sm text-green-900">
                <p className="font-semibold">
                  It appeared in these recent articles:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {articles.map((article) => (
                    <li key={article.id}>
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-green-800 hover:text-green-900 hover:underline"
                      >
                        {article.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <EmailSignup gameName="Hot & Cold" />
      </div>

      <DisclaimerFooter />
    </div>
  );
}

