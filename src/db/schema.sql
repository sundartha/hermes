-- Postgres-Schema fuer das pg-Store-Backend (P3b). Idempotent: jede Tabelle und
-- jede RLS-Policy ist mit IF NOT EXISTS bzw. DROP-vor-CREATE wiederholbar.
-- Spiegelt die heutige Store-Oberflaeche + einen Owner-Tenant + eigene
-- transcript_segment-Tabelle + number (E.164->tenant Routing, P3c). KEINE
-- number_assignment/tenant_budget/usage_event-Tabellen (das ist spaeterer Scope).

-- tenant: id + Lebenszyklus-status (Onboarding). KEINE kyc/stripe-Spalten
-- (Payment uebersprungen = spaeterer Scope). status: active|suspended|closed.
CREATE TABLE IF NOT EXISTS tenant (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Forward-compat: bestehende tenant-Tabelle bekommt status nachgezogen (idempotent).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
-- Identitaets-Schicht (I8): Tenant-Name + IdP-Subject additiv, beide NULLABLE.
-- NULL = kein eigener Wert -> Owner-Fallback (config.ownerName) im tenantContext;
-- idp_subject NULL = nicht ueber resolveTenant aufloesbar. Muster wie number.status.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS owner_name  TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS idp_subject TEXT;

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
  objective_achieved TEXT,
  provider           TEXT
);

-- Forward-compat: eine bereits existierende call-Tabelle (CREATE TABLE IF NOT
-- EXISTS oben greift dann nicht) bekommt die provider-Spalte nachgezogen.
-- Idempotent (IF NOT EXISTS); auf einer frischen DB ein No-op.
ALTER TABLE call ADD COLUMN IF NOT EXISTS provider TEXT;

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

-- usage: Owner-Zeile. cost_eur-Spalte als NUMERIC (praezise at rest); der
-- In-Memory-Spiegel haelt cost_eur jedoch als JS-Float und akkumuliert ihn so -
-- wie im json-Bestand (kein neuer Verstoss, kein Geld-als-Float-Regress).
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

-- number: E.164 -> tenant Routing (P3c) + Lifecycle-status (Onboarding). e164 ist
-- jetzt NULLABLE: eine 'requested' Nummer hat noch keine E.164 (die kommt erst beim
-- Provider-Kauf). UNIQUE bleibt (Postgres erlaubt mehrere NULLs). provider_number_id
-- = die Nummern-ID des Providers nach dem Kauf (fuer configure/release). e164 routet
-- nur, wenn status='active' (fail-closed, im Store erzwungen).
CREATE TABLE IF NOT EXISTS number (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  e164               TEXT UNIQUE,
  provider           TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  provider_number_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Forward-compat fuer eine bestehende number-Tabelle (idempotent). Bestehende
-- (geseedete) Nummern sind in Benutzung -> Default 'active'. e164 von NOT NULL auf
-- nullable lockern, damit 'requested'-Zeilen ohne E.164 erlaubt sind.
ALTER TABLE number ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE number ADD COLUMN IF NOT EXISTS provider_number_id TEXT;
ALTER TABLE number ALTER COLUMN e164 DROP NOT NULL;
-- Payment-Pfad (P6b1): Stripe-PaymentIntent-Referenz der Nummer (Hold/Capture).
-- Additiv NULLABLE (payment-off bleibt NULL); migrate.applySchema traegt es idempotent.
ALTER TABLE number ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

-- number_assignment: Historie Nummer<->Tenant (Recycling-Hygiene). assigned_at bei
-- Aktivierung, released_at bei Freigabe. Eine frisch freigegebene Nummer wird nicht
-- sofort neu vergeben (Karenz im Store). Eigene tenant_id fuer RLS.
CREATE TABLE IF NOT EXISTS number_assignment (
  id          TEXT PRIMARY KEY,
  number_id   TEXT NOT NULL REFERENCES number(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  released_at TEXT
);

-- provisioning_job: Job-Spur des async Provisioning-Workers (P6b2). idempotency_key
-- verhindert Doppel-Records bei Retry; status = queued|done|failed. number_id/tenant_id
-- fuer RLS + Re-Hydrierung. attempts/last_error fuer Audit/Reconciliation.
CREATE TABLE IF NOT EXISTS provisioning_job (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  number_id       TEXT NOT NULL REFERENCES number(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
ALTER TABLE number             ENABLE ROW LEVEL SECURITY;
ALTER TABLE number             FORCE  ROW LEVEL SECURITY;
ALTER TABLE number_assignment  ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_assignment  FORCE  ROW LEVEL SECURITY;
ALTER TABLE provisioning_job   ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_job   FORCE  ROW LEVEL SECURITY;

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
DROP POLICY IF EXISTS tenant_isolation ON number;
CREATE POLICY tenant_isolation ON number
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON number_assignment;
CREATE POLICY tenant_isolation ON number_assignment
  USING (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON provisioning_job;
CREATE POLICY tenant_isolation ON provisioning_job
  USING (tenant_id = current_setting('app.current_tenant', true));
