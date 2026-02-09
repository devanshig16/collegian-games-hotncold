# Hot & Cold — Database & real-articles setup

To use **real Daily Collegian articles** (and their words) instead of the dev mock, you need:

1. **A PostgreSQL database** with an `articles` table (same one used by Headline Hunter / Redacted is fine).
2. **Environment variables** set for the Netlify function that talks to that DB.
3. **Article data** in the DB (run the repo scraper so recent articles are present).

---

## 1. Database

Use the **same Postgres** as your other Collegian games, or create a new one (e.g. [Neon](https://neon.tech), [Supabase](https://supabase.com), or any Postgres host).

### Table: `articles`

The Hot & Cold function expects the **same schema** as the rest of the repo (filled by `scraper.py`):

| Column      | Type         | Notes                          |
|------------|--------------|---------------------------------|
| `guid`     | VARCHAR(255) | Primary key, article ID         |
| `title`    | TEXT         | Article headline                |
| `url`      | TEXT         | Full article URL                |
| `content`  | TEXT         | Article text (RSS description)  |
| `author`   | VARCHAR(255) | Optional                        |
| `pub_date` | TIMESTAMP    | When the article was published  |
| `image_url`| TEXT         | Optional                        |
| `updated_at`| TIMESTAMP   | Optional                        |

**Minimum for Hot & Cold:** `guid`, `title`, `url`, `content`, `pub_date`.  
The function uses `content` to extract words; the scraper stores the RSS **description** in `content`. If you later add full article body (e.g. by scraping each article page), you can put that in `content` for richer word choice.

**Optional — category by day:**  
If you add a `category` column (e.g. `News`, `Sports`, `Lifestyle`), set env var `ARTICLES_HAVE_CATEGORY=true` and the game will filter by category (Monday = News, Tuesday = Sports, etc.). Without it, the game uses **all** articles from the last 24 hours.

Example migration if you add category later:

```sql
ALTER TABLE articles ADD COLUMN IF NOT EXISTS category VARCHAR(100);
-- Then backfill or have your scraper set category from RSS/CMS.
```

---

## 2. Environment variables

The Netlify function `get-hot-and-cold-word` reads:

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | Yes | Postgres host (e.g. `xxx.neon.tech` or `db.xxx.supabase.co`) |
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database user |
| `DB_PASSWORD` | Yes | Database password |
| `DB_PORT` | No | Default `5432` |
| `DB_SSL` | No | Set to `"true"` if your provider requires SSL (Neon, Supabase, etc.) |
| `ARTICLES_HAVE_CATEGORY` | No | Set to `"true"` only if `articles` has a `category` column |

**Local (`.env` in `collegian-hot-and-cold/`):**

```env
VITE_PUBLIC_POSTHOG_KEY=your_posthog_key
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

DB_HOST=your_db_host
DB_NAME=your_db_name
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_PORT=5432
DB_SSL=true
```

**Netlify (production):**  
In the Netlify dashboard → your site → Site settings → Environment variables, add the same `DB_*` and (optional) `ARTICLES_HAVE_CATEGORY`. Do **not** put secrets in the repo.

---

## 3. Getting articles into the DB

The repo’s **scraper** fills `articles` from the Collegian RSS (title, link, description → `content`, pub date, etc.):

1. From the **repo root** (where `scraper.py` lives), create a `.env` with the same `DB_*` values.
2. Install deps: `pip install -r requirements.txt` (or the deps used by `scraper.py`).
3. Run: `python scraper.py`.

That will insert/update articles with `guid`, `title`, `url`, `content` (from RSS description), `pub_date`, etc. Hot & Cold uses the **last 24 hours** of articles; run the scraper regularly (e.g. cron or GitHub Actions) so new articles are available.

---

## 4. Running the game with the real API

- **Production:** Deploy the `collegian-hot-and-cold` app to Netlify and set the env vars above. The site will call `/.netlify/functions/get-hot-and-cold-word` and get the real word + articles.
- **Local with real DB:** Install Netlify CLI (`npm i -g netlify-cli`), then from `collegian-hot-and-cold` run:
  ```bash
  netlify dev
  ```
  Use the same `.env` so the function can connect to Postgres. The app will load the real daily word instead of the mock.

---

## 5. Quick checklist

- [ ] Postgres DB exists and `articles` has at least: `guid`, `title`, `url`, `content`, `pub_date`.
- [ ] Scraper has been run so there are articles from the last 24 hours.
- [ ] `.env` (local) and Netlify env (production) have `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_SSL=true` if required.
- [ ] Run `netlify dev` (local) or deploy to Netlify (production) so the function is used and the “Unable to load today’s puzzle” message goes away.

If the function returns 500, check Netlify function logs (or `netlify dev` output) for the Postgres error (e.g. wrong credentials, missing columns, or SSL).
