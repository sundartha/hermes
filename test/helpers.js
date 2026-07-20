// Test-Helpers: Server als Kindprozess starten (PORT=0 -> echten Port aus dem
// Log parsen), Store-Seeding in ein Temp-DATA_DIR und Requests ueber die
// externe Interface-IP (fuer Tests, die NICHT als localhost gelten sollen).
import { spawn } from "child_process";
import fs from "fs";
import http from "node:http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { makeDefaultState } from "../src/store/state-ops.js";

// ROOT exportiert (AM3): single-origin-serving.test.js bildet einen RELATIVEN
// WEB_DIST_DIR gegen das Arbeitsverzeichnis des Spawn-Childs (= ROOT).
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_TIMEOUT_MS = 15000;

// Owner-Absendernummer fuer Spawn-Tests: ersetzt den frueheren config-Seed
// (TWILIO_NUMBER), seit der Owner seine Nummer wie jeder Tenant im Store haelt.
// Ohne sie greift der Boot-Guard (kein Owner-Outbound -> Exit). +15005550006 =
// bisherige BASE_ENV-Nummer + seedCall.from (byte-identisch zum Altbestand).
export const OWNER_TEST_NUMBER = Object.freeze({ e164: "+15005550006", provider: "twilio" });

// Owner-Identitaet fuer Spawn-Tests: ersetzt den frueheren config-derived Identitaets-
// Seed (OWNER_FIRST_NAME/OWNER_LAST_NAME, P2b entfernt). Die Identitaet lebt jetzt im
// Store (wie die Owner-Nummer) -> ensureOwnerNumber traegt sie auf dem Owner-Tenant ein.
// firstName/lastName getrennt, ownerName = "firstName lastName" (= "Jonas Beispiel",
// woertlich gepinnt von Disclosure-/Greeting-Tests).
export const OWNER_TEST_FIRST_NAME = "Jonas";
export const OWNER_TEST_LAST_NAME = "Beispiel";
const OWNER_TEST_NAME = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

