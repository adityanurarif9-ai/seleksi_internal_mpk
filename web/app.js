const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = {
  user: null, role: location.pathname === '/admin' ? 'admin' : 'participant',
  page: 'overview', attempt: null, config: null, question: 0, flagged: new Set(), offset: 0,
};
let notifyTimer, clockTimer, saveTimer, saveQueue = Promise.resolve();
let version = 0;
let saved = 0;
let submitting = false;
let guardReason = '';
let fullscreenFallback = false;
let fullscreenTransition = false;
let violationKey = '';
let pendingViolations = [];
let violationRetry;
const postingViolations = new Set();
const violationLabels = {
  'tab-hidden': 'Halaman ujian ditinggalkan',
  'fullscreen-exit': 'Keluar dari layar penuh',
};
const letters = ['A', 'B', 'C', 'D'];
const icons = {
  arrow: 'M4 12h15m-6-6 6 6-6 6', user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  lock: 'M6 11h12a2 2 0 0 1 2 2v7H4v-7a2 2 0 0 1 2-2Zm2 0V7a4 4 0 0 1 8 0v4m-4 4v2',
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-10 2 2 4-4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  book: 'M6 3h14v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 15a2 2 0 0 1 2-2h14M8 7h8m-8 4h6',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-10-5v5l3 2',
  grid: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  check: 'm5 12 5 5L20 7', logout: 'M10 4H4v16h6m4-13 5 5-5 5m-5-5h10',
  plus: 'M12 5v14M5 12h14', flag: 'M5 22V3m0 1c5-5 9 5 14 0v10c-5 5-9-5-14 0',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-10-1v6m0-10v.01',
  back: 'M20 12H4m6-6-6 6 6 6',
  file: 'M6 2h8l4 4v16H6zm8 0v5h5M9 12h6m-6 4h6',
  people: 'M16 21H3v-2a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4zm-2-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4 7a4 4 0 0 1 4 4v2m-5-17a4 4 0 0 1 0 8',
};
const icon = (name, size = 20) => '<svg aria-hidden="true" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="' + icons[name] + '"/></svg>';
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = value => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(value) + ' WIB';
const crest = (extra = '', alt = '') => '<span class="crest ' + extra + '"><img src="/logo-mpk.png" alt="' + alt + '" width="591" height="1280" decoding="async"></span>';
const brandText = () => crest('brand-mark') + '<span><strong>Portal MPK</strong><small>SMK Telkom Purwokerto</small></span>';
const brand = () => '<a class="brand" href="/" aria-label="Portal MPK">' + brandText() + '</a>';
const footer = () => '<footer class="site-footer"><span>© ' + new Date().getFullYear() + ' MPK SMK Telkom Purwokerto</span><span>Majelis Perwakilan Kelas</span></footer>';
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0] ?? '').join('').toLocaleUpperCase('id-ID');
const avatar = (user, className = '') => '<span class="avatar ' + className + '" aria-hidden="true">' + html(initials(user.name)) + '</span>';

async function api(path, data, keepalive = false) {
  const response = await fetch('/api/' + path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), keepalive,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal.');
  return result;
}
function message(text, error = false) {
  clearTimeout(notifyTimer);
  toast.hidden = false;
  toast.classList.toggle('error', error);
  toast.textContent = text;
  notifyTimer = setTimeout(() => { toast.hidden = true; }, 4000);
}
function errorIn(form, text) {
  const target = form.querySelector('.form-error');
  if (target) target.textContent = text;
}
async function submit(form, action) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  errorIn(form, '');
  try { await action(new FormData(form)); } catch (error) { errorIn(form, error.message); }
  finally { if (button) button.disabled = false; }
}

