-- Postgres-Schema fuer das pg-Store-Backend (P3b). Idempotent: jede Tabelle und
-- jede RLS-Policy ist mit IF NOT EXISTS bzw. DROP-vor-CREATE wiederholbar.
-- Spiegelt die heutige Store-Oberflaeche + einen Owner-Tenant + eigene
-- transcript_segment-Tabelle. KEINE number/number_assignment/tenant_budget/
-- usage_event-Tabellen (das ist spaeterer Scope).

-- tenant: minimal fuer P3b (KEINE idp_subject/kyc-Spalten = spaeterer Scope).
CREATE TABLE IF NOT EXISTS tenant (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- settings: pro Tenant eine Owner-Zeile. Boolesche Flags + Strings.
CREATE TABLE IF NOT EXISTS settings (
  tenant_id           TEXT PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  agent_name          TEXT NOT NULL,
  greeting            TEXT NOT NULL,
  allow_calendar      BOOLEAN NOT NULL,
  allow_booking       BOOLEAN NOT NULL,
  allow_summaries     BOOLEAN NOT NULL,
  allow_personal_data BOOLEAN NOT NULL,
  allow_bank_data     BOOLEAN NOT NULL
);

-- call: alle heutigen Felder AUSSER transcript[] (-> transcript_segment) + tenant_id.
-- id = app-generierte TEXT-PK (newId-Format bleibt). seq nur fuer stabile
-- unshift-Reihenfolge (neueste zuerst).
CREATE TABLE IF NOT EXISTS call (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  seq                BIGSERIAL,
  stream_token       TEXT NOT NULL,
  twilio_sid         TEXT,
  direction          TEXT NOT NULL,
  from_e164          TEXT,
  to_e164            TEXT,
  goal               TEXT,
  briefing           TEXT,
  constraints        TEXT,
  caller_name        TEXT,
  language           TEXT NOT NULL DEFAULT 'de',
  max_duration_s     INTEGER,
  requested_by       TEXT,
  status             TEXT NOT NULL,
  started_at         TEXT NOT NULL,
  answered_at        TEXT,
  ended_at           TEXT,
  summary            TEXT,
  objective_achieved TEXT
);

-- transcript_segment: eigene Tabelle ab P3b. getCall rekonstruiert transcript[]
-- in Reihenfolge (sortiert nach id).
CREATE TABLE IF NOT EXISTS transcript_segment (
  id        BIGSERIAL PRIMARY KEY,
  call_id   TEXT NOT NULL REFERENCES call(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,
  text      TEXT NOT NULL,
  at        TEXT NOT NULL
);

-- action_item: call.actionItemIds per FK-Query rekonstruiert.
CREATE TABLE IF NOT EXISTS action_item (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  call_id    TEXT,
  text       TEXT NOT NULL,
  type       TEXT NOT NULL,
  done       BOOLEAN NOT NULL,
  created_at TEXT NOT NULL,
  seq        BIGSERIAL
);

-- calendar_event: Bestand speichert ISO-Strings (kein TZ-Cast: bitidentisch).
CREATE TABLE IF NOT EXISTS calendar_event (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at   TEXT NOT NULL,
  seq       BIGSERIAL
);

-- usage: Owner-Zeile. cost_eur als NUMERIC (Geld nie als Fliesskomma).
CREATE TABLE IF NOT EXISTS usage (
  tenant_id     TEXT PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_eur      NUMERIC NOT NULL DEFAULT 0,
  calls         BIGINT NOT NULL DEFAULT 0
);

-- profile: in P3b weiter keyed-by-email, owner-tenant-scoped. Sanitisiertes
-- Profil-Objekt als JSONB (Whitelist bleibt im Code).
CREATE TABLE IF NOT EXISTS profile (
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email     TEXT NOT NULL,
  data      JSONB NOT NULL,
  PRIMARY KEY (tenant_id, email)
);

-- notification: Ring-Puffer (neueste zuerst), seq fuer stabile Reihenfolge.
CREATE TABLE IF NOT EXISTS notification (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  seq       BIGSERIAL,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  call_id   TEXT,
  at        TEXT NOT NULL
);

-- ---- Row Level Security (zweite Verteidigungslinie) ----
-- Primaerlinie ist der app-seitige tenant_id-Filter; RLS faengt vergessene
-- Filter ab. Policy: Zeile sichtbar/aenderbar nur, wenn tenant_id der GUC
-- app.current_tenant entspricht. FORCE auch fuer den Tabellen-Eigentuemer.
ALTER TABLE settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings           FORCE  ROW LEVEL SECURITY;
ALTER TABLE call               ENABLE ROW LEVEL SECURITY;
ALTER TABLE call               FORCE  ROW LEVEL SECURITY;
ALTER TABLE transcript_segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_segment FORCE  ROW LEVEL SECURITY;
ALTER TABLE action_item        ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_item        FORCE  ROW LEVEL SECURITY;
ALTER TABLE calendar_event     ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event     FORCE  ROW LEVEL SECURITY;
ALTER TABLE usage              ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage              FORCE  ROW LEVEL SECURITY;
ALTER TABLE profile            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile            FORCE  ROW LEVEL SECURITY;
ALTER TABLE notification       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification       FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON settings;
CREATE POLICY tenant_isolation ON settings
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON call;
CREATE POLICY tenant_isolation ON call
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON transcript_segment;
CREATE POLICY tenant_isolation ON transcript_segment
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON action_item;
CREATE POLICY tenant_isolation ON action_item
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON calendar_event;
CREATE POLICY tenant_isolation ON calendar_event
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON usage;
CREATE POLICY tenant_isolation ON usage
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON profile;
CREATE POLICY tenant_isolation ON profile
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON notification;
CREATE POLICY tenant_isolation ON notification
  USING (tenant_id = current_setting('app.current_tenant', true));