// ALLE config-relevanten Env-Variablen explizit setzen: dotenv fuellt nur
// UNgesetzte Variablen, so kann eine lokale .env die Tests nicht beeinflussen.
export const BASE_ENV = {
  PORT: "0",
  DATA_DIR: "", // wird pro Server durch ein Temp-Verzeichnis ersetzt
  ANTHROPIC_API_KEY: "test-anthropic-key",
  CLAUDE_MODEL: "claude-haiku-4-5",
  MAX_BUDGET_EUR: "8",
  // ---- LLM-Resilienz-Seam (P3b-R, src/llm.js) ----
  // Neutral + deterministisch: kurzer Timeout/Backoff, damit Tests, die den Seam ab
  // CP3 beruehren, nicht haengen; sonst leakt eine lokale .env via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift). LLM_BACKOFF_MS=1 (nicht 250), damit
  // der ab CP3 konsumierte Seam Spawn-Tests nicht ausbremst (CP3 ownt diese Datei nicht).
  LLM_REQUEST_TIMEOUT_MS: "3500",
  LLM_MAX_RETRIES: "2",
  LLM_BACKOFF_MS: "1",
  LLM_BREAKER_THRESHOLD: "5",
  LLM_BREAKER_WINDOW_MS: "10000",
  LLM_BREAKER_COOLDOWN_MS: "30000",
  // L0-Instrumentierung in Spawn-Tests AUS (deterministisch, kein Log-Rauschen; sonst
  // leakt lokales .env via dotenv -> Baseline-Drift, Lehre test-base-env-drift).
  METRICS_ENABLED: "false",
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
  // Absendernummern sind keine Env-Var mehr: die Owner-Nummer kommt ueber
  // ensureOwnerNumber in den Spawn-Store (OWNER_TEST_NUMBER). Provider-spezifische
  // Tests reichen ownerNumber:{e164,provider} an startServer durch.
  TWILIO_EDGE: "frankfurt",
  // P2b: OWNER_FIRST_NAME/OWNER_LAST_NAME/OWNER_NUMBER sind keine Config-Env mehr. Die
  // Owner-Identitaet + -Nummer seedet ensureOwnerNumber direkt in den Spawn-Store
  // (OWNER_TEST_FIRST_NAME/OWNER_TEST_NUMBER), wie in Produktion (Store statt Env).
  SEND_SMS_SUMMARY: "false",
  PUBLIC_URL: "https://agent.test",
  DASHBOARD_PASSWORD: "",
  MCP_AUTH_TOKEN: "",
  LOGIN_COOKIE_TTL_SECONDS: "1800", // AM2: neutral gepinnt (sonst leakt lokale .env in Spawn-Tests)
  ALLOWED_NUMBERS: "",
  // outbound-p3: Outbound-Kill-Switch neutral AUS (fail-closed Default false = nicht gesperrt).
  // Ohne diese Zeile leakt eine lokale .env mit OUTBOUND_FROZEN=true via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift). outbound-frozen.test.js setzt es explizit.
  OUTBOUND_FROZEN: "false",
  ALLOWED_COUNTRY_CODES: "*", // Land-Gate fuer Altbestand neutral; number-gate.test.js setzt es explizit
  MAX_CALLS_PER_HOUR: "100", // hoch genug, dass es Altbestand-Tests nicht bremst (wie RATE_LIMIT_PER_MIN)
  PROFILES_JSON: "", // Profile-Seed leer; einzelne Tests setzen es explizit
  // Owner-Number-Autoseed neutral leer (render-owner-autoseed, R8): ohne diese Zeilen
  // leakt eine lokale .env mit OWNER_NUMBER_SEED/OWNER_NUMBER_PROVIDER via dotenv in
  // Spawn-Tests -> eine geseedete Owner-Nummer braeche u.a. den Boot-Refusal-Test
  // (boot-failclosed.test.js, ownerNumber:null) (Lehre test-base-env-drift). Tests, die
  // den Autoseed pruefen (owner-number-seed.test.js), setzen sie explizit per env-Override.
  OWNER_NUMBER_SEED: "",
  OWNER_NUMBER_PROVIDER: "",
  // AM6: Owner-OAuth-Identitaets-Seed neutral leer (kein idp_subject-Seed). Ohne diese
  // Zeile leakt eine lokale .env mit OWNER_IDP_SUBJECT via dotenv in Spawn-Tests ->
  // Baseline-Drift (Lehre test-base-env-drift). am6-oauth-tenant.test.js setzt es explizit.
  OWNER_IDP_SUBJECT: "",
  MAX_CALL_DURATION_S: "180",
  CAP_FAREWELL_LEAD_MS: "20000", // P3.1: neutraler Default, sonst leakt lokales .env in Spawn-Tests
  RESERVE_RELEASE_GRACE_MS: "15000", // OUT-05 F2: neutraler Default, sonst leakt lokales .env in Spawn-Tests
  FAKE_ORIGINATE: "false", // OUT-05 F2: Test-Seam AUS; einzelne Tests setzen ihn explizit
  SHUTDOWN_DRAIN_TIMEOUT_MS: "8000", // A6 F11: neutraler Default, sonst leakt lokales .env in Spawn-Tests
  STT_SPEECH_TIMEOUT_SEC: "2", // G3: neutraler Default, sonst leakt lokales .env in Spawn-Tests (test-base-env-drift)
  // stab-p7: Turn-Guard-Schwellen neutral auf den config-Default gepinnt (sonst leakt eine
  // lokale .env via dotenv in Spawn-Tests -> Baseline-Drift, Lehre test-base-env-drift).
  MAX_EMPTY_TURNS: "3",
  CALLER_SUBSTANCE_MIN_LEN: "2",
  SKIP_TWILIO_SIGNATURE_CHECK: "true",
  RATE_LIMIT_PER_MIN: "1000",
  RETENTION_DAYS: "0",
  // P2b: Diagnose-Retention in Spawn-Tests neutral AUS (= Bestandsverhalten). Ohne diese
  // Zeile leakt eine lokale .env via dotenv in die Spawn-Tests -> Baseline-Drift.
  // diagnostic-retention-http.test.js setzt sie explizit auf "7".
  DIAGNOSTIC_RETENTION_DAYS: "0",
  VOICE_ENGINE: "budget",
  OPENAI_API_KEY: "",
  REALTIME_MODEL: "gpt-realtime",
  REALTIME_VOICE: "alloy",
  // ---- Telnyx (zweiter Provider) ----
  // Nummern sind keine Env-Var mehr (s.o.). Keys/IDs neutral leer; Tests, die
  // Telnyx-Outbound brauchen, seeden eine Telnyx-Owner-Nummer via ownerNumber.
  TELNYX_API_KEY: "",
  TELNYX_PUBLIC_KEY: "",
  TELNYX_API_BASE: "",
  TELNYX_CONNECTION_ID: "",
  TELNYX_CALL_CONTROL_APP_ID: "",
  TELNYX_ACCOUNT_SID: "",
  // Telnyx AI Assistant / Brain-Shim (PLAN-TELNYX-AI-ASSISTANT P1) neutral AUS
  // (fail-closed): der Shim antwortet 404, der Live-Pfad ist byte-identisch. Ohne diese
  // Zeile leakt eine lokale .env mit TELNYX_AI_ASSISTANT_ENABLED=true via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift). Der Shim-HTTP-Test setzt
  // sie explizit auf "true".
  TELNYX_AI_ASSISTANT_ENABLED: "false",
  // P5: neutrale Defaults, sonst leakt eine lokale .env mit TELNYX_ASSISTANT_ID/
  // TELNYX_SHIM_MAX_TURNS_PER_MIN via dotenv in Spawn-Tests -> Baseline-Drift (Lehre
  // test-base-env-drift). Leere assistantId -> P4.5 onSpeakEnded skippt fail-safe.
  TELNYX_ASSISTANT_ID: "",
  TELNYX_SHIM_MAX_TURNS_PER_MIN: "30",
  // stab-p9: neutrale Defaults (= config.js-Fallback), sonst leakt eine lokale .env mit
  // TELNYX_DEAD_AIR_TIMEOUT_S/TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift).
  TELNYX_DEAD_AIR_TIMEOUT_S: "45",
  TELNYX_OPENING_SPEAK_TIMEOUT_S: "45",
  TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS: "8",
  // Shim-Auth (E2/E3) neutral leer, sonst leakt eine lokale .env via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift). Flag-an-Spawn-Tests brauchen das Secret
  // fuer den Boot (TELNYX_ASSISTANT_BOOT_ENV traegt es explizit).
  TELNYX_SHIM_SHARED_SECRET: "",
  TELNYX_SHIM_API_KEY_REF: "",
  // OBS-FLAG neutral AUS, sonst leakt eine lokale .env mit TELNYX_SHIM_DEBUG_SHAPE=true
  // via dotenv in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  TELNYX_SHIM_DEBUG_SHAPE: "false",
  // ElevenLabs-TTS neutral aus (Gate = REF+VOICE_ID leer -> Azure-Bestand). Ohne
  // diese Zeilen leakt eine lokale .env in Spawn-Tests (Lehre test-base-env-drift).
  TELNYX_ELEVENLABS_API_KEY_REF: "",
  TELNYX_ELEVENLABS_VOICE_ID: "",
  TELNYX_ELEVENLABS_MODEL: "",
  // Play-TTS neutral aus (Gate = ELEVENLABS_PLAY_TTS_ENABLED=false -> Azure-Bestand).
  // Ohne diese Zeilen leakt eine lokale .env in Spawn-Tests (Lehre test-base-env-drift).
  ELEVENLABS_PLAY_TTS_ENABLED: "false",
  ELEVENLABS_API_KEY: "",
  ELEVENLABS_VOICE_ID: "",
  ELEVENLABS_MODEL: "",
  ELEVENLABS_API_BASE: "",
  ELEVENLABS_OUTPUT_FORMAT: "",
  ELEVENLABS_SYNTH_TIMEOUT_MS: "4000",
  ELEVENLABS_TTS_TOKEN_TTL_MS: "60000",
  // ---- Store-Backend + Onboarding/Provisioning ----
  // Neutral + fail-closed: json-Store, kein echter Nummern-Kauf. Tests, die das
  // brauchen (pg, Cap, echtes Provisioning), setzen es explizit per env-Override.
  STORE_BACKEND: "json",
  DATABASE_URL: "",
  // Queue-Backend neutral + fail-closed (In-Memory, deterministisch). Ohne diese
  // Zeile leakt eine lokale .env mit QUEUE_BACKEND=pgboss via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift).
  QUEUE_BACKEND: "memory",
  MAX_NUMBERS: "5",
  MAX_NUMBERS_PER_TENANT: "1",
  PROVISIONING_ENABLED: "false",
  PROVISIONING_COUNTRY: "DE",
  PROVISIONING_REDRIVE_MAX_AGE_MS: "0",
  RELEASE_GRACE_DAYS: "0", // tenant-prolif-d: neutraler fail-closed Default (sonst leakt lokales .env in Spawn-Tests)
  // Kauf-Land-Override aus (Default): number.country = Herkunftsland, byte-identisch.
  // Ohne diese Zeile leakt eine lokale .env mit FORCE_NUMBER_COUNTRY=US via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  FORCE_NUMBER_COUNTRY: "",
  // Geo-Quelle bei der Registrierung aus (F1 Phase 6): Null-Adapter -> DE-Fallback,
  // netzfrei. Ohne diese Zeile leakt eine lokale .env mit GEO_ENABLED=true via dotenv
  // in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  GEO_ENABLED: "false",
  GEO_DB_PATH: "",
  // Multi-Tenant default AUS: Bestandssuite laeuft byte-identisch im Owner-Pfad.
  // Ohne diesen Eintrag wuerde eine lokale .env mit MULTI_TENANT=true via dotenv
  // in Spawn-Tests lecken -> Baseline-Drift (Lehre test-base-env-drift).
  MULTI_TENANT: "false",
  // Self-Service default AUS (fail-closed): Bestandssuite byte-identisch. Ohne diese
  // Zeile leakt eine lokale .env mit SELF_SERVICE_ENABLED=true via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  SELF_SERVICE_ENABLED: "false",
  // Single-Origin (P1) default AUS: ohne unified Build serviert der Gateway byte-
  // identisch (nur public/). Ohne diese Zeilen leakt eine lokale .env mit WEB_DIST_DIR/
  // DEV_LOGIN_ENABLED via dotenv in Spawn-Tests -> Baseline-Drift (test-base-env-drift).
  // Tests, die das unified Serving / den Dev-Login pruefen, setzen sie explizit.
  WEB_DIST_DIR: "",
  DEV_LOGIN_ENABLED: "false",
  // Rich-UI default AUS (fail-closed): Bestandssuite byte-identisch (nur Text/
  // structuredContent). Ohne diese Zeile leakt eine lokale .env mit MCP_UI_ENABLED=true
  // via dotenv in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  MCP_UI_ENABLED: "false",
  // Per-Call-Kontext (PLAN-PERSONAL-ASSISTANT P3) default AUS (fail-closed): Bestandssuite
  // byte-identisch (context ignoriert). Ohne diese Zeile leakt eine lokale .env mit
  // ASSISTANT_CONTEXT_ENABLED=true via dotenv in Spawn-Tests -> Baseline-Drift
  // (Lehre test-base-env-drift). Der Smoke-/HTTP-Test setzt sie explizit auf "true".
  ASSISTANT_CONTEXT_ENABLED: "false",
  // P8 Pre-Call-Briefing default AUS (fail-closed): Bestandssuite byte-identisch (kein
  // zweiter LLM-Aufruf im place_call-Pfad). Ohne diese Zeilen leakt eine lokale .env via
  // dotenv in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift). Die P8-Tests
  // setzen sie explizit.
  PRECALL_BRIEFING_ENABLED: "false",
  PRECALL_BRIEFING_MODEL: "claude-sonnet-5",
  PRECALL_BRIEFING_TIMEOUT_MS: "6000",
  // ---- Payment/Billing (P6b1) ----
  // Neutral + fail-closed: kein Hold/Capture. Ohne diese Zeilen leakt eine lokale
  // .env mit PAYMENT_ENABLED=true via dotenv in Spawn-Tests -> Baseline-Drift.
  PAYMENT_ENABLED: "false",
  STRIPE_SECRET_KEY: "",
  STRIPE_API_BASE: "",
  NUMBER_SETUP_FEE_CENTS: "0",
  PAYMENT_CURRENCY: "eur",
  // Provider-Waehrung explizit (Lehre test-base-env-drift): ohne diese Zeile leakt eine
  // lokale .env mit PROVIDER_CURRENCY via dotenv in die Spawn-Tests.
  PROVIDER_CURRENCY: "USD",
  // LCT P2: Kurs explizit im Band (Lehre test-base-env-drift). Ohne diese Zeile leakt eine
  // lokale .env via dotenv in die Spawn-Tests und erzeugte dort eine fremde Boot-WARN.
  PROVIDER_TO_BUCKET_RATE_MICRO: "920000",
  // LCT P3: Kosten-Abgleich explizit auf den Code-Defaults gepinnt (Lehre
  // test-base-env-drift). Ohne diese Zeilen faerbte eine lokale .env die Spawn-Suite.
  // Der Sweep laeuft ohnehin nur per Intervall (6 h, unref) - in einem Spawn-Test feuert
  // er nie; die P3-Tests rufen die Fabrik direkt und in-process auf.
  COST_TRUING_DELAY_MINUTES: "180",
  COST_TRUING_MAX_ATTEMPTS: "5",
  COST_TRUING_REQUIRED_RECORD_TYPES: "",
  COST_TRUING_MIN_COVERAGE_PERCENT: "80",
  COST_TRUING_COVERAGE_STALL_SWEEPS: "8",
  COST_DRIFT_WARN_PERCENT: "50",
  COST_ALERT_DEBOUNCE_MS: "86400000",
  // W4: Abo-Env neutral leer (fail-closed): ohne diese Zeilen leakt eine lokale .env mit
  // STRIPE_*_PRICE_ID / STRIPE_WEBHOOK_SECRET via dotenv in Spawn-Tests -> Baseline-Drift
  // (Lehre test-base-env-drift). PAYMENT_ENABLED=false -> der Webhook-Secret-Boot-Check greift nicht.
  STRIPE_STARTER_PRICE_ID: "",
  STRIPE_BUSINESS_PRICE_ID: "",
  STRIPE_WEBHOOK_SECRET: "",
  // outbound-p1c: Kosten-Achse neutral auf 0 (sonst leakt eine lokale .env via dotenv in
  // Spawn-Tests). Tarif 0 -> Reservierung feuert nie + Reconcile/Meter buchen 0 (byte-
  // identisch zum frueheren VOICE_MINUTE_COST_CENTS=0); Default-Budget 0 -> kein Seed (Onboard
  // byte-identisch). Die outbound-p1c-Tests setzen die Werte explizit.
  VOICE_TARIFF_DOMESTIC_CENTS: "0",
  VOICE_TARIFF_DEFAULT_CENTS: "0",
  DEFAULT_TENANT_BUDGET_CENTS: "0",
  // P6 (Budget-Achsen, Fruehwarnung): neutral AUS (0 = kein Ereignis, byte-identisch
  // zum Bestand) - sonst leakt eine lokale .env via dotenv in Spawn-Tests (Lehre
  // test-base-env-drift). test/platform-spend-warning.test.js setzt den Wert explizit.
  PLATFORM_SPEND_WARN_PERCENT: "0",
  PLATFORM_ALERT_SMS_TO: "",
  // P7 (Budget-Achsen, Der Flip): neutral AUS (Default, byte-identisch zum Bestand) - sonst
  // leakt eine lokale .env mit BUDGET_MONTH_ENABLED=true via dotenv in Spawn-Tests (Lehre
  // test-base-env-drift) und faerbt die Suite umgebungsabhaengig.
  BUDGET_MONTH_ENABLED: "false",
  // outbound-p1d: per-(Tenant,Ziel)-Cap neutral HOCH (Gate feuert in Altbestand-Tests nie,
  // wie MAX_CALLS_PER_HOUR=100). Ohne diese Zeilen leakt eine lokale .env mit
  // PER_TARGET_CALL_CAP/PER_TARGET_WINDOW_MS via dotenv in Spawn-Tests -> Baseline-Drift
  // (Lehre test-base-env-drift). outbound-per-target-cap.test.js setzt den Cap explizit auf 3.
  PER_TARGET_CALL_CAP: "1000",
  PER_TARGET_WINDOW_MS: "86400000",
  // ---- MCP-Auth + OAuth + Hosting ----
  // Neutral; oauth.test.js / mcp-Tests setzen Issuer/Audience/Modus explizit.
  MCP_AUTH: "",
  OAUTH_ISSUER_URL: "",
  OAUTH_AUDIENCE: "",
  RENDER_EXTERNAL_URL: "",
};

