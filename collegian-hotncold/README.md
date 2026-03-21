# Hot & Cold

Daily word-guessing game for **The Daily Collegian**. Secret words are taken **only** from recent headline text in the Postgres **`articles`** table (same pipeline as Redacted / Headline Hunter). Hot/cold feedback uses **OpenAI embeddings** when the API succeeds; otherwise **Levenshtein** (spelling) distance in the browser.

## Run locally

```bash
cd collegian-hotncold
npm install
netlify dev
```

Plain Vite (no Netlify functions — headlines and OpenAI will not work):

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_PUBLIC_POSTHOG_KEY` | Client | PostHog project key |
| `VITE_PUBLIC_POSTHOG_HOST` | Client | PostHog API host |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` | Netlify Functions | Postgres for `get-articles`, email signup |
| `OPENAI_API_KEY` | Netlify Functions | OpenAI embeddings for similarity |

Copy values from another Collegian game’s `.env`. If `OPENAI_API_KEY` is missing or the API errors, the client uses Levenshtein only.

## Data & caching

- **Headlines / secret words:** Fetched on **every page load** from `/.netlify/functions/get-articles` (no `sessionStorage` or other client cache for articles). Words are parsed from `title` / `headline` fields only. If fewer than five playable words are available, the game shows an error — **no backup word list**.
- **Similarity:** Each guess POSTs to `word-similarity` (OpenAI `text-embedding-3-small`). **No caching** of similarity results. The UI states whether the last guess used OpenAI or Levenshtein.
- **Daily progress** is still stored in `localStorage` (`hotncold_daily_progress`) like other Collegian daily games.

## Game rules

- **5 rounds** per calendar day (local midnight), deterministic date seed.
- **10 guesses** per round; duplicate guesses shake.
- **Win** = exact match (case-insensitive). **Loss** = out of guesses for that round.

## Deploy

Connect this folder as a Netlify site with the env vars above, including `OPENAI_API_KEY` for semantic clues.

## OpenAI shows as Levenshtein?

1. **Local:** Run **`netlify dev`**, not only `npm run dev`. Vite alone does not run Netlify functions or inject `.env` into them.
2. **`.env`:** `OPENAI_API_KEY=sk-...` in `collegian-hotncold/.env` (no quotes). Restart `netlify dev` after changing it.
3. **Production:** In Netlify → Site → Environment variables, add `OPENAI_API_KEY` and redeploy.
4. **Billing / quota:** [platform.openai.com](https://platform.openai.com) — embeddings need an active plan and available quota (`insufficient_quota` is common on new keys).
5. The game shows an **OpenAI debug** amber box with the server error when the similarity function fails.

The `word-similarity` function only talks to OpenAI (no database).
