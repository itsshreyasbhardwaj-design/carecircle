'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, getSettings } from '@/lib/session';
import {
  addDocumentVersion, confirmDocumentMetadata, deleteDocument, uploadDocument,
} from '@/lib/documents';
import { scheduleDocumentFollowup } from '@/lib/reminders';
import { documentMetadataSchema } from '@/lib/validate';
import type { DocumentCategory } from '@/lib/extract';
import { MAX_UPLOAD_BYTES } from '@/lib/env';
import { bool, errorMessage, fail, list, parseOr, str, strOrNull, done } from './shared';

async function fileFrom(formData: FormData, back: string) {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    fail(back, 'Choose a file to upload.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    fail(back, `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
  return {
    filename: file.name,
    declaredMime: file.type || 'application/octet-stream',
    bytes: Buffer.from(await file.arrayBuffer()),
  };
}

export async function uploadDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const careProfileId = str(formData, 'careProfileId');
  const back = `/records/new?profile=${encodeURIComponent(careProfileId)}`;
  if (!careProfileId) fail('/records/new', 'Choose whose records this belongs to.');

  const file = await fileFrom(formData, back);
  let documentId: string;
  try {
    const result = await uploadDocument({
      actorUserId: user.id, careProfileId,
      filename: file.filename, declaredMime: file.declaredMime, bytes: file.bytes,
      title: strOrNull(formData, 'title') ?? undefined,
      category: (strOrNull(formData, 'category') as DocumentCategory | null) ?? undefined,
      sensitivity: bool(formData, 'restricted') ? 'restricted' : 'standard',
    });
    documentId = result.documentId;
  } catch (err) { fail(back, errorMessage(err)); }

  revalidatePath('/records');
  revalidatePath('/dashboard');
  // Straight into the review step: suggestions must be confirmed before they count.
  redirect(`/records/${documentId}/review`);
}

export async function addVersionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const documentId = str(formData, 'documentId');
  const back = `/records/${documentId}`;
  const file = await fileFrom(formData, back);
  try {
    await addDocumentVersion({
      actorUserId: user.id, documentId,
      filename: file.filename, declaredMime: file.declaredMime, bytes: file.bytes,
    });
  } catch (err) { fail(back, errorMessage(err)); }
  revalidatePath(back);
  done(back, 'New version added. Earlier versions are still available.');
}

/**
 * Saves metadata the user reviewed. This is the only path by which an extracted
 * suggestion becomes stored data.
 */
export async function confirmMetadataAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const settings = await getSettings();
  const documentId = str(formData, 'documentId');
  const back = `/records/${documentId}/review`;
  const input = parseOr(documentMetadataSchema, {
    documentId,
    title: str(formData, 'title'),
    category: str(formData, 'category'),
    documentDate: str(formData, 'documentDate'),
    providerName: str(formData, 'providerName'),
    notes: str(formData, 'notes'),
    tags: list(formData, 'tags').flatMap((t) => t.split(',').map((x) => x.trim()).filter(Boolean)),
    sensitivity: str(formData, 'sensitivity') || 'standard',
    fromSuggestion: bool(formData, 'fromSuggestion'),
  }, back);

  try {
    confirmDocumentMetadata({
      actorUserId: user.id, documentId: input.documentId, title: input.title,
      category: input.category as DocumentCategory, documentDate: input.documentDate,
      providerName: input.providerName, notes: input.notes, tags: input.tags,
      sensitivity: input.sensitivity as 'standard' | 'restricted',
      fromSuggestion: input.fromSuggestion,
    });
    // A follow-up reminder is only created when the user ticked the box for it.
    const followup = strOrNull(formData, 'followupDate');
    if (followup && bool(formData, 'createFollowupReminder')) {
      const careProfileId = str(formData, 'careProfileId');
      if (careProfileId) {
        scheduleDocumentFollowup(careProfileId, documentId, followup, settings.timezone);
      }
    }
  } catch (err) { fail(back, errorMessage(err)); }

  revalidatePath('/records');
  revalidatePath(`/records/${documentId}`);
  redirect(`/records/${documentId}?ok=` + encodeURIComponent('Details saved.'));
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  try { deleteDocument(user.id, str(formData, 'documentId')); }
  catch (err) { fail(`/records/${str(formData, 'documentId')}`, errorMessage(err)); }
  revalidatePath('/records');
  done('/records', 'Document deleted, along with its stored file.');
}
