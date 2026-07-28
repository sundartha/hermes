-- Postgres-Schema fuer das pg-Store-Backend (P3b). Idempotent: jede Tabelle und
-- jede RLS-Policy ist mit IF NOT EXISTS bzw. DROP-vor-CREATE wiederholbar.
-- Spiegelt die heutige Store-Oberflaeche + einen Owner-Tenant + eigene
-- transcript_segment-Tabelle + number (E.164->tenant Routing, P3c) +
-- tenant_budget/usage_event (per-Tenant-Budget + Stripe-Metering, P6b3).

-- tenant: id + Lebenszyklus-status (Onboarding). KEINE stripe-Spalten (Payment
-- uebersprungen). kyc_level additiv ab P6b4 (s.u.). status: active|suspended|closed.
-- p6-funnel: Default 'suspended' (fail-safe). Ein status-loser INSERT sperrt damit
-- fail-closed statt fail-open zu aktivieren. Der Owner/Bootstrap wird in seedDefaults
-- EXPLIZIT 'active' gesetzt (Invariante O). Bestandszeilen bleiben unveraendert:
-- ADD COLUMN IF NOT EXISTS ueberspringt die existierende Spalte (kein Backfill).
CREATE TABLE IF NOT EXISTS tenant (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'suspended',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Forward-compat: bestehende tenant-Tabelle bekommt status nachgezogen (idempotent).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'suspended';
-- Identitaets-Schicht (I8): Tenant-Name + IdP-Subject additiv, beide NULLABLE.
-- NULL = kein eigener Wert -> leerer ownerName-Fallback "" im tenantContext (P2b: kein
-- config.ownerName mehr); idp_subject NULL = nicht ueber resolveTenant aufloesbar.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS owner_name  TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS idp_subject TEXT;
-- LLM-Persona-Vorname (G1) additiv NULLABLE. NULL = kein eigener Wert -> firstName
-- wird aus ownerName abgeleitet im tenantContext (eine Quelle). Muster wie owner_name.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS first_name TEXT;
-- KYC-Reifegrad (P6b4) additiv NULLABLE. NULL/fehlend = UNZUREICHEND -> Outbound-Gate
-- sperrt fail-closed (Phase outbound-p1: kycReached liefert false bei null, schliesst den
-- null-Bypass). Der Bootstrap/Owner-Tenant wird beim Boot via seedBootstrapKyc auf
-- id_verified geheilt. Ein gesetzter Wert (none|otp|card|id_verified) wird rangbasiert
-- gegen die Outbound-Schwelle geprueft. KEIN CHECK-Constraint: die Validierung lebt
-- fail-closed in setKycLevel (eine Quelle).
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
-- B1a: Beginn der laufenden Abrechnungsperiode (Unix-s) als Geld-Gate-Anker fuer die
-- Minuten-Quota (GAP B). Additiv NULLABLE: Owner/Bestand ohne Wert -> NULL; der einmalige,
-- idempotente Backfill (db/migrate.js backfillPeriodStart) leitet ihn fuer Bestands-Abos
-- aus stripe_current_period_end ab. Muster wie stripe_* (BIGINT, kein CHECK).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_current_period_start BIGINT;
-- Fix B (PLAN-VOUCHER-SETUP-FEE-GAP.md, 0-EUR-Checkout generisch): true, wenn die
-- aktuelle Subscription bei Aktivierung nachweislich mit 0 EUR abgerechnet wurde
-- (activation.js liest es per billing.retrieveSubscription) - befreit provisionNumber
-- vom placeHold. Additiv NULLABLE: Owner/Bestand ohne Wert -> NULL, tenantSubscription()
-- faellt fail-closed auf false zurueck. Muster wie stripe_*/geo (ALTER-only, nullable,
-- KEIN CHECK).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_number_setup_fee_exempt BOOLEAN;
-- F1 Geo-Location (Phase 1): Tenant-Default-Land + -Sprache, die die Registrierung
-- (IP-Geo-Vorschlag bzw. explizite User-Wahl) schreibt - Fallback fuer neue Nummern
-- dieses Tenants. Additiv NULLABLE: Owner/Bestand ohne Wert -> NULL, Code-Fallback
-- Land=DE/Sprache=Weltdefault (P10) greift (kein Routing-/Sprach-Bruch, R7). Muster wie
-- kyc_level/stripe_*
-- (ALTER-only, nullable, KEIN CHECK; die Validierung lebt im Code).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS country          TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS default_language TEXT;
-- P8/FMT-28 (Owner-Entscheidung 7.6): IANA-Zeitzone des Tenants, beim Eintritt aus dem
-- Land abgeleitet. REINE ANZEIGE (Uhrzeit im Systemprompt) - ein Anrufzeit-Gate ist
-- ausdruecklich abgelehnt (LAW-07). Additiv NULLABLE wie country/default_language:
-- Bestand ohne Wert -> NULL, Code-Fallback resolveTimezone greift (kein Backfill, O11).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS timezone TEXT;
-- F2: private Mobilnummer (E.164) des Tenants, an die nach einem Inbound-Call die
-- Summary-SMS geht. Additiv NULLABLE: Owner/Bestand ohne Wert -> NULL, finishCall
-- ueberspringt die SMS still (kein Ziel). Muster wie kyc_level/stripe_*/geo (ALTER-only,
-- nullable, KEIN CHECK; Normalisierung + E.164-/Land-Validierung lebt fail-closed in
-- state-ops.setPrivateNumber - EINE Quelle). PII -> nie in Logs/MCP (eigene Spalte).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS private_number TEXT;
-- Fix B (PLAN-PROVISIONING-CAP.md Phase A): letzter beobachteter global_cap-Skip pro
-- Tenant, reine Observability (kein Aktor). Additiv NULLABLE: kein Skip -> beide NULL,
-- numberStatusFor faellt auf "none" zurueck (byte-identisch zum Bestand). Muster wie
-- kyc_level/stripe_*/geo/private_number (ALTER-only, kein CHECK).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS number_provision_skip_reason TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS number_provision_skip_at    TEXT;
-- tenant-prolif-c (PLAN-TENANT-PROLIFERATION.md, Fix 2): Zeitpunkt der ERSTEN Suspendierung
-- (ISO) als Grace-Anker fuer den spaeteren, grace-gegateten DID-Release (Phase D). Additiv
-- NULLABLE: Owner/Bestand ohne Wert -> NULL, tenantSuspendedAt faellt auf null zurueck (kein
-- Release-Kandidat, byte-identisch zum Bestand). SET-IF-ABSENT im Code (state-ops), KEIN
-- Backfill (ein Bestands-Tenant war vor diesem Feld nie ueber diesen Pfad markiert). Muster wie
-- stripe_number_setup_fee_exempt/number_provision_skip_at (ALTER-only, nullable, KEIN CHECK).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS suspended_at TEXT;
-- GAP-04 (PLAN-I18N-FIX.md P4): Wartezustands-Marker der Aktivierung - true zwischen
-- "Zahlung bestaetigt" und "Provisioning-Ergebnis geklaert" (activatePaidTenant). Erlaubt
-- state-ops.tenantMayRequestNumber die Nummern-Anfrage, OHNE den Statuswechsel vorwegzunehmen.
-- Additiv NULLABLE, kein CHECK (Muster stripe_number_setup_fee_exempt).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_activation_pending BOOLEAN;
-- GAP-03 (O2): Outbound-Sperrgrund + optionale Frist (payment_action_required greift erst
-- nach Fristablauf, "kein Scheduler" - der Wert wird lazy am Ausgabepunkt gelesen,
-- outbound-gates.js billingHoldActive). NULL = kein Hold. Additiv NULLABLE, kein CHECK.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_billing_hold TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_billing_hold_due_at TEXT;
-- GAP-03 (O2): true nach einer Rueckerstattung (charge.refunded) - die inkludierten Minuten
-- der laufenden Periode sind 0 (kein Hard-Suspend). Reversibel (webhook.js ACTIVATE-Zweig).
-- Additiv NULLABLE, kein CHECK (Muster stripe_number_setup_fee_exempt).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_period_credit_revoked BOOLEAN;

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
  language            TEXT,
  agent_style         TEXT
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
-- P2 (PLAN-PERSONAL-ASSISTANT.md) - agent_style: stehender Tenant-Stil als kuratierte
-- NON-PII-Enum-ID (warm-persoenlich|formell-professionell) ODER NULL. NULLABLE, KEIN
-- Default: NULL = "nicht gesetzt" = neutrales Bestandsverhalten (Siezen) -> agentStyle=null
-- byte-identisch. Additiv NULLABLE + Code-Fallback in rowToSettings (Muster language/I8);
-- Bestands-Zeilen bleiben NULL (kein Backfill) -> kein stiller Stil-Wechsel beim Migrate.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS agent_style TEXT;

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
  summary_sms_sent_at TEXT,
  -- P3 (PLAN-PERSONAL-ASSISTANT): strukturierter Per-Call-Kontext (summary, key_facts[],
  -- recipient_relationship, desired_outcome) als JSONB. Additiv NULLABLE: nur befuellt bei
  -- ASSISTANT_CONTEXT_ENABLED, sonst NULL -> Bestand byte-identisch.
  context JSONB,
  -- P6 (PLAN-CONVERSATION-QUALITY-V2): Vorab-Mandat (decide_freely, fallback_order,
  -- on_out_of_scope) als JSONB. Additiv NULLABLE: nur befuellt, wenn place_call ein
  -- Mandat mitgibt, sonst NULL -> Bestand byte-identisch.
  mandate JSONB,
  -- CDF1 (Report #2 5.4): maschinenlesbarer, PII-freier Fehlergrund (mapped Token, z.B.
  -- no-answer/busy/failed:<sipcause>) NICHT erfolgreicher Calls. Additiv NULLABLE: im
  -- /voice/status-Callback aus der Provider-Diagnose gesetzt, sonst NULL -> Bestand
  -- byte-identisch. Speist get_call_status (failure_reason).
  failure_reason TEXT,
  -- F9 (A6): persistierter Bucht-Marker (ISO). Additiv NULLABLE: gesetzt NACH erfolgreicher
  -- Abrechnung in finishCall, sonst NULL -> Bestand byte-identisch. Ueberlebt - anders als das
  -- In-Memory-Flag _finished - den Restart -> Voice-Minuten genau einmal gebucht.
  billed_at TEXT,
  -- P5 (C-Telnyx): per-Call-Bearer-Secret (Shim-Auth) + Call-Control-Handles. Additiv
  -- NULLABLE: nur befuellt bei erfolgreicher Call-Control-Origination, sonst NULL ->
  -- Bestand byte-identisch (TeXML-Pfad setzt diese Felder nie).
  ai_assistant_token TEXT,
  call_control_id    TEXT,
  assistant_id       TEXT,
  -- P2b (Diagnose-Retention): Call, dessen Roh-Transkript die Summary ueberleben darf
  -- (Ziel == eigene verifizierte Nummer des Tenants). NOT NULL DEFAULT FALSE: es gibt
  -- keinen dritten Zustand, und Bestandszeilen sind per Definition nicht diagnostisch.
  diagnostic BOOLEAN NOT NULL DEFAULT FALSE,
  -- LCT P2 (Ist-Kosten-Achse): estimated_cost_cents ist der TATSAECHLICH gebuchte
  -- Schaetzbetrag (GANZZAHL Cents, reconcileOutboundVoiceBudget), NIE spaeter aus dem
  -- Tarif rekonstruiert. actual_cost_micro_cents ist BIGINT (nicht NUMERIC/Float, G26) in
  -- GANZZAHL Mikro-Cents, PROVIDER-WAEHRUNG unveraendert (heute USD) - KEINE Umrechnung an
  -- dieser Kante (D5), die lebt an genau einer Stelle in P4. cost_trued_at/cost_trued_source
  -- sind das Gegenstueck zum binaeren billed_at (D9). cost_truing_attempts ist PERSISTIERT
  -- (nicht in-memory): ein Prozess-lokaler Zaehler wird auf dem Render-Free-Tier bei jedem
  -- Restart genullt und erreicht COST_TRUING_MAX_ATTEMPTS (P3) nie.
  estimated_cost_cents INTEGER,
  actual_cost_micro_cents BIGINT,
  cost_trued_at TEXT,
  cost_trued_source TEXT,
  cost_truing_attempts INTEGER NOT NULL DEFAULT 0
);

