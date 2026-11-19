import pg from 'pg';
import { readFileSync } from 'node:fs';

const tables = /\b(FROM|INTO|UPDATE|JOIN) (users|sessions|login_limits|questions|settings|attempts|violations)\b/g;
const numericType = 20;
const types = {
  getTypeParser(oid, format) {
    return oid === numericType && format !== 'binary' ? Number : pg.types.getTypeParser(oid, format);
  },
};

export function postgresDatabase(pool) {
  function prepare(query) {
    // Only internal SQL reaches this adapter. Data values remain bind parameters.
    let position = 0;
    const text = query.replace(tables, '$1 mpk.$2').replace(/\?/g, () => '$' + ++position);
    const bind = (...values) => {
      const execute = runner => runner.query(text, values);
      return {
        execute,
        async first() { return (await execute(pool)).rows[0] ?? null; },
        async all() { return { results: (await execute(pool)).rows }; },
        async run() { return { meta: { changes: (await execute(pool)).rowCount } }; },
      };
    };
    return { ...bind(), bind };
  }
  return {
    prepare,
    questionOrder: 'position',
    cohortExpression: "body::jsonb->>'cohort'",
    async createSession({ sessionHash, userId, expires, limitKey, now }) {
      await pool.query(`WITH expired AS (DELETE FROM mpk.sessions WHERE expires<=$1),
        cleared AS (DELETE FROM mpk.login_limits WHERE key=$2)
        INSERT INTO mpk.sessions (token, user_id, expires) VALUES ($3,$4,$5)`, [now, limitKey, sessionHash, userId, expires]);
    },
    async batch(statements, options = {}) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN');
        if (options.questionLimit) await client.query('LOCK TABLE mpk.questions IN SHARE ROW EXCLUSIVE MODE');
        for (const statement of statements) await statement.execute(client);
        if (options.questionLimit) {
          const { rows: [count] } = await client.query('SELECT count(*) AS total FROM mpk.questions');
          if (Number(count.total) > options.questionLimit) throw Object.assign(new Error('Bank soal penuh.'), { code: 'QUESTION_LIMIT' });
        }
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); }
        catch { discard = true; }
        throw error;
      } finally {
        client.release(discard);
      }
    },
  };
}

export function supabasePool(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: url.href,
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(new URL('./certificates/supabase-ca.crt', import.meta.url), 'utf8'),
    },
    types,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    allowExitOnIdle: true,
  });
  pool.on('error', () => console.error('Koneksi PostgreSQL yang menganggur terputus.'));
  return pool;
}
