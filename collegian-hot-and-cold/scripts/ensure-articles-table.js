/**
 * Creates the articles table if it doesn't exist. Run from collegian-hot-and-cold:
 *   node scripts/ensure-articles-table.js
 * Loads .env from current directory (collegian-hot-and-cold).
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const client = new pg.Client({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS articles (
  guid VARCHAR(255) PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  content TEXT,
  author VARCHAR(255),
  pub_date TIMESTAMP NOT NULL,
  image_url TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);
`;

async function main() {
  try {
    await client.connect();
    await client.query(CREATE_SQL);
    console.log("Table 'articles' is ready.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