// Erste nicht-interne IPv4-Adresse - Requests dorthin gelten serverseitig
// nicht als localhost (req.socket.remoteAddress != 127.0.0.1).
export function externalIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

// rawStore (String, optional): schreibt den Inhalt VERBATIM als store.json - fuer
// Tests, die ein bewusst kaputtes/nicht-JSON-File am Boot brauchen (Korruptions-
// Pfad, T-P1-03). seedState geht weiter durch JSON.stringify (gueltiges JSON).
export function tempDataDir(seedState, rawStore) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-test-"));
  if (typeof rawStore === "string") fs.writeFileSync(path.join(dir, "store.json"), rawStore);
  else if (seedState)
    fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(seedState, null, 2));
  return dir;
}

// Minimal-vollstaendiger Store-Zustand zum Seeden einzelner Testfaelle. tenants
// und numbers haben bewusst KEINEN Default (undefined): ohne sie ist die Form
// byte-identisch zum Altbestand (Conditional-Spread unten), mit ihnen laesst sich
// ein aktiver Tenant samt eigener Nummer seeden (Inbound-Routing + Identitaet).
export function seedState({
  calls = [],
  actionItems = [],
  notifications = [],
  settings = {},
  profiles = {},
  tenants,
  numbers,
} = {}) {
  return {
    settings: {
      agentName: "Hermes",
      greeting: "Hallo, hier ist der KI-Assistent von {owner}. Wie kann ich helfen?",
      allowCalendar: true,
      allowBooking: true,
      allowSummaries: true,
      allowPersonalData: false,
      allowBankData: false,
      ...settings,
    },
    calls,
    actionItems,
    calendar: [],
    usage: { inputTokens: 0, outputTokens: 0, costEur: 0, calls: calls.length },
    notifications,
    profiles,
    ...(tenants ? { tenants } : {}),
    ...(numbers ? { numbers } : {}),
  };
}

