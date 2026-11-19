import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalEnvironment } from '../local.mjs';
import worker from '../worker.mjs';

function harness() {
  const env = createLocalEnvironment(':memory:', crypto.randomUUID());
  env.CLIENT_IP = 'school-shared-network';
  let cookie = '', queries = 0;
  const original = env.DB.prepare;
  const wrap = statement => ({
    bind: (...args) => wrap(statement.bind(...args)),
    first: () => { queries++; return statement.first(); },
    all: () => { queries++; return statement.all(); },
    run: () => { queries++; return statement.run(); },
  });
  env.DB.prepare = sql => wrap(original(sql));
  const api = async (path, body, session = cookie) => {
    const response = await worker.fetch(new Request('https://portal.test/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://portal.test', Cookie: session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: response.status, data: await response.json(), cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
  };
  return { env, api, setCookie: value => { cookie = value; }, reset: () => { queries = 0; }, count: () => queries };
}

test('50 concurrent participants can log in, resume, save, and submit without mixing or overwriting answers', async () => {
  const h = harness();
  try {
    h.setCookie((await h.api('login', { username: 'admin', password: h.env.ADMIN_PASSWORD, role: 'admin' })).cookie);
    const questions = ['X', 'XI'].flatMap(cohort => Array.from({ length: 20 }, (_, i) => ({
      id: crypto.randomUUID(), cohort, prompt: 'Pertanyaan simulasi ' + i,
      ...(i % 5 === 0 ? { type: 'essay', points: 20 } : { type: 'choice', options: ['A', 'B', 'C', 'D'], optionPoints: [2, 6, 10, 8] }),
    })));
    assert.equal((await h.api('admin/questions/import', { rows: questions })).status, 200);
    const rows = Array.from({ length: 50 }, (_, i) => ({ username: 'load-' + i, name: 'Peserta Simulasi ' + i, password: crypto.randomUUID(), class: i < 25 ? 'X PPLG 1' : 'XI PPLG 1', cohort: i < 25 ? 'X' : 'XI' }));
    assert.equal((await h.api('admin/participants/import', { rows })).status, 200);
    await h.api('admin/settings', { duration: 45, open: true });
    const logins = await Promise.all(rows.map(r => h.api('login', { username: r.username, password: r.password, role: 'participant' })));
    assert(logins.every(r => r.status === 200));
    const starts = await Promise.all(logins.map(r => h.api('exam/start', {}, r.cookie)));
    assert(starts.every(r => r.status === 200 && r.data.attempt.items.length === 20));
    starts.forEach((r, i) => assert(r.data.attempt.items.every(q => q.cohort === rows[i].cohort && !('optionPoints' in q))));
    const answers = rows.map((_, i) => Object.fromEntries(starts[i].data.attempt.items.map(q => [q.id, q.type === 'essay' ? 'Esai khusus peserta ' + i : i % 4])));
    h.reset();
    const saved = await Promise.all(logins.map((r, i) => h.api('exam/answers', { answers: answers[i] }, r.cookie)));
    assert(saved.every(r => r.status === 200 && !r.data.attempt.submitted));
    assert(saved.every(r => !('items' in r.data.attempt) && !('answers' in r.data.attempt)), 'autosave must return a small acknowledgement');
    assert(h.count() <= 150, '50 autosaves must not need more than 150 database operations');
    const reloaded = await Promise.all(logins.map(r => h.api('exam', undefined, r.cookie)));
    reloaded.forEach((r, i) => { assert.equal(r.status, 200); assert.deepEqual(r.data.attempt.answers, answers[i]); assert.equal(r.data.settings.total, 20); });
    const submitted = await Promise.all(logins.map((r, i) => h.api('exam/answers', { answers: answers[i], submit: true }, r.cookie)));
    assert(submitted.every(r => r.status === 200 && r.data.attempt.submitted));
    const retries = await Promise.all(logins.map(r => h.api('exam/answers', { answers: {}, submit: false }, r.cookie)));
    assert(retries.every(r => r.status === 200 && r.data.attempt.submitted), 'stale autosaves must never reopen a submitted exam');
    const dashboard = (await h.api('admin/dashboard')).data;
    logins.forEach((r, i) => {
      const result = dashboard.results.find(item => item.userId === r.data.user.id);
      assert.deepEqual(result.answers, answers[i]);
      assert.equal(result.score, 16 * [2, 6, 10, 8][i % 4]);
      assert.equal(result.max, 240);
    });
  } finally { h.env.close(); }
});

test('expiry during autosave retains saved work and final submissions are immutable', async () => {
  const h = harness();
  try {
    h.setCookie((await h.api('login', { username: 'admin', password: h.env.ADMIN_PASSWORD, role: 'admin' })).cookie);
    const q = { id: crypto.randomUUID(), type: 'choice', cohort: 'X', prompt: 'Simulasi waktu habis', options: ['A', 'B', 'C', 'D'], optionPoints: [2, 6, 10, 8] };
    await h.api('admin/questions/import', { rows: [q] });
    const password = crypto.randomUUID();
    await h.api('admin/participants', { username: 'expiry-user', password, name: 'Simulasi', class: 'X PPLG 1', cohort: 'X' });
    await h.api('admin/settings', { duration: 45, open: true });
    const login = await h.api('login', { username: 'expiry-user', password, role: 'participant' });
    await h.api('exam/start', {}, login.cookie);
    await h.api('exam/answers', { answers: { [q.id]: 1 } }, login.cookie);
    const prepare = h.env.DB.prepare;
    let expire = true;
    h.env.DB.prepare = sql => {
      if (expire && sql.startsWith('UPDATE attempts SET answers=')) {
        expire = false;
        prepare('UPDATE attempts SET deadline=? WHERE user_id=?').bind(Date.now() - 1, login.data.user.id).run();
      }
      return prepare(sql);
    };
    const late = await h.api('exam/answers', { answers: { [q.id]: 2 }, submit: true }, login.cookie);
    assert.equal(late.status, 200); assert(late.data.attempt.submitted);
    const result = (await h.api('admin/dashboard')).data.results.find(r => r.userId === login.data.user.id);
    assert.equal(result.answers[q.id], 1); assert.equal(result.score, 6);
  } finally { h.env.close(); }
});

test('account brute-force protection remains active on a shared school network', async () => {
  const h = harness();
  try {
    for (let i = 0; i < 12; i++) assert.equal((await h.api('login', { username: 'unknown-account', password: 'invalid-password', role: 'participant' })).status, 401);
    assert.equal((await h.api('login', { username: 'unknown-account', password: 'invalid-password', role: 'participant' })).status, 429);
  } finally { h.env.close(); }
});
