import { unzipSync } from './vendor/fflate.js';

const MAX_FILE = 5 * 1024 * 1024;
const MAX_XML = 12 * 1024 * 1024;
const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const nodes = (el, name) => [...el.getElementsByTagNameNS('*', name)];
const attr = (el, name) => [...(el?.attributes ?? [])].find(a => a.localName === name)?.value;
function xml(bytes) {
  const source = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Berkas XML tidak didukung. Simpan ulang dengan Word atau Excel.');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (nodes(doc, 'parsererror').length) throw new Error('Isi berkas rusak atau tidak dapat dibaca.');
  return doc;
}
function unpack(data) {
  let total = 0, entries = 0;
  return unzipSync(new Uint8Array(data), { filter(file) {
    if (++entries > 3000) throw new Error('Berkas terlalu kompleks. Gunakan template yang tersedia.');
    if (!/^(word\/document\.xml|xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/.test(file.name)) return false;
    total += file.originalSize;
    if (!Number.isSafeInteger(total) || total > MAX_XML || file.originalSize > MAX_XML) throw new Error('Isi berkas terlalu besar. Pisahkan soal ke beberapa berkas.');
    return true;
  } });
}
const aliases = [
  ['pertanyaan', 'soal', 'question', 'questiontext'],
  ['jenis', 'tipe', 'type', 'questiontype', 'jenissoal'],
  ['pilihana', 'opsia', 'a', 'option1', 'optiona'],
  ['pilihanb', 'opsib', 'b', 'option2', 'optionb'],
  ['pilihanc', 'opsic', 'c', 'option3', 'optionc'],
  ['pilihand', 'opsid', 'd', 'option4', 'optiond'],
  ['kunci', 'jawaban', 'kuncijawaban', 'correctanswer', 'answer'],
  ['bobot', 'poin', 'points', 'bobotpoin'],
  ['kelas', 'tingkat', 'cohort', 'kategori'],
];
function tableRows(rows) {
  const header = rows.findIndex(row => aliases[0].some(a => row.map(key).includes(a)));
  if (header < 0) return null;
  const keys = rows[header].map(key);
  const indexes = aliases.map(names => keys.findIndex(k => names.includes(k)));
  const extras = keys.map((k, i) => /^(option[5-9]|pilihan[e-z]|opsi[e-z])$/.test(k) ? i : -1).filter(i => i >= 0);
  return rows.slice(header + 1).filter(row => row.some(v => clean(v))).map((row, i) => {
    const values = indexes.map(idx => idx < 0 ? '' : clean(row[idx]));
    return { prompt: values[0], type: values[1], options: values.slice(2, 6), correct: values[6], points: values[7], cohort: values[8], extraOptions: extras.some(i => clean(row[i])), source: 'Baris ' + (header + i + 2) };
  });
}
function excel(files) {
  if (!files['xl/workbook.xml'] || !files['xl/_rels/workbook.xml.rels']) throw new Error('Berkas bukan Excel .xlsx yang valid.');
  const workbook = xml(files['xl/workbook.xml']);
  const sheet = nodes(workbook, 'sheet').find(s => attr(s, 'state') !== 'hidden' && attr(s, 'state') !== 'veryHidden');
  const relation = nodes(xml(files['xl/_rels/workbook.xml.rels']), 'Relationship').find(r => attr(r, 'Id') === attr(sheet ?? {}, 'id'));
  if (!relation || attr(relation, 'TargetMode') === 'External') throw new Error('Lembar soal tidak ditemukan.');
  const target = attr(relation, 'Target');
  const path = new URL(target, 'https://file.local/xl/workbook.xml').pathname.slice(1);
  if (!/^xl\/worksheets\//.test(path) || !files[path]) throw new Error('Lembar pertama tidak dapat dibaca.');
  const shared = files['xl/sharedStrings.xml'] ? nodes(xml(files['xl/sharedStrings.xml']), 'si').map(si => nodes(si, 't').map(t => t.textContent).join('')) : [];
  const sheetDoc = xml(files[path]);
  const rows = nodes(sheetDoc, 'row').map(row => {
    const values = [];
    for (const cell of nodes(row, 'c')) {
      const ref = attr(cell, 'r');
      if (!/^[A-Z]+[1-9]\d*$/.test(ref ?? '')) throw new Error('Alamat sel Excel tidak valid.');
      const col = ref.match(/^[A-Z]+/)[0].split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      if (col > 100) continue;
      if (nodes(cell, 'f').length) throw new Error('Sel ' + ref + ' berisi rumus. Ubah menjadi teks atau nilai sebelum mengunggah.');
      const v = nodes(cell, 'v')[0]?.textContent ?? '';
      values[col] = attr(cell, 't') === 's' ? shared[Number(v)] ?? '' : attr(cell, 't') === 'inlineStr' ? nodes(cell, 't').map(t => t.textContent).join('') : v;
    }
    return values;
  });
  const result = tableRows(rows);
  if (!result) throw new Error('Kolom Pertanyaan tidak ditemukan pada lembar pertama. Gunakan template Excel.');
  return result;
}
function wordText(el) {
  let result = '';
  for (const child of el.childNodes) {
    if (child.localName === 't') result += child.textContent;
    else if (['br', 'cr'].includes(child.localName)) result += '\n';
    else if (child.localName === 'tab') result += ' ';
    else if (child.nodeType === 1 && !['del', 'delText'].includes(child.localName)) result += wordText(child);
  }
  return result;
}
function word(files) {
  if (!files['word/document.xml']) throw new Error('Berkas bukan Word .docx yang valid.');
  const doc = xml(files['word/document.xml']);
  if (nodes(doc, 'drawing').length || nodes(doc, 'pict').length || nodes(doc, 'oMath').length) throw new Error('Impor saat ini mendukung teks. Hapus gambar atau persamaan dari berkas soal terlebih dahulu.');
  const tables = nodes(doc, 'tbl').map(t => tableRows(nodes(t, 'tr').map(r => [...r.children].filter(c => c.localName === 'tc').map(c => nodes(c, 'p').map(wordText).join('\n'))))).filter(Boolean);
  if (tables.length) return tables.flat();
  const rows = []; let current;
  for (const line of nodes(doc, 'p').flatMap(p => wordText(p).split('\n')).map(clean).filter(Boolean)) {
    const question = line.match(/^(?:\d+[.)]\s*|(?:pertanyaan|soal)\s*:\s*)(.+)$/i);
    if (question) {
      current = { prompt: question[1], options: ['', '', '', ''], source: 'Soal ' + (rows.length + 1) };
      rows.push(current); continue;
    }
    if (!current) continue;
    const option = line.match(/^([A-D])[.)]\s*(.+)$/i);
    const meta = line.match(/^(kunci(?: jawaban)?|jawaban|bobot|poin|kelas|jenis)\s*:\s*(.*)$/i);
    if (option) current.options[option[1].toUpperCase().charCodeAt(0) - 65] = option[2];
    else if (meta) {
      const target = /kunci|jawaban/i.test(meta[1]) ? 'correct' : /bobot|poin/i.test(meta[1]) ? 'points' : /kelas/i.test(meta[1]) ? 'cohort' : 'type';
      current[target] = meta[2];
    } else current.prompt += '\n' + line;
  }
  if (!rows.length) throw new Error('Tidak ada soal terbaca. Gunakan penomoran “1. Pertanyaan” atau template Word.');
  return rows;
}
export function validateImport(rows, defaultCohort) {
  if (!rows.length || rows.length > 100) throw new Error('Unggah 1–100 soal per berkas.');
  const errors = [], valid = [];
  rows.forEach((row, index) => {
    const label = row.source ?? 'Soal ' + (index + 1);
    const error = text => errors.push(label + ': ' + text);
    const prompt = clean(row.prompt), rawType = key(row.type);
    const type = !rawType || ['pg', 'pilihanganda', 'choice', 'multiplechoice', 'mcq'].includes(rawType) ? 'choice' : ['esai', 'essay', 'uraian', 'openended'].includes(rawType) ? 'essay' : null;
    const cohortRaw = key(row.cohort || defaultCohort).replace(/^kelas/, '');
    const cohort = ({ x: 'X', '10': 'X', xi: 'XI', '11': 'XI' })[cohortRaw];
    const points = clean(row.points) ? Number(row.points) : 10;
    const options = (row.options ?? []).map(clean);
    const answer = clean(row.correct).toUpperCase();
    const correct = /^[A-D]$/.test(answer) ? answer.charCodeAt(0) - 65 : /^[1-4]$/.test(answer) ? Number(answer) - 1 : -1;
    if (!prompt || prompt.length > 1500) error('pertanyaan wajib diisi, maksimal 1.500 karakter.');
    if (!type) error('jenis harus PG atau Esai.');
    if (row.extraOptions) error('portal mendukung empat pilihan A–D. Hapus pilihan tambahan.');
    if (!cohort) error('kelas harus X atau XI.');
    if (!Number.isInteger(points) || points < 1 || points > 100) error('bobot harus bilangan bulat 1–100.');
    if (type === 'choice' && (options.length !== 4 || options.some(v => !v || v.length > 500))) error('isi pilihan A–D, masing-masing maksimal 500 karakter.');
    if (type === 'choice' && correct < 0) error('kunci harus A–D atau 1–4.');
    valid.push({ id: crypto.randomUUID(), prompt, type, cohort, points, ...(type === 'choice' ? { options, correct } : {}) });
  });
  return { rows: valid, errors };
}
export async function readQuestionFile(file, defaultCohort) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['docx', 'xlsx'].includes(ext)) throw new Error('Pilih Word .docx atau Excel .xlsx. Berkas .doc dan .xls perlu disimpan ulang ke format terbaru.');
  if (!file.size || file.size > MAX_FILE) throw new Error('Ukuran berkas harus antara 1 byte dan 5 MB.');
  let files;
  try { files = unpack(await file.arrayBuffer()); }
  catch (error) { throw new Error(error.message?.startsWith('Berkas') || error.message?.startsWith('Isi berkas') ? error.message : 'Berkas rusak, terkunci, atau bukan format Word/Excel yang didukung.'); }
  return validateImport(ext === 'docx' ? word(files) : excel(files), defaultCohort);
}