// Stellt einen telefonbaren Owner-Tenant im Spawn-Store sicher: aktive Owner-Nummer
// (Boot-Guard-Bedingung) UND Owner-Identitaet im Store (ownerName/firstName), seit P2b
// keine config-derived Seeds mehr greifen. ownerNumber === null -> bewusster Opt-out
// (Boot-Guard-Test, kaputter Store). {e164, provider} -> spezifische Owner-Nummer (z.B.
// Telnyx fuer Provider-Tests). Idempotent: eine vorhandene aktive Owner-Nummer bzw. ein
// bereits gesetzter ownerName bleiben unangetastet (explizite Test-Seeds gewinnen).
function ensureOwnerNumber(seed, ownerNumber = OWNER_TEST_NUMBER) {
  if (ownerNumber === null) return seed;
  // Ohne expliziten Seed den VOLLEN Default-Store (wie First-Boot, inkl. aller
  // Listen wie numberAssignments/provisioningJobs) als Basis - nicht das flache
  // seedState() (dem diese Listen fehlen). Gegebene Seeds bleiben unangetastet.
  const state = seed || makeDefaultState();
  const numbers = Array.isArray(state.numbers) ? [...state.numbers] : [];
  const hasOwnerActive = numbers.some(
    (n) => n.tenantId === BOOTSTRAP_TENANT_ID && n.status === "active",
  );
  if (!hasOwnerActive) {
    numbers.push({
      id: "num_owner_seed",
      e164: ownerNumber.e164,
      tenantId: BOOTSTRAP_TENANT_ID,
      provider: ownerNumber.provider,
      status: "active",
      providerNumberId: null,
    });
  }
  return { ...state, tenants: ensureOwnerIdentity(state.tenants), numbers };
}