-- Forward-compat: eine bereits existierende call-Tabelle (CREATE TABLE IF NOT
-- EXISTS oben greift dann nicht) bekommt die provider-Spalte nachgezogen.
-- Idempotent (IF NOT EXISTS); auf einer frischen DB ein No-op.
ALTER TABLE call ADD COLUMN IF NOT EXISTS provider TEXT;
-- F2 P9: Summary-SMS-Dedup-Marker auf Bestands-call-Tabellen nachziehen (Muster wie
-- provider). Idempotent; frische DB = No-op (CREATE TABLE oben hat die Spalte schon).
ALTER TABLE call ADD COLUMN IF NOT EXISTS summary_sms_sent_at TEXT;
-- P3: Per-Call-Kontext-Spalte auf Bestands-call-Tabellen nachziehen (Muster wie
-- provider/summary_sms_sent_at). Idempotent; frische DB = No-op.
ALTER TABLE call ADD COLUMN IF NOT EXISTS context JSONB;
-- CDF1: Fehlergrund-Spalte auf Bestands-call-Tabellen nachziehen (Muster provider/
-- summary_sms_sent_at/context). Idempotent; frische DB = No-op.
ALTER TABLE call ADD COLUMN IF NOT EXISTS failure_reason TEXT;
-- F9 (A6): Bucht-Marker-Spalte auf Bestands-call-Tabellen nachziehen. Idempotent; frische DB
-- = No-op (CREATE TABLE oben hat die Spalte schon). Nullable, kein Backfill (NULL = ungebucht).
ALTER TABLE call ADD COLUMN IF NOT EXISTS billed_at TEXT;
-- P5 (C-Telnyx): per-Call-Bearer + Call-Control-Handles auf einer schon existierenden
-- call-Tabelle nachziehen. Idempotent; frische DB = No-op (CREATE TABLE oben hat die
-- Spalten schon).
ALTER TABLE call ADD COLUMN IF NOT EXISTS ai_assistant_token TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS call_control_id TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS assistant_id TEXT;
-- P2b: Diagnose-Markierung auf einer schon existierenden call-Tabelle nachziehen.
-- Idempotent; frische DB = No-op. DEFAULT FALSE fuellt Bestandszeilen ohne Backfill.
ALTER TABLE call ADD COLUMN IF NOT EXISTS diagnostic BOOLEAN NOT NULL DEFAULT FALSE;
-- P6: Mandats-Spalte auf Bestands-call-Tabellen nachziehen (Muster context).
-- Idempotent; frische DB = No-op.
ALTER TABLE call ADD COLUMN IF NOT EXISTS mandate JSONB;

