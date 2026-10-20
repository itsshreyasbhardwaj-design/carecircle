-- CareCircle initial schema.
--
-- AUTHORISATION INVARIANT (the one rule the whole app depends on):
--   Every sensitive row hangs off a care_profile. A user may touch care_profile P
--   only if they own P, or they hold a row in access_grants for P with the required
--   scope that is neither revoked nor expired. Circle membership by itself grants
--   NOTHING beyond seeing the circle roster and the display names of listed profiles.
-- There is deliberately no "family id" column that unlocks a set of records.


CREATE TABLE users (
  id                      TEXT PRIMARY KEY,
  email                   TEXT NOT NULL UNIQUE,          -- stored lowercased
  password_hash           TEXT NOT NULL,                 -- argon2id, encoded string
  full_name               TEXT NOT NULL,
  -- Email verification is NOT implemented: no mail provider is configured.
  -- This column exists so the state is explicit rather than implied.
  email_verified_at       TEXT,
  recovery_code_hash      TEXT,
  recovery_code_used_at   TEXT,
  onboarding_step         TEXT NOT NULL DEFAULT 'welcome',
  onboarding_completed_at TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  deleted_at              TEXT
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                         -- sha256(token); raw token never stored
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at   TEXT,
  user_agent   TEXT,
  label        TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE user_settings (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  locale                TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','hi','bn')),
  timezone              TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  theme                 TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  reminder_lead_minutes INTEGER NOT NULL DEFAULT 120,
  notify_appointments   INTEGER NOT NULL DEFAULT 1,
  notify_medications    INTEGER NOT NULL DEFAULT 1,
  notify_tasks          INTEGER NOT NULL DEFAULT 1,
  caregiver_followups   INTEGER NOT NULL DEFAULT 0,
  reduce_motion         INTEGER NOT NULL DEFAULT 0,
  large_text            INTEGER NOT NULL DEFAULT 0,
  plan                  TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','family')),
  plan_source           TEXT NOT NULL DEFAULT 'default' CHECK (plan_source IN ('default','dev_override')),
  updated_at            TEXT NOT NULL
);

CREATE TABLE care_profiles (
  id             TEXT PRIMARY KEY,
  owner_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name   TEXT NOT NULL,
  relationship   TEXT,
  is_self        INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0,1)),
  date_of_birth  TEXT,
  blood_group    TEXT,
  notes          TEXT,
  -- 'self_managed': an adult controls their own profile (the only fully usable kind).
  -- 'proxy_pending_review': a dependent/minor profile. Deliberately read-only and
  -- feature-restricted until a legally reviewed proxy-authorisation workflow exists.
  profile_kind   TEXT NOT NULL DEFAULT 'self_managed'
                   CHECK (profile_kind IN ('self_managed','proxy_pending_review')),
  is_demo        INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX idx_profiles_owner ON care_profiles(owner_user_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_one_self_profile ON care_profiles(owner_user_id)
  WHERE is_self = 1 AND deleted_at IS NULL;

CREATE TABLE care_circles (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_demo            INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE circle_memberships (
  id         TEXT PRIMARY KEY,
  circle_id  TEXT NOT NULL REFERENCES care_circles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'coordinator' may invite and manage the roster. It confers NO record access.
  role       TEXT NOT NULL CHECK (role IN ('coordinator','member')),
  joined_at  TEXT NOT NULL,
  removed_at TEXT
);
CREATE UNIQUE INDEX idx_membership_active ON circle_memberships(circle_id, user_id)
  WHERE removed_at IS NULL;

-- Listing a profile in a circle lets members see its display name so they can
-- coordinate. It does not expose appointments, records, medications or tasks.
CREATE TABLE circle_profiles (
  id              TEXT PRIMARY KEY,
  circle_id       TEXT NOT NULL REFERENCES care_circles(id) ON DELETE CASCADE,
  care_profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  added_by_user_id TEXT NOT NULL REFERENCES users(id),
  added_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_circle_profile ON circle_profiles(circle_id, care_profile_id);

CREATE TABLE provider_references (
  id                 TEXT PRIMARY KEY,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  specialty          TEXT,
  facility           TEXT,
  phone              TEXT,
  city               TEXT,
  created_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_provider_unique
  ON provider_references(created_by_user_id, name, COALESCE(facility,''));

CREATE TABLE medical_documents (
  id                    TEXT PRIMARY KEY,
  care_profile_id       TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  uploaded_by_user_id   TEXT NOT NULL REFERENCES users(id),
  title                 TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN
                          ('prescription','lab_report','visit_record','discharge_summary',
                           'referral_letter','vaccination_record','insurance','other')),
  -- Always a human decision. A suggestion is never saved without confirmation.
  category_source       TEXT NOT NULL DEFAULT 'user'
                          CHECK (category_source IN ('user','suggestion_confirmed')),
  document_date         TEXT,
  provider_reference_id TEXT REFERENCES provider_references(id) ON DELETE SET NULL,
  provider_name         TEXT,
  notes                 TEXT,
  tags                  TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  -- 'restricted' documents need a document-specific grant; a profile-wide
  -- records:view grant is not enough.
  sensitivity           TEXT NOT NULL DEFAULT 'standard'
                          CHECK (sensitivity IN ('standard','restricted')),
  current_version_id    TEXT,
  is_demo               INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT
);
CREATE INDEX idx_docs_profile ON medical_documents(care_profile_id, document_date)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_docs_category ON medical_documents(care_profile_id, category)
  WHERE deleted_at IS NULL;

CREATE TABLE document_versions (
  id                  TEXT PRIMARY KEY,
  document_id         TEXT NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  storage_path        TEXT NOT NULL,          -- relative path inside the encrypted store
  original_filename   TEXT NOT NULL,          -- sanitised on the way in
  mime_type           TEXT NOT NULL,
  byte_size           INTEGER NOT NULL,
  sha256              TEXT NOT NULL,          -- of PLAINTEXT bytes; used for duplicate review
  enc_iv              TEXT NOT NULL,          -- AES-256-GCM nonce (hex)
  enc_tag             TEXT NOT NULL,          -- GCM auth tag (hex)
  uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_dv_number ON document_versions(document_id, version_number);
CREATE INDEX idx_dv_sha ON document_versions(sha256);

-- Extracted text lives apart from the original file. The original is authoritative.
CREATE TABLE document_extractions (
  id                       TEXT PRIMARY KEY,
  document_version_id      TEXT NOT NULL UNIQUE
                             REFERENCES document_versions(id) ON DELETE CASCADE,
  engine                   TEXT NOT NULL,     -- 'pdf-text' | 'plain-text' | 'none'
  status                   TEXT NOT NULL CHECK (status IN
                             ('extracted','no_text_layer','unsupported','failed')),
  extracted_text           TEXT,
  suggested_category       TEXT,
  suggested_document_date  TEXT,
  suggested_provider_name  TEXT,
  suggested_patient_name   TEXT,
  suggested_followup_date  TEXT,
  suggested_reference_ids  TEXT NOT NULL DEFAULT '[]',   -- JSON array
  -- Deliberately capped at 'medium'. OCR/parse output is never presented as certain.
  confidence               TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('low','medium')),
  reviewed_at              TEXT,              -- NULL = suggestions unconfirmed
  reviewed_by_user_id      TEXT REFERENCES users(id),
  created_at               TEXT NOT NULL
);

-- Full-text index over confirmed metadata + extracted text. Rows are only ever
-- read through a permission-scoped join, never queried directly for display.
CREATE VIRTUAL TABLE document_search USING fts5(
  document_id UNINDEXED,
  care_profile_id UNINDEXED,
  title,
  provider_name,
  notes,
  tags,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE appointments (
  id                    TEXT PRIMARY KEY,
  care_profile_id       TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  provider_reference_id TEXT REFERENCES provider_references(id) ON DELETE SET NULL,
  provider_name         TEXT,
  location              TEXT,
  starts_at             TEXT NOT NULL,        -- ISO-8601 UTC instant
  timezone              TEXT NOT NULL,        -- IANA zone the user entered it in
  duration_minutes      INTEGER,
  notes                 TEXT,
  responsible_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN
                          ('proposed','scheduled','confirmed','completed','cancelled','rescheduled')),
  followup_date         TEXT,
  rescheduled_from_id   TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  outcome_note          TEXT,
  is_demo               INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_by_user_id    TEXT NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT
);
CREATE INDEX idx_appt_profile_time ON appointments(care_profile_id, starts_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_appt_responsible ON appointments(responsible_user_id, starts_at)
  WHERE deleted_at IS NULL;

CREATE TABLE appointment_documents (
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  document_id    TEXT NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  linked_at      TEXT NOT NULL,
  PRIMARY KEY (appointment_id, document_id)
);

CREATE TABLE appointment_prep_items (
  id             TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN
                   ('question','transport','document','admin','instruction')),
  text           TEXT NOT NULL,
  -- 'clinician_provided' means a human transcribed it from a clinician's own words.
  -- The app never generates medical preparation instructions.
  source         TEXT NOT NULL DEFAULT 'user'
                   CHECK (source IN ('user','clinician_provided')),
  done           INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  position       INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_prep_appt ON appointment_prep_items(appointment_id, position);

CREATE TABLE care_tasks (
  id                 TEXT PRIMARY KEY,
  care_profile_id    TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  assignee_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_at             TEXT,
  priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                       ('pending','accepted','in_progress','completed','cancelled','unable_to_complete')),
  appointment_id     TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  -- Completion is only ever written by an explicit human action on the task.
  completed_at       TEXT,
  completed_by_user_id TEXT REFERENCES users(id),
  completion_note    TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX idx_tasks_profile ON care_tasks(care_profile_id, status, due_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_assignee ON care_tasks(assignee_user_id, status, due_at)
  WHERE deleted_at IS NULL;

CREATE TABLE task_documents (
  task_id     TEXT NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  linked_at   TEXT NOT NULL,
  PRIMARY KEY (task_id, document_id)
);

CREATE TABLE task_events (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('created','status_changed','assigned','commented',
                   'handover_requested','handover_accepted','handover_declined','handover_cancelled')),
  from_value    TEXT,
  to_value      TEXT,
  body          TEXT,
  occurred_at   TEXT NOT NULL
);
CREATE INDEX idx_task_events ON task_events(task_id, occurred_at);

CREATE TABLE task_handovers (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                 ('pending','accepted','declined','cancelled')),
  requested_at TEXT NOT NULL,
  responded_at TEXT,
  expires_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_handover_one_pending ON task_handovers(task_id)
  WHERE status = 'pending';

CREATE TABLE caregiver_availability (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_id  TEXT NOT NULL REFERENCES care_circles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('available','limited','unavailable')),
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_avail_user ON caregiver_availability(circle_id, user_id, from_date);

CREATE TABLE medication_schedules (
  id                       TEXT PRIMARY KEY,
  care_profile_id          TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  medication_name          TEXT NOT NULL,
  strength                 TEXT,
  form                     TEXT,
  -- Verbatim instruction as confirmed by a person. The app never composes one.
  dose_instruction         TEXT NOT NULL,
  instruction_source       TEXT NOT NULL CHECK (instruction_source IN
                             ('patient_entered','caregiver_entered','clinician_written')),
  confirmed_by_user_id     TEXT NOT NULL REFERENCES users(id),
  confirmed_at             TEXT NOT NULL,
  prescription_document_id TEXT REFERENCES medical_documents(id) ON DELETE SET NULL,
  start_date               TEXT NOT NULL,
  end_date                 TEXT,
  times_of_day             TEXT NOT NULL,      -- JSON array of "HH:MM" local times
  days_of_week             TEXT,               -- JSON array of 0..6; NULL = every day
  timezone                 TEXT NOT NULL,
  refill_reminder_date     TEXT,
  notes                    TEXT,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','discontinued')),
  discontinued_at          TEXT,
  discontinued_reason      TEXT,
  is_demo                  INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_by_user_id       TEXT NOT NULL REFERENCES users(id),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE INDEX idx_meds_profile ON medication_schedules(care_profile_id, status);

CREATE TABLE medication_checkins (
  id                   TEXT PRIMARY KEY,
  schedule_id          TEXT NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
  scheduled_for        TEXT NOT NULL,          -- UTC instant of the dose slot
  -- 'not_confirmed' is the only automatic value. Nothing infers 'taken' or 'skipped'.
  status               TEXT NOT NULL DEFAULT 'not_confirmed' CHECK (status IN
                         ('taken','skipped','not_confirmed','snoozed')),
  reported_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  reported_at          TEXT,
  note                 TEXT,
  CHECK (status = 'not_confirmed' OR reported_by_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX idx_checkin_slot ON medication_checkins(schedule_id, scheduled_for);

CREATE TABLE reminders (
  id                TEXT PRIMARY KEY,
  care_profile_id   TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  subject_type      TEXT NOT NULL CHECK (subject_type IN
                      ('appointment','medication_dose','care_task','document_followup',
                       'handover','refill')),
  subject_id        TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at            TEXT NOT NULL,             -- UTC instant
  status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','generated','cancelled')),
  generated_at      TEXT,
  created_at        TEXT NOT NULL
);
-- The duplicate-notification guard: one reminder per subject/recipient/instant.
CREATE UNIQUE INDEX idx_reminder_unique
  ON reminders(subject_type, subject_id, recipient_user_id, due_at);
CREATE INDEX idx_reminder_due ON reminders(due_at) WHERE status = 'scheduled';

CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_id     TEXT REFERENCES reminders(id) ON DELETE SET NULL,
  care_profile_id TEXT REFERENCES care_profiles(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  link            TEXT,
  created_at      TEXT NOT NULL,               -- in-app delivery evidence
  read_at         TEXT,
  acknowledged_at TEXT,                        -- explicit user action, not just "seen"
  dismissed_at    TEXT,
  snoozed_until   TEXT
);
CREATE INDEX idx_notif_user ON notifications(user_id, created_at);
CREATE INDEX idx_notif_unread ON notifications(user_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE TABLE access_grants (
  id                 TEXT PRIMARY KEY,
  care_profile_id    TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  grantee_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope              TEXT NOT NULL CHECK (scope IN
                       ('appointments:view','appointments:manage',
                        'records:view','records:upload',
                        'medications:view','medications:manage',
                        'tasks:view','tasks:manage',
                        'activity:view')),
  -- NULL = applies to the whole profile. Set = applies to that one document only.
  document_id        TEXT REFERENCES medical_documents(id) ON DELETE CASCADE,
  granted_by_user_id TEXT NOT NULL REFERENCES users(id),
  purpose            TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  expires_at         TEXT,                     -- NULL = no expiry
  revoked_at         TEXT,
  revoked_by_user_id TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_grant_active
  ON access_grants(care_profile_id, grantee_user_id, scope, COALESCE(document_id,''))
  WHERE revoked_at IS NULL;
CREATE INDEX idx_grant_lookup ON access_grants(grantee_user_id, care_profile_id)
  WHERE revoked_at IS NULL;

-- Append-only consent ledger. Mirrors every grant lifecycle transition.
CREATE TABLE consent_records (
  id              TEXT PRIMARY KEY,
  access_grant_id TEXT NOT NULL,
  care_profile_id TEXT NOT NULL,
  grantee_user_id TEXT NOT NULL,
  scope           TEXT NOT NULL,
  document_id     TEXT,
  action          TEXT NOT NULL CHECK (action IN ('granted','revoked','expired')),
  purpose         TEXT NOT NULL,
  actor_user_id   TEXT,
  expires_at      TEXT,
  occurred_at     TEXT NOT NULL
);
CREATE INDEX idx_consent_profile ON consent_records(care_profile_id, occurred_at);

CREATE TABLE invitations (
  id                 TEXT PRIMARY KEY,
  circle_id          TEXT NOT NULL REFERENCES care_circles(id) ON DELETE CASCADE,
  token_hash         TEXT NOT NULL UNIQUE,     -- sha256(token); raw shown once at creation
  invited_email      TEXT,
  role               TEXT NOT NULL CHECK (role IN ('coordinator','member')),
  -- Grants the inviter offers. Applied only on explicit acceptance, and only for
  -- profiles the inviter actually owns at that moment.
  offered_grants     TEXT NOT NULL DEFAULT '[]',
  message            TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  accepted_at        TEXT,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at         TEXT
);
CREATE INDEX idx_invite_circle ON invitations(circle_id, created_at);

CREATE TABLE care_activity (
  id              TEXT PRIMARY KEY,
  care_profile_id TEXT NOT NULL REFERENCES care_profiles(id) ON DELETE CASCADE,
  actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  summary         TEXT NOT NULL,               -- administrative wording, no clinical detail
  subject_type    TEXT,
  subject_id      TEXT,
  -- Readers must hold this scope on the profile to see the row.
  required_scope  TEXT NOT NULL,
  occurred_at     TEXT NOT NULL
);
CREATE INDEX idx_activity_profile ON care_activity(care_profile_id, occurred_at);

CREATE TABLE audit_events (
  id              TEXT PRIMARY KEY,
  actor_user_id   TEXT,
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     TEXT,
  care_profile_id TEXT,
  outcome         TEXT NOT NULL CHECK (outcome IN ('allowed','denied')),
  ip_hash         TEXT,                        -- hashed, never a raw address
  detail          TEXT,                        -- JSON; must not contain health content
  occurred_at     TEXT NOT NULL
);
CREATE INDEX idx_audit_actor ON audit_events(actor_user_id, occurred_at);
CREATE INDEX idx_audit_profile ON audit_events(care_profile_id, occurred_at);

CREATE TABLE rate_limits (
  bucket            TEXT PRIMARY KEY,
  count             INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  blocked_until     TEXT
);