function loginView() {
  clearInterval(clockTimer);
  document.body.className = 'login-body';
  const admin = state.role === 'admin';
  app.innerHTML = '<main class="login-main"><section class="hero" aria-labelledby="hero-title">' +
    '<div class="hero-art" aria-hidden="true"></div>' +
    '<div class="hero-brand">' + brandText() + '</div>' +
    '<div class="hero-content"><p class="hero-kicker">SELEKSI INTERNAL</p>' +
    '<h1 id="hero-title">Reorganisasi<br><em>MPK.</em></h1>' +
    '<p class="hero-intro">Ujian seleksi calon pengurus Majelis Perwakilan Kelas.</p>' +
    '<div class="hero-bottom">' + icon('people', 18) + '<span>Kelas X dan XI</span></div></div></section>' +
    '<section class="login-panel" aria-labelledby="login-title"><div class="login-content"><div class="login-symbol">' + icon('lock', 23) + '</div>' +
    '<h2 id="login-title">Masuk ke portal</h2><p class="muted">Gunakan ID dan kata sandi dari panitia MPK.</p>' +
    '<div class="role-switch" role="group" aria-label="Jenis akses"><button type="button" data-role="participant" aria-pressed="' + !admin + '">' + icon('user', 17) + ' Peserta</button><button type="button" data-role="admin" aria-pressed="' + admin + '">' + icon('shield', 17) + ' Admin</button></div>' +
    '<form id="login-form"><label for="username">' + (admin ? 'ID Admin' : 'NIS / ID Peserta') + '</label><div class="input-icon">' + icon('user', 18) +
    '<input id="username" name="username" placeholder="' + (admin ? 'Masukkan ID admin' : 'Masukkan NIS atau ID peserta') + '" autocomplete="username" required maxlength="60"></div>' +
    '<label for="password">Kata Sandi</label><div class="input-icon">' + icon('lock', 18) +
    '<input id="password" name="password" type="password" placeholder="Masukkan kata sandi" autocomplete="current-password" required maxlength="150">' +
    '<button class="show-password" type="button" aria-label="Tampilkan kata sandi" aria-pressed="false">' + icon('eye', 18) + '</button></div>' +
    '<div class="form-error" role="alert"></div><button class="primary login-button" type="submit">Masuk ' + icon('arrow', 19) + '</button></form>' +
    '<p class="login-help">' + icon('info', 16) + '<span>Kesulitan masuk? <strong>Hubungi panitia MPK.</strong></span></p></div>' +
    '<footer class="login-footer">© ' + new Date().getFullYear() + ' MPK SMK Telkom Purwokerto</footer></section></main>';
  app.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.role;
    if (next === state.role) return;
    state.role = next;
    history.replaceState(null, '', next === 'admin' ? '/admin' : '/');
    loginView();
    app.querySelector('[data-role="' + next + '"]').focus();
  }));
  app.querySelector('.show-password').addEventListener('click', event => {
    const button = event.currentTarget;
    const input = app.querySelector('#password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    button.setAttribute('aria-pressed', String(show));
  });
  app.querySelector('#login-form').addEventListener('submit', event => {
    event.preventDefault();
    submit(event.currentTarget, async data => {
      const { user } = await api('login', { ...Object.fromEntries(data), role: state.role });
      state.user = user;
      try { await route(); } catch (error) { state.user = null; throw error; }
    });
  });
}

function shell(content, inExam = false, inProfile = false) {
  const adminLayout = state.user.role === 'admin' && !inProfile;
  document.body.className = 'workspace-body' + (inExam ? ' in-exam' : adminLayout ? ' admin-body' : '');
  const identity = inExam ? '<span class="brand exam-brand">' + brandText() + '</span>' : brand();
  const account = inExam ? '<span class="pill cohort-pill">' + html(cohortLabel(state.user.cohort)) + '</span>' :
    '<div class="account"><button class="profile-trigger" id="open-profile" type="button" aria-label="Profil"' + (inProfile ? ' aria-current="page" disabled' : '') + '>' +
    avatar(state.user) + '<span class="profile-trigger-text"><strong>' + html(state.user.name) + '</strong><small>Profil</small></span></button>' +
    '<button class="secondary small" id="logout" aria-label="Keluar">' + icon('logout', 17) + '<span class="logout-label">Keluar</span></button></div>';
  app.innerHTML = '<header class="site-header"><div class="frame header-inner">' + identity + account + '</div></header>' +
    '<main class="frame workspace">' + content + '</main>' + footer();
  app.querySelector('#open-profile')?.addEventListener('click', () => {
    profileView();
    app.querySelector('#profile-title').focus();
  });
  app.querySelector('#logout')?.addEventListener('click', async () => {
    try {
      await saveQueue.catch(() => {});
      if (state.user.role === 'participant' && state.attempt?.items && saved < version) await persist(false);
      await api('logout', {});
      clearTimeout(saveTimer);
      Object.assign(state, { user: null, page: 'overview', attempt: null, question: 0, flagged: new Set(), edit: null, review: null, cohort: '', classEdit: null, violationView: null });
      guardReason = '';
      fullscreenFallback = false;
      violationKey = '';
      pendingViolations = [];
      clearTimeout(violationRetry);
      version = saved = 0;
      loginView();
    } catch (error) { message(error.message, true); }
  });
}
const heading = (kicker, title, subtitle) => '<section class="page-heading"><div class="eyebrow">' + kicker + '</div><h1>' + title + '</h1><p>' + subtitle + '</p></section>';
const cohortLabel = value => value ? 'Kelas ' + value : 'Belum ditentukan';

function profileView() {
  const user = state.user;
  const isParticipant = user.role === 'participant';
  const role = isParticipant ? 'Peserta' : 'Admin';
  const detail = (label, value) => '<div><dt>' + label + '</dt><dd>' + html(value) + '</dd></div>';
  shell('<div class="profile-layout"><button class="secondary profile-back" id="back-profile">' + icon('back', 17) + ' ' + (isParticipant ? 'Kembali ke ujian' : 'Kembali ke dashboard') + '</button>' +
    '<section class="surface profile-card" aria-labelledby="profile-title"><header class="profile-cover"><h1 id="profile-title" tabindex="-1">Profil Saya</h1></header><div class="profile-card-body">' +
    '<div class="profile-identity">' + avatar(user, 'avatar-large') + '<div><span class="pill cohort-pill">' + role + '</span><h2>' + html(user.name) + '</h2></div></div>' +
    '<dl class="profile-info">' + detail(isParticipant ? 'NIS / ID peserta' : 'ID admin', user.username) +
    (isParticipant ? detail('Tingkat', cohortLabel(user.cohort)) + detail('Rombel', user.class) : '') + '</dl></div></section></div>', false, true);
  const back = app.querySelector('#back-profile');
  back.addEventListener('click', async () => {
    back.disabled = true;
    try { await route(); app.querySelector('#open-profile')?.focus(); }
    catch (error) { message(error.message, true); back.disabled = false; }
  });
}

