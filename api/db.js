const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS precos (
        key TEXT PRIMARY KEY,
        dados JSONB NOT NULL,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS depoimentos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        cidade TEXT,
        texto TEXT NOT NULL,
        ordem INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('✅ Banco inicializado');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
