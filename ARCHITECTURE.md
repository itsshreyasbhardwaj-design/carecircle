# Architecture

## Technology, and why

| Concern | Choice | Reasoning |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), React 19 | Server Components mean permission-scoped queries run on the server next to the data. Server Actions remove a whole REST layer and its duplicate validation. |
| Language | TypeScript 5.9, `strict` + `noUncheckedIndexedAccess` | Indexed access returning `T \| undefined` caught several real nullability bugs during the build. |
| Database | SQLite via **`node:sqlite`** (Node ≥ 22.5 built-in) | Zero dependencies, no native compilation, no prebuilt-binary matrix. Real SQL with enforced foreign keys, partial and expression indexes, and FTS5. |
| Migrations | Hand-written, append-only `.sql` files | A SHA-256 of each applied file is recorded; editing an applied migration is rejected rather than silently diverging. |
| Validation | Zod 3 | One schema per server action, at the trust boundary. |
| Passwords | Argon2id via `@noble/hashes` | Audited pure-JS implementation at OWASP parameters (m=19456 KiB, t=2, p=1). No native build, no Rust toolchain. |
| Encryption | `node:crypto` AES-256-GCM | Authenticated encryption, so tampering fails loudly instead of returning garbage. |
| PDF text | `unpdf` | Pure JS; the serverless pdf.js build needs no `canvas`. |
| Image OCR | `tesseract.js` with a local model directory | Runs offline once the model is downloaded; `langPath` points at the filesystem so there is no runtime network call. |
| Styling | Tailwind CSS 4, CSS-first | Semantic tokens via `@theme inline`, so light/dark flips at the variable level and components never name a raw colour. |
| Charts | Inline SVG | Two series of twelve integers. A charting library would add ~500 KB and a client bundle for a bar chart. |
| Lint | `oxlint` | A single prebuilt binary with no transitive dependencies. The ESLint toolchain carried seven unpatchable advisories in `fast-glob`/`micromatch`. |
| Tests | Vitest + Playwright | Vitest drives the service layer against a real throwaway SQLite file; Playwright drives a production build. |

### Deliberate omissions

- **No ORM.** Drizzle and Prisma were both options. The schema is 25 tables of
  plain SQL with constraints that an ORM would obscure, and the authorisation
  model depends on composing SQL fragments (`profileScopeFilter`) that an ORM
  makes awkward. The cost is hand-written queries; the benefit is that the
  security-critical SQL is readable in one place.
- **No REST API.** Server Actions handle every mutation. Next's same-origin
  checks cover CSRF for them. Route handlers exist only where a non-HTML response
  is genuinely needed: document bytes and the data export.
- **No component library.** Native `<dialog>`, `<details>`, `<input type="date">`,
  real `<label>` and `<fieldset>` give keyboard support, screen-reader semantics
  and mobile pickers for free. About 20 primitives in `src/components/ui.tsx`.
- **No client-side state management.** Filters and the assistant live in the URL
  as `GET` form targets, which also makes them shareable and re-runnable. The only
  client components are a pending-state submit button, a confirmation dialog, a
  copy-to-clipboard field and a repeatable time input — all of which still work
  with JavaScript disabled.

## Layout

```
src/
  db/
    index.ts              connection, PRAGMAs, tx(), all/one/run  (no fs access)
    migrate.ts            migration runner  (imported only by scripts/ and tests/)
    migrations/001_init.sql
  lib/                    the whole domain. Imported by pages, actions and tests.
    env.ts                paths, limits, local key generation, IP hashing
    crypto.ts             Argon2id, token hashing, AES-256-GCM
    ids.ts                sortable, unguessable ids
    time.ts               UTC storage, IANA zone conversion, India-first formats
    authz.ts              ★ the authorisation model
    audit.ts              audit log + activity feed (rejects health content)
    consent.ts            grants + append-only consent ledger
    accounts.ts           registration, credentials, sessions, rate limiting
    session.ts            Next cookie/header glue  (server-only)
    profiles.ts  circles.ts  documents.ts  extract.ts
    appointments.ts  tasks.ts  medications.ts  reminders.ts
    assistant.ts  analytics.ts  activity.ts  exporting.ts
    validate.ts           Zod schemas
    i18n.ts               en / hi / bn dictionaries
    scheduler-hook.ts     throttled scheduler nudge
  app/
    (site)/               public marketing pages
    (auth)/               login, signup, recover
    (app)/                authenticated application  (layout calls requireUser)
    actions/              server actions, one file per area
    api/                  document download, data export
  components/
    ui.tsx                server-safe primitives
    client.tsx            the only client-side JavaScript
```

**Import convention:** `src/lib` and `src/db` use relative imports with explicit
`.ts` extensions, because Node's native type stripping runs those same files from
`scripts/` and `tests/` without a bundler. `src/app` and `src/components` use the
`@/` alias, which only ever runs through Next. Mixing is intentional and the
boundary is exactly "does a plain `node` process ever load this file".

## The authorisation model

This is the part to read first, in `src/lib/authz.ts`.

> Every sensitive row belongs to exactly one `care_profile`. A user may act on a
> profile only if they own it, or they hold a row in `access_grants` carrying the
> required scope that is neither revoked nor past its expiry.

Ten scopes: `appointments:view|manage`, `records:view|upload`,
`medications:view|manage`, `tasks:view|manage`, `activity:view`.

Three design decisions worth calling out:

1. **`records:upload` does not imply `records:view`.** Being allowed to add a
   document to someone's vault is not permission to read what is already there.
