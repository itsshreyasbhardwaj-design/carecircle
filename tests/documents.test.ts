import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeProfile, makeUser, resetDb } from './helpers.ts';
import {
  addDocumentVersion, confirmDocumentMetadata, deleteDocument, documentExtraction,
  documentVersions, getDocument, listDocuments, readDocumentBytes, safeFilename, searchDocuments,
  sniffMime, uploadDocument,
} from '../src/lib/documents.ts';
import { grantAccess, revokeGrant } from '../src/lib/consent.ts';
import { AuthzError } from '../src/lib/authz.ts';
import { DOCS_DIR, MAX_UPLOAD_BYTES } from '../src/lib/env.ts';
import { all, one } from '../src/db/index.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const PDF = readFileSync(join(FIXTURES, 'fictional-prescription.pdf'));

// Invented content; contains no real patient information.
const TEXT = Buffer.from(`SUNRISE DIAGNOSTICS LABORATORY
Patient: Mohan Das
Specimen collected: 02/04/2026
Haemoglobin 11.2 g/dL reference range 13.0 - 17.0
Lab No LAB/2026/0881
Follow up on 10 May 2026 with the treating physician.
`, 'utf8');

async function upload(userId: string, profileId: string, over: Partial<{
  bytes: Buffer; mime: string; name: string; title: string;
  sensitivity: 'standard' | 'restricted';
}> = {}) {
  return uploadDocument({
    actorUserId: userId, careProfileId: profileId,
    filename: over.name ?? 'report.txt',
    declaredMime: over.mime ?? 'text/plain',
    bytes: over.bytes ?? TEXT,
    title: over.title ?? 'Blood work',
    category: 'lab_report',
    sensitivity: over.sensitivity,
  });
}

