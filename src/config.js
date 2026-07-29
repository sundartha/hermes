import dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CENTS_PER_EUR, setWorldDefaultLanguageEnabled } from "./store/defaults.js";
// GAP-07: boot-guard.js hat KEINE Imports -> kein Zyklus, obwohl der Boot-Guard sonst
// downstream von config.js sitzt.
import { alertChannelFindings } from "./boot-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Tests laufen mit sauberem Env (wie CI, ohne lokale .env) - verhindert, dass eine
// Entwickler-.env (z.B. Beispiel-OWNER_NUMBER) Test-Annahmen verfaelscht.
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}

// ---- Numerische Env-Validierung (fail-closed, OT-4) ----
// Eine GESETZTE, aber ungueltige numerische Env-Var (NaN/Infinity, teil-numerischer
// Muell wie "120abc" oder ausserhalb des erlaubten Bereichs) darf NICHT still auf
// einen no-op/Teilwert kippen - sonst schaltet
// sich ein Safety-/Kosten-Gate lautlos ab (z.B. ist costEur >= NaN IMMER false ->
// Budget-Guard blockt nie). numEnv() parst UND validiert; Befunde landen in
// fatalConfigErrors[], das assertConfig() zusaetzlich zu den Presence-Checks liest
// -> Boot wird verweigert statt lautlos ohne Gate weiterzulaufen.
const fatalConfigErrors = [];

// Voll-String-Muster fuer numEnv: der GESAMTE (getrimmte) Wert muss eine Zahl sein.
// parseInt/parseFloat kappen einen numerischen Prefix STILL ("120abc" -> 120,
// "8.5abc" -> 8.5) -> ein vertippter Safety-/Kosten-Gate-Env kippt lautlos auf einen
// Teilwert statt Boot zu verweigern (S1-3). Ganzzahl = Vorzeichen + Ziffern (kein
// Dezimalpunkt, sonst waere parseInt("8.5")===8 ein stiller Teilwert); Dezimal
// zusaetzlich ein Nachkommateil. Exponential-/Hex-Notation bewusst NICHT - Config-
// Werte sind schlichte Dezimalzahlen; der Check bleibt laut gegen echten Muell.
const NUM_ENV_INTEGER_PATTERN = /^[+-]?\d+$/;
const NUM_ENV_DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

// Groesster Wert, den Node fuer setTimeout/setInterval als Verzoegerung annimmt
// (32-Bit-signed-Millisekunden). Darueber warnt Node (TimeoutOverflowWarning) und setzt
// die Verzoegerung auf 1 ms - aus einem vertippten "sehr selten" wuerde lautlos ein
// Dauerlauf im Millisekundentakt. Deshalb wird geklemmt statt durchgereicht.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// Sentinel fuer einen Boot ohne Deploy-Metadatum (lokal / fremder Host). Exportiert,
// damit Boot-Banner-, /healthz- und Testcode denselben Wert nutzen (G25/G5).
export const DEPLOYED_COMMIT_UNKNOWN = "unbekannt";

