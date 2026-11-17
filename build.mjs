import { readFile, mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('./dist/server/', import.meta.url);
await mkdir(directory, { recursive: true });
const assets = {};
for (const [path, file, type] of [
  ['/', 'index.html', 'text/html'],
  ['/style.css', 'style.css', 'text/css'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/mark.svg', 'mark.svg', 'image/svg+xml'],
  ['/logo-mpk.png', 'logo-mpk.png', 'image/png'],
]) {
  const encoding = type === 'image/png' ? 'base64' : 'utf8';
  assets[path] = [type, await readFile(new URL('./web/' + file, import.meta.url), encoding), encoding === 'base64'];
}
const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
await writeFile(new URL('index.js', directory), 'const assets = ' + JSON.stringify(assets) + ';\n' + worker);