-- LCT P2: Kosten-Achse am Call auf Bestands-Tabellen nachziehen (Muster provider/
-- billed_at/mandate). Idempotent; frische DB = No-op.
-- actual_cost_micro_cents ist BIGINT, NICHT NUMERIC und nicht Float: Geld at rest bleibt
-- Ganzzahl (G26), und die Mikro-Cent-Einheit existiert im Repo bereits
-- (MICRO_CENTS_PER_CENT). Der Wert steht in der PROVIDER-Waehrung (USD) unveraendert -
-- KEINE Umrechnung an der Persistenzkante (D5); die lebt an genau einer Stelle in P4.
-- KEIN Index: P3 stellt keine eigene SQL-Query (RLS), sondern arbeitet auf dem
-- In-Memory-Spiegel aus hydrateTenantInto - ein Index ohne Aufrufer waere toter Code.
-- KEIN Backfill: migrate() laeuft bei JEDEM Boot ungebremst und auf EINER Connection mit
-- app.current_tenant fest auf BOOTSTRAP_TENANT_ID; ein Backfill auf der FORCE-RLS-Tabelle
-- call saehe nur die Bootstrap-Zeilen. NULL bedeutet "nie abgeglichen".
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_cents INTEGER;
ALTER TABLE call ADD COLUMN IF NOT EXISTS actual_cost_micro_cents BIGINT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS cost_trued_at TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS cost_trued_source TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS cost_truing_attempts INTEGER NOT NULL DEFAULT 0;

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
-- In-Memory-Spiegel haelt den autoritativen Wert seit P1 als GANZZAHL costCents;
-- cost_eur ist die Persistenz-Kodierung (flushUsage/rowToUsage sind die beiden
-- Ableitungsstellen).
CREATE TABLE IF NOT EXISTS usage (
  tenant_id     TEXT PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_eur      NUMERIC NOT NULL DEFAULT 0,
  calls         BIGINT NOT NULL DEFAULT 0
);
-- Spend-Monat-Achse (Budget-Achsen P4): zweite, PERIODISCHE Verbrauchsachse NEBEN dem
-- unveraenderten Lebenszeit-Zaehler cost_eur. spend_month_key = UTC-Kalendermonat
-- 'YYYY-MM'; NULL = noch nie gestempelt (Bestandszeile) -> die Leseprojektion liefert 0.
-- Additiv und inert: in P4 liest KEIN Gate diese Spalten.
--
-- ZWEI GELDKODIERUNGEN IN EINER TABELLE (bewusst): spend_month_cost_cents ist GANZZAHL
-- CENTS (G26, Money at rest), die Nachbarspalte cost_eur ist NUMERIC in EURO (Alt-
-- Konvention, bleibt aus Kompatibilitaet). Die Einheit NICHT aus der Nachbarspalte
-- ableiten - sie steht im Spaltennamen.
--
-- ABGRENZUNG: das ist NICHT die Stripe-Abrechnungsperiode (src/billing/period.js,
-- Spalte stripe_current_period_start). Kalendermonat UTC, tenant-unabhaengig, immer
-- definiert - der Stripe-Anker waere ohne Abo fail-closed und wuerde jeden
-- pre-Payment-Tenant sperren.
--
-- BEWUSSTE DRIFT (dokumentiert, akzeptiert): spend_month_cost_cents WIRD persistiert,
-- der Sub-Cent-Rest costMicroCentsRem NICHT (ephemer, Boot startet bei 0). Ueber einen
-- Neustart driftet die Monats-Achse dadurch minimal anders als cost_eur - hoechstens
-- < 1 Cent pro Neustart. Die Alternative, den Anker nur im Prozess-Spiegel zu halten,
-- wuerde ihn bei jedem Boot neu stempeln und den Cap nach P7 wirkungslos machen.
ALTER TABLE usage ADD COLUMN IF NOT EXISTS spend_month_key TEXT;
ALTER TABLE usage ADD COLUMN IF NOT EXISTS spend_month_cost_cents BIGINT NOT NULL DEFAULT 0;