// Owner-Tenant mit Identitaet im Spiegel sicherstellen (P2b: ownerName lebt im Store).
// Fehlt der Owner-Tenant -> anlegen; fehlt nur sein ownerName -> setzen. Ein bereits
// gesetzter ownerName bleibt unangetastet (explizite Test-Seeds gewinnen, idempotent).
function ensureOwnerIdentity(tenants) {
  const list = Array.isArray(tenants) ? [...tenants] : [];
  const owner = list.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  const identity = {
    status: "active",
    firstName: OWNER_TEST_FIRST_NAME,
    ownerName: OWNER_TEST_NAME,
  };
  if (!owner) {
    list.push({ id: BOOTSTRAP_TENANT_ID, ...identity });
  } else if (!owner.ownerName) {
    Object.assign(owner, identity, { status: owner.status });
  }
  return list;
}

export function seedCall(overrides = {}) {
  return {
    id: "call_test1",
    // tenantId wie createCall (state-ops): Default = Owner-Tenant. P2b haengt die
    // Offenlegung an tenant.ownerName (kein config.ownerName-Fallback mehr) -> ein
    // Call OHNE tenantId fiele sonst auf einen leeren Owner-Namen zurueck.
    tenantId: BOOTSTRAP_TENANT_ID,
    twilioSid: null,
    direction: "outbound",
    from: "+15005550006",
    to: "+4915112345678",
    goal: "Testziel",
    briefing: null,
    constraints: null,
    callerName: null,
    language: "de",
    maxDurationS: 60,
    status: "active",
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    actionItemIds: [],
    ...overrides,
  };
}

// Wartet, bis das stdout des Kindprozesses auf das Pattern matcht - die
// HTTP-Antwort kommt oft an, BEVOR die Log-Pipe beim Parent eingetroffen ist.
export async function waitForLog(srv, regex, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!regex.test(srv.stdout)) {
    if (Date.now() > deadline)
      throw new Error(`Log-Pattern ${regex} nicht gefunden in:\n${srv.stdout}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Wartet, bis der auf Platte persistierte Store ein Praedikat erfuellt (G5: geteilt von
// max-duration-rearm.test.js + max-duration-live-cap.test.js). Fuer Terminalisierungs-
// Pfade noetig, die ASYNC laufen (setCallEndedAt + finishCall + save) - waitForLog deckt
// nur stdout ab, nicht den Store-Zustand selbst.
export async function waitForStoreState(srv, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(srv.readStore())) {
    if (Date.now() > deadline)
      throw new Error(`Store-Zustand nicht erreicht:\n${JSON.stringify(srv.readStore().calls)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return srv.readStore();
}

// Mock der Telnyx-PROVISIONING-API: routet nach Pfad (search/order/resolve/release).
// Liefert e164 +4915799990001. Geteilt von onboarding-route + onboarding-identity
// (G5: eine Definition statt zweier Kopien). Name explizit "...ProvisioningMock",
// um die Kollision mit dem lokalen Voice/Originate-Mock in onboarding-outbound.test.js
// (startTelnyxVoiceMock) aufzuloesen - zwei verschiedene Telnyx-APIs (TD-9).
export async function startTelnyxProvisioningMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, body });
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v2/available_phone_numbers"))
        return res.end(JSON.stringify({ data: [{ phone_number: "+4915799990001" }] }));
      if (req.url === "/v2/number_orders")
        // id hier ist die Order-Sub-Resource-id (NICHT die phone_number-Ressourcen-id) -
        // der Adapter nutzt sie nicht mehr; die echte id liefert der resolve-GET unten.
        return res.end(
          JSON.stringify({
            data: { phone_numbers: [{ id: "ord_sub_1", phone_number: "+4915799990001" }] },
          }),
        );
      // resolveNumberId: GET /v2/phone_numbers?filter[phone_number]=... -> Ressourcen-id.
      if (req.url.startsWith("/v2/phone_numbers?"))
        return res.end(
          JSON.stringify({ data: [{ id: "num_ext_1", phone_number: "+4915799990001" }] }),
        );
      // release (DELETE /v2/phone_numbers/{id}) -> 200 ok
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

// OBS-2: console.log+warn fuer die Dauer eines async-Callbacks abfangen (orig sichern,
// ersetzen, im finally restaurieren - F.I.R.S.T., Reihenfolge-unabhaengig). Liefert die
// Zeilen. Eine Quelle (G5/S2) statt der zuvor in telnyx-call-control.test.js und
// telnyx-event-ingest-machine.test.js getrennt definierten Kopien.
export async function captureConsole(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.map(String).join(" "));
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines;
}

// Fake-Billing-Adapter (P6b1): aufzeichnend + per-Override werfbar, analog dem
// Fake-Provisioner. Lebt in test/helpers.js (NICHT in src/) - reines Test-Double
// fuer provisionNumber. log haelt [methode, ...args] in Aufrufreihenfolge.
export function fakeBilling(overrides = {}) {
  const log = [];
  const base = {
    async placeHold(args) {
      log.push(["placeHold", args]);
      return { paymentIntentId: "pi_fake_1" };
    },
    async captureHold(id, amt) {
      log.push(["captureHold", id, amt]);
    },
    async cancelHold(id) {
      log.push(["cancelHold", id]);
    },
    async reportMeter(args) {
      log.push(["reportMeter", args]);
    }, // P6b3-Meter-Aufzeichner
  };
  return { log, ...base, ...overrides };
}

