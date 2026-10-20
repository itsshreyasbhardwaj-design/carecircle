import { getSettings, requireUser } from '@/lib/session';
import { ownedProfiles } from '@/lib/profiles';
import { listDocuments } from '@/lib/documents';
import { grantsGivenBy } from '@/lib/consent';
import { deleteAccountAction } from '@/app/actions/auth';
import {
  Card, CardHead, Checkbox, Field, Flash, Input, Notice, PageHead,
} from '@/components/ui';
import { ConfirmSubmit } from '@/components/client';

export const metadata = { title: 'Privacy and data' };

export default async function PrivacySettingsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await requireUser();
  await getSettings();
  const sp = await searchParams;
  const profiles = ownedProfiles(user.id);
  const docs = listDocuments(user.id, { limit: 10_000 });
  const grants = grantsGivenBy(user.id);

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead title="Privacy and data" sub="Take your data out, or remove it entirely." />

      <Card>
        <CardHead title="Export everything"
                  sub="A single JSON file. Never gated on a plan or a payment." />
        <div className="space-y-4 p-5">
          <p className="text-muted">
            The export covers your account and settings, the {profiles.length} care profile(s) you
            own, document metadata for {docs.length} document(s), appointments, care tasks and
            their history, medication routines and check-ins, the {grants.length} access grant(s)
            you have given, every consent record, your notifications and your own security log.
          </p>
          <Notice tone="neutral" title="Original files are downloaded separately">
            The JSON holds each document&rsquo;s details and its SHA-256 hash, not the file bytes.
            Download the originals from the Health Vault — that keeps the export readable and
            avoids putting megabytes of encrypted data inside a text file.
          </Notice>
          <a href="/api/export"
            className="cc-btn inline-flex items-center rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
            Download my data as JSON
          </a>
        </div>
      </Card>

      <Card>
        <CardHead title="What is kept out of the logs" />
        <div className="space-y-3 p-5 text-muted">
          <p>
            The audit log records that something happened — an upload, a download, a permission
            change — with identifiers, counts and enum values. It deliberately cannot hold health
            content: the code rejects an attempt to write fields such as notes, document text or
            dose instructions into an audit row.
          </p>
          <p>
            Raw network addresses are never stored. Where an address matters to a security event,
            a salted hash is kept instead.
          </p>
        </div>
      </Card>

      <Card>
        <CardHead title="Key-recovery limitation" />
        <div className="space-y-3 p-5 text-muted">
          <p>
            Documents are encrypted with a key generated on first run into a local file that is
            excluded from version control. There is no escrow and no back door: if that file is
            lost, nobody — including whoever operates this build — can decrypt the stored files.
          </p>
          <p>
            Back it up separately from the database if the documents matter to you. Keeping both in
            one backup means a single theft gives up both.
          </p>
        </div>
      </Card>

      <Card className="border-bad/40">
        <CardHead title="Delete my account"
                  sub="Permanent. Removes your profiles, their records and the encrypted files." />
        <form action={deleteAccountAction} className="space-y-5 p-5">
          <Notice tone="bad" title="What deletion does">
            <ul className="mt-1 space-y-1">
              <li>• Your account, sessions and settings are removed.</li>
              <li>• The {profiles.length} profile(s) you own are deleted, with their appointments, tasks, medication routines and documents.</li>
              <li>• The encrypted document files are erased from disk.</li>
              <li>• Every permission you granted is withdrawn, and every permission you hold on other people&rsquo;s profiles is withdrawn.</li>
              <li>• Consent and audit rows are retained. They contain no health content, and a withdrawal of consent needs to stay provable after the fact.</li>
            </ul>
          </Notice>

          <Field label="Type your email address to confirm" name="confirmEmail" required
                 hint={user.email}>
            <Input name="confirmEmail" type="email" required autoComplete="off" />
          </Field>

          <Checkbox name="understood" required
            label="I understand this cannot be undone and that the files cannot be recovered." />

          <ConfirmSubmit label="Delete my account permanently"
            title="Delete your CareCircle account?"
            confirmLabel="Yes, delete everything"
            body={<p>
              This erases your profiles, their health records and the encrypted files on disk.
              It cannot be undone. Export your data first if you want a copy.
            </p>} />
        </form>
      </Card>
    </div>
  );
}
