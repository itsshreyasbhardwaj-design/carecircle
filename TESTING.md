# Testing

Everything in this document is a recorded outcome, not an intention. Commands are
exactly what was run; figures come from those runs.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint src scripts tests
npm run test        # vitest run — unit + integration
npm run e2e         # playwright test — end to end
npm run verify      # typecheck → lint → test → build
```

`npm run e2e` needs a production build first (`npm run build`). It starts its own
server on port 3101 with a **throwaway data directory**, so it never touches your
real or demo data.

> `npm run dev` and `npm run e2e` both use `.next`. Running the dev server
> replaces the production build, and the e2e server then refuses to start.
> Stop the dev server and re-run `npm run build` before `npm run e2e`.

## What is tested, and how

The unit and integration suite drives the **service layer** against a real
SQLite file — not mocks. Each Vitest worker gets its own temporary data directory
(`tests/setup.ts` sets `CARECIRCLE_DATA_DIR` before any source module loads) and
each test truncates the tables it uses. That means authorisation, constraints,
transactions, FTS5 and the real encryption path are all exercised, because they
are the things most worth exercising.

The end-to-end suite drives a **production build** in a real browser.

## Suites

| File | Covers |
| --- | --- |
| `tests/authz.test.ts` | The authorisation invariant: ownership, grants, scope implication, expiry, per-document restriction, escalation refusal, empty-filter behaviour |
| `tests/accounts.test.ts` | Registration, normalisation, duplicates, credential verification, salting, session storage and revocation, rate limiting, password change, recovery codes, deletion |
| `tests/documents.test.ts` | Content sniffing, type and size refusal, real PDF extraction, encryption on disk, tamper detection, review-before-save, duplicates, versions, cross-user blocking, scoped search, restricted documents, revocation, audit, deletion, filename sanitisation, no orphan blobs |
| `tests/extract.test.ts` | Classification, Indian-convention dates, impossible dates, provider/patient/reference parsing, and that a relative instruction never becomes a date |
| `tests/planner.test.ts` | Appointments, assignment gating, rescheduling, preparation provenance; task lifecycle and transition enforcement; handover workflow including acceptance-time re-checks |
| `tests/medications.test.ts` | Instruction provenance, validation, dose slots, attributed check-ins, the database backstop against an unattributed "taken", unconfirmed-vs-missed, view-only limits, discontinuation |
| `tests/reminders.test.ts` | Idempotent scheduling, no backfill, generation once, restart catch-up, revoked-recipient drop, read-vs-acknowledged, snooze and dismiss, cross-user isolation, notification wording |
| `tests/circles.test.ts` | Circles, roster roles, invitation tokens and previews, single use, expiry and revocation, email binding, offer re-checks, listing, member removal withdrawing access, last-coordinator rule, availability |
| `tests/assistant.test.ts` | Authorised retrieval with source links, nothing for a stranger, preparation packets, follow-up drafts, care briefs, clinical refusal across eight question shapes, query logging without content, restricted exclusion |
| `tests/security.test.ts` | The adversarial checklist: cross-family isolation, object authorisation, enumeration, export scoping, assistant side channels, escalation, stale access, background-job authorisation, logging hygiene, constraint backstops, redirect safety |
| `tests/time.test.ts` | UTC storage, zone conversion across a DST boundary, round-trips, India-first formats, date-line behaviour |
| `e2e/journey.spec.ts` | The 24-step coordination journey (below) |
| `e2e/mobile.spec.ts` | Phone layout, no horizontal overflow on ten routes, 44px targets, empty states, invalid input, credential-reveal avoidance, protected routes, non-committal not-found |
| `e2e/smoke.spec.ts` | All nine marketing pages render; disclosure interaction |

## The end-to-end journey

One serial test, matching the required sequence:

1. Register → 2. complete onboarding → 3. own care profile exists → 4. create a
family circle → 5. invite two people with different offered permissions →
6. invitees accept → 7. permissions applied exactly as offered → 8. authorised
member sees permitted information → 9. unauthorised information stays invisible
(verified for both caregivers, on records and medications) → 10. owner uploads a
document → 11. it appears in the timeline and is searchable by extracted text →
12. schedule an appointment and assign it → 13. create and assign a care task →
14. caregiver accepts it → 15. create a confirmed medication routine (the
confirmation checkbox is required) → 16. the reminder shows as scheduled, not
delivered → 17. record a self-reported check-in → 18. caregiver requests a
handover → 19. the other caregiver accepts and responsibility moves →
20. owner withdraws one permission → 21. the withdrawn permission stops working
while the others keep working → 22. owner exports their data →
23. sign out → 24. every protected route redirects and the APIs answer 401.

## Recorded results

Run on macOS 15 (Darwin 25.6), Node 24.16.0, 2026-10-20.

### Typecheck

```
$ npm run typecheck
(no output — clean)
```

TypeScript `strict` with `noUncheckedIndexedAccess`. Zero errors across
application code, scripts, tests and e2e specs.

### Lint

```
$ npm run lint
0 errors
```

Warnings remain (stylistic: `toSorted` over `sort` on arrays that are already
copies, `no-await-in-loop` in sequential e2e steps where sequence is the point).
They were read and left deliberately rather than suppressed.

### Unit and integration

```
$ npm run test

 Test Files  11 passed (11)
      Tests  154 passed (154)
   Duration  125.31s
