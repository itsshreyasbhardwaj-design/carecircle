import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSettings, requireUser } from '@/lib/session';
import {
  CATEGORY_LABELS, documentExtraction, documentVersions, duplicateCandidates, getDocument,
} from '@/lib/documents';
import { ownsProfile, SCOPE_LABELS } from '@/lib/authz';
import { grantsGivenBy } from '@/lib/consent';
import { formatDate, formatDateTime } from '@/lib/time';
import { addVersionAction, deleteDocumentAction } from '@/app/actions/vault';
import { grantAccessAction, revokeGrantAction } from '@/app/actions/care';
import {
  Badge, Card, CardHead, DefinitionRow, Disclosure, Field, Flash, Input, Notice, PageHead,
  Textarea,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/client';

export const metadata = { title: 'Document' };

export default async function DocumentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const { id } = await params;
  const sp = await searchParams;

  const doc = getDocument(user.id, id);
  if (!doc) notFound();

  const versions = documentVersions(user.id, id);
  const extraction = documentExtraction(user.id, id);
  const isOwner = ownsProfile(user.id, doc.care_profile_id);
  const current = versions[0];
  const sha = current?.sha256 ?? '';
  const dupes = isOwner ? duplicateCandidates(doc.care_profile_id, sha, doc.title)
    .filter((d) => d.documentId !== doc.id) : [];
  const docGrants = isOwner
    ? grantsGivenBy(user.id).filter((g) => g.document_id === doc.id) : [];
  const tags = parseTags(doc.tags);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead
        title={doc.title}
        sub={<>
          <Link href={`/profiles/${doc.care_profile_id}`} className="font-medium text-accent hover:underline">
            {doc.profile_name}
          </Link>
          {' · '}{CATEGORY_LABELS[doc.category]}
          {doc.document_date ? ` · ${formatDate(doc.document_date, settings.timezone, settings.locale)}` : ''}
        </>}
        action={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/documents/${doc.id}/file?download=1`}
              className="cc-btn inline-flex items-center rounded-card bg-accent px-4 py-2.5 font-semibold text-accent-ink">
              Download original
            </a>
            <Link href={`/records/${doc.id}/review`}
              className="cc-btn inline-flex items-center rounded-card border border-line-strong px-4 py-2.5 font-semibold text-ink">
              Edit details
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {doc.sensitivity === 'restricted' ? <Badge tone="bad">Restricted document</Badge> : null}
        {!doc.extraction_reviewed ? <Badge tone="warn">Details not yet confirmed</Badge> : null}
        {doc.version_count > 1 ? <Badge tone="neutral">{doc.version_count} versions</Badge> : null}
        {tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
      </div>

      {dupes.length > 0 ? (
        <Notice tone="warn" title="This may be a duplicate">
          <p>Nothing has been deleted. Compare them and decide yourself:</p>
          <ul className="mt-2 space-y-1">
            {dupes.map((d) => (
              <li key={d.documentId}>
                <Link href={`/records/${d.documentId}`} className="font-semibold underline">
                  {d.title}
                </Link>{' '}
                — {d.reason === 'identical_file' ? 'byte-for-byte identical file' : 'same title'}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHead title="Preview" sub="Served through an authorised, non-cacheable, sandboxed response." />
          <div className="p-5">
            {current && ['application/pdf'].includes(current.mime_type) ? (
              <iframe src={`/api/documents/${doc.id}/file`} title={`Preview of ${doc.title}`}
                      className="h-[32rem] w-full rounded-card border border-line bg-surface-2" />
            ) : current && current.mime_type.startsWith('image/') ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={`/api/documents/${doc.id}/file`} alt={`Scan of ${doc.title}`}
                   className="max-h-[32rem] w-full rounded-card border border-line object-contain" />
            ) : (
              <Notice tone="neutral">
                This file type is not previewed in the browser. Use &ldquo;Download original&rdquo;.
              </Notice>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHead title="Details" />
            <dl className="px-5 py-2">
              <DefinitionRow term="Person">{doc.profile_name}</DefinitionRow>
              <DefinitionRow term="Type">{CATEGORY_LABELS[doc.category]}</DefinitionRow>
              <DefinitionRow term="Document date">
                {doc.document_date
                  ? formatDate(doc.document_date, settings.timezone, settings.locale)
                  : <span className="text-faint">Not set</span>}
              </DefinitionRow>
              <DefinitionRow term="Provider">
                {doc.provider_name ?? <span className="text-faint">Not set</span>}
              </DefinitionRow>
              <DefinitionRow term="Added by">
                {doc.uploaded_by} on {formatDateTime(doc.created_at, settings.timezone, settings.locale)}
              </DefinitionRow>
              <DefinitionRow term="File">
                {current ? `${current.original_filename} · ${current.mime_type} · ${formatBytes(current.byte_size)}` : '—'}
              </DefinitionRow>
              <DefinitionRow term="Notes">
                {doc.notes ?? <span className="text-faint">None</span>}
              </DefinitionRow>
            </dl>
          </Card>

          <Card>
            <CardHead title="Version history" sub="Earlier versions stay readable." />
            <ul className="divide-y divide-line">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      Version {v.version_number}
                      {v.id === current?.id ? <span className="ml-2 text-sm text-accent">current</span> : null}
                    </p>
                    <p className="text-sm text-muted">
                      {v.uploaded_by} · {formatDateTime(v.created_at, settings.timezone, settings.locale)}
                      {' · '}{formatBytes(v.byte_size)}
                    </p>
                  </div>
                  <a href={`/api/documents/${doc.id}/file?v=${v.id}&download=1`}
                    className="text-sm font-semibold text-accent hover:underline">
                    Download
                  </a>
                </li>
              ))}
            </ul>
            <div className="border-t border-line p-5">
              <Disclosure summary="Add a new version">
                <form action={addVersionAction} encType="multipart/form-data" className="space-y-4">
                  <input type="hidden" name="documentId" value={doc.id} />
                  <Field label="Replacement file" name="file" required
                         hint="A clearer scan, or an updated copy. The old version is kept.">
                    <Input name="file" type="file" required className="py-2"
                           accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,text/plain" />
                  </Field>
                  <SubmitButton variant="secondary" pendingLabel="Uploading…">
                    Add version
                  </SubmitButton>
                </form>
              </Disclosure>
            </div>
          </Card>
        </div>
      </div>

      {extraction ? (
        <Card>
          <CardHead title="Extracted text"
                    sub={`Read by: ${extraction.engine}. Stored apart from the original, and used for search.`}
                    action={extraction.reviewed_at
                      ? <Badge tone="ok">Details confirmed</Badge>
                      : <Badge tone="warn">Not yet confirmed</Badge>} />
          {extraction.extracted_text ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-5 py-4 text-sm text-muted">
              {extraction.extracted_text}
            </pre>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">
              No text was read from this file. The original document is still stored and downloadable.
            </p>
          )}
        </Card>
      ) : null}

      {isOwner ? (
        <Card>
          <CardHead title="Who can read this document"
                    sub={doc.sensitivity === 'restricted'
                      ? 'This document is restricted, so it needs a share naming it specifically.'
                      : 'Anyone with the “read documents” permission on this profile can read it. You can also share it with one extra person here.'} />
          {docGrants.length > 0 ? (
            <ul className="divide-y divide-line">
              {docGrants.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{g.grantee_name}</p>
                    <p className="text-sm text-muted">
                      {SCOPE_LABELS[g.scope]} · {g.purpose}
                      {g.expires_at ? ` · expires ${g.expires_at.slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <form action={revokeGrantAction}>
                    <input type="hidden" name="grantId" value={g.id} />
                    <input type="hidden" name="back" value={`/records/${doc.id}`} />
                    <SubmitButton variant="danger" className="px-3 py-1.5 text-sm">
                      Withdraw
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">
              Nobody has been given access to this document specifically.
            </p>
          )}
          <div className="border-t border-line p-5">
            <Disclosure summary="Share just this document with one person">
              <form action={grantAccessAction} className="space-y-4">
                <input type="hidden" name="careProfileId" value={doc.care_profile_id} />
                <input type="hidden" name="documentId" value={doc.id} />
                <input type="hidden" name="scopes" value="records:view" />
                <input type="hidden" name="back" value={`/records/${doc.id}`} />
                <Field label="Their email address" name="granteeEmail" required
                       hint="They need a CareCircle account already.">
                  <Input name="granteeEmail" type="email" required />
                </Field>
                <Field label="Why are you sharing it?" name="purpose" required
                       hint="Recorded in the consent ledger so the reason is not lost.">
                  <Textarea name="purpose" rows={2} required maxLength={200}
                            placeholder="e.g. Taking this report to the specialist on my behalf" />
                </Field>
                <Field label="Expires on" name="expiresAt" hint="Optional. Leave blank for no expiry.">
                  <Input name="expiresAt" type="date" />
                </Field>
                <SubmitButton variant="secondary">Share this document</SubmitButton>
              </form>
            </Disclosure>
          </div>
        </Card>
      ) : (
        <Notice tone="neutral" title="Shared with you">
          This document belongs to {doc.profile_name}. They control who can read it and can
          withdraw your access at any time.
        </Notice>
      )}

      {isOwner ? (
        <Card className="border-bad/30">
          <CardHead title="Delete this document"
                    sub="Removes the record and erases the encrypted file from disk. This cannot be undone." />
          <form action={deleteDocumentAction} className="p-5">
            <input type="hidden" name="documentId" value={doc.id} />
            <ConfirmSubmit
              label="Delete document"
              title={`Delete “${doc.title}”?`}
              confirmLabel="Yes, delete it"
              body={<>
                <p>
                  All {doc.version_count} version{doc.version_count === 1 ? '' : 's'} and the
                  encrypted file will be erased. Any share naming this document is withdrawn.
                </p>
                <p className="mt-2">This cannot be undone.</p>
              </>}
            />
          </form>
        </Card>
      ) : null}
    </div>
  );
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
