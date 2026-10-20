# Security

CareCircle holds health information, which is among the most sensitive categories
of personal data. This document describes the controls that exist, the adversarial
review that was performed, what it found, and — importantly — what is still
missing. A local review by the people who wrote the code is **not** equivalent to
independent penetration testing.

---

## The authorisation model

Everything rests on one invariant, implemented in `src/lib/authz.ts`:

> Every sensitive row belongs to exactly one `care_profile`. A user may act on a
> profile only if they own it, or they hold a row in `access_grants` carrying the
> required scope that is neither revoked nor past its expiry.

There is deliberately **no** "family id" column that unlocks a set of records.
Attempts to design one are the usual source of mass data exposure in family-sharing
products, because membership is easy to acquire and hard to take back precisely.

### Ten scopes, granted one at a time

`appointments:view` · `appointments:manage` · `records:view` · `records:upload` ·
`medications:view` · `medications:manage` · `tasks:view` · `tasks:manage` ·
`activity:view`

`manage` implies the matching `view`. **`records:upload` deliberately does not
imply `records:view`** — being allowed to add a document to someone's vault is not
permission to read what is already in it.

### What membership and administration do not give you

Circle membership gates exactly two things: seeing the roster, and seeing the
display names of profiles listed in that circle. It is never consulted for data
access. A circle **coordinator** can invite and manage the roster and has no more
access to anyone's records than a stranger. There is a test asserting this.

### Scoping happens in SQL

`profileScopeFilter()` returns a `care_profile_id IN (…)` fragment, or `1 = 0` when
the caller has no access at all. Unauthorised rows are never selected, so a
forgotten per-row check cannot leak them. This is why the Circle Assistant and the
data export are safe by construction — they call the same scoped services the UI
does and have no queries of their own.

### Document reads are stricter

A document marked `restricted` requires a grant naming that document. A
profile-wide `records:view` does not reach it. Previews, downloads, search results,
assistant answers and attachment pickers all route through `canReadDocument`.

### Expiry does not depend on a job running

Expiry is evaluated inside the authorisation query (`expires_at > now`). A lapsed
grant stops working immediately whether or not any sweep has executed.
`sweepExpiredGrants()` writes `expired` rows into the consent ledger and is
bookkeeping only — never enforcement.

## Authentication and sessions

| Control | Implementation |
| --- | --- |
| Password hashing | Argon2id (`@noble/hashes`), m=19456 KiB, t=2, p=1 — the OWASP floor. Per-password random 16-byte salt. |
| Credential verification | Constant-time comparison (`timingSafeEqual`). A missing account still spends a hash, so account existence is not detectable by timing. |
| Session tokens | 256 bits of CSPRNG randomness. Stored **only** as `sha256(pepper ‖ token)`, so a database read cannot reconstruct a working session. |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, 14-day expiry. |
| Session revocation | Individually, or all-but-current. A password change evicts every other session. |
| Rate limiting | Database-backed fixed window, surviving restarts: sign-in (8 per 15 min, per account **and** per device), sign-up (10/hour per device), password change (5 per 15 min), recovery (6/hour per device). |
| CSRF | Server Actions only, covered by Next's same-origin checks. The two route handlers are `GET` and side-effect-free. |
| Account recovery | A single-use recovery code shown once at sign-up, stored as a peppered hash. Redeeming it revokes every session. |

**There is deliberately no password-reset-by-email path.** No mail provider is
configured; offering a link that cannot be delivered would be dishonest, and a
reset flow that verifies nothing would be a back door.

## Document security

- **Encryption at rest** — AES-256-GCM. The authentication tag means tampering
  fails loudly rather than returning corrupted plaintext; a test flips a
  ciphertext bit and asserts the read throws.
- **Storage location** — `data/documents/<profile>/<version>.enc`, mode `0600`,
  entirely outside the web root. There is no static URL to a medical record.
