import dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Tests laufen mit sauberem Env (wie CI, ohne lokale .env) - verhindert, dass eine
// Entwickler-.env (z.B. Beispiel-OWNER_NUMBER) Test-Annahmen verfaelscht.
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}

// ---- Numerische Env-Validierung (fail-closed, OT-4) ----
// Eine GESETZTE, aber ungueltige numerische Env-Var (NaN/Infinity oder ausserhalb
// des erlaubten Bereichs) darf NICHT still auf einen no-op kippen - sonst schaltet
// sich ein Safety-/Kosten-Gate lautlos ab (z.B. ist costEur >= NaN IMMER false ->
// Budget-Guard blockt nie). numEnv() parst UND validiert; Befunde landen in
// fatalConfigErrors[], das assertConfig() zusaetzlich zu den Presence-Checks liest
// -> Boot wird verweigert statt lautlos ohne Gate weiterzulaufen.
const fatalConfigErrors = [];

// Leere/abwesende Var -> dokumentierter Default (KEIN Fatal); nur gesetzt-aber-
// ungueltig ist fatal. max ist ein bewusster Clamp (Obergrenze wie maxCallDurationS),
// kein Fehler. Die Diagnose nennt nur Var + Erwartung, NIE einen Wert (numEnv
// betrifft ausschliesslich numerische, nicht-geheime Vars -> kein Secret-Leak).
export function numEnv(name, raw, { fallback, min, max, integer = true } = {}) {
  if (raw === undefined || raw === "") return fallback;
  const n = integer ? parseInt(raw, 10) : parseFloat(raw);
  if (!Number.isFinite(n)) {
    fatalConfigErrors.push(
      `${name}="${raw}" ist keine gueltige Zahl (erwartet: ${integer ? "Ganzzahl" : "Zahl"}${min !== undefined ? `, >= ${min}` : ""}).`,
    );
    return fallback;
  }
  if (min !== undefined && n < min) {
    fatalConfigErrors.push(`${name}=${n} unterschreitet das Minimum ${min}.`);
    return fallback;
  }
  if (max !== undefined && n > max) return max; // bewusster Clamp auf die Obergrenze
  return n;
}

// Kopie der bisher gesammelten numerischen Fatal-Befunde (fuer assertConfig + Tests).
export function configFatalErrors() {
  return fatalConfigErrors.slice();
}

// Produktions-Erkennung: Render setzt RENDER_EXTERNAL_URL automatisch -> echtes
// oeffentliches Hosting. EINE Quelle des Diskriminators (G5). Call-time gelesen, damit
// productionFootguns/assertConfig denselben Ausdruck treffen, auch wenn ein Test das
// Hosting per process.env simuliert (config-prod-footguns).
function detectProduction() {
  return !!process.env.RENDER_EXTERNAL_URL;
}

