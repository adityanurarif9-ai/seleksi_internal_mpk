const HOUR = 3600000;
const secureHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
};

function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { ...secureHeaders, 'Cache-Control': 'no-store', ...extra } });
}

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const token = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const hash = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function passwordHash(value, salt = token()) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return salt + '.' + hex(result);
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

const parse = JSON.parse;
const stringify = JSON.stringify;
const userFields = 'id, username, name, class, role, cohort';

async function currentUser(db, raw) {
  if (!/^[0-9a-f]{48}$/.test(raw)) return null;
  return db.prepare('SELECT u.id, u.username, u.name, u.class, u.role, u.cohort FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?')
    .bind(await hash(raw), Date.now()).first();
}

async function settings(db, cohort) {
  const filter = cohort !== undefined;
  const clause = filter ? ' WHERE ' + (db.cohortExpression ?? "json_extract(body, '$.cohort')") + '=?' : '';
  return db.prepare('SELECT duration, is_open, (SELECT count(*) FROM questions' + clause + ') AS total FROM settings WHERE id=1')
    .bind(...(filter ? [cohort ?? ''] : [])).first();
}

async function questions(db, cohort) {
  const clause = cohort === undefined ? '' : ' WHERE ' + (db.cohortExpression ?? "json_extract(body, '$.cohort')") + '=?';
  const data = await db.prepare('SELECT body FROM questions' + clause + ' ORDER BY ' + (db.questionOrder ?? 'rowid'))
    .bind(...(cohort === undefined ? [] : [cohort])).all();
  return data.results.map(q => parse(q.body));
}

function questionInput(input, id) {
  if (!input || typeof input !== 'object') fail('Format soal tidak valid.');
  const type = input.type;
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!['choice', 'essay'].includes(type) || !prompt || prompt.length > 1500) fail('Isi pertanyaan maksimal 1.500 karakter dan pilih jenis soal.');
  if (!['X', 'XI'].includes(input.cohort)) fail('Pilih kategori soal kelas X atau XI.');
  const item = { id, type, prompt, points: Number(input.points), cohort: input.cohort };
  if (type === 'choice') {
    const options = Array.isArray(input.options) ? input.options.map(value => typeof value === 'string' ? value.trim() : '') : [];
    const optionPoints = Array.isArray(input.optionPoints) ? input.optionPoints.map(value => !['string', 'number'].includes(typeof value) || String(value).trim() === '' ? NaN : Number(value)) : [];
    if (options.length !== 4 || options.some(value => !value || value.length > 500)) fail('Isi empat pilihan jawaban, masing-masing maksimal 500 karakter.');
    if (optionPoints.length !== 4 || optionPoints.some(value => !Number.isInteger(value) || value < 0 || value > 1000)) fail('Isi bobot A–D dengan bilangan bulat 0–1.000.');
    Object.assign(item, { options, optionPoints, points: Math.max(...optionPoints) });
  } else if (!Number.isInteger(item.points) || item.points < 1 || item.points > 100) fail('Bobot esai harus bilangan bulat 1–100.');
  return item;
}

async function attempt(db, id) {
  const now = Date.now();
  const load = () => db.prepare("SELECT attempts.*, (SELECT count(*) FROM violations WHERE violations.user_id=attempts.user_id) AS violation_count, (SELECT count(*) FROM violations WHERE violations.user_id=attempts.user_id AND kind='tab-hidden') AS tab_exit_count FROM attempts WHERE user_id=?")
    .bind(id).first();
  const row = await load();
  if (!row || row.submitted || row.deadline > now) return row;
  const expired = await db.prepare('UPDATE attempts SET submitted=deadline WHERE user_id=? AND submitted IS NULL AND deadline<=? RETURNING *').bind(id, now).first();
  return expired ? { ...row, ...expired } : load();
}

function grade(items, answers, review) {
  const max = items.reduce((sum, item) => sum + item.points, 0);
  const score = items.reduce((sum, item) => {
    if (item.type === 'essay') return sum + (review?.points[item.id] ?? 0);
    const selected = answers[item.id];
    if (!Number.isInteger(selected) || selected < 0 || selected >= item.options.length) return sum;
    return sum + (Array.isArray(item.optionPoints) ? item.optionPoints[selected] : selected === item.correct ? item.points : 0);
  }, 0);
  return { score, max, pending: items.some(item => item.type === 'essay') && !review };
}

