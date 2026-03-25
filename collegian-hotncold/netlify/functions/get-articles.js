const { Client } = require("pg");

exports.handler = async (event, context) => {
  const client = new Client({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const result = await client.query(`
      SELECT guid as id, title as headline, url as link, author, image_url as image
      FROM articles 
      WHERE pub_date > NOW() - INTERVAL '7 days'
      AND image_url IS NOT NULL
      ORDER BY pub_date DESC
    `);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.rows),
    };
  } catch (err) {
    console.error("get-articles:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: err.message || "Database error",
        detail: process.env.NETLIFY_DEV ? String(err) : undefined,
      }),
    };
  } finally {
    await client.end();
  }
};
