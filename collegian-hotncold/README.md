# Hot & Cold

Daily word-guessing game for **The Daily Collegian**: **one secret word per UTC calendar day**. Words are taken **only** from recent **headlines and article body text** (`articles.title` + `articles.content`) in Postgres. Each page load calls **`get-hotncold-daily-words`**, which builds a candidate pool, runs **OpenAI Moderations** (`text-moderation-latest`) on batches of candidates, and returns **one** deterministic daily answer plus a link to the **source article** (with an unmoderated fallback if moderation is unavailable). Guess feedback uses **OpenAI embeddings** when similarity succeeds; otherwise **Levenshtein** in the browser.

## Run locally

**Use Netlify’s dev server** so `get-hotncold-daily-words`, `get-articles` (email/other), and `word-similarity` run. After `npm install`:

```bash
cd collegian-hotncold
netlify dev
```

Then open **http://localhost:8888** (not 5173). `netlify.toml` wires Vite on 5173 to this port with functions.

Plain Vite (no Netlify functions — headlines and OpenAI will not work):

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Algorithm checks (no DB / OpenAI)

```bash
npm run test:alg
```

Runs `scripts/test-hotncold-algorithms.mjs`: word extraction + HTML strip, deterministic shuffle, date seed, and Levenshtein similarity scores (same math as the client fallback).

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_PUBLIC_POSTHOG_KEY` | Client | PostHog project key |
| `VITE_PUBLIC_POSTHOG_HOST` | Client | PostHog API host |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` | Netlify Functions | Postgres for `get-hotncold-daily-words`, `get-articles`, email signup |
| `OPENAI_API_KEY` | Netlify Functions | OpenAI **moderations** (daily word filter) + **embeddings** (guess similarity) |

Copy values from another Collegian game’s `.env`. If `OPENAI_API_KEY` is missing or the embeddings call fails, the client uses Levenshtein for similarity only. If moderation cannot run, the daily-word function still returns one answer using the shuffled pool without moderation (see `moderationSkipped` in the JSON response).

## Data & caching

Aligned with other Collegian games (e.g. **Redacted** `sessionStorage` for `hh_news_cache`, **Over Under** `Cache-Control` on `cfb-stats`, **TimeMachine** on IIIF functions):

- **Secret word (`get-hotncold-daily-words`):** Response includes **`Cache-Control: public, s-maxage=…, max-age=…`** so Netlify’s CDN can cache the JSON until **UTC midnight** (empty-pool responses use `no-store`). The JSON includes **`article`** (`url`, `headline`, optional `image` from the DB) for the Collegian story where the daily token **first** appeared (headline before body, newest articles first). The UI shows a **compact source card** (headline link + external-link icon, no hero image). The client mirrors **`sessionStorage`** (`hotncold_daily_words_v4`, **1 hour TTL**, same UTC `dateKey`) so reloads in one session skip Postgres + moderation when still fresh.
- **Similarity (`word-similarity`):** **In-memory LRU** (~2500 pairs) on the warm function instance returns **`X-Cache: HIT`** without calling OpenAI again. The client stores successful embedding scores in **`sessionStorage`** (`hotncold_similarity_v1`, capped entries per UTC day) so the same guess+secret pair does not POST again. **POST** responses are not CDN-cached; server memory + browser session handle repeat traffic.
- **Daily progress:** `localStorage` key **`hotncold_daily_progress_v2`** (score + completed for the single daily word).

Moderation reduces violent, sexual, hateful, self-harm, and related categories per [OpenAI’s moderation schema](https://platform.openai.com/docs/guides/moderation); it does **not** target “weird” or rare vocabulary specifically.

## Game rules

- **One word** per **UTC** calendar date (same `YYYY-MM-DD` as `toISOString().slice(0,10)`), deterministic shuffle + moderation pass order on the server.
- **10 guesses** per day; duplicate guesses shake.
- **Win** = exact match (case-insensitive). **Loss** = out of guesses (word is revealed on the complete screen).

## Deploy

Connect this folder as a Netlify site with the env vars above, including `OPENAI_API_KEY` for moderation (daily words) and semantic similarity (guesses).

## OpenAI shows as Levenshtein?

1. **Local:** Run **`netlify dev`**, not only `npm run dev`. Vite alone does not run Netlify functions or inject `.env` into them.
2. **`.env`:** `OPENAI_API_KEY=sk-...` in `collegian-hotncold/.env` (no quotes). Restart `netlify dev` after changing it.
3. **Production:** In Netlify → Site → Environment variables, add `OPENAI_API_KEY` and redeploy.
4. **Billing / quota:** [platform.openai.com](https://platform.openai.com) — embeddings need an active plan and available quota (`insufficient_quota` is common on new keys).
5. The game shows an **OpenAI debug** amber box with the server error when the similarity function fails.

The `word-similarity` function only talks to OpenAI (no database).
