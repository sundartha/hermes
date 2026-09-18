// GAP-33 (PLAN-I18N-TESTS Kapitel 5, wichtigster Einzeltest des Katalogs):
// Rohstoff fuer Laeufe gegen die AUSGELIEFERTE Konfiguration statt gegen die in
// test/helpers.js BASE_ENV neutralisierte Test-Env.
//
// Warum es diese Datei braucht: BASE_ENV setzt genau die Gates weich, um die es beim
// internationalen Launch geht - ALLOWED_COUNTRY_CODES="*" (helpers.js:84),
// MAX_CALLS_PER_HOUR="100" (:85), die Tarife auf "0" (:263-264), die Tenant-Decke auf
// "0" (:268), PER_TARGET_CALL_CAP="1000" (:293). Solange kein Lauf die ausgelieferten
// Werte faehrt, beweist kein gruener Test etwas ueber Produktion.
//
// ZWEI Quellen, bewusst getrennt (Owner-Entscheidung 2026-07-25):
//
//   LIVE_ENV  - was der Dienst TATSAECHLICH faehrt. Traegt alle Gate-Aussagen.
//   RENDER_ENV - der Blueprint render.yaml. Traegt ausschliesslich den Divergenz-Befund.
//
// Warum nicht der Blueprint allein: render.yaml ist laut eigenem Kommentar Referenz und
// nicht Wahrheit - der Live-Service ist dashboard-managed. Gemessen am 2026-07-25 war der
// Blueprint nicht bloss ungenau, sondern nicht startfaehig: MAX_BUDGET_EUR="8" ergab
// platformSpendCapCents=800, und der Boot-Guard brach mit plan_cap_inert und exit(1) ab,
// weil die abgeleitete Pro-Plan-Decke darueber lag (HISTORISCH - dieser Guard ist mit
// KS-P9/E10 entfallen; der Befund bleibt als Beleg fuer die Quellen-Trennung stehen).
// P7 hat den Blueprint auf 30
// (und die Tenant-Decke auf 1500) gehoben - der Boot-Blocker ist weg, die Trennung der
// beiden Quellen bleibt aber bestehen: der Blueprint traegt weiterhin nur den
// Divergenz-Befund, Gate-Aussagen haengen an LIVE_ENV.
// Belege: tasks/i18n-tests/13-live-env-befund.md.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BASE_ENV } from "./helpers.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Parst den envVars-Block aus render.yaml zu {KEY: WERT}. Nur Eintraege mit explizitem
// `value:` - `sync: false` (Secret, im Dashboard gepflegt) und `generateValue: true`
// tragen keinen Wert und gehoeren nicht in die ausgelieferte Konfiguration.
function parseRenderEnv() {
  const text = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  const entry = /-\s+key:\s*(\w+)\s*\n\s*value:\s*(.*)$/gm;
  const env = {};
  let match;
  while ((match = entry.exec(text)) !== null) {
    const raw = match[2].trim();
    env[match[1]] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  }
  return Object.freeze(env);
}

// Der Blueprint, wie er im Repo steht. EINE Quelle (G5) fuer alle Tests, die gegen
// render.yaml pruefen (prod-config-smoke + env-docs-spend-cap-coherence).
export const RENDER_ENV = parseRenderEnv();

