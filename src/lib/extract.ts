import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './env.ts';

/**
 * Local document text extraction and metadata *suggestion*.
 *
 * Three rules this module obeys:
 *  1. It suggests, never saves. Every field needs human confirmation.
 *  2. Confidence is capped at 'medium'. Parsed text is never presented as certain.
 *  3. It never converts a medical instruction into a date or a schedule.
 *     "Review after 4 weeks" is surfaced as text for a person to act on — it is
 *     deliberately not turned into a follow-up date.
 */

export const OCR_MODEL_DIR = join(DATA_DIR, 'ocr-models');
export const OCR_LANGS = ['eng', 'hin', 'ben'] as const;

export type DocumentCategory =
  | 'prescription' | 'lab_report' | 'visit_record' | 'discharge_summary'
  | 'referral_letter' | 'vaccination_record' | 'insurance' | 'other';

export type Suggestions = {
  category: DocumentCategory | null;
  documentDate: string | null;
  providerName: string | null;
  patientName: string | null;
  followupDate: string | null;
  /** Follow-up wording that is NOT a date. Shown verbatim for a person to read. */
  followupNote: string | null;
  referenceIds: string[];
};

export type ExtractionResult = {
  engine: 'pdf-text' | 'image-ocr' | 'plain-text' | 'none';
  status: 'extracted' | 'no_text_layer' | 'unsupported' | 'failed';
  text: string | null;
  /** Plain-language explanation shown in the review step. */
  note: string | null;
  confidence: 'low' | 'medium';
  suggestions: Suggestions;
};

const EMPTY: Suggestions = {
  category: null, documentDate: null, providerName: null, patientName: null,
  followupDate: null, followupNote: null, referenceIds: [],
};

export function ocrAvailable(): boolean {
  return existsSync(join(OCR_MODEL_DIR, 'eng.traineddata.gz'))
      || existsSync(join(OCR_MODEL_DIR, 'eng.traineddata'));
}

// ------------------------------------------------------------------ extraction

async function extractPdf(bytes: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: String(text ?? ''), pages: totalPages };
}