async function route() {
  if (!state.user) return loginView();
  if (state.user.role === 'admin') { await loadAdmin(); return; }
  const data = await api('exam');
  state.config = data.settings;
  updateAttempt(data);
  if (state.attempt?.items && document.fullscreenEnabled && !document.fullscreenElement) guardReason = 'resume';
  participantView();
}

function updateAttempt(data) {
  state.attempt = data.attempt;
  state.offset = data.now - Date.now();
  if (!state.attempt) return;
  const key = 'mpk-violations:' + state.user.id + ':' + state.attempt.started;
  if (violationKey === key) return;
  violationKey = key;
  pendingViolations = [];
  try {
    const savedEvents = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(savedEvents)) pendingViolations = savedEvents;
  } catch {}
  flushViolations();
}

function cacheViolations() {
  try {
    if (pendingViolations.length) localStorage.setItem(violationKey, JSON.stringify(pendingViolations));
    else localStorage.removeItem(violationKey);
  } catch {}
}

function flushViolations() {
  clearTimeout(violationRetry);
  const key = violationKey;
  for (const event of pendingViolations) {
    if (postingViolations.has(event.id)) continue;
    postingViolations.add(event.id);
    api('exam/violations', event, true).then(({ total }) => {
      if (key !== violationKey) return;
      pendingViolations = pendingViolations.filter(entry => entry.id !== event.id);
      cacheViolations();
      state.attempt.violationCount = Math.max(state.attempt.violationCount, total);
      renderGuard();
    }).catch(() => {
      if (key === violationKey) violationRetry = setTimeout(flushViolations, 3000);
    }).finally(() => postingViolations.delete(event.id));
  }
}

function recordViolation(kind) {
  const attempt = state.attempt;
  const at = Date.now() + state.offset;
  if (!attempt?.items || at >= attempt.deadline || violationLabels[guardReason]) return;
  const confirmation = app.querySelector('#confirm-submit');
  if (confirmation?.open) confirmation.close('cancel');
  guardReason = kind;
  pendingViolations.push({ id: crypto.randomUUID(), kind, at, started: attempt.started });
  cacheViolations();
  flushViolations();
  renderGuard(!document.hidden);
}

function renderGuard(focus = false) {
  const notice = app.querySelector('#exam-warning');
  if (!notice) return;
  const issue = violationLabels[guardReason];
  const count = state.attempt.violationCount;
  const status = document.fullscreenElement ? 'Layar penuh aktif' : fullscreenFallback || !document.fullscreenEnabled ? 'Mode browser' : 'Layar penuh nonaktif';
  app.querySelector('#monitor-status').textContent = status;
  app.querySelector('#incident-count').textContent = count + ' pelanggaran' + (pendingViolations.length ? ' · menyinkronkan' : '');
  notice.hidden = !guardReason;
  app.querySelector('.exam-grid').inert = !!guardReason;
  if (!guardReason) return;
  notice.querySelector('h2').textContent = issue ? 'Peringatan pelanggaran' : 'Lanjutkan ujian';
  notice.querySelector('p').textContent = issue
    ? issue + '. ' + (pendingViolations.length ? 'Catatan menunggu sinkronisasi.' : 'Catatan tersedia untuk panitia.') + ' Timer tetap berjalan.'
    : 'Aktifkan layar penuh untuk melanjutkan. Timer tetap berjalan.';
  const button = notice.querySelector('button');
  button.textContent = !document.fullscreenElement && document.fullscreenEnabled && !fullscreenFallback ? 'Aktifkan layar penuh' : 'Lanjutkan ujian';
  if (focus) button.focus();
}

async function enterFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement || fullscreenFallback) return;
  fullscreenTransition = true;
  try { await document.documentElement.requestFullscreen(); }
  catch {
    fullscreenFallback = true;
    message('Layar penuh tidak tersedia. Perpindahan tab tetap dipantau.');
  } finally { fullscreenTransition = false; }
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !fullscreenTransition && !fullscreenFallback) recordViolation('fullscreen-exit');
  renderGuard();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) recordViolation('tab-hidden');
  else if (state.attempt?.items) {
    flushViolations();
    renderGuard(true);
  }
});
window.addEventListener('pagehide', () => recordViolation('tab-hidden'));
window.addEventListener('online', flushViolations);

