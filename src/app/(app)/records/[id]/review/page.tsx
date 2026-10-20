import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import {
  CATEGORY_LABELS, documentExtraction, getDocument,
} from '@/lib/documents';
import { confirmMetadataAction } from '@/app/actions/vault';
import {
  Badge, Card, CardHead, Checkbox, Field, Flash, Input, Notice, PageHead, Select, Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';
import type { DocumentCategory } from '@/lib/extract';

export const metadata = { title: 'Review document details' };

export default async function ReviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const doc = getDocument(user.id, id);
  if (!doc) notFound();
  const extraction = documentExtraction(user.id, id);
  const categories = Object.keys(CATEGORY_LABELS) as DocumentCategory[];

  const suggested = {
    category: (extraction?.suggested_category as DocumentCategory | null) ?? null,
    date: extraction?.suggested_document_date ?? null,
    provider: extraction?.suggested_provider_name ?? null,
    patient: extraction?.suggested_patient_name ?? null,
    followup: extraction?.suggested_followup_date ?? null,
    refs: parseRefs(extraction?.suggested_reference_ids),
  };
  const anySuggestion = Object.values(suggested).some(
    (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)),
  );

  return (
    <div className="space-y-6">
      <Flash error={sp.error} />
      <PageHead title="Check these details"
                sub="Nothing below is saved until you confirm it. The original file stays the authoritative copy." />

      {extraction?.status === 'extracted' ? (
        <Notice tone={extraction.confidence === 'low' ? 'warn' : 'neutral'}
                title={extraction.engine === 'image-ocr'
                  ? 'Read from a photograph — please check every field'
                  : 'Read from the document text'}>
          Automatic reading makes mistakes. Correct anything that is wrong, and leave a field blank
          rather than guessing.
        </Notice>
      ) : (
        <Notice tone="neutral" title="No text could be read automatically">
          {extraction?.status === 'no_text_layer'
            ? 'This looks like a scan without a text layer, so nothing was extracted. Please fill in the details below.'
            : extraction?.status === 'unsupported'
              ? 'This file type cannot be read automatically, or image recognition is not set up. Please fill in the details below.'
              : 'Please fill in the details below.'}
        </Notice>
      )}

      {anySuggestion ? (
        <Card>
          <CardHead title="What CareCircle thinks it found"
                    sub="Suggestions only — they are pre-filled into the form below for you to accept or change." />
          <dl className="px-5 py-4">
            <SuggestionRow label="Document type"
              value={suggested.category ? CATEGORY_LABELS[suggested.category] : null} />
            <SuggestionRow label="Document date" value={suggested.date} />
            <SuggestionRow label="Provider" value={suggested.provider} />
            <SuggestionRow label="Patient name on the document" value={suggested.patient}
              note="Shown so you can confirm the file is filed under the right person." />
            <SuggestionRow label="Follow-up date written in the document" value={suggested.followup}
              note="Only filled when an actual calendar date appears next to a follow-up instruction. Wording such as “review after 4 weeks” is never converted into a date." />
            <SuggestionRow label="Reference numbers"
              value={suggested.refs.length ? suggested.refs.join(', ') : null} />
          </dl>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Save the details" />
        <form action={confirmMetadataAction} className="space-y-5 p-5">
          <input type="hidden" name="documentId" value={doc.id} />
          <input type="hidden" name="careProfileId" value={doc.care_profile_id} />
          <input type="hidden" name="fromSuggestion" value={anySuggestion ? 'on' : ''} />

          <Field label="Title" name="title" required>
            <Input name="title" required maxLength={200} defaultValue={doc.title} />
          </Field>

          <Field label="Document type" name="category" required>
            <Select name="category" required defaultValue={suggested.category ?? doc.category}>
              {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </Select>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Date on the document" name="documentDate"
                   hint="Leave blank if it is unclear.">
              <Input name="documentDate" type="date"
                     defaultValue={suggested.date ?? doc.document_date ?? ''} />
            </Field>
            <Field label="Provider or clinic" name="providerName">
              <Input name="providerName" maxLength={160}
                     defaultValue={suggested.provider ?? doc.provider_name ?? ''} />
            </Field>
          </div>

          <Field label="Tags" name="tags" hint="Comma separated, e.g. cardiology, annual check">
            <Input name="tags" maxLength={300} defaultValue={parseTags(doc.tags).join(', ')} />
          </Field>

          <Field label="Your notes" name="notes"
                 hint="For your own reference. Not shown to anyone without record access.">
            <Textarea name="notes" rows={3} maxLength={4000} defaultValue={doc.notes ?? ''} />
          </Field>

          <Field label="Who can see this document" name="sensitivity">
            <Select name="sensitivity" defaultValue={doc.sensitivity}>
              <option value="standard">
                Anyone with permission to read this profile&rsquo;s records
              </option>
              <option value="restricted">
                Restricted — only people I share this exact document with
              </option>
            </Select>
          </Field>

          {suggested.followup ? (
            <fieldset className="rounded-card border border-line bg-surface-2 p-4">
              <legend className="px-1 text-sm font-semibold text-ink">Follow-up date found</legend>
              <p className="text-sm text-muted">
                The document appears to name <strong className="text-ink">{suggested.followup}</strong> as
                a follow-up date. Creating a reminder is your decision.
              </p>
              <input type="hidden" name="followupDate" value={suggested.followup} />
              <Checkbox name="createFollowupReminder"
                label={`Remind me on ${suggested.followup}`}
                hint="Adds one administrative reminder. It does not book anything." />
            </fieldset>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <SubmitButton pendingLabel="Saving…">Save these details</SubmitButton>
            <a href={`/records/${doc.id}`}
              className="cc-btn inline-flex items-center rounded-card border border-line-strong px-4 py-2.5 font-semibold text-ink">
              Skip for now
            </a>
          </div>
        </form>
      </Card>

      {extraction?.extracted_text ? (
        <Card>
          <CardHead title="Text read from the document"
                    sub="Stored separately from the original file, and used for searching."
                    action={<Badge tone="neutral">{extraction.engine}</Badge>} />
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-5 py-4 text-sm text-muted">
            {extraction.extracted_text}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}

function SuggestionRow({ label, value, note }: {
  label: string; value: string | null; note?: string;
}) {
  return (
    <div className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <dt className="w-56 shrink-0 text-sm font-medium text-muted">{label}</dt>
        <dd className="min-w-0 flex-1 font-medium text-ink">
          {value ?? <span className="font-normal text-faint">Left unresolved</span>}
        </dd>
        <Badge tone={value ? 'accent' : 'neutral'}>{value ? 'Suggested' : 'Not found'}</Badge>
      </div>
      {note ? <p className="mt-1 text-xs text-faint sm:ml-[14.75rem]">{note}</p> : null}
    </div>
  );
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function parseRefs(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}
