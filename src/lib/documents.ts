import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { all, one, tx } from '../db/index.ts';
import { newId } from './ids.ts';
import { nowIso } from './time.ts';
import { audit, recordActivity } from './audit.ts';
import { decryptBuffer, encryptBuffer, sha256 } from './crypto.ts';
import { ALLOWED_UPLOAD_TYPES, DOCS_DIR, MAX_UPLOAD_BYTES, type AllowedMime } from './env.ts';
import {
  AuthzError, assertCan, assertCanReadDocument, canReadDocument, ownsProfile, profileScopeFilter,
} from './authz.ts';
import { extractDocument, type DocumentCategory } from './extract.ts';

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  prescription: 'Prescription',
  lab_report: 'Laboratory report',
  visit_record: 'Doctor visit record',
  discharge_summary: 'Discharge summary',
  referral_letter: 'Referral letter',
  vaccination_record: 'Vaccination record',
  insurance: 'Insurance document',
  other: 'Other',
};

/**
 * Trusting a browser-supplied Content-Type would let an HTML or SVG payload in
 * as "image/png". The declared type must agree with the actual bytes.
 */
export function sniffMime(bytes: Buffer): AllowedMime | 'unknown' {
  const hex = bytes.subarray(0, 12);
  if (hex.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (hex[0] === 0x89 && hex.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (hex[0] === 0xff && hex[1] === 0xd8 && hex[2] === 0xff) return 'image/jpeg';
  if (hex.subarray(0, 4).toString('latin1') === 'RIFF'
      && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const ftyp = bytes.subarray(4, 12).toString('latin1');
  if (ftyp.startsWith('ftypheic') || ftyp.startsWith('ftypheix')
      || ftyp.startsWith('ftypmif1') || ftyp.startsWith('ftyphevc')) return 'image/heic';
  // Plain text: valid UTF-8, no NUL bytes, and not sneaking in markup.
  if (!bytes.includes(0)) {
    const text = bytes.toString('utf8');
    if (!text.includes('�') && !/^\s*<(!doctype|html|svg|\?xml)/i.test(text)) return 'text/plain';
  }
  return 'unknown';
}

/** Strips directories, control characters and anything that could escape the store. */
export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'document';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- removing control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned.slice(0, 120) || 'document');
}

export type UploadInput = {
  actorUserId: string;
  careProfileId: string;
  filename: string;
  declaredMime: string;
  bytes: Buffer;
  title?: string;
  category?: DocumentCategory;
  notes?: string | null;
  tags?: string[];
  sensitivity?: 'standard' | 'restricted';
  isDemo?: boolean;
};

export type UploadResult = {
  documentId: string;
  versionId: string;
  extraction: Awaited<ReturnType<typeof extractDocument>>;
  /** Possible duplicates for the user to review. Nothing is ever auto-deleted. */
  duplicates: { documentId: string; title: string; reason: 'identical_file' | 'same_name_and_date' }[];
};

export async function uploadDocument(input: UploadInput): Promise<UploadResult> {
  assertCan(input.actorUserId, 'records:upload', input.careProfileId, 'document:upload');

  if (input.bytes.byteLength === 0) throw new Error('That file is empty.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Files must be ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.`);
  }
  if (!(input.declaredMime in ALLOWED_UPLOAD_TYPES)) {
    throw new Error('That file type is not accepted. Use PDF, JPEG, PNG, WebP, HEIC or plain text.');
  }
  const sniffed = sniffMime(input.bytes);
  if (sniffed === 'unknown' || sniffed !== input.declaredMime) {
    throw new Error('The file contents do not match its stated type, so it was not accepted.');
  }

  const hash = sha256(input.bytes);
  const duplicates = duplicateCandidates(input.careProfileId, hash, input.title ?? input.filename);

  // Extraction runs before the transaction: it is async and must not hold a write lock.
  const extraction = await extractDocument(input.bytes, sniffed);

  const documentId = newId('doc');
  const versionId = newId('dv');
  const storagePath = join(input.careProfileId, `${versionId}.enc`);
  const absolute = join(DOCS_DIR, storagePath);
  const { ciphertext, iv, tag } = encryptBuffer(input.bytes);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, ciphertext, { mode: 0o600 });

  const now = nowIso();
  const title = (input.title?.trim() || safeFilename(input.filename).replace(/\.[^.]+$/, '')) || 'Untitled document';
  const category = input.category ?? 'other';

  try {
    tx((d) => {
      d.prepare(
        `INSERT INTO medical_documents
         (id, care_profile_id, uploaded_by_user_id, title, category, category_source,
          notes, tags, sensitivity, is_demo, created_at, updated_at)
         VALUES (?,?,?,?,?,'user',?,?,?,?,?,?)`,
      ).run(documentId, input.careProfileId, input.actorUserId, title, category,
            input.notes ?? null, JSON.stringify(input.tags ?? []),
            input.sensitivity ?? 'standard', input.isDemo ? 1 : 0, now, now);

      d.prepare(
        `INSERT INTO document_versions
         (id, document_id, version_number, storage_path, original_filename, mime_type,
          byte_size, sha256, enc_iv, enc_tag, uploaded_by_user_id, created_at)
         VALUES (?,?,1,?,?,?,?,?,?,?,?,?)`,
      ).run(versionId, documentId, storagePath, safeFilename(input.filename), sniffed,
            input.bytes.byteLength, hash, iv, tag, input.actorUserId, now);

      d.prepare('UPDATE medical_documents SET current_version_id = ? WHERE id = ?')
        .run(versionId, documentId);

      d.prepare(
        `INSERT INTO document_extractions
         (id, document_version_id, engine, status, extracted_text, suggested_category,
          suggested_document_date, suggested_provider_name, suggested_patient_name,
          suggested_followup_date, suggested_reference_ids, confidence, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(newId('dex'), versionId, extraction.engine, extraction.status, extraction.text,
            extraction.suggestions.category, extraction.suggestions.documentDate,
            extraction.suggestions.providerName, extraction.suggestions.patientName,
            extraction.suggestions.followupDate,
            JSON.stringify(extraction.suggestions.referenceIds), extraction.confidence, now);

      reindex(d, documentId);
    });
  } catch (err) {
    rmSync(absolute, { force: true }); // never leave an orphan blob behind
    throw err;
  }

  audit({
    actorUserId: input.actorUserId, action: 'document:upload', resourceType: 'medical_document',
    resourceId: documentId, careProfileId: input.careProfileId, outcome: 'allowed',
    detail: { bytes: input.bytes.byteLength, mime: sniffed, engine: extraction.engine,
              extraction_status: extraction.status, duplicate_candidates: duplicates.length },
  });
  recordActivity({
    careProfileId: input.careProfileId, actorUserId: input.actorUserId, kind: 'document_added',
    summary: `${CATEGORY_LABELS[category]} added: ${title}`,
    subjectType: 'medical_document', subjectId: documentId, requiredScope: 'records:view',
  });

  return { documentId, versionId, extraction, duplicates };
}

/** Adds a new version of an existing document. Earlier versions stay readable. */
export async function addDocumentVersion(input: {
  actorUserId: string; documentId: string; filename: string; declaredMime: string; bytes: Buffer;
}): Promise<{ versionId: string; versionNumber: number }> {
  const doc = one<{ care_profile_id: string; title: string }>(
    'SELECT care_profile_id, title FROM medical_documents WHERE id = ? AND deleted_at IS NULL',
    input.documentId,
  );
  if (!doc) throw new Error('That document no longer exists.');
  assertCan(input.actorUserId, 'records:upload', doc.care_profile_id, 'document:version');

  const sniffed = sniffMime(input.bytes);
  if (sniffed === 'unknown' || sniffed !== input.declaredMime) {
    throw new Error('The file contents do not match its stated type, so it was not accepted.');
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('That file is too large.');

  const extraction = await extractDocument(input.bytes, sniffed);
  const versionId = newId('dv');
  const next = (one<{ n: number }>(
    'SELECT COALESCE(MAX(version_number),0) + 1 AS n FROM document_versions WHERE document_id = ?',
    input.documentId,
  )?.n) ?? 1;
  const storagePath = join(doc.care_profile_id, `${versionId}.enc`);
  const absolute = join(DOCS_DIR, storagePath);
  const { ciphertext, iv, tag } = encryptBuffer(input.bytes);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, ciphertext, { mode: 0o600 });
  const now = nowIso();
  try {
    tx((d) => {
      d.prepare(
        `INSERT INTO document_versions
         (id, document_id, version_number, storage_path, original_filename, mime_type,
          byte_size, sha256, enc_iv, enc_tag, uploaded_by_user_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(versionId, input.documentId, next, storagePath, safeFilename(input.filename), sniffed,
            input.bytes.byteLength, sha256(input.bytes), iv, tag, input.actorUserId, now);
      d.prepare('UPDATE medical_documents SET current_version_id = ?, updated_at = ? WHERE id = ?')
        .run(versionId, now, input.documentId);
      d.prepare(
        `INSERT INTO document_extractions
         (id, document_version_id, engine, status, extracted_text, suggested_category,
          suggested_document_date, suggested_provider_name, suggested_patient_name,
          suggested_followup_date, suggested_reference_ids, confidence, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(newId('dex'), versionId, extraction.engine, extraction.status, extraction.text,
            extraction.suggestions.category, extraction.suggestions.documentDate,
            extraction.suggestions.providerName, extraction.suggestions.patientName,
            extraction.suggestions.followupDate,
            JSON.stringify(extraction.suggestions.referenceIds), extraction.confidence, now);
      reindex(d, input.documentId);
    });
  } catch (err) {
    rmSync(absolute, { force: true });
    throw err;
  }
  audit({ actorUserId: input.actorUserId, action: 'document:version',
          resourceType: 'medical_document', resourceId: input.documentId,
          careProfileId: doc.care_profile_id, outcome: 'allowed', detail: { version: next } });
  recordActivity({ careProfileId: doc.care_profile_id, actorUserId: input.actorUserId,
                   kind: 'document_version', summary: `New version of "${doc.title}" (v${next})`,
                   subjectType: 'medical_document', subjectId: input.documentId,
                   requiredScope: 'records:view' });
  return { versionId, versionNumber: next };
}

/**
 * Duplicate *candidates*, for a person to review. An identical file hash is a
 * strong signal; a matching title is a weak one. Neither ever deletes anything.
 */
export function duplicateCandidates(
  careProfileId: string, hash: string, title: string,
): UploadResult['duplicates'] {
  const byHash = all<{ id: string; title: string }>(
    `SELECT DISTINCT d.id, d.title FROM medical_documents d
     JOIN document_versions v ON v.document_id = d.id
     WHERE d.care_profile_id = ? AND v.sha256 = ? AND d.deleted_at IS NULL`,
    careProfileId, hash,
  ).map((r) => ({ documentId: r.id, title: r.title, reason: 'identical_file' as const }));

  const byName = all<{ id: string; title: string }>(
    `SELECT id, title FROM medical_documents
     WHERE care_profile_id = ? AND lower(title) = lower(?) AND deleted_at IS NULL`,
    careProfileId, title.trim(),
  )
    .filter((r) => !byHash.some((h) => h.documentId === r.id))
    .map((r) => ({ documentId: r.id, title: r.title, reason: 'same_name_and_date' as const }));

  return [...byHash, ...byName];
}

type Writable = { prepare: (sql: string) => { run: (...a: never[]) => unknown } };

function reindex(d: Writable, documentId: string): void {
  d.prepare('DELETE FROM document_search WHERE document_id = ?').run(documentId as never);
  d.prepare(
    `INSERT INTO document_search (document_id, care_profile_id, title, provider_name, notes, tags, body)
     SELECT d.id, d.care_profile_id, d.title, COALESCE(d.provider_name,''),
            COALESCE(d.notes,''), COALESCE(d.tags,''),
            COALESCE((SELECT e.extracted_text FROM document_extractions e
                      WHERE e.document_version_id = d.current_version_id), '')
     FROM medical_documents d WHERE d.id = ?`,
  ).run(documentId as never);
}

/** Saves metadata the user has reviewed. Suggestions never land without this step. */
export function confirmDocumentMetadata(input: {
  actorUserId: string; documentId: string; title: string; category: DocumentCategory;
  documentDate: string | null; providerName: string | null; notes: string | null;
  tags: string[]; sensitivity: 'standard' | 'restricted'; fromSuggestion: boolean;
}): void {
  const doc = one<{ care_profile_id: string; current_version_id: string | null }>(
    'SELECT care_profile_id, current_version_id FROM medical_documents WHERE id = ? AND deleted_at IS NULL',
    input.documentId,
  );
  if (!doc) throw new Error('That document no longer exists.');
  // Editing metadata requires being able to read the document, not merely upload.
  assertCanReadDocument(input.actorUserId, input.documentId);
  if (!ownsProfile(input.actorUserId, doc.care_profile_id)) {
    assertCan(input.actorUserId, 'records:upload', doc.care_profile_id, 'document:update');
  }
  tx((d) => {
    d.prepare(
      `UPDATE medical_documents SET title = ?, category = ?, category_source = ?,
         document_date = ?, provider_name = ?, notes = ?, tags = ?, sensitivity = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.title.trim(), input.category,
          input.fromSuggestion ? 'suggestion_confirmed' : 'user',
          input.documentDate, input.providerName, input.notes,
          JSON.stringify(input.tags), input.sensitivity, nowIso(), input.documentId);
    if (doc.current_version_id) {
      d.prepare(
        `UPDATE document_extractions SET reviewed_at = ?, reviewed_by_user_id = ?
         WHERE document_version_id = ?`,
      ).run(nowIso(), input.actorUserId, doc.current_version_id);
    }
    reindex(d, input.documentId);
  });
  audit({ actorUserId: input.actorUserId, action: 'document:metadata_confirmed',
          resourceType: 'medical_document', resourceId: input.documentId,
          careProfileId: doc.care_profile_id, outcome: 'allowed',
          detail: { category: input.category, sensitivity: input.sensitivity } });
}

export type DocumentRow = {
  id: string; care_profile_id: string; profile_name: string; title: string;
  category: DocumentCategory; document_date: string | null; provider_name: string | null;
  notes: string | null; tags: string; sensitivity: string; created_at: string; updated_at: string;
  uploaded_by: string; version_count: number; mime_type: string | null; byte_size: number | null;
  extraction_status: string | null; extraction_reviewed: string | null;
};

const DOC_SELECT = `
  SELECT d.id, d.care_profile_id, p.display_name AS profile_name, d.title, d.category,
         d.document_date, d.provider_name, d.notes, d.tags, d.sensitivity, d.created_at,
         d.updated_at, u.full_name AS uploaded_by,
         (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id) AS version_count,
         cv.mime_type, cv.byte_size,
         e.status AS extraction_status, e.reviewed_at AS extraction_reviewed
  FROM medical_documents d
  JOIN care_profiles p ON p.id = d.care_profile_id
  JOIN users u ON u.id = d.uploaded_by_user_id
  LEFT JOIN document_versions cv ON cv.id = d.current_version_id
  LEFT JOIN document_extractions e ON e.document_version_id = d.current_version_id`;

export type DocumentFilter = {
  careProfileId?: string | null; category?: DocumentCategory | null;
  provider?: string | null; tag?: string | null; from?: string | null; to?: string | null;
  limit?: number; offset?: number;
};

/**
 * Permission-scoped list. The profile filter is applied in SQL, so a document the
 * caller may not see is never selected — a forgotten per-row check cannot leak it.
 * Restricted documents are filtered out unless the caller owns the profile or
 * holds a grant naming that document.
 */
export function listDocuments(userId: string, filter: DocumentFilter = {}): DocumentRow[] {
  const scope = profileScopeFilter(userId, 'records:view', 'd.care_profile_id');
  const where: string[] = [scope.sql, 'd.deleted_at IS NULL'];
  const params: unknown[] = [...scope.params];

  where.push(`(p.owner_user_id = ?
               OR d.sensitivity = 'standard'
               OR EXISTS (SELECT 1 FROM access_grants g
                          WHERE g.document_id = d.id AND g.grantee_user_id = ?
                            AND g.scope = 'records:view' AND g.revoked_at IS NULL
                            AND (g.expires_at IS NULL OR g.expires_at > ?)))`);
  params.push(userId, userId, nowIso());

  if (filter.careProfileId) { where.push('d.care_profile_id = ?'); params.push(filter.careProfileId); }
  if (filter.category) { where.push('d.category = ?'); params.push(filter.category); }
  if (filter.provider) { where.push('d.provider_name LIKE ?'); params.push(`%${filter.provider}%`); }
  if (filter.tag) { where.push('d.tags LIKE ?'); params.push(`%"${filter.tag}"%`); }
  if (filter.from) { where.push('COALESCE(d.document_date, d.created_at) >= ?'); params.push(filter.from); }
  if (filter.to) { where.push('COALESCE(d.document_date, d.created_at) <= ?'); params.push(filter.to); }

  params.push(filter.limit ?? 50, filter.offset ?? 0);
  return all<DocumentRow>(
    `${DOC_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(d.document_date, date(d.created_at)) DESC, d.created_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
  );
}

export function countDocuments(userId: string, filter: DocumentFilter = {}): number {
  // Reuse the same scoping by counting the rows the list query would select.
  return listDocuments(userId, { ...filter, limit: 10_000, offset: 0 }).length;
}

export function getDocument(userId: string, documentId: string): DocumentRow | undefined {
  if (!canReadDocument(userId, documentId)) return undefined;
  return one<DocumentRow>(`${DOC_SELECT} WHERE d.id = ? AND d.deleted_at IS NULL`, documentId);
}

export function documentVersions(userId: string, documentId: string) {
  assertCanReadDocument(userId, documentId);
  return all<{ id: string; version_number: number; original_filename: string; mime_type: string;
               byte_size: number; created_at: string; uploaded_by: string; sha256: string }>(
    `SELECT v.id, v.version_number, v.original_filename, v.mime_type, v.byte_size,
            v.created_at, v.sha256, u.full_name AS uploaded_by
     FROM document_versions v JOIN users u ON u.id = v.uploaded_by_user_id
     WHERE v.document_id = ? ORDER BY v.version_number DESC`,
    documentId,
  );
}

export function documentExtraction(userId: string, documentId: string) {
  assertCanReadDocument(userId, documentId);
  return one<{
    engine: string; status: string; extracted_text: string | null; confidence: string;
    suggested_category: string | null; suggested_document_date: string | null;
    suggested_provider_name: string | null; suggested_patient_name: string | null;
    suggested_followup_date: string | null; suggested_reference_ids: string;
    reviewed_at: string | null;
  }>(
    `SELECT e.* FROM document_extractions e
     JOIN medical_documents d ON d.current_version_id = e.document_version_id
     WHERE d.id = ?`,
    documentId,
  );
}

/**
 * Decrypts a stored document for an authorised caller and records the access.
 * Blobs live outside the web root; this is the only way bytes come back out.
 */
export function readDocumentBytes(
  userId: string, documentId: string, versionId?: string,
): { bytes: Buffer; filename: string; mimeType: string } {
  assertCanReadDocument(userId, documentId);
  const version = one<{
    id: string; storage_path: string; original_filename: string; mime_type: string;
    enc_iv: string; enc_tag: string; care_profile_id: string;
  }>(
    `SELECT v.id, v.storage_path, v.original_filename, v.mime_type, v.enc_iv, v.enc_tag,
            d.care_profile_id
     FROM document_versions v JOIN medical_documents d ON d.id = v.document_id
     WHERE v.document_id = ? AND d.deleted_at IS NULL
       AND v.id = COALESCE(?, d.current_version_id)`,
    documentId, versionId ?? null,
  );
  if (!version) throw new AuthzError('That document version is not available.');
  const ciphertext = readFileSync(join(DOCS_DIR, version.storage_path));
  const bytes = decryptBuffer(ciphertext, version.enc_iv, version.enc_tag);
  audit({
    actorUserId: userId, action: 'document:download', resourceType: 'medical_document',
    resourceId: documentId, careProfileId: version.care_profile_id, outcome: 'allowed',
    detail: { version: version.id, bytes: bytes.byteLength },
  });
  return { bytes, filename: version.original_filename, mimeType: version.mime_type };
}

export function deleteDocument(userId: string, documentId: string): void {
  const doc = one<{ care_profile_id: string; title: string }>(
    'SELECT care_profile_id, title FROM medical_documents WHERE id = ? AND deleted_at IS NULL',
    documentId,
  );
  if (!doc) return;
  // Only the person the records belong to may remove them.
  if (!ownsProfile(userId, doc.care_profile_id)) {
    audit({ actorUserId: userId, action: 'document:delete', resourceType: 'medical_document',
            resourceId: documentId, careProfileId: doc.care_profile_id, outcome: 'denied' });
    throw new AuthzError('Only the person these records belong to can delete them.');
  }
  const paths = all<{ storage_path: string }>(
    'SELECT storage_path FROM document_versions WHERE document_id = ?', documentId,
  );
  tx((d) => {
    d.prepare('UPDATE medical_documents SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(nowIso(), nowIso(), documentId);
    d.prepare('DELETE FROM document_search WHERE document_id = ?').run(documentId);
    d.prepare(`UPDATE access_grants SET revoked_at = ?, revoked_by_user_id = ?
               WHERE document_id = ? AND revoked_at IS NULL`).run(nowIso(), userId, documentId);
  });
  for (const p of paths) rmSync(join(DOCS_DIR, p.storage_path), { force: true });
  audit({ actorUserId: userId, action: 'document:delete', resourceType: 'medical_document',
          resourceId: documentId, careProfileId: doc.care_profile_id, outcome: 'allowed',
          detail: { blobs_removed: paths.length } });
  recordActivity({ careProfileId: doc.care_profile_id, actorUserId: userId,
                   kind: 'document_deleted', summary: `Document removed: ${doc.title}`,
                   requiredScope: 'records:view' });
}

export type SearchHit = DocumentRow & { snippet: string };

/**
 * Full-text search over confirmed metadata and extracted text, restricted to the
 * documents the caller may read. The FTS table is joined against the scoped
 * document query rather than searched on its own.
 */
export function searchDocuments(userId: string, query: string, limit = 25): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const allowed = listDocuments(userId, { limit: 10_000 });
  if (allowed.length === 0) return [];
  const allowedIds = new Set(allowed.map((d) => d.id));

  // Prefix-match each term so partial words find documents.
  const match = trimmed
    .replace(/["()*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' AND ');
  if (!match) return [];

  let rows: { document_id: string; snippet: string }[] = [];
  try {
    rows = all<{ document_id: string; snippet: string }>(
      `SELECT document_id,
              snippet(document_search, -1, '[', ']', ' … ', 12) AS snippet
       FROM document_search WHERE document_search MATCH ?
       ORDER BY rank LIMIT ?`,
      match, limit * 4,
    );
  } catch {
    return []; // a malformed FTS expression yields no results rather than an error page
  }
  const byId = new Map(allowed.map((d) => [d.id, d]));
  const hits: SearchHit[] = [];
  for (const r of rows) {
    if (!allowedIds.has(r.document_id)) continue;
    const doc = byId.get(r.document_id);
    if (doc) hits.push({ ...doc, snippet: r.snippet });
    if (hits.length >= limit) break;
  }
  audit({ actorUserId: userId, action: 'document:search', outcome: 'allowed',
          detail: { terms: trimmed.split(/\s+/).length, hits: hits.length } });
  return hits;
}

/** Documents plus user-entered healthcare events, newest first. */
export function timeline(userId: string, filter: DocumentFilter = {}) {
  return listDocuments(userId, { ...filter, limit: filter.limit ?? 100 }).map((d) => ({
    ...d,
    effectiveDate: d.document_date ?? d.created_at.slice(0, 10),
  }));
}

export function providersUsed(userId: string): string[] {
  const docs = listDocuments(userId, { limit: 1000 });
  return [...new Set(docs.map((d) => d.provider_name).filter((p): p is string => !!p))].sort();
}

export function tagsUsed(userId: string): string[] {
  const docs = listDocuments(userId, { limit: 1000 });
  const tags = new Set<string>();
  for (const d of docs) {
    try { for (const t of JSON.parse(d.tags) as string[]) tags.add(t); } catch { /* ignore */ }
  }
  return [...tags].sort();
}