// Fake-Provisioner-Adapter: aufzeichnend (log) + per-Override werfbar (DIP) -
// reines Test-Double fuer provisionNumber/handleProvisionJob, kein Netz. Eine Quelle
// (G5/S2) statt der frueher in onboarding-service/billing-hold-capture/provisioning-
// worker dreifach kopierten Definition. log haelt die Schritte in Aufrufreihenfolge.
export function fakeProvisioner(overrides = {}) {
  const log = [];
  const orderCalls = []; // additiv: jeder orderNumber-Aufruf mit connectionId (AM5-Threading)
  const base = {
    async searchNumbers({ countryCode } = {}) {
      log.push(`search:${countryCode}`);
      return [{ e164: "+4915799990001" }];
    },
    async orderNumber({ e164, connectionId, idempotencyKey }) {
      // log-String UNVERAENDERT (Bestands-deepEquals gruen); orderCalls traegt zusaetzlich
      // die connectionId fuer die AM5-Threading-Pruefung (connection_id im Order-Body).
      log.push(`order:${e164}:${idempotencyKey}`);
      orderCalls.push({ e164, connectionId, idempotencyKey });
      return { e164, providerNumberId: "num_ext_1" };
    },
    async releaseNumber(id) {
      log.push(`release:${id}`);
    },
  };
  return { log, orderCalls, ...base, ...overrides };
}

// PA-18: fakeTelnyxShimConfig lebt jetzt in config-namespaces-helper.js (das config.js
// bereits legitim importiert) - ein config.js-Import HIER wuerde config.js schon beim
// Import von helpers.js auswerten, VOR dem env-Setup jeder aufrufenden Datei (s.
// config-namespaces-helper.js-Doku, test-base-env-drift). Re-Export bewusst UNTERLASSEN
// (kein zusaetzlicher Re-Export-Umweg, G5) - die vier Konsumenten importieren direkt.

// stab-p9: No-op-ConversationWatchdog fuer Bestandstests, die die Kosten-Notaus-Achse nicht
// pruefen - haelt sie byte-identisch (observeTurn NIE loopExceeded, arm/clear wirkungslos).
// Die stab-p9-Tests injizieren stattdessen den echten Watchdog bzw. einen Spy.
export function noopWatchdog() {
  return {
    arm() {},
    // MINOR-2-Fix: der Kontrakt von observeTurn traegt seit K0 zusaetzlich turnSeq (der
    // echte Watchdog erhoeht+liefert ihn bei jedem Aufruf) - das No-op-Double bildete das
    // nicht mehr ab. 0 ist ein neutraler Platzhalter (dieses Double zaehlt nicht wirklich),
    // klar von der 1-basierten Zaehlung des echten Watchdogs unterscheidbar.
    observeTurn: () => ({ loopExceeded: false, turnSeq: 0 }),
    clear() {},
    // afix-p3: No-op = kein Farewell-Hangup. Tests, die den realen Hangup pruefen, injizieren
    // den echten Watchdog (makeTestWatchdog, telnyx-shim-harness.js).
    scheduleFarewellHangup: () => ({ delayMs: 0 }),
  };
}

// afix-p1 (Review-Blocker Runde 2, G5): Fabrik fuer withConfig/withBlankedConfig, gebunden per
// Closure an EIN gegebenes config-Objekt - EINE Implementierung statt der frueher in
// telnyx-call-control.test.js und telnyx-event-ingest-machine.test.js fast wortgleich
// kopierten Save-Set-Restore-Logik. Nimmt configObj bewusst als Parameter der Fabrik entgegen
// statt config.js selbst zu importieren: manche Aufrufer muessen config ERST NACH dem Setzen
// von process.env dynamisch importieren (Muster telnyx-call-control.test.js: ein statischer
// Import hier wuerde diese Reihenfolge unterlaufen und eine lokale .env leaken lassen, siehe
// Lehre test-base-env-drift). Die zurueckgegebenen Funktionen bleiben bei <=3 Argumenten (F1),
// weil configObj per Closure gebunden ist statt bei jedem Aufruf mitgereicht zu werden.
// PA-20: nach dem Flip existiert keine flache config-Oberflaeche mehr. Der Helfer routet
// jeden flachen Override-Key ueber sein Namespace-Blatt (Getter+Setter auf denselben Slot).
// Der Flach->Namespace-Index wird EINMAL aus der uebergebenen Oberflaeche gebaut (13 enumerable
// Namespaces, je enumerable Blaetter) - KEIN statischer config.js-Import (test-base-env-drift).
export function makeConfigOverrides(configObj) {
  const namespaceOfKey = {};
  for (const namespace of Object.keys(configObj)) {
    for (const key of Object.keys(configObj[namespace])) namespaceOfKey[key] = namespace;
  }
  const readValue = (key) => configObj[namespaceOfKey[key]][key];
  const writeValue = (key, value) => {
    configObj[namespaceOfKey[key]][key] = value;
  };
  async function withConfig(key, value, fn) {
    const saved = readValue(key);
    writeValue(key, value);
    try {
      // pa20-fix1: Rueckgabewert von fn() durchreichen (bisher verworfen) - noetig fuer
      // makeStripeStub weiter unten, dessen Aufrufer teils `const result = await
      // withStripeStub(...)` schreiben. Rein additiv: kein Bestandsaufrufer liest den
      // Rueckgabewert von withConfig(), also byte-identisches Verhalten fuer sie.
      return await fn();
    } finally {
      writeValue(key, saved);
    }
  }
  function withBlankedConfig(key, fn) {
    return withConfig(key, "", fn);
  }
  // cc-p6-fix1 (Review-Blocker G5): Multi-Key-Variante fuer Faelle, die mehrere Felder
  // gleichzeitig ueberschreiben (z.B. ein Pflichtfeld-Bundle wie CONFIG_REQUIRED_OK).
  // Ersetzt die byte-identische Save-Set-Restore-Schleife, die zuvor in
  // config-boolenv.test.js, config-failclosed.test.js und config-payment-guard.test.js
  // dreifach als lokales `withConfig(overrides, fn)` kopiert war (Datei-Kommentar dort
  // verwies bereits explizit auf "Muster config-failclosed.test.js").
  function withConfigOverrides(overrides, fn) {
    const saved = {};
    for (const k of Object.keys(overrides)) saved[k] = readValue(k);
    for (const k of Object.keys(overrides)) writeValue(k, overrides[k]);
    try {
      return fn();
    } finally {
      for (const k of Object.keys(saved)) writeValue(k, saved[k]);
    }
  }
  return { withConfig, withBlankedConfig, withConfigOverrides };
}

