# Features

Status key, used exactly as defined:

| Status | Meaning |
| --- | --- |
| **Verified** | Implemented, and covered by an automated test that actually runs |
| **Implemented** | Working in the application, exercised by hand, no dedicated automated test |
| **Partial** | Some of it works; the gap is stated |
| **Not implemented** | Not built |
| **Deferred** | Deliberately out of scope, with the reason stated |

Counts refer to the suite recorded in [TESTING.md](TESTING.md).

---

## Phase 0 — Foundation

| Feature | Status | Notes |
| --- | --- | --- |
| Repository and environment inspection | Verified | Node 24.16, no Homebrew, no Rust — informed every dependency choice |
| Architecture and technology selection | Verified | `node:sqlite` and Argon2id-in-WASM-free-JS both probed before adoption |
| Project initialisation | Verified | `npm run verify` passes end to end |
| Database with migrations | Verified | 25 tables, append-only migrations, SHA-256 recorded per file |
| Authentication foundation | Verified | 13 account/session tests |
| Design system | Implemented | Semantic tokens, complete light and dark themes |
| Component library | Implemented | ~20 primitives on native HTML elements |
| Routing | Verified | 40 routes build; marketing pages asserted in the e2e smoke spec |
| Testing infrastructure | Verified | Vitest with per-worker throwaway databases; Playwright against a production build |
| Security foundation | Verified | 24 adversarial tests |

## Phase 1 — Functional MVP

### 1. Marketing website — Implemented
Home, Features, How It Works, For Families, Pricing, FAQ, Privacy (draft), Terms
(draft), Contact, Sign In, Sign Up. All eleven render; nine asserted in the e2e
smoke spec. Previews use invented data and are labelled "Example data". No
invented customer counts, partnerships, endorsements, certifications, awards,
testimonials or approvals anywhere. Both legal documents are headed **DRAFT** and
state that they need legal review.

### 2. Authentication — Verified
Registration, login, logout, Argon2id hashing, session management, protected
routes, password change, session revocation (individual and all-others), account
profile editing, account deletion, single-use recovery codes, per-account and
per-device rate limiting. Email verification is **not implemented** and the schema
records that explicitly rather than implying it happened.

### 3. Onboarding — Implemented
Seven steps: welcome, how coordination works, your own profile, create a circle,
how permissions work, add to your plan, about the vault. Progress persists on the
user row; every optional step is skippable; the one-time recovery code is shown
once, here.

### 4. Patient-controlled care profiles — Verified
Create, edit, delete. One `is_self` profile per user, enforced by a partial unique
index. Deleting a profile withdraws every grant on it in the same transaction.
Dependent profiles are created restricted — see *Children and dependents* below.

### 5. Family circles — Verified
Create, join, leave, manage the roster, promote and demote coordinators, list and
unlist profiles. 20 tests. **Membership grants no data access**, and there is a
test proving a coordinator sees nothing of a member's records.

### 6. Family invitations — Verified
256-bit tokens stored only as peppered hashes, single use, 7-day expiry,
revocable, optionally bound to an email address. The acceptance screen states
exactly which permissions will be shared before anything happens. Offers are
re-checked against the inviter's current ownership at acceptance. Since no mail
provider is configured, the link is copied by hand — which the UI says plainly.

### 7. Granular permissions — Verified
Ten scopes, granted individually with a stated purpose and an optional expiry.
Enforced on the server in SQL. `records:upload` deliberately does not imply
`records:view`. Per-document grants for restricted documents. 10 authorisation
tests plus 24 adversarial ones.

### 8–10. Health Vault, uploads, timeline — Verified
Eight document categories. Content-type sniffing against actual bytes, 15 MB
limit, filename sanitisation, AES-256-GCM at rest outside the web root,
authorised-and-audited download, version history, duplicate review, restricted
documents. Chronological timeline filterable by person, type, date, provider and
tag. 18 tests.

### 11. Search — Verified
SQLite FTS5 over title, provider, notes, tags and extracted text, joined against
the permission-scoped document query. Tests confirm a stranger searching for
another family's patient name gets nothing, and that a restricted document never
appears.

### 12. Appointment management — Verified
Six statuses. Provider, location, IANA time zone, duration, notes, follow-up date,
responsible person. Rescheduling preserves the original as `rescheduled`, links
the replacement and copies the preparation list forward unticked. 7 tests.