// Belegte Abweichungen des Live-Dienstes vom Blueprint. Jede Zeile braucht eine Quelle,
// die den Wert ZEIGT - eine Vermutung darf hier nicht stehen, sonst faehrt GAP-33 eine
// dritte, erfundene Konfiguration und beweist wieder nichts.
export const LIVE_MEASURED = Object.freeze({
  // Boot-Banner "Nummern-Gates: Land *" (src/boot.js:285 druckt allowedCountryCodes
  // woertlich) in JEDEM Boot vom 2026-07-18 bis 2026-07-25T09:03:22Z. Der Blueprint sagt
  // "+49,+33,+44" - das Land-Gate ist live weltweit offen.
  ALLOWED_COUNTRY_CODES: "*",
  // "30" ist der live gefahrene Wert (Entscheidung 8 aus PLAN-LIVE-COST-TRACING, ebenso
  // in test/helpers.js BASE_ENV gepinnt). Am Betrieb belegt: der Live-Boot am 2026-07-25
  // zeigt den plan_cap_inert-Abbruch NICHT, den der fruehere Blueprint-Wert "8" damals
  // reproduzierbar ausloeste (HISTORISCH, Guard mit KS-P9/E10 entfallen). Der Eintrag
  // bleibt eine MESSUNG, auch nachdem P7 den
  // Blueprint auf denselben Wert nachgezogen hat - Blueprint und Live sind zwei Quellen.
  MAX_BUDGET_EUR: "30",
});

// Achsen, deren LIVE-Wert nicht belegbar ist. Sie laufen auf dem Blueprint-Wert - das ist
// eine bewusste Restunschaerfe und keine Messung. Der Eintrag hier haelt sie sichtbar,
// statt sie in einem stillen Default verschwinden zu lassen (G27: Struktur statt
// Konvention). Aufloesbar nur durch Ablesen im Render-Dashboard (Owner-Zugriff).
export const LIVE_UNMEASURED = Object.freeze({
  // Beruehrt das Budget-Gate direkt (Perioden- statt Lebenszeit-Topf). Seit P1 druckt der
  // Boot-Banner die Achse ("Budget-Achse: ..."), der Wert ist also ab dem naechsten Deploy
  // aus dem Log ablesbar. Der Eintrag bleibt hier, bis die Phase, die GAP-01/GAP-33 haelt
  // (P6/P7), die Folgen eines geflippten prodEnv()-Spawns traegt - P1 aendert die
  // Spawn-Umgebung fremder Phasen-Tests bewusst nicht.
  BUDGET_MONTH_ENABLED: "Boot-Zeile ab P1 vorhanden; Uebernahme nach LIVE_MEASURED gehoert zu P6/P7",
  // Blueprint "false"; live muss der Wert davon abweichen, sonst gaebe es keinen
  // Self-Service-Launch. Kein Boot-Ausdruck, der den Wert zeigt.
  MULTI_TENANT: "kein Boot-Ausdruck; Blueprint-Wert widerspricht dem Live-Produkt",
  SELF_SERVICE_ENABLED: "kein Boot-Ausdruck; Blueprint-Wert widerspricht dem Live-Produkt",
  // Belegt ist nur, DASS der Kanal seit dem 2026-07-25 besetzt ist (die Boot-Warnung
  // "PLATFORM_ALERT_SMS_TO ist leer" stand in jedem Boot bis 2026-07-23T23:23Z und fehlt
  // seither). Die Nummer selbst gehoert laut Entscheidung 7.8 NUR in die Render-Env und
  // nie ins Repo - sie darf hier auch nicht als Testwert stehen.
  PLATFORM_ALERT_SMS_TO: "Wert ist eine Betreiber-Rufnummer und gehoert nicht ins Repo",
});

// Die ausgelieferte Konfiguration, wie sie live laeuft.
export const LIVE_ENV = Object.freeze({ ...RENDER_ENV, ...LIVE_MEASURED });

// Secrets tragen in render.yaml bewusst keinen Wert (`sync: false`). Fuer einen
// offline-Spawn ersetzt sie GAP-33 durch Dummies - ausdruecklich NUR Secrets, nie ein Gate.
// TELNYX_API_KEY bleibt bewusst LEER: das ist der Offline-Diskriminator (gemessen
// 2026-08-07). originateCall wirft dann synchron vor jedem Netzzugriff, POST /api/calls
// antwortet 500 -> 500 = "alle Gates passiert, bis zum Provider-Aufruf durchgekommen",
// 403/429/402 = "ein Gate hat gesperrt". Kein Netz, kein echter Anruf.
export const PROD_DUMMY_SECRETS = Object.freeze({
  ANTHROPIC_API_KEY: "test-anthropic-key",
  TELNYX_API_KEY: "",
  DASHBOARD_PASSWORD: "",
  MCP_AUTH_TOKEN: "",
  ALLOWED_NUMBERS: "",
  PROFILES_JSON: "",
});

