# Hot & Cold (Collegian Games)

A **daily word-guessing game** for *The Daily Collegian*: players get **one secret word per UTC calendar day** and up to **10 guesses**. Closeness is shown as a temperature plus an **“off”** score (lower = closer to the answer).

This folder is a **standalone Vite + React** app with **Netlify Functions** for the API and **Postgres** for article data.

---

## What a new reader should know

| Topic | Summary |
|--------|---------|
| **Where words come from** | Only from Collegian **`articles`** rows: **headline + body HTML** (stripped to text). There is no static word list. |
| **Who picks the daily word** | The function **`get-hotncold-daily-words`** builds a token pool, optionally filters with **OpenAI Moderation**, then picks **one** word for the UTC date using a **deterministic shuffle** (same date → same word for everyone). |
| **How “hot/cold” works** | **`word-similarity`** compares guess vs secret with **OpenAI embeddings** (`text-embedding-3-small`). If that fails or there is no API key, the **browser** falls back to **Levenshtein** similarity (different feel, same UI bands). |
| **Time zone** | “Today” is **UTC midnight to midnight**, matching `new Date().toISOString().slice(0, 10)`. Countdowns in the UI align with that. |

---

## Repo layout (this game only)

```
collegian-hotncold/
├── src/
│   ├── HotNCold.jsx      # Main UI, guesses, localStorage/sessionStorage
│   ├── main.jsx          # PostHog wrapper
│   └── components/       # EmailSignup, DisclaimerFooter, …
├── netlify/functions/
│   ├── get-hotncold-daily-words.js   # DB + pool + moderation → daily JSON
│   ├── word-similarity.js            # Embeddings POST (guess, secret)
│   ├── hotncoldWordUtils.cjs         # Shared extract/shuffle helpers
│   └── …                             # check-email, submit-email, get-articles, …
├── scripts/
│   ├── test-hotncold-algorithms.mjs  # Offline math/tests
│   └── test-openai-embeddings.mjs    # Optional live embedding smoke test
└── netlify.toml
```

---

## Local development

**Use `netlify dev`** so functions run and `.env` is available to them. Vite alone does **not** run Netlify functions.

```bash
cd collegian-hotncold
npm install
netlify dev
```

Open **http://localhost:8888** (Netlify proxies Vite; do not rely on raw **5173** for full behavior).

| Command | Purpose |
|---------|---------|
| `netlify dev` | Full stack: game + `get-hotncold-daily-words` + `word-similarity` + email/article helpers |
| `npm run dev` | Vite only — **daily words and embeddings will not work** |
| `npm run build` | Production bundle to `dist/` |
| `npm run lint` | ESLint |

---

## Environment variables

Copy a `.env` from another Collegian game in the monorepo (this repo keeps `.env` in git for private deploys).

| Variable | Used by | Role |
|----------|---------|------|
| `VITE_PUBLIC_POSTHOG_KEY` | Client | PostHog |
| `VITE_PUBLIC_POSTHOG_HOST` | Client | PostHog host |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` | Functions | Postgres (`articles`, email signup, etc.) |
| `OPENAI_API_KEY` | Functions | **Moderation** on daily candidates + **embeddings** for guess similarity |

**If `OPENAI_API_KEY` is missing or errors:** moderation may be skipped (see JSON `moderationSkipped`), and the client uses **Levenshtein** for similarity. In development, failed embedding calls surface in the **dev HUD** (amber hint).

---

## How the daily word is built

1. Load recent articles from Postgres (`title`, `content`, `url`, etc.).
2. Extract a word pool (length rules, stop words, HTML stripped) — see `hotncoldWordUtils.cjs`.
3. Optionally run **OpenAI Moderation** in batches; drop flagged tokens.
4. Shuffle with a **date seed** so the same UTC day always yields the same ordering.
5. Return **one** chosen word plus **`article`** metadata: the story where that token **first** appeared (headline scanned before body; articles ordered newest first).

The HTTP response sets **`Cache-Control`** so Netlify can cache the JSON until **UTC midnight**; empty/error responses use **`no-store`**.

---

## How guessing and caching work

**Scoring**

- Exact match (case-insensitive) → win immediately; **no** embedding call.
- Otherwise POST **`/.netlify/functions/word-similarity`** with `{ guess, secret }` → cosine similarity on embeddings, clamped to `[0, 1]`.
- Client maps that score to temperature bands and **`off` = round((1 − score) × 100)**.

**Caching (similar to other Collegian games)**

| Layer | Key / mechanism | What it does |
|-------|-----------------|--------------|
| CDN / browser | `Cache-Control` on **GET** `get-hotncold-daily-words` | Cache daily JSON until UTC day roll |
| `sessionStorage` | `hotncold_daily_words_v4` + `dateKey`, **1h TTL** | Skip refetching daily payload in one browser session |
| `sessionStorage` | `hotncold_similarity_v1` | Cache guess→score pairs for the UTC day (capped entry count) |
| Function memory | LRU in `word-similarity.js` | Reuse embedding results on warm instances (`X-Cache: HIT`) |
| `localStorage` | `hotncold_daily_progress_v2` | **Score**, **completed**, and **guess list** for same-day reload |

---

## Game rules (player-facing)

- **One** secret word per **UTC** date.
- **10** guesses; duplicate words shake and show a short message.
- **Win:** guess equals the secret. **Loss:** 10 guesses used; secret shown on the completion screen.

---

## Automated tests

| Script | Needs network / OpenAI? | What it checks |
|--------|-------------------------|----------------|
| `npm run test:alg` | No | Word extraction, shuffle determinism, Levenshtein / `distanceOff`-style math (`scripts/test-hotncold-algorithms.mjs`) |
| `npm run test:openai` | Yes, if `OPENAI_API_KEY` set | Embedding smoke test vs a fixed secret; **exits 0** if the key is absent (CI-safe skip) |

---

## Deploy (Netlify)

Point the site at this directory, set the env vars above, and deploy. **`OPENAI_API_KEY`** is strongly recommended for moderation and for embedding-based hints.

---

## Troubleshooting: UI always shows “Levenshtein”

1. Run **`netlify dev`**, not only **`npm run dev`**.
2. Put **`OPENAI_API_KEY=sk-…`** in `collegian-hotncold/.env` (no quotes); restart `netlify dev`.
3. In production, set the same variable in **Netlify → Environment** and redeploy.
4. Check OpenAI **billing / quota**; `insufficient_quota` is common on new keys.
5. **`word-similarity` does not use the database** — if it fails, the error is from OpenAI or the function config, not Postgres.

Embeddings measure **vector similarity**, not human categories (e.g. related words can still look “cold”). That is expected behavior, not a broken score.
