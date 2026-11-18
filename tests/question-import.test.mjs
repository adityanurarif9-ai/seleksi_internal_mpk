import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalEnvironment } from '../local.mjs';
import worker from '../worker.mjs';

test('question import is authorized, validated, atomic, retryable, and filtered by cohort', async () => {
  const env = createLocalEnvironment(':memory:', crypto.randomUUID());
  const origin = 'https://portal.test';
  let cookie = '';
  async function api(path, body, session = cookie) {
    const response = await worker.fetch(new Request(origin + '/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: session },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    const data = await response.json();
    return { response, data };
  }
  const question = (cohort = 'X') => ({ id: crypto.randomUUID(), cohort, prompt: 'Contoh soal ' + crypto.randomUUID(), type: 'choice', options: ['A', 'B', 'C', 'D'], correct: 2, points: 10 });
  try {
    assert.equal((await api('admin/questions/import', { rows: [question()] })).response.status, 401);
    const login = await api('login', { username: 'admin', password: env.ADMIN_PASSWORD, role: 'admin' });
    cookie = login.response.headers.get('Set-Cookie').split(';')[0];
    const rows = [question(), { ...question('XI'), type: 'essay' }];
    let result = await api('admin/questions/import', { rows });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.count, 2);
    assert.equal((await api('admin/dashboard')).data.questions.length, 2);
    assert.equal((await api('admin/questions/import', { rows })).response.status, 200);
    assert.equal((await api('admin/dashboard')).data.questions.length, 2, 'retry must not duplicate questions');
    assert.equal((await api('admin/questions/import', { rows: [question(), { ...question(), correct: 8 }] })).response.status, 400);
    assert.equal((await api('admin/dashboard')).data.questions.length, 2, 'invalid batch must not write any rows');
    assert.equal((await api('admin/questions/import', { rows: [{ ...question(), cohort: 'XII' }] })).response.status, 400);
    assert.equal((await api('admin/questions/import', { rows: [{ ...rows[0], prompt: 'Changed content' }] })).response.status, 409);
    const duplicate = question();
    assert.equal((await api('admin/questions/import', { rows: [duplicate, duplicate] })).response.status, 400);
    const participantPassword = crypto.randomUUID();
    await api('admin/participants', { username: 'test-x', password: participantPassword, name: 'Peserta X', class: 'X PPLG 1', cohort: 'X' });
    const participantLogin = await api('login', { username: 'test-x', password: participantPassword, role: 'participant' });
    const participantCookie = participantLogin.response.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await api('admin/questions/import', { rows: [question()] }, participantCookie)).response.status, 403);
    await api('admin/settings', { duration: 30, open: true });
    const attempt = await api('exam/start', {}, participantCookie);
    assert.equal(attempt.response.status, 200);
    assert.equal(attempt.data.attempt.items.length, 1);
    assert.equal(attempt.data.attempt.items[0].cohort, 'X');
    assert.equal(attempt.data.attempt.items[0].correct, undefined, 'answer keys must not leak to participants');
    assert.equal((await api('admin/questions/import', { rows: Array.from({ length: 98 }, () => question()) })).response.status, 200);
    assert.equal((await api('admin/questions/import', { rows: [question(), question()] })).response.status, 409);
    assert.equal((await api('admin/dashboard')).data.questions.length, 100, 'capacity failure must roll back all inserted rows');
    assert.equal((await api('exam', undefined, participantCookie)).data.attempt.items.length, 1, 'started exam snapshot must remain unchanged');
  } finally { env.close(); }
});
