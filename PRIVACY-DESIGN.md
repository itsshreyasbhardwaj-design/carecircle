# Privacy by design

How privacy decisions were actually made in this codebase, and what follows from
them. [SECURITY.md](SECURITY.md) covers the controls; this document covers the
reasoning and the user-facing consequences.

---

## The premise

Family care coordination creates a direct conflict. Coordination wants shared
visibility: everyone should know what is happening. Dignity wants the opposite:
the person whose body it is decides who knows what. Most products resolve this by
quietly siding with the coordinator, usually by inventing a "family" that everyone
in it can see inside.

CareCircle resolves it the other way, and the data model enforces that rather than
the interface merely suggesting it.

## Decision 1 — The patient owns the record, not the family

Every sensitive row belongs to one `care_profile`, which has exactly one
`owner_user_id`. Access flows only from that owner granting it.

**What this rules out, by construction:**

- A "family admin" who can read everyone's records. The circle coordinator role
  exists, manages the roster, and has no data access whatsoever.
- Access acquired by asserting a relationship. There is no "I am their daughter"
  checkbox that unlocks anything.
- Access inherited from a group. `isCircleMember` is consulted for the roster and
  for the display names of listed profiles, and is never consulted for data.

**What it costs:** coordination needs explicit setup. A relative who joins a circle
sees nothing until someone shares something, which surprises people who expect a
shared family folder. The onboarding and the invitation screen both say so in
advance, because a surprise here is better than silent over-exposure.

## Decision 2 — Consent is specific, purposeful and revocable

A grant is one scope, on one profile, to one person, with a **mandatory stated
purpose** and an optional expiry.

The purpose field is required because future-you will not remember why access was
shared, and "why" is the thing that determines whether it should still exist.

Ten scopes rather than roles like "caregiver", because roles bundle permissions
people did not intend to give. Two deliberate seams:

- **`records:upload` does not imply `records:view`.** A relative who scans
  prescriptions does not need to read the rest of your vault. This is the
  single most useful distinction in the model and the one most products miss.
- **`restricted` documents need a grant naming that document.** A broad
  `records:view` does not reach them, so one sensitive report can stay private
  while the rest of the vault is shared.

## Decision 3 — Revocation is a server fact, not a display preference

Revoking writes `revoked_at` and a ledger row in one transaction. The
authorisation query reads `revoked_at IS NULL AND (expires_at IS NULL OR
expires_at > now)` on **every** check, so the next request from that person is
refused. There is no cache to invalidate and no job that must run.

Three consequences deliberately built in:

1. **Expiry needs no sweep.** A time-limited grant stops working at its expiry
   whether or not anything has run. `sweepExpiredGrants()` only writes ledger
   rows; it is bookkeeping.
2. **Removing a circle member withdraws what that circle granted them**, in the
   same transaction. Roster removal that left stale grants behind would be a
   privacy bug disguised as a UI action.
3. **Background jobs re-check.** `tick()` verifies the recipient still holds the
   scope before generating a notification. A reminder for someone whose access was
   withdrawn is cancelled, not delivered — otherwise revocation would leak through
   the notification channel.

## Decision 4 — The consent ledger is append-only

`access_grants` is live state; `consent_records` is history. Every grant, expiry
and withdrawal is recorded with who, to whom, which scope, which document, the
stated purpose, when, and when it ends.

This exists so a patient can answer "who has had access to my records, and when?"
without trusting a UI to render the current state correctly. It is also why
consent rows **survive account deletion**: a withdrawal that disappears cannot be
evidenced. Those rows carry identifiers and no health content.

## Decision 5 — The audit log cannot hold health content

`audit()` throws if a detail key matches
`text|body|notes|content|extracted|dose|instruction|summary`. Not a convention — a
runtime error, so an accidental future change fails in tests instead of leaking
quietly.

Audit rows therefore record **shape**: which action, which resource id, allowed or
denied, how many bytes, which scope. An assistant query logs its intent and term
count, never the question. Addresses are stored as salted 128-bit hashes, which
still correlate repeat events without identifying a location.

## Decision 6 — Suggestions are never facts

Automatic extraction produces *suggestions*, shown on a review screen, saved only
when a person confirms them. Confidence is capped at `medium` and never presented
as certainty. The original file always remains the authoritative copy, stored
separately from the extracted text.

**The sharpest line in the product:** a document that says "review after 4 weeks"
produces no follow-up date. The wording is surfaced verbatim for a person to act
on. Converting a clinician's instruction into a scheduled date would be
interpreting medical advice, which this software must not do. Two automated tests
assert the absence of that date.

The same reasoning governs medication: the instruction is stored verbatim, with
`instruction_source` and the id of whoever confirmed it. The app never composes,
adjusts or advises on a dose.