async function extractImage(bytes: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    // A local directory means no network call at runtime.
    langPath: OCR_MODEL_DIR,
    cacheMethod: 'none',
    gzip: true,
    logger: () => {},
  });
  try {
    const { data } = await worker.recognize(bytes);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

export async function extractDocument(
  bytes: Buffer, mimeType: string,
): Promise<ExtractionResult> {
  try {
    if (mimeType === 'application/pdf') {
      const { text } = await extractPdf(bytes);
      const clean = normalise(text);
      if (clean.length < 12) {
        return {
          engine: 'pdf-text', status: 'no_text_layer', text: null, confidence: 'low',
          note: 'This PDF has no readable text layer — it is probably a scan. Please fill in the details below yourself.',
          suggestions: EMPTY,
        };
      }
      return { engine: 'pdf-text', status: 'extracted', text: clean, confidence: 'medium',
               note: null, suggestions: suggestFrom(clean) };
    }

    if (mimeType === 'text/plain') {
      const clean = normalise(bytes.toString('utf8'));
      return { engine: 'plain-text', status: 'extracted', text: clean, confidence: 'medium',
               note: null, suggestions: suggestFrom(clean) };
    }

    if (mimeType.startsWith('image/')) {
      if (!ocrAvailable()) {
        return {
          engine: 'none', status: 'unsupported', text: null, confidence: 'low',
          note: 'Image text recognition is not set up on this server, so nothing was read from this picture. Run `npm run setup:ocr` once to enable it, or type the details in below.',
          suggestions: EMPTY,
        };
      }
      const clean = normalise(await extractImage(bytes));
      if (clean.length < 12) {
        return {
          engine: 'image-ocr', status: 'no_text_layer', text: null, confidence: 'low',
          note: 'No readable text was found in this image. Please fill in the details below yourself.',
          suggestions: EMPTY,
        };
      }
      return {
        engine: 'image-ocr', status: 'extracted', text: clean, confidence: 'low',
        note: 'Text was read from a photo, so it may contain mistakes. Please check every field before saving.',
        suggestions: suggestFrom(clean),
      };
    }

    return { engine: 'none', status: 'unsupported', text: null, confidence: 'low',
             note: 'This file type cannot be read automatically.', suggestions: EMPTY };
  } catch (err) {
    return {
      engine: 'none', status: 'failed', text: null, confidence: 'low',
      note: `The file could not be read automatically (${(err as Error).message}). You can still fill in the details yourself.`,
      suggestions: EMPTY,
    };
  }
}

function normalise(text: string): string {
  // eslint-disable-next-line no-control-regex -- stripping NULs is the point
  return text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// -------------------------------------------------------------- classification

const CATEGORY_RULES: { category: DocumentCategory; terms: RegExp[]; weight?: number }[] = [
  { category: 'prescription', terms: [/\brx\b/i, /prescription/i, /\btablet?s?\b/i, /\bcap(sule)?s?\b/i,
      /\b(bd|tds|od|hs|sos|qid)\b/i, /\bmg\b/i, /after (food|meals)/i, /dosage/i] },
  { category: 'lab_report', terms: [/laborator/i, /\bpathology\b/i, /reference range/i, /\bspecimen\b/i,
      /\bhaemoglobin|hemoglobin\b/i, /\bcbc\b/i, /\bserum\b/i, /\bresult(s)?\b/i, /\bunits?\b.*\brange\b/i,
      /\bhba1c\b/i, /\blipid profile\b/i] },
  { category: 'discharge_summary', terms: [/discharge summary/i, /date of discharge/i,
      /\badmitted\b/i, /course in hospital/i, /\bipd?\s*no/i] },
  { category: 'referral_letter', terms: [/referr?al/i, /kindly see and do the needful/i,
      /refer(red)? to (dr|the)/i] },
  { category: 'vaccination_record', terms: [/vaccinat/i, /immunis|immuniz/i, /\bdose [12]\b/i,
      /\bbooster\b/i, /batch no/i] },
  { category: 'insurance', terms: [/\bpolicy\s*(no|number)/i, /\binsur/i, /\bclaim\b/i, /\btpa\b/i,
      /sum insured/i, /\bcashless\b/i] },
  { category: 'visit_record', terms: [/consultation/i, /\bopd\b/i, /chief complaint/i,
      /\bdiagnosis\b/i, /follow ?up/i, /clinic/i] },
];

export function classify(text: string): { category: DocumentCategory | null; score: number } {
  let best: DocumentCategory | null = null;
  let bestScore = 0;
  for (const rule of CATEGORY_RULES) {
    const hits = rule.terms.filter((t) => t.test(text)).length;
    if (hits > bestScore) { bestScore = hits; best = rule.category; }
  }
  // One weak keyword is not a classification.
  return bestScore >= 2 ? { category: best, score: bestScore } : { category: null, score: bestScore };
}

// ------------------------------------------------------------------ date parse

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // rejects 31 Feb
  return dt.toISOString().slice(0, 10);
}

/**
 * Finds dates in Indian-convention order. For an all-numeric date the first
 * component is read as the day, which is the dominant written form in India.
 * A value that cannot be a day-first date is tried month-first before being
 * discarded.
 */
export function findDates(text: string): string[] {
  const out: string[] = [];
  const numeric = /\b(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g;
  for (const m of text.matchAll(numeric)) {
    const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
    if (String(m[1]).length === 4) { // YYYY-MM-DD
      const v = iso(a, b, c); if (v) out.push(v); continue;
    }
    const year = c < 100 ? 2000 + c : c;
    const dayFirst = iso(year, b, a);
    if (dayFirst) { out.push(dayFirst); continue; }
    const monthFirst = iso(year, a, b);
    if (monthFirst) out.push(monthFirst);
  }
  const named = /\b(\d{1,2})\s*(?:st|nd|rd|th)?[\s-]*([A-Za-z]{3,9})\.?[\s,-]*(\d{2,4})\b/g;
  for (const m of text.matchAll(named)) {
    const month = MONTHS[m[2]!.slice(0, 4).toLowerCase()] ?? MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (!month) continue;
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const v = iso(year, month, Number(m[1]));
    if (v) out.push(v);
  }
  const monthNamed = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*(?:st|nd|rd|th)?,?\s*(\d{4})\b/g;
  for (const m of text.matchAll(monthNamed)) {
    const month = MONTHS[m[1]!.slice(0, 4).toLowerCase()] ?? MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    if (!month) continue;
    const v = iso(Number(m[3]), month, Number(m[2]));
    if (v) out.push(v);
  }
  return [...new Set(out)];
}

const FOLLOWUP_CUE = /(follow[\s-]?up|review|revisit|next visit|come back|recheck|repeat)/i;

/**
 * A follow-up date is returned ONLY when an explicit calendar date sits near a
 * follow-up cue. Relative wording ("review after 4 weeks") is returned as a note
 * for a person to read — turning it into a date would be interpreting a
 * clinician's instruction, which this software must not do.
 */
export function findFollowup(text: string): { date: string | null; note: string | null } {
  const lines = text.split(/[\n.;]+/);
  for (const line of lines) {
    if (!FOLLOWUP_CUE.test(line)) continue;
    const dates = findDates(line);
    if (dates.length) return { date: dates[0]!, note: line.trim().slice(0, 160) };
  }
  for (const line of lines) {
    if (FOLLOWUP_CUE.test(line)) return { date: null, note: line.trim().slice(0, 160) };
  }
  return { date: null, note: null };
}

export function findProvider(text: string): string | null {
  const m = text.match(/\bDr\.?\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})/);
  if (m) return `Dr. ${m[1]!.trim().replace(/[,.]$/, '')}`;
  const labelled = text.match(/(?:consultant|physician|doctor|referred by)\s*[:-]\s*([^\n,]{3,60})/i);
  return labelled ? labelled[1]!.trim() : null;
}

export function findPatientName(text: string): string | null {
  // The character class excludes newlines on purpose: without that, "Patient: X"
  // followed by another labelled line swallows the next label too.
  const m = text.match(/(?:patient(?:'s)?\s*name|patient|name)[^\S\n]*[:-][^\S\n]*([A-Za-z][A-Za-z.' -]{2,50})/i);
  if (!m) return null;
  const value = m[1]!.split(/\s{2,}|\||,/)[0]!.trim();
  // Reject label collisions like "Name: Age" or an empty capture.
  if (/^(age|sex|gender|date|dob|id)\b/i.test(value) || value.length < 3) return null;
  return value;
}

export function findReferenceIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\b(?:report|lab|ref|bill|invoice|uhid|ip|op|policy|claim)[\s.#:-]{0,3}(?:no\.?|number|id)?[\s.#:-]{0,3}([A-Z0-9][A-Z0-9/-]{3,24})\b/gi)) {
    const value = m[1]!.toUpperCase();
    if (/\d/.test(value)) ids.add(value);
  }
  return [...ids].slice(0, 6);
}

export function suggestFrom(text: string): Suggestions {
  const dates = findDates(text);
  const followup = findFollowup(text);
  return {
    category: classify(text).category,
    // Earliest date in the document is the usual "document date"; the user confirms.
    documentDate: dates.length ? dates.slice().sort()[0]! : null,
    providerName: findProvider(text),
    patientName: findPatientName(text),
    followupDate: followup.date,
    followupNote: followup.note,
    referenceIds: findReferenceIds(text),
  };
}