- **The only egress** — `GET /api/documents/[id]/file`, which authorises via
  `assertCanReadDocument`, decrypts, and writes the access to the audit log.
  Response headers: `Cache-Control: private, no-store`, `X-Content-Type-Options:
  nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `X-Robots-Tag:
  noindex`. Only PDF, JPEG, PNG, WebP and plain text are served inline; everything
  else is forced to download, so a file can never execute in our origin.
- **Upload validation** — the declared MIME type must match the **actual bytes**
  (`sniffMime` checks magic numbers, and rejects anything that looks like HTML,
  SVG or XML masquerading as text). 15 MB limit. Filenames reduced to a sanitised
  basename, so `../../etc/passwd` becomes `passwd`.
- **No orphan ciphertext** — if the database transaction fails after the blob is
  written, the blob is removed.

### Key management, stated plainly

The document key and session pepper are generated on first run into
`data/secrets/keys.json` with mode `0600`. That path is gitignored, and so is the
whole `data/` directory.

**There is no key escrow and no recovery.** If that file is lost, the encrypted
documents cannot be decrypted by anyone, including whoever operates the build.
Back it up separately from the database — keeping both in one backup means a
single theft gives up both. In production these would belong in a KMS or secret
manager, not on the application filesystem.

## Consent and audit

Consent lives in two tables. `access_grants` is the live state the authorisation
check reads; `consent_records` is an append-only ledger of every grant, expiry and
withdrawal, recording who granted it, to whom, which scope, which document (if
scoped to one), for what stated purpose, when, and when it expires or was
withdrawn. Both are written in the same transaction, so the server stops honouring
a grant at the same moment the ledger records it.

`audit_events` records record access, uploads, downloads, permission creation and
revocation, task changes, profile changes, assistant queries, sign-ins (including
failures), and every authorisation **denial**.

**The audit log cannot contain health content.** `audit()` rejects detail keys
matching `text|body|notes|content|extracted|dose|instruction|summary` with a thrown
error, so an accidental future change fails loudly in tests rather than quietly
leaking. Raw IP addresses are never stored; where an address matters it is kept as
a salted 128-bit hash, which still correlates repeat events.

## Children and dependent adults

CareCircle supports adults who manage their own records and explicitly authorise
caregivers. Managing a child's records, or those of an adult who cannot consent,
requires a proxy-authorisation process that has been legally reviewed —
India's DPDP Act places specific duties around children's data, including
verifiable parental consent.

Rather than approximate that with a tick-box, profiles created as dependents are
stored as `profile_kind = 'proxy_pending_review'`, are visibly restricted in the
UI, and the record features stay switched off. **Nobody gains access to another
person's records by asserting a relationship.**

## Adversarial review

Performed against the checklist below. Each row states what was actually checked
and the outcome. Items marked ✅ have an automated test in
`tests/security.test.ts`, `tests/authz.test.ts` or the relevant suite.

| Threat | Finding |
| --- | --- |
| Cross-user data access | ✅ Two unrelated households; every list, search, export, activity feed and assistant answer verified to contain nothing from the other. |
| Cross-family leakage via the assistant | ✅ Five query shapes against another family's data return nothing and leak no names. |
| Broken object authorisation | ✅ Knowing an exact id does not help: documents, appointments, tasks, schedules and profiles all refuse. |
| Enumeration via error differences | ✅ A non-existent id is refused identically to a forbidden one; `not-found` says only that, never "exists but private". |
| Unauthorised document access | ✅ Stranger, read-only caregiver, and restricted-document cases all blocked at the service layer. |
| Exposed files | ✅ Blobs live outside the web root; the only egress authorises and audits. Ciphertext on disk verified not to contain the plaintext. |
| Unsafe invitation links | ✅ 256-bit tokens, stored only as peppered hashes, single-use, 7-day expiry, revocable, email-bound when addressed. Forged, expired and revoked tokens all rejected. |
| Expired tokens | ✅ Expiry on both invitations and grants verified without any sweep running. |
| Session hijacking | ✅ Tokens never stored in readable form; expiry and revocation verified. HttpOnly/SameSite/Secure set. |
| Insecure uploads | ✅ Content sniffing, size limit, filename sanitisation, HTML-as-text rejection. |
| Sensitive data in logs | ✅ `audit()` refuses health-content keys; no audit row produced by the app contains document text. |
| Privilege escalation | ✅ A caregiver cannot re-share access; assignment and handover both refuse a target without existing access; read-only grants cannot write. |
| Stale access after revocation | ✅ Enforced on the next call. Removing a circle member withdraws what that circle granted. Deleting a profile withdraws everything on it. |
| Incorrect caregiver reassignment | ✅ Handover requires existing `tasks:view`, re-checked **at acceptance time**, not only at request time. |
| Background-job authorisation | ✅ `tick()` re-checks permission before delivering; a reminder for a revoked recipient is cancelled, not sent. |
| Race conditions | Partly. Writes run in `BEGIN IMMEDIATE` transactions, and uniqueness is enforced by database constraints (one active grant per scope, one pending handover per task, one dose slot per instant, one reminder per subject/recipient/time) rather than by read-then-write checks. Not load-tested under concurrency. |
| Header spoofing | ⚠️ **Found and fixed during this review.** `X-Forwarded-For` was read unconditionally, so a client could have rotated it to bypass per-device rate limiting. Now gated behind `CARECIRCLE_TRUST_PROXY`. |
| **Open redirect** | ⚠️ **Found and fixed during this review.** Several actions accepted a `back` field from form data and passed it to `redirect()`, so a crafted form could have bounced a signed-in user to an attacker's site after a real action. Now filtered by `safeBackPath()` (`src/lib/redirects.ts`), which accepts only single-slash absolute paths and rejects scheme-relative, backslash and CR/LF forms. Covered by a test. |

### Other issues found and fixed while building

- **`require()` in an ESM module** (`assistant.ts`) would have thrown at runtime in
  the Next server bundle. Replaced with a static import.
- **Migration PRAGMAs inside a transaction** — `PRAGMA journal_mode = WAL` cannot
  run inside one; the first migration failed. PRAGMAs moved to connection setup.
- **Migrations bundled into the server** — the runner used `readdirSync`, which
  made Next trace the whole project. The runner now lives in a module only
  `scripts/` and `tests/` import, and the app refuses to start unmigrated.
- **Name extraction crossing a line break** — `Patient: X\nSpecimen collected: …`
  captured the following label as part of the name, because `\s` matches newlines.
  Found by a test written against realistic fixture text.

## Residual risks

Stated honestly, because an undocumented risk is worse than a known one.

1. **No independent security assessment.** This review was done by the authors.
2. **No transport encryption locally.** Served over plain HTTP on localhost, which
   is acceptable for one machine and not for anything else.
3. **Keys on the application filesystem.** Production needs a KMS. No escrow
   means lost keys mean lost documents.
4. **SQLite single-writer.** Fine for a family; not a concurrency-tested
   multi-tenant store. `busy_timeout` is 5s.
5. **`X-Forwarded-For` is only trusted when `CARECIRCLE_TRUST_PROXY=1`.** That
   is the safe default: the header is client-settable, so trusting it on a
   directly-reachable deployment would let an attacker rotate it past the
   per-device rate limits. With it unset, per-device limits collapse into one
   shared bucket — stricter, but it means one abusive client can rate-limit
   everyone behind the same deployment. Behind a real proxy, turn it on.
6. **No rate limit on invitation preview or document upload.** Token guessing is
   infeasible at 256 bits, but a signed-in user could hammer either endpoint. This
   is a denial-of-service consideration, not a confidentiality one.
7. **Reminder delivery is best-effort.** Generated only while the app runs. The UI
   says so rather than implying reliability.
8. **A crafted link can display an arbitrary `?error=` or `?ok=` message.** The
   text is escaped by React (no XSS), but it could be used for social engineering
   inside the app's own chrome.
9. **Audit and consent rows survive account deletion**, deliberately, so a
   withdrawal stays provable. They carry no health content, but they do carry
   identifiers.
10. **No account lockout notification.** Rate limiting blocks, but the account
   holder is not told that someone was trying.
11. **Extraction confidence is a heuristic.** Capped at `medium`, never surfaced as
    certainty, and always user-confirmed — but OCR and regex parsing do get things
    wrong, and the product's correctness depends on people actually reading the
    review screen.
12. **Dependency supply chain.** Seven runtime dependencies, `npm audit` clean at
    the time of writing. No lockfile attestation or SBOM.

## Reporting a vulnerability

There is no security contact yet, which is itself a gap: see
[DEPLOYMENT.md](DEPLOYMENT.md). On a local build, raise issues with whoever gave
you the repository.