function participantView() {
  clearInterval(clockTimer);
  const a = state.attempt;
  if (a?.items) return examView();
  guardReason = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const completed = !!a?.submitted;
  const open = !!(state.config.is_open && state.config.total);
  const detail = completed
    ? '<section class="surface status-card"><div class="receipt-mark">' + icon('check', 34) + '</div><div><span class="pill good">Ujian selesai</span><h2>Jawaban sudah dikumpulkan</h2><p>Panitia akan memeriksa jawaban dan menyampaikan hasil seleksi.</p></div>' +
      '<div class="receipt-time">' + icon('clock', 19) + '<span><small>Waktu pengumpulan</small><strong>' + date(a.submitted) + '</strong></span></div></section>'
    : '<div class="participant-grid"><section class="surface exam-overview"><div class="exam-overview-top"><span class="login-symbol">' + icon('book', 22) +
    '</span><span class="pill ' + (open ? 'good' : '') + '">' + (open ? 'Ujian dibuka' : 'Ujian belum dibuka') + '</span></div><h2>Ujian Seleksi MPK</h2><p>Kerjakan soal reorganisasi dalam waktu yang disediakan.</p>' +
    '<div class="exam-meta"><div>' + icon('file') + ' <span><strong>' + state.config.total + '</strong><small>Jumlah soal</small></span></div><div>' + icon('clock') +
    ' <span><strong>' + state.config.duration + ' menit</strong><small>Durasi ujian</small></span></div></div>' +
    (open ? '<label class="rules-agreement"><input id="accept-rules" type="checkbox"> <span>Saya sudah membaca dan menyetujui peraturan ujian.</span></label><button class="primary" id="start" disabled>Mulai Ujian ' + icon('arrow') + '</button>' : '<button class="secondary" id="refresh">Periksa Status</button>') +
    '</section><section class="surface rules-card"><div class="rules-title">' + icon('shield', 20) + '<h2>Peraturan Ujian</h2></div><ol class="instructions"><li>Waktu mulai berjalan saat kamu menekan Mulai Ujian. Browser yang mendukung akan masuk ke layar penuh.</li><li>Tetap di tab ujian. Berpindah tab, membuka aplikasi lain hingga halaman tersembunyi, atau keluar dari layar penuh akan memicu peringatan dan tercatat untuk panitia.</li><li>Kumpulkan jawaban sebelum waktu habis. Saat waktu habis sistem mengumpulkan jawaban yang sudah tersimpan.</li></ol></section></div>';
  const identity = state.user.cohort ? ' · ' + cohortLabel(state.user.cohort) + ' / ' + html(state.user.class) : '';
  shell(heading('UJIAN SELEKSI' + identity, 'Halo, ' + html(state.user.name), completed ? 'Terima kasih sudah mengikuti ujian seleksi MPK.' : 'Selamat datang di ujian reorganisasi MPK.') + detail);
  app.querySelector('#refresh')?.addEventListener('click', () => route().catch(error => message(error.message, true)));
  app.querySelector('#accept-rules')?.addEventListener('change', event => { app.querySelector('#start').disabled = !event.target.checked; });
  app.querySelector('#start')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const fullscreen = enterFullscreen();
    try {
      const data = await api('exam/start', {});
      await fullscreen;
      updateAttempt(data);
      if (state.attempt?.items && document.fullscreenEnabled && !document.fullscreenElement && !fullscreenFallback) guardReason = 'resume';
      participantView();
      if (document.hidden) recordViolation('tab-hidden');
    } catch (error) {
      await fullscreen;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      message(error.message, true);
      button.disabled = false;
    }
  });
}

