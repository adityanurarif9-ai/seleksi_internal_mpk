import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresDatabase } from '../postgres.mjs';

test('temporary connection saturation retries acquisition without repeating a write', async () => {
  let connections = 0, writes = 0, releases = 0;
  const pool = {
    async connect() {
      if (++connections < 3) throw Object.assign(new Error('Connection limit'), { code: '53300' });
      return { async query() { writes++; return { rowCount: 1, rows: [] }; }, release() { releases++; } };
    },
  };
  const result = await postgresDatabase(pool).prepare('INSERT INTO questions (id,body) VALUES (?,?)').bind('test-id', '{}').run();
  assert.equal(result.meta.changes, 1);
  assert.equal(connections, 3); assert.equal(writes, 1); assert.equal(releases, 1);
});

test('a connection loss during a query never replays the write and always releases the client', async () => {
  let connections = 0, writes = 0, releases = 0;
  const pool = { async connect() { connections++; return {
    async query() { writes++; throw Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }); },
    release() { releases++; },
  }; } };
  await assert.rejects(postgresDatabase(pool).prepare('UPDATE attempts SET submitted=? WHERE user_id=?').bind(123, 'test-user').run(), { code: 'ECONNRESET' });
  assert.equal(connections, 1); assert.equal(writes, 1); assert.equal(releases, 1);
});