-- GAP-01 (P6): Perioden-Fenster des Budget-Gates. budget_period_key = ISO-Start der
-- STRIPE-Abrechnungsperiode (NICHT der Kalendermonat daneben), NULL = nie gestempelt ->
-- das Gate misst die Lebenszeit. budget_period_baseline_cents = cost_eur-Stand (in
-- GANZZAHL Cents, G26) bei Periodenbeginn; der Reset ist eine Subtraktion, kein Nullen -
-- cost_eur bleibt monoton. Idempotent, kein Backfill (NULL ist gueltig).
ALTER TABLE usage ADD COLUMN IF NOT EXISTS budget_period_key TEXT;
ALTER TABLE usage ADD COLUMN IF NOT EXISTS budget_period_baseline_cents BIGINT NOT NULL DEFAULT 0;

-- LCT P4: Sub-Cent-Rest der Korrekturbuchungen, GANZZAHL Mikro-Cent des ZIEL-Buckets.
-- PERSISTIERT - bewusst anders als der Schwester-Rest costMicroCentsRem (ephemer, Boot
-- startet bei 0, s. Kommentarblock oben). Begruendung der Asymmetrie: der Korrektur-Rest
-- sammelt sich ueber TAGE (Abgleich alle 6 h, verzoegert um 180 min), waehrend der
-- trackUsage-Rest innerhalb eines Gespraechs entsteht und verbraucht wird - ein Restart
-- wirft hier echtes Geld weg, dort nicht. Wertebereich [0, 1e12).
ALTER TABLE usage ADD COLUMN IF NOT EXISTS cost_correction_micro_cents_rem BIGINT NOT NULL DEFAULT 0;

