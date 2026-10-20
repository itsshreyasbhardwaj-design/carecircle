# Environment and configuration

CareCircle runs with **no configuration at all**. Everything below is optional.

## Requirements

| Requirement | Why |
| --- | --- |
| **Node.js ≥ 22.5** (developed and tested on 24.16) | `node:sqlite` is a built-in from 22.5. There is no native module to compile, so no Python, no C++ toolchain, no Rust. |
| npm | Any recent version. `package-lock.json` is committed. |
| ~400 MB disk | `node_modules`, the build output, and your own data. |

No database server, no Docker, no cloud account, no API key, no paid service.

## First run

```bash
npm install
npm run migrate
npm run dev        # http://localhost:3100
```

`npm run migrate` creates, on first use:

| Path | Contents | Permissions |
| --- | --- | --- |
| `data/carecircle.db` | SQLite database (plus `-wal` and `-shm`) | default |
| `data/secrets/keys.json` | Document encryption key and session pepper | `0600` |
| `data/documents/` | Encrypted document blobs, one per version | `0600` per file |
| `data/ocr-models/` | Offline OCR model, only if you run `setup:ocr` | default |

The whole `data/` directory is gitignored. `npm run dev` and `npm start` run
migrations first, so a fresh clone works in one command.

## Environment variables

All optional. There is no `.env` file to create, and `.env*` is gitignored.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CARECIRCLE_DATA_DIR` | `./data` | Where everything is written. Used by the test suites to point at a throwaway directory. |
| `CARECIRCLE_DOCUMENT_KEY` | generated | 32-byte hex key for document encryption. **Must** be set together with the pepper. |
| `CARECIRCLE_SESSION_PEPPER` | generated | 32-byte hex pepper for session, invitation, recovery-code and IP hashing. |
| `NODE_ENV` | — | `production` disables the developer plan override. |
| `CARECIRCLE_TRUST_PROXY` | unset | Set to `1` **only** behind a trusted reverse proxy. It makes the app read `X-Forwarded-For` for audit hashing and per-device rate limiting. Left unset, that header is ignored, because a client can set it freely and would otherwise walk past the IP rate limit. |
| `PORT` | 3100 / 3101 | Set via the npm scripts. |

### Supplying keys yourself

Both must be provided together; if either is missing, both come from the local
file instead.

```bash
export CARECIRCLE_DOCUMENT_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export CARECIRCLE_SESSION_PEPPER=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

**Changing either key is destructive.** A new document key makes existing
documents undecryptable. A new pepper invalidates every session, every unused
invitation link and every unused recovery code.

### Key handling rules

1. **Never commit them.** `data/`, `secrets/` and `.env*` are all gitignored.
2. **Back up `data/secrets/keys.json` separately from the database.** There is no
   escrow and no recovery: lose it and the documents are gone for everyone,
   permanently. Keeping the key and the database in one backup means a single
   theft gives up both.
3. In production these belong in a KMS or secret manager, not on the application
   filesystem. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Optional: offline OCR for photographs

```bash
npm run setup:ocr          # English
npm run setup:ocr eng hin ben   # additional languages
```

One-time download of ~10 MB per language from the Tesseract project into
`data/ocr-models/`. After that, OCR runs **entirely offline** — `langPath` points
at the local directory, so there is no network call at request time.

Without it the app still accepts and stores photographs; it reports plainly that
no text could be read and asks you to type the details, rather than guessing.
No account or key is involved either way.

## Optional: demo data

```bash
npm run seed:demo     # create
npm run reset:demo    # rebuild from scratch
```

Creates three dedicated accounts under `@carecircle.test` with password
`demo-carecircle-2026`. Every row it writes carries `is_demo = 1`, and the script
**refuses to run** if one of those email addresses exists but was not created by
the seed — so fictional health records can never attach to a real account.

## Limits and defaults

| Setting | Value | Where |
| --- | --- | --- |
| Max upload | 15 MB | `MAX_UPLOAD_BYTES` in `src/lib/env.ts` |
| Accepted types | PDF, JPEG, PNG, WebP, HEIC, plain text | `ALLOWED_UPLOAD_TYPES` |
| Session lifetime | 14 days | `SESSION_TTL_MS` in `src/lib/accounts.ts` |
| Invitation lifetime | 7 days | `INVITE_TTL_DAYS` in `src/lib/circles.ts` |
| Handover expiry | 3 days | `HANDOVER_TTL_DAYS` in `src/lib/tasks.ts` |
| Argon2id | m=19456 KiB, t=2, p=1 | `ARGON` in `src/lib/crypto.ts` |
| Sign-in limit | 8 per 15 min, per account and per device | `src/app/actions/auth.ts` |
| Default time zone | `Asia/Kolkata` | `DEFAULT_TZ` in `src/lib/time.ts` |
| Scheduler nudge | at most once per 60s | `src/lib/scheduler-hook.ts` |
| Dose slot horizon | 7 days ahead | `scheduleMedicationReminders` |

## Migrations

SQL files in `src/db/migrations/`, applied in filename order, one transaction
each. A SHA-256 of every applied file is stored.

**Migrations are append-only.** Editing a file that has already been applied is
rejected with an error telling you to add a new file instead — so a schema can
never silently diverge from what the database actually has.

```bash
npm run migrate     # apply pending; prints what ran
```

## Resetting

```bash
rm -rf data/          # destroys everything, including the keys
npm run migrate
```

Removing only `data/carecircle.db*` while keeping `data/secrets/` leaves
undecryptable orphan blobs in `data/documents/`; remove that too.

## Verification

```bash
npm run verify   # typecheck → lint → unit/integration tests → production build
npm run e2e      # Playwright journey against a production build
```

`npm run e2e` builds nothing itself — run `npm run build` first. It starts its own
server on port 3101 with a **throwaway data directory**, so it never touches your
real or demo data.

`npm run dev` and `npm run e2e` share the `.next` directory: the dev server
replaces the production build, after which the e2e server will not start. Stop
the dev server and rebuild before running the e2e suite.

## Ports

| Port | Use |
| --- | --- |
| 3100 | `npm run dev` and `npm start` |
| 3101 | Playwright's own server, bound to `127.0.0.1` |