// Ziel-Vorwahlen mit Inlands-Tarif (E.164). BEWUSST eigenstaendig, NICHT an das Land-Gate
// (allowedCountryCodes) gekoppelt: das Gate wird in Phase 4 '*' (weltweit), der Inlands-
// Tarif bleibt auf diesen Vorwahlen. Alles andere -> voiceTariffDefaultCents (Worst-Case).
const VOICE_TARIFF_DOMESTIC_PREFIXES = ["+49", "+33", "+44"];

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  claudeModel: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
  maxBudgetEur: numEnv("MAX_BUDGET_EUR", process.env.MAX_BUDGET_EUR, {
    fallback: 8,
    min: 0,
    integer: false,
  }),

  // ---- LLM-Resilienz-Seam (P3b-R Schicht 2, src/llm.js) ----
  // Per-Request-Timeout je Anthropic-Versuch (SDK-Default 10 min ist webhook-toedlich:
  // Twilio kappt nach 15 s hart). Budget-Soll: (llmMaxRetries+1)*timeout + Backoff < 12 s.
  // Mit Defaults: 3*3500 + (<=250+500) = <=11250 ms < 12000 ms < Twilio-15s. Default
  // bewusst 3500 (nicht 4000), damit das Budget mit Sicherheitsmarge haelt.
  llmRequestTimeoutMs: numEnv("LLM_REQUEST_TIMEOUT_MS", process.env.LLM_REQUEST_TIMEOUT_MS, {
    fallback: 3500,
    min: 1,
  }),
  // Harte Retry-Obergrenze (selektiv, nur transiente Verbindungsklasse). 0 = kein Retry.
  llmMaxRetries: numEnv("LLM_MAX_RETRIES", process.env.LLM_MAX_RETRIES, { fallback: 2, min: 0 }),
  // Basis fuer den exponentiellen Voll-Jitter-Backoff (gegen Thundering Herd).
  llmBackoffMs: numEnv("LLM_BACKOFF_MS", process.env.LLM_BACKOFF_MS, { fallback: 250, min: 0 }),
  // Circuit-Breaker: ab threshold transienten Fehlern im windowMs-Fenster -> open;
  // nach cooldownMs -> half-open (eine Probe). Kappt Retry-Stuerme bei Anthropic-
  // Brownout (Millionen-Skala). Startwerte konservativ; finales Tuning CP6 (Lasttest).
  llmBreakerThreshold: numEnv("LLM_BREAKER_THRESHOLD", process.env.LLM_BREAKER_THRESHOLD, {
    fallback: 5,
    min: 1,
  }),
  llmBreakerWindowMs: numEnv("LLM_BREAKER_WINDOW_MS", process.env.LLM_BREAKER_WINDOW_MS, {
    fallback: 10000,
    min: 1,
  }),
  llmBreakerCooldownMs: numEnv("LLM_BREAKER_COOLDOWN_MS", process.env.LLM_BREAKER_COOLDOWN_MS, {
    fallback: 30000,
    min: 1,
  }),

  // ---- Mess-Instrumentierung (L0, src/metrics.js) ----
  // Master-Schalter fuer PII-freie Latenz-/Loop-/STT-Gap-Logs. DEFAULT AUS
  // (byte-identisch, auch stdout): Konsumenten no-oppen. Zum Live-Messen (Datengrundlage
  // fuer L1) am Host auf "true" setzen - reine Diagnose, beruehrt KEINE Safety-Gates,
  // KEINE Disclosure, KEINE Resilienz-Werte. Tests pinnen das via BASE_ENV.
  metricsEnabled: (process.env.METRICS_ENABLED || "false") === "true",

  twilioSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioToken: process.env.TWILIO_AUTH_TOKEN || "",
  // Absendernummern (Twilio/Telnyx) kommen NICHT mehr aus der config: der Owner ist
  // Tenant Null und haelt seine Nummer(n) wie jeder Tenant im Store (s.numbers),
  // einmalig eingetragen via scripts/seed-owner-number.js. Boot-Guard in server.js
  // verlangt fail-closed eine aktive Owner-Nummer.

  // ---- Telnyx (zweiter Provider, P5; alle optional) ----
  telnyxApiKey: process.env.TELNYX_API_KEY || "", // SECRET - nie loggen/leaken
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY || "", // Ed25519-Public-Key des Telnyx-Accounts (verify)
  telnyxApiBase: (process.env.TELNYX_API_BASE || "https://api.telnyx.com").replace(/\/$/, ""),
  // TeXML-Application/Connection-ID: haelt die Voice-URL beim Provider, Pflicht fuer
  // Telnyx-Outbound (originateCall POST /v2/texml/calls/{connection_id}). Leer ->
  // Telnyx-Outbound wirft (fail-closed), Twilio-Outbound unberuehrt.
  telnyxConnectionId: process.env.TELNYX_CONNECTION_ID || "",
  // Telnyx-Account-ID (Mission-Control-Portal): Pflicht fuer den Telnyx-Hangup
  // (POST /v2/texml/Accounts/{account_sid}/Calls/{call_sid}). Leer -> endCall wirft.
  telnyxAccountSid: process.env.TELNYX_ACCOUNT_SID || "",
  // ElevenLabs-TTS ueber Telnyx (globale Plattform-Stimme, optional). Gate im
  // Telnyx-Renderer (via Registry injiziert): ElevenLabs-Say NUR wenn apiKeyRef
  // UND voiceId gesetzt sind - sonst Azure-Bestand byte-identisch. apiKeyRef =
  // IDENTIFIER des Telnyx-Integration-Secrets, das den ElevenLabs-API-Key haelt
  // (der Key selbst liegt NUR bei Telnyx, nie hier). Bewusste Vereinfachung:
  // EIN Plattform-Key - TTS-Zeichen aller Tenants laufen ohne per-Tenant-
  // Metering aufs Owner-ElevenLabs-Konto (Paid-Plan noetig).
  telnyxElevenLabs: {
    apiKeyRef: process.env.TELNYX_ELEVENLABS_API_KEY_REF || "",
    voiceId: process.env.TELNYX_ELEVENLABS_VOICE_ID || "",
    // Model-Slot in ElevenLabs.<Model>.<VoiceId> (Telnyx dokumentiert "Default"
    // und "v3"; andere Slugs nur nach Live-Probe nutzen).
    model: process.env.TELNYX_ELEVENLABS_MODEL || "Default",
  },

  // Play-TTS: ElevenLabs-Stimme via <Play> in der Budget-Engine (Telnyx). GETRENNT vom
  // Relay-Block telnyxElevenLabs oben: dort baut Telnyx einen Live-Relay-Stream (der den
  // Inbound-Track unterdrueckt -> STT leer, A/B-belegt); HIER synthetisiert unser Server
  // die mp3 vorab und Telnyx spielt eine STATISCHE Datei -> Inbound-Track lebt. Gate
  // Default AUS (Muster PAYMENT_ENABLED) -> Azure-<Say> byte-identisch. apiKey ist SECRET.
  elevenLabsPlayTts: {
    enabled: (process.env.ELEVENLABS_PLAY_TTS_ENABLED || "false") === "true",
    // .trim() gegen manuell eingegebenen Whitespace: ein Trailing-Space in voiceId/model/
    // outputFormat wird von encodeURIComponent zu %20 -> ElevenLabs lehnt mit HTTP 400 ab
    // (live belegt). apiKey getrimmt gegen pasted Newline. Solche Werte tragen NIE legitim
    // umgebenden Whitespace, das Trimmen ist reine Haertung.
    apiKey: (process.env.ELEVENLABS_API_KEY || "").trim(), // SECRET, nie loggen/leaken
    voiceId: (process.env.ELEVENLABS_VOICE_ID || "").trim(),
    model: (process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5").trim(), // Latenz-optimiert
    apiBase: (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").trim().replace(/\/$/, ""),
    outputFormat: (process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128").trim(), // Owner-Wahl mp3
    synthTimeoutMs: numEnv("ELEVENLABS_SYNTH_TIMEOUT_MS", process.env.ELEVENLABS_SYNTH_TIMEOUT_MS, {
      fallback: 4000,
      min: 500,
      max: 10000,
    }),
    tokenTtlMs: numEnv("ELEVENLABS_TTS_TOKEN_TTL_MS", process.env.ELEVENLABS_TTS_TOKEN_TTL_MS, {
      fallback: 60000,
      min: 5000,
      max: 600000,
    }),
  },

  // ---- Telnyx AI Assistant / Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, P1; optional) ----
  // Master-Flag fuer den in-house Custom-LLM-Shim (/v1/chat/completions). DEFAULT AUS
  // (fail-closed, Muster PAYMENT_ENABLED): der Endpunkt antwortet 404 bis zum Cutover
  // (Existenz hinter dem Flag -> keine monatelang offene Angriffsflaeche zwischen Merge
  // und Live). Bei Flag aus bleibt der Live-CALL-Pfad (Budget/Realtime-Engine) byte-
  // identisch. Volle 4-Orte-Doku (.env.example/render.yaml/assertConfig) folgt in P10.
  telnyxAiAssistantEnabled: (process.env.TELNYX_AI_ASSISTANT_ENABLED || "false") === "true",

  // ---- Payment/Billing (Stripe Hold/Capture, P6b1; alle optional) ----
  // Master-Flag: Geld halten -> erst dann provisionieren -> capturen -> aktivieren.
  // DEFAULT AUS (fail-closed): die Onboard-Route reicht KEINEN Billing-Client herein
  // -> kein Hold/Capture, requested->provisioning->active wie bisher (byte-identisch).
  paymentEnabled: (process.env.PAYMENT_ENABLED || "false") === "true",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "", // SECRET - nie loggen/leaken
  stripeApiBase: (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, ""),
  // Einmalige Setup-Gebuehr pro Nummer in GANZZAHL Cents (Geld nie als Float, G26).
  // Bei PAYMENT_ENABLED Pflicht > 0 (assertConfig); 0 = kein Magic-Default.
  numberSetupFeeCents: numEnv("NUMBER_SETUP_FEE_CENTS", process.env.NUMBER_SETUP_FEE_CENTS, {
    fallback: 0,
    min: 0,
  }),
  paymentCurrency: (process.env.PAYMENT_CURRENCY || "eur").toLowerCase(),
  // ---- Outbound-Kosten-Achse / Vorab-Reservierung (outbound-p1c, D1) ----
  // Voice-Minuten-Tarif (GANZZAHL Cents/min, G26). EINE Kosten-Quelle (G5): speist die
  // Vorab-Reservierung (Worst-Case vor dem Dial), den Budget-Reconcile (Ist bei Call-Ende)
  // UND den Stripe-Voice-Meter (recordVoiceMinuteMeter) - loest das fruehere
  // voiceMinuteCostCents auf. Inland (voiceTariffDomesticPrefixes) guenstig, alles andere
  // Worst-Case-Default. Konservativ gesetzt; live mit dem Provider-Tarif abgleichen.
  voiceTariffDomesticCents: numEnv("VOICE_TARIFF_DOMESTIC_CENTS", process.env.VOICE_TARIFF_DOMESTIC_CENTS, {
    fallback: 20,
    min: 0,
  }),
  voiceTariffDefaultCents: numEnv("VOICE_TARIFF_DEFAULT_CENTS", process.env.VOICE_TARIFF_DEFAULT_CENTS, {
    fallback: 300,
    min: 0,
  }),
  voiceTariffDomesticPrefixes: VOICE_TARIFF_DOMESTIC_PREFIXES,
  // Per-Tenant Default-Kostendecke (GANZZAHL Cents, G26) beim Registrieren (D5): nimmt
  // jeden neuen Tenant aus dem geteilten globalen Pool (sonst effectiveCapEur = maxBudgetEur).
  // 0 = kein Default-Seed (Tenant faellt auf den globalen Cap). Globaler Backstop
  // (maxBudgetEur) bleibt PARALLEL (Schnittmenge, Regel 1) und wird NICHT angehoben.
  defaultTenantBudgetCents: numEnv("DEFAULT_TENANT_BUDGET_CENTS", process.env.DEFAULT_TENANT_BUDGET_CENTS, {
    fallback: 1000,
    min: 0,
  }),
  // Grober Kostenbeleg pro gesendeter Summary-SMS in GANZZAHL Cents (G26), F2 P8. Jede
  // erfolgreich gesendete Summary-SMS erzeugt ein USAGE_EVENT_KIND.SMS-Event mit diesem
  // Betrag (Ledger-Quelle fuer Billing + Tages-Cap-Zaehler). 0 = Menge ohne Kostenbeleg;
  // Live mit dem Provider-SMS-Tarif abgleichen.
  smsCostCents: numEnv("SMS_COST_CENTS", process.env.SMS_COST_CENTS, { fallback: 0, min: 0 }),
  // ---- Abo-Buchung (Stripe Recurring, W4) ----
  // Stripe-Price-Ids (recurring monatlich, EUR) je Tier. Leer = Tier nicht buchbar
  // (priceIdForPlan -> null -> Route 500, KEIN Boot-Stop). Opake price_-Referenzen,
  // KEINE Secrets.
  stripeStarterPriceId: process.env.STRIPE_STARTER_PRICE_ID || "",
  stripeBusinessPriceId: process.env.STRIPE_BUSINESS_PRICE_ID || "",
  // Stripe-Webhook-Signing-Secret (whsec_...). SECRET - nie loggen/leaken. Leer +
  // PAYMENT_ENABLED -> assertConfig Boot-Refusal (Webhook fail-closed unverifizierbar).
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",

  // Owner-Identitaet kommt NICHT mehr aus der Env (P2b): der erste Tenant wird einmalig
  // per scripts/bootstrap-tenant.js angelegt und lebt im Store; ownerName/privateNumber
  // setzt der Tenant ueber Self-Service. Kein OWNER_FIRST_NAME/OWNER_LAST_NAME/OWNER_NUMBER
  // (privater SMS-Empfaenger) mehr.
  //
  // AUSNAHME Render-Autoseed der Owner-/Betriebsnummer (render-owner-autoseed): Render
  // (free plan) hat ein fluechtiges Dateisystem -> data/store.json (und damit die per
  // bootstrap-tenant eingetragene aktive Owner-Nummer) ist nach jedem Deploy weg, der
  // Boot-Guard (server.js) braeche fail-closed mit exit(1) ab. OWNER_NUMBER_SEED traegt die
  // Owner-Betriebsnummer beim Boot idempotent in den json-Store (Muster PROFILES_JSON ->
  // seedProfilesFromEnv). Das ist die Absende-/Routing-Nummer (Tenant "owner"), NICHT der
  // frueher private OWNER_NUMBER-SMS-Empfaenger (D1: keine Konflation). Leer = kein Seed
  // -> Boot-Guard bleibt fail-closed.
  ownerNumberSeed: process.env.OWNER_NUMBER_SEED || "",
  // Provider der geseedeten Owner-Betriebsnummer (twilio|telnyx). Leer (Default) -> Twilio
  // (DEFAULT_PROVIDER, haeufigste Konfiguration); ein gesetzter, aber ungueltiger Wert
  // (Tippfehler) -> KEIN Seed -> Boot-Refusal (fail-closed, kein stiller Falsch-Carrier,
  // R1). Telnyx-Owner MUSS OWNER_NUMBER_PROVIDER=telnyx setzen. Lowercase-normalisiert.
  ownerNumberProvider: (process.env.OWNER_NUMBER_PROVIDER || "").toLowerCase(),

  // AM6: Owner-OAuth-Identitaet (WorkOS sub/user.id) idempotent an den Bootstrap-Tenant
  // binden (idp_subject). Wie OWNER_NUMBER_SEED ein Boot-Seed gegen Renders fluechtiges FS /
  // No-CLI-Free-Tier: resolveTenant findet so den Tenant MIT der aktiven Nummer ueber den
  // sub-Claim (EINE Identitaetsquelle wie der Web-Login). Leer = kein Seed (fail-closed:
  // unbekannte Identitaet -> kein Tenant). Opake user_-Id, KEIN Secret. set-if-absent.
  ownerIdpSubject: process.env.OWNER_IDP_SUBJECT || "",

  // ---- Store-Backend ----
  // "json" (Default) = Datei-Persistenz (data/store.json). "pg" = Postgres.
  // Im json-Pfad wird KEINE DB-Verbindung erzeugt; DATABASE_URL ist dann nicht noetig.
  storeBackend: (process.env.STORE_BACKEND || "json").toLowerCase(),
  // Postgres-Connection-String (NUR bei STORE_BACKEND=pg). Secret -> nie loggen.
  databaseUrl: process.env.DATABASE_URL || "",
  // ---- Queue-Backend (async Provisioning-Worker, P6b2) ----
  // "memory" (Default, fail-closed) = deterministische In-Memory-Queue (drain-on-
  // demand, kein Timer). "pgboss" ist vorbereitet, aber deferred nach P8 (wirft).
  queueBackend: (process.env.QUEUE_BACKEND || "memory").toLowerCase(),

  port: numEnv("PORT", process.env.PORT, { fallback: 3000, min: 0 }),
  // Render setzt RENDER_EXTERNAL_URL automatisch -> kein ngrok noetig
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, ""),
  // Import-Zeit-Snapshot der Produktions-Erkennung fuer Laufzeit-Konsumenten (z.B. der
  // /mcp-Auth-Bypass-Gate in auth.js). productionFootguns/assertConfig nutzen denselben
  // Begriff call-time ueber detectProduction() (injizierbarer Test-Seam).
  isProduction: detectProduction(),
  // Passwort-Schutz fuer Dashboard + API im oeffentlichen Hosting (User: admin). Leer = offen (nur lokal ok).
  dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
  sendSmsSummary: (process.env.SEND_SMS_SUMMARY || "true") === "true",
  // Tages-Cap pro Tenant fuer Summary-SMS (F2 P8, Toll-Fraud-Schutz H1): nach so vielen
  // ERFOLGREICH gesendeten Summary-SMS im rollierenden 24h-Fenster wird die naechste still
  // uebersprungen (Audit-Marker reason=daily_cap, kein Fehler). Pro call.tenantId, nicht
  // global. Default 20; 0 = jede Summary-SMS gesperrt (Not-Aus, fail-closed).
  dailySmsCap: numEnv("DAILY_SMS_CAP", process.env.DAILY_SMS_CAP, { fallback: 20, min: 0 }),

  // ---- Safety-Gates ----
  // Globaler Outbound-Kill-Switch (outbound-p3): "true" friert JEDEN Outbound-Call sofort
  // ein (403, kein Originate), ohne Deploy = Betriebs-Notbremse + Sekunden-Rollback fuer
  // den Allowlist-Cutover. Default "false" = NICHT gesperrt -> Normalbetrieb byte-identisch;
  // nur exakt "true" friert. Ersetzt die fruehere statische ALLOWED_NUMBERS-Notbremse (D8):
  // Permit ist jetzt die per-Tenant-Verifikation (Abo+KYC, Pfad 2); die immer-scharfen Riegel
  // (Denylist/Land/Rate/Reserve/Budget/KYC/Eigen-Nummer) bleiben darunter unveraendert.
  outboundFrozen: (process.env.OUTBOUND_FROZEN || "false") === "true",
  // Erlaubte Laendervorwahlen fuer Outbound (kommasepariert, E.164-Prefix wie +49).
  // Default +49,+33,+44 (Deutschland, Frankreich, UK - F1 Phase 8). BEWUSST nur diese
  // drei, NICHT global ("*"): ein zu weites Gate oeffnet teure Ziele (Pre-Mortem R2).
  // "*" = alle Laender erlaubt (Gate effektiv aus). Das Gate prueft weiter das ZIEL.
  allowedCountryCodes: (process.env.ALLOWED_COUNTRY_CODES || "+49,+33,+44")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean),
  // Max. Outbound-Calls pro gleitender Stunde (eigenes Gate, NICHT der Per-IP-Limiter
  // aus rateLimitPerMin). Bremse gegen Toll-Fraud/Kosten-Explosion, falls die Allowlist
  // spaeter gelockert wird. Default 6; 0 = jeder Outbound-Call gesperrt (Not-Aus).
  maxCallsPerHour: numEnv("MAX_CALLS_PER_HOUR", process.env.MAX_CALLS_PER_HOUR, {
    fallback: 6,
    min: 0,
  }),
  // Per-(Tenant,Ziel)-Wiederhol-Cap + Cooldown (outbound-p1d, D4): schuetzt Dritte vor
  // Belaestigung, sobald Fremd-Tenants beliebige Nummern waehlen (Phase 3/4). Max. Outbound-
  // Calls EINES Tenants an DASSELBE Ziel im Cooldown-Fenster; ab dem Cap -> 429 (fail-closed,
  // kein Originate), tenant- + ziel-isoliert. Greift VOR der Allowlist, NACH den Stundenlimits.
  // Konservativ; 0 = jeder Outbound gesperrt (Not-Aus, wie MAX_CALLS_PER_HOUR=0).
  perTargetCallCap: numEnv("PER_TARGET_CALL_CAP", process.env.PER_TARGET_CALL_CAP, {
    fallback: 3,
    min: 0,
  }),
  // Cooldown-Fenster (Millisekunden) fuer perTargetCallCap. Default 24 h.
  perTargetWindowMs: numEnv("PER_TARGET_WINDOW_MS", process.env.PER_TARGET_WINDOW_MS, {
    fallback: 24 * 60 * 60 * 1000,
    min: 1,
  }),
  // Notbremse fuer das (zahlungsfreie) Onboarding: harte Obergrenze, wie viele
  // Nummern die Plattform INSGESAMT provisionieren darf. Jede echte Nummer kostet
  // beim Provider Geld -> ohne Cap koennte ein offener Self-Service-Pfad das
  // Provider-Guthaben leeren (R4 Toll-Fraud). Kein Payment-Gate, nur Blast-Radius.
  // 0 = Provisioning gesperrt (Not-Aus). Default bewusst klein.
  maxNumbers: numEnv("MAX_NUMBERS", process.env.MAX_NUMBERS, { fallback: 5, min: 0 }),
  // Wie viele AKTIVE Nummern ein einzelner Tenant haben darf (zusaetzliches Gate).
  maxNumbersPerTenant: numEnv("MAX_NUMBERS_PER_TENANT", process.env.MAX_NUMBERS_PER_TENANT, {
    fallback: 1,
    min: 0,
  }),
  // Self-Service-Provisioning (echter Nummern-Kauf beim Provider). DEFAULT AUS
  // (fail-closed): die Onboarding-Route registriert + fragt dann nur an (Nummer
  // bleibt 'requested', KEIN Geld). Erst true -> echte Kaeufe (gedeckelt durch
  // maxNumbers). Bewusst global statt pro-Order: Blast-Radius ist durch die Caps
  // + Auth + Allowlist bereits winzig (Owner-Phase). NIE per Default an.
  provisioningEnabled: (process.env.PROVISIONING_ENABLED || "false") === "true",
  // PROV-01 Crash-Recovery (F4/F5): maximales Job-Alter (ms), bis zu dem der Boot-
  // Reconciler eine in 'requested' haengende Nummer AUTOMATISCH nachfuehren darf.
  // 0 (Default) = Observe-Only fail-closed: KEIN Auto-Nachkauf, haengende Jobs werden
  // nur sichtbar gemacht. MUSS strikt KLEINER bleiben als das kleinste Anbieter-
  // Idempotenz-Fenster (Stripe-Hold = 24h), sonst droht Doppelkauf; scharf empfohlen
  // 3600000 (1h). Erst nach gruenem Telnyx-Idempotenz-Smoke > 0 scharfschalten.
  provisioningRedriveMaxAgeMs: numEnv(
    "PROVISIONING_REDRIVE_MAX_AGE_MS",
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS,
    { fallback: 0, min: 0 },
  ),
  // Multi-Tenant-Identitaets-/Laufzeit-Schicht (I4-I7). DEFAULT AUS (fail-closed):
  // requestTenant === BOOTSTRAP_TENANT_ID -> Owner byte-identisch, kein Tenant-Scoping.
  // Erst true (nach allen dichten Scope-Gates I5/I6/I7) loest die Auth-Achse den
  // Request-Tenant auf. EIN gemeinsames Flag fuer I4-I7 (kein separates Login-Flag;
  // Self-Service kommt spaeter unter eigenem Reife-Flag).
  multiTenant: (process.env.MULTI_TENANT || "false") === "true",
  // Rich-UI ui://-Resource fuer faehige MCP-Hosts (P1-W3). DEFAULT AN (Produkt-Default):
  // der Rich-UI-Pfad ist aktiv. Bleibt fail-closed gehedged - ein Host bekommt das Widget
  // NUR, wenn er die Capability deklariert; sonst weiter nur Text/structuredContent. Mit
  // MCP_UI_ENABLED=false explizit abschaltbar (Tests pinnen das via BASE_ENV).
  mcpUiEnabled: (process.env.MCP_UI_ENABLED || "true") === "true",
  // Strukturierter Per-Call-Kontext (PLAN-PERSONAL-ASSISTANT P3): optionales context-
  // Objekt an place_call -> kompakte HINTERGRUND-Sektion im Outbound-systemPrompt + additiv
  // persistiertes Feld. DEFAULT AN (Praezedenz mcpUiEnabled, I12 call-quality-Scheibe): der
  // Kanal ist produktionsreif (R3 Anti-Spoofing bewiesen - der Kontext speist NIE
  // Offenlegung/Persona; eigener Validierungs-/Persist-Pfad seit P3 gehaertet, 10+ Tests).
  // Mit ASSISTANT_CONTEXT_ENABLED=false weiter fail-closed abschaltbar (Tests pinnen das
  // explizit via BASE_ENV, siehe test/helpers.js).
  assistantContextEnabled: (process.env.ASSISTANT_CONTEXT_ENABLED || "true") === "true",
  // Self-Service-Schicht (I9): getrenntes Tenant-Dashboard + Self-Service-Settings-
  // Route hinter eigenem Reife-Flag. DEFAULT AUS (fail-closed): die Self-Service-
  // Routen sind nicht erreichbar (404), die getrennte Seite bleibt hinter Basic-Auth
  // -> heutiges Admin-Dashboard + /api/* byte-identisch. Getrennt von MULTI_TENANT
  // (groesste Angriffsflaeche: oeffentlicher Tenant-Login + Self-Service-Schreiben).
  selfServiceEnabled: (process.env.SELF_SERVICE_ENABLED || "false") === "true",
  // Lokaler Dev-Login-Shim (Single-Origin P1): POST /auth/dev-login mintet eine Session
  // OHNE WorkOS-Round-Trip - NUR fuer den lokalen Chrome-e2e-Loop. DOPPELT fail-closed:
  // explizites Opt-in (=== "true") UND nie im Hosting (Render setzt RENDER_EXTERNAL_URL ->
  // hier zu false neutralisiert). Eine versehentlich auf Render gesetzte DEV_LOGIN_ENABLED
  // verweigert zusaetzlich den Boot (productionFootguns liest die rohe Env, zweite Sperre).
  devLoginEnabled: process.env.DEV_LOGIN_ENABLED === "true" && !process.env.RENDER_EXTERNAL_URL,
  // ISO-Laendercode fuer die Nummernsuche (DE-only Launch, Plan-Entscheidung #3).
  provisioningCountry: process.env.PROVISIONING_COUNTRY || "DE",
  // Erzwungenes KAUF-Land fuer ALLE neuen Nummern (ISO-2), ENTKOPPELT vom erkannten
  // Herkunftsland. Leer (Default) -> Kauf-Land = erkanntes Land (heutiges Verhalten
  // byte-identisch). Gesetzt (z.B. "US") -> jede neue Nummer wird DORT gekauft; die
  // SPRACHE bleibt am erkannten Herkunftsland (languageForCountry -> number.language /
  // tenant.defaultLanguage), NICHT am Kauf-Land. Trennt "wo ist der User" (Sprache)
  // von "welche Nummer kaufen wir". Das Geo-Feature bleibt vollstaendig erhalten -
  // diese Var neutralisiert nur die Kauf-Land-Wahl, nicht die Land-/Sprach-Erkennung.
  forceNumberCountry: (process.env.FORCE_NUMBER_COUNTRY || "").trim().toUpperCase(),
  // Geo-Quelle bei der Registrierung (F1, Phase 6). DEFAULT AUS (fail-closed, netzfreie
  // CI): aus -> Null-Adapter (loest IP nie auf -> Land-Fallback DE, Onboard byte-identisch).
  // Erst true -> der lokale maxmind-Adapter (IP->Land-VORSCHLAG; die User-Wahl bleibt
  // autoritativ, R4). Die IP verlaesst den Prozess NIE (kein HTTP-Geo). Der echte mmdb-
  // Reader braucht ggf. ein Asset (GEO_DB_PATH) + einen Owner-genehmigten Dep; bis dahin
  // ist der maxmind-Adapter fail-safe null (DE-Fallback, kein Crash), siehe src/geo/maxmind.js.
  geoEnabled: (process.env.GEO_ENABLED || "false") === "true",
  // Pfad zur lokalen GeoLite2-Country-mmdb (nur relevant bei GEO_ENABLED=true). Leer ->
  // der maxmind-Adapter liefert fail-safe null (DE-Fallback). Das Asset committen wir NICHT.
  geoDbPath: process.env.GEO_DB_PATH || "",
  // Rechteprofile (Phase 2) als JSON {"<email|idp-sub>": {<Profil-Felder>}}. Beim
  // Start in den Store geseedet (store.js). Noetig, weil Render (free plan) ein
  // fluechtiges Dateisystem hat -> per-API angelegte Profile ueberleben keinen
  // Neustart, ueber diese Env-Var gesetzte schon. Leer = keine Seed-Profile.
  profilesSeed: process.env.PROFILES_JSON || "",
  maxCallDurationS: numEnv("MAX_CALL_DURATION_S", process.env.MAX_CALL_DURATION_S, {
    fallback: 180,
    min: 1,
    max: 300,
  }),
  // OUT-05 (F2): Puffer ueber der Call-Max-Dauer, bis die Worst-Case-Reserve UNABHAENGIG vom
  // Provider-completed-Callback via Backstop-Timer freigegeben wird (Hangup-/Callback-Latenz).
  // Groesser = sicherer gegen fruehe Freigabe eines noch laufenden Calls, aber laengere
  // Orphan-Lebensdauer im Verlustfall. Min 0.
  reserveReleaseGraceMs: numEnv("RESERVE_RELEASE_GRACE_MS", process.env.RESERVE_RELEASE_GRACE_MS, {
    fallback: 15000,
    min: 0,
  }),
  // A6 (F11): Watchdog-Obergrenze (ms) fuer den SIGTERM/SIGINT-Graceful-Shutdown. Der Drain
  // laesst in-flight Requests fertig und flusht dann den Store; laeuft er laenger, kappt der
  // Watchdog hart mit exit(0). Default 8000 (Render sendet nach SIGTERM erst nach ~30s SIGKILL
  // -> Puffer, ohne den Deploy merklich zu bremsen). Max 30000 (< Render-SIGKILL). Min 0.
  shutdownDrainTimeoutMs: numEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", process.env.SHUTDOWN_DRAIN_TIMEOUT_MS, {
    fallback: 8000,
    min: 0,
    max: 30000,
  }),
  // STT-Endpointing fuer Folge-Gathers (/voice/turn, Budget-Engine): fester
  // speechTimeout in Sekunden statt "auto". "auto" finalisiert auf der ERSTEN
  // internen Sprechpause -> Satz-Truncation ("geht" statt ganzem Satz). Ein fester,
  // konservativer Wert toleriert kurze Pausen. NUR Folge-Gathers; das Outbound-Erst-
  // Gather (G2) + Inbound-Greeting bleiben bewusst auf "auto" (End-of-Speech-Erkennung
  // noetig, sonst Erst-Turn-Deadlock, render.js-Doku). Telnyx-only (Twilio byte-identisch).
  sttSpeechTimeoutSec: numEnv("STT_SPEECH_TIMEOUT_SEC", process.env.STT_SPEECH_TIMEOUT_SEC, {
    fallback: 2,
    min: 1,
  }),
  // Rate-Limit pro IP und Minute fuer alle Nicht-Twilio-Routen (localhost-Socket
  // ausgenommen). Default 120: Dashboard pollt alle 2,5s (~24/min) plus Interaktionen.
  rateLimitPerMin: numEnv("RATE_LIMIT_PER_MIN", process.env.RATE_LIMIT_PER_MIN, {
    fallback: 120,
    min: 0,
  }),
  // NUR fuer lokale Tests ohne Twilio (z.B. curl gegen /voice/*). Niemals im Hosting setzen!
  skipTwilioSignatureCheck: (process.env.SKIP_TWILIO_SIGNATURE_CHECK || "false") === "true",
  // OUT-05 (F2): Test-Seam. true -> voiceControl liefert den fakeVoice-Adapter (synthetischer
  // Originate-Erfolg, endCall No-op), damit der Reserve-Atomaritaets-/Freigabepfad OFFLINE
  // testbar ist (der echte Twilio-Client wirft synchron ohne AC-SID). BOOT-GEHAERTET
  // (boot-guard.js): nur zulaessig mit SKIP_TWILIO_SIGNATURE_CHECK=true -> in Prod (Signatur-
  // pruefung fail-closed AN, Regel 1) fuehrt es zum Boot-Refusal, NIE zu stillem Nicht-Waehlen.
  // KEINE abgeschaltete Sicherung: alle Gates laufen unveraendert VOR voiceControl.
  fakeOriginate: (process.env.FAKE_ORIGINATE || "false") === "true",

  // ---- Datenschutz ----
  // Beendete Calls (samt Transkript) und Notifications aelter als RETENTION_DAYS
  // werden geloescht (DSGVO-Datenminimierung). 0 = Retention aus.
  retentionDays: numEnv("RETENTION_DAYS", process.env.RETENTION_DAYS, { fallback: 30, min: 0 }),

  // ---- MCP ueber HTTP ----
  // Optionales statisches Bearer-Token fuer /mcp (Prototyp-Abweichung von OAuth, s. README)
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || "",
  // Auth-Modus fuer /mcp:
  //   "" (leer, Default) = Legacy/fail-closed: mit MCP_AUTH_TOKEN gilt Bearer-Token,
  //                        ohne Token ist /mcp nur von localhost erreichbar - in Produktion
  //                        (RENDER_EXTERNAL_URL) gar nicht (AM1: kein Socket-Bypass, 401).
  //   "token"            = statisches Bearer-Token erzwingen (curl/Tests; claude.ai kann das NICHT).
  //   "oauth"            = OAuth 2.1 Resource Server (Produktion, claude.ai-Login-Flow).
  //   "off"              = offen ohne jede Pruefung (nur lokale Demos!).
  mcpAuth: (process.env.MCP_AUTH || "").toLowerCase(),
  // OAuth-Issuer (IdP, z.B. WorkOS AuthKit). Das Gateway findet JWKS selbst ueber
  // <issuer>/.well-known/openid-configuration.
  oauthIssuerUrl: (process.env.OAUTH_ISSUER_URL || "").replace(/\/$/, ""),
  // Erwartete Audience im Access-Token. Leer -> `${publicUrl}/mcp` (kanonische MCP-URL).
  oauthAudience: process.env.OAUTH_AUDIENCE || "",

  // ---- Web-Login (Kunden-Portal, OIDC Auth-Code + PKCE) ----
  // Session-Cookie-Signatur (HMAC). Secret -> nie loggen. Leer = Web-Login aus.
  sessionSecret: process.env.SESSION_SECRET || "",
  // WorkOS-Client fuer den Browser-Login (WorkOS User Management, authorize/authenticate).
  // client_secret = WorkOS-API-Key der Umgebung. Geteilte client_id mit dem /mcp-Kanal
  // (access_token-sub == user.id -> EINE Identitaetsquelle).
  oidcClientId: process.env.OIDC_CLIENT_ID || "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || "", // SECRET
  // WorkOS User-Management API-Basis (authorize/authenticate). Die Umgebung wird ueber
  // client_id + API-Key unterschieden, NICHT ueber den Host -> derselbe Host fuer Staging
  // und Produktion. Konstanter Default; nur fuer Tests/Self-Hosting ueberschreibbar.
  workosApiBase: (process.env.WORKOS_API_BASE || "https://api.workos.com").replace(/\/$/, ""),
  // Admin-Allowlist (kommasepariert, E-Mails). Nur diese duerfen approve/suspend.
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // Strengeres Rate-Limit fuer Login/Callback (Brute-Force/Credential-Stuffing).
  loginRateLimitPerMin: numEnv("LOGIN_RATE_LIMIT_PER_MIN", process.env.LOGIN_RATE_LIMIT_PER_MIN, {
    fallback: 10,
    min: 0,
  }),
  // Lebensdauer der Browser-Session (Session-Cookie + DB-Session) in Sekunden. Default 1 h.
  sessionTtlSeconds: numEnv("SESSION_TTL_SECONDS", process.env.SESSION_TTL_SECONDS, {
    fallback: 3600,
    min: 0,
  }),
  // Lebensdauer der Login-Flow-Cookies (pkce/state/oauth_state) in Sekunden. Default 30 min:
  // grosszuegig genug fuer den E-Mail-Verifizierungs-Round-Trip (Mail oeffnen, Link klicken),
  // aber begrenzt. Laeuft das Cookie dennoch ab, faengt die Callback-Recovery (AM2) es benign
  // ab (Flow-Neustart statt 400). Separat von sessionTtlSeconds (Browser-Session).
  loginCookieTtlSeconds: numEnv("LOGIN_COOKIE_TTL_SECONDS", process.env.LOGIN_COOKIE_TTL_SECONDS, {
    fallback: 1800,
    min: 0,
  }),

  // ---- Voice-Engine ----
  // "budget"  = Provider-eigene STT/TTS (Twilio TwiML bzw. Telnyx TeXML, je call.provider) + Claude Haiku (quasi gratis, Default)
  // "realtime"= OpenAI Realtime API (Speech-to-Speech, Barge-in, ~0,30-0,50 EUR/min)
  voiceEngine: process.env.VOICE_ENGINE || "budget",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  realtimeModel: process.env.REALTIME_MODEL || "gpt-realtime",
  realtimeVoice: process.env.REALTIME_VOICE || "alloy",
  twilioEdge: process.env.TWILIO_EDGE || "frankfurt",

  // Preise pro 1M Tokens in USD (Claude Haiku 4.5). Nur fuer den Budget-Guard.
  priceInPerMTokUsd: 1.0,
  priceOutPerMTokUsd: 5.0,
  usdToEur: 0.93,

  // DATA_DIR-Override, damit Tests nicht das echte data/store.json anfassen
  dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
  publicDir: path.join(__dirname, "..", "public"),
  // Single-Origin (P1): Verzeichnis des apps/web-Builds (astro build -> apps/web/dist).
  // Leer (Default) = AUS -> heutiges Serving byte-identisch (nur public/, hinter Basic-
  // Auth). Gesetzt -> der Gateway liefert Marketing + App-Shell same-origin (server.js),
  // VOR der Basic-Auth. Pfad-Flag (Muster MULTI_TENANT/PAYMENT_ENABLED, fail-closed).
  // AM3: zu absolutem Pfad aufloesen (path.resolve, idempotent). Ein RELATIVER WEB_DIST_DIR
  // (live "apps/web/dist") liess res.sendFile (SPA-Fallback /app/*) mit "path must be
  // absolute" 500en, waehrend express.static (cwd-relativ) noch griff. Absolut behebt das
  // an der Quelle und macht boot-guard/static cwd-unabhaengig. Leer bleibt leer (Flag aus).
  webDistDir: process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : "",
};

