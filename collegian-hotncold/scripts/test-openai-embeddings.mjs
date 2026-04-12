/**
 * Optional smoke test: same embedding model + cosine path as `netlify/functions/word-similarity.js`.
 * Loads `collegian-hotncold/.env` if present (does not override existing env vars).
 * Exits 0 immediately if OPENAI_API_KEY is unset (CI-friendly).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const envPath = path.join(rootDir, ".env");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k] !== undefined) continue;
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

loadDotEnv(envPath);

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

function temperatureBand(score) {
  if (score >= 1) return "Correct";
  if (score > 0.75) return "Very Hot";
  if (score > 0.5) return "Warm";
  if (score > 0.25) return "Cold";
  return "Freezing";
}

function distanceOff(score) {
  const clamped = Math.min(1, Math.max(0, Number(score) || 0));
  return Math.round((1 - clamped) * 100);
}

async function embeddingScore(apiKey, guess, secret) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: [guess.toLowerCase(), secret.toLowerCase()],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 400)}`);
  }
  const data = await res.json();
  const embeddings = (data.data || []).sort((a, b) => a.index - b.index);
  if (embeddings.length < 2) {
    throw new Error("Invalid embedding response");
  }
  return cosineSimilarity(embeddings[0].embedding, embeddings[1].embedding);
}

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  console.log("test:openai skipped — OPENAI_API_KEY not set");
  process.exit(0);
}

const SECRET = "shoe";
/** Human-style guesses around footwear + one unrelated control. */
const GUESSES = [
  "shoe",
  "lace",
  "sneaker",
  "boot",
  "footwear",
  "running",
  "leather",
  "apple",
];

console.log(`Hot & Cold embedding smoke (secret: "${SECRET}")\n`);

for (const g of GUESSES) {
  if (g.toLowerCase() === SECRET) {
    console.log(
      `${g.padEnd(12)}  score=1.0000  band=Correct   off=0   (game uses exact match, no API)`
    );
    continue;
  }
  const score = await embeddingScore(apiKey, g, SECRET);
  if (score < 0 || score > 1) {
    console.error(`Out-of-range score for "${g}": ${score}`);
    process.exit(1);
  }
  const band = temperatureBand(score);
  const off = distanceOff(score);
  console.log(
    `${g.padEnd(12)}  score=${score.toFixed(4)}  band=${band.padEnd(10)}  off=${String(off).padStart(3)}`
  );
}

console.log("\nOK — cosine similarity in [0, 1]; off = round((1 - score) * 100) like the game UI.");
