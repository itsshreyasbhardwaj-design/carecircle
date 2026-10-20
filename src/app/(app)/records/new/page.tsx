import { requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import { CATEGORY_LABELS } from '@/lib/documents';
import { ocrAvailable } from '@/lib/extract';
import { MAX_UPLOAD_BYTES } from '@/lib/env';
import { uploadDocumentAction } from '@/app/actions/vault';
import {
  Card, CardHead, Checkbox, Field, Flash, Input, Notice, PageHead, Select,
} from '@/components/ui';
import { SubmitButton } from '@/components/client';
import type { DocumentCategory } from '@/lib/extract';

export const metadata = { title: 'Add a document' };

export default async function NewDocumentPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; error?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  // Uploading needs records:upload — owning the profile, or being granted it.
  const profiles = accessibleProfiles(user.id)
    .filter((p) => p.access === 'owner' || p.scopes.includes('records:upload'));
  const categories = Object.keys(CATEGORY_LABELS) as DocumentCategory[];
  const ocr = ocrAvailable();

  return (
    <div className="space-y-6">
      <Flash error={sp.error} />
      <PageHead title="Add a document"
                sub="The file is encrypted before it is written to disk. You will review what CareCircle reads from it before anything is saved." />

      {profiles.length === 0 ? (
        <Notice tone="warn" title="Nowhere to file this yet">
          You can only add documents to a profile you control, or one where someone has granted you
          the &ldquo;add documents&rdquo; permission.
        </Notice>
      ) : (
        <Card>
          <CardHead title="Upload" />
          <form action={uploadDocumentAction} encType="multipart/form-data" className="space-y-5 p-5">
            <Field label="Whose record is this?" name="careProfileId" required>
              <Select name="careProfileId" required defaultValue={sp.profile ?? profiles[0]?.id}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}{p.access === 'granted' ? ' (shared with you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="File" name="file" required
                   hint={`PDF, JPEG, PNG, WebP, HEIC or plain text, up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. The contents are checked against the file type.`}>
              <Input name="file" type="file" required
                     accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,text/plain"
                     className="py-2" />
            </Field>

            <Field label="Title" name="title"
                   hint="Leave blank to use the file name. You can change it in the next step.">
              <Input name="title" maxLength={200} placeholder="e.g. Cardiology review — March 2026" />
            </Field>

            <Field label="Document type" name="category"
                   hint="A suggestion will be offered after the file is read; this is just a starting point.">
              <Select name="category" defaultValue="other">
                {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </Select>
            </Field>

            <fieldset className="rounded-card border border-line bg-surface-2 p-4">
              <legend className="px-1 text-sm font-semibold text-ink">Sharing</legend>
              <Checkbox name="restricted"
                label="Mark this document as restricted"
                hint="A restricted document is hidden even from people who can read the rest of this profile's records. You then share it one person at a time." />
            </fieldset>

            {ocr ? (
              <Notice tone="ok" title="Photograph text recognition is enabled">
                Pictures are read offline on this machine. Nothing is sent anywhere.
              </Notice>
            ) : (
              <Notice tone="neutral" title="Photographs will not be read automatically">
                Text recognition for images is not set up, so a photograph is stored safely but no
                text is extracted from it — you can fill in the details yourself. To enable it,
                run <code className="font-mono">npm run setup:ocr</code> once; it downloads an
                open-source language model and then works offline.
              </Notice>
            )}

            <SubmitButton pendingLabel="Encrypting and reading…">
              Upload and review
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
