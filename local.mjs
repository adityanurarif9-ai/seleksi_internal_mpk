import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import worker from './worker.mjs';

export function createLocalEnvironment(filename = ':memory:', password) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
  const migrations = ['0000_portal', '0001_cohorts_and_violations'];
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const { user_version: version } = sqlite.prepare('PRAGMA user_version').get();
    // Databases created by the original local server already have the base schema.
    const hasBase = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='settings' AND type='table'").get();
    for (const tag of migrations.slice(hasBase ? Math.max(1, version) : 0)) {
      sqlite.exec(readFileSync(new URL('./drizzle/' + tag + '.sql', import.meta.url), 'utf8'));
    }
    if (version < migrations.length) sqlite.exec('PRAGMA user_version = ' + migrations.length);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    sqlite.close();
    throw error;
  }
  const db = {
    prepare(query) {
      const statement = sqlite.prepare(query);
      const bind = (...args) => ({
        first: () => statement.get(...args) ?? null,
        all: () => ({ results: statement.all(...args) }),
        run: () => ({ meta: { changes: statement.run(...args).changes } }),
      });
      return { ...bind(), bind };
    },
    batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const assets = {};
  for (const [url, file, type] of [
    ['/', 'index.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css'],
    ['/mark.svg', 'mark.svg', 'image/svg+xml'],
    ['/favicon-mpk.svg', 'favicon-mpk.svg', 'image/svg+xml'],
    ['/logo-mpk.png', 'logo-mpk.png', 'image/png'],
    ['/exam-atmosphere.jpg', 'exam-atmosphere.jpg', 'image/jpeg'],
  ]) {
    const encoding = type === 'image/png' || type === 'image/jpeg' ? undefined : 'utf8';
    assets[url] = [type, readFileSync(new URL('./web/' + file, import.meta.url), encoding)];
  }
  return { DB: db, ASSETS: assets, ADMIN_PASSWORD: password, close: () => sqlite.close(), hasAdmin: () => !!sqlite.prepare("SELECT 1 FROM users WHERE role='admin'").get() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const temporary = process.argv.includes('--preview');
  const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
  const env = createLocalEnvironment(temporary ? ':memory:' : new URL('./portal.sqlite', import.meta.url), password);
  const port = Number(process.env.MPK_PORT || 4385);
  const origin = 'http://127.0.0.1:' + port;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method;
      const chunks = [];
      let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > 350000) {
          outgoing.writeHead(413).end('Data terlalu besar.');
          return;
        }
        chunks.push(chunk);
      }
      const response = await worker.fetch(new Request(new URL(incoming.url, origin), {
        method,
        headers: incoming.headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks),
      }), env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error.message);
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end('Terjadi gangguan.');
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('Portal MPK: ' + origin);
    if (!env.hasAdmin() && !process.env.ADMIN_PASSWORD) {
      console.log('ID admin: admin');
      console.log('Kata sandi awal untuk server ini: ' + password);
    }
  });
}
