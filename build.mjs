import { readFile, mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('./dist/server/', import.meta.url);
await mkdir(directory, { recursive: true });
const assets = {};
for (const [path, file, type] of [
  ['/', 'index.html', 'text/html'],
  ['/style.css', 'style.css', 'text/css'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/question-import.js', 'question-import.js', 'text/javascript'],
  ['/vendor/fflate.js', 'vendor/fflate.js', 'text/javascript'],
  ['/templates/soal-mpk.docx', 'templates/soal-mpk.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['/templates/soal-mpk.xlsx', 'templates/soal-mpk.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['/mark.svg', 'mark.svg', 'image/svg+xml'],
  ['/favicon-mpk.svg', 'favicon-mpk.svg', 'image/svg+xml'],
  ['/logo-mpk.png', 'logo-mpk.png', 'image/png'],
  ['/exam-atmosphere.jpg', 'exam-atmosphere.jpg', 'image/jpeg'],
]) {
  const encoding = /\.(png|jpg|docx|xlsx)$/.test(file) ? 'base64' : 'utf8';
  assets[path] = [type, await readFile(new URL('./web/' + file, import.meta.url), encoding), encoding === 'base64'];
}
const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
await writeFile(new URL('index.js', directory), 'const assets = ' + JSON.stringify(assets) + ';\n' + worker);