function isAnswered(item) {
  const value = state.attempt.answers[item.id];
  return item.type === 'choice' ? Number.isInteger(value) : !!value?.trim();
}
function saveLabel(text) {
  const label = app.querySelector('#save-label');
  if (label) label.textContent = text;
}
function persist(submitNow) {
  clearTimeout(saveTimer);
  const current = version;
  const answers = { ...state.attempt.answers };
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    if (!state.attempt?.items) return;
    const data = await api('exam/answers', { answers, submit: submitNow });
    saved = Math.max(saved, current);
    if (data.attempt.submitted) { updateAttempt(data); participantView(); }
    else if (version === saved) saveLabel('Jawaban tersimpan');
  });
  return saveQueue;
}
function autosave() {
  saveLabel('Menunggu penyimpanan…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(false).catch(() => {
    saveLabel('Gagal menyimpan. Mencoba lagi…');
    saveTimer = setTimeout(autosave, 2000);
  }), 350);
}
function examView() {
  const { items, answers } = state.attempt;
  const item = items[state.question];
  const value = answers[item.id];
  const response = item.type === 'essay'
    ? '<label for="essay">Jawaban esai</label><textarea id="essay" rows="8" maxlength="3000" placeholder="Tulis jawabanmu di sini…">' + html(value) + '</textarea>'
    : '<fieldset class="options"><legend class="sr-only">Pilih satu jawaban</legend>' + item.options.map((option, i) => '<label class="option"><input type="radio" name="option" value="' + i + '"' + (value === i ? ' checked' : '') + '><span class="letter">' + letters[i] + '</span><span>' + html(option) + '</span></label>').join('') + '</fieldset>';
  const answered = items.filter(isAnswered).length;
  shell('<section class="exam-top"><div><div class="eyebrow">UJIAN BERLANGSUNG</div><h1>Ujian Seleksi MPK</h1></div><div class="timer" aria-label="Sisa waktu">' + icon('clock') + '<strong id="remaining"></strong></div></section>' +
    '<div class="monitor-strip">' + icon('shield', 18) + '<span id="monitor-status"></span><span id="incident-count" role="status"></span></div>' +
    '<section id="exam-warning" class="exam-warning" aria-labelledby="warning-title" hidden>' + icon('info', 23) + '<div><h2 id="warning-title"></h2><p role="alert"></p></div><button class="primary small" type="button"></button></section>' +
    '<div class="exam-grid"><section class="surface question-panel"><div class="question-top"><span class="pill">Soal ' + (state.question + 1) + ' dari ' + items.length + '</span><span class="muted">' + (item.type === 'essay' ? 'Esai' : 'Pilihan ganda') + ' · ' + item.points + ' poin</span></div><h2>' + html(item.prompt) + '</h2>' + response +
    '<div class="question-controls"><button class="secondary" data-jump="' + (state.question - 1) + '"' + (state.question === 0 ? ' disabled' : '') + '>Sebelumnya</button>' +
    '<button class="secondary flag" id="flag" aria-pressed="' + state.flagged.has(item.id) + '">' + icon('flag', 17) + ' Tandai</button>' +
    '<button class="primary" data-jump="' + (state.question + 1) + '"' + (state.question === items.length - 1 ? ' disabled' : '') + '>Selanjutnya ' + icon('arrow', 17) + '</button></div></section>' +
    '<aside class="surface navigator"><div class="navigation-head"><div><h2>Navigasi Soal</h2><p id="answer-count">' + answered + ' dari ' + items.length + ' terjawab</p></div><button class="secondary small" id="toggle-numbers" type="button" aria-expanded="false" aria-controls="number-grid">Lihat daftar</button></div>' +
    '<progress class="answer-progress" id="answer-progress" aria-label="Progres jawaban" value="' + answered + '" max="' + items.length + '"></progress>' +
    '<div class="number-grid" id="number-grid">' + items.map((q, index) => '<button class="number ' + (isAnswered(q) ? 'answered ' : '') + (state.flagged.has(q.id) ? 'flagged ' : '') + (index === state.question ? 'current' : '') + '" data-jump="' + index + '" aria-label="Soal ' + (index + 1) + (state.flagged.has(q.id) ? ', ditandai' : '') + (isAnswered(q) ? ', terjawab' : '') + '"' + (index === state.question ? ' aria-current="step"' : '') + '>' + (index + 1) + '</button>').join('') + '</div>' +
    '<div class="navigator-actions"><button class="primary" id="finish">Kumpulkan Jawaban</button><p id="save-label" role="status">' + (saved < version ? 'Menunggu penyimpanan…' : 'Jawaban tersimpan') + '</p></div></aside></div>' +
    '<dialog id="confirm-submit" aria-labelledby="submit-title"><h2 id="submit-title">Kumpulkan jawaban?</h2><p id="submit-summary"></p><form method="dialog" class="actions"><button class="secondary" value="cancel" autofocus>Kembali</button><button class="primary" value="submit">Ya, kumpulkan</button></form></dialog>', true);
  renderGuard();
  app.querySelector('#exam-warning button').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    await enterFullscreen();
    guardReason = '';
    renderGuard();
    const target = app.querySelector('.question-panel h2');
    if (target) {
      target.tabIndex = -1;
      target.focus();
    }
  });
  app.querySelector('#toggle-numbers').addEventListener('click', event => {
    const button = event.currentTarget;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Tutup daftar' : 'Lihat daftar';
    app.querySelector('.navigator').classList.toggle('show-numbers', expanded);
  });
  const change = next => {
    answers[item.id] = next;
    version++;
    const count = items.filter(isAnswered).length;
    app.querySelector('#answer-count').textContent = count + ' dari ' + items.length + ' terjawab';
    app.querySelector('#answer-progress').value = count;
    const button = app.querySelector('.number.current');
    button.classList.toggle('answered', isAnswered(item));
    button.setAttribute('aria-label', 'Soal ' + (state.question + 1) + (state.flagged.has(item.id) ? ', ditandai' : '') + (isAnswered(item) ? ', terjawab' : ''));
    autosave();
  };
  app.querySelector('#essay')?.addEventListener('input', event => change(event.target.value));
  app.querySelectorAll('input[name="option"]').forEach(input => input.addEventListener('change', () => change(Number(input.value))));
  app.querySelectorAll('[data-jump]').forEach(button => button.addEventListener('click', () => {
    state.question = Number(button.dataset.jump);
    examView();
    app.querySelector('.question-panel h2').setAttribute('tabindex', '-1');
    app.querySelector('.question-panel h2').focus();
  }));
  app.querySelector('#flag').addEventListener('click', () => {
    if (state.flagged.has(item.id)) state.flagged.delete(item.id);
    else state.flagged.add(item.id);
    examView();
    app.querySelector('#flag').focus();
  });
  const finish = app.querySelector('#finish');
  const confirmation = app.querySelector('#confirm-submit');
  async function finishExam() {
    if (submitting) return;
    if (confirmation.open) confirmation.close('cancel');
    submitting = true;
    finish.disabled = true;
    const questionPanel = app.querySelector('.question-panel');
    if (questionPanel) questionPanel.inert = true;
    try { await persist(true); } catch (error) {
      message(error.message, true);
      finish.disabled = false;
      if (questionPanel) questionPanel.inert = false;
      if (saved < version) autosave();
    } finally { submitting = false; }
  }
  finish.addEventListener('click', () => {
    const unanswered = items.length - items.filter(isAnswered).length;
    confirmation.returnValue = 'cancel';
    confirmation.querySelector('p').textContent = unanswered
      ? unanswered + ' soal belum terjawab. Setelah dikumpulkan, jawaban tersimpan sebagai hasil akhir.'
      : 'Semua soal terjawab. Setelah dikumpulkan, jawaban tersimpan sebagai hasil akhir.';
    confirmation.showModal();
  });
  confirmation.addEventListener('close', () => {
    if (confirmation.returnValue === 'submit' && !guardReason) finishExam();
  });
  clearInterval(clockTimer);
  function tick() {
    const remaining = Math.max(0, Math.ceil((state.attempt.deadline - Date.now() - state.offset) / 1000));
    const label = app.querySelector('#remaining');
    label.textContent = String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');
    label.parentElement.classList.toggle('urgent', remaining <= 60);
    if (remaining === 0) {
      clearInterval(clockTimer);
      finishExam();
    }
  }
  clockTimer = setInterval(tick, 1000);
  tick();
}