```

The duration is dominated by Argon2id, which is intentionally slow: the account
suite alone performs dozens of real hashes. That is the cost of not mocking the
security-critical path.

### Dependency audit

```
$ npm audit
found 0 vulnerabilities
```

Reaching zero required three deliberate decisions, recorded here because they
shaped the stack:

- **Next 16 over Next 15** — Next 15 carried a `postcss` high and a moderate of
  its own, both fixed in 16.
- **oxlint over ESLint** — `eslint-config-next` pulled `fast-glob` →
  `micromatch` → `braces`, seven advisories with no non-breaking fix. oxlint is
  one prebuilt binary with no transitive dependencies.
- **`overrides: { tar: "^7.5.7" }`** — `tar` reached the lockfile through
  `canvas`, an *optional* dependency of pdf.js that is never installed or used
  (the serverless build needs no canvas). The override clears the advisory
  without pulling in code that is not there.

### Production build

```
$ npm run build
✓ Compiled successfully
40 routes
```

### Migration check

```
$ npm run migrate
schema up to date
100 schema objects in data/carecircle.db
```

Re-running is a no-op. Editing an already-applied migration is **rejected** with
an error telling you to add a new file — verified by changing a byte and
observing the refusal.

### End to end

```
$ npm run e2e

Running 10 tests using 1 worker
  [1/10] [desktop] journey.spec.ts    a family coordinates care from sign-up through revocation
  [2/10] [desktop] smoke.spec.ts      marketing pages render and the circle form opens
  [3/10] [mobile]  mobile.spec.ts     the signed-in shell is usable at phone width
  [4/10] [mobile]  mobile.spec.ts     navigation targets are large enough to tap
  [5/10] [mobile]  mobile.spec.ts     a phone user can actually sign out
  [6/10] [mobile]  mobile.spec.ts     empty states explain what to do next
  [7/10] [mobile]  mobile.spec.ts     invalid input is rejected with a readable message
  [8/10] [mobile]  mobile.spec.ts     wrong credentials are refused without saying which half was wrong
  [9/10] [mobile]  mobile.spec.ts     protected routes redirect, and the APIs answer 401
 [10/10] [mobile]  mobile.spec.ts     an unknown record shows the non-committal not-found page

  10 passed (37.9s)
```

The desktop project runs the 24-step journey and the marketing smoke test; the
mobile project runs the same build under a Pixel 7 profile. Each spec file sends
a distinct `X-Forwarded-For`, so the per-device rate limits stay switched on
during the run instead of every spec sharing one bucket.

### Whole pipeline

```
$ npm run verify
typecheck  ✓  (no output)
lint       ✓  0 errors
test       ✓  154 passed (11 files)
build      ✓  Compiled successfully — 40 routes
exit 0
```

## Bugs these tests actually caught

Listed because a test suite that never caught anything is decoration:

| Bug | Caught by |
| --- | --- |
| `findPatientName` captured the next label when a name was followed by another labelled line, because `\s` matches newlines | `extract.test.ts`, written against realistic fixture text |
| `PRAGMA journal_mode = WAL` cannot run inside a transaction — the first migration failed outright | running the migration |
| The migration runner's `readdirSync` made Next trace the entire project into the server bundle | `next build` warning |
| `require()` in an ESM module (`assistant.ts`) would have thrown at runtime in the Next bundle | lint plus review |
| A reminder was never scheduled when the lead time pushed it into the past, so a test asserting "a fired reminder does not complete a task" was passing vacuously | reading a failing assertion rather than adjusting it |
| **Open redirect**: several actions passed a `back` field from form data straight to `redirect()` | adversarial review; now covered by a test |
| `getByLabel('File')` matched the word "profile" in another field's hint — a real ambiguity in the label markup, fixed by removing a redundant sr-only "(required)" that duplicated the `required` attribute | the e2e suite |
| **A phone user could not sign out at all.** The only sign-out control lived in the desktop sidebar, which is `display:none` below the `lg` breakpoint. On a shared phone that is a privacy problem, not a cosmetic one. A sign-out was added to Settings, which is reachable at every width, and a test now asserts it | `mobile.spec.ts` |
| The e2e suite tripped the app's own sign-up rate limit, which exposed that `X-Forwarded-For` was trusted unconditionally — an attacker could have rotated it past per-device limits. Now gated behind `CARECIRCLE_TRUST_PROXY` | the e2e suite |

## What is not tested

Stated plainly:

- **Visual appearance.** No screenshot diffing. Light and dark mode at each
  breakpoint were reviewed by hand.
- **Screen readers.** Semantics are correct by construction — real labels, native
  controls, `role="alert"`, live regions, table captions and scopes — but no
  VoiceOver or NVDA pass was performed.
- **Automated accessibility audit.** No axe run. This is the most valuable missing
  test and the first item on the roadmap.
- **Concurrency.** Uniqueness is enforced by database constraints rather than
  read-then-write checks, which is the right shape, but no concurrent-write test
  was written.
- **Scale.** No load test. Queries take `limit`/`offset`; behaviour with thousands
  of documents is unmeasured.
- **Translation quality.** The Hindi and Bengali strings are present and
  hand-written, not reviewed by a native speaker.
- **OCR accuracy across real-world scans.** Measured at 88% confidence on one
  generated test image. Real prescriptions vary enormously, which is exactly why
  every extracted field requires human confirmation.