function publicAttempt(row, includeAnswers = true) {
  if (!row) return null;
  const items = parse(row.snapshot);
  const base = { started: row.started, deadline: row.deadline, submitted: row.submitted, count: items.length, violationCount: row.violation_count, tabExitCount: row.tab_exit_count };
  if (row.submitted || !includeAnswers) return base;
  return { ...base, items: items.map(({ correct, optionPoints, ...item }) => item), answers: parse(row.answers) };
}

function answersFor(items, input) {
  const answers = {};
  for (const item of items) {
    const value = input?.[item.id];
    if (item.type === 'essay' && typeof value === 'string') answers[item.id] = value.slice(0, 3000);
    if (item.type === 'choice' && Number.isInteger(value) && value >= 0 && value < item.options.length) answers[item.id] = value;
  }
  return answers;
}

function field(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function participantInput(input) {
  const username = field(input.username, 60).toLowerCase();
  const name = field(input.name, 100);
  const className = field(input.class, 40);
  const password = typeof input.password === 'string' ? input.password : '';
  if (!/^[a-z0-9._-]{3,60}$/.test(username) || username === 'admin') fail('ID peserta harus 3–60 karakter, berupa huruf, angka, titik, strip, atau garis bawah.');
  if (!name || !className || password.length < 8 || password.length > 150) fail('Isi nama dan rombel, lalu gunakan kata sandi 8–150 karakter.');
  if (!['X', 'XI'].includes(input.cohort)) fail('Pilih tingkat kelas X atau XI.');
  return { username, name, className, password, cohort: input.cohort };
}

async function limit(db, key, max) {
  const window = Math.floor(Date.now() / (10 * 60000));
  const { hits } = await db.prepare('INSERT INTO login_limits (key, "window", hits) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN login_limits."window"=excluded."window" THEN login_limits.hits+1 ELSE 1 END, "window"=excluded."window" RETURNING hits')
    .bind(await hash(key), window).first();
  if (hits > max) fail('Terlalu banyak percobaan. Coba lagi dalam beberapa menit.', 429);
}

async function api(request, env, path) {
  const db = env.DB;
  const url = new URL(request.url);
  const method = request.method;
  const raw = request.headers.get('Cookie')?.match(/(?:^|;\s*)mpk_session=([^;]+)/)?.[1] ?? '';
  const cookie = 'Path=/; HttpOnly; SameSite=Lax' + (url.protocol === 'https:' ? '; Secure' : '');
  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) fail('Asal permintaan tidak valid.', 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('Format permintaan tidak valid.', 415);
  }
  const body = async () => {
    const content = await request.text();
    if (content.length > 600000) fail('Data terlalu besar.', 413);
    try { return parse(content) ?? {}; } catch { fail('Data tidak valid.'); }
  };
  if (path === '/api/login' && method === 'POST') {
    const input = await body();
    const username = field(input.username, 60).toLowerCase();
    const password = typeof input.password === 'string' ? input.password : '';
    if (!username || !password || password.length > 150) fail('Isi ID akun dan kata sandi.');
    // A school network can put all 50 participants behind one public address.
    await limit(db, 'ip:' + (env.CLIENT_IP ?? request.headers.get('CF-Connecting-IP') ?? 'local'), 300);
    await limit(db, 'account:' + username, 12);
    let row = await db.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
    if (!row && username === 'admin' && env.ADMIN_PASSWORD && equal(password, env.ADMIN_PASSWORD)) {
      await db.prepare("INSERT INTO users (id, username, name, class, password, role) VALUES (?,?,?,'',?,'admin') ON CONFLICT (username) DO NOTHING")
        .bind(crypto.randomUUID(), username, 'Panitia MPK', await passwordHash(password)).run();
      row = await db.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
    }
    const candidate = await passwordHash(password, row?.password.split('.')[0] ?? 'unregistered');
    if (!row || !equal(candidate, row.password) || row.role !== input.role) fail('ID akun, kata sandi, atau pilihan akses tidak sesuai.', 401);
    const session = token();
    const now = Date.now();
    const [sessionHash, limitKey] = await Promise.all([hash(session), hash('account:' + username)]);
    if (db.createSession) await db.createSession({ sessionHash, userId: row.id, expires: now + 12 * HOUR, limitKey, now });
    else await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now),
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(sessionHash, row.id, now + 12 * HOUR),
      db.prepare('DELETE FROM login_limits WHERE key=?').bind(limitKey),
    ]);
    const { password: _password, ...user } = row;
    return json({ user }, 200, { 'Set-Cookie': 'mpk_session=' + session + '; ' + cookie + '; Max-Age=43200' });
  }
  const user = await currentUser(db, raw);
  if (path === '/api/me') {
    if (method === 'GET') return json({ user });
    return json({ error: 'Profil hanya dapat dilihat.' }, 405, { Allow: 'GET' });
  }
  if (!user) fail('Sesi berakhir. Silakan masuk kembali.', 401);
  if (path === '/api/logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token=?').bind(await hash(raw)).run();
    return json({}, 200, { 'Set-Cookie': 'mpk_session=; ' + cookie + '; Max-Age=0' });
  }
  if (path.startsWith('/api/admin/')) {
    if (user.role !== 'admin') fail('Akses khusus panitia.', 403);
    return admin(db, path, method, body);
  }
  if (user.role !== 'participant') fail('Akses khusus peserta.', 403);
  if (path === '/api/exam' && method === 'GET') {
    const [config, row] = await Promise.all([settings(db, user.cohort), attempt(db, user.id)]);
    return json({ settings: config, attempt: publicAttempt(row), now: Date.now() });
  }
  if (path === '/api/exam/start' && method === 'POST') {
    const existing = await attempt(db, user.id);
    if (existing) return json({ attempt: publicAttempt(existing), now: Date.now() });
    const config = await settings(db);
    if (!['X', 'XI'].includes(user.cohort)) fail('Tingkat kelas belum ditentukan. Hubungi panitia.', 409);
    const items = await questions(db, user.cohort);
    if (!config.is_open || !items.length) fail('Soal ujian untuk kelasmu belum tersedia atau ujian belum dibuka.', 409);
    const now = Date.now();
    await db.prepare('INSERT INTO attempts (user_id,snapshot,started,deadline) SELECT ?,?,?,? WHERE (SELECT is_open FROM settings WHERE id=1)=1 ON CONFLICT (user_id) DO NOTHING')
      .bind(user.id, stringify(items), now, now + config.duration * 60000).run();
    const started = await attempt(db, user.id);
    if (!started) fail('Ujian telah ditutup oleh panitia.', 409);
    return json({ attempt: publicAttempt(started), now: Date.now() });
  }
  if (path === '/api/exam/answers' && method === 'POST') {
    const input = await body();
    let row = await attempt(db, user.id);
    if (!row) fail('Mulai ujian terlebih dahulu.', 409);
    if (!row.submitted) {
      const now = Date.now();
      const answers = stringify(answersFor(parse(row.snapshot), input.answers));
      const updated = await db.prepare('UPDATE attempts SET answers=?, submitted=? WHERE user_id=? AND submitted IS NULL AND deadline>? RETURNING *')
        .bind(answers, input.submit === true ? now : null, user.id, now).first();
      row = updated ? { ...row, ...updated } : await attempt(db, user.id);
    }
    // Autosave only acknowledges the write; the browser already has its questions and answers.
    return json({ attempt: publicAttempt(row, false), now: Date.now() });
  }
  if (path === '/api/exam/violations' && method === 'POST') {
    const { id, kind, at, started } = await body();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || !['tab-hidden', 'fullscreen-exit'].includes(kind) ||
        !Number.isSafeInteger(at) || !Number.isSafeInteger(started)) fail('Catatan pelanggaran tidak valid.');
    const now = Date.now();
    const row = await attempt(db, user.id);
    if (!row || row.started !== started) fail('Percobaan ujian tidak ditemukan.', 409);
    const end = row.submitted ?? Math.min(now, row.deadline);
    // The clock offset is estimated from the server response and can differ slightly in transit.
    if (now <= row.deadline + 24 * HOUR && at >= row.started - 2000 && at <= end + 2000) {
      await db.prepare("INSERT INTO violations (user_id, event_id, kind, occurred_at) VALUES (?,?,?,?) ON CONFLICT (user_id, event_id) DO UPDATE SET kind=excluded.kind WHERE violations.kind='fullscreen-exit' AND excluded.kind='tab-hidden'")
        .bind(user.id, id, kind, Math.max(row.started, Math.min(end, at))).run();
    }
    const counts = await db.prepare("SELECT count(*) AS total, count(*) FILTER (WHERE kind='tab-hidden') AS tab_exits FROM violations WHERE user_id=?")
      .bind(user.id).first();
    return json({ total: counts.total, tabExitCount: counts.tab_exits });
  }
  fail('Halaman tidak ditemukan.', 404);
}