// Leere/abwesende Var -> dokumentierter Default (KEIN Fatal); nur gesetzt-aber-
// ungueltig ist fatal. max ist ein bewusster Clamp (Obergrenze wie maxCallDurationS),
// kein Fehler. Die Diagnose nennt nur Var + Erwartung, NIE einen Wert (numEnv
// betrifft ausschliesslich numerische, nicht-geheime Vars -> kein Secret-Leak).
export function numEnv(name, raw, { fallback, min, max, integer = true } = {}) {
  if (raw === undefined || raw === "") return fallback;
  // .trim() ZUERST: parseInt/parseFloat ignorieren Rand-Whitespace bereits; der
  // Voll-String-Check darf eine gueltige Env mit Trailing-Newline/Spaces NICHT als
  // Muell ablehnen (sonst Boot-Refusal beim naechsten Deploy, PM-4).
  const trimmed = raw.trim();
  const pattern = integer ? NUM_ENV_INTEGER_PATTERN : NUM_ENV_DECIMAL_PATTERN;
  const n = integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
  // pattern.test faengt teil-numerischen Muell ("120abc"); Number.isFinite faengt
  // zusaetzlich einen Ueberlauf gueltiger Ziffernketten auf Infinity.
  if (!pattern.test(trimmed) || !Number.isFinite(n)) {
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

// ---- Boolean-Env-Validierung (fail-closed, P6/S2-1) ----
// Pendant zu numEnv() fuer Schalter-Vars: ein GESETZTER, aber nicht-exakter Boolean-
// Wert ("1"/"yes"/"True") darf NICHT still auf den falschen Default kippen. Bei einem
// Enabling-Flag waere das zufaellig fail-closed, bei OUTBOUND_FROZEN (Kill-Switch,
// Default false) ist es fail-OPEN: der Operator glaubt eingefroren zu haben, Outbound
// laeuft weiter. abwesend/leer -> dokumentierter Default (KEIN Fatal); "true"/"false"
// (nach trim+lowercase) -> Bool; alles andere -> Fatal-Push + Fallback (Boot-Refusal
// statt stillem Flag-Flip). Teilt fatalConfigErrors[] mit numEnv -> assertConfig()
// faellt. Diagnose nennt Var + erwartete Form (Symmetrie zu numEnv); boolEnv wird NUR
// auf Schalter-Vars angewandt, nie auf Secrets -> kein Secret-Leak.
export function boolEnv(name, raw, { fallback }) {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  fatalConfigErrors.push(
    `${name}="${raw}" ist kein gueltiger Boolean (erwartet: "true" oder "false").`,
  );
  return fallback;
}

// Produktions-Erkennung: Render setzt RENDER_EXTERNAL_URL automatisch -> echtes
// oeffentliches Hosting. EINE Quelle des Diskriminators (G5). Call-time gelesen, damit
// productionFootguns/assertConfig denselben Ausdruck treffen, auch wenn ein Test das
// Hosting per process.env simuliert (config-prod-footguns).
function detectProduction() {
  return !!process.env.RENDER_EXTERNAL_URL;
}

// Vorwahlen mit Inlands-Tarif (E.164). BEWUSST eigenstaendig, NICHT an das Land-Gate
// (allowedCountryCodes) gekoppelt: das Gate wird in Phase 4 '*' (weltweit), der Inlands-
// Tarif bleibt auf diesen Vorwahlen. Inland heisst DIESELBE dieser Vorwahlen an Ziel UND
// Absender (P5, Herkunfts-Achse); alles andere -> voiceTariffDefaultCents (Worst-Case).
const VOICE_TARIFF_DOMESTIC_PREFIXES = ["+49", "+33", "+44"];

// tenant-prolif-d: Tag->ms-Bruecke fuer RELEASE_GRACE_DAYS (G25/G35: benannte Konstante,
// eine Quelle). 0 Tage -> 0 ms, damit der Observe-Only-Sentinel erhalten bleibt.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Reine EUR->Cents-Rundung (G26: Money at rest ist Ganzzahl). Eigene, exportierte
// Funktion statt Inline-Ausdruck, DAMIT ein Unit-Test die Float-Falle direkt trifft:
// 0.29 * 100 === 28.999999999999996 in JS (node -e verifiziert) - ohne Math.round
// wuerde platformSpendCapCents lautlos knapp UNTER dem konfigurierten Cap liegen und der
// Test braeuchte sonst den vollen Boot-Spawn-Pfad (P12 F.I.R.S.T: fast/independent).
export function eurToCents(eur) {
  return Math.round(eur * CENTS_PER_EUR);
}

// Voice-Engine-Namen (G25/G11): EINE Quelle statt verstreuter "budget"/"realtime"-Literale
// in config.js, routes/voice.js, telephony/call-lifecycle.js, routes/api-calls.js, boot.js.
export const VOICE_ENGINE = Object.freeze({ BUDGET: "budget", REALTIME: "realtime" });

// PA-11 (S2-trailingslash, G5): EINE Quelle fuer das 7x wiederholte Trailing-Slash-
// Idiom. Entfernt genau EINEN abschliessenden Slash, damit `${base}/pfad` nie zu
// `//pfad` wird (kanonische Basis-URL). Regex NICHT global -> "x//" bleibt "x/" (nur
// der letzte Slash faellt) - Bestandsverhalten von .replace(/\/$/,"") an allen 7 URL-
// Configs. Reine Funktion (kein Nebeneffekt).
export function stripTrailingSlash(url) {
  return url.replace(/\/$/, "");
}

// ---- Wechselkurs USD -> EUR: EIN Kurs, EINE Stellschraube (GAP-08) ----
// Vor P2 trugen die beiden Kosten-Achsen zwei Kurse: der KI-Kostenpfad ein nacktes
// Literal 0,93 (nur per Deploy korrigierbar), die Provider-Achse 920000 Mikro-Einheiten
// = 0,92. Derselbe Dollar ergab je Kostenpfad einen anderen Euro.
//
// Seither speisen sich BEIDE Achsen aus DERSELBEN Umgebungsvariablen
// PROVIDER_TO_BUCKET_RATE_MICRO: die Provider-Achse nimmt sie als Mikro-Ganzzahl (Geld
// nie als Float, G26), die KI-Achse dieselbe Zahl geteilt durch FX_MICRO_PER_UNIT. Eine
// Kurskorrektur im Betrieb setzt damit EINE Variable und bewegt beide Achsen
// zwangslaeufig gemeinsam - ein Auseinanderlaufen zur Laufzeit ist strukturell
// ausgeschlossen (G27: Struktur statt Disziplin), es braucht dafuer keinen Waechter, der
// zwei Zahlen vergleicht.
//
// Warum die numEnv-Auswertung zweimal im Quelltext steht statt einmal in einer
// Konstanten: der Gate-Test test/fx-single-source.test.js liest den QUELLTEXT und
// verlangt woertlich "usdToEur: numEnv(" an der KI-Achse sowie ein nacktes Zahlen-Literal
// am numEnv-Fallback von PROVIDER_TO_BUCKET_RATE_MICRO. Beide Aufrufe tragen deshalb
// dieselbe Variable, denselben Default und dasselbe Minimum. Folge bei ungueltiger Env:
// assertConfig meldet den Befund zweimal - der Boot bricht in jedem Fall ab.
const FX_MICRO_PER_UNIT = 1_000_000;

// Der ausgelieferte Default-Kurs in EUR je USD (Stand 2026-07, ANNAHME - quartalsweise
// von Hand zu pflegen). Die KI-Achse leitet ihren numEnv-Fallback rechnerisch hieraus ab;
// am Provider-Feld steht dieselbe Zahl als Mikro-Ganzzahl (920000), weil der Gate-Test
// dort ein Literal verlangt. Dass beide Schreibweisen denselben Kurs meinen, haelt
// derselbe Gate-Test fest: eine einseitig geaenderte Zahl faellt dort rot.
//
// Object.freeze ist hier unbedenklich (anders als bei modelPricesUsd): nur die ZAHL
// wandert nach rawConfig, das Objekt selbst wird nie ein Blatt des guardedConfig-Proxys.
const EXCHANGE_RATE_DEFAULTS = Object.freeze({
  usdToEur: 0.92,
});

const rawConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  claudeModel: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
  // Ganzzahl-Cents (G26: Geld nie als Fliesskomma) - Env-Name bleibt MAX_BUDGET_EUR
  // (Operator gibt weiter EUR ein), interne Einheit ist Cents wie defaultTenantBudgetCents/
  // hardCapCents (Gate-Schnittmenge, Regel 1 - einheitlicher Typ verhindert Einheiten-Mix).
  //
  // Fallback-Wert 30 (P7, vorher 8): 8 (=800 ct) bestand den eigenen Boot-Guard nicht mehr -
  // die abgeleitete Business-Plan-Decke (900 ct) haette den Plattform-Cap uebersprungen
  // (planCapInertFindings, fatal). 30 ist zugleich der live gefahrene Wert und laesst
  // gleichzeitig Raum fuer defaultTenantBudgetCents=1500 (Klausel A: echt darunter).
  platformSpendCapCents: eurToCents(
    numEnv("MAX_BUDGET_EUR", process.env.MAX_BUDGET_EUR, { fallback: 30, min: 0, integer: false }),
  ),

  // ---- LLM-Resilienz-Seam (P3b-R Schicht 2, src/llm.js) ----
  // Per-Request-Timeout je Anthropic-Versuch (SDK-Default 10 min ist webhook-toedlich:
  // der Provider kappt einen unbeantworteten Webhook nach 15 s hart). Budget-Soll:
  // (llmMaxRetries+1)*timeout + Backoff-Summe < 12 s. Mit Defaults: 3*3500 + 250*(2^2-1)
  // = 11250 ms. GAP-22: dieser Rechenweg ist NICHT das ganze Turn-Budget - im selben
  // Webhook laeuft zusaetzlich die Play-TTS-Vorab-Synthese (elevenLabsPlayTts.
  // synthTimeoutMs) plus Netzreserve. Die vollstaendige Rechnung und der Boot-Waechter
  // stehen in src/turn-budget.js (EINE Quelle, G5) - wer hier einen Wert anhebt, muss
  // dort nachrechnen. AL-P6: aus denselben Werten leitet sich die Wanduhr-Frist des
  // Tool-Loops ab (turnLoopDeadlineMs), die agentTurn vor jeder Runde ab der zweiten
  // prueft - es gibt dafuer bewusst KEINEN eigenen Env-Knopf.
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

  // ---- Pre-Call-Briefing (P8, src/precall-briefing.js) ----
  // Modell des briefenden Aufrufs. MUSS in modelPricesUsd stehen, sonst bucht das
  // Budget-Gate fail-closed zur TEUERSTEN Rate (priceForModel, P7a). Sonnet statt Opus:
  // das Briefing ist eine Struktur-Extraktion aus kurzem Owner-Text.
  briefingModel: process.env.PRECALL_BRIEFING_MODEL || "claude-sonnet-5",
  // Eigener kurzer Per-Request-Timeout: POST /api/calls wartet synchron darauf, BEVOR
  // gewaehlt wird; kein Retry (maxRetries 0) -> das ist die gesamte Wartezeit im
  // schlechtesten Fall. Bewusst NICHT an llmRequestTimeoutMs gekoppelt: dort regiert das
  // 15-s-Provider-Hardcut eines laufenden Turns, hier die Geduld des Aufrufers.
  briefingTimeoutMs: numEnv("PRECALL_BRIEFING_TIMEOUT_MS", process.env.PRECALL_BRIEFING_TIMEOUT_MS, {
    fallback: 6000,
    min: 1,
  }),

  // ---- Vorab-Recherche (AL-P10, src/research/) ----
  // Master-Schalter fuer die Web-Recherche IM Pre-Call-Briefing. DEFAULT AUS
  // (fail-closed): das Such-Werkzeug erscheint gar nicht erst im tools-Array, der
  // Briefing-Aufruf ist byte-identisch zum Bestand, es entsteht keine Gebuehr.
  // Wirkt NUR als Schnittmenge mit dem Per-Tenant-Setting allowResearch
  // (store/defaults.js): "global an" darf nicht heissen, dass das Auftragsmaterial
  // JEDES Tenants an einen Suchindex geht.
  researchEnabled: boolEnv("RESEARCH_ENABLED", process.env.RESEARCH_ENABLED, { fallback: false }),
  // HART 1, bewusst KEINE Env-Var (Praezedenz modelPricesUsd: fester Wert im
  // Namespace). Die Gebuehrenbuchung (researchSearchFeeCents) ist auf genau eine
  // Suche je Briefing kalibriert; eine stille Erhoehung waere ein unsichtbarer
  // Kosten-Hebel am Budget-Gate (Regel 1).
  researchMaxUses: 1,
  // Preis EINER serverseitigen Suche in GANZZAHL Cents auf derselben Achse wie alle
  // anderen Kosten (usage.costCents). Serverseitige Suchen tauchen in
  // input_tokens/output_tokens NICHT auf - ohne diesen Posten waere das Budget-Gate
  // an dieser Stelle blind. Aufrunden ist die etablierte Fehlerrichtung
  // (Ueberbuchung, nie 0). VOR dem Anschalten von RESEARCH_ENABLED gegen die
  // aktuelle Anbieter-Preisliste pruefen - der Fallback ist ein Startwert, kein Beleg.
  researchSearchFeeCents: numEnv("RESEARCH_SEARCH_FEE_CENTS", process.env.RESEARCH_SEARCH_FEE_CENTS, {
    fallback: 1,
    min: 0,
  }),

  // ---- Mess-Instrumentierung (L0, src/metrics.js) ----
  // Master-Schalter fuer PII-freie Latenz-/Loop-/STT-Gap-Logs. DEFAULT AUS
  // (byte-identisch, auch stdout): Konsumenten no-oppen. Zum Live-Messen (Datengrundlage
  // fuer L1) am Host auf "true" setzen - reine Diagnose, beruehrt KEINE Safety-Gates,
  // KEINE Disclosure, KEINE Resilienz-Werte. Tests pinnen das via BASE_ENV.
  metricsEnabled: boolEnv("METRICS_ENABLED", process.env.METRICS_ENABLED, { fallback: false }),

  twilioSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioToken: process.env.TWILIO_AUTH_TOKEN || "",
  // Absendernummern (Twilio/Telnyx) kommen NICHT mehr aus der config: der Owner ist
  // Tenant Null und haelt seine Nummer(n) wie jeder Tenant im Store (s.numbers),
  // einmalig eingetragen via scripts/seed-owner-number.js. Boot-Guard in server.js
  // verlangt fail-closed eine aktive Owner-Nummer.

  // ---- Telnyx (zweiter Provider, P5; alle optional) ----
  telnyxApiKey: process.env.TELNYX_API_KEY || "", // SECRET - nie loggen/leaken
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY || "", // Ed25519-Public-Key des Telnyx-Accounts (verify)
  telnyxApiBase: stripTrailingSlash(process.env.TELNYX_API_BASE || "https://api.telnyx.com"),
  // TeXML-Application/Connection-ID: haelt die Voice-URL beim Provider, Pflicht fuer
  // Telnyx-Outbound (originateCall POST /v2/texml/calls/{connection_id}). Leer ->
  // Telnyx-Outbound wirft (fail-closed), Twilio-Outbound unberuehrt.
  // NICHT verwechseln mit telnyxCallControlAppId (s.u.): Telnyx kennt ZWEI getrennte
  // Objekttypen (TeXML-Application vs. Call-Control-Application) mit eigenen IDs. Die
  // TeXML-ID hier traegt zusaetzlich das Voice-Routing gekaufter Nummern (provisioning-geo).
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
    enabled: boolEnv("ELEVENLABS_PLAY_TTS_ENABLED", process.env.ELEVENLABS_PLAY_TTS_ENABLED, {
      fallback: false,
    }),
    // .trim() gegen manuell eingegebenen Whitespace: ein Trailing-Space in voiceId/model/
    // outputFormat wird von encodeURIComponent zu %20 -> ElevenLabs lehnt mit HTTP 400 ab
    // (live belegt). apiKey getrimmt gegen pasted Newline. Solche Werte tragen NIE legitim
    // umgebenden Whitespace, das Trimmen ist reine Haertung.
    apiKey: (process.env.ELEVENLABS_API_KEY || "").trim(), // SECRET, nie loggen/leaken
    voiceId: (process.env.ELEVENLABS_VOICE_ID || "").trim(),
    model: (process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5").trim(), // Latenz-optimiert
    apiBase: stripTrailingSlash((process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").trim()),
    outputFormat: (process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128").trim(), // Owner-Wahl mp3
    // GAP-22: 4000 sprengte zusammen mit dem LLM-Worst-Case (11250 ms) den 15-s-Hardcut.
    // Der Schnitt liegt bewusst HIER und nicht bei den LLM-Werten: ein Synthese-Timeout
    // faellt fail-safe auf Azure-<Say> zurueck (der Call ueberlebt), ein gekuerzter
    // LLM-Timeout kostet Antworten. 11250 + 2000 + 1500 (Reserve) = 14750 <= 15000.
    synthTimeoutMs: numEnv("ELEVENLABS_SYNTH_TIMEOUT_MS", process.env.ELEVENLABS_SYNTH_TIMEOUT_MS, {
      fallback: 2000,
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
  // C6a (P5): gruppiert (10 zusammengehoerige Keys, Praezedenzfall telnyxElevenLabs) -
  // erste Grouping-Phase hinter dem Config-Proxy-Guard. Zugriff ausschliesslich ueber
  // config.telnyx.telnyxAssistant.<key>; der Proxy wirft laut bei jedem uebersehenen alten
  // flachen Zugriff (config.telnyxAssistantId etc. existiert nicht mehr).
  telnyxAssistant: {
    // Master-Flag fuer den in-house Custom-LLM-Shim (/v1/chat/completions). DEFAULT AUS
    // (fail-closed, Muster PAYMENT_ENABLED): der Endpunkt antwortet 404 bis zum Cutover
    // (Existenz hinter dem Flag -> keine monatelang offene Angriffsflaeche zwischen Merge
    // und Live). Bei Flag aus bleibt der Live-CALL-Pfad (Budget/Realtime-Engine) byte-
    // identisch. Volle 4-Orte-Doku + assertConfig/Footgun-Pflichtcheck: P10.
    enabled: boolEnv("TELNYX_AI_ASSISTANT_ENABLED", process.env.TELNYX_AI_ASSISTANT_ENABLED, {
      fallback: false,
    }),
    // P5: ID des in P7 provisionierten Telnyx-AI-Assistants (ai_assistant_start). Leer ->
    // P4.5 onSpeakEnded skippt fail-safe (Disclosure+Settlement laufen unabhaengig weiter).
    // Bei aktivem Flag ist die ID Boot-Pflicht (assertConfig, P10).
    assistantId: process.env.TELNYX_ASSISTANT_ID || "",
    // ID der Call-Control-Application, ueber die originateViaCallControl (POST /v2/calls)
    // waehlt. EIGENE Var, weil Telnyx hier einen ANDEREN Objekttyp erwartet als TeXML:
    // wird die TeXML-ID (telnyxConnectionId) gesendet, lehnt Telnyx deterministisch ab mit
    // HTTP 422 "10015 Invalid value for connection_id (Call Control App ID)" - der Live-Bug
    // vom 2026-07-10 (RCA: tasks/rca-place-call-422.md). Bei aktivem Flag Boot-Pflicht.
    callControlAppId: process.env.TELNYX_CALL_CONTROL_APP_ID || "",
    // P5: max. Shim-Turns pro callId und Minute (Toll-/Token-Fraud-Bremse VOR agentTurn,
    // zusaetzlich zum IP-Limiter aus rateLimitPerMin + dem Budget-Cap). Das Zeitfenster
    // selbst ist eine Modul-Konstante im Shim (Muster middleware RATE_WINDOW_MS). Ein zu
    // hoher Wert im Hosting bei aktivem Flag ist ein Footgun (productionFootguns, P10).
    shimMaxTurnsPerMin: numEnv(
      "TELNYX_SHIM_MAX_TURNS_PER_MIN",
      process.env.TELNYX_SHIM_MAX_TURNS_PER_MIN,
      { fallback: 30, min: 1 },
    ),
    // stab-p9 (Kosten-Notaus, PLAN-STABILIZE-LAUNCH.md P9): Dead-Air-Watchdog. Sekunden OHNE
    // weiteres Lebenszeichen (Shim-Turn) nach ai_assistant_start, ab denen der Call als stille
    // TTS-Fehlfunktion gilt und KONTROLLIERT beendet wird. KONSERVATIV: deutlich ueber einer
    // normalen Denk-/Sprechpause -> Normalfluss terminiert NIE (scharfe Kalibrierung aus P4/P5).
    // Sinnvoll nur < maxCallDurationS, sonst greift ohnehin erst der harte Dauer-Cap. Nur im
    // Assistant-Pfad wirksam (Flag aus -> nie armiert). Min 5, max 300 (= Cap-Ceiling).
    deadAirTimeoutS: numEnv("TELNYX_DEAD_AIR_TIMEOUT_S", process.env.TELNYX_DEAD_AIR_TIMEOUT_S, {
      fallback: 45,
      min: 5,
      max: 300,
    }),
    // Befund 2 (PLAN-TELNYX-AI-ASSISTANT-NO-AUDIO.md): Telnyx' Speak-Command kann verstummen,
    // OHNE je ein call.speak.started/ended/failed zu emittieren (Live-Test Call 2/3, 2026-07-14).
    // Ohne Terminal-Event haengt der Opening-Speak-Node bis zum manuellen Hangup in Stille. Dieser
    // Timeout behandelt ein fehlendes Terminal-Event nach N Sekunden wie ein call.speak.failed
    // (Azure-Retry falls Assistant-Config frei, sonst Fail-Safe = kein Assistant-Start). 45s: reale
    // Sprechdauer Call 1 (command->speak.ended) war 16.57s -> 45s laesst Spielraum fuer laengere
    // Anliegen-Saetze + Netz-Jitter, ohne bei einem echten Stall endlos zu warten. min 10 / max 120
    // via numEnv (Wert < 10 -> Boot-Refusal ueber fatalConfigErrors, > 120 -> Clamp): 0 oder absurd
    // hoch wuerde den Guard sonst lautlos inert schalten (P9-CFG1-Footgun, analog deadAirTimeoutS).
    openingSpeakTimeoutS: numEnv(
      "TELNYX_OPENING_SPEAK_TIMEOUT_S",
      process.env.TELNYX_OPENING_SPEAK_TIMEOUT_S,
      { fallback: 45, min: 10, max: 120 },
    ),
    // stab-p9 (b): Per-Conversation-Loop-Guard. Max. KONSEKUTIVE nicht-substanzielle
    // (leere/Echo-)Shim-Turns, bevor der Call kontrolliert beendet wird - ZUSAETZLICH zum
    // per-Minute-Rate-Limiter (shimMaxTurnsPerMin) und zum Budget-Cap. Substanz = dieselbe
    // Definition wie stab-p7 (callerSubstanceMinLen). Ein substanzieller Turn setzt den Zaehler
    // zurueck -> Normalfluss loest NIE aus. Hoeher als maxEmptyTurns (der weichere end_call-Guard),
    // damit die weicheren Mechanismen zuerst greifen. Min 3, max 50 (Muster deadAirTimeoutS):
    // ohne Obergrenze wuerde ein im Hosting versehentlich absurd hoher Wert (z.B. 999999) diesen
    // Kosten-Notaus lautlos inert schalten (Review-Befund P9-CFG1) - der Clamp verhindert das
    // unabhaengig vom gesetzten Wert, ganz ohne eigenen Footgun-Boot-Check.
    loopGuardMaxEmptyTurns: numEnv(
      "TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS",
      process.env.TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS,
      { fallback: 8, min: 3, max: 50 },
    ),
    // E2: statisches Telnyx-Integration-Secret, das der Shim als Bearer erwartet (Server
    // liest es zur Bearer-Pruefung). SECRET - nie loggen/leaken. Bei aktivem Flag Boot-
    // Pflicht (assertConfig), sonst kann der Shim NIE authentifizieren (fail-closed).
    shimSharedSecret: process.env.TELNYX_SHIM_SHARED_SECRET || "",
    // E3: NAME des Telnyx-Integration-Secrets, das denselben WERT haelt (external_llm.
    // llm_api_key_ref). NUR das Provisioning-Skript liest ihn; der Server nie -> KEIN
    // assertConfig-Check (nur REQUIRED-Gate im Skript). Analog telnyxElevenLabs.apiKeyRef.
    shimApiKeyRef: process.env.TELNYX_SHIM_API_KEY_REF || "",
    // OBS-FLAG (Diagnose): einmaliger, default-off Shape-Dump im Shim. Flag AN -> der Shim
    // loggt pro authentifiziertem Turn EINE keys-only-Zeile (Top-Level-Feldnamen des
    // forward_metadata-Body + zwei Booleans, WELCHE Position die call_control_id traegt),
    // NIE Werte. Nur fuer den EINEN ueberwachten Diagnose-Call; danach wieder AUS. Neutraler
    // Default, NICHT boot-required (kein assertConfig/Footgun), keine Verhaltensaenderung am Gate.
    shimDebugShape: boolEnv("TELNYX_SHIM_DEBUG_SHAPE", process.env.TELNYX_SHIM_DEBUG_SHAPE, {
      fallback: false,
    }),
  },

  // ---- Payment/Billing (Stripe Hold/Capture, P6b1; alle optional) ----
  // Master-Flag: Geld halten -> erst dann provisionieren -> capturen -> aktivieren.
  // DEFAULT AUS (fail-closed): die Onboard-Route reicht KEINEN Billing-Client herein
  // -> kein Hold/Capture, requested->provisioning->active wie bisher (byte-identisch).
  paymentEnabled: boolEnv("PAYMENT_ENABLED", process.env.PAYMENT_ENABLED, { fallback: false }),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "", // SECRET - nie loggen/leaken
  stripeApiBase: stripTrailingSlash(process.env.STRIPE_API_BASE || "https://api.stripe.com"),
  // Einmalige Setup-Gebuehr pro Nummer in GANZZAHL Cents (Geld nie als Float, G26).
  // Bei PAYMENT_ENABLED Pflicht > 0 (assertConfig); 0 = kein Magic-Default.
  numberSetupFeeCents: numEnv("NUMBER_SETUP_FEE_CENTS", process.env.NUMBER_SETUP_FEE_CENTS, {
    fallback: 0,
    min: 0,
  }),
  paymentCurrency: (process.env.PAYMENT_CURRENCY || "eur").toLowerCase(),
  // Waehrung, in der der Telefonie-Provider seine Detail-Records ausweist (ISO-4217,
  // Grossschreibung). Default USD - in allen 293 Records der Messung vom 2026-07-20 war
  // currency="USD". NICHT dasselbe wie paymentCurrency (das ist die Kundenwaehrung des
  // Stripe-Hold): USD und EUR duerfen sich auf dem Geld-Pfad nie vermischen (D5).
  // Wirkung in P1: ein Record mit ABWEICHENDER Waehrung wird VERWORFEN, nie umgerechnet.
  // Die USD/EUR-Umrechnung entscheidet P2, nicht dieses Feld.
  providerCurrency: (process.env.PROVIDER_CURRENCY || "USD").toUpperCase(),
  // Umrechnungskurs Provider-Waehrung -> Ziel-Bucket, als GANZZAHL in Mikro-Einheiten
  // (G26, Geld nie als Float): wie viele Mikro-Einheiten EUR-Cent auf eine Mikro-Einheit
  // USD-Cent entfallen. Default 920000 = 0,92 EUR je USD - dieselbe Zahl wie
  // EXCHANGE_RATE_DEFAULTS.usdToEur, nur in Mikro-Ganzzahl-Darstellung (GAP-08: EIN Kurs
  // fuer beide Kosten-Achsen). Diese Variable ist seit P2 die EINZIGE Stellschraube des
  // Kurses: die KI-Kosten-Achse (llm.usdToEur) liest dieselbe Variable.
  //
  // In P2/P3 hat der Kurs KEINEN Verbraucher - er wird hier eingefuehrt, weil ein Guard,
  // der zwei Phasen spaeter scharf wird, zwei Phasen lang keine Sicherung ist. Ab P4
  // bewegt er Geld: waere er um Zehnerpotenzen zu klein, laege das Ist fuer JEDEN Call bei
  // ~1 % der Schaetzung, bei formal vollstaendiger Datenlage - die faktische
  // Vollrueckerstattung jeder Schaetzung.
  //
  // min: 1 (strikt > 0) statt eines fallback:0 - "nicht gesetzt" darf hier nie faktisch
  // "keine Kosten" bedeuten. min faengt aber NUR die 0: der naheliegende Vertipper
  // PROVIDER_TO_BUCKET_RATE_MICRO=920 (weil 0,92 die kommunizierte Groesse ist) laeuft
  // anstandslos durch. Ihn faengt der Toleranzband-Guard in src/boot-guard.js.
  providerToBucketRateMicro: numEnv("PROVIDER_TO_BUCKET_RATE_MICRO", process.env.PROVIDER_TO_BUCKET_RATE_MICRO, {
    fallback: 920000,
    min: 1,
  }),
  // ---- Kosten-Abgleich im Beobachtungsmodus (LCT P3) ----
  // Aufschub, bevor ein beendeter Call abgeglichen wird. KONFIGURATION, keine
  // Code-Konstante. Seit KE-P6B GEMESSEN statt geraten: der Testanruf vom 2026-07-21
  // (PLAN-KOSTEN-ENDSPIEL.md F3) hatte spaetestens 133 s nach Gespraechsende alle Belege
  // vollstaendig UND wertrichtig - 30 min sind der 13-fache Sicherheitsabstand. Der
  // Abstand deckt zusaetzlich die Laufzeit EINES Sweeps ab: 6 zuordenbare Typen x
  // hoechstens 10 Seiten = 60 Anfragen, bei 30 Anfragen je fixer UTC-Minute (Drossel
  // KE-P4) also hoechstens 2 min Versatz zwischen erstem und letztem Typ.
  costTruingDelayMinutes: numEnv("COST_TRUING_DELAY_MINUTES", process.env.COST_TRUING_DELAY_MINUTES, { fallback: 30, min: 0 }),
  // Kadenz des Abgleich-Sweeps. Bis KE-P6B eine hartkodierte Modul-Konstante in
  // billing/cost-truing.js (6 h); jetzt EINE Quelle, und zwar hier - der Wert bestimmt,
  // wie lange die Ueberreservierung eines Anrufs im Topf steht, und ist damit ein
  // Betriebsknopf (G35), kein Implementierungsdetail. boot.js registriert das Intervall.
  // min: eine Kadenz unter einer Minute kann nicht einmal EIN Kontingentfenster des
  // Providers ausschoepfen (gemessen 40 Anfragen je fixer UTC-Minute) und braennte
  // stattdessen den PERSISTIERTEN Versuchszaehler jedes Kandidaten binnen Minuten ab -
  // die Calls waeren danach dauerhaft 'unavailable' und nie wieder Kandidat.
  // max: ueber MAX_TIMER_DELAY_MS faellt Nodes Timer lautlos auf 1 ms zurueck.
  costTruingSweepIntervalMs: numEnv("COST_TRUING_SWEEP_INTERVAL_MS", process.env.COST_TRUING_SWEEP_INTERVAL_MS, {
    fallback: 60 * 60 * 1000,
    min: 60 * 1000,
    max: MAX_TIMER_DELAY_MS,
  }),
  // Obergrenze der Abgleich-Versuche je Call (gezaehlt im PERSISTIERTEN
  // costTruingAttempts). Danach gilt der Call als abgeschlossen + 'unavailable', damit
  // der Job nicht ewig gegen tote Calls laeuft. min 1 - 0 hiesse "nie abgleichen".
  costTruingMaxAttempts: numEnv("COST_TRUING_MAX_ATTEMPTS", process.env.COST_TRUING_MAX_ATTEMPTS, { fallback: 5, min: 1 }),
  // Pflicht-Menge der record_types, die ein GESUNDER Call zeigen muss. CODE-DEFAULT IST
  // DIE LEERE MENGE, und leer bedeutet 'incomplete' - nicht "alles erlaubt", sondern
  // "nichts bewiesen". BEWUSST KEIN geratener Nicht-leer-Default: ein vorbelegtes
  // ['call-control'] saehe nach Vollstaendigkeit aus und liesse ab P4 Rueckerstattungen
  // auf genau der duennen Datenlage zu, gegen die P4 argumentiert. Die Menge wird
  // gesetzt, wenn sie am Live-Beleg gemessen ist (Kandidaten aus der Messung vom
  // 2026-07-20: sip-trunking, call-control, speech-to-text, text-to-speech, recording,
  // inference, ai-voice-assistant - "call" existiert NICHT).
  costTruingRequiredRecordTypes: (process.env.COST_TRUING_REQUIRED_RECORD_TYPES || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  // Vorbedingung des Flips (P4/P4b lesen DIESELBE Schwelle, bewusst keine zweite):
  // Mindest-Deckungsquote in Prozent. Wird sie unterschritten, meldet jeder Sweep den
  // Befund coverage_below_threshold. Die Schwelle wird NIE gesenkt, um die Vorbedingung
  // zu erfuellen - das waere die Sicherung an ihre eigene Verletzung angepasst.
  costTruingMinCoveragePercent: numEnv("COST_TRUING_MIN_COVERAGE_PERCENT", process.env.COST_TRUING_MIN_COVERAGE_PERCENT, { fallback: 80, min: 0, max: 100 }),
  // Stillstands-Grenze: so viele aufeinanderfolgende Sweeps unter der Schwelle ->
  // Eskalation + Owner-Entscheidung (Ursache beheben oder Abbruch nach P3/P5).
  // 8 x 1 h Kadenz (COST_TRUING_SWEEP_INTERVAL_MS) = rund 8 h statt frueher zwei Tage.
  costTruingCoverageStallSweeps: numEnv("COST_TRUING_COVERAGE_STALL_SWEEPS", process.env.COST_TRUING_COVERAGE_STALL_SWEEPS, { fallback: 8, min: 1 }),
  // Ab welcher relativen Abweichung Ist/Schaetzung eine WARN-Zeile faellt (D2).
  costDriftWarnPercent: numEnv("COST_DRIFT_WARN_PERCENT", process.env.COST_DRIFT_WARN_PERCENT, { fallback: 50, min: 0 }),
  // Entprellfenster je Befund-Code (Default 24 h). Ohne sie meldete der Sweep denselben
  // Befund in JEDER Kadenz erneut (bei der KE-P6B-Kadenz von 1 h 24-mal am Tag) und
  // trainierte den Kanal taub. P5 nutzt dasselbe Feld.
  costAlertDebounceMs: numEnv("COST_ALERT_DEBOUNCE_MS", process.env.COST_ALERT_DEBOUNCE_MS, { fallback: 24 * 60 * 60 * 1000, min: 0 }),
  // ---- Drift-Waechter (LCT P5, misst - justiert NICHT) ----
  // Mindest-Stichprobe je Praefix; darunter gibt es KEINE Tarif-Aussage und KEINEN
  // Alarm, aber den sichtbaren Befund 'insufficient_samples' samt Zahl. Ein Wert oberhalb
  // von DRIFT_SAMPLE_WINDOW (100, src/billing/cost-calibration.js) friert den Waechter
  // dauerhaft auf 'insufficient_samples' ein - das ist laut, nicht still (die Meldung
  // nennt Fenster und Stichprobenzahl), aber es ist eine Fehlkonfiguration.
  costCalibrationMinSamples: numEnv("COST_CALIBRATION_MIN_SAMPLES", process.env.COST_CALIBRATION_MIN_SAMPLES, {
    fallback: 20,
    min: 1,
  }),
  // ---- Outbound-Kosten-Achse / Vorab-Reservierung (outbound-p1c, D1) ----
  // Voice-Minuten-Tarif (GANZZAHL Cents/min, G26). EINE Kosten-Quelle (G5): speist die
  // Vorab-Reservierung (Worst-Case vor dem Dial), den Budget-Reconcile (Ist bei Call-Ende)
  // UND den Stripe-Voice-Meter (recordVoiceMinuteMeter) - loest das fruehere
  // voiceMinuteCostCents auf. Inland = DIESELBE dieser Vorwahlen (voiceTariffDomesticPrefixes)
  // an Ziel UND Absender; alles andere Worst-Case-Default. Konservativ gesetzt; live mit
  // dem Provider-Tarif abgleichen.
  voiceTariffDomesticCents: numEnv("VOICE_TARIFF_DOMESTIC_CENTS", process.env.VOICE_TARIFF_DOMESTIC_CENTS, {
    fallback: 20,
    min: 0,
  }),
  voiceTariffDefaultCents: numEnv("VOICE_TARIFF_DEFAULT_CENTS", process.env.VOICE_TARIFF_DEFAULT_CENTS, {
    fallback: 300,
    min: 0,
  }),
  // LCT P4b (Vollkosten-Boot-Guard): Untergrenze, unter die VOICE_TARIFF_DOMESTIC_CENTS
  // nicht sinken darf, ohne dass ein Boot-Guard (WARN) anschlaegt, solange die
  // Abgleich-Deckung duenn ist. GANZZAHL EUR-Cent (wie der Tarif). Herleitung ueber die
  // teuerste AKTIVIERBARE Konfiguration, Kurs 0,92 (USD-ct -> EUR-ct, Kap.-2.1-Regel):
  //
  //   Zustand Assistant-Pfad                   | Schwelle | Herleitung
  //   im Code UND per Env (TELNYX_AI_ASSISTANT_ENABLED) aktivierbar | 10 | 10,4 USD-ct x 0,92 = 9,568 -> aufgerundet
  //   nach VOLLZOGENEM Rueckbau aus voice.js + config.js           |  5 |  5,4 USD-ct x 0,92 = 4,968 -> aufgerundet
  //
  // AUSLOESER fuer den Wechsel auf 5 ist der GEMERGTE Rueckbau (ein grep, der
  // startAssistant / ai_assistant_start nicht mehr findet), NICHT die Absicht. Solange der
  // Pfad im Code steht, gilt 10 - eine Absichtserklaerung entfernt keinen Code-Pfad. Default 10.
  // min:0 ist die test-neutrale Abschaltung (wie VOICE_TARIFF_DOMESTIC_CENTS=0 in der Suite):
  // unset faellt auf 10 (armiert) zurueck; 0 deaktiviert den WARN bewusst und sichtbar (er ist
  // eine Diagnose, kein Geld-Gate - kein per-Default abgeschaltetes Safety-Gate).
  voiceTariffFullCostFloorCents: numEnv(
    "VOICE_TARIFF_FULL_COST_FLOOR_CENTS",
    process.env.VOICE_TARIFF_FULL_COST_FLOOR_CENTS,
    { fallback: 10, min: 0 },
  ),
  voiceTariffDomesticPrefixes: VOICE_TARIFF_DOMESTIC_PREFIXES,
  // LCT P6: Deckel-Basissatz je Voice-Minute (GANZZAHL EUR-Cent, G26) fuer die Ableitung
  // der Tenant-Decke aus dem Plan (billing/plan-caps.js). AUSDRUECKLICH NICHT der gemessene
  // 5,4 (USD-ct) und NICHT P5s Live-Kalibrierung - die auf die naechste Ganzzahl
  // aufgerundeten 5,4: eine Decke soll nach oben irren. Vom Menschen gesetzt, nicht
  // selbstjustierend (PM-1). Ergibt mit Kopffreiheit 5/3 bzw. 5/4 exakt 300 / 900 ct.
  voiceCapRateCentsPerMin: numEnv("VOICE_CAP_RATE_CENTS_PER_MIN", process.env.VOICE_CAP_RATE_CENTS_PER_MIN, {
    fallback: 6,
    min: 1, // 0 waere eine 0-Decke fuer jeden Abschluss (0-Cap-Tenant) - fail-closed verboten
  }),
  // Per-Tenant Default-Kostendecke (GANZZAHL Cents, G26). ZWEI Wirkungen (P2a/D3):
  // (1) Seed beim Registrieren -> explizite tenant_budget-Zeile (seedTenantDefaultBudget),
  // (2) Gate-Fallback in effectiveCapCents fuer jeden Tenant OHNE Zeile - dadurch nimmt der
  // Wert auch den Bestand aus dem geteilten globalen Pool, nicht nur Neuzugaenge.
  // 0 = Sentinel "kein Default": kein Seed UND kein Gate-Fallback, der Tenant faellt wie
  // im Bestand auf den globalen Cap. Ein 0-Wert darf NIE als 0-Cap interpretiert werden -
  // das wuerde jeden Outbound, jeden kostenlosen Inbound und jeden laufenden Call sperren.
  // Globaler Backstop (platformSpendCapCents) bleibt PARALLEL (Schnittmenge, Regel 1).
  //
  // Fallback-Wert 1500 (P7, vorher 600): Zwei Schranken gleichzeitig, beide vom eigenen
  // Boot-Guard erzwungen (spendCapCoherence):
  //   Klausel A - echt KLEINER als der Fallback von platformSpendCapCents
  //               (eurToCents(30)=3000), sonst waere die Tenant-Achse inert.
  //   Klausel B - mindestens VOICE_TARIFF_DEFAULT_CENTS * ceil(MAX_CALL_DURATION_CAP_S/60)
  //               = 300 * 5 = 1500, sonst ist der teuerste Zielverkehr unter dieser Decke
  //               unbezahlbar und JEDES Ziel ohne gemessenen Inlandssatz faellt schon vor
  //               dem Dial ins Reserve-Gate (402). Seit P7 ist dieser Befund FATAL.
  // Der Tarif wird dafuer NICHT gesenkt (Owner-Entscheidung O6) - der Tarif ist die
  // Messgroesse des Gates. Dieselbe Zahl steht an drei Stellen: hier, .env.example und
  // render.yaml; test/env-docs-spend-cap-coherence.test.js prueft alle drei gegen den Guard.
  defaultTenantBudgetCents: numEnv("DEFAULT_TENANT_BUDGET_CENTS", process.env.DEFAULT_TENANT_BUDGET_CENTS, {
    fallback: 1500,
    min: 0,
  }),
  // Grober Kostenbeleg pro gesendeter Summary-SMS in GANZZAHL Cents (G26), F2 P8. Jede
  // erfolgreich gesendete Summary-SMS erzeugt ein USAGE_EVENT_KIND.SMS-Event mit diesem
  // Betrag (Ledger-Quelle fuer Billing + Tages-Cap-Zaehler). 0 = Menge ohne Kostenbeleg;
  // Live mit dem Provider-SMS-Tarif abgleichen.
  smsCostCents: numEnv("SMS_COST_CENTS", process.env.SMS_COST_CENTS, { fallback: 0, min: 0 }),
  // ---- Plattform-Fruehwarnung (Budget-Achsen P6) ----
  // Anteil von platformSpendCapCents, ab dem GENAU EIN Audit-Ereignis pro Spend-Monat
  // feuert - BEVOR der Notaus blockt. Ganzzahl 0-100. 0 = Warnung AUS, byte-identisch
  // zum Bestand. AENDERT KEINE Gate-Entscheidung (Vorbedingung fuer P7).
  platformSpendWarnPercent: numEnv(
    "PLATFORM_SPEND_WARN_PERCENT",
    process.env.PLATFORM_SPEND_WARN_PERCENT,
    { fallback: 80, min: 0, max: 100 },
  ),
  // Betreiber-Nummer (E.164) fuer die zusaetzliche Warn-SMS. LEER = KEINE SMS, nur Audit.
  // Eigene Env, weil das Owner-Konzept aus dem Code entfernt ist (Admin laeuft ueber
  // account.role) - es gibt KEINE natuerliche Zielnummer fuer eine PLATTFORM-Groesse. NIE
  // die private Nummer eines Tenants: das waere eine Betreiber-Zahl an einen Kunden.
  platformAlertSmsTo: process.env.PLATFORM_ALERT_SMS_TO || "",
  // ---- Spend-Monat-Flip (Budget-Achsen P7) ----
  // AN = BEIDE Gate-Achsen (Tenant UND Plattform) messen den Verbrauch im UTC-Kalendermonat
  // statt im Lebenszeit-Zaehler. AUS (Default) = byte-identisch zum Bestand. Der Flip ist ein
  // bewusster Betreiber-Akt NACH einem Live-Beleg, dass spendMonthKey einen Neustart
  // ueberlebt; der Rollback ist ein Env-Flip OHNE Deploy (Free-Tier-Host ohne Shell).
  budgetMonthEnabled: boolEnv("BUDGET_MONTH_ENABLED", process.env.BUDGET_MONTH_ENABLED, {
    fallback: false,
  }),
  // ---- Fixkosten sichtbar machen (LCT P7) ----
  // Listenpreis, NICHT Rechnungsposten - reine Anzeige, NIE ein Gate (Entscheidung 6,
  // PLAN-LIVE-COST-TRACING). EUR-Cent: USD-Betraege sind vorab mit 0,92 umgerechnet, USD
  // und EUR werden hier NIE vermischt.
  //
  // ElevenLabs-Zeichenkontingent des Starter-Tarifs (Play-TTS-Wand, D7). 39981 = das heute
  // belegte Kontingent.
  ttsCharacterQuota: numEnv("TTS_CHARACTER_QUOTA", process.env.TTS_CHARACTER_QUOTA, {
    fallback: 39981,
    min: 1,
  }),
  // Anteil des Kontingents, ab dem GENAU EIN Alarm pro Zyklus feuert (Muster
  // platformSpendWarnPercent). Ganzzahl 0-100; 0 = Warnung AUS.
  ttsCharacterQuotaWarnPercent: numEnv(
    "TTS_CHARACTER_QUOTA_WARN_PERCENT",
    process.env.TTS_CHARACTER_QUOTA_WARN_PERCENT,
    { fallback: 75, min: 0, max: 100 },
  ),
  // Tag im Monat, an dem der ElevenLabs-Abrechnungszyklus zurueckgesetzt wird (belegt: der
  // 3.) - AUSDRUECKLICH NICHT der Kalendermonatserste (ttsCycleKeyOf, state-ops.js). Als
  // benannter, konfigurierbarer Wert statt vergrabenem Literal (G25/G35). 1-28: jenseits
  // von 28 wuerde der Anker im Februar nie erreicht (kuerzester Monat).
  ttsQuotaCycleAnchorDay: numEnv("TTS_QUOTA_CYCLE_ANCHOR_DAY", process.env.TTS_QUOTA_CYCLE_ANCHOR_DAY, {
    fallback: 3,
    min: 1,
    max: 28,
  }),
  // ElevenLabs-Fixkosten in GANZZAHL EUR-Cent (belegt: 6,00 USD/Monat -> 600 EUR-Cent).
  platformFixedCostCentsPerMonth: numEnv(
    "PLATFORM_FIXED_COST_CENTS_PER_MONTH",
    process.env.PLATFORM_FIXED_COST_CENTS_PER_MONTH,
    { fallback: 600, min: 0 },
  ),
  // DID-Listenmiete je Nummer in GANZZAHL EUR-Cent (1,00 USD x 0,92 -> 92 EUR-Cent).
  numberMonthlyCostCents: numEnv("NUMBER_MONTHLY_COST_CENTS", process.env.NUMBER_MONTHLY_COST_CENTS, {
    fallback: 92,
    min: 0,
  }),
  // ---- Abo-Buchung (Stripe Recurring, W4) ----
  // Stripe-Price-Ids (recurring monatlich, EUR) je Tier. Leer = Tier nicht buchbar
  // (priceIdForPlan -> null -> Route 500, KEIN Boot-Stop). Opake price_-Referenzen,
  // KEINE Secrets.
  stripeStarterPriceId: process.env.STRIPE_STARTER_PRICE_ID || "",
  stripeBusinessPriceId: process.env.STRIPE_BUSINESS_PRICE_ID || "",
  // Stripe-Webhook-Signing-Secret (whsec_...). SECRET - nie loggen/leaken. Leer +
  // PAYMENT_ENABLED -> assertConfig Boot-Refusal (Webhook fail-closed unverifizierbar).
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  // Self-Heal (Fix B, PLAN-CHECKOUT-STALE-STRIPE-CUSTOMER.md): Wartezeit (ms) vor dem
  // EINEN Checkout-Retry nach Stripe resource_missing auf den Customer - ueberbrueckt
  // die live beobachtete Sichtbarkeits-Verzoegerung zwischen createCustomer und dem
  // naechsten API-Call (Nachtrag 3). 0 = sofortiger Retry.
  stripeCustomerRetryDelayMs: numEnv(
    "STRIPE_CUSTOMER_RETRY_DELAY_MS",
    process.env.STRIPE_CUSTOMER_RETRY_DELAY_MS,
    { fallback: 2000, min: 0 },
  ),

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

  // GAP-38: Bootstrap-Parameter des Deploys (frueher nur vom preDeploy-Kommando gelesen,
  // das Render auf plan:free nie ausfuehrt). Der Boot heilt damit einen NACHWEISLICH
  // frischen Store in-prozess. Leer = keine Heilung (Boot bleibt fail-closed).
  // Backend-agnostisch, anders als OWNER_NUMBER_SEED (json-only, nur Nummer ohne Tenant).
  bootstrapE164: process.env.BOOTSTRAP_E164 || "",
  bootstrapProvider: process.env.BOOTSTRAP_PROVIDER || "",

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
  publicUrl: stripTrailingSlash(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ""),
  // Import-Zeit-Snapshot der Produktions-Erkennung fuer Laufzeit-Konsumenten (z.B. der
  // /mcp-Auth-Bypass-Gate in auth.js). productionFootguns/assertConfig nutzen denselben
  // Begriff call-time ueber detectProduction() (injizierbarer Test-Seam).
  isProduction: detectProduction(),
  // GAP-36 (Deploy-Wahrheit): Render injiziert RENDER_GIT_COMMIT beim Build. KEIN
  // Betreiber-Knopf - ein Deploy-Metadatum, das hier liegt, weil jede Env-Var im Repo
  // ueber config.js laeuft (Konvention) und weil boot.js UND /healthz denselben Wert
  // brauchen (EINE Quelle, G5). Ungesetzt (lokal) -> Sentinel statt leerem String:
  // "unbekannt" ist eine ehrliche Antwort, "" saehe im Smoke wie ein Feldfehler aus.
  deployedCommit: process.env.RENDER_GIT_COMMIT || DEPLOYED_COMMIT_UNKNOWN,
  // Passwort-Schutz fuer Dashboard + API im oeffentlichen Hosting (User: admin). Leer = offen (nur lokal ok).
  dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
  sendSmsSummary: boolEnv("SEND_SMS_SUMMARY", process.env.SEND_SMS_SUMMARY, { fallback: true }),
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
  outboundFrozen: boolEnv("OUTBOUND_FROZEN", process.env.OUTBOUND_FROZEN, { fallback: false }),
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
    fallback: MS_PER_DAY,
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
  provisioningEnabled: boolEnv("PROVISIONING_ENABLED", process.env.PROVISIONING_ENABLED, {
    fallback: false,
  }),
  // PROV-01 Crash-Recovery (F4/F5): maximales Job-Alter (ms), bis zu dem der Boot-
  // Reconciler eine in 'requested' haengende Nummer AUTOMATISCH nachfuehren darf.
  // 0 (Default) = Observe-Only fail-closed: KEIN Auto-Nachkauf, haengende Jobs werden
  // nur sichtbar gemacht. MUSS strikt KLEINER bleiben als das kleinste Anbieter-
  // Idempotenz-Fenster (Stripe-Hold = 24h), sonst droht Doppelkauf; scharf empfohlen
  // 3600000 (1h). Erst nach gruenem Telnyx-Idempotenz-Smoke > 0 scharfschalten.
  provisioningRedriveMaxAgeMs: numEnv(
    "PROVISIONING_REDRIVE_MAX_AGE_MS",
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS,
    // S1-3: strikt < 24h (kleinstes Anbieter-Idempotenzfenster, Stripe-Hold) erzwingen - ein zu
    // grosser Wert oeffnet den Doppelkauf-Pfad. Clamp (kein Boot-Refusal, Schwester-Muster wie
    // maxCallDurationS): numEnv klemmt n>max auf max.
    { fallback: 0, min: 0, max: MS_PER_DAY - 1 },
  ),
  // tenant-prolif-d: Grace-Periode (TAGE) bis zum automatischen DID-Release eines
  // suspendierten Tenants. 0 (Default) = Observe-Only fail-closed: der Reconcile gibt
  // NICHTS frei, loggt nur Kandidaten. Erst > 0 schaltet echte Telnyx-DELETEs scharf
  // (Analogie PROVISIONING_REDRIVE_MAX_AGE_MS=0). Ein Fehl-Release ist Rufnummern-Verlust
  // fuer einen zahlenden Kunden -> konservativ (mehrere Tage) waehlen. Intern in ms
  // (MS_PER_DAY); Klassifizierer/Executor arbeiten zeit-injiziert in ms.
  releaseGraceMs:
    numEnv("RELEASE_GRACE_DAYS", process.env.RELEASE_GRACE_DAYS, { fallback: 0, min: 0 }) *
    MS_PER_DAY,
  // Multi-Tenant-Identitaets-/Laufzeit-Schicht (I4-I7). DEFAULT AUS (fail-closed):
  // requestTenant === BOOTSTRAP_TENANT_ID -> Owner byte-identisch, kein Tenant-Scoping.
  // Erst true (nach allen dichten Scope-Gates I5/I6/I7) loest die Auth-Achse den
  // Request-Tenant auf. EIN gemeinsames Flag fuer I4-I7 (kein separates Login-Flag;
  // Self-Service kommt spaeter unter eigenem Reife-Flag).
  multiTenant: boolEnv("MULTI_TENANT", process.env.MULTI_TENANT, { fallback: false }),
  // Rich-UI ui://-Resource fuer faehige MCP-Hosts (P1-W3). DEFAULT AN (Produkt-Default):
  // der Rich-UI-Pfad ist aktiv. Bleibt fail-closed gehedged - ein Host bekommt das Widget
  // NUR, wenn er die Capability deklariert; sonst weiter nur Text/structuredContent. Mit
  // MCP_UI_ENABLED=false explizit abschaltbar (Tests pinnen das via BASE_ENV).
  mcpUiEnabled: boolEnv("MCP_UI_ENABLED", process.env.MCP_UI_ENABLED, { fallback: true }),
  // Strukturierter Per-Call-Kontext (PLAN-PERSONAL-ASSISTANT P3): optionales context-
  // Objekt an place_call -> kompakte HINTERGRUND-Sektion im Outbound-systemPrompt + additiv
  // persistiertes Feld. DEFAULT AN (Praezedenz mcpUiEnabled, I12 call-quality-Scheibe): der
  // Kanal ist produktionsreif (R3 Anti-Spoofing bewiesen - der Kontext speist NIE
  // Offenlegung/Persona; eigener Validierungs-/Persist-Pfad seit P3 gehaertet, 10+ Tests).
  // Mit ASSISTANT_CONTEXT_ENABLED=false weiter fail-closed abschaltbar (Tests pinnen das
  // explizit via BASE_ENV, siehe test/helpers.js).
  assistantContextEnabled: boolEnv("ASSISTANT_CONTEXT_ENABLED", process.env.ASSISTANT_CONTEXT_ENABLED, {
    fallback: true,
  }),
  // P8 (PLAN-CONVERSATION-QUALITY-V2): Pre-Call-Briefing. Ein starkes Modell fuellt VOR
  // dem Waehlen den strukturierten call.context (+ optional das Mandat) aus dem Auftrag
  // des Nutzers. DEFAULT AUS (fail-closed): kein zweiter LLM-Aufruf, keine Zusatzkosten,
  // /api/calls byte-identisch. Wirkt NUR zusammen mit assistantContextEnabled - ohne den
  // Konsumenten (HINTERGRUND-Sektion, claude.js) waere das Briefing bezahlter Muell.
  precallBriefingEnabled: boolEnv("PRECALL_BRIEFING_ENABLED", process.env.PRECALL_BRIEFING_ENABLED, {
    fallback: false,
  }),
  // Self-Service-Schicht (I9): getrenntes Tenant-Dashboard + Self-Service-Settings-
  // Route hinter eigenem Reife-Flag. DEFAULT AUS (fail-closed): die Self-Service-
  // Routen sind nicht erreichbar (404), die getrennte Seite bleibt hinter Basic-Auth
  // -> heutiges Admin-Dashboard + /api/* byte-identisch. Getrennt von MULTI_TENANT
  // (groesste Angriffsflaeche: oeffentlicher Tenant-Login + Self-Service-Schreiben).
  selfServiceEnabled: boolEnv("SELF_SERVICE_ENABLED", process.env.SELF_SERVICE_ENABLED, {
    fallback: false,
  }),
  // Lokaler Dev-Login-Shim (Single-Origin P1): POST /auth/dev-login mintet eine Session
  // OHNE WorkOS-Round-Trip - NUR fuer den lokalen Chrome-e2e-Loop. DOPPELT fail-closed:
  // explizites Opt-in (boolEnv, fail-closed) UND nie im Hosting (Render setzt RENDER_EXTERNAL_URL ->
  // hier zu false neutralisiert). Eine versehentlich auf Render gesetzte DEV_LOGIN_ENABLED
  // verweigert zusaetzlich den Boot (productionFootguns liest die rohe Env, zweite Sperre).
  devLoginEnabled:
    boolEnv("DEV_LOGIN_ENABLED", process.env.DEV_LOGIN_ENABLED, { fallback: false }) &&
    !process.env.RENDER_EXTERNAL_URL,
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
  geoEnabled: boolEnv("GEO_ENABLED", process.env.GEO_ENABLED, { fallback: false }),
  // Pfad zur lokalen GeoLite2-Country-mmdb (nur relevant bei GEO_ENABLED=true). Leer ->
  // der maxmind-Adapter liefert fail-safe null (DE-Fallback). Das Asset committen wir NICHT.
  geoDbPath: process.env.GEO_DB_PATH || "",
  // Env-Schalter fuer den P10-Weltdefault-Flip (DEFAULT_LANGUAGE de->en,
  // src/store/defaults.js). Code-Default FAIL-CLOSED auf false: der Flip muss ausdruecklich
  // eingeschaltet werden, er passiert nie durch blosses Deployen.
  //
  // Warum nicht true (Safety-Review P10, Runde 2, empirisch belegt): der Blueprint-Wert
  // "false" in render.yaml reicht als Schutz NICHT. Dieser Service ist dashboard-managed -
  // render.yaml ist dort ausdruecklich Referenz und nicht Wahrheit, und die Variable ist im
  // Dashboard heute gar nicht gesetzt. Bei Code-Default true gewinnt am Deploy-Tag also der
  // Code: jeder settings/number/tenant-Datensatz mit language=NULL faellt ueber
  // resolveCallLanguage auf den Weltdefault durch, womit Gather-Locale, Say-Stimme UND der
  // Offenlegungssatz eines deutschen Bestandstenants schlagartig englisch werden. Genau das
  // schliesst P10 "ENTSCHAERFT (5)" als Abnahmekriterium aus.
  //
  // Das Aktivierungsfenster (PLAN-I18N-FIX.md P10, "S2, quer zu P10-P13") wird damit vom
  // Code getragen, nicht von einer Datei, die die Live-Config nicht bestimmt. Der
  // Freischalt-Weg steht EINMAL bei WORLD_DEFAULT_LANGUAGE_ENABLED in render.yaml, nicht
  // hier dupliziert. Die Suite faehrt den Flip scharf (test/helpers.js BASE_ENV setzt den
  // Schluessel explizit auf "true"), das Verhalten der Tests aendert sich also nicht.
  worldDefaultLanguageEnabled: boolEnv(
    "WORLD_DEFAULT_LANGUAGE_ENABLED",
    process.env.WORLD_DEFAULT_LANGUAGE_ENABLED,
    { fallback: false },
  ),
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
  // P3.1 (PLAN-CONVERSATION-QUALITY-V2): Vorlauf (ms) vor dem harten Max-Dauer-Cap, ab dem
  // /voice/turn statt eines Folge-Gathers einen deterministischen Abschluss-Satz + Hangup
  // rendert. Der Cap selbst wird dadurch NICHT verlaengert (Regel 1): der Satz liegt
  // INNERHALB der Frist, der Timer-Backstop (terminateCappedCall) bleibt unangetastet.
  // Herleitung 20000: ein Abschluss-Satz von ~120 Zeichen braucht bei der MS_PER_CHAR-
  // Schaetzung des Farewell-Watchdogs grob 8-10 s Sprechzeit, dazu ein voller Webhook-
  // Zyklus - 20 s lassen dafuer Luft, ohne mehr als einen regulaeren Turn zu opfern.
  // 0 = AUS (remaining >= 0 ist immer wahr -> nie ausgeloest = Bestandsverhalten).
  // Muss deutlich KLEINER als maxCallDurationS bleiben, sonst endet jeder Call nach dem
  // ersten Turn. Max 60000 gegen absurde Werte.
  capFarewellLeadMs: numEnv("CAP_FAREWELL_LEAD_MS", process.env.CAP_FAREWELL_LEAD_MS, {
    fallback: 20000,
    min: 0,
    max: 60000,
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
  // stab-p7 (a): Empty-Turn-Guard. Max. konsekutive Agent-Turns OHNE substanzielle Antwort
  // des Gegenuebers, bevor der Agent (nur Outbound) ein end_call freigibt. Entkoppelt die
  // Selbst-Terminierung von der Stille-Achse: ein einzelner Leer-/Echo-Turn beendet den Call
  // NIE. Konservativer Default 3. Min 2 haelt den Erst-Turn-Boden (T1) - die deterministische
  // Disclosure zaehlt in der Budget-Engine als erster Agent-Turn, daher darf 1 nie beenden.
  maxEmptyTurns: numEnv("MAX_EMPTY_TURNS", process.env.MAX_EMPTY_TURNS, { fallback: 3, min: 2 }),
  // stab-p7 (b): Mindest-Zeichenlaenge (getrimmt) einer als SUBSTANZIELL gewerteten Anrufer-
  // Aeusserung. Kuerzere/leere Transkripte (Deepgram-Echo-/Rausch-Fragmente) sind nicht
  // substanziell -> heben den Fruehauflege-Schutz NICHT. Gilt fuer das Transkript-Record-Gate
  // NUR im Outbound-Pfad (dort landen sie folglich auch nicht im Transkript); Inbound bleibt
  // TG-REC-1-bedingt byte-identisch zum Master-Stand (jede nicht-leere Aeusserung landet im
  // Transkript, siehe Kommentar an agentTurn in claude.js). Default 2 (eine echte Antwort wie
  // "Ja"/"Ok" ist >= 2 Zeichen). Min 1 (0 wuerde leere Eingaben als substanziell werten und
  // den Schutz aushebeln).
  callerSubstanceMinLen: numEnv("CALLER_SUBSTANCE_MIN_LEN", process.env.CALLER_SUBSTANCE_MIN_LEN, {
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
  skipTwilioSignatureCheck: boolEnv(
    "SKIP_TWILIO_SIGNATURE_CHECK",
    process.env.SKIP_TWILIO_SIGNATURE_CHECK,
    { fallback: false },
  ),
  // OUT-05 (F2): Test-Seam. true -> voiceControl liefert den fakeVoice-Adapter (synthetischer
  // Originate-Erfolg, endCall No-op), damit der Reserve-Atomaritaets-/Freigabepfad OFFLINE
  // testbar ist (der echte Twilio-Client wirft synchron ohne AC-SID). BOOT-GEHAERTET
  // (boot-guard.js): nur zulaessig mit SKIP_TWILIO_SIGNATURE_CHECK=true -> in Prod (Signatur-
  // pruefung fail-closed AN, Regel 1) fuehrt es zum Boot-Refusal, NIE zu stillem Nicht-Waehlen.
  // KEINE abgeschaltete Sicherung: alle Gates laufen unveraendert VOR voiceControl.
  fakeOriginate: boolEnv("FAKE_ORIGINATE", process.env.FAKE_ORIGINATE, { fallback: false }),

  // ---- Datenschutz ----
  // Beendete Calls (samt Transkript) und Notifications aelter als RETENTION_DAYS
  // werden geloescht (DSGVO-Datenminimierung). 0 = Retention aus.
  retentionDays: numEnv("RETENTION_DAYS", process.env.RETENTION_DAYS, { fallback: 30, min: 0 }),
  // P2b: eigene, STRENGERE Frist fuer die Roh-Transkripte diagnostisch markierter Calls
  // (Ziel == eigene verifizierte Nummer des Tenants). Strikt getrennt von retentionDays:
  // der Call-Record faellt weiter erst nach RETENTION_DAYS, sein Roh-Transkript schon
  // hier - die kuerzere Frist ist damit immer die bindende. 0 = Diagnose-Retention aus
  // (kein Flag wird gewaehrt UND jedes markierte Alt-Transkript faellt beim naechsten
  // Sweep) - fail-closed in die Loesch-Richtung.
  diagnosticRetentionDays: numEnv(
    "DIAGNOSTIC_RETENTION_DAYS",
    process.env.DIAGNOSTIC_RETENTION_DAYS,
    { fallback: 7, min: 0 },
  ),

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
  oauthIssuerUrl: stripTrailingSlash(process.env.OAUTH_ISSUER_URL || ""),
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
  workosApiBase: stripTrailingSlash(process.env.WORKOS_API_BASE || "https://api.workos.com"),
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
  voiceEngine: process.env.VOICE_ENGINE || VOICE_ENGINE.BUDGET,
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  realtimeModel: process.env.REALTIME_MODEL || "gpt-realtime",
  realtimeVoice: process.env.REALTIME_VOICE || "alloy",
  twilioEdge: process.env.TWILIO_EDGE || "frankfurt",

  // ---- Anrufbeantworter-Erkennung (GAP-21) ----
  // DEFAULT AUS (Muster PAYMENT_ENABLED): die Feldnamen der Provider-Origination sind
  // erst mit einem Objekt-GET der Live-API belegt; ein falsches Feld quittiert Telnyx mit
  // HTTP 422 auf JEDEM Outbound (Praezedenzfall Call-Control-App-ID, tasks/rca-place-call-422.md).
  // Rollback ist damit eine Env-Variable ohne Deploy.
  machineDetection: {
    enabled: boolEnv("MACHINE_DETECTION_ENABLED", process.env.MACHINE_DETECTION_ENABLED, {
      fallback: false,
    }),
    // Obergrenze der Erkennung. Laeuft sie ab, liefert der Provider ein UNEINDEUTIGES
    // Ergebnis -> weiterreden wie mit einem Menschen (fail-open, Pre-Mortem 3).
    timeoutS: numEnv("MACHINE_DETECTION_TIMEOUT_S", process.env.MACHINE_DETECTION_TIMEOUT_S, {
      fallback: 5,
      min: 3,
      max: 30,
    }),
  },

  // Preise pro 1M Tokens in USD, PRO MODELL-ID. Nur fuer den Budget-Guard (Regel 1).
  // EINZIGE Preisquelle: das Live-Gate (trackUsage) UND der Stripe-Ledger (aiCostCents)
  // leiten ihren Betrag hieraus ab (G5). Ein Modell, das hier NICHT steht, wird mit der
  // TEUERSTEN hinterlegten Rate gebucht (fail-closed, priceForModel in state-ops.js) -
  // nie mit 0, nie mit dem Haiku-Default. Jedes neue Modell MUSS hier eingetragen werden,
  // BEVOR CLAUDE_MODEL darauf gestellt wird (siehe PLAN-SECURITY.md, P7A-MODELPRICE).
  //
  // LISTENPREISE, bewusst NICHT der Sonnet-5-Einfuehrungsrabatt (2/10 USD, laeuft
  // 2026-08-31 aus): ein zu NIEDRIGER Preis macht das Budget-Gate blind, ein zu hoher
  // ist hoechstens zu streng. Achtung: eine DATIERTE Snapshot-ID
  // ("claude-haiku-4-5-20251001") ist ein ANDERER Schluessel als der Alias und wuerde
  // in den Fail-closed-Zweig laufen.
  //
  // BEWUSST NICHT Object.freeze(...): guardedConfig (unten) wrapt jeden Objekt-Wert bei
  // JEDEM Zugriff frisch in einen NEUEN Proxy. Fuer eine per Object.freeze non-configurable
  // GEMACHTE Eigenschaft verlangt die Sprache aber, dass [[Get]] denselben (SameValue)
  // Rueckgabewert liefert wie am Target - ein frischer Wrapper verletzt diese Invariante und
  // die Engine wirft TypeError bei JEDEM Zugriff (auch auf bekannte Modelle), nicht nur bei
  // unbekannten. Genau der Fail-open-durch-Crash, den priceForModel verhindern soll. Muster
  // wie die bestehenden ungefreezten Objekt-Bloecke telnyxElevenLabs/telnyxAssistant oben.
  modelPricesUsd: {
    "claude-haiku-4-5": { inPerMTok: 1.0, outPerMTok: 5.0 },
    "claude-sonnet-5": { inPerMTok: 3.0, outPerMTok: 15.0 },
  },
  // KI-Kosten-Achse des Budget-Gates (trackUsage) UND des Stripe-Ledgers (aiCostCents):
  // USD-Token-Preise -> EUR. DIESELBE Umgebungsvariable, derselbe Default und dasselbe
  // Minimum wie providerToBucketRateMicro oben (GAP-08: ein Kurs, eine Stellschraube) -
  // hier nur als Faktor EUR je USD statt in Mikro-Einheiten. Der Fallback wird aus
  // EXCHANGE_RATE_DEFAULTS abgeleitet, damit der Kurs nicht als zweite Zahl gepflegt wird.
  usdToEur:
    numEnv("PROVIDER_TO_BUCKET_RATE_MICRO", process.env.PROVIDER_TO_BUCKET_RATE_MICRO, {
      fallback: Math.round(EXCHANGE_RATE_DEFAULTS.usdToEur * FX_MICRO_PER_UNIT),
      min: 1,
    }) / FX_MICRO_PER_UNIT,

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

// Duck-Typing-Protokoll-Properties, die JS-Laufzeit UND Standardbibliothek von sich aus
// abfragen (JSON.stringify prueft value.toJSON, await/Promise.resolve prueft value.then) -
// beides sind normale property-get-Zugriffe, die der Proxy-Guard sonst als unbekannten
// Config-Key missversteht. Ohne diese Ausnahme wirft ein simples JSON.stringify(config...)
// oder ein versehentliches await auf eine Config-Gruppe statt zu helfen (Review-Blocker
// S1-1, PLAN-FRAGILITY-REMEDIATION.md P5). Symbole sind bereits generell ausgenommen
// (Iterator-Protokoll etc.) - dies erweitert dieselbe Ausnahme auf die zwei String-
// Properties, die die Plattform selbst abfragt. Modul-Konstante (keine Config-Flaeche).
const SAFE_DUCK_TYPING_PROPS = new Set(["then", "toJSON"]);

// PA-20 (Flip): Die flache Oberflaeche ist entfernt - die 14 Namespaces sind die EINZIGE
// Zugriffs-Oberflaeche. Der Proxy bewacht `get` UND `set`: ein Read auf einen entfernten
// flachen Key wirft (fail-closed statt still-undefined); ein Write auf einen unbekannten
// (flachen/vertippten) Key wirft ebenfalls, statt still eine Stray-Property anzulegen, die
// den rawConfig-Speicher NIE erreicht (ein Test-Override liefe sonst faelschlich ins Leere,
// gruen ohne den Wert zu treffen). Namespace-Blaetter tragen einen Setter auf denselben
// rawConfig-Slot (`prop in obj` -> Reflect.set ruft ihn) -> config.<ns>.<key> = v bleibt
// moeglich; Symbole (Iterator/util.inspect) bleiben durchgereicht.
function guardedConfig(target, path = "config") {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol" || prop in obj) {
        const value = Reflect.get(obj, prop, receiver);
        const isNestedGroup = value && typeof value === "object" && !Array.isArray(value);
        return isNestedGroup ? guardedConfig(value, `${path}.${String(prop)}`) : value;
      }
      if (SAFE_DUCK_TYPING_PROPS.has(prop)) return undefined;
      throw new TypeError(
        `${path}.${String(prop)} existiert nicht (verschobener/entfernter Config-Key? ` +
          "config.<namespace>.<key> nutzen - Gruppierung in src/config.js pruefen).",
      );
    },
    set(obj, prop, value, receiver) {
      if (typeof prop === "symbol" || prop in obj) return Reflect.set(obj, prop, value, receiver);
      throw new TypeError(
        `${path}.${String(prop)} kann nicht gesetzt werden (flache Oberflaeche entfernt; ` +
          "config.<namespace>.<key> nutzen).",
      );
    },
  });
}

// ---- PA-12 (config-Hub-Entschaerfung) + PA-20 (Flip): verschachtelte Zugriffs-Oberflaeche ----
// 14 Namespaces sind seit PA-20 die EINZIGE oeffentliche Oberflaeche (die vormals
// zusaetzlich erhaltenen Flach-Aliase sind entfernt). Jedes Blatt ist Getter+Setter auf
// DENSELBEN rawConfig-Speicherort (kein zweiter numEnv/boolEnv, keine Wert-Kopie): ein
// Override ueber config.<ns>.<key> = v schreibt rawConfig[key] und schlaegt damit auf
// jeden anderen Lesezugriff auf dasselbe Blatt durch. numEnv/boolEnv bleiben eager beim
// rawConfig-Aufbau oben; die Getter lesen nur den fertigen Wert -> kein verschluckter
// Fatal-Push, kein Doppel-Eval. rawConfig selbst bleibt der interne Speicher, wird aber
// NICHT mehr exportiert - config.<ns>.<key> ist der einzige Zugriffspfad.
export const CONFIG_NAMESPACES = Object.freeze({
  safety: ["outboundFrozen", "allowedCountryCodes", "maxCallsPerHour", "perTargetCallCap", "perTargetWindowMs", "maxCallDurationS", "capFarewellLeadMs", "reserveReleaseGraceMs", "rateLimitPerMin", "skipTwilioSignatureCheck", "fakeOriginate"],
  billing: ["platformSpendCapCents", "paymentEnabled", "stripeSecretKey", "stripeApiBase", "numberSetupFeeCents", "paymentCurrency", "providerCurrency", "providerToBucketRateMicro", "costTruingDelayMinutes", "costTruingSweepIntervalMs", "costTruingMaxAttempts", "costTruingRequiredRecordTypes", "costTruingMinCoveragePercent", "costTruingCoverageStallSweeps", "costDriftWarnPercent", "costAlertDebounceMs", "costCalibrationMinSamples", "voiceTariffDomesticCents", "voiceTariffDefaultCents", "voiceTariffFullCostFloorCents", "voiceTariffDomesticPrefixes", "defaultTenantBudgetCents", "smsCostCents", "platformSpendWarnPercent", "platformAlertSmsTo", "budgetMonthEnabled", "ttsCharacterQuota", "ttsCharacterQuotaWarnPercent", "ttsQuotaCycleAnchorDay", "platformFixedCostCentsPerMonth", "numberMonthlyCostCents", "stripeStarterPriceId", "stripeBusinessPriceId", "stripeWebhookSecret", "stripeCustomerRetryDelayMs", "voiceCapRateCentsPerMin"],
  provisioning: ["maxNumbers", "maxNumbersPerTenant", "provisioningEnabled", "provisioningRedriveMaxAgeMs", "releaseGraceMs", "provisioningCountry", "forceNumberCountry", "geoEnabled", "geoDbPath", "worldDefaultLanguageEnabled", "ownerNumberSeed", "ownerNumberProvider", "bootstrapE164", "bootstrapProvider"],
  auth: ["mcpAuthToken", "mcpAuth", "oauthIssuerUrl", "oauthAudience", "sessionSecret", "oidcClientId", "oidcClientSecret", "workosApiBase", "adminEmails", "loginRateLimitPerMin", "sessionTtlSeconds", "loginCookieTtlSeconds", "dashboardPassword", "ownerIdpSubject", "devLoginEnabled"],
  llm: ["anthropicApiKey", "claudeModel", "llmRequestTimeoutMs", "llmMaxRetries", "llmBackoffMs", "llmBreakerThreshold", "llmBreakerWindowMs", "llmBreakerCooldownMs", "modelPricesUsd", "usdToEur", "briefingModel", "briefingTimeoutMs"],
  telnyx: ["telnyxElevenLabs", "telnyxAssistant"],
  voice: ["voiceEngine", "openaiApiKey", "realtimeModel", "realtimeVoice", "elevenLabsPlayTts", "sttSpeechTimeoutSec", "maxEmptyTurns", "callerSubstanceMinLen", "sendSmsSummary", "dailySmsCap"],
  telephony: ["twilioSid", "twilioToken", "telnyxApiKey", "telnyxPublicKey", "telnyxApiBase", "telnyxConnectionId", "telnyxAccountSid", "twilioEdge", "machineDetection"],
  tenancy: ["multiTenant", "mcpUiEnabled", "assistantContextEnabled", "selfServiceEnabled", "profilesSeed", "precallBriefingEnabled"],
  server: ["port", "publicUrl", "isProduction", "deployedCommit", "dataDir", "publicDir", "webDistDir", "shutdownDrainTimeoutMs"],
  store: ["storeBackend", "databaseUrl", "queueBackend"],
  metrics: ["metricsEnabled"],
  privacy: ["retentionDays", "diagnosticRetentionDays"],
  research: ["researchEnabled", "researchMaxUses", "researchSearchFeeCents"],
});

// EINE Gruppen-Fabrik (G5) fuer beide Oberflaechen: jedes Blatt ist Getter+Setter auf
// DENSELBEN Speicher-Slot (kein zweiter numEnv/boolEnv, keine Wert-Kopie). Der Setter haelt
// die Test-Override-Semantik (config.<ns>.<key> = v trifft rawConfig[key], das alle anderen
// Namespace-Getter lesen). configurable:true ist Pflicht (s.u.).
function makeNamespaceGroup(keys, storage) {
  const group = {};
  for (const key of keys) {
    Object.defineProperty(group, key, {
      enumerable: true,
      get: () => storage[key],
      set: (value) => {
        storage[key] = value;
      },
    });
  }
  return group;
}

// Test-Fixtures (config-namespaces-helper.js withConfigNamespaces): Namespaces NICHT-
// enumerable an einen flachen Mock haengen -> dessen Flach-Enumeration bleibt byte-identisch
// (dual-read Mock). Nur fuer Hand-Mocks, NICHT fuer den echten config-Singleton.
export function attachNamespaces(target, namespaces) {
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(target, namespace, {
      enumerable: false,
      configurable: true,
      value: makeNamespaceGroup(keys, target),
    });
  }
}

// PA-20 (Flip): eigene Oberflaeche mit NUR den 14 Namespaces (enumerable), Blaetter delegieren
// an den internen rawConfig-Speicher. configurable:true ist PFLICHT: guardedConfig gibt fuer
// Objekt-Blaetter/-Gruppen eine FRISCHE Wrapper-Proxy zurueck; bei einer non-configurable-
// Data-Property verlangt die Proxy-[[Get]]-Invariante den EXAKTEN Zielwert -> sonst TypeError
// beim ersten config.<ns>-Zugriff.
function buildNamespaceSurface(storage, namespaces) {
  const surface = {};
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(surface, namespace, {
      enumerable: true,
      configurable: true,
      value: makeNamespaceGroup(keys, storage),
    });
  }
  return surface;
}

export const config = guardedConfig(buildNamespaceSurface(rawConfig, CONFIG_NAMESPACES));

// Wiring (P15, Kompositions-Root): der Env-Schalter (s.o., worldDefaultLanguageEnabled)
// wird EINMAL beim Laden von config.js in defaults.js gedrueckt - defaults.js bleibt
// dabei config-frei importierbar (kein Rueck-Import), s. Kommentar dort.
setWorldDefaultLanguageEnabled(config.provisioning.worldDefaultLanguageEnabled);

// ---- Gateway-URL (G5: EINE Quelle fuer den localhost-Fallback, S2-20) ----
// Die MCP-Tools/-Server sprechen mit der eigenen REST-API. Ohne gesetztes GATEWAY_URL
// faellt der Konsument auf http://localhost:<port> zurueck. boot.js setzt GATEWAY_URL
// beim Listen auf den TATSAECHLICH gebundenen Port (bei PORT=0 vom OS vergeben) und
// nutzt dafuer gatewayUrlForPort(port). resolveGatewayUrl() liest zur Aufrufzeit
// GATEWAY_URL (Trailing-Slash gestrippt) oder faellt auf den config-Port zurueck.
export function gatewayUrlForPort(port) {
  return `http://localhost:${port}`;
}
export function resolveGatewayUrl() {
  return stripTrailingSlash(process.env.GATEWAY_URL || gatewayUrlForPort(config.server.port));
}

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

// C-Telnyx-Backstop (PLAN-TELNYX-AI-ASSISTANT.md, P10): Obergrenze fuer die per-callId-
// Shim-Turn-Rate. telnyxShimMaxTurnsPerMin ist die Token-/Toll-Fraud-Bremse VOR agentTurn
// (Regel 1); numEnv erzwingt nur min:1, keine Obergrenze. Ein absurd hoher Wert im Hosting
// bei aktivem Assistant setzt die Bremse praktisch ausser Kraft -> fail-closed. Backstop,
// KEIN Tuning-Knopf (Muster metrics.js MAX_TRACKED_CALLS) -> Modul-Konstante, keine Env-Var.
// 120 = grosszuegig (4x Default 30, 2 Turns/s), aber weit unter fraud-relevanten Werten.
const TELNYX_SHIM_MAX_TURNS_CEILING = 120;

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
  if (!cfg.auth.dashboardPassword)
    errors.push(
      "DASHBOARD_PASSWORD fehlt - Dashboard und API waeren oeffentlich erreichbar (im Hosting Pflicht).",
    );
  if (cfg.auth.mcpAuth === "off")
    errors.push("MCP_AUTH=off - /mcp ist ohne jede Pruefung offen (im Hosting unzulaessig).");
  if (cfg.safety.skipTwilioSignatureCheck)
    errors.push(
      "SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks bleiben ungeprueft (im Hosting unzulaessig).",
    );
  if (isInsecureHttpIssuer(cfg.auth.oauthIssuerUrl))
    errors.push("OAUTH_ISSUER_URL ist nicht https - SSRF/MITM-Footgun (im Hosting unzulaessig).");
  if (cfg.store.storeBackend !== "pg")
    errors.push(
      "STORE_BACKEND ist nicht 'pg' - der json-Store liegt auf Renders fluechtigem Dateisystem (Datenverlust bei jedem Deploy/Neustart). Im Hosting STORE_BACKEND=pg + DATABASE_URL Pflicht.",
    );
  // DEV_LOGIN_ENABLED ist ein lokaler Login-Shim (umgeht WorkOS) - im Hosting NIE erlaubt.
  // config.auth.devLoginEnabled ist auf Render ohnehin neutralisiert (=== false); diese zweite,
  // unabhaengige Sperre liest die ROHE Env, damit eine versehentlich auf Render gesetzte
  // DEV_LOGIN_ENABLED=true den Boot verweigert statt still ignoriert zu werden (Regel 3).
  if (process.env.DEV_LOGIN_ENABLED === "true")
    errors.push("DEV_LOGIN_ENABLED=true - Login-Shim umgeht WorkOS (im Hosting unzulaessig).");
  // C-Telnyx: aktiver Assistant + entwaffnete Shim-Rate-Bremse (Regel 1). Nur wenn das
  // Flag an ist (Flag aus -> Shim 404, Bremse inert -> kein Footgun).
  if (
    cfg.telnyx?.telnyxAssistant?.enabled &&
    cfg.telnyx?.telnyxAssistant?.shimMaxTurnsPerMin > TELNYX_SHIM_MAX_TURNS_CEILING
  )
    errors.push(
      "TELNYX_SHIM_MAX_TURNS_PER_MIN zu hoch - die per-Call-Turn-Bremse (Token-/Toll-Fraud) waere praktisch aus (im Hosting bei aktivem Assistant unzulaessig).",
    );
  return errors;
}

// EINE Quelle (G5) fuer das Self-Service-Reifekriterium: nur "scharf", wenn BEIDE Flags
// gesetzt sind (SELF_SERVICE_ENABLED + MULTI_TENANT). Reine Praedikatfunktion, per Import
// genutzt (auth-gate/web-login) statt vierfach woertlich. INV-3-Exemption-Reihenfolge
// bleibt strukturell unveraendert (nur die Bedingung wird benannt, nicht verschoben).
export function isSelfServiceLive(cfg) {
  return Boolean(cfg.tenancy.selfServiceEnabled && cfg.tenancy.multiTenant);
}

export function assertConfig() {
  const missing = [];
  if (!config.llm.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
  if (!config.telephony.twilioSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.telephony.twilioToken) missing.push("TWILIO_AUTH_TOKEN");
  // Absendernummer + Owner-Identitaet sind keine Boot-Pflicht-Env mehr (P2b): sie leben
  // im Store (Bootstrap-CLI/Onboarding/Self-Service), nicht in der Env. Stattdessen
  // verlangt der Boot-Guard in server.js fail-closed eine aktive Nummer im Store
  // (assertConfig bleibt storefrei).
  if (!config.server.publicUrl || config.server.publicUrl.includes("CHANGE-ME"))
    missing.push("PUBLIC_URL");
  if (config.auth.mcpAuth === "oauth" && !config.auth.oauthIssuerUrl)
    missing.push("OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)");
  if (config.store.storeBackend === "pg" && !config.store.databaseUrl)
    missing.push("DATABASE_URL (weil STORE_BACKEND=pg)");
  if (config.billing.paymentEnabled && !config.billing.stripeSecretKey)
    missing.push("STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)");
  // W4: das Webhook-Signing-Secret ist sicherheitskritisch (ohne ist der Stripe-Webhook
  // fail-closed unverifizierbar -> kein Abo-Lifecycle). Boot-Pflicht bei aktivem Payment
  // (Muster STRIPE_SECRET_KEY). Die Price-Ids sind BEWUSST keine Boot-Pflicht: ein Tier
  // darf unbuchbar bleiben (Route-500), das stoppt den Boot nicht.
  if (config.billing.paymentEnabled && !config.billing.stripeWebhookSecret)
    missing.push("STRIPE_WEBHOOK_SECRET (weil PAYMENT_ENABLED=true)");
  // numEnv() faengt einen nicht-numerischen NUMBER_SETUP_FEE_CENTS bereits am Env-Parse
  // ab (fatalConfigErrors -> Boot-Refusal). Dieser Check bleibt als Invariante auf dem
  // config-Wert (> 0 ganzzahlig bei PAYMENT_ENABLED) - direkt geprueft von
  // config-payment-guard.test.js, das den config-Wert ohne Env-Pfad mutiert.
  if (
    config.billing.paymentEnabled &&
    (!Number.isInteger(config.billing.numberSetupFeeCents) || config.billing.numberSetupFeeCents <= 0)
  )
    missing.push("NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)");
  // Single-Origin (P1): WEB_DIST_DIR gesetzt, aber der Build (<dir>/index.html) fehlt ->
  // sichtbarer Boot-Fehler statt stiller 401. Ohne index.html faende express.static nichts,
  // jeder Marketing-Request fiele auf die Basic-Auth durch (Admin-Passwort statt Landing).
  if (config.server.webDistDir && !existsSync(path.join(config.server.webDistDir, "index.html")))
    missing.push(
      "WEB_DIST_DIR-Build (kein index.html im angegebenen Verzeichnis - 'astro build' in apps/web?)",
    );
  // C-Telnyx (PLAN-TELNYX-AI-ASSISTANT.md, P10): der AI-Assistant-Pfad braucht bei aktivem
  // Flag die volle Origination-/Shim-Config, sonst bootet der Dienst in einen "Flag an, aber
  // Assistant/Shim unkonfiguriert"-Zustand (Regel 1/3, fail-closed). publicUrl ist bereits
  // oben Pflicht (Custom-LLM-URL des Assistants zeigt dorthin). apiKey/callControlAppId tragen
  // die Call-Control-Origination + Hangup; assistantId feuert ai_assistant_start (P5/P7);
  // connectionId (TeXML) bleibt Pflicht, weil der Inbound-/Nummern-Pfad weiter darueber laeuft.
  if (config.telnyx.telnyxAssistant.enabled) {
    if (!config.telnyx.telnyxAssistant.assistantId)
      missing.push("TELNYX_ASSISTANT_ID (weil TELNYX_AI_ASSISTANT_ENABLED=true)");
    if (!config.telephony.telnyxApiKey)
      missing.push("TELNYX_API_KEY (weil TELNYX_AI_ASSISTANT_ENABLED=true)");
    if (!config.telephony.telnyxConnectionId)
      missing.push("TELNYX_CONNECTION_ID (weil TELNYX_AI_ASSISTANT_ENABLED=true)");
    if (!config.telnyx.telnyxAssistant.callControlAppId)
      missing.push("TELNYX_CALL_CONTROL_APP_ID (weil TELNYX_AI_ASSISTANT_ENABLED=true)");
    if (!config.telnyx.telnyxAssistant.shimSharedSecret)
      missing.push("TELNYX_SHIM_SHARED_SECRET (weil TELNYX_AI_ASSISTANT_ENABLED=true)");
  }
  // Fatal-Befunde, die den Boot stoppen (fail-closed statt stillem Gate-Aus):
  //  - numerische (AC1/AC2): NaN/Infinity/Bereichsverletzung einer gesetzten Env-Var.
  //  - Produktions-Footguns (H1): im Hosting (RENDER_EXTERNAL_URL) offene/abgeschaltete
  //    Auth-/Signatur-Gates. Lokal liefert productionFootguns() ein leeres Array.
  //  - Alarmkanal (GAP-07): scharfe Spend-Warnung ohne Empfaenger. Die Entscheidung selbst
  //    lebt NICHT hier, sondern in der einen Wahrheitstabelle (boot-guard.alertChannelFindings) -
  //    diese Zeile faltet nur ihren fatalen Anteil in dieselbe Ausgabe wie die uebrigen Fatals.
  const isProduction = detectProduction();
  const fatal = configFatalErrors()
    .concat(productionFootguns(config, isProduction))
    .concat(
      alertChannelFindings(config.billing)
        .filter((f) => f.fatal)
        .map((f) => f.message),
    );
  if (missing.length || fatal.length) {
    console.error("\n[Konfiguration fatal] Boot wird verweigert:");
    for (const m of missing) console.error(`  - fehlt/ungueltig: ${m}`);
    for (const f of fatal) console.error(`  - ${f}`);
    console.error("(.env pruefen; .env.example kopieren: cp .env.example .env)\n");
  }
  // Footgun-Warnungen NUR im lokalen/Test-Modus: im Hosting (isProduction) sind
  // dieselben Punkte oben bereits fatal (productionFootguns) -> hier kein
  // Doppel-Report, lokal aber weiterhin ein sichtbarer Hinweis.
  if (!isProduction && config.safety.skipTwilioSignatureCheck)
    console.error(
      "[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!",
    );
  if (!isProduction && config.auth.mcpAuth === "off")
    console.error("[Sicherheit] MCP_AUTH=off - /mcp ohne jede Pruefung offen (nur lokale Demos)!");
  if (config.billing.paymentEnabled && !config.provisioning.provisioningEnabled)
    console.error(
      "[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).",
    );
  if (config.store.storeBackend !== "pg" && config.auth.sessionSecret)
    console.error("[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB).");
  // Self-Service ist seit der Login-Konvergenz web-session-only: die Routen sind NUR
  // im Web-Login-Block (SESSION_SECRET + STORE_BACKEND=pg) registriert. Flags an, aber
  // ohne diese Infra -> /api/self-service/* sind nicht erreichbar (404, fail-closed).
  if (isSelfServiceLive(config) && !(config.auth.sessionSecret && config.store.storeBackend === "pg"))
    console.error(
      "[Hinweis] SELF_SERVICE_ENABLED braucht den Web-Login (SESSION_SECRET + STORE_BACKEND=pg) - sonst sind die /api/self-service/*-Routen nicht erreichbar.",
    );
  // http-OIDC-Issuer: lokal nur ein Hinweis (Test-IdP), im Hosting oben bereits fatal.
  if (!isProduction && isInsecureHttpIssuer(config.auth.oauthIssuerUrl))
    console.error(
      "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!",
    );
  return missing.length === 0 && fatal.length === 0;
}
