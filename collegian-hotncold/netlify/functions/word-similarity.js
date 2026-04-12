/**
 * OpenAI embeddings only — no Postgres. DB failures must not block OpenAI.
 *
 * In-memory LRU for (guess, secret) → score to cut repeat OpenAI calls (warm function instance).
 * Same idea as HTTP Cache-Control on GET functions elsewhere in Collegian games.
 */
const EMBEDDING_CACHE_MAX = 2500;
/** @type {Map<string, number>} */
const embeddingCache = new Map();

function embeddingCacheKey(guess, secret) {
  return `${guess}\0${secret}`;
}

function embeddingCacheGet(key) {
  const v = embeddingCache.get(key);
  if (v === undefined) return undefined;
  embeddingCache.delete(key);
  embeddingCache.set(key, v);
  return v;
}

function embeddingCacheSet(key, score) {
  embeddingCache.delete(key);
  embeddingCache.set(key, score);
  while (embeddingCache.size > EMBEDDING_CACHE_MAX) {
    const oldest = embeddingCache.keys().next().value;
    embeddingCache.delete(oldest);
  }
}

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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "OPENAI_API_KEY is not set for this Netlify site (or .env with netlify dev)",
        fallback: true,
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Invalid JSON" }),
    };
  }

  const guess = (body.guess || "").trim().toLowerCase();
  const secret = (body.secret || "").trim().toLowerCase();

  if (!guess || !secret) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "guess and secret are required" }),
    };
  }

  if (guess === secret) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: 1 }),
    };
  }

  const embKey = embeddingCacheKey(guess, secret);
  const cachedScore = embeddingCacheGet(embKey);
  if (cachedScore !== undefined) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Cache": "HIT",
        "Cache-Control": "private, max-age=86400",
      },
      body: JSON.stringify({ score: cachedScore }),
    };
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: [guess, secret],
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || errJson?.error?.code || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    console.error("OpenAI embeddings error:", res.status, detail);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `OpenAI API error (${res.status})`,
        detail: String(detail).slice(0, 500),
        fallback: true,
      }),
    };
  }

  const data = await res.json();
  const embeddings = (data.data || []).sort((a, b) => a.index - b.index);
  if (embeddings.length < 2) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Invalid embedding response from OpenAI",
        fallback: true,
      }),
    };
  }

  const score = cosineSimilarity(
    embeddings[0].embedding,
    embeddings[1].embedding
  );

  embeddingCacheSet(embKey, score);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Cache": "MISS",
      "Cache-Control": "private, max-age=86400",
    },
    body: JSON.stringify({ score }),
  };
};
