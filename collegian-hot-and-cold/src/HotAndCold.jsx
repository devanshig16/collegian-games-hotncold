import { useEffect, useState } from "react";
import { Loader, Info } from "lucide-react";
import useGameAnalytics from "./hooks/useGameAnalytics";
import EmailSignup from "./components/EmailSignup";
import DisclaimerFooter from "./components/DisclaimerFooter";

const GAME_ID = "hot-and-cold";
const DAILY_STORAGE_KEY = "hotandcold_daily_progress";

const getTodayKey = () => new Date().toISOString().slice(0, 10);


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
  const [dailyInfo, setDailyInfo] = useState(null);
  const [hintRevealed, setHintRevealed] = useState(false);
  const [showLatest, setShowLatest] = useState(true); // Latest 5 vs All Guesses

  const analytics = useGameAnalytics(GAME_ID, 0);

  const bestSimilarity = history.length ? Math.max(...history.map((e) => e.similarity)) : 0;

  const progressBarColor = () => {
    if (bestSimilarity >= 80) return "#c8102e";
    if (bestSimilarity >= 60) return "#ff8c00";
    if (bestSimilarity >= 40) return "#0074d9";
    return "#001e44";
  };

  const tempClass = (label) => {
    if (label === "Bullseye!") return "temp-bullseye";
    if (label === "On fire!") return "temp-onfire";
    if (label === "Hot") return "temp-hot";
    if (label === "Warm") return "temp-warm";
    if (label === "Cold") return "temp-cold";
    return "temp-freezing";
  };

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
      <div className="hotcold-page flex flex-col items-center justify-center">
        <Loader className="animate-spin text-white mb-4" size={48} />
        <p className="text-[#b0b0b0] font-bold">Loading today&apos;s word...</p>
      </div>
    );
  }

  if (gameState === "error") {
    return (
      <div className="hotcold-page flex flex-col items-center justify-center px-4">
        <p className="text-red-400 font-bold mb-2">{error}</p>
        <p className="text-[#b0b0b0] text-sm">
          Check your connection or try again later.
        </p>
      </div>
    );
  }

  const displayHistory = showLatest ? history.slice(-5) : history;
  const sortedDisplay = [...displayHistory].sort((a, b) => b.similarity - a.similarity);

  return (
    <div className="hotcold-page font-sans">
      <header className="site-header">
        <div className="logo">The Daily Collegian</div>
        <div className="section">Games</div>
        <button
          type="button"
          onClick={() => analytics.logFeedback()}
          className="mt-3 px-3 py-1.5 text-sm border border-white/60 text-white/90 rounded hover:bg-white/10 flex items-center gap-1.5 mx-auto"
        >
          <Info size={14} />
          Feedback
        </button>
      </header>

      <main className="flex justify-center px-4 py-10">
        <article className="hotcold-card space-y-6">
          <h1>Hot &amp; Cold</h1>
          <p className="hotcold-description">
            Guess today&apos;s word! After each guess, you&apos;ll be told how &quot;warm&quot; or &quot;cold&quot; you are.
          </p>

          {articles?.[0] && (
            <div className="pb-4 border-b border-[#eee]">
              <h2 className="text-sm font-bold text-[#111] mb-1">Today&apos;s article</h2>
              <p className="text-xs text-[#444] mb-2">The daily word is chosen from this story.</p>
              <a
                href={articles[0].url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-[#001e44] hover:underline"
                onClick={() => analytics.logContentClick({ article_id: articles[0].id, source: "todays_article" })}
              >
                {articles[0].title}
              </a>
            </div>
          )}

          <form id="guessForm" className="hotcold-form" onSubmit={handleSubmit}>
            <input
              type="text"
              id="guessInput"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder="Enter your guess"
              autoComplete="off"
            />
            <button type="submit">Submit</button>
          </form>

          <div id="feedback" className="hotcold-feedback min-h-[1.5rem]">
            {similarity !== null && gameState !== "won" && (
              <span className={tempClass(labelForSimilarity(similarity))}>
                {similarity}% — {labelForSimilarity(similarity)}
              </span>
            )}
            {gameState === "won" && (
              <span className="temp-bullseye">Correct! You found today&apos;s word.</span>
            )}
          </div>

          <div className="game-body">
            <div className="history-container">
              <div className="hotcold-progress-container">
                <div
                  className="hotcold-progress-bar"
                  style={{
                    width: `${bestSimilarity}%`,
                    background: progressBarColor(),
                  }}
                />
              </div>

              <div className="hotcold-history">
                <h2>Your Guesses</h2>
                <div id="historyList">
                  {sortedDisplay.map((entry, index) => (
                    <div key={`${entry.guess}-${index}`} className="guess-item">
                      <span className="font-semibold text-[#111]">{entry.guess}</span>
                      <span className={`font-bold ${tempClass(entry.label)}`}>
                        {entry.similarity}% — {entry.label}
                      </span>
                    </div>
                  ))}
                </div>
                {history.length > 0 && (
                  <div className="hotcold-history-buttons">
                    <button
                      type="button"
                      id="latestBtn"
                      className={showLatest ? "active" : ""}
                      onClick={() => setShowLatest(true)}
                    >
                      Latest 5 Guesses
                    </button>
                    <button
                      type="button"
                      id="allBtn"
                      className={!showLatest ? "active" : ""}
                      onClick={() => setShowLatest(false)}
                    >
                      All Guesses
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {targetWord && (
            <div className="pt-2 border-t border-[#eee] flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[#444]">
                Today&apos;s word is from recent {dailyInfo?.category ? dailyInfo.category.toLowerCase() : "coverage"}.
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!hintRevealed) {
                    analytics.logAction("hint_used", { hint_number: 1 });
                    setHintRevealed(true);
                  }
                }}
                disabled={hintRevealed}
                className="text-xs font-semibold text-[#001e44] hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {hintRevealed ? "Hint revealed" : "Get a hint"}
              </button>
            </div>
          )}
          {hintRevealed && targetWord && (
            <p className="text-xs text-[#444]">
              Hint: the word is <strong>{targetWord.length}</strong> letters and starts with &ldquo;{targetWord[0].toUpperCase()}&rdquo;.
            </p>
          )}

          {gameState === "won" && (
            <div className="pt-4 border-t-2 border-[#c8102e] space-y-2">
              <h2 className="text-xl font-bold text-[#111]">You found it!</h2>
              <p className="text-sm text-[#444]">
                Today&apos;s word was <strong className="uppercase tracking-wide">{targetWord}</strong>.
              </p>
              {articles?.length > 0 && (
                <div className="text-sm">
                  <p className="font-semibold text-[#111] mb-1">It appeared in these recent articles:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {articles.map((article) => (
                      <li key={article.id}>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#001e44] hover:underline"
                          onClick={() => analytics.logContentClick({ article_id: article.id, source: "win_panel" })}
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
        </article>
      </main>

      <DisclaimerFooter />
    </div>
  );
}