// Env-Schluessel, die ein Offline-Spawn NICHT auf dem ausgelieferten Wert fahren kann und
// die deshalb ihren neutralen BASE_ENV-Wert behalten, je mit Grund. Bewusst kurz: jede
// Aufnahme hier ist eine Stelle, an der GAP-33 blind bleibt. KEIN Verkehrs-Gate, kein
// Tarif, keine Decke - diese Achsen muessen scharf laufen.
export const PROD_ENV_EXEMPTIONS = Object.freeze({
  // Live faehrt Postgres; DATABASE_URL ist ein Secret und die Suite laeuft ohne
  // Netz und ohne DB. Der json-Store durchlaeuft dieselbe Store-Fassade.
  STORE_BACKEND: "die Suite laeuft offline ohne Postgres (DATABASE_URL ist ein Secret)",
  // Braucht ein Astro-Build im Arbeitsverzeichnis; beruehrt die Telefonie-Gate-Kette nicht.
  WEB_DIST_DIR: "setzt einen apps/web-Build voraus, der in der Suite nicht existiert",
  // Sonderfall: render.yaml fuehrt den Schluessel ausdruecklich leer (:212-213), und leer
  // ist ein Boot-Refusal (src/config.js:418-424 setzt bewusst KEINEN Nicht-leer-Default).
  // Belegt ist nur, DASS der Live-Wert nicht leer ist - der Live-Dienst bootet. Die exakte
  // Menge zeigt kein Log. Sie steuert die Klassifikation der Telnyx-Belege im
  // Cost-Truing-Sweep (src/billing/cost-truing.js:506), nicht Land-Gate, Tarif oder Decke;
  // der Sweep feuert in einem Spawn-Test ohnehin nie (test/helpers.js:238).
  COST_TRUING_REQUIRED_RECORD_TYPES:
    "Blueprint-Wert ist leer (= Boot-Refusal), exakter Live-Wert aus keinem Log ablesbar",
});

// Baut das Env-Overlay fuer einen Spawn aus einer der beiden Quellen: um die Exemptions
// bereinigt, plus Dummy-Secrets. startServer legt BASE_ENV darunter - die Exemptions
// behalten damit ihren neutralen BASE_ENV-Wert. EINE Bau-Stelle fuer beide Quellen (G5).
function spawnEnvFrom(source, overrides) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (key in PROD_ENV_EXEMPTIONS) continue;
    env[key] = value;
  }
  return { ...env, ...PROD_DUMMY_SECRETS, ...overrides };
}

// Env-Overlay unter den LIVE laufenden Werten. Das ist der Lauf, der Aussagen ueber
// Produktion traegt.
export function prodEnv(overrides = {}) {
  return spawnEnvFrom(LIVE_ENV, overrides);
}

// Env-Overlay unter dem BLUEPRINT. Ausschliesslich fuer den Divergenz-Befund - nicht als
// Grundlage fuer Gate-Aussagen verwenden.
export function blueprintEnv(overrides = {}) {
  return spawnEnvFrom(RENDER_ENV, overrides);
}

// Schluessel, deren BASE_ENV-Wert vom ausgelieferten Wert abweicht und die nicht als
// Infrastruktur-Substitution ausgenommen sind. Automatisch abgeleitet statt gepflegt
// (G27 Struktur statt Konvention): eine kuenftig neu in BASE_ENV neutralisierte Env-Var
// faellt hier ohne Zutun auf.
export function divergentGateKeys() {
  return Object.keys(LIVE_ENV).filter(
    (key) =>
      key in BASE_ENV &&
      !(key in PROD_ENV_EXEMPTIONS) &&
      String(BASE_ENV[key]) !== LIVE_ENV[key],
  );
}