2. **Circle membership confers nothing.** `isCircleMember` gates the roster and
   the display names of listed profiles. It is never consulted for data access.
   A circle coordinator has no more record access than a stranger.
3. **List queries are scoped in SQL, not filtered afterwards.**
   `profileScopeFilter()` returns a `care_profile_id IN (…)` fragment, or
   `1 = 0` when the user has no access at all. Rows they may not see are never
   selected, so a forgotten per-row check cannot leak them. This is why the
   assistant and the export are safe by construction: they call the same scoped
   services.

Document reads are stricter still. A document marked `restricted` needs a grant
naming that document; a profile-wide `records:view` does not reach it.

Expiry is evaluated inside the authorisation query (`expires_at > now`), so a
lapsed grant stops working whether or not any sweep has run. `sweepExpiredGrants()`
exists only to write `expired` rows into the consent ledger — it is bookkeeping,
never enforcement.

## Data model

25 tables. Full DDL with comments in `src/db/migrations/001_init.sql`.

**Identity** — `users`, `sessions`, `user_settings`, `rate_limits`

**People and groups** — `care_profiles` (one `is_self` per user, enforced by a
partial unique index), `care_circles`, `circle_memberships`, `circle_profiles`

**Consent** — `access_grants` (live state; a partial unique index on
`(profile, grantee, scope, COALESCE(document_id,''))` prevents duplicate active
grants), `consent_records` (append-only ledger), `invitations` (token stored only
as a peppered hash)

**Health Vault** — `medical_documents`, `document_versions` (one encrypted blob
each, with its IV, GCM tag and the plaintext SHA-256 for duplicate review),
`document_extractions` (kept deliberately separate from the original; the original
is authoritative), `document_search` (FTS5)

**Coordination** — `appointments`, `appointment_prep_items` (each carries
`source`: `user` or `clinician_provided`), `appointment_documents`, `care_tasks`
(with `CHECK (status <> 'completed' OR completed_at IS NOT NULL)`), `task_events`,
`task_documents`, `task_handovers` (partial unique index allows one pending
handover per task), `caregiver_availability`

**Medication** — `medication_schedules` (verbatim `dose_instruction`, plus
`instruction_source` and `confirmed_by_user_id`), `medication_checkins` (with
`CHECK (status = 'not_confirmed' OR reported_by_user_id IS NOT NULL)` — the
database itself refuses an unattributed "taken")

**Reminders** — `reminders` (unique on subject + recipient + instant, which is the
duplicate-notification guard), `notifications`

**History** — `care_activity` (each row stores the `required_scope` a reader needs,
so one feed shows different things to different members), `audit_events`

## Reminder processing

States mean exactly what they say: `scheduled` (a row exists for a future
instant), `generated` (the instant passed while the server was running and a
notification row was created), delivered (the notification is in the in-app
centre — the only delivery this build can evidence), `acknowledged` (a person
pressed the button).

`tick()` selects everything with `due_at <= now`, so a server that was asleep
catches up rather than losing reminders. It **re-checks permission at delivery
time**: a reminder whose recipient lost access in the meantime is cancelled, not
delivered. There is no always-on worker in a local build; `nudgeScheduler()` runs
`tick()` at most once a minute when a signed-in user loads the app shell, and the
notifications page has an explicit "Run scheduler now" button. That limitation is
stated in the UI rather than hidden.

## Document pipeline

1. Validate declared type against the **actual bytes** (`sniffMime`) — a mismatch
   is rejected, so an HTML or SVG payload cannot arrive as `image/png`.
2. Enforce the 15 MB limit; sanitise the filename to a bare basename.
3. Hash the plaintext (SHA-256) and look for duplicate candidates — surfaced for
   review, never auto-deleted.
4. Extract text locally: PDF text layer, plain text, or offline OCR for images.
5. Encrypt with AES-256-GCM, write under `data/documents/<profile>/<version>.enc`
   with mode `0600`. On any database failure the blob is removed, so no orphan
   ciphertext is left behind.
6. Insert document, version and extraction rows in one transaction; reindex FTS.
7. Send the user to a review screen. **Only confirmed fields are saved.**

A phrase like "review after 4 weeks" is surfaced verbatim as a note and never
converted into a date — interpreting a clinician's instruction is not this
software's job. There is a test asserting exactly that.

## Scaling path

The seams are already where they need to be.

- **PostgreSQL** — all SQL lives in `src/lib/*`; `src/db/index.ts` is the only
  place that opens a connection. The dialect features in use (partial indexes,
  expression indexes, `ON CONFLICT DO UPDATE`, CTE-free queries) all exist in
  Postgres. FTS5 would become `tsvector`, which is the one genuine rewrite.
- **Object storage** — `documents.ts` touches the filesystem in four places
  (`writeFileSync`, `readFileSync`, `rmSync`, `mkdirSync`). Encryption already
  happens before the write, so a bucket would receive ciphertext.
- **A real background worker** — `tick()`, `extendAllSchedules()` and
  `sweepExpiredGrants()` are pure functions over the database. A worker process
  calls the same three functions on a timer; `nudgeScheduler()` is then deleted.
- **Managed identity** — `accounts.ts` and `session.ts` are separable: the former
  is pure, the latter is the only module that knows about cookies.
- **React Native** — the domain layer has no React in it. A mobile client needs an
  API surface over `src/lib`, which is why the services return plain data.

Deliberately *not* done: microservices, a message queue, a caching layer, an event
bus. None is justified at this size, and each would make the authorisation model
harder to verify.
