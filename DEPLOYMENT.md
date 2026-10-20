# Deployment

## What this build is

A **local development build**. It runs on one machine, stores everything in a
local directory, and needs no external service. That makes it genuinely useful for
evaluation and for a single household, and it is explicitly **not approved for
public deployment with real patient information**.

This document exists so the gap is stated rather than discovered.

## Running it locally

```bash
npm install
npm run build
npm start          # http://localhost:3100
```

Or `npm run dev` for development. Both run migrations first.

### What works locally

Everything in [FEATURES.md](FEATURES.md) marked Verified or Implemented. No
account, key or paid service is required, including for document text extraction
and image OCR.

### What local hosting cannot give you

| Limitation | Consequence |
| --- | --- |
| **No transport encryption** | Served over plain HTTP. Fine on `localhost`; exposing this port to a network sends session cookies and medical records in clear text. |
| **Keys on the filesystem** | `data/secrets/keys.json` sits next to the database. No escrow: lose it and the documents are unrecoverable. |
| **No background worker** | Reminders are generated when a signed-in user loads a page (throttled to once a minute) or when "Run scheduler now" is pressed. Nothing is lost — `tick()` catches up on everything overdue — but delivery is not timely without someone using the app. |
| **In-app notifications only** | No SMS, email or push. A reminder nobody opens the app to see has not reached anyone. |
| **SQLite single-writer** | Correct for a family. Not a concurrency-tested multi-tenant store. |
| **No backups** | Nothing is backed up unless you do it. Back up `data/carecircle.db*`, `data/documents/` and `data/secrets/` — the last one **separately**, since one stolen backup should not yield both the ciphertext and the key. |
| **One machine** | No replication, no failover, no monitoring, no alerting. |

## Before a public deployment with real health data

Grouped roughly in the order they block a launch. This is a statement of work, not
a checklist that has been completed.

### Legal and regulatory (blocking)

1. **Legal review of the privacy notice and terms.** Both are headed DRAFT and say
   so on their own pages. They are engineering-accurate, not legally sufficient.
2. **DPDP Act compliance work.** India's Digital Personal Data Protection Act,
   2023 governs this. The DPDP Rules, 2025 were notified on 13 November 2025
   (G.S.R. 846(E)), starting a phased transition: Consent Manager registration
   obligations begin around 13 November 2026, and the substantive duties — notice
   and consent, security safeguards, data-principal rights, breach notification,
   and the associated penalties — become enforceable on **13 May 2027**. Health
   data attracts the strictest handling expectations. The engineering here aligns
   with several DPDP concepts deliberately (specific, purpose-limited, revocable
   consent; an export and erasure path; a consent ledger that evidences lawful
   basis) but **alignment is not compliance**, and nothing here is certified.
3. **A named grievance officer and a published grievance process.**
4. **A documented breach-notification procedure**, with the timelines the Rules
   require.
5. **A published retention schedule.** Today data stays until a user deletes it.
6. **Legal advice on the proxy-caregiver model** before dependent profiles are
   enabled, including verifiable parental consent for children's data.
7. **Processor agreements** with every vendor that touches the data — host,
   database, object storage, email or SMS provider.

### Security (blocking)

8. **HTTPS everywhere**, HSTS, and `Secure` cookies (already conditional on
   `NODE_ENV=production`).
9. **Move keys into a KMS or secret manager** with rotation and audited access.
   Decide and document what key loss means for stored documents.
10. **Independent penetration testing.** [SECURITY.md](SECURITY.md) records a
    self-review that found and fixed a real open-redirect; it is not a substitute
    for an outside assessment.
11. **A security contact and disclosure policy.** There is none today.
12. **A Content-Security-Policy with nonces** for the application shell. Document
    responses are already sandboxed with `default-src 'none'`.
13. **Centralised, access-controlled, retention-bounded logging.** The audit log
    refuses health content by design; the logging infrastructure around it does
    not exist.
14. **Intrusion detection and anomaly alerting** — for example an account
    downloading an unusual number of documents.
15. **Account-lockout notification.** Rate limiting blocks attempts; nobody tells
    the account holder.

### Infrastructure

16. **Managed PostgreSQL.** The migration path is in
    [ARCHITECTURE.md](ARCHITECTURE.md); FTS5 → `tsvector` is the one real rewrite.
17. **Private object storage** for document blobs. Encryption already happens
    before the write, so a bucket would receive ciphertext.
18. **A durable background worker** calling `tick()`, `extendAllSchedules()` and
    `sweepExpiredGrants()` on a timer, with retries and dead-letter handling.
    `nudgeScheduler()` is then deleted.
19. **Backups with tested restores**, encrypted, with the key held separately.
20. **Monitoring, error tracking and uptime alerting.**
21. **Rate limiting at the edge**, not only in the application.
22. **Load testing**, particularly concurrent writes and accounts with thousands
    of documents.

### Product honesty

23. **Email verification** before claiming an address is verified. The schema has
    `email_verified_at` and nothing sets it, deliberately.
24. **A real password-reset flow** once a mail provider exists. Until then the
    recovery code is the only route, and the UI says why.
25. **Delivery evidence** before promising SMS, email or push. Today the product
    claims only in-app delivery, which is all it can prove.
26. **Payments**, if the Family plan ships. Nothing can be charged today and the
    pricing page says so.

### Accessibility and language

27. **An automated accessibility audit** (axe) plus a manual screen-reader pass.
    Semantics are correct by construction; neither has been run.
28. **Native-speaker review of the Hindi and Bengali strings.**

## What must never be claimed

Until each is genuinely implemented, approved where required, and verified:

- HIPAA certification — not applicable and not held.
- ABDM approval or ABHA integration — no integration exists.
- Government endorsement — none.
- Clinical certification or medical-device status — none, and the product is
  designed to stay out of that category.
- Live hospital or clinic integration — none.
- Reliable emergency or monitoring capability — the product is explicitly not
  that, and says so on every relevant screen.

## Deployment targets

Nothing here is tuned for a specific host. The application is a standard Next.js
server (`next start`), so any Node host works, with two caveats:

- **`node:sqlite` needs Node ≥ 22.5**, and the data directory must be a
  persistent, writable volume — not an ephemeral filesystem. On a platform with
  ephemeral storage, move to PostgreSQL and object storage first.
- **Serverless is a poor fit** as built: the database is a local file and the
  scheduler nudge assumes a long-lived process. Both are solved by items 16–18.
