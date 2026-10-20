import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { accessibleProfiles } from '@/lib/profiles';
import {
  CATEGORY_LABELS, listDocuments, providersUsed, searchDocuments, tagsUsed, timeline,
} from '@/lib/documents';
import { formatDate } from '@/lib/time';
import {
  Badge, ButtonLink, Card, CardHead, Disclosure, EmptyState, Field, Flash, Input, PageHead, Select,
} from '@/components/ui';
import type { DocumentCategory } from '@/lib/extract';

export const metadata = { title: 'Health Vault' };

const CATEGORIES = Object.keys(CATEGORY_LABELS) as DocumentCategory[];

export default async function RecordsPage({ searchParams }: {
  searchParams: Promise<{
    q?: string; profile?: string; category?: string; provider?: string; tag?: string;
    from?: string; to?: string; error?: string; ok?: string;
  }>;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const sp = await searchParams;
  const profiles = accessibleProfiles(user.id);

  const filter = {
    careProfileId: sp.profile || null,
    category: (sp.category as DocumentCategory) || null,
    provider: sp.provider || null,
    tag: sp.tag || null,
    from: sp.from || null,
    to: sp.to || null,
    limit: 100,
  };

  const searching = Boolean(sp.q?.trim());
  const hits = searching ? searchDocuments(user.id, sp.q!, 50) : [];
  const docs = searching ? [] : timeline(user.id, filter);
  const total = listDocuments(user.id, { limit: 10_000 }).length;

  return (
    <div className="space-y-6">
      <Flash error={sp.error} ok={sp.ok} />
      <PageHead
        title="Health Vault"
        sub={`${total} document${total === 1 ? '' : 's'} you can read. Files are encrypted on disk and only reachable through an authorised download.`}
        action={<ButtonLink href="/records/new">Add a document</ButtonLink>}
      />

      <Card>
        <form method="get" action="/records" className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
          <Field label="Search documents" name="q"
                 hint="Searches titles, notes, providers and the text read from each document.">
            <Input name="q" type="search" defaultValue={sp.q ?? ''}
                   placeholder="cardiology report, HbA1c, Dr. Nair…" />
          </Field>
          <div className="flex items-end">
            <button type="submit"
              className="cc-btn w-full rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink sm:w-auto">
              Search
            </button>
          </div>
        </form>
        <div className="border-t border-line p-5">
          <Disclosure summary="Filter the timeline" open={Boolean(sp.profile || sp.category || sp.provider || sp.tag || sp.from)}>
            <form method="get" action="/records" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Person" name="profile">
                <Select name="profile" defaultValue={sp.profile ?? ''}>
                  <option value="">Everyone</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </Select>
              </Field>
              <Field label="Document type" name="category">
                <Select name="category" defaultValue={sp.category ?? ''}>
                  <option value="">All types</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </Select>
              </Field>
              <Field label="Provider" name="provider">
                <Select name="provider" defaultValue={sp.provider ?? ''}>
                  <option value="">Any provider</option>
                  {providersUsed(user.id).map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </Field>
              <Field label="Tag" name="tag">
                <Select name="tag" defaultValue={sp.tag ?? ''}>
                  <option value="">Any tag</option>
                  {tagsUsed(user.id).map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="From date" name="from">
                <Input name="from" type="date" defaultValue={sp.from ?? ''} />
              </Field>
              <Field label="To date" name="to">
                <Input name="to" type="date" defaultValue={sp.to ?? ''} />
              </Field>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
                <button type="submit"
                  className="cc-btn rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
                  Apply filters
                </button>
                <Link href="/records"
                  className="cc-btn inline-flex items-center rounded-card border border-line-strong px-4 py-2.5 font-semibold text-ink">
                  Clear
                </Link>
              </div>
            </form>
          </Disclosure>
        </div>
      </Card>

      {searching ? (
        <Card>
          <CardHead title={`${hits.length} result${hits.length === 1 ? '' : 's'} for “${sp.q}”`}
                    sub="Only documents you are allowed to read are searched."
                    action={<ButtonLink href="/records" variant="ghost" className="px-3 py-1.5 text-sm">Back to timeline</ButtonLink>} />
          {hits.length === 0 ? (
            <EmptyState title="Nothing matched"
              body="Either it has not been uploaded, or it belongs to someone who has not shared it with you." />
          ) : (
            <ul className="divide-y divide-line">
              {hits.map((d) => (
                <li key={d.id} className="px-5 py-4">
                  <Link href={`/records/${d.id}`} className="font-semibold text-ink hover:text-accent">
                    {d.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {d.profile_name} · {CATEGORY_LABELS[d.category]}
                    {d.document_date ? ` · ${formatDate(d.document_date, settings.timezone, settings.locale)}` : ''}
                  </p>
                  <p className="mt-1.5 text-sm text-faint">
                    <span className="sr-only">Matched text: </span>…{d.snippet}…
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          <CardHead title="Medical timeline" sub="Newest first, by the date on the document." />
          {docs.length === 0 ? (
            <EmptyState title="No documents yet"
              body="Add a prescription, lab report or discharge summary. CareCircle reads what it can locally and asks you to check it."
              action={<ButtonLink href="/records/new">Add your first document</ButtonLink>} />
          ) : (
            <ol className="divide-y divide-line">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
                  <time className="w-28 shrink-0 font-mono text-sm text-muted"
                        dateTime={d.effectiveDate}>
                    {formatDate(d.effectiveDate, settings.timezone, settings.locale)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <Link href={`/records/${d.id}`} className="font-semibold text-ink hover:text-accent">
                      {d.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {d.profile_name} · {CATEGORY_LABELS[d.category]}
                      {d.provider_name ? ` · ${d.provider_name}` : ''}
                      {d.version_count > 1 ? ` · ${d.version_count} versions` : ''}
                    </p>
                    {d.notes ? <p className="mt-1 text-sm text-faint line-clamp-2">{d.notes}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {d.sensitivity === 'restricted' ? <Badge tone="bad">Restricted</Badge> : null}
                    {!d.extraction_reviewed ? <Badge tone="warn">Needs review</Badge> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
