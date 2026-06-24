-- Postgres-Schema fuer das pg-Store-Backend (P3b). Idempotent: jede Tabelle und
-- jede RLS-Policy ist mit IF NOT EXISTS bzw. DROP-vor-CREATE wiederholbar.
-- Spiegelt die heutige Store-Oberflaeche + einen Owner-Tenant + eigene
-- transcript_segment-Tabelle + number (E.164->tenant Routing, P3c) +
-- tenant_budget/usage_event (per-Tenant-Budget + Stripe-Metering, P6b3).

-- tenant: id + Lebenszyklus-status (Onboarding). KEINE stripe-Spalten (Payment
-- uebersprungen). kyc_level additiv ab P6b4 (s.u.). status: active|suspended|closed.
CREATE TABLE IF NOT EXISTS tenant (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Forward-compat: bestehende tenant-Tabelle bekommt status nachgezogen (idempotent).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
-- Identitaets-Schicht (I8): Tenant-Name + IdP-Subject additiv, beide NULLABLE.
-- NULL = kein eigener Wert -> leerer ownerName-Fallback "" im tenantContext (P2b: kein
-- config.ownerName mehr); idp_subject NULL = nicht ueber resolveTenant aufloesbar.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS owner_name  TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS idp_subject TEXT;
-- LLM-Persona-Vorname (G1) additiv NULLABLE. NULL = kein eigener Wert -> firstName
-- wird aus ownerName abgeleitet im tenantContext (eine Quelle). Muster wie owner_name.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS first_name TEXT;
-- KYC-Reifegrad (P6b4) additiv NULLABLE. NULL/fehlend = Bestand/Owner -> Gate
-- passiert (kein Regress, kycReached liefert true). Ein gesetzter Wert
-- (none|otp|card|id_verified) wird rangbasiert gegen die Outbound-Schwelle geprueft.
-- KEIN CHECK-Constraint: die Validierung lebt fail-closed in setKycLevel (eine Quelle).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS kyc_level TEXT;
-- Stripe-Customer + gespeicherte Karte pro Tenant (Pay1) additiv NULLABLE. NULL =
-- noch keine Karte erfasst -> Pay2-Provisioning fail-closed (kein placeHold). Opake
-- Referenzen (cus_/pm_), KEINE Secrets. Muster wie kyc_level (idempotent, kein CHECK).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT;
-- Abo-Referenzen pro Tenant (W4) additiv NULLABLE. NULL = kein aktives Abo. Opake
-- Stripe-Referenzen (sub_/price-slug/Unix-s), KEINE Secrets. Muster wie stripe_* (kein
-- CHECK). current_period_end als BIGINT (Unix-Sekunden, wie Stripe liefert).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_subscription_id    TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_plan_slug          TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_current_period_end BIGINT;
-- F1 Geo-Location (Phase 1): Tenant-Default-Land + -Sprache, die die Registrierung
-- (IP-Geo-Vorschlag bzw. explizite User-Wahl) schreibt - Fallback fuer neue Nummern
-- dieses Tenants. Additiv NULLABLE: Owner/Bestand ohne Wert -> NULL, Code-Fallback
-- || DE/de greift (kein Routing-/Sprach-Bruch, R7). Muster wie kyc_level/stripe_*
-- (ALTER-only, nullable, KEIN CHECK; die Validierung lebt im Code).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS country          TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS default_language TEXT;
-- F2: private Mobilnummer (E.164) des Tenants, an die nach einem Inbound-Call die
-- Summary-SMS geht. Additiv NULLABLE: Owner/Bestand ohne Wert -> NULL, finishCall
-- ueberspringt die SMS still (kein Ziel). Muster wie kyc_level/stripe_*/geo (ALTER-only,
-- nullable, KEIN CHECK; Normalisierung + E.164-/Land-Validierung lebt fail-closed in
-- state-ops.setPrivateNumber - EINE Quelle). PII -> nie in Logs/MCP (eigene Spalte).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS private_number TEXT;

-- settings: pro Tenant eine Owner-Zeile. Boolesche Flags + Strings.
CREATE TABLE IF NOT EXISTS settings (
  tenant_id           TEXT PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  agent_name          TEXT NOT NULL,
  greeting            TEXT NOT NULL,
  allow_calendar      BOOLEAN NOT NULL,
  allow_booking       BOOLEAN NOT NULL,
  allow_summaries     BOOLEAN NOT NULL,
  allow_personal_data BOOLEAN NOT NULL,
  allow_bank_data     BOOLEAN NOT NULL,
  -- F2 P7: Opt-Out fuer die Summary-SMS (Boolean, Muster allow_summaries). DEFAULT TRUE
  -- = Bestandsverhalten; entkoppelt "keine SMS" vom Loeschen der privaten Nummer.
  sms_summary_opt_in  BOOLEAN NOT NULL DEFAULT TRUE,
  language            TEXT
);
-- F1 Geo-Location: Gespraechssprache pro Tenant als OPTIONALES Override (Entscheidung #8).
-- Phase 1 legte die Spalte NOT NULL DEFAULT 'de' an; Phase 4 macht sie NULLABLE, weil 'de'
-- als harter Default die Aufloesungs-Praezedenz (settings.language -> number.language ->
-- tenant.defaultLanguage -> 'de') kurzschliessen wuerde (number.language kaeme nie zum
-- Zug). NULL = "nicht gesetzt" -> naechste Praezedenz-Stufe. ADD COLUMN IF NOT EXISTS
-- (Erst-Anlage) OHNE NOT NULL; DROP NOT NULL zieht Phase-1-DBs idempotent nach.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE settings ALTER COLUMN language DROP NOT NULL;
-- F2 P7: Opt-Out fuer die Summary-SMS. NOT NULL DEFAULT TRUE backfillt Bestands-Tenants
-- mit Opt-In -> kein stiller SMS-Verlust beim Migrate (M1/M5). Muster wie allow_summaries.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sms_summary_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

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
  provider           TEXT,
  -- F2 P9 (M2): persistierter Summary-SMS-Dedup-Marker (ISO-Zeit). Additiv NULLABLE:
  -- gesetzt NACH erfolgreichem SMS-Send, sonst NULL. Ueberlebt - anders als das
  -- In-Memory-Flag _finished - den Prozess-Restart -> genau eine Summary-SMS pro Call.
  summary_sms_sent_at TEXT
);

-- Forward-compat: eine bereits existierende call-Tabelle (CREATE TABLE IF NOT
-- EXISTS oben greift dann nicht) bekommt die provider-Spalte nachgezogen.
-- Idempotent (IF NOT EXISTS); auf einer frischen DB ein No-op.
ALTER TABLE call ADD COLUMN IF NOT EXISTS provider TEXT;
-- F2 P9: Summary-SMS-Dedup-Marker auf Bestands-call-Tabellen nachziehen (Muster wie
-- provider). Idempotent; frische DB = No-op (CREATE TABLE oben hat die Spalte schon).
ALTER TABLE call ADD COLUMN IF NOT EXISTS summary_sms_sent_at TEXT;

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

-- profile: Owner-Removal P5 - GLOBAL, keine Tenant-Bindung mehr (Rechteprofile sind
-- betreiber-/admin-weit, nicht pro Telefon-Workspace). email ist alleiniger PK.
-- Sanitisiertes Profil-Objekt als JSONB (Whitelist bleibt im Code).
CREATE TABLE IF NOT EXISTS profile (
  email TEXT PRIMARY KEY,
  data  JSONB NOT NULL
);
-- Forward-compat fuer eine bestehende (owner-tenant-scoped) profile-Tabelle:
-- tenant_id aus dem PK loesen, dann die Spalte droppen (idempotent). Bestehende
-- owner-keyed Profile (email/data) bleiben erreichbar (R6, kein Datenverlust).
ALTER TABLE profile DROP CONSTRAINT IF EXISTS profile_pkey;
ALTER TABLE profile DROP COLUMN IF EXISTS tenant_id;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_pkey') THEN
    ALTER TABLE profile ADD PRIMARY KEY (email);
  END IF;
END $$;

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
-- F1 Geo-Location (Phase 1): country (ISO-2) + language (BCP-47-kurz) der Nummer. Die
-- Nummer ist der dauerhafte Geo-Anker (Inbound-Sprache nach angerufener Nummer,
-- Outbound-Absenderwahl nach Ziel-Vorwahl). Additiv NULLABLE: Bestands-Nummern ohne
-- Wert -> NULL, Code-Fallback || DE/de greift (kein Routing-Bruch, R7). Muster wie
-- payment_intent_id (ALTER-only, nullable).
ALTER TABLE number ADD COLUMN IF NOT EXISTS country  TEXT;
ALTER TABLE number ADD COLUMN IF NOT EXISTS language TEXT;

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

-- tenant_budget: per-Tenant-Kostendecke (P6b3), ersetzt NICHT das globale
-- MAX_BUDGET_EUR (das bleibt der Plattform-Notaus), sondern ergaenzt es pro Tenant.
-- Money als GANZZAHL Cents (G26). budget_cents = weiches Inklusiv-Kontingent,
-- hard_cap_cents = harte Call-Sperre (budgetExceeded). PK = tenant_id (eine Zeile
-- pro Tenant). KEINE Owner-Zeile geseedet: Owner ohne Zeile faellt auf
-- cfg.maxBudgetEur (byte-identisch zum Bestand).
CREATE TABLE IF NOT EXISTS tenant_budget (
  tenant_id      TEXT PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  budget_cents   BIGINT NOT NULL,
  hard_cap_cents BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- usage_event: append-only Usage-Ledger (P6b3), Quelle fuer das Stripe-Metering
-- (NICHT fuers Budget-Gate - das bleibt die usage-Map). Money (cost_cents) als
-- GANZZAHL Cents (G26). call_id ist BEWUSST ohne FK auf call(id): number_month-
-- Events haben keinen Call (call_id NULL), und Billing-Belege (voice_minute)
-- muessen ein Call-Erase/Prune UEBERLEBEN (kein CASCADE-Verlust des Abrechnungs-
-- nachweises). tenant_id mit FK + RLS bleibt die Isolationslinie. stripe_meter_sent
-- = Idempotenz-Flag des Flush.
CREATE TABLE IF NOT EXISTS usage_event (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  call_id           TEXT,
  kind              TEXT NOT NULL,
  quantity          NUMERIC NOT NULL,
  cost_cents        BIGINT NOT NULL,
  occurred_at       TEXT NOT NULL,
  stripe_meter_sent BOOLEAN NOT NULL DEFAULT false
);

-- account: identity(sub)->tenant Resolver. RLS-EXEMPT (laeuft VOR app.current_tenant).
-- tenant_id NICHT unique -> Schema traegt spaeter mehrere Accounts pro Tenant (B2B),
-- jetzt aber Single-User pro Tenant (B2C). role: member|admin.
CREATE TABLE IF NOT EXISTS account (
  sub        TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- session: serverseitige Sessions fuer Invalidierung (Suspend killt Session sofort).
CREATE TABLE IF NOT EXISTS session (
  id             TEXT PRIMARY KEY,
  sub            TEXT NOT NULL REFERENCES account(sub) ON DELETE CASCADE,
  tenant_id      TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ
);

-- audit_log: immutable append-only. tenant_id BEWUSST KEIN FK (muss Tenant-
-- Loeschung ueberdauern, Compliance Art. 15). Keine RLS (privilegierter Insert-Pfad).
-- WARNUNG: audit_log NIE ueber portalStore/Kunden-Reads exponieren - ohne RLS gibt
-- es hier kein Sicherheitsnetz gegen einen vergessenen tenant_id-Filter.
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_sub  TEXT,
  tenant_id  TEXT,
  action     TEXT NOT NULL,
  detail     TEXT
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
ALTER TABLE tenant_budget      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_budget      FORCE  ROW LEVEL SECURITY;
ALTER TABLE usage_event        ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_event        FORCE  ROW LEVEL SECURITY;

-- tenant_isolation-Policies: USING filtert lesbare/aenderbare Zeilen, WITH CHECK
-- prueft NEU geschriebene Zeilen (INSERT + UPDATE-Ergebnis). Beide Klauseln sind
-- bewusst identisch und EXPLIZIT: FOR ALL wuerde USING sonst nur implizit als
-- WITH CHECK anwenden - diese stille Konvention zerbricht, sobald eine Policy spaeter
-- in FOR SELECT + FOR INSERT/UPDATE aufgespalten wird. Explizit = kein Drift, kein
-- stilles Loch fuer kuenftige schreibende Pfade.
DROP POLICY IF EXISTS tenant_isolation ON settings;
CREATE POLICY tenant_isolation ON settings
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON call;
CREATE POLICY tenant_isolation ON call
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON transcript_segment;
CREATE POLICY tenant_isolation ON transcript_segment
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON action_item;
CREATE POLICY tenant_isolation ON action_item
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON calendar_event;
CREATE POLICY tenant_isolation ON calendar_event
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON usage;
CREATE POLICY tenant_isolation ON usage
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
-- profile: Owner-Removal P5 - GLOBAL, haengt NICHT mehr an app.current_tenant.
-- Eine fuer die App-Rolle global lesbare/schreibbare Tabelle (admin-weit). Die
-- Zugriffskontrolle liegt bewusst eine Schicht hoeher (Basic-/adminOnly-Auth der
-- /api/profiles-Routen + sanitizeProfile-Whitelist), NICHT in der RLS. RLS bleibt
-- FORCE-aktiv (Konsistenz, kein Sonder-Disable), die Policy ist nur permissiv -
-- es gibt keine Tenant-Dimension mehr, also auch keinen Cross-Tenant-Leak.
DROP POLICY IF EXISTS tenant_isolation ON profile;
DROP POLICY IF EXISTS profile_global ON profile;
CREATE POLICY profile_global ON profile USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS tenant_isolation ON notification;
CREATE POLICY tenant_isolation ON notification
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON number;
CREATE POLICY tenant_isolation ON number
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON number_assignment;
CREATE POLICY tenant_isolation ON number_assignment
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON provisioning_job;
CREATE POLICY tenant_isolation ON provisioning_job
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON tenant_budget;
CREATE POLICY tenant_isolation ON tenant_budget
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
DROP POLICY IF EXISTS tenant_isolation ON usage_event;
CREATE POLICY tenant_isolation ON usage_event
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
