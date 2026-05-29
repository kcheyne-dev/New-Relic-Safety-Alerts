-- ============================================================================
-- NR Safety Alerts — Sprint 5 schema
-- ============================================================================
-- Server-side incidents (replacing dashboard localStorage) + auth + audit log.
-- This is the bridge from "single-user prototype" to "real multi-user tool".

-- ----------------------------------------------------------------------------
-- Users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  password_hash   TEXT,                    -- null when authenticating via Okta SSO
  okta_subject    TEXT UNIQUE,             -- Okta `sub` claim
  role            TEXT NOT NULL CHECK (role IN ('admin','cmt','office','employee')) DEFAULT 'employee',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- Incidents
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             TEXT NOT NULL,
  description       TEXT,
  severity          TEXT NOT NULL CHECK (severity IN ('low','mod','high','ext')),
  status            TEXT NOT NULL CHECK (status IN ('open','closed')) DEFAULT 'open',
  alert_id          UUID REFERENCES events(id) ON DELETE SET NULL,
  offices           TEXT[] NOT NULL DEFAULT '{}',
  closed_note       TEXT,
  closed_at         TIMESTAMPTZ,
  reopens           JSONB NOT NULL DEFAULT '[]',  -- [{when, by_user_id}]
  created_by_user_id UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incidents_status_idx   ON incidents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_alert_id_idx ON incidents (alert_id);
CREATE INDEX IF NOT EXISTS incidents_offices_idx  ON incidents USING GIN (offices);

CREATE OR REPLACE FUNCTION incidents_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS incidents_touch_trg ON incidents;
CREATE TRIGGER incidents_touch_trg BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_touch();

-- ----------------------------------------------------------------------------
-- Crisis messages dispatched per incident
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crisis_messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id       UUID REFERENCES incidents(id) ON DELETE CASCADE,
  sent_by_user_id   UUID REFERENCES users(id),
  template          TEXT,
  template_name     TEXT,
  subject           TEXT,
  body              TEXT NOT NULL,
  channels          TEXT[] NOT NULL DEFAULT '{}',
  offices           TEXT[] NOT NULL DEFAULT '{}',
  recipients_count  INTEGER NOT NULL DEFAULT 0,
  response_required BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_interval TEXT,
  attachments       JSONB NOT NULL DEFAULT '[]',
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS crisis_messages_incident_idx ON crisis_messages (incident_id, sent_at DESC);

-- ----------------------------------------------------------------------------
-- Per-employee responses
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS responses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id         UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  employee_id         TEXT NOT NULL,                   -- external (Workday) ID
  employee_name       TEXT,
  office_id           TEXT,
  is_traveler         BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL CHECK (status IN ('no','ok','help')) DEFAULT 'no',
  status_set_at       TIMESTAMPTZ,
  status_set_by_user_id UUID REFERENCES users(id),
  UNIQUE (incident_id, employee_id)
);
CREATE INDEX IF NOT EXISTS responses_status_idx ON responses (incident_id, status);

-- ----------------------------------------------------------------------------
-- Notes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_notes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id       UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  body              TEXT NOT NULL,
  attachments       JSONB NOT NULL DEFAULT '[]',
  added_by_user_id  UUID REFERENCES users(id),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incident_notes_incident_idx ON incident_notes (incident_id, added_at DESC);

-- ----------------------------------------------------------------------------
-- Activity log per incident (mirrors prototype's incident.log[])
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id  UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                         -- 'create','comm','note','msg','close','reopen'
  body         TEXT NOT NULL,
  by_user_id   UUID REFERENCES users(id),
  at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incident_log_incident_idx ON incident_log (incident_id, at DESC);

-- ----------------------------------------------------------------------------
-- Audit log — every authenticated mutation gets a row here. Append-only.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id),
  action       TEXT NOT NULL,                         -- 'login','incident.create','message.send', etc.
  target_type  TEXT,                                  -- 'incident','message','user'
  target_id    TEXT,
  ip           TEXT,
  user_agent   TEXT,
  payload      JSONB,
  at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_user_idx   ON audit_log (user_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_log_at_idx     ON audit_log (at DESC);