-- KE-P6: ElevenLabs-Zeichen PRO TENANT (Plan F6). Quelle ist der zugeordnete Telnyx-Beleg
-- (record_type text-to-speech, provider 'elevenlabs', number_of_characters) - damit misst
-- diese Achse auch den Assistant-Pfad, auf dem Telnyx serverseitig synthetisiert und unser
-- Prozess bisher 0 Zeichen sah. NEBEN der globalen Singleton-Tabelle platform_tts_usage,
-- die den Play-TTS-Pfad misst und unveraendert bleibt. BIGINT = Ganzzahl (G26), Lebenszeit-
-- Summe wie calls. RLS: erbt tenant_isolation der usage-Tabelle (Spalte, keine neue Tabelle).
-- REINE SICHTBARKEIT: kein Gate liest sie.
ALTER TABLE usage ADD COLUMN IF NOT EXISTS tts_characters BIGINT NOT NULL DEFAULT 0;

-- profile: GLOBAL, keine Tenant-Bindung (Rechteprofile sind betreiber-/admin-weit, nicht pro
-- Telefon-Workspace). Phase S: die Profil-Rechte-Achse keyt auf die tenantId (vormals email).
-- tenant_id ist alleiniger PK (honest naming - die Spalte haelt jetzt tenantIds). Sanitisiertes
-- Profil-Objekt als JSONB (Whitelist bleibt im Code). Tabelle bleibt global (kein Tenant-FK/
-- RLS-Filter; Policy profile_global, RLS-Sektion) -> Blast-Radius klein.
CREATE TABLE IF NOT EXISTS profile (
  tenant_id TEXT PRIMARY KEY,
  data      JSONB NOT NULL
);
-- Forward-compat: die alte (owner-tenant-scoped) tenant_isolation-Policy referenziert eine
-- tenant_id-Spalte und blockt sonst spaetere Column-Operationen -> zuerst loesen (idempotent;
-- die globale profile_global-Policy wird in der RLS-Sektion gesetzt).
DROP POLICY IF EXISTS tenant_isolation ON profile;
-- Phase S Re-Key: eine P5-era Tabelle traegt email als PK-Spalte. email -> tenant_id umbenennen
-- (der PK folgt dem Spalten-Rename automatisch). NUR wenn email noch existiert UND tenant_id
-- fehlt (idempotent: 2. Lauf trifft nichts). Der DATENwert (email als Schluessel) wird beim
-- Boot/Deploy von db/migrate.js rekeyProfilesToTenant ueber den account-Join auf die tenantId
-- gehoben - dieser Rename benennt nur die Spalte/PK um (kein Datenverlust, R6).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'profile' AND column_name = 'email')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'profile' AND column_name = 'tenant_id') THEN
    ALTER TABLE profile RENAME COLUMN email TO tenant_id;
  END IF;