// pa20-fix1 (Review-Blocker G5): Fabrik fuer withStripeStub, gebunden per Closure an EIN
// config-Objekt + EINEN Test-Secret-Key - ersetzt die in billing-stripe-idempotent-headers
// .test.js, stripe-cancel-hold-adapter.test.js und stripe-setup-checkout.test.js byte-
// identisch kopierte Save-Set-Restore-Logik (global.fetch + config.billing.stripeSecretKey/
// stripeApiBase). Baut auf withConfig() auf (dieselbe Namespace-Routing-Logik wie
// makeConfigOverrides), NIE api.stripe.com im Test. Reicht den Rueckgabewert von fn()
// durch, weil manche Aufrufer `const result = await withStripeStub(...)` schreiben.
const STRIPE_TEST_API_BASE = "https://api.stripe.test";
export function makeStripeStub(configObj, secret) {
  const { withConfig } = makeConfigOverrides(configObj);
  return function withStripeStub(impl, fn) {
    const originalFetch = global.fetch;
    global.fetch = impl;
    return withConfig("stripeSecretKey", secret, () =>
      withConfig("stripeApiBase", STRIPE_TEST_API_BASE, fn),
    ).finally(() => {
      global.fetch = originalFetch;
    });
  };
}

// cc-p6-fix1 (Review-Blocker G5): gemeinsame Pflichtfeld-Fixture fuer assertConfig()-Tests
// (config-boolenv.test.js, config-failclosed.test.js, config-payment-guard.test.js hatten
// sie zuvor byte-identisch bzw. mit leichten Abweichungen lokal kopiert). Deckt genau die
// Felder ab, die assertConfig() unabhaengig vom geprueften Aspekt verlangt; Aufrufer mit
// zusaetzlichen Anforderungen (z.B. PAYMENT_ENABLED-Pfad) spreaden + ueberschreiben lokal.
export const CONFIG_REQUIRED_OK = Object.freeze({
  anthropicApiKey: "x",
  twilioSid: "x",
  twilioToken: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
});

// ---- Telnyx-Origination/-Inbound-Rohstoffe (Nummern/Header/Seed/POST-Helper) ----
// EINE Quelle (G5/S2) statt der frueher in telnyx-p5-origination + telnyx-p8-inbound +
// telnyx-p9-flag-matrix dreifach kopierten Konstanten und Helper-Funktionen.
// TELNYX_TEST_PEER_NUMBER spielt zwei Rollen (Outbound-Ziel UND Inbound-Anrufer-From) -
// beide Test-Dateien riefen bereits wortwoertlich dieselbe Nummer auf.
export const TELNYX_TEST_OWNER_NUMBER = Object.freeze({
  e164: "+4915005551234",
  provider: "telnyx",
});
export const TELNYX_TEST_PEER_NUMBER = "+4915112345678";
export const TELNYX_TEST_TENANT_NUMBER = "+4915255555555";
export const TELNYX_TEST_SIGNATURE_HEADERS = Object.freeze({
  "telnyx-signature-ed25519": "sig",
  "telnyx-timestamp": "1",
});

// P10: assertConfig verlangt bei aktivem TELNYX_AI_ASSISTANT_ENABLED-Flag zusaetzlich
// ASSISTANT_ID/API_KEY/CONNECTION_ID (fail-closed Boot) - Flag-an-Spawn-Tests brauchen
// die drei Werte oft NUR, damit der Server ueberhaupt startet, nicht fuer ihre
// eigentliche Aussage. EINE Quelle (G5/S2) statt der frueher in telnyx-p5-gate-proof +
// telnyx-p5-origination + telnyx-p8-inbound + telnyx-p9-flag-matrix + telnyx-shim-route
// fuenffach (teils voll, teils als 2-Key-Teilsatz) kopierten Fixture.
export const TELNYX_ASSISTANT_BOOT_ENV = Object.freeze({
  TELNYX_ASSISTANT_ID: "asst_x",
  TELNYX_API_KEY: "key_x",
  TELNYX_CONNECTION_ID: "conn_x",
  TELNYX_CALL_CONTROL_APP_ID: "ccapp_x",
  TELNYX_SHIM_SHARED_SECRET: "shim_secret_x",
});

// POST /api/calls (Outbound-Origination-Trigger). Liefert die rohe fetch-Response
// (Caller entscheidet, ob nur der Status oder auch der JSON-Body gebraucht wird).
export function placeCall(srv, to = TELNYX_TEST_PEER_NUMBER) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });
}

// POST /voice/incoming (Inbound-Webhook-Trigger). telnyx (bool, Default true): Ed25519-
// Signatur-Header setzen - ohne sie faellt providerFromHeaders auf Twilio/DEFAULT_PROVIDER
// zurueck (Anti-Spoof-Provider-Klassifikation). callControlId (optional): Telnyx-TeXML-Feld
// im Body, nur gesetzt wenn explizit uebergeben. Liefert die rohe fetch-Response.
export function postTelnyxIncoming(
  srv,
  {
    telnyx = true,
    callControlId,
    callSid = "CAtest",
    from = TELNYX_TEST_PEER_NUMBER,
    to = TELNYX_TEST_TENANT_NUMBER,
  } = {},
) {
  const body = { CallSid: callSid, From: from, To: to };
  if (callControlId !== undefined) body.CallControlId = callControlId;
  return fetch(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: telnyx ? TELNYX_TEST_SIGNATURE_HEADERS : {},
    body: new URLSearchParams(body),
  });
}

