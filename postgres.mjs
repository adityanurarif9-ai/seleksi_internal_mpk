import pg from 'pg';

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
    async batch(statements) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN');
        for (const statement of statements) await statement.execute(client);
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
    ssl: { rejectUnauthorized: true },
    types,
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    allowExitOnIdle: true,
  });
  pool.on('error', () => console.error('Koneksi PostgreSQL yang menganggur terputus.'));
  return pool;
}