### 13. Shared care planner — Verified
Tasks with assignee, due date, priority, six statuses on an enforced transition
map, comments, full event history and completion confirmation. Appointments and
tasks share one calendar view. A database CHECK prevents a completed task without
a completion timestamp.

### 14. Caregiver responsibility assignment — Verified
Assignment requires the assignee to already hold the matching scope; otherwise it
is refused with a message telling the owner to share the permission first. Tested
for both appointments and tasks.

### 15. Prescribed medication reminders — Verified
Verbatim instruction, `instruction_source` (clinician-written / patient-entered /
caregiver-entered), who confirmed it and when, optional prescription attachment,
reminder times, days of week, start and end dates, refill date. A required
confirmation checkbox blocks saving, in the browser and again in Zod. Check-ins
are taken / skipped / not confirmed / snoozed, always attributed — and a database
CHECK refuses a "taken" with no reporter. 11 tests.

### 16. In-app notifications — Verified
Unread counts, list, mark read, acknowledge (distinct from read), dismiss, snooze,
per-category preferences, links to the underlying record. 11 tests. No SMS, email
or push: **Deferred**, and the UI says so where a user would expect otherwise.

### 17. Dashboard — Implemented
Greeting, profile selector, four summary metrics, today's chronological plan with
inline dose check-in, family responsibilities with inline accept, upcoming
appointments, vault activity, recent notifications, five quick actions. Every
figure comes from the database; demo data is flagged with a visible banner.

### 18. Profile and privacy settings — Implemented
General (language, time zone, theme, larger text, reduced motion, reminder lead
time, notification categories), Access, Privacy and data, Security.

### 19. Audit history — Verified
Per-account security history, and a per-profile access log the owner can read.
`audit()` refuses to write health-content keys — tested for seven key names.

### 20. Export and deletion — Verified
JSON export of account, settings, sessions, profiles, circles, document metadata,
versions with hashes, appointments, tasks, medication schedules and check-ins,
grants given and held, consent history, notifications and the user's own activity
log. Account deletion removes profiles, records and encrypted files, withdraws all
grants, and keeps the consent ledger so a withdrawal stays provable. Neither is
ever gated on a plan.

## Phase 2 — Intelligent coordination

### 1. Local document OCR — Verified
PDF text via `unpdf`, verified against a real PDF fixture. Image OCR via
`tesseract.js` with a local model directory, measured at 88% confidence and ~350ms
on a generated test image, with **no runtime network access**. Enabled by one
`npm run setup:ocr`; without it, images are stored and the app states plainly that
no text was read rather than guessing.

### 2. Document classification — Verified
Weighted keyword rules across all eight categories. Refuses to classify on a
single weak keyword.

### 3. Verified metadata extraction — Verified
Suggests category, document date, provider, patient name, reference identifiers
and an explicitly-written follow-up date. Day-first date parsing for Indian
convention, with impossible dates rejected. Confidence capped at `medium`, never
`high`. **Nothing is saved without human confirmation.**

**The safety behaviour worth naming:** a relative instruction such as "review
after 4 weeks" is surfaced verbatim as a note and **never** converted into a date.
Interpreting a clinician's instruction is not this software's job, and two tests
assert it.

### 4. Duplicate detection — Verified
Plaintext SHA-256 for exact matches, title match as a weak signal. Surfaced for
review; **nothing is ever deleted automatically**.

### 5. Document version management — Verified
Unlimited versions, each with its own encrypted blob, hash and uploader. Earlier
versions stay downloadable.

### 6. Structured health history — Implemented
Per-profile timeline with per-scope section visibility, consent history and access
log for owners.

### 7. Doctor visit preparation packets — Verified
Questions for the doctor, transport, documents to bring, admin, and clinic
instructions — each tagged `user` or `clinician_provided`. Print styles included.
Assembled by the assistant from stored records only.

### 8. Caregiver availability — Verified
Available / limited / unavailable over a date range, per circle, with notes.

### 9. Care handover workflows — Verified
Request → in-app notification → permission check → accept or decline → transfer →
audit. One pending handover per task (database-enforced), 3-day expiry, cancellable.
8 tests, including: a handover to someone without access is **refused**; access is
**re-checked at acceptance**, not only at request; and accepting grants no new
record access.