## Decision 7 — Honest state beats convenient state

A dose slot is `not_confirmed` until a person says otherwise. Opening the app,
reading the notification or dismissing it changes nothing, and a database CHECK
refuses a `taken` with no reporter.

An unanswered slot is displayed as an open question, never as a missed dose — and
the analytics definition says so in its own text. The difference matters: "nobody
answered the reminder" and "the medicine was not taken" are different facts, and
only one of them is known.

Similarly, reminder states mean exactly what they say: `scheduled`, `generated`,
delivered-in-app, `acknowledged`. There is no "delivered" claim beyond what the
system can evidence, because no SMS, email or push provider exists.

## Decision 8 — Children and dependents are out of scope, on purpose

DPDP imposes specific duties around children's data, including verifiable parental
consent. A tick-box asserting guardianship is not that.

Dependent profiles are therefore stored `proxy_pending_review`, shown as
restricted, and have record features switched off. The product does less than a
competitor would here, and says why on the For Families page. Shipping a proxy
model that cannot be defended would be worse than declining to ship one.

## Data lifecycle

| Stage | Behaviour |
| --- | --- |
| **Collection** | Only what a person types or uploads. No tracking, no analytics, no third-party scripts, no advertising identifiers. |
| **Storage** | SQLite locally; documents encrypted with AES-256-GCM outside the web root at `0600`. |
| **Use** | Every read permission-scoped in SQL. The assistant, the export and the analytics all call the same scoped services and have no queries of their own. |
| **Sharing** | Only through an explicit grant. Nothing leaves the machine. |
| **Retention** | Until deleted. No automatic expiry — and a published retention schedule is a launch prerequisite, not a feature. |
| **Portability** | JSON export of everything, any time, never gated on a plan. |
| **Erasure** | Account deletion removes profiles, records and encrypted files, and withdraws every grant. Consent and audit rows are kept, as explained above. |

## Rights, and where to exercise them

| Right | Where |
| --- | --- |
| Access and portability | Settings → Privacy → Download my data as JSON |
| Correction | Every field a user entered is editable |
| Erasure | Settings → Privacy → Delete my account |
| Withdraw consent | Settings → Access → Withdraw, or on the profile page |
| Know who has access | The profile page lists current grants and the full consent history |
| Know who accessed | The profile page shows an access log for owners |

None of these is behind a plan, a payment or a support request. Charging someone
to leave a product that holds their health information, or to take back consent,
would be indefensible.

## Indian regulatory context

The Digital Personal Data Protection Act, 2023 governs this. The DPDP Rules, 2025
were notified on **13 November 2025** (G.S.R. 846(E)), beginning a phased
transition: Consent Manager registration obligations start around **13 November
2026**, and the substantive duties — notice and consent, security safeguards,
data-principal rights, breach notification, and the associated penalties — become
enforceable on **13 May 2027**.

Where the engineering already lines up with DPDP concepts:

| DPDP concept | In this codebase |
| --- | --- |
| Specific, informed consent | Per-scope grants with a mandatory purpose; the invitation screen states what accepting shares before it happens |
| Purpose limitation | `purpose` is required on every grant and reproduced in the ledger |
| Consent withdrawal | Immediate, server-enforced, ledger-recorded |
| Data-principal rights | Export, correction, erasure, and visibility of who holds access |
| Security safeguards | Argon2id, AES-256-GCM at rest, server-side authorisation, rate limiting, audit logging |
| Breach-relevant logging | Audit events with outcomes, including every denial |
| Children's data | Deliberately unsupported pending a reviewed proxy model |

**This is engineering alignment, not compliance.** CareCircle holds no
certification and claims none. [DEPLOYMENT.md](DEPLOYMENT.md) lists the legal,
organisational and infrastructural work a real launch would need — a published
notice in the prescribed form, a named grievance officer, a breach procedure, a
retention schedule, processor agreements, and independent security testing.

## Known privacy limitations

1. **Metadata is visible to a circle.** Listing a profile shares its display name.
   That is the minimum needed to coordinate, and it is still a disclosure.
2. **Activity summaries are per-scope, not per-record.** Someone with
   `activity:view` sees that a document was added and its title, not its contents.
   A title can itself be revealing.
3. **Audit rows outlive deletion.** Identifiers only, deliberately, so revocation
   stays provable.
4. **No key escrow.** Losing the local key file destroys the documents, for
   everyone, permanently.
5. **A grant with no expiry lasts until revoked.** The UI offers an expiry on every
   sharing form but does not force one.
6. **Document titles and provider names appear in search snippets** for anyone with
   `records:view`, including for a document they can see listed but — if restricted
   — cannot open. Restricted documents are excluded from listing and search
   entirely, which is why that distinction exists.