END $$;

-- platform_tts_usage: GLOBAL, keine Tenant-Bindung (LCT P7 - das ElevenLabs-Kontingent
-- ist plattformweit, EIN Konto, Muster profile oben). Singleton-Tabelle (id-CHECK erzwingt
-- genau eine Zeile) statt tenant_id-PK: es gibt keine Tenant-Dimension, ein Zeichenzaehler
-- pro Zeile genuegt. characters ist BIGINT (Ganzzahl, G26) - der Zaehler zaehlt AUSSCHLIESSLICH
-- erfolgreich an ElevenLabs gesendete Zeichen (result.ok, s. directive-synth.js), NIE
-- Fehlschlaege/Fallback. cycle_key/warned_cycle sind 'YYYY-MM'-Zyklusschluessel (Anker =
-- TTS_QUOTA_CYCLE_ANCHOR_DAY, NICHT der Kalendermonat) - dieselbe Notation wie
-- usage.spend_month_key. REINE SICHTBARKEIT: kein Gate liest diese Tabelle.
CREATE TABLE IF NOT EXISTS platform_tts_usage (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cycle_key    TEXT,
  characters   BIGINT NOT NULL DEFAULT 0,
  warned_cycle TEXT
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
-- F1 Geo-Location (Phase 1): country (ISO-2) + language (BCP-47-kurz) der Nummer. Die
-- Nummer ist der dauerhafte Geo-Anker (Inbound-Sprache nach angerufener Nummer,
-- Outbound-Absenderwahl nach Ziel-Vorwahl). Additiv NULLABLE: Bestands-Nummern ohne
-- Wert -> NULL, Code-Fallback Land=DE/Sprache=Weltdefault (P10) greift (kein Routing-
-- Bruch, R7). Muster wie payment_intent_id (ALTER-only, nullable).
ALTER TABLE number ADD COLUMN IF NOT EXISTS country  TEXT;
ALTER TABLE number ADD COLUMN IF NOT EXISTS language TEXT;
-- Monatsmiete der DID (P4/GAP-11) in GANZZAHL Cents der Bucket-Waehrung, beim Kauf aus
-- der Provider-Antwort uebernommen und ueber den EINEN Kurs umgerechnet. Additiv
-- NULLABLE: Bestands-Nummern und Kaeufe ohne cost_information -> NULL = "keine Miete
-- gelernt" (P5 faellt dann auf seinen Fallback zurueck), ausdruecklich NICHT 0.
ALTER TABLE number ADD COLUMN IF NOT EXISTS monthly_cost_cents INTEGER;

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
-- cfg.platformSpendCapCents (byte-identisch zum Bestand).
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

-- Lookup-Index fuer die Email-Dedup am Web-Login (Phase tenant-prolif-a): der Resolver
-- SELECT tenant_id FROM account WHERE email=$1 findet den kanonischen Tenant. BEWUSST NICHT
-- unique - mehrere subs/Accounts pro (verifizierter) Email teilen sich denselben Tenant
-- (Merge/B2B); ein Unique-Index wuerde genau diese Dedup brechen. Nur Beschleunigung: die
-- 1-Tenant-pro-Email-Invariante garantiert die Dedup-Logik in web-auth.js, NICHT der Index.
-- Idempotent (frische wie bestehende DB heilt sich beim Boot).
CREATE INDEX IF NOT EXISTS account_email_idx ON account (email);

-- session: serverseitige Sessions fuer Invalidierung (Suspend killt Session sofort).
CREATE TABLE IF NOT EXISTS session (
  id             TEXT PRIMARY KEY,
  sub            TEXT NOT NULL REFERENCES account(sub) ON DELETE CASCADE,
  tenant_id      TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ
);

-- P1 WorkOS-Logout: optionale WorkOS-Session-ID (sid-Klaim) fuer den Sign-out-Redirect.
-- Additiv/idempotent, NULL fuer Bestandssessions (heilen sich beim naechsten Login selbst).
ALTER TABLE session ADD COLUMN IF NOT EXISTS workos_session_id TEXT;

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
ALTER TABLE platform_tts_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tts_usage FORCE  ROW LEVEL SECURITY;

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
-- platform_tts_usage: GLOBAL wie profile - keine Tenant-Dimension, kein app.current_tenant-
-- Filter. FORCE RLS bleibt aktiv (Konsistenz), die Policy ist permissiv (Muster profile_global).
DROP POLICY IF EXISTS tenant_isolation ON platform_tts_usage;
DROP POLICY IF EXISTS platform_tts_usage_global ON platform_tts_usage;
CREATE POLICY platform_tts_usage_global ON platform_tts_usage USING (true) WITH CHECK (true);
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