describe('health vault', () => {
  beforeEach(resetDb);

  it('sniffs the real type and refuses a mismatch', async () => {
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(TEXT)).toBe('text/plain');
    // An HTML payload must not pass as plain text.
    expect(sniffMime(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBe('unknown');

    const owner = makeUser();
    const profile = makeProfile(owner.id);
    await expect(
      upload(owner.id, profile, { bytes: PDF, mime: 'image/png', name: 'fake.png' }),
    ).rejects.toThrow(/do not match/i);
  });

  it('refuses an unsupported type and an oversized file', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    await expect(
      upload(owner.id, profile, { mime: 'application/zip', name: 'x.zip' }),
    ).rejects.toThrow(/not accepted/i);
    await expect(
      upload(owner.id, profile, { bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41) }),
    ).rejects.toThrow(/MB or smaller/i);
  });

  it('extracts text from a real PDF and suggests reviewable fields', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const result = await upload(owner.id, profile, {
      bytes: PDF, mime: 'application/pdf', name: 'rx.pdf',
    });
    expect(result.extraction.status).toBe('extracted');
    expect(result.extraction.engine).toBe('pdf-text');
    expect(result.extraction.text).toMatch(/CITY HEART CLINIC/);
    expect(result.extraction.suggestions.providerName).toBe('Dr. R. Nair');
    expect(result.extraction.suggestions.documentDate).toBe('2026-03-14');
    // "Review after 4 weeks" must NOT become a date.
    expect(result.extraction.suggestions.followupDate).toBeNull();
    expect(result.extraction.suggestions.followupNote).toMatch(/Review after 4 weeks/);
    expect(['low', 'medium']).toContain(result.extraction.confidence);
  });

  it('stores the file encrypted on disk and decrypts it only for an authorised read', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const result = await upload(owner.id, profile);

    const stored = one<{ storage_path: string }>(
      'SELECT storage_path FROM document_versions WHERE document_id = ?', result.documentId,
    )!;
    const onDisk = readFileSync(join(DOCS_DIR, stored.storage_path));
    // The patient name is in the plaintext but must not be in the stored bytes.
    expect(TEXT.toString('utf8')).toContain('Mohan Das');
    expect(onDisk.toString('latin1')).not.toContain('Mohan Das');
    expect(onDisk.equals(TEXT)).toBe(false);

    // An authorised read returns exactly the original bytes.
    expect(readDocumentBytes(owner.id, result.documentId).bytes.equals(TEXT)).toBe(true);
  });

  it('refuses to decrypt a tampered file', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const result = await upload(owner.id, profile);
    const stored = one<{ storage_path: string }>(
      'SELECT storage_path FROM document_versions WHERE document_id = ?', result.documentId,
    )!;
    const path = join(DOCS_DIR, stored.storage_path);
    const bytes = readFileSync(path);
    bytes[0] = bytes[0]! ^ 0xff; // flip a bit in the ciphertext
    writeFileSync(path, bytes);
    // GCM authentication fails, and the error is not swallowed into a silent empty read.
    expect(() => readDocumentBytes(owner.id, result.documentId)).toThrow();
  });

  it('leaves suggestions unconfirmed until a person saves them', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const result = await upload(owner.id, profile);
    expect(documentExtraction(owner.id, result.documentId)?.reviewed_at).toBeNull();

    confirmDocumentMetadata({
      actorUserId: owner.id, documentId: result.documentId, title: 'Blood work April',
      category: 'lab_report', documentDate: '2026-04-02', providerName: 'Sunrise Diagnostics',
      notes: null, tags: ['pathology'], sensitivity: 'standard', fromSuggestion: true,
    });
    const doc = getDocument(owner.id, result.documentId)!;
    expect(doc.title).toBe('Blood work April');
    expect(doc.document_date).toBe('2026-04-02');
    // Confirming via a suggestion is recorded as such, so provenance is auditable.
    expect(one<{ category_source: string }>(
      'SELECT category_source FROM medical_documents WHERE id = ?', result.documentId,
    )?.category_source).toBe('suggestion_confirmed');
    expect(documentExtraction(owner.id, result.documentId)?.reviewed_at).not.toBeNull();
  });

  it('flags duplicates for review without deleting anything', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const first = await upload(owner.id, profile);
    const second = await upload(owner.id, profile);
    expect(second.duplicates.some((d) => d.documentId === first.documentId
      && d.reason === 'identical_file')).toBe(true);
    // Both still exist: nothing was removed automatically.
    expect(listDocuments(owner.id, {}).length).toBe(2);
  });

  it('keeps earlier versions readable', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const result = await upload(owner.id, profile);
    const updated = Buffer.from('SUNRISE DIAGNOSTICS LABORATORY\nclearer rescan\n', 'utf8');
    const v2 = await addDocumentVersion({
      actorUserId: owner.id, documentId: result.documentId,
      filename: 'rescan.txt', declaredMime: 'text/plain', bytes: updated,
    });
    expect(v2.versionNumber).toBe(2);
    const versions = documentVersions(owner.id, result.documentId);
    expect(versions.length).toBe(2);
    expect(readDocumentBytes(owner.id, result.documentId).bytes.equals(updated)).toBe(true);
    expect(readDocumentBytes(owner.id, result.documentId, versions[1]!.id).bytes.equals(TEXT)).toBe(true);
  });

  it('blocks a stranger from reading, downloading or guessing a document', async () => {
    const owner = makeUser();
    const stranger = makeUser();
    const profile = makeProfile(owner.id);
    const result = await upload(owner.id, profile);

    expect(getDocument(stranger.id, result.documentId)).toBeUndefined();
    expect(() => readDocumentBytes(stranger.id, result.documentId)).toThrow(AuthzError);
    expect(listDocuments(stranger.id, {}).length).toBe(0);
    // Even knowing the exact id does not help.
    expect(() => documentVersions(stranger.id, result.documentId)).toThrow(AuthzError);
  });

  it('search only returns documents the caller may read', async () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const stranger = makeUser();
    const profile = makeProfile(owner.id);
    await upload(owner.id, profile, { title: 'Cardiology report' });

    expect(searchDocuments(owner.id, 'haemoglobin').length).toBe(1);
    expect(searchDocuments(stranger.id, 'haemoglobin').length).toBe(0);
    // Searching for a patient name in someone else's document finds nothing.
    expect(searchDocuments(stranger.id, 'Mohan').length).toBe(0);

    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'helps with filing', grantedByUserId: owner.id,
    });
    expect(searchDocuments(caregiver.id, 'haemoglobin').length).toBe(1);
  });

  it('a restricted document stays hidden from a profile-wide grant', async () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const open = await upload(owner.id, profile, { title: 'Open report' });
    const secret = await upload(owner.id, profile, {
      title: 'Private note', sensitivity: 'restricted',
      bytes: Buffer.from('SUNRISE private note contents\n'),
    });
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'general help', grantedByUserId: owner.id,
    });
    const visible = listDocuments(caregiver.id, {}).map((d) => d.id);
    expect(visible).toContain(open.documentId);
    expect(visible).not.toContain(secret.documentId);
    expect(() => readDocumentBytes(caregiver.id, secret.documentId)).toThrow(AuthzError);
    expect(searchDocuments(caregiver.id, 'private').length).toBe(0);
  });

  it('revoking access stops downloads immediately', async () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const doc = await upload(owner.id, profile);
    const grant = grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'temporary', grantedByUserId: owner.id,
    });
    expect(readDocumentBytes(caregiver.id, doc.documentId).bytes.length).toBeGreaterThan(0);
    revokeGrant(grant, owner.id);
    expect(() => readDocumentBytes(caregiver.id, doc.documentId)).toThrow(AuthzError);
  });

  it('records every download in the audit log', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const doc = await upload(owner.id, profile);
    readDocumentBytes(owner.id, doc.documentId);
    const events = all<{ action: string }>(
      'SELECT action FROM audit_events WHERE resource_id = ?', doc.documentId,
    ).map((e) => e.action);
    expect(events).toContain('document:upload');
    expect(events).toContain('document:download');
  });

  it('only the owner may delete, and the file is erased', async () => {
    const owner = makeUser();
    const caregiver = makeUser();
    const profile = makeProfile(owner.id);
    const doc = await upload(owner.id, profile);
    grantAccess({
      careProfileId: profile, granteeUserId: caregiver.id, scope: 'records:view',
      purpose: 'reading', grantedByUserId: owner.id,
    });
    expect(() => deleteDocument(caregiver.id, doc.documentId)).toThrow(AuthzError);

    deleteDocument(owner.id, doc.documentId);
    expect(getDocument(owner.id, doc.documentId)).toBeUndefined();
    expect(listDocuments(owner.id, {}).length).toBe(0);
    expect(searchDocuments(owner.id, 'haemoglobin').length).toBe(0);
  });

  it('sanitises a hostile filename', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('..\\..\\windows\\system32')).toBe('system32');
    expect(safeFilename('....//evil.txt')).toBe('evil.txt');
    expect(safeFilename('')).toBe('document');
    expect(safeFilename('a'.repeat(400)).length).toBeLessThanOrEqual(120);
  });

  it('upload needs records:upload, which read access alone does not give', async () => {
    const owner = makeUser();
    const reader = makeUser();
    const profile = makeProfile(owner.id);
    grantAccess({
      careProfileId: profile, granteeUserId: reader.id, scope: 'records:view',
      purpose: 'reading only', grantedByUserId: owner.id,
    });
    await expect(upload(reader.id, profile)).rejects.toThrow(AuthzError);
  });

  it('writes nothing to disk when an upload is rejected', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const before = existsSync(join(DOCS_DIR, profile))
      ? readdirSync(join(DOCS_DIR, profile)).length : 0;

    // Rejected for a type mismatch, before anything is encrypted or written.
    await expect(
      upload(owner.id, profile, { bytes: PDF, mime: 'text/plain' }),
    ).rejects.toThrow(/do not match/i);
    // Rejected for size.
    await expect(
      upload(owner.id, profile, { bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41) }),
    ).rejects.toThrow();

    const after = existsSync(join(DOCS_DIR, profile))
      ? readdirSync(join(DOCS_DIR, profile)).length : 0;
    expect(after).toBe(before);
    expect(one<{ n: number }>('SELECT count(*) n FROM document_versions')?.n).toBe(0);
    expect(one<{ n: number }>('SELECT count(*) n FROM medical_documents')?.n).toBe(0);
  });

  it('every stored version has exactly one file, and deletion removes it', async () => {
    const owner = makeUser();
    const profile = makeProfile(owner.id);
    const doc = await upload(owner.id, profile);
    await addDocumentVersion({
      actorUserId: owner.id, documentId: doc.documentId,
      filename: 'v2.txt', declaredMime: 'text/plain',
      bytes: Buffer.from('SUNRISE second version\n'),
    });
    const paths = all<{ storage_path: string }>('SELECT storage_path FROM document_versions');
    expect(paths.length).toBe(2);
    for (const p of paths) expect(existsSync(join(DOCS_DIR, p.storage_path))).toBe(true);

    deleteDocument(owner.id, doc.documentId);
    for (const p of paths) expect(existsSync(join(DOCS_DIR, p.storage_path))).toBe(false);
  });
});