const pages = [
  ['overview', 'Ringkasan', 'grid'],
  ['questions', 'Bank Soal', 'book'],
  ['participants', 'Peserta', 'people'],
  ['results', 'Hasil Ujian', 'file'],
];

async function loadAdmin() {
  state.admin = await api('admin/dashboard');
  adminView();
}

const btn = (action, label, extra = '') => '<button type="button" class="secondary small" data-action="' + action + '" ' + extra + '>' + label + '</button>';
const stack = (label, input) => '<label class="field">' + label + input + '</label>';
const err = '<div class="form-error" role="alert"></div>';
const saveButton = label => '<button class="primary" type="submit">' + label + '</button>';
const empty = text => '<p class="empty">' + text + '</p>';
function table(headers, rows, mobileCards = false) {
  return '<div class="table-wrap' + (mobileCards ? ' mobile-cards' : '') + '"><table><thead><tr>' + headers.map(name => '<th scope="col">' + name + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + row.map((cell, index) => '<td data-label="' + headers[index] + '">' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function overview(data) {
  const submitted = data.results.filter(row => row.submitted).length;
  const countCohort = cohort => data.participants.filter(user => user.cohort === cohort).length;
  const stats = [['Soal', data.questions.length, 'book'], ['Peserta kelas X', countCohort('X'), 'people'], ['Peserta kelas XI', countCohort('XI'), 'people'], ['Sudah mengumpulkan', submitted, 'check']];
  return '<div class="stats">' + stats.map(([label, value, glyph]) => '<div class="surface stat"><span class="login-symbol">' + icon(glyph) + '</span><strong>' + value + '</strong><span>' + label + '</span></div>').join('') + '</div>' +
    '<section class="surface"><div class="section-head"><div><h2>Pengaturan Ujian</h2><p>Atur durasi dan akses peserta untuk memulai.</p></div><span class="pill ' + (data.settings.is_open ? 'good' : '') + '">' + (data.settings.is_open ? 'Ujian dibuka' : 'Ujian ditutup') + '</span></div>' +
    '<form id="settings-form" class="admin-form"><div class="form-row">' +
    stack('Durasi (menit)', '<input type="number" name="duration" min="1" max="240" value="' + data.settings.duration + '" required>') +
    stack('Akses ujian', '<select name="open"><option value="0">Ditutup</option><option value="1"' + (data.settings.is_open ? ' selected' : '') + '>Dibuka</option></select>') +
    '</div>' + err + saveButton('Simpan Pengaturan') + '</form></section>';
}

function questionForm(edit) {
  const choice = !edit || edit.type === 'choice';
  return '<section class="surface"><div class="section-head"><h2>' + (edit ? 'Edit Soal' : 'Tambah Soal') + '</h2>' + btn('close-edit', 'Batal') + '</div><form id="question-form" class="admin-form">' +
    '<div class="form-row">' + stack('Jenis soal', '<select name="type"><option value="choice">Pilihan ganda</option><option value="essay"' + (choice ? '' : ' selected') + '>Esai</option></select>') +
    stack('Bobot poin', '<input name="points" type="number" min="1" max="100" value="' + (edit?.points ?? 10) + '" required>') + '</div>' +
    stack('Pertanyaan', '<textarea name="prompt" rows="3" maxlength="1500" required>' + html(edit?.prompt) + '</textarea>') +
    '<div class="form-row" id="choices"' + (choice ? '' : ' hidden') + '>' + letters.map((letter, i) => stack('Pilihan ' + letter, '<input name="option" maxlength="500" value="' + html(edit?.options?.[i]) + '"' + (choice ? ' required' : '') + '>')).join('') +
    stack('Kunci jawaban', '<select name="correct">' + letters.map((letter, i) => '<option value="' + i + '"' + (edit?.correct === i ? ' selected' : '') + '>' + letter + '</option>').join('') + '</select>') + '</div>' +
    err + saveButton('Simpan Soal') + '</form></section>';
}

function questionsPanel(data) {
  if (state.edit) return questionForm(state.edit === 'new' ? null : data.questions.find(q => q.id === state.edit));
  return '<section class="surface"><div class="section-head"><div><h2>Bank Soal</h2><p>Kelola soal pilihan ganda dan esai.</p></div>' + btn('add', icon('plus', 17) + ' Tambah Soal') + '</div>' +
    (data.questions.length ? table(['Pertanyaan', 'Jenis', 'Bobot', 'Tindakan'], data.questions.map(q => [
      html(q.prompt), q.type === 'choice' ? 'Pilihan ganda' : 'Esai', q.points + ' poin',
      '<div class="actions">' + btn('edit', 'Edit', 'data-id="' + q.id + '"') + btn('delete', 'Hapus', 'data-id="' + q.id + '"') + '</div>',
    ])) : empty('Belum ada soal. Tambahkan soal untuk membuka ujian.')) + '</section>';
}

function cohortOptions(selected) {
  return ['X', 'XI'].map(value => '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + cohortLabel(value) + '</option>').join('');
}
function cohortFilter(data) {
  const unassigned = data.participants.some(user => !user.cohort);
  return '<label class="cohort-filter">Tingkat kelas<select id="cohort-filter"><option value="">Semua kelas</option>' + cohortOptions(state.cohort) +
    (unassigned ? '<option value="unassigned"' + (state.cohort === 'unassigned' ? ' selected' : '') + '>Belum ditentukan</option>' : '') + '</select></label>';
}
function filteredParticipants(data) {
  return data.participants.filter(user => !state.cohort || (user.cohort ?? 'unassigned') === state.cohort);
}
function participantPanel(data) {
  const edit = data.participants.find(user => user.id === state.classEdit);
  const form = '<section class="surface"><div class="section-head"><div><h2>' + (edit ? 'Edit Kelas Peserta' : 'Tambah Peserta') +
    '</h2><p>' + (edit ? html(edit.name) : 'Buat akun untuk peserta kelas X dan XI.') + '</p></div>' + (edit ? btn('close-class', 'Batal') : '') + '</div>' +
    '<form id="participant-form" class="admin-form"><div class="form-row">' +
    (edit ? '' : stack('Nama lengkap', '<input name="name" maxlength="100" required>')) +
    stack('Tingkat kelas', '<select name="cohort" required><option value="">Pilih kelas</option>' + cohortOptions(edit?.cohort) + '</select>') +
    stack('Rombel', '<input name="class" maxlength="40" value="' + html(edit?.class) + '" placeholder="Contoh: XI RPL 1" required>') +
    (edit ? '' : stack('NIS / ID peserta', '<input name="username" minlength="3" maxlength="60" pattern="[a-zA-Z0-9._\\-]+" required>') +
      stack('Kata sandi awal', '<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="150" required>')) +
    '</div>' + err + saveButton(edit ? 'Simpan Kelas' : 'Tambah Peserta') + '</form></section>';
  const users = filteredParticipants(data);
  return form + '<section class="surface list-surface"><div class="section-head"><h2>Daftar Peserta</h2>' + cohortFilter(data) + '</div>' +
    (users.length ? table(['Nama', 'Tingkat', 'Rombel', 'ID Peserta', 'Tindakan'], users.map(user => [
      html(user.name), html(cohortLabel(user.cohort)), html(user.class), html(user.username), btn('edit-class', 'Edit Kelas', 'data-id="' + user.id + '"'),
    ]), true) : empty('Belum ada akun peserta pada kelas ini.')) + '</section>';
}

function reviewPanel(row, user) {
  const essays = row.items.some(item => item.type === 'essay');
  const answer = (item, value) => item.type === 'essay' ? value : item.options[value];
  return '<section class="surface"><div class="section-head"><div><h2>' + html(user.name) + '</h2><p>' + html(user.class) + ' · Dikumpulkan ' + date(row.submitted) + '</p></div>' + btn('close-review', 'Kembali') + '</div>' +
    '<form class="admin-form" id="review-form">' + row.items.map((item, i) =>
      '<article class="review-item"><h3>' + (i + 1) + '. ' + html(item.prompt) + '</h3><p class="response-text">' + html(answer(item, row.answers[item.id]) || 'Belum dijawab') + '</p>' +
      (item.type === 'essay'
        ? stack('Nilai (maks. ' + item.points + ')', '<input type="number" min="0" max="' + item.points + '" name="' + item.id + '" value="' + (row.review?.points[item.id] ?? '') + '" required>')
        : '<p class="muted">Kunci: ' + html(item.options[item.correct]) + ' · Nilai: ' + (row.answers[item.id] === item.correct ? item.points : 0) + '/' + item.points + '</p>') +
      '</article>'
    ).join('') + err + (essays ? saveButton('Simpan Nilai Esai') : '') + '</form></section>';
}

function resultsPanel(data) {
  if (state.violationView) {
    const { user, violations } = state.violationView;
    return '<section class="surface"><div class="section-head"><div><h2>Riwayat Pelanggaran</h2><p>' + html(user.name) + ' · ' + html(user.class) +
      '</p></div>' + btn('close-violations', 'Kembali') + '</div>' +
      (violations.length ? table(['Peristiwa', 'Waktu'], violations.map(event => [html(violationLabels[event.kind]), date(event.at)]), true) : empty('Belum ada pelanggaran.')) + '</section>';
  }
  if (state.review) {
    const row = data.results.find(r => r.userId === state.review && r.submitted);
    const user = data.participants.find(u => u.id === state.review);
    if (row && user) return reviewPanel(row, user);
  }
  const users = filteredParticipants(data);
  const attemptsByUser = new Map(data.results.map(row => [row.userId, row]));
  return '<section class="surface"><div class="section-head"><div><h2>Hasil Ujian</h2><p>Lihat status pengerjaan, jawaban, dan pelanggaran.</p></div>' + btn('reload', 'Muat Ulang') + '</div>' + cohortFilter(data) +
    (users.length ? table(['Peserta', 'Status', 'Nilai', 'Pelanggaran', 'Tindakan'], users.map(user => {
      const row = attemptsByUser.get(user.id);
      const status = row?.submitted ? (row.pending ? 'Perlu dinilai' : 'Selesai') : row ? 'Sedang mengerjakan' : 'Belum mulai';
      return [html(user.name) + '<small class="table-detail">' + html(user.class) + '</small>', '<span class="pill' + (status === 'Selesai' ? ' good' : '') + '">' + status + '</span>',
        row?.submitted ? row.score + ' / ' + row.max + (row.pending ? '<small class="table-detail">Nilai sementara</small>' : '') : '—',
        row?.violationCount ? btn('violations', row.violationCount + ' pelanggaran', 'data-id="' + user.id + '"') : '0',
        row?.submitted ? btn('review', 'Lihat Jawaban', 'data-id="' + user.id + '"') : '—'];
    }), true) : empty('Belum ada peserta pada kelas ini.')) + '</section>';
}

function adminView() {
  const panels = { overview, questions: questionsPanel, participants: participantPanel, results: resultsPanel };
  const nav = '<aside class="admin-sidebar"><nav class="admin-nav" aria-label="Menu panitia">' + pages.map(([id, label, glyph]) =>
    '<button data-page="' + id + '"' + (id === state.page ? ' aria-current="page"' : '') + '>' + icon(glyph, 19) + '<span>' + label + '</span></button>').join('') + '</nav></aside>';
  shell('<div class="admin-layout">' + nav + '<div class="admin-content">' +
    heading('PANEL PANITIA', 'Dashboard Admin', 'Kelola akun peserta, bank soal, dan hasil ujian.') + panels[state.page](state.admin) + '</div></div>');
  app.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', async () => {
    const page = button.dataset.page;
    Object.assign(state, { page, edit: null, review: null, classEdit: null, violationView: null });
    try { await loadAdmin(); app.querySelector('[data-page="' + page + '"]').focus(); }
    catch (error) { message(error.message, true); }
  }));
  const actions = {
    add: () => { state.edit = 'new'; adminView(); },
    edit: id => { state.edit = id; adminView(); },
    'close-edit': () => { state.edit = null; adminView(); },
    delete: async id => {
      if (!confirm('Hapus soal ini dari bank soal?')) return;
      await api('admin/questions/delete', { id });
      await loadAdmin();
      message('Soal dihapus.');
    },
    review: id => { state.review = id; adminView(); },
    'close-review': () => { state.review = null; adminView(); },
    'edit-class': id => {
      state.classEdit = id;
      adminView();
      app.querySelector('[name="cohort"]').focus();
    },
    'close-class': () => { state.classEdit = null; adminView(); },
    violations: async id => {
      const user = state.admin.participants.find(row => row.id === id);
      const { violations } = await api('admin/violations', { userId: id });
      if (state.page !== 'results') return;
      state.violationView = { user, violations };
      adminView();
    },
    'close-violations': () => { state.violationView = null; adminView(); },
    reload: () => loadAdmin(),
  };
  app.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await actions[button.dataset.action](button.dataset.id); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  }));
  app.querySelector('select[name="type"]')?.addEventListener('change', event => {
    const choice = event.target.value === 'choice';
    const group = app.querySelector('#choices');
    group.hidden = !choice;
    group.querySelectorAll('input').forEach(input => { input.required = choice; });
  });
  app.querySelector('#cohort-filter')?.addEventListener('change', event => {
    state.cohort = event.target.value;
    adminView();
    app.querySelector('#cohort-filter').focus();
  });
  const forms = {
    'settings-form': async data => {
      await api('admin/settings', { duration: data.get('duration'), open: data.get('open') === '1' });
      await loadAdmin();
      message('Pengaturan disimpan.');
    },
    'question-form': async data => {
      await api('admin/questions', { ...Object.fromEntries(data), id: state.edit === 'new' ? undefined : state.edit, options: data.getAll('option') });
      state.edit = null;
      await loadAdmin();
      message('Soal disimpan.');
    },
    'participant-form': async data => {
      const id = state.classEdit;
      await api(id ? 'admin/participants/class' : 'admin/participants', { ...Object.fromEntries(data), id });
      state.classEdit = null;
      state.cohort = data.get('cohort');
      await loadAdmin();
      message(id ? 'Kelas peserta diperbarui.' : 'Akun peserta dibuat.');
    },
    'review-form': async data => {
      const points = Object.fromEntries(Array.from(data, ([id, value]) => [id, Number(value)]));
      await api('admin/review', { userId: state.review, points });
      await loadAdmin();
      message('Nilai esai disimpan.');
    },
  };
  for (const [id, action] of Object.entries(forms)) {
    app.querySelector('#' + id)?.addEventListener('submit', event => {
      event.preventDefault();
      submit(event.currentTarget, action);
    });
  }
}

try {
  const { user } = await api('me');
  state.user = user;
  await route();
} catch (error) {
  state.user = null;
  loginView();
  message(error.message, true);
}
