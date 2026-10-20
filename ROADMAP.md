# Roadmap

## Phase 1 — Functional MVP ✅ Complete

Marketing site, authentication, onboarding, patient-controlled care profiles,
family circles, invitations, ten granular permissions, Health Vault with encrypted
storage, document uploads, medical timeline, full-text search, appointment
management, shared care planner, caregiver assignment, medication reminders with
confirmed instructions, in-app notifications, Today dashboard, settings, audit
history, export and deletion.

Status detail per feature in [FEATURES.md](FEATURES.md).

## Phase 2 — Intelligent coordination ✅ Complete, with one gap

Local OCR (PDF and offline image), document classification, verified metadata
extraction, duplicate detection, version management, structured health history,
doctor visit preparation packets, caregiver availability, care handover workflows,
temporary access, multiple circles, advanced task management, activity summaries,
Circle Assistant, follow-up extraction with confirmation, advanced search, family
activity timeline, coordination analytics, accessibility and three languages.

**The one gap: offline support is partial.** Server-rendered pages work without
JavaScript and every form submits without it, but there is no service worker, no
offline drafts and no cached appointment details. Caching encrypted medical
records in a browser safely needs a design that has actually been thought through
and tested; shipping a guess would be worse than shipping nothing. See below.

## Immediate next steps

Ordered by value, not by difficulty. Each is a self-contained piece of work.

### 1. Offline support, done properly
The honest version of Phase 2 item 19.
- A service worker caching only the application shell and non-sensitive assets.
- Locally drafted care tasks and comments, queued and synced, with visible
  conflict handling — no silent overwrites.
- A clear connectivity indicator and visible sync failures.
- **Deliberately not** cached: documents, extracted text, medication
  instructions. A design for that needs an encrypted store with a key that is not
  sitting in the same browser, plus a threat model for a shared device.

### 2. Automated accessibility verification
Semantics are correct by construction and no tooling has confirmed it. Add an axe
run in CI, then do a manual VoiceOver and NVDA pass. Fix what they find.

### 3. Email verification and password reset
`email_verified_at` exists and nothing sets it, deliberately. Once a provider is
configured: verify on sign-up, and add a real reset flow. Until then the recovery
code stays the only route and the UI explains why.

### 4. Native-speaker review of Hindi and Bengali
Strings are present and hand-written, not reviewed. Also extend coverage beyond
navigation and common messages into form hints and error text.

### 5. A real background worker
Replace `nudgeScheduler()` with a process calling `tick()`,
`extendAllSchedules()` and `sweepExpiredGrants()` on a timer, with retries. This
is what makes reminder delivery timely rather than best-effort, and it is a
prerequisite for honestly promising anything about reminders.

### 6. Concurrency and scale testing
Uniqueness is enforced by database constraints rather than read-then-write checks,
which is the right shape, but it has not been load-tested. Test concurrent writes
and an account with thousands of documents.

## Phase 3 — Integrations, all deferred

None of these is implemented, none is advertised anywhere in the product, and the
absence of all of them does not stop anything above from working.

| Integration | What it needs first |
| --- | --- |
| **ABDM / ABHA** | Sandbox access, a formal integration agreement, and whatever approval the NHA requires. Not a code problem. |
| **FHIR exchange** | A decision on which resources and profiles to support, then a mapping layer. The current schema is coordination-shaped, not FHIR-shaped. |
| **Hospital / clinic systems** | Per-institution agreements. Realistically an enterprise product, not a feature. |
| **SMS reminders** | A gateway, DLT template registration in India, and consent for messaging separate from consent for data. |
| **Email** | A provider and sender authentication. Unblocks items 3 above. |
| **Push notifications** | A real worker (item 5), VAPID keys, and honest handling of the fact that browser push is unreliable. |
| **Payments** | A provider, tax handling, invoicing, refunds, and a subscription lifecycle. The entitlement model is already there. |
| **Cloud hosting** | Everything in [DEPLOYMENT.md](DEPLOYMENT.md). |
| **Managed PostgreSQL** | Mostly mechanical; FTS5 → `tsvector` is the one real rewrite. |
| **Private object storage** | Four filesystem calls in `documents.ts`. Encryption already happens before the write. |
| **External AI services** | Would need a clear reason the rule-based assistant cannot serve, plus consent for sending health data off-device, plus a story for hallucination in a health context. Not obviously a good idea. |
| **Wearables** | Out of scope. CareCircle coordinates administration; continuous physiological data is a different product with different regulatory weight. |
| **React Native app** | The domain layer has no React in it, so this needs an API surface over `src/lib`. |

## Explicitly not planned

Not "later" — decisions not to build:

- **Any clinical capability.** No diagnosis, prescribing, dose calculation,
  interaction checking, triage or treatment recommendation. This boundary is what
  keeps CareCircle out of medical-device regulation, and it is enforced in code:
  the assistant refuses clinical questions and the medication module cannot
  compose an instruction.
- **Risk, severity or adherence scores.** Analytics measure coordination. A
  "medication adherence score" built from self-reported check-ins would be a
  number that looks clinical and is not.
- **Emergency or monitoring features.** The product says on every relevant screen
  that it will not summon help. Anything suggesting otherwise would be dangerous.
- **Proxy access by assertion.** Dependent profiles stay restricted until a
  legally reviewed authorisation workflow exists (see
  [PRIVACY-DESIGN.md](PRIVACY-DESIGN.md)).
- **A family-wide "admin can see everything" mode.** The most requested feature in
  this category, and the one that would undo the entire point.

## Architectural debt, named

Small and known, rather than discovered later:

1. **`countDocuments()` counts by listing.** It fetches up to 10,000 rows and
   takes the length, because the scoped-list query and a `COUNT` would otherwise
   drift apart. Correct but wasteful; replace with a shared query builder when
   document counts get large.
2. **Analytics recompute per request.** Nine metrics, each running its own scoped
   query. Fine at family scale; needs caching or materialisation beyond that.
3. **`accessibleProfiles()` loops scopes.** One `visibleProfileIds` call per scope.
   A single query with a `GROUP BY` would do it.
4. **Assistant follow-up extraction is O(documents).** It inspects up to 40
   extractions per request. Should become an indexed column once confirmed.
5. **Mixed import conventions.** `src/lib` and `src/db` use relative `.ts` imports
   so plain `node` can run them from scripts and tests; `src/app` uses `@/`. The
   boundary is documented and intentional, and it is still two conventions.
6. **No pagination UI.** Queries take `limit`/`offset` and the pages pass
   generous limits without surfacing controls.