### 10. Temporary caregiver access — Verified
Any grant can carry an expiry date, honoured by the authorisation query itself.

### 11. Multiple family circles — Verified
Unlimited circles per user, independent rosters and listed profiles.

### 12. Advanced care task management — Verified
Enforced transition map, priorities, comments, document links, appointment links,
assignment history, completion attribution.

### 13. Care activity summaries — Verified
Per-row permission-filtered family timeline: two people in one circle correctly
see different entries, because each row stores the scope a reader needs.

### 14. Circle Assistant — Verified
Rule-based intent recognition over the same permission-scoped services the UI
uses. Five capabilities: record finder, appointment preparation, document
organiser (via the review step), follow-up extractor, family care brief. Every
answer carries source links to records the asker can open. 12 tests, including
that a stranger gets nothing and that no name leaks.

**It refuses clinical questions.** Eight question shapes — dose changes, safety,
interpretation, diagnosis, side effects, urgency — are detected and declined with
a pointer to a clinician. Tested.

### 15. Follow-up task extraction with confirmation — Verified
Only explicitly written follow-up dates are offered, as drafts. The assistant
creates nothing.

### 16. Advanced search — Verified
FTS5 with prefix matching, snippets, and filters by person, type, provider, tag
and date range.

### 17. Family activity timeline — Verified
See item 13.

### 18. Care coordination analytics — Implemented
Nine metrics, each displayed **with the definition used to compute it**: open,
overdue and unassigned tasks, upcoming and unassigned appointments, completed
tasks, handovers, documents added, unanswered dose slots. Plus per-caregiver load
and a 12-week throughput chart.

**Deliberately absent, and must stay absent:** disease-risk scores, medical
severity scores, health predictions, clinical adherence ratings. The unanswered-dose
metric states in its own definition that it counts unanswered reminders and is not
a count of missed doses.

### 19. Offline-friendly functionality — Partial
What exists: Next.js static asset caching; server-rendered pages that work without
JavaScript; every form submits without it. What does **not** exist: a service
worker, offline drafts, or cached appointment details. Caching encrypted medical
records in a browser safely needs a design that has been thought through and
tested, and guessing at it would be worse than not having it. See
[ROADMAP.md](ROADMAP.md).

### 20. Accessibility and language — Implemented
17px base type with a larger-text setting, 44px minimum touch targets, visible
focus rings never removed, real labels and fieldsets, `role="alert"` on errors,
a skip link, `aria-live` regions, semantic tables with captions and scopes,
accessible SVG chart description, honoured `prefers-reduced-motion` plus an
explicit setting, complete dark mode, India-first date and time formats.
English, Hindi and Bengali for navigation and common messages; clinical content is
never machine-translated. No automated axe audit has been run — see *Not verified*
below.

## Pricing and billing

| Item | Status |
| --- | --- |
| Pricing page with Free / Family / Clinics tiers | Implemented |
| Internal entitlement model (`plan`, `plan_source`) | Implemented |
| Developer plan override, refused in production, marked `dev_override` | Implemented |
| Real payments | **Not implemented**, by instruction. No provider connected; nothing can be charged or simulated. |

Export, deletion and consent withdrawal are never gated on a plan.

## Children and dependents — Deferred, deliberately

Profiles created as dependents are stored `proxy_pending_review`, shown as
restricted, and have record features switched off. India's DPDP Act imposes
specific duties around children's data including verifiable parental consent;
approximating that with a tick-box would be worse than declining to support it.

## Phase 3 integrations — All deferred

ABDM, ABHA, FHIR exchange, hospital and clinic systems, cloud hosting, production
push notifications, SMS, managed database, payment providers, external AI APIs,
wearables. None is implemented, none is advertised, and the absence of all of them
does not prevent anything above from working locally.

## Not verified

Honest list of things that work but have no automated proof:

- Visual appearance in light and dark mode at every breakpoint (reviewed by hand).
- Screen-reader behaviour with a real screen reader. Semantics are correct by
  construction; no VoiceOver or NVDA pass was done.
- An automated accessibility audit (axe or similar).
- Hindi and Bengali translation quality, beyond the strings being present.
- Behaviour under concurrent writes from several users at once.
- Performance with thousands of documents. Lists paginate, but no load test was run.
