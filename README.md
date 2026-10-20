# CareCircle

**Your family's care, coordinated.**

One secure place to organise medical records, appointments, medication routines and
family caregiving responsibilities. Built for families in India; runs entirely on
your own machine with no external accounts, API keys or paid services.

> **CareCircle is not a medical device.** It organises healthcare administration.
> It does not diagnose, prescribe, change a dose, interpret results, assess an
> emergency or recommend treatment. It is not an emergency service. This is a local
> development build and is **not approved for use with real patient information** —
> see [DEPLOYMENT.md](DEPLOYMENT.md) for what that would require.

---

## What it does

CareCircle answers three questions, and keeps answering them:

1. **What needs to happen next?** — appointments, care tasks and confirmed medication times in one plan.
2. **Who has agreed to handle it?** — every item has a named owner, or is visibly unassigned.
3. **Has it actually been completed?** — only a person can mark something done. A delivered reminder is never progress.

The load-bearing idea is the permission model. Every sensitive row belongs to one
**care profile**, and you can touch that profile only if you own it or hold an
explicit, non-expired grant on it. Being in a family circle grants nothing.
Administering a circle grants nothing. There is no "family id" that unlocks a set
of records.

## Quick start

```bash
npm install
npm run migrate      # creates ./data/carecircle.db and the local key file
npm run seed:demo    # optional: fictional demo household
npm run dev          # http://localhost:3100
```

`npm run dev` runs migrations first, so a fresh clone works in one command.

Optional, for reading text out of photographs — a one-time ~10 MB download of an
open-source model, after which OCR runs fully offline with no network access:

```bash
npm run setup:ocr
```

Without it the app still accepts and stores photographs; it just says plainly that
it could not read any text, instead of guessing.

### Demo accounts

After `npm run seed:demo`, sign in with password `demo-carecircle-2026`:

| Account | What they can do |
| --- | --- |
| `asha.demo@carecircle.test` | Owns her profile and controls all access |
| `priya.demo@carecircle.test` | Appointments, records, tasks, medications, activity |
| `arun.demo@carecircle.test` | **Tasks and appointments only** — deliberately cannot read documents or medications |

Signing in as Arun is the fastest way to see the permission model working: the
same pages show him less, because the queries behind them select less.

Everything in the demo is invented and labelled as fictional. Rebuild it at any
time with `npm run reset:demo`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Migrate, then start the dev server on port 3100 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run migrate` | Apply pending SQL migrations (append-only; a changed file is rejected) |
| `npm run seed:demo` / `npm run reset:demo` | Create / rebuild the fictional demo household |
| `npm run setup:ocr` | One-time download of the offline OCR model |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `oxlint` |
| `npm run test` | Vitest unit and integration suite |
| `npm run e2e` | Playwright journey against a production build |
| `npm run verify` | typecheck → lint → test → build |

## Architecture in one paragraph

Next.js App Router with React Server Components; mutations are Server Actions, so
there is no parallel REST layer to keep in sync and no duplicate validation.
Persistence is SQLite through Node's built-in `node:sqlite` — no ORM, no native
module to compile — with hand-written, append-only SQL migrations. Authentication
is local: Argon2id password hashing via `@noble/hashes`, sessions stored as
peppered hashes. Documents are encrypted with AES-256-GCM outside the web root and
returned only through an authorising route handler. Text extraction is local
(`unpdf` for PDFs, `tesseract.js` for images). The Circle Assistant is rule-based
and calls the same permission-scoped services the UI does, so it cannot invent a
fact or leak a record. Full detail in [ARCHITECTURE.md](ARCHITECTURE.md).

Runtime dependencies: `next`, `react`, `react-dom`, `zod`, `@noble/hashes`,
`unpdf`, `tesseract.js`. That is the whole list.

## Documentation

| File | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Structure, data model, service boundaries, scaling path |
| [FEATURES.md](FEATURES.md) | Every feature and its verified status |
| [SECURITY.md](SECURITY.md) | Authorisation model, encryption, red-team findings, residual risks |
| [TESTING.md](TESTING.md) | Commands, coverage and actual recorded outcomes |
| [ROADMAP.md](ROADMAP.md) | What is done, what is next, what is deferred and why |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Configuration and secure local setup |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Local hosting limits and the gap to a real deployment |
| [PRIVACY-DESIGN.md](PRIVACY-DESIGN.md) | Consent flows, revocation, retention, DPDP implications |

## What is deliberately not here

No SMS or email delivery. No push notifications. No payment processing. No ABDM or
ABHA integration. No hospital or clinic system connection. No wearable sync. No
external AI service. None of these is presented as working anywhere in the
product, and the UI says so where a user might reasonably expect otherwise.

## Licence

No licence has been chosen yet. Treat it as all rights reserved until one is added.