// Seedet EINE aktive Telnyx-Nummer (TELNYX_TEST_TENANT_NUMBER) am Owner-Tenant - Inbound-
// Routing (/voice/incoming) braucht eine passende aktive Nummer im Store, sonst greift das
// To-Routing nicht.
export function seedWithTelnyxNumber() {
  return seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas" }],
    numbers: [
      {
        id: "num_telnyx",
        e164: TELNYX_TEST_TENANT_NUMBER,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });
}

// ---- OAuth-Mini-IdP (offline) fuer MCP_AUTH=oauth-Tests ----
// = PUBLIC_URL/mcp aus BASE_ENV (kanonische Audience).
export const MCP_AUDIENCE = "https://agent.test/mcp";
const KID = "test-key-1";

// Lokaler IdP: Metadata zeigt auf den JWKS-Endpunkt, JWKS enthaelt den
// oeffentlichen Schluessel. Liefert Issuer-URL + Signierer. metadataPath waehlt
// den Well-known-Pfad (WorkOS AuthKit nutzt oauth-authorization-server).
export async function startIdp({ metadataPath = "/.well-known/openid-configuration" } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const server = http.createServer((req, res) => {
    if (req.url === metadataPath) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const issuer = `http://127.0.0.1:${server.address().port}`;

  // Zweiter Schluessel mit GLEICHER kid -> jose findet den Key, die Signatur
  // passt aber nicht: sauberer 401 ohne JWKS-Refetch.
  const wrong = await generateKeyPair("RS256");

  // noSubject: true laesst den sub-Claim ganz weg (fuer den Fail-closed-Test:
  // verifiziertes Token ohne email UND sub).
  const sign = (
    claims = {},
    { key = privateKey, exp = "5m", aud = MCP_AUDIENCE, iss = issuer, noSubject = false } = {},
  ) => {
    let jwt = new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp);
    if (!noSubject) jwt = jwt.setSubject(claims.sub || "user-1");
    return jwt.sign(key);
  };

  return {
    issuer,
    sign,
    wrongKey: wrong.privateKey,
    close: () => new Promise((r) => server.close(r)),
  };
}

// POST an /mcp (Streamable HTTP). Ohne body: initialize. Antwort kann SSE sein.
export function mcpPost(url, token, body = { jsonrpc: "2.0", id: 1, method: "initialize" }) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// JSON-RPC tools/call-Body fuer ein MCP-Tool (stateless: kein initialize noetig).
export const toolCall = (name, args = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

// Liest das JSON-RPC-result aus einer /mcp tools/call-Antwort. Der stateless
// StreamableHTTP-Transport antwortet als SSE (text/event-stream): das result steht in
// der data:-Zeile (faellt auf rohes JSON zurueck, falls der Transport doch JSON liefert).
// EINE Quelle fuer Tests, die den Tool-HTTP-Body parsen (heute parst kein anderer Test ihn).
export async function readToolResult(res) {
  const body = await res.text();
  const trimmed = body.trim();
  const raw = trimmed.startsWith("{")
    ? trimmed
    : (body.split(/\r?\n/).find((l) => l.startsWith("data:")) || "").slice("data:".length).trim();
  if (!raw) throw new Error(`Keine JSON-RPC-Daten in der MCP-Antwort:\n${body}`);
  return JSON.parse(raw).result;
}

// Startet src/server.js und ERWARTET einen Boot-Refusal (Exit statt listen). Fuer
// die Fail-closed-Tests (OT-4): liefert { code, output, dataDir }. Wirft, wenn der
// Prozess NICHT innerhalb timeoutMs beendet (d.h. der Boot lief durch). Teilt
// BASE_ENV + tempDataDir mit startServer (G5: keine zweite Spawn-Definition).
export async function startServerExpectExit({
  env = {},
  seed,
  rawStore,
  ownerNumber,
  dataDir: reuseDataDir,
  timeoutMs = 8000,
} = {}) {
  // reuseDataDir (S1-4 Corrupt-Store-Test): laeuft auf einem vorbereiteten dataDir weiter (z.B.
  // korrupt + nicht-schreibbar), statt frisch zu seeden - mirror von startServer.
  const dataDir =
    reuseDataDir || tempDataDir(rawStore ? seed : ensureOwnerNumber(seed, ownerNumber), rawStore);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Server ist NICHT beendet (Boot-Refusal erwartet). Output:\n${output}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output, dataDir });
    });
  });
}

// Startet src/server.js als Kindprozess und liefert Port, gesammeltes stdout
// und einen stop()-Handle. Wirft bei Startproblemen mit dem bisherigen Output.
export async function startServer({
  env = {},
  seed,
  rawStore,
  ownerNumber,
  dataDir: reuseDataDir,
} = {}) {
  // rawStore (Korruptions-Pfad) bleibt verbatim; sonst Owner-Nummer sicherstellen, sonst greift
  // der Boot-Guard (kein Owner-Outbound -> Exit). reuseDataDir (A6/F9-Restart-Tests) laeuft auf dem
  // Store EINES vorherigen Laufs weiter (Prozess-Neustart-Simulation) - kein frisches tempDataDir,
  // kein Seed-Overwrite; die auf Platte persistierte Owner-Nummer traegt den Boot-Guard.
  const dataDir =
    reuseDataDir || tempDataDir(rawStore ? seed : ensureOwnerNumber(seed, ownerNumber), rawStore);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = { text: "" };
  child.stdout.on("data", (d) => (output.text += d.toString()));
  child.stderr.on("data", (d) => (output.text += d.toString()));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server-Start Timeout. Output:\n${output.text}`)),
      STARTUP_TIMEOUT_MS,
    );
    const onData = (d) => {
      const m = output.text.match(/laeuft auf http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(parseInt(m[1], 10));
      }
    };
    child.stdout.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server vorzeitig beendet (code ${code}). Output:\n${output.text}`));
    });
  });

  return {
    port,
    dataDir,
    child,
    localUrl: `http://127.0.0.1:${port}`,
    externalUrl: externalIp() ? `http://${externalIp()}:${port}` : null,
    get stdout() {
      return output.text;
    },
    readStore() {
      return JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
    },
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    },
  };
}