// Ein http-(non-https-)OAuth-Issuer ist ein SSRF-/MITM-Footgun: Token werden gegen
// einen ungesicherten IdP validiert (z.B. versehentlich auf eine interne Metadata-IP).
// localhost/127.0.0.1/[::1] = lokaler Test-IdP und bleibt zulaessig.
function isInsecureHttpIssuer(issuerUrl) {
  return (
    !!issuerUrl &&
    issuerUrl.startsWith("http://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(issuerUrl)
  );
}

// Produktions-Footguns (H1): Konfigurationen, die im oeffentlichen Hosting (Render
// setzt RENDER_EXTERNAL_URL) das Dashboard/API oeffentlich oeffnen ODER ein Safety-
// Gate lautlos abschalten. Eine vergessene/verkehrte Env darf NICHT als blosse
// Warnung durchgehen -> fail-closed: jeder Treffer ist fatal (Boot-Refusal statt
// stiller oeffentlicher Dienst). Lokal/Test (kein RENDER_EXTERNAL_URL) bleiben
// dieselben Punkte erlaubte Warnungen. Reine Funktion (cfg + isProduction
// injizierbar) -> unit-testbar ohne Spawn. Diagnose nennt nur Var-Namen, NIE Werte
// (kein Secret-Leak; betroffene Vars sind ohnehin Schalter/Presence).
export function productionFootguns(cfg = config, isProduction = detectProduction()) {
  if (!isProduction) return [];
  const errors = [];
  if (!cfg.dashboardPassword)
    errors.push(
      "DASHBOARD_PASSWORD fehlt - Dashboard und API waeren oeffentlich erreichbar (im Hosting Pflicht).",
    );
  if (cfg.mcpAuth === "off")
    errors.push("MCP_AUTH=off - /mcp ist ohne jede Pruefung offen (im Hosting unzulaessig).");
  if (cfg.skipTwilioSignatureCheck)
    errors.push(
      "SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks bleiben ungeprueft (im Hosting unzulaessig).",
    );
  if (isInsecureHttpIssuer(cfg.oauthIssuerUrl))
    errors.push("OAUTH_ISSUER_URL ist nicht https - SSRF/MITM-Footgun (im Hosting unzulaessig).");
  if (cfg.storeBackend !== "pg")
    errors.push(
      "STORE_BACKEND ist nicht 'pg' - der json-Store liegt auf Renders fluechtigem Dateisystem (Datenverlust bei jedem Deploy/Neustart). Im Hosting STORE_BACKEND=pg + DATABASE_URL Pflicht.",
    );
  // DEV_LOGIN_ENABLED ist ein lokaler Login-Shim (umgeht WorkOS) - im Hosting NIE erlaubt.
  // config.devLoginEnabled ist auf Render ohnehin neutralisiert (=== false); diese zweite,
  // unabhaengige Sperre liest die ROHE Env, damit eine versehentlich auf Render gesetzte
  // DEV_LOGIN_ENABLED=true den Boot verweigert statt still ignoriert zu werden (Regel 3).
  if (process.env.DEV_LOGIN_ENABLED === "true")
    errors.push("DEV_LOGIN_ENABLED=true - Login-Shim umgeht WorkOS (im Hosting unzulaessig).");
  return errors;
}

export function assertConfig() {
  const missing = [];
  if (!config.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
  if (!config.twilioSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilioToken) missing.push("TWILIO_AUTH_TOKEN");
  // Absendernummer + Owner-Identitaet sind keine Boot-Pflicht-Env mehr (P2b): sie leben
  // im Store (Bootstrap-CLI/Onboarding/Self-Service), nicht in der Env. Stattdessen
  // verlangt der Boot-Guard in server.js fail-closed eine aktive Nummer im Store
  // (assertConfig bleibt storefrei).
  if (!config.publicUrl || config.publicUrl.includes("CHANGE-ME")) missing.push("PUBLIC_URL");
  if (config.mcpAuth === "oauth" && !config.oauthIssuerUrl)
    missing.push("OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)");
  if (config.storeBackend === "pg" && !config.databaseUrl)
    missing.push("DATABASE_URL (weil STORE_BACKEND=pg)");
  if (config.paymentEnabled && !config.stripeSecretKey)
    missing.push("STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)");
  // W4: das Webhook-Signing-Secret ist sicherheitskritisch (ohne ist der Stripe-Webhook
  // fail-closed unverifizierbar -> kein Abo-Lifecycle). Boot-Pflicht bei aktivem Payment
  // (Muster STRIPE_SECRET_KEY). Die Price-Ids sind BEWUSST keine Boot-Pflicht: ein Tier
  // darf unbuchbar bleiben (Route-500), das stoppt den Boot nicht.
  if (config.paymentEnabled && !config.stripeWebhookSecret)
    missing.push("STRIPE_WEBHOOK_SECRET (weil PAYMENT_ENABLED=true)");
  // numEnv() faengt einen nicht-numerischen NUMBER_SETUP_FEE_CENTS bereits am Env-Parse
  // ab (fatalConfigErrors -> Boot-Refusal). Dieser Check bleibt als Invariante auf dem
  // config-Wert (> 0 ganzzahlig bei PAYMENT_ENABLED) - direkt geprueft von
  // config-payment-guard.test.js, das den config-Wert ohne Env-Pfad mutiert.
  if (
    config.paymentEnabled &&
    (!Number.isInteger(config.numberSetupFeeCents) || config.numberSetupFeeCents <= 0)
  )
    missing.push("NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)");
  // Single-Origin (P1): WEB_DIST_DIR gesetzt, aber der Build (<dir>/index.html) fehlt ->
  // sichtbarer Boot-Fehler statt stiller 401. Ohne index.html faende express.static nichts,
  // jeder Marketing-Request fiele auf die Basic-Auth durch (Admin-Passwort statt Landing).
  if (config.webDistDir && !existsSync(path.join(config.webDistDir, "index.html")))
    missing.push(
      "WEB_DIST_DIR-Build (kein index.html im angegebenen Verzeichnis - 'astro build' in apps/web?)",
    );
  // Fatal-Befunde, die den Boot stoppen (fail-closed statt stillem Gate-Aus):
  //  - numerische (AC1/AC2): NaN/Infinity/Bereichsverletzung einer gesetzten Env-Var.
  //  - Produktions-Footguns (H1): im Hosting (RENDER_EXTERNAL_URL) offene/abgeschaltete
  //    Auth-/Signatur-Gates. Lokal liefert productionFootguns() ein leeres Array.
  const isProduction = detectProduction();
  const fatal = configFatalErrors().concat(productionFootguns(config, isProduction));
  if (missing.length || fatal.length) {
    console.error("\n[Konfiguration fatal] Boot wird verweigert:");
    for (const m of missing) console.error(`  - fehlt/ungueltig: ${m}`);
    for (const f of fatal) console.error(`  - ${f}`);
    console.error("(.env pruefen; .env.example kopieren: cp .env.example .env)\n");
  }
  // Footgun-Warnungen NUR im lokalen/Test-Modus: im Hosting (isProduction) sind
  // dieselben Punkte oben bereits fatal (productionFootguns) -> hier kein
  // Doppel-Report, lokal aber weiterhin ein sichtbarer Hinweis.
  if (!isProduction && config.skipTwilioSignatureCheck)
    console.error(
      "[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!",
    );
  if (!isProduction && config.mcpAuth === "off")
    console.error("[Sicherheit] MCP_AUTH=off - /mcp ohne jede Pruefung offen (nur lokale Demos)!");
  if (config.paymentEnabled && !config.provisioningEnabled)
    console.error(
      "[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).",
    );
  if (config.storeBackend !== "pg" && config.sessionSecret)
    console.error("[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB).");
  // Self-Service ist seit der Login-Konvergenz web-session-only: die Routen sind NUR
  // im Web-Login-Block (SESSION_SECRET + STORE_BACKEND=pg) registriert. Flags an, aber
  // ohne diese Infra -> /api/self-service/* sind nicht erreichbar (404, fail-closed).
  if (
    config.selfServiceEnabled &&
    config.multiTenant &&
    !(config.sessionSecret && config.storeBackend === "pg")
  )
    console.error(
      "[Hinweis] SELF_SERVICE_ENABLED braucht den Web-Login (SESSION_SECRET + STORE_BACKEND=pg) - sonst sind die /api/self-service/*-Routen nicht erreichbar.",
    );
  // http-OIDC-Issuer: lokal nur ein Hinweis (Test-IdP), im Hosting oben bereits fatal.
  if (!isProduction && isInsecureHttpIssuer(config.oauthIssuerUrl))
    console.error(
      "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!",
    );
  return missing.length === 0 && fatal.length === 0;
}