async function admin(db, path, method, body) {
  if (path === '/api/admin/dashboard' && method === 'GET') {
    const now = Date.now();
    await db.prepare('UPDATE attempts SET submitted=deadline WHERE submitted IS NULL AND deadline<=?').bind(now).run();
    const users = await db.prepare("SELECT " + userFields + " FROM users WHERE role='participant' ORDER BY name").all();
    const attempts = await db.prepare('SELECT attempts.*, (SELECT count(*) FROM violations WHERE violations.user_id=attempts.user_id) AS violation_count FROM attempts ORDER BY started DESC').all();
    const results = attempts.results.map(row => {
      const items = parse(row.snapshot);
      const answers = parse(row.answers);
      const review = row.review ? parse(row.review) : null;
      return { userId: row.user_id, started: row.started, submitted: row.submitted, violationCount: row.violation_count, ...(row.submitted ? { items, answers, review, ...grade(items, answers, review) } : {}) };
    });
    return json({ settings: await settings(db), questions: await questions(db), participants: users.results, results });
  }
  if (path === '/api/admin/violations' && method === 'POST') {
    const { userId } = await body();
    const result = await db.prepare('SELECT kind, occurred_at AS at FROM violations WHERE user_id=? ORDER BY occurred_at DESC, event_id DESC')
      .bind(field(userId, 80)).all();
    return json({ violations: result.results });
  }
  if (path === '/api/admin/settings' && method === 'POST') {
    const input = await body();
    const duration = Number(input.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 240) fail('Durasi harus antara 1 dan 240 menit.');
    if (input.open && !(await settings(db)).total) fail('Tambahkan setidaknya satu soal untuk membuka ujian.');
    await db.prepare('UPDATE settings SET duration=?, is_open=? WHERE id=1').bind(duration, input.open === true ? 1 : 0).run();
    return json({});
  }
  if (path === '/api/admin/participants' && method === 'POST') {
    const { username, name, className, password, cohort } = participantInput(await body());
    const result = await db.prepare("INSERT INTO users (id, username, name, class, password, role, cohort) VALUES (?,?,?,?,?,'participant',?) ON CONFLICT (username) DO NOTHING")
      .bind(crypto.randomUUID(), username, name, className, await passwordHash(password), cohort).run();
    if (!result.meta.changes) fail('ID peserta sudah digunakan.', 409);
    return json({}, 201);
  }
  if (path === '/api/admin/participants/import' && method === 'POST') {
    const input = await body();
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 50) fail('Impor 1–50 peserta sekaligus.');
    const rows = input.rows.map(participantInput);
    if (new Set(rows.map(row => row.username)).size !== rows.length) fail('Ada ID peserta yang berulang dalam daftar.');
    const inserts = [];
    for (const row of rows) {
      const existing = await db.prepare('SELECT * FROM users WHERE username=?').bind(row.username).first();
      if (existing) {
        const samePassword = equal(await passwordHash(row.password, existing.password.split('.')[0]), existing.password);
        if (existing.role !== 'participant' || existing.name !== row.name || existing.class !== row.className || existing.cohort !== row.cohort || !samePassword) {
          fail('ID ' + row.username + ' sudah digunakan. Periksa daftar sebelum mengimpor.', 409);
        }
        continue;
      }
      inserts.push(db.prepare("INSERT INTO users (id, username, name, class, password, role, cohort) VALUES (?,?,?,?,?,'participant',?)")
        .bind(crypto.randomUUID(), row.username, row.name, row.className, await passwordHash(row.password), row.cohort));
    }
    if (inserts.length) {
      try { await db.batch(inserts); }
      catch (error) {
        if (error.code === '23505' || /UNIQUE constraint failed/i.test(error.message)) fail('Daftar akun berubah saat impor. Coba lagi dengan daftar yang sama.', 409);
        throw error;
      }
    }
    return json({ count: rows.length, created: inserts.length });
  }
  if (path === '/api/admin/participants/class' && method === 'POST') {
    const input = await body();
    const className = field(input.class, 40);
    if (!className || !['X', 'XI'].includes(input.cohort)) fail('Isi rombel dan pilih tingkat kelas X atau XI.');
    const result = await db.prepare("UPDATE users SET class=?, cohort=? WHERE id=? AND role='participant'")
      .bind(className, input.cohort, field(input.id, 80)).run();
    if (!result.meta.changes) fail('Peserta tidak ditemukan.', 404);
    return json({});
  }
  if (path === '/api/admin/questions' && method === 'POST') {
    const input = await body();
    const existing = typeof input.id === 'string' && input.id;
    const id = existing || crypto.randomUUID();
    const item = questionInput(input, id);
    if (existing) {
      const result = await db.prepare('UPDATE questions SET body=? WHERE id=?').bind(stringify(item), id).run();
      if (!result.meta.changes) fail('Soal sudah dihapus.', 404);
    } else {
      const result = await db.prepare('INSERT INTO questions (id, body) SELECT ?,? WHERE (SELECT count(*) FROM questions)<100').bind(id, stringify(item)).run();
      if (!result.meta.changes) fail('Bank soal sudah mencapai 100 soal.', 409);
    }
    return json({});
  }
  if (path === '/api/admin/questions/import' && method === 'POST') {
    const input = await body();
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 100) fail('Impor 1–100 soal sekaligus.');
    const rows = input.rows.map((row, i) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row?.id ?? '')) fail('ID soal ' + (i + 1) + ' tidak valid. Unggah ulang berkas.');
      try { return questionInput(row, row.id); }
      catch (error) { fail('Soal ' + (i + 1) + ': ' + error.message); }
    });
    if (new Set(rows.map(q => q.id)).size !== rows.length) fail('Ada ID soal yang berulang. Unggah ulang berkas.');
    const existing = new Map((await questions(db)).map(q => [q.id, q]));
    const inserts = [];
    for (const row of rows) {
      if (existing.has(row.id)) {
        if (stringify(questionInput(existing.get(row.id), row.id)) !== stringify(row)) fail('Daftar soal berubah. Unggah ulang berkas.', 409);
      } else inserts.push(db.prepare('INSERT INTO questions (id, body) VALUES (?,?) ON CONFLICT (id) DO NOTHING').bind(row.id, stringify(row)));
    }
    if (inserts.length) {
      try { await db.batch(inserts, { questionLimit: 100 }); }
      catch (error) {
        if (error.code === 'QUESTION_LIMIT') fail('Bank soal maksimal 100 soal. Kurangi jumlah soal yang diimpor.', 409);
        throw error;
      }
    }
    return json({ count: rows.length });
  }
  if (path === '/api/admin/questions/delete' && method === 'POST') {
    const { id } = await body();
    await db.batch([
      db.prepare('DELETE FROM questions WHERE id=?').bind(field(id, 80)),
      db.prepare('UPDATE settings SET is_open=0 WHERE NOT EXISTS (SELECT 1 FROM questions)'),
    ]);
    return json({});
  }
  if (path === '/api/admin/review' && method === 'POST') {
    const input = await body();
    const row = await attempt(db, field(input.userId, 80));
    if (!row?.submitted) fail('Peserta belum mengumpulkan jawaban.', 409);
    const points = {};
    for (const item of parse(row.snapshot).filter(item => item.type === 'essay')) {
      const value = input.points?.[item.id];
      if (!Number.isInteger(value) || value < 0 || value > item.points) fail('Nilai esai harus berada dalam rentang bobot soal.');
      points[item.id] = value;
    }
    await db.prepare('UPDATE attempts SET review=? WHERE user_id=?').bind(stringify({ points }), row.user_id).run();
    return json({});
  }
  fail('Halaman admin tidak ditemukan.', 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith('/api/')) return await api(request, env, path);
      const asset = (typeof assets !== 'undefined' ? assets : env.ASSETS)[path === '/admin' ? '/' : path];
      if (!asset) return new Response('Halaman tidak ditemukan.', { status: 404, headers: secureHeaders });
      const [type, content, encoded] = asset;
      const body = encoded ? Uint8Array.from(atob(content), byte => byte.charCodeAt(0)) : content;
      return new Response(body, { headers: { ...secureHeaders, 'Content-Type': type, 'Cache-Control': 'no-cache' } });
    } catch (error) {
      if (!error.status && (['53300', '57P01', '57P02', '57P03', '08000', '08006', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code) || /timeout|connection terminated/i.test(error.message))) {
        console.error('portal_database_unavailable', error.code ?? 'timeout');
        return json({ error: 'Server sedang sibuk atau koneksi terputus. Silakan coba lagi.' }, 503, { 'Retry-After': '2' });
      }
      if (!error.status) console.error('portal_request_failed', error.code ?? 'unknown');
      return json({ error: error.status ? error.message : 'Terjadi gangguan. Coba lagi sebentar.' }, error.status || 500);
    }
  },
};
