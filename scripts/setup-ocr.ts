/**
 * One-time, opt-in download of the Tesseract English model so image OCR can run
 * entirely offline afterwards. Nothing here needs an account or an API key, and
 * the app works without it — images simply report that no text could be read.
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OCR_MODEL_DIR, OCR_LANGS } from '../src/lib/extract.ts';

const BASE = 'https://tessdata.projectnaptha.com/4.0.0';

mkdirSync(OCR_MODEL_DIR, { recursive: true });
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const langs = wanted.length ? wanted : ['eng'];

for (const lang of langs) {
  if (!(OCR_LANGS as readonly string[]).includes(lang)) {
    console.error(`unknown language "${lang}". Known: ${OCR_LANGS.join(', ')}`);
    process.exit(1);
  }
  const target = join(OCR_MODEL_DIR, `${lang}.traineddata.gz`);
  if (existsSync(target)) { console.log(`${lang}: already present`); continue; }
  process.stdout.write(`${lang}: downloading... `);
  const res = await fetch(`${BASE}/${lang}.traineddata.gz`);
  if (!res.ok) { console.error(`failed (HTTP ${res.status})`); process.exit(1); }
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log('done');
}
console.log(`models in ${OCR_MODEL_DIR} — image OCR now runs offline.`);
