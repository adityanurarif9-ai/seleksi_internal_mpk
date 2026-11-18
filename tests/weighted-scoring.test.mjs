import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalEnvironment } from '../local.mjs';
import worker from '../worker.mjs';

test('every choice awards its configured points and existing attempt scores remain stable', async () => {
  const env = createLocalEnvironment(':memory:', crypto.randomUUID());
  let adminCookie = '';
  async function api(path, body, cookie = adminCookie) {
    const response = await worker.fetch(new Request('https://portal.test/api/' + path, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: 'https://portal.test', Cookie: cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    return { status: response.status, cookie: response.headers.get('Set-Cookie')?.split(';')[0], data: await response.json() };
  }
  try {
    adminCookie = (await api('login', { username: 'admin', password: env.ADMIN_PASSWORD, role: 'admin' })).cookie;
    const weighted = { id: crypto.randomUUID(), type: 'choice', prompt: 'Bagaimana kamu menanggapi usulan?', options: ['A', 'B', 'C', 'D'], optionPoints: [2, 6, 9, 4], points: 999, cohort: 'X' };
    const equal = { ...weighted, id: crypto.randomUUID(), prompt: 'Semua opsi berbobot sama', optionPoints: [5, 5, 5, 5] };
    const essay = { id: crypto.randomUUID(), type: 'essay', prompt: 'Jelaskan alasanmu.', points: 25, cohort: 'X' };
    assert.equal((await api('admin/questions/import', { rows: [weighted, equal, essay] })).status, 200);
    const bank = (await api('admin/dashboard')).data.questions;
    assert.equal(bank.find(q => q.id === weighted.id).points, 9, 'maximum must be derived server-side');
    assert.equal(bank.find(q => q.id === weighted.id).correct, undefined);
    for (const invalid of [[2, 6, 9], [2, '', 9, 4], [2, null, 9, 4], [2, -1, 9, 4], [2, 6.5, 9, 4], [2, 1001, 9, 4]]) {
      assert.equal((await api('admin/questions', { ...weighted, id: undefined, optionPoints: invalid })).status, 400);
    }
    await api('admin/settings', { duration: 30, open: true });
    const users = [];
    for (let index = 0; index < 5; index++) {
      const password = crypto.randomUUID(), username = 'weighted-' + index;
      assert.equal((await api('admin/participants', { username, password, name: 'Peserta ' + index, class: 'X PPLG 1', cohort: 'X' })).status, 201);
      const login = await api('login', { username, password, role: 'participant' });
      users.push(login.data.user.id);
      const attempt = (await api('exam/start', {}, login.cookie)).data.attempt;
      assert.equal(attempt.items.find(q => q.id === weighted.id).points, 9);
      assert(attempt.items.every(q => !('optionPoints' in q) && !('correct' in q)));
      const answers = index < 4 ? { [weighted.id]: index, [equal.id]: 3, [essay.id]: 'Penjelasan peserta' } : {};
      assert.equal((await api('exam/answers', { answers, submit: true }, login.cookie)).status, 200);
      let row = (await api('admin/dashboard')).data.results.find(r => r.userId === login.data.user.id);
      const expected = index < 4 ? weighted.optionPoints[index] + 5 : 0;
      assert.equal(row.score, expected); assert.equal(row.max, 39); assert.equal(row.pending, true);
      await api('admin/review', { userId: row.userId, points: { [essay.id]: index < 4 ? 12 : 0 } });
      row = (await api('admin/dashboard')).data.results.find(r => r.userId === row.userId);
      assert.equal(row.score, expected + (index < 4 ? 12 : 0)); assert.equal(row.pending, false);
    }
    await api('admin/questions', { ...weighted, optionPoints: [100, 100, 100, 100] });
    const rows = (await api('admin/dashboard')).data.results;
    assert.equal(rows.find(r => r.userId === users[0]).score, 19, 'editing the bank must not regrade existing snapshots');
    const legacy = { id: 'old-question', type: 'choice', prompt: 'Soal lama', options: ['A', 'B', 'C', 'D'], correct: 1, points: 10, cohort: 'X' };
    await env.DB.prepare('UPDATE attempts SET snapshot=?, answers=?, review=NULL WHERE user_id=?').bind(JSON.stringify([legacy]), JSON.stringify({ [legacy.id]: 1 }), users[4]).run();
    const historical = (await api('admin/dashboard')).data.results.find(r => r.userId === users[4]);
    assert.equal(historical.score, 10); assert.equal(historical.max, 10);
  } finally { env.close(); }
});
