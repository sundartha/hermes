import dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CENTS_PER_EUR, MODEL_PRICE_RATE_FIELDS, setWorldDefaultLanguageEnabled } from "./store/defaults.js";
// GAP-07: boot-guard.js und telephony/stt-profile.js importieren ihrerseits nur
// import-freie bzw. Blatt-Module -> kein Zyklus, obwohl beide sonst downstream sitzen.
import { alertChannelFindings } from "./boot-guard.js";
import { DEFAULT_STT_PROFILE } from "./telephony/stt-profile.js";
import { DEFAULT_LLM_PROVIDER, LLM_PROVIDER, LLM_PROVIDER_VALUES } from "./llm/provider.js";
// G5: die Minute lebt in utils/timer.js (import-freies Blatt, kein Zyklus) - dieselbe
// Zahl, gegen die Abrechnung und Consult-Fristen rechnen. Stunde/Tag leiten hier ab.
import { MS_PER_MINUTE } from "./utils/timer.js";

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

// GQ-P2: Obergrenzen der beiden Consult-Fristen. numEnv klemmt (kein Fatal) - eine zu
// gross gesetzte Frist darf keine abgeschaltete Sicherung werden. Die kurze Frist wird in
// der laufenden Abrechnungsminute RESERVIERT (consultFitsBillingMinute): ueber einer
// Minute passt sie in keine mehr, die Rueckfrage waere strukturell tot (fail-closed). Die
// lange Frist begrenzt, wie alt eine noch angenommene Antwort sein darf - was spaeter
// kommt, gehoert in einen anderen Gespraechsabschnitt (Kein Fail-open).
const CONSULT_WAIT_MAX_MS = 60_000;
const CONSULT_OPEN_MAX_MS = 300_000;

// Sentinel fuer einen Boot ohne Deploy-Metadatum (lokal / fremder Host). Exportiert,
// damit Boot-Banner-, /healthz- und Testcode denselben Wert nutzen (G25/G5).
export const DEPLOYED_COMMIT_UNKNOWN = "unbekannt";

// Leere/abwesende Var -> dokumentierter Default (KEIN Fatal); nur gesetzt-aber-
// ungueltig ist fatal. max ist ein bewusster Clamp (Obergrenze wie
// TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS), kein Fehler. Die Diagnose nennt nur Var +
// Erwartung, NIE einen Wert (numEnv betrifft ausschliesslich numerische, nicht-geheime
// Vars -> kein Secret-Leak).
// Die Zahl aus dem GETRIMMTEN Rohwert - oder null, wenn der Wert keine ist.
// pattern.test faengt teil-numerischen Muell ("120abc"); Number.isFinite faengt
// zusaetzlich einen Ueberlauf gueltiger Ziffernketten auf Infinity.
function parseNumEnv(trimmed, integer) {
  const pattern = integer ? NUM_ENV_INTEGER_PATTERN : NUM_ENV_DECIMAL_PATTERN;
  const parsed = integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
  return pattern.test(trimmed) && Number.isFinite(parsed) ? parsed : null;
}

// Der Erwartungs-Teil der Diagnose. Wortlaut unveraendert; nennt nur Form und Minimum,
// nie einen Wert (Symmetrie zu boolEnv/enumEnv).
function numEnvExpectation(integer, min) {
  const art = integer ? "Ganzzahl" : "Zahl";
  return min === undefined ? art : `${art}, >= ${min}`;
}

export function numEnv(name, raw, { fallback, min, max, integer = true } = {}) {
  if (raw === undefined || raw === "") return fallback;
  // .trim() ZUERST: parseInt/parseFloat ignorieren Rand-Whitespace bereits; der
  // Voll-String-Check darf eine gueltige Env mit Trailing-Newline/Spaces NICHT als
  // Muell ablehnen (sonst Boot-Refusal beim naechsten Deploy, PM-4).
  const parsed = parseNumEnv(raw.trim(), integer);
  if (parsed === null) {
    fatalConfigErrors.push(
      `${name}="${raw}" ist keine gueltige Zahl (erwartet: ${numEnvExpectation(integer, min)}).`,
    );
    return fallback;
  }
  if (min !== undefined && parsed < min) {
    fatalConfigErrors.push(`${name}=${parsed} unterschreitet das Minimum ${min}.`);
    return fallback;
  }
  if (max !== undefined && parsed > max) return max; // bewusster Clamp auf die Obergrenze
  return parsed;
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

// ---- Aufzaehlungs-Env-Validierung (fail-closed, B5) ----
// Vierter Geschwister-Parser zu numEnv/boolEnv/isoInstantEnv, fuer Env-Werte aus einer
// geschlossenen Wertemenge. Gleiche Regel wie dort: abwesend/leer -> dokumentierter
// Default (KEIN Fatal), gesetzt-aber-unbekannt -> Fatal-Push + Fallback, also
// Boot-Refusal statt stillem Rueckfall. Ein vertipptes LLM_PROVIDER liefe sonst weiter
// auf dem Default-Anbieter, waehrend alle glauben, der andere sei aktiv.
//
// BEWUSSTE ABWEICHUNG von STT_PROFILE (das seine Pruefung in boot-guard.js hat, kein
// Versehen): das STT-Profil wird LAZY zur Render-Zeit gelesen, ein Guard nach den Imports
// reicht dort. Der LLM-Anbieter wird beim IMPORT von src/claude.js gelesen (Modul-Top:
// createLlmClient). In ESM laufen alle statischen Imports von server.js VOR jedem
// Boot-Code - ein Guard kaeme zu spaet, und der Operator saehe einen Stacktrace statt
// der [Konfiguration fatal]-Ausgabe.
export function enumEnv(name, raw, { allowed, fallback }) {
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  if (allowed.includes(trimmed)) return trimmed;
  fatalConfigErrors.push(`${name}="${raw}" ist unbekannt (gueltig: ${allowed.join("|")}).`);
  return fallback;
}

// ---- ISO-Zeitpunkt-Env-Validierung (fail-closed, KV-P0) ----
// Dritter Geschwister-Parser zu numEnv/boolEnv, fuer Env-Werte, die einen ZEITPUNKT
// tragen. Ein nacktes new Date() am Aufrufer genuegt nicht, aus zwei Gruenden:
//   1. new Date() ist zu grosszuegig - "0" ergibt den 01.01.2000, "1" den 01.01.2001.
//      Ein Vertipper wuerde still zu einem sehr alten Stichtag und damit (bei
//      BILLING_FLUSH_EPOCH) zur Freigabe des gesamten Altbestands.
//   2. Ein Zeitpunkt OHNE Zonenangabe ist mehrdeutig: "2026-08-04T00:00:00" liest Node
//      als LOKALE Zeit des Hosts. Die Zone ist deshalb Pflicht (Z oder +hh:mm).
// abwesend/leer -> null (dokumentierter "nicht gesetzt"-Zustand, KEIN Fatal); gesetzt,
// aber nicht in dieser Form -> Fatal-Push + null (Boot-Refusal statt stillem Riegel-Aus,
// Muster numEnv/boolEnv). Rueckgabe ist IMMER kanonisches UTC-ISO: der Vergleich gegen
// usage_event.occurredAt ist ein STRING-Vergleich und darf nie zwei Schreibweisen
// desselben Zeitpunkts gegeneinanderstellen. Die Diagnose nennt Var + erwartete Form.
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function isoInstantEnv(name, raw) {
  if (raw === undefined || raw === "") return null;
  const trimmed = raw.trim();
  const at = new Date(trimmed);
  if (!ISO_INSTANT_PATTERN.test(trimmed) || Number.isNaN(at.getTime())) {
    fatalConfigErrors.push(
      `${name}="${raw}" ist kein gueltiger ISO-8601-Zeitpunkt mit Zone (erwartet z.B. 2026-08-04T00:00:00Z).`,
    );
    return null;
  }
  return at.toISOString();
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
// Kalender-Faktoren als benannte Konstanten (G25) statt als Zahlenkette im Ausdruck.
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;

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

// Kommaliste -> getrimmte, nicht-leere Eintraege. EINE Quelle (G5) fuer die drei
// Listen-Envs (Laendervorwahlen, record_types, Admin-Mails); die Aufrufkette lebt damit
// hier statt dreimal am Ort (G36, Gesetz von Demeter). Fehlende Var -> leere Liste.
function csvEnv(raw) {
  return (raw || "")
    .split(",")
    .map((eintrag) => eintrag.trim())
    .filter(Boolean);
}

// Getrimmter Grossbuchstaben-Wert (Laendercode). Gleiche Begruendung wie csvEnv:
// die Kette gehoert in eine benannte Funktion, nicht in den Konfigurations-Ausdruck.
function trimmedUpper(raw) {
  return (raw || "").trim().toUpperCase();
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

// ---- Preisstaffeln der Sprachmodelle (B4a) ----------------------------------------
// Quelle und Abrufdatum EINMAL, damit `source` nicht je Eintrag abweichen kann (G5).
const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing.md";
const DEEPSEEK_PRICING_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing";

// Preisstaffeln je Modell-ID. Vier Raten je Staffel, KEIN Feld optional. Zwei
// Datumsfelder mit VERSCHIEDENER Bedeutung:
//   asOf      = wann WIR die Zahl gelesen haben (unsere Belegkette)
//   validFrom = ab wann der ANBIETER sie berechnet (seine Ankuendigung)
// Die Anker-Staffel traegt validFrom == asOf: wir behaupten kein Startdatum, das wir
// nicht beobachtet haben. Die Schreib-Rate ist die 5-MINUTEN-Rate, weil
// CACHE_CONTROL_EPHEMERAL (src/claude.js) KEIN ttl-Feld traegt und damit der
// Anbieter-Default gilt; die 1h-Rate wird bewusst NICHT mitgefuehrt (kein Aufrufer -
// eine Rate, die niemand liest, pflegt auch niemand). Ein ttl im Quelltext macht den
// Gate-Test in test/b4a-model-prices.test.js rot.
//
// Object.freeze ist hier unbedenklich - anders als an der AUFGELOESTEN Tabelle unten
// (s. modelPricesUsd): resolveModelPrices kopiert jede Staffel, nur die Kopie wird ein
// Blatt des guardedConfig-Proxys.
const MODEL_PRICE_SCHEDULES = Object.freeze({
  "claude-haiku-4-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 1.0,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
      outPerMTok: 5.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
  "claude-sonnet-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 2.0,
      cacheWritePerMTok: 2.5,
      cacheReadPerMTok: 0.2,
      outPerMTok: 10.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
    {
      validFrom: "2026-09-01",
      inPerMTok: 3.0,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
      outPerMTok: 15.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
  // B5: der Fremdanbieter. Raten abgerufen 2026-08-07 (PLAN-ANBIETER-PORT.md 1.2), am
  // 2026-08-08 im B1-Lauf gegen dieselbe Seite gegengelesen. Nur deepseek-v4-pro:
  // -flash unterstuetzt keine Werkzeuge (Anbieter-Doku) und koennte unsere Schleife
  // nicht fahren - eine Rate, die niemand waehlen kann, pflegt auch niemand.
  //
  // cacheWritePerMTok == inPerMTok ist KEINE Platzhalterzahl: DeepSeek hat keine eigene
  // Schreib-Rate, der Schreibvorgang steckt in prompt_cache_miss_tokens und ist dort zur
  // Fehltreffer-Rate bepreist (llm/ports.js LlmTokenUsage.inputCacheWriteTokens). Der
  // Adapter meldet auf dieser Sorte konstant 0; die Rate steht trotzdem ehrlich da, weil
  // worstCasePrice (state-ops.js) punktweise ueber ALLE Staffeln maximiert - eine 0
  // waere dort eine Behauptung, kein Messwert.
  //
  // Die Anbieterseite kuendigt eine Erhoehung an ("significant increase expected") -
  // stalePriceFindings (90 Tage) ist der Waechter, kein Ersatz fuer Nachpflegen.
  "deepseek-v4-pro": [
    {
      validFrom: "2026-08-07",
      inPerMTok: 0.435,
      cacheWritePerMTok: 0.435,
      cacheReadPerMTok: 0.003625,
      outPerMTok: 0.87,
      asOf: "2026-08-07",
      source: DEEPSEEK_PRICING_SOURCE,
    },
  ],
});

// Ein ISO-Kalendertag "YYYY-MM-DD" (G25). Der String-Vergleich auf GENAU dieser Form ist
// ordnungserhaltend - deshalb kommt in der Staffel-Aufloesung KEIN Date-Objekt und keine
// Zeitzonen-Rechnung vor (teuer gelernte Repo-Lehre zu fremden Uhrzeiten). Geprueft wird
// die FORM, nicht bloss die Laenge: "08.08.2026" ist ebenfalls 10 Zeichen lang und wuerde
// still falsch einsortiert - auf einer Geld-Achse ist "still falsch" der teuerste Ausgang.
const ISO_DATE_LENGTH = 10;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Der heutige Kalendertag (UTC). Die EINZIGE Uhr dieser Achse: sie tickt genau einmal,
// beim Bau von rawConfig. Die Buchungskante bleibt zeitfrei - ein nowIso in
// tokenCostUsd/aiCostCents haette zwei Uhren an derselben Buchung (trackUsage bekommt
// nowIso vom Aufrufer, recordUsageEvent stempelt selbst), und an einer Monatsgrenze
// koennten Gate-Achse und Ledger verschiedene Staffeln waehlen.
export function todayIsoDate() {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}

// Wirft benannt (P8), wenn eine Staffel nicht vollstaendig ist. Vier Raten sind PFLICHT:
// eine fehlende Rate ergaebe in tokenCostUsd NaN (0 * undefined), und NaN >= cap ist
// immer false - das Budget-Gate waere still AUS (Absolute Regel 1). Deshalb faellt der
// Fall hier auf, beim Boot, nicht im laufenden Anruf.
function assertScheduleEntry(modelId, entry) {
  if (!ISO_DATE_PATTERN.test(entry?.validFrom ?? ""))
    throw new Error(`modelPricesUsd: Staffel '${modelId}' ohne gueltiges validFrom (YYYY-MM-DD)`);
  for (const field of MODEL_PRICE_RATE_FIELDS) {
    const rate = entry[field];
    if (!Number.isFinite(rate) || rate < 0)
      throw new Error(
        `modelPricesUsd: Staffel '${modelId}' ab ${entry.validFrom} hat keine gueltige Rate ` +
          `${field} (${rate}) - vier Raten sind Pflicht`,
      );
  }
}

// Die heute geltende Staffel: die mit dem GROESSTEN validFrom, das nicht in der Zukunft
// liegt. Bewusst nicht "die letzte im Array" - eine Sortier-Konvention, die niemand
// erzwingt, waere Disziplin statt Struktur (G27). null = keine faellige Staffel.
function activeSchedule(entries, todayIso) {
  return entries
    .filter((entry) => entry.validFrom <= todayIso)
    .reduce((latest, entry) => (latest === null || entry.validFrom > latest.validFrom ? entry : latest), null);
}

// Die naechste noch nicht faellige Staffel - REINE DIAGNOSE fuers Boot-Banner, kein
// Rechner liest sie. null = keine weitere hinterlegt.
function nextValidFrom(entries, todayIso) {
  const future = entries.filter((entry) => entry.validFrom > todayIso).map((entry) => entry.validFrom);
  return future.length ? future.reduce((min, date) => (date < min ? date : min)) : null;
}

// Loest die Staffeln auf EINEN Kalendertag auf: Modell-ID -> vier Raten + Diagnosefelder
// (validFrom/asOf/source/nextValidFrom). Rein (die Uhr ist Parameter) und damit ohne Uhr
// testbar. Wirft benannt, wenn nichts hinterlegt ist, ein Modell fuer heute keine Staffel
// hat oder eine Staffel unvollstaendig ist - jeder dieser Faelle ist ein Boot-Abbruch,
// kein stiller Rueckfall. Alle drei sind nur durch eine Quelltext-Aenderung erreichbar,
// nicht ueber die Umgebung; deshalb ist der Abbruch bewusst ein throw beim Modul-Laden
// (fruehestmoeglich, fail-closed) und keine [boot]-formatierte Zeile.
export function resolveModelPrices(schedules, todayIso) {
  const modelIds = Object.keys(schedules);
  if (!modelIds.length)
    throw new Error(
      "modelPricesUsd: keine Preisstaffel hinterlegt - keine Preisquelle fuer den Budget-Guard (Regel 1)",
    );
  const resolved = {};
  for (const modelId of modelIds) {
    const entries = schedules[modelId];
    for (const entry of entries) assertScheduleEntry(modelId, entry);
    const active = activeSchedule(entries, todayIso);
    if (!active)
      throw new Error(
        `modelPricesUsd: Modell '${modelId}' hat am ${todayIso} keine gueltige Preisstaffel ` +
          "(kein validFrom liegt in der Vergangenheit)",
      );
    resolved[modelId] = { ...active, nextValidFrom: nextValidFrom(entries, todayIso) };
  }
  return resolved;
}

// EIN ElevenLabs-Konto, EIN Schluessel, EINE Basis. Beide Verbraucher (Play-TTS-Synthese
// und der Convai-Anrufstart) sprechen dasselbe Konto an, deshalb entsteht der Wert genau
// hier EINMAL und wird in beide Gruppen gereicht (G5) - zwei getrennte Env-Saetze waeren
// zwei Wahrheiten ueber dasselbe Konto. .trim() gegen ein eingefuegtes Newline (ein
// Schluessel, der nie passt), stripTrailingSlash gegen die doppelte Schraegstrich-URL.
const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const ELEVENLABS_API_BASE = stripTrailingSlash(
  (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").trim(),
);

const rawConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  // B5: WELCHER Sprachmodell-Anbieter faehrt diesen Prozess (llm/provider.js). Ein
  // unbekannter Wert bricht den Boot ab (enumEnv -> fatalConfigErrors -> assertConfig),
  // er faellt NICHT still auf den Default zurueck.
  llmProvider: enumEnv("LLM_PROVIDER", process.env.LLM_PROVIDER, {
    allowed: LLM_PROVIDER_VALUES,
    fallback: DEFAULT_LLM_PROVIDER,
  }),
  // B5: Schluessel des Fremdadapters. Boot-Pflicht NUR bei LLM_PROVIDER=deepseek
  // (assertConfig) - sonst ist leer der Normalfall.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  // B4a: MUSS eine Preisstaffel in MODEL_PRICE_SCHEDULES haben - sonst bricht der Boot ab
  // (assertPricedModels, src/boot.js). Eine DATIERTE Snapshot-ID ist ein ANDERER Schluessel.
  claudeModel: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
  // Ganzzahl-Cents (G26: Geld nie als Fliesskomma) - Env-Name bleibt MAX_BUDGET_EUR
  // (Operator gibt weiter EUR ein), interne Einheit ist Cents wie defaultTenantBudgetCents/
  // hardCapCents (einheitlicher Typ verhindert Einheiten-Mix).
  //
  // KS-P9/E10: KEIN Gate mehr. Die Plattform-Achse sperrt nichts; dieser Wert ist die
  // Bezugsgroesse der Schwellenwarnung (platformSpendWarnPercent) und - bei Sentinel
  // defaultTenantBudgetCents=0 - der PRO-TENANT-Fallback in effectiveCapCents Stufe (3).
  // Fallback-Wert 30 ist der live gefahrene Wert.
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
  // Modell des briefenden Aufrufs. MUSS eine Preisstaffel haben - seit B4a bricht der
  // Boot sonst ab (assertPricedModels), statt fail-closed zur teuersten Rate zu buchen.
  // Geprueft wird UNABHAENGIG von precallBriefingEnabled. Sonnet statt Opus: das
  // Briefing ist eine Struktur-Extraktion aus kurzem Owner-Text.
  briefingModel: process.env.PRECALL_BRIEFING_MODEL || "claude-sonnet-5",
  // Eigener kurzer Per-Request-Timeout: POST /api/calls wartet synchron darauf, BEVOR
  // gewaehlt wird; kein Retry (maxRetries 0) -> das ist die gesamte Wartezeit im
  // schlechtesten Fall. Bewusst NICHT an llmRequestTimeoutMs gekoppelt: dort regiert das
  // 15-s-Provider-Hardcut eines laufenden Turns, hier die Geduld des Aufrufers.
  briefingTimeoutMs: numEnv("PRECALL_BRIEFING_TIMEOUT_MS", process.env.PRECALL_BRIEFING_TIMEOUT_MS, {
    fallback: 6000,
    min: 1,
  }),

  // ---- Gespraechs-Zusammenfassung (FIX-1, src/claude.js summarizeCall) ----
  // Eigener Per-Request-Timeout der NACHBEREITUNG. Bewusst NICHT llmRequestTimeoutMs:
  // dort regiert der 15-s-Hardcut eines laufenden Provider-Webhooks (src/turn-budget.js).
  // Die Zusammenfassung laeuft aber DETACHED - telephony/call-termination.js stoesst
  // bill() fire-and-forget an, der Webhook ist da laengst beantwortet. Der geerbte
  // 3500-ms-Wert konnte eine 800-Token-Antwort strukturell nie tragen: gegen die echte
  // Anbieter-API mit exakt den Parametern von summarizeCall gemessen 7745/8856/8985 ms
  // (drei Laeufe, stop_reason max_tokens). 20000 ms sind gut das Doppelte des
  // schlechtesten Messwerts - Reserve fuer Lastspitzen, ohne dass ein haengender Aufruf
  // beliebig lange einen Socket haelt.
  // Dieser Wert geht in KEINE Webhook-Budget-Rechnung ein: src/turn-budget.js und die
  // Boot-Waechter in src/boot.js lesen ausschliesslich llmRequestTimeoutMs.
  summaryTimeoutMs: numEnv("CALL_SUMMARY_TIMEOUT_MS", process.env.CALL_SUMMARY_TIMEOUT_MS, {
    fallback: 20000,
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

  // ---- Nachschlagen IM Gespraech (AL-P10b, src/research/in-call.js) ----
  // Master-Schalter. DEFAULT AUS (fail-closed): look_up erscheint nicht im tools-Array,
  // Prompt und Werkzeugsatz sind byte-identisch zum Bestand, es entsteht keine Gebuehr
  // und kein Egress. EIGENER Schalter neben RESEARCH_ENABLED, weil die Exposition eine
  // andere ist: hier geht eine im Gespraech entstandene Frage an einen ZWEITEN
  // Auftragsverarbeiter (Exa), nicht Auftragsmaterial an Anthropic.
  // Wirkt nur als Schnittmenge mit ASSISTANT_CONTEXT_ENABLED, dem Per-Tenant-Recht
  // allowLookup (Profil) und einem gesetzten EXA_API_KEY.
  lookupEnabled: boolEnv("LOOKUP_ENABLED", process.env.LOOKUP_ENABLED, { fallback: false }),
  // Preis EINER In-Call-Suche in GANZZAHL Cents, dieselbe Achse wie alle anderen Kosten.
  // Wird VOR dem Absenden gebucht (eine ausgeloeste Suche ist bezahlt, auch ohne Antwort).
  // BELEGT gegen die Exa-Preisliste (exa.ai/docs/reference/pricing, 2026-08-01):
  // $7/1k Anfragen (inkl. bis 10 Treffer) + $1/1k Seiten fuer contents -> bei 3 geholten
  // Treffern 0,7 + 3 x 0,1 = genau 1,0 US-Cent. KEIN Puffer: Formel Cent = 0,7 + 0,1 x
  // Trefferzahl; ab 4 Treffern muss dieser Wert steigen. Der Test AL-P10c-3 haelt die
  // Relation zu LOOKUP_MAX_FACTS fest, damit sie nicht still auseinanderlaeuft.
  lookupSearchFeeCents: numEnv("LOOKUP_SEARCH_FEE_CENTS", process.env.LOOKUP_SEARCH_FEE_CENTS, {
    fallback: 1,
    min: 0,
  }),
  // SECRET, nie loggen/leaken (Regel 4). Leer = Feature fail-closed inaktiv, auch bei
  // LOOKUP_ENABLED=true. .trim() gegen pasted Newline (Muster elevenLabs apiKey).
  exaApiKey: (process.env.EXA_API_KEY || "").trim(),
  // Anbieter-Basis, ausschliesslich damit Tests gegen einen lokalen Mock laufen koennen
  // (Muster ELEVENLABS_API_BASE / ANTHROPIC_BASE_URL) - im Betrieb nie setzen.
  exaApiBase: stripTrailingSlash((process.env.EXA_API_BASE || "https://api.exa.ai").trim()),

  // ---- Mess-Instrumentierung (L0, src/metrics.js) ----
  // Master-Schalter fuer PII-freie Latenz-/Loop-/STT-Gap-Logs. DEFAULT AUS
  // (byte-identisch, auch stdout): Konsumenten no-oppen. Zum Live-Messen (Datengrundlage
  // fuer L1) am Host auf "true" setzen - reine Diagnose, beruehrt KEINE Safety-Gates,
  // KEINE Disclosure, KEINE Resilienz-Werte. Tests pinnen das via BASE_ENV.
  metricsEnabled: boolEnv("METRICS_ENABLED", process.env.METRICS_ENABLED, { fallback: false }),

  // Absendernummern kommen NICHT mehr aus der config: der Owner ist
  // Tenant Null und haelt seine Nummer(n) wie jeder Tenant im Store (s.numbers),
  // einmalig eingetragen via scripts/seed-owner-number.js. Boot-Guard in server.js
  // verlangt fail-closed eine aktive Owner-Nummer.

  // ---- Telnyx (zweiter Provider, P5; alle optional) ----
  telnyxApiKey: process.env.TELNYX_API_KEY || "", // SECRET - nie loggen/leaken
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY || "", // Ed25519-Public-Key des Telnyx-Accounts (verify)
  telnyxApiBase: stripTrailingSlash(process.env.TELNYX_API_BASE || "https://api.telnyx.com"),
  // TeXML-Application/Connection-ID: haelt die Voice-URL beim Provider, Pflicht fuer
  // Telnyx-Outbound (originateCall POST /v2/texml/calls/{connection_id}). Leer ->
  // Telnyx-Outbound wirft (fail-closed).
  // NICHT verwechseln mit telnyxCallControlAppId (s.u.): Telnyx kennt ZWEI getrennte
  // Objekttypen (TeXML-Application vs. Call-Control-Application) mit eigenen IDs. Die
  // TeXML-ID hier traegt zusaetzlich das Voice-Routing gekaufter Nummern (provisioning-geo).
  telnyxConnectionId: process.env.TELNYX_CONNECTION_ID || "",
  // Telnyx-Account-ID (Mission-Control-Portal): Pflicht fuer den Telnyx-Hangup
  // (POST /v2/texml/Accounts/{account_sid}/Calls/{call_sid}). Leer -> endCall wirft.
  telnyxAccountSid: process.env.TELNYX_ACCOUNT_SID || "",
  // GQ-P6: wie lange Telnyx auf das Abheben wartet, bevor es mit hangup_cause=timeout
  // aufgibt (POST /v2/calls, Feld timeout_secs). Anbieter-Doku: "Minimum value is 5
  // seconds. Maximum value is 600 seconds", **Default 30**.
  // Wir haben das Feld nie gesetzt und liefen damit auf den 30-s-Default. Live gemessen
  // am 2026-08-05: die Zustellung von der US-DID nach DE braucht rund 30 Sekunden, bis es
  // beim Ziel ueberhaupt klingelt - call_msfqk80elik1 wurde bei 30,5 s gerade noch
  // angenommen, call_msftumfim338 lief bei 31,7 s in den Timeout, ohne je zu klingeln.
  // Die Provider-Frist und die Zustelldauer kollidierten also frontal.
  // Das ist eine MILDERUNG, nicht die Wurzel: die eigentliche Ursache der langsamen
  // Zustellung ist die US-Absendernummer (FORCE_NUMBER_COUNTRY=US), Abhilfe waere eine
  // +49-DID (siehe telnyx-fresh-did-no-de-routing). Laenger warten kostet nichts, solange
  // niemand abhebt - Telnyx berechnet erst ab dem Abheben.
  telnyxDialTimeoutSecs: numEnv("TELNYX_DIAL_TIMEOUT_SECS", process.env.TELNYX_DIAL_TIMEOUT_SECS, {
    fallback: 60,
    min: 5,
    max: 600,
  }),
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
    apiKey: ELEVENLABS_API_KEY, // SECRET, nie loggen/leaken
    voiceId: (process.env.ELEVENLABS_VOICE_ID || "").trim(),
    model: (process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5").trim(), // Latenz-optimiert
    apiBase: ELEVENLABS_API_BASE,
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

  // Rueckfrage-Webhook des ElevenLabs-Conversational-Agents (Werkzeug get_consult,
  // POST /webhooks/elevenlabs/consult): das geteilte Geheimnis, das der Agent im Header
  // x-hermes-tool-token schickt. SECRET - nie loggen, nie in eine Antwort. LEER =
  // fail-closed: der Endpunkt lehnt JEDEN Aufruf ab. Er braucht dieses Geheimnis, weil
  // ElevenLabs Werkzeug-Webhooks NICHT signiert (es gibt nur frei konfigurierbare Header) -
  // es ist die einzige Sicherung eines von aussen erreichbaren Endpunkts, der in ein
  // laufendes, kostendes Gespraech hineinwirkt. .trim() wie bei den ElevenLabs-Schluesseln
  // oben: ein eingefuegtes Newline waere sonst ein Geheimnis, das nie passt.
  elevenLabsToolToken: (process.env.ELEVENLABS_TOOL_TOKEN || "").trim(),

  // ---- ElevenLabs-Anrufstart (Convai SIP-Trunk-Outbound; optional) ----
  // Dritter Outbound-Weg neben TeXML und Telnyx-Call-Control: das Gespraech fuehrt der
  // Agent des ANBIETERS. Der PROVIDER des Anrufs bleibt telnyx - die DID liegt dort,
  // ElevenLabs haengt per SIP-Trunk daran; es ist ein ENGINE-Zweig, kein zweiter Anbieter.
  // Der Weichenschalter steht DEFAULT AUS (fail-closed, Muster TELNYX_AI_ASSISTANT_ENABLED):
  // aus -> jeder Anruf laeuft unveraendert ueber die Telnyx-Zweige.
  elevenLabsOutbound: {
    enabled: boolEnv("ELEVENLABS_OUTBOUND_ENABLED", process.env.ELEVENLABS_OUTBOUND_ENABLED, {
      fallback: false,
    }),
    // Opake Kennungen aus dem ElevenLabs-Konto: der angelegte Agent und die dort
    // registrierte Absendernummer. KEIN Secret, aber deployment-spezifisch. .trim() wie
    // bei den Schluesseln oben. Bei aktivem Schalter sind beide Pflicht - fehlt eine,
    // waehlt der Zweig NICHT (fail-closed, s. src/elevenlabs/outbound.js).
    agentId: (process.env.ELEVENLABS_AGENT_ID || "").trim(),
    agentPhoneNumberId: (process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID || "").trim(),
    // Abholtakt des ZIEHENDEN Ergebniswegs (GET /v1/convai/conversations/{id}): der
    // Anbieter meldet das Gespraechsende nicht an uns, wir holen es ab. Untergrenze 100 ms,
    // damit ein vertippter Wert keine Abruf-Schleife im Millisekundentakt erzeugt
    // (Anbieter-Rate-Limit); Default 5 s als Kompromiss aus Latenz und Abruf-Volumen.
    resultPollMs: numEnv("ELEVENLABS_RESULT_POLL_MS", process.env.ELEVENLABS_RESULT_POLL_MS, {
      fallback: 5000,
      min: 100,
      max: 60000,
    }),
    // EIN Konto, EIN Schluessel, EINE Basis (s. Kommentar an der Konstante oben).
    apiKey: ELEVENLABS_API_KEY, // SECRET, nie loggen/leaken
    apiBase: ELEVENLABS_API_BASE,
    // Thema A (2026-08-19): Notaus fuer die LLM-VORAB-ERZEUGUNG der Eroeffnungszeile
    // (src/elevenlabs/opening-line-llm.js). Default AN - die Erzeugung ist der Kern des
    // Features und ihr Ausfall degradiert ohnehin fail-closed auf den Anruf-8-Wortlaut.
    // Der Schalter existiert, damit ein schaedlich gemessener Zweit-LLM-Aufruf auf dem
    // Anrufpfad abschaltbar ist, OHNE den ganzen EL-Weg zu opfern (Review-Befund R5).
    openingLineLlm: boolEnv(
      "ELEVENLABS_OPENING_LINE_LLM_ENABLED",
      process.env.ELEVENLABS_OPENING_LINE_LLM_ENABLED,
      { fallback: true },
    ),
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
    // Nur im Assistant-Pfad wirksam (Flag aus -> nie armiert). Min 5, max 300: ein
    // Dead-Air-Watchdog jenseits von 5 Minuten ist keine Bremse mehr, sondern inert
    // (dieselbe Footgun-Logik wie min 5). Bewusst NICHT mehr aus MAX_CALL_DURATION_CAP_S
    // abgeleitet - seit KS-P3 ist die Gespraechsfrist guthaben-abgeleitet, ein daran
    // gekoppeltes Watchdog-Maximum waere eine Kopplung ohne Sachgrund.
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
    // AL-P7: echtes Token-Streaming des Shim-Turns. DEFAULT AUS (fail-closed): aus heisst
    // byte-identisch zum Bestand - agentTurn bekommt keinen Satz-Abnehmer, llm.js streamt
    // nicht, die SSE-Antwort ist wieder EIN content-Chunk. Wirkt nur zusammen mit einem
    // Request, der stream:true verlangt (Telnyx tut das live). Kein Footgun-Eintrag: das
    // Flag entwaffnet keine Sicherung, es aendert nur die Draht-Kadenz.
    shimTokenStreaming: boolEnv(
      "TELNYX_SHIM_TOKEN_STREAMING",
      process.env.TELNYX_SHIM_TOKEN_STREAMING,
      { fallback: false },
    ),
    // GQ-P1 (Befund B-1): Riegel gegen ZWEI gesprochene Antworten auf EINE Aeusserung.
    // Die Spracherkennung liefert kumulative Zwischenstaende; ein Request, dessen Text den
    // Vorgaenger nur fortschreibt (Sonde A: prevRelation "extends"), beantwortet dieselbe
    // Aeusserung ein zweites Mal. Laeuft der Vorgaenger-Turn dann noch UND hat er noch
    // nichts gesprochen, wird er verdraengt: er spricht nicht, schreibt keine agent-Zeile
    // und antwortet mit einer leeren, gueltigen Completion.
    // DEFAULT AN - bewusst ANDERS als die uebrigen Shim-Flags. Der Schalter entwaffnet
    // KEINE Sicherung (er entscheidet nur, WELCHER von zwei Turns spricht); "aus" ist der
    // fehlerhafte Bestand mit Doppelrede. Umlegen stellt den Bestand ohne Deploy wieder her.
    shimSupersedeExtendedTurn: boolEnv(
      "TELNYX_SHIM_SUPERSEDE_EXTENDED_TURN",
      process.env.TELNYX_SHIM_SUPERSEDE_EXTENDED_TURN,
      { fallback: true },
    ),
    // GQ-P5 (Befund N-1): Riegel gegen den Provider-Anstoss. Telnyx stoesst nach
    // telephony_settings.user_idle_reply_secs Sekunden Anrufer-Stille selbst einen Turn an
    // (Anbieter-Schema: "the assistant will prompt the user to respond"); dieser POST traegt
    // keine neue Aeusserung, sondern endet auf einer System-Nachricht. Der Shim las nur die
    // letzte user-Rolle, beantwortete die ALTE Aeusserung erneut und sprach sie aus - die
    // eigene Sprechzeit ist wieder Stille, also folgte der naechste Anstoss. Am Live-Anruf
    // call_msf0epenyv9g sechs Runden ("Ich warte still.").
    // DEFAULT AN - bewusst wie shimSupersedeExtendedTurn, anders als die uebrigen
    // Shim-Flags: "aus" ist der gemessene Fehlerzustand, nicht der sichere Bestand.
    // Umlegen stellt ihn ohne Deploy wieder her (Render-Dashboard).
    // Er entwaffnet KEINE Sicherung: Loop-Guard, Rate-Gate und die pro-Tenant-Kostendecke
    // liegen VOR dieser Entscheidung, der Dead-Air-Notaus wird weiter gefuettert (der
    // Anstoss bleibt ein Lebenszeichen) -> kein assertConfig-/Footgun-Eintrag.
    shimIgnoreProviderNudge: boolEnv(
      "TELNYX_SHIM_IGNORE_PROVIDER_NUDGE",
      process.env.TELNYX_SHIM_IGNORE_PROVIDER_NUDGE,
      { fallback: true },
    ),
    // GQ-P3 (Befund B-9, Owner-Entscheidung O-1): schaltet den INBOUND-Handoff auf den
    // Call-Control-Assistant. Der Master-Schalter oben (TELNYX_AI_ASSISTANT_ENABLED) hat
    // Inbound nie erreicht - er stand live auf true, waehrend jeder eingehende Anruf ueber
    // die Budget-Engine lief, weil der erwartete TeXML-Feldname geraten und falsch war.
    // DEFAULT AN - bewusst wie shimSupersedeExtendedTurn, anders als die uebrigen
    // Shim-Flags: dieser Schalter ist der RUECKWEG der Phase, nicht ihr Ausloeser. "aus"
    // stellt die Budget-Engine fuer Inbound OHNE Deploy wieder her (Render-Dashboard).
    // Er entwaffnet KEINE Sicherung: Kostendecke (beide Richtungen), OUTBOUND_FROZEN,
    // Denylist, Land-Gate, Stundenlimit, Max-Dauer und die Ed25519-Signaturpruefung
    // liegen samt und sonders VOR dieser Entscheidung und sind von ihr unerreichbar ->
    // kein assertConfig-/Footgun-Eintrag (Muster shimTokenStreaming).
    // KOSTENFOLGE, ausdruecklich: der Assistant-Pfad kostet nach eigener Messung (KV-M1)
    // ~5 US-Cent je angefangener Minute gegen 1,87 auf der Budget-Engine - Inbound wird
    // rund dreimal teurer. Vom Owner am 2026-08-04 zugestimmt; gedeckelt bleibt es allein
    // durch die pro-Tenant-Kostendecke, die seit KV-P2 auch Inbound sperrt.
    // DEFAULT AUS seit 2026-08-04: der Handoff feuert zu FRUEH. Am Live-Anruf gemessen
    // (call_msf0q18o473z / call_msf0qch6nect): auf `inbound_path path=assistant` folgt
    // 370 ms spaeter `HTTP 422 (90034 Call not answered yet)` - die Call-Control-API
    // verlangt einen bereits ANGENOMMENEN Anruf, waehrend TeXML beim Inbound implizit
    // annimmt. Der Anrufer hoert daraufhin nur die Fehleransage. Der Handoff muss auf
    // das answered-Ereignis warten, bevor er startet; bis dahin bleibt Inbound auf der
    // Budget-Engine (Bestandsverhalten, funktionsfaehig).
    inboundHandoffEnabled: boolEnv(
      "TELNYX_INBOUND_HANDOFF_ENABLED",
      process.env.TELNYX_INBOUND_HANDOFF_ENABLED,
      { fallback: false },
    ),
    // GQ-P4 (Befund B-10, A2): wie viele Modell-Turns desselben Calls UNMITTELBAR
    // nacheinander scheitern duerfen, bevor der Agent hoerbar und hoeflich beendet.
    // Am 2026-08-04 lief ein Anruf 52 Sekunden mit SIEBEN gescheiterten Turns weiter -
    // stumm fuer den Owner, teuer auf der Carrier-Achse.
    // KONSEKUTIV: jeder erfolgreiche Turn setzt zurueck.
    // min 2 ist die harte Untergrenze der Phase ("ein einzelner Ausrutscher darf kein
    // Gespraech beenden"); max 10, weil der Notaus darueber inert waere (Muster
    // loopGuardMaxEmptyTurns). Fallback 3: bei den live gemessenen ~11 s je erschoepftem
    // Turn ([metrics] llm retries-exhausted latencyMs 11215) sind das rund 35 s Ausfall -
    // lang genug fuer einen Ausrutscher, kurz genug gegen die 52 s des Vorfalls.
    // Der Wert SCHWAECHT KEINE Sicherung (er beendet ZUSAETZLICH; Max-Dauer, Dead-Air und
    // Budget-Kill bleiben unberuehrt) -> kein assertConfig-/Footgun-Eintrag.
    maxConsecutiveFailedTurns: numEnv(
      "TELNYX_MAX_CONSECUTIVE_FAILED_TURNS",
      process.env.TELNYX_MAX_CONSECUTIVE_FAILED_TURNS,
      { fallback: 3, min: 2, max: 10 },
    ),
    // GQ-P4 (A2): Abschiedssatz bei anhaltendem Ausfall. LEER = der sprachabhaengige
    // Default aus dem Locale-Bundle (locales.js llmGiveUpFarewell, korrekte Umlaute je
    // Sprache) - das ist der empfohlene Betrieb. Ein gesetzter Wert ueberschreibt ihn fuer
    // JEDE Sprache; im mehrsprachigen Betrieb also nur mit Bedacht setzen.
    // GESPROCHENER Text: korrekte Umlaute, kein Fachjargon, keine Schuldzuweisung, keine
    // technischen Codes gegenueber der Gegenstelle.
    failedTurnFarewellText: process.env.TELNYX_FAILED_TURN_FAREWELL_TEXT || "",
    // GQ-P18: wie lange der Sprech-Draht eines Shim-Turns zurueckgehalten wird, in
    // Millisekunden. Die Spracherkennung (deepgram/nova-3) liefert eine Aeusserung in
    // mehreren POSTs; jeder POST loeste einen vollen Turn aus - am 2026-08-09 zwei
    // unabhaengige look_up-Recherchen und zwei gesprochene Wetterberichte mit
    // widersprechenden Zahlen. Fuer nova-3 existiert KEIN Turn-End-Regler beim Anbieter (die
    // eot_*-Werte unserer Live-Config gelten nur fuer deepgram/flux, und der Pro-Call-Block
    // kann laut OpenAPI ueberhaupt nur model+language tragen), also liegt der Hebel bei uns.
    // Solange nichts gesprochen wurde, kann ein Request mit fortgeschriebenem Text den
    // laufenden Turn stumm ueberholen (telnyx-turn-supersede.js) - genau dieses Fenster
    // haelt der Wert offen.
    // Er VERZOEGERT KEINE ANTWORT: spaetestens am Turn-Ende geht alles raus. Der Preis
    // faellt nur bei Turns an, die laenger dauern als die Frist - dort kommt das ERSTE Wort
    // um bis zu diese Frist spaeter. 0 = aus (Rueckweg ohne Deploy, Bestandsverhalten).
    // 3000 deckt 7 der 11 gemessenen Fragment-Luecken (1314-5476 ms); die hold-Log-Zeile
    // (outcome silenced/released/flushed) ist die Datengrundlage zum Trimmen.
    // max 3500, weil die Frist sonst in Telnyx' eigenes Anstoss-Fenster laeuft
    // (telephony_settings.user_idle_reply_secs, Live-Wert 4 s).
    // Sie entwaffnet KEINE Sicherung: Loop-Guard, Rate-Gate, Kostendecke und Anstoss-Riegel
    // liegen VOR ihr, der Dead-Air-Notaus wurde bereits gefuettert (observeTurn) -> kein
    // assertConfig-/Footgun-Eintrag (Muster shimTokenStreaming); der Clamp deckelt den Rest.
    shimExtendHoldMs: numEnv("TELNYX_SHIM_EXTEND_HOLD_MS", process.env.TELNYX_SHIM_EXTEND_HOLD_MS, {
      fallback: 3000,
      min: 0,
      max: 3500,
    }),
    // Messschalter fuer EINE unbelegte Anbieter-Frage (s. transcriptionFields, adapters/
    // telnyx/voice.js): ob der Pro-Call-transcription-Block das Assistant-eigene
    // transcription-Objekt ERSETZT oder in es hineinMERGED, sagt die Telnyx-Doku nicht.
    // DEFAULT AN = Bestand byte-identisch (der Block wird weiter gesendet). "false" bringt
    // transcriptionFields dazu, IMMER {} zu liefern - ausschliesslich fuer EINEN begleiteten
    // Testanruf, danach zurueckstellen. Kein Dauerbetrieb, kein assertConfig-/Footgun-
    // Eintrag: der Schalter entwaffnet keine Sicherung, er aendert nur, ob ein optionales
    // JSON-Feld mitgesendet wird.
    perCallTranscriptionEnabled: boolEnv(
      "TELNYX_PER_CALL_TRANSCRIPTION_ENABLED",
      process.env.TELNYX_PER_CALL_TRANSCRIPTION_ENABLED,
      { fallback: true },
    ),
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
  // ---- Flush-Stichtag (KV-P0): Riegel vor der Ein-Klick-Nachmeldung ----
  // Aeltester Zeitpunkt, den POST /api/billing/flush-meters an Stripe melden DARF
  // (usage_event.occurredAt >= diesem Wert, inklusiv). NICHT GESETZT = null = es wird
  // NICHTS gemeldet. Die Fail-Richtung ist "meldet nichts", NIEMALS "meldet alles" -
  // das ist der ganze Zweck des Wertes.
  // Hintergrund: der Ledger traegt Zeilen aus dem Vorbetrieb (Stand 2026-08-03: 138 nie
  // gemeldete, darunter Inbound-Minuten zum alten 300-ct-Worst-Case-Tarif und zwei als
  // number_month etikettierte Einrichtungsgebuehren). Der Endpunkt ist scharf
  // (PAYMENT_ENABLED live true) und wuerde bei EINEM Aufruf alles auf einmal melden.
  // NIE ZURUECKDATIEREN: der Wert ist ein Riegel vor genau diesen Altzeilen, kein
  // Berichtsfenster. Es gibt bewusst keinen Ausloeser fuer den Flush (kein Cron, kein
  // Sweep-Hook) - eine nutzungsbasierte Weiterbelastung findet nicht statt (README).
  flushEpochIso: isoInstantEnv("BILLING_FLUSH_EPOCH", process.env.BILLING_FLUSH_EPOCH),
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
    fallback: MS_PER_HOUR,
    min: MS_PER_MINUTE,
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
  costTruingRequiredRecordTypes: csvEnv(process.env.COST_TRUING_REQUIRED_RECORD_TYPES),
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
  costAlertDebounceMs: numEnv("COST_ALERT_DEBOUNCE_MS", process.env.COST_ALERT_DEBOUNCE_MS, { fallback: MS_PER_DAY, min: 0 }),
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
  // voiceMinuteCostCents auf. KS-P5a/E5a: seit dieser Phase leitet DERSELBE Satz auch die
  // Plan-Kostendecke ab (billing/plan-caps.js) - der fruehere zweite Deckel-Basissatz
  // VOICE_CAP_RATE_CENTS_PER_MIN ist ersatzlos entfallen, weil zwei Zahlen fuer dieselbe
  // Sache auseinanderliefen (Starter bekam 10 statt 30 verkaufter Minuten). Ein Satz von 0
  // schaltet die Kosten-Achse ab; die Decken-Ableitung ist dann ein No-op (s.
  // deriveTenantBudgetFromPlan), NIE eine 0-Decke.
  // Inland = DIESELBE dieser Vorwahlen (voiceTariffDomesticPrefixes)
  // an Ziel UND Absender; alles andere Worst-Case-Default. Konservativ gesetzt; live mit
  // dem Provider-Tarif abgleichen.
  voiceTariffDomesticCents: numEnv("VOICE_TARIFF_DOMESTIC_CENTS", process.env.VOICE_TARIFF_DOMESTIC_CENTS, {
    fallback: 20,
    min: 0,
  }),
  // KS-P6/E1: 30 statt vormals 300. Der alte Wert war eine Annahme, keine Messung - 21
  // Live-Anrufe (US-DID -> DE-Mobil, vollstaendige Telnyx-Belege) ergaben 8,18 ct je
  // ANGEFANGENER Minute (Spanne 3,89-9,23); der Fallback lag um Faktor 37 darueber und
  // reservierte fuer einen 3-Minuten-Anruf 9,00 statt 0,90 EUR. 30 ct/min sind rund das
  // 3,7-Fache des gemessenen Ist und decken auch Ziele ab, die teurer sind als DE.
  // Fuer DIESEN Satz gibt es KEINE Untergrenze im Code: min:0 laesst 0 zu, spendCapCoherence
  // prueft nur nach oben, und voiceTariffFloorFindings bewacht ausschliesslich
  // VOICE_TARIFF_DOMESTIC_CENTS. Eine Untergrenze waere eine eigene Aufgabe, keine dieser.
  voiceTariffDefaultCents: numEnv("VOICE_TARIFF_DEFAULT_CENTS", process.env.VOICE_TARIFF_DEFAULT_CENTS, {
    fallback: 30,
    min: 0,
  }),
  // KV-P2 (tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md): Minutensatz eines INBOUND-Legs
  // (GANZZAHL EUR-Cent/min, G26). EIGENER Wert statt tariffCentsPerMin(to, to): der dort
  // gezogene Satz ist der Preis eines von UNS GEWAEHLTEN Ziels - an einer US-DID also der
  // Auslands-Worst-Case (30). KV-M1 hat einen kontrollierten Inbound-Anruf vollstaendig
  // vermessen: 1,87 US-Cent je ANGEFANGENER Minute (x 0,92 = 1,72 EUR-Cent), davon 71 %
  // speech-to-text, 17 % sip-trunking, 11 % call-control. 30 waeren 16-fach ueberhoeht und
  // sperrten einen Starter-Kunden nach 50 Inbound-Minuten bei realen Kosten von 86 Cent.
  // 6 = 3,5x ueber dem Ist, 5x unter dem Outbound-Worst-Case ("im Zweifel teurer", ohne den
  // Kunden aus seiner eigenen Erreichbarkeit zu sperren; Rechnung: tasks/kv-p2-decken-rechnung.md).
  // GRENZE DER MESSUNG: EIN Anruf, US-DID, VOICE_ENGINE=budget, Sprache de, Assistant-Pfad
  // NICHT beteiligt. Fuer eine +49-DID ist der Satz UNGEMESSEN - es existiert keine.
  // FAIL-RICHTUNG: unset/leer -> 6 (nie 0). Muell/negativ -> fatalConfigErrors -> Boot-Refusal
  // (assertConfig). Ein AUSDRUECKLICH gesetztes 0 schaltet die Inbound-Kosten-Achse ab, genau
  // wie VOICE_TARIFF_DEFAULT_CENTS=0 die Outbound-Achse - Betreiber-Akt, kein stiller Ausfall.
  voiceTariffInboundCents: numEnv("VOICE_TARIFF_INBOUND_CENTS", process.env.VOICE_TARIFF_INBOUND_CENTS, {
    fallback: 6,
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
  // Per-Tenant Default-Kostendecke (GANZZAHL Cents, G26). ZWEI Wirkungen (P2a/D3):
  // (1) Seed beim Registrieren -> explizite tenant_budget-Zeile (seedTenantDefaultBudget),
  // (2) Gate-Fallback in effectiveCapCents fuer jeden Tenant OHNE Zeile - dadurch nimmt der
  // Wert auch den Bestand aus dem geteilten globalen Pool, nicht nur Neuzugaenge.
  // 0 = Sentinel "kein Default": kein Seed UND kein Gate-Fallback, der Tenant faellt wie
  // im Bestand auf den globalen Cap. Ein 0-Wert darf NIE als 0-Cap interpretiert werden -
  // das wuerde jeden Outbound, jeden kostenlosen Inbound und jeden laufenden Call sperren.
  // Globaler Backstop (platformSpendCapCents) bleibt PARALLEL (Schnittmenge, Regel 1).
  //
  // Fallback-Wert 1500: EINE vom Boot-Guard erzwungene Schranke (spendCapCoherence
  // Klausel B) - mindestens VOICE_TARIFF_DEFAULT_CENTS * RESERVE_LEAD_MINUTES,
  // seit KS-P3 also 30 * 2 = 60. Liegt die Decke darunter, ist der teuerste Zielverkehr
  // unbezahlbar und JEDES Ziel ohne gemessenen Inlandssatz faellt schon vor dem Dial ins
  // Reserve-Gate (402); seit P7 ist dieser Befund FATAL.
  // Der Wert bleibt bei 1500 und nicht bei den geforderten 150, weil er seit KS-P5a die
  // Starter-Plan-Decke spiegelt: 30 verkaufte Minuten * 30 ct * 5/3 = 1500. Ein Tenant ohne
  // eigene tenant_budget-Zeile bekommt damit dieselbe Decke wie ein Starter-Kunde.
  // Die frueher hier genannte zweite Schranke ("echt KLEINER als platformSpendCapCents,
  // sonst waere die Tenant-Achse inert") ist mit KS-P9/E10 ersatzlos entfallen - die
  // Plattform-Zahl trifft keine Sperrentscheidung mehr und kann nichts inert machen.
  // O6 ("den Tarif nicht senken, um eine Decke zu retten") ist durch E1 ueberholt: der Satz
  // wurde gesenkt, weil er GEMESSEN wurde, nicht um ein Gate zu entlasten.
  // Dieselbe Zahl steht an drei Stellen: hier, .env.example und render.yaml;
  // test/env-docs-spend-cap-coherence.test.js prueft alle drei gegen den Guard.
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
  // Provider der geseedeten Owner-Betriebsnummer (telnyx). Leer (Default) -> Telnyx
  // (DEFAULT_PROVIDER, der live betriebene Carrier); ein gesetzter, aber ungueltiger Wert
  // (Tippfehler) -> KEIN Seed -> Boot-Refusal (fail-closed, kein stiller Falsch-Carrier,
  // R1). Seit C-P4 ist telnyx der einzige gueltige Wert; die Variable bleibt, weil sie
  // die Stelle ist, an der ein zweiter Carrier ohne Code-Aenderung geseedet wird.
  // Lowercase-normalisiert.
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
  allowedCountryCodes: csvEnv(process.env.ALLOWED_COUNTRY_CODES || "+49,+33,+44"),
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
    // TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS): numEnv klemmt n>max auf max.
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
  // AL-P13: Consult-Kanal am Call (Rueckfrage waehrend der Klingelzeit + MCP-Schleife).
  // DEFAULT AUS (fail-closed): aus -> kein Consult wird emittiert, /api/calls/:id/consult*
  // sind nicht erreichbar (404), await_call_event/answer_consult werden nicht registriert,
  // call.consults bleibt null -> Verhalten byte-identisch. Wirkt NUR als Schnittmenge mit
  // ASSISTANT_CONTEXT_ENABLED und dem Per-Tenant-Recht allowConsult (src/consult/gate.js) -
  // dieselbe Kopplung wie precallBriefingEnabled.
  consultEnabled: boolEnv("CONSULT_ENABLED", process.env.CONSULT_ENABLED, { fallback: false }),
  // AL-P14: get_consult IM Gespraech. EIGENES Flag neben CONSULT_ENABLED, weil sich die
  // Datenschutz-Exposition unterscheidet: AL-P13 exportiert Fragen aus dem AUFTRAG des
  // Nutzers, AL-P14 erstmals eine Frage aus fremder Rede (der Angerufene hat nie
  // eingewilligt). DEFAULT AUS (fail-closed): das Werkzeug steht nicht im tools-Array,
  // kein In-Call-Consult entsteht, der Prompt und der Tool-Satz sind byte-identisch.
  // Wirkt NUR als Schnittmenge mit CONSULT_ENABLED, ASSISTANT_CONTEXT_ENABLED und dem
  // Per-Tenant-Recht allowConsult. Anschalten erst, wenn die Datenschutzerklaerung die
  // Weitergabe von Inhalten aus dem laufenden Gespraech an den MCP-Host nennt (O5-Muster).
  inCallConsultEnabled: boolEnv("IN_CALL_CONSULT_ENABLED", process.env.IN_CALL_CONSULT_ENABLED, {
    fallback: false,
  }),
  // GQ-P2 (W1): WARTEN und STERBEN sind zwei Fristen. Dies ist die kurze - so lange darf
  // der naechste Turn den LLM-freien Halte-Satz sprechen, statt zu antworten (Repo-Lehre:
  // 4 s Warten sind OK, Stille nicht). Dieselbe Zahl reserviert
  // consultFitsBillingMinute in der laufenden Abrechnungsminute.
  consultWaitMs: numEnv("CONSULT_WAIT_MS", process.env.CONSULT_WAIT_MS, {
    fallback: 4000,
    min: 0,
    max: CONSULT_WAIT_MAX_MS,
  }),
  // GQ-P2 (W2): die lange Frist - so lange bleibt eine Rueckfrage OFFEN und nimmt eine
  // eintreffende Antwort noch an. HERGELEITET, nicht geraten: eine Rueckfrage kann genau
  // dann entstehen, wenn ein Long-Poll gerade erst begonnen hat; der Client sieht sie erst
  // nach dessen Haltezeit, braucht die Abbruchmarge fuer den naechsten Poll und danach
  // eine zweite Haltezeit, um zu antworten. Zwei volle Poll-Zyklen plus Marge = 47 s. Die
  // Beziehung zu CONSULT_POLL_HOLD_MS ist in test/gq-p2-consult-deadline.test.js
  // festgenagelt statt hier importiert - config.js bleibt frei von Domaenen-Modulen.
  consultOpenMs: numEnv("CONSULT_OPEN_MS", process.env.CONSULT_OPEN_MS, {
    fallback: 47000,
    min: 0,
    max: CONSULT_OPEN_MAX_MS,
  }),
  // Self-Service-Schicht (I9): getrenntes Tenant-Dashboard + Self-Service-Settings-
  // Route hinter eigenem Reife-Flag. DEFAULT AUS (fail-closed): die Self-Service-
  // Routen existieren ohne das Flag schlicht nicht (404) -> heutiges Admin-Dashboard
  // + /api/* byte-identisch. Getrennt von MULTI_TENANT
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
  forceNumberCountry: trimmedUpper(process.env.FORCE_NUMBER_COUNTRY),
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
  // KS-P3 (b) / E2/E3: MAX_CALL_DURATION_S ist hier ERSATZLOS entfallen. Ein Operator-Knopf,
  // der jede Gespraechsdauer global kuerzt, IST die willkuerliche Produktgrenze, die diese
  // Phase beseitigt. Die nutzbare Dauer eines Legs wird jetzt pro Call aus dem Restguthaben
  // abgeleitet (emergencyBrakeSeconds, src/call-duration.js) und von der hartkodierten
  // absoluten Obergrenze MAX_CALL_DURATION_CAP_S gedeckelt. Ein im Dashboard
  // stehengebliebener MAX_CALL_DURATION_S-Wert wird ab dieser Phase schlicht ignoriert -
  // fail-safe, er kann kein Gespraech mehr kuerzen.
  // P3.1 (PLAN-CONVERSATION-QUALITY-V2): Vorlauf (ms) vor dem harten Max-Dauer-Cap, ab dem
  // /voice/turn statt eines Folge-Gathers einen deterministischen Abschluss-Satz + Hangup
  // rendert. Der Cap selbst wird dadurch NICHT verlaengert (Regel 1): der Satz liegt
  // INNERHALB der Frist, der Timer-Backstop (terminateCappedCall) bleibt unangetastet.
  // Herleitung 20000: ein Abschluss-Satz von ~120 Zeichen braucht bei der MS_PER_CHAR-
  // Schaetzung des Farewell-Watchdogs grob 8-10 s Sprechzeit, dazu ein voller Webhook-
  // Zyklus - 20 s lassen dafuer Luft, ohne mehr als einen regulaeren Turn zu opfern.
  // 0 = AUS (remaining >= 0 ist immer wahr -> nie ausgeloest = Bestandsverhalten).
  // Muss deutlich KLEINER als die KUERZESTMOEGLICHE Notbremse (60 s, der Puffer allein -
  // s. emergencyBrakeSeconds) bleiben, sonst endet jeder Call nach dem ersten Turn. Der
  // Default 20000 erfuellt das. Max 60000 gegen absurde Werte.
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
  // noetig, sonst Erst-Turn-Deadlock, render.js-Doku).
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
  // AL-P7b (PLAN-ASSISTANT-LEAP.md, Phase 7b): das Denk-Signal. AN -> der Systemprompt
  // bekommt die Regel, einem Werkzeugaufruf einen kurzen Ueberbrueckungssatz voranzustellen,
  // und agentTurn spricht diesen Satz, sobald der Tool-Loop weiterlaeuft (hoechstens EINMAL
  // pro Turn). DEFAULT AUS (fail-closed): aus -> der Prompt-Block entfaellt ersatzlos
  // (byte-identischer Systemprompt) und es geht kein zusaetzliches Fragment auf die Leitung.
  // Wirkt NUR zusammen mit einem Abnehmer, also im Shim-Pfad mit
  // TELNYX_SHIM_TOKEN_STREAMING=true (AL-P7 ist Vorbedingung); die Budget-Engine reicht
  // keinen Abnehmer durch und bleibt unberuehrt. Kein Footgun-Eintrag: das Flag entwaffnet
  // keine Sicherung, es aendert nur, WAS gesprochen wird.
  thinkingSignalEnabled: boolEnv("THINKING_SIGNAL_ENABLED", process.env.THINKING_SIGNAL_ENABLED, {
    fallback: false,
  }),
  // WW-F2 (tasks/PLAN-WERKZEUGWAHL.md, W3): das Nachfassen. AN -> eine Runde, die eine
  // Handlung nur ANKUENDIGT und dabei kein Werkzeug aufruft, bekommt GENAU EINEN
  // erzwungenen Nachfass-Zug (tool_choice=required, Werkzeugsatz ohne end_call).
  // DEFAULT AUS (fail-closed): aus -> kein tool_choice-Feld auf dem Draht, kein zweiter
  // Modellaufruf, byte-identisches Bestandsverhalten. Der Schalter ist zugleich die Naht
  // der A/B-Messung - ein Lauf mit und einer ohne, sonst byte-identische Konfiguration
  // (Lehre calibration-scope-lesson). Kein Footgun-Eintrag: er entwaffnet keine Sicherung.
  toolFollowUpEnabled: boolEnv("TOOL_FOLLOW_UP_ENABLED", process.env.TOOL_FOLLOW_UP_ENABLED, {
    fallback: false,
  }),
  // Rate-Limit pro IP und Minute fuer alle Routen ausser /voice (Provider-Webhooks;
  // localhost-Socket ausgenommen). Default 120: Dashboard pollt alle 2,5s (~24/min)
  // plus Interaktionen.
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
  // testbar ist (der echte Telnyx-Adapter wirft synchron ohne TELNYX_API_KEY). BOOT-GEHAERTET
  // (boot-guard.js): nur zulaessig mit SKIP_TWILIO_SIGNATURE_CHECK=true -> in Prod (Signatur-
  // pruefung fail-closed AN, Regel 1) fuehrt es zum Boot-Refusal, NIE zu stillem Nicht-Waehlen.
  // KEINE abgeschaltete Sicherung: alle Gates laufen unveraendert VOR voiceControl.
  fakeOriginate: boolEnv("FAKE_ORIGINATE", process.env.FAKE_ORIGINATE, { fallback: false }),
  // Trockenlege-Naht des dritten Outbound-Wegs (Owner-Auftrag 15.08.2026, Aufgabe 1):
  // FAKE_ORIGINATE (s.o.) deckt NUR src/telephony/registry.js (Telnyx) ab - der EL-
  // Anrufstart (src/elevenlabs/outbound.js#originateCall) laeuft ueber einen eigenen
  // Netzzugriff (convai.js#startOutboundCall) und hatte KEINE Naht. true -> der EINE
  // POST gegen api.elevenlabs.io wird NICHT gerufen, stattdessen eine Antwort in der
  // Anbieter-Form (SIPTrunkOutboundCallResponse) mit erfundenen Werten (fake_el_-Praefix).
  // BOOT-GEHAERTET wie FAKE_ORIGINATE (fakeOriginateBootBlocked, boot.js): nur mit
  // SKIP_TWILIO_SIGNATURE_CHECK=true zulaessig, sonst Boot-Refusal. KEINE abgeschaltete
  // Sicherung: alle Outbound-Gates laufen unveraendert VOR originateCall.
  fakeOriginateElevenlabs: boolEnv(
    "FAKE_ORIGINATE_ELEVENLABS",
    process.env.FAKE_ORIGINATE_ELEVENLABS,
    { fallback: false },
  ),

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
  // AL-P11 (O5): eigene, KURZE Frist fuer die woertlichen Zitate (result.evidence) der
  // Ergebnis-Karte. BEWUSST NICHT diagnosticRetentionDays wiederverwendet - zwei
  // Sachverhalte auf einem Label liessen eine hochgedrehte Diagnose-Frist still auch
  // die Aufbewahrung von Drittzitaten verlaengern. 0 = Feature AUS (Default): es wird
  // kein Zitat erhoben UND jedes Alt-Zitat faellt beim naechsten Sweep - fail-closed in
  // die Loesch-Richtung, Muster diagnosticRetentionDays. NIE ueber retentionDays
  // fuehren: das waere die Umkehrung der Minimierungsentscheidung aus P2b.
  // In Produktion erst auf >0, wenn die Datenschutzerklaerung (apps/web) woertliche
  // Zitate und ihre Frist nennt.
  evidenceRetentionDays: numEnv("EVIDENCE_RETENTION_DAYS", process.env.EVIDENCE_RETENTION_DAYS, {
    fallback: 0,
    min: 0,
  }),

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
  // 312k-Phase 4: EIGENER Schluessel fuer die WorkOS-Nutzerloeschung beim Vertragsende
  // (workos-management.js) - NICHT oidcClientSecret: der Anmeldeschluessel ist fuer den
  // Login-Flow bestimmt, ob er ueberhaupt Loeschrechte traegt ist ungeklaert, und ein
  // Anmeldeschluessel gehoert nicht auf einen unwiderruflichen Loeschpfad. Leer (Default) =
  // die Loeschung wird NICHT versucht (fail-closed: kein Aufruf ohne eigens dafuer
  // vergebenen Schluessel), der Tenant wird stattdessen am Vertragsende als offen vermerkt
  // und bei einem spaeteren Sweep erneut versucht. SECRET - nie loggen.
  workosManagementApiKey: process.env.WORKOS_MANAGEMENT_API_KEY || "", // SECRET
  // Admin-Allowlist (kommasepariert, E-Mails). Nur diese duerfen approve/suspend.
  adminEmails: csvEnv(process.env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
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

  // ---- Mail (312k-Phase 5: Kuendigungsbestaetigung; HTTP-Fortsetzung) ----
  // ZWEI moegliche Kanaele, EINE Rangfolge (wiring/web-login.js selectMailer): Brevo/HTTP
  // vor SMTP. Grund: Render sperrt auf kostenlosen Web-Diensten den ausgehenden Verkehr auf
  // allen SMTP-Ports (25/465/587, ETIMEDOUT in Produktion) - Brevo laeuft ueber HTTP auf
  // Port 443, den Render nicht sperrt. Der urspruengliche SMTP-Weg (eigenes Postfach bei
  // Zoho EU, mx.zoho.eu) bleibt bestehen, TLS bleibt im Adapter erzwungen (smtp-mail.js) -
  // nie unverschluesselter Versand. Kein Schluessel gesetzt -> kein Mailer konstruiert
  // (Muster workosManagementApiKey): die Kuendigungsbestaetigung bleibt offen vermerkt, ein
  // spaeterer Sweep versucht es erneut, sobald die Variablen gesetzt sind. brevoApiKey UND
  // smtpPassword sind SECRET - nie loggen/leaken, nie in eine Fehlermeldung, nie in ein
  // Audit-Detail (eine Email-Adresse ist ebenso PII, Regel 4).
  brevoApiKey: process.env.BREVO_API_KEY || "", // SECRET - nie loggen/leaken
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: numEnv("SMTP_PORT", process.env.SMTP_PORT, { fallback: 465, min: 1 }),
  smtpUser: process.env.SMTP_USER || "",
  smtpPassword: process.env.SMTP_PASSWORD || "", // SECRET - nie loggen/leaken
  mailFrom: process.env.MAIL_FROM || "",

  // ---- Voice-Engine ----
  // "budget"  = Provider-eigene STT/TTS (Telnyx TeXML) + Claude Haiku (quasi gratis, Default)
  // "realtime"= OpenAI Realtime API (Speech-to-Speech, Barge-in, ~0,30-0,50 EUR/min)
  voiceEngine: process.env.VOICE_ENGINE || VOICE_ENGINE.BUDGET,
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  realtimeModel: process.env.REALTIME_MODEL || "gpt-realtime",
  realtimeVoice: process.env.REALTIME_VOICE || "alloy",

  // ---- Spracherkennung (STT) ----
  // Neutrale Wahl der Erkennungs-Engine, EINMAL fuer alle Pfade. Jeder Telefonie-Adapter
  // uebersetzt sie in seine eigene Schreibweise. Vorher stand der Anbieter-String an drei
  // Code-Orten roh nebeneinander: der Gather-Pfad lief auf nova-3, der Assistant-Pfad vier
  // Wochen auf einem Modell, das deutsches Telefon-Audio als Englisch erkannte, und kein
  // Mechanismus machte den Widerspruch sichtbar (B-7). Preis war zusaetzlich ein Deploy je
  // Modellwechsel. Gueltige Werte: STT_PROFILE in telephony/stt-profile.js; ein unbekannter
  // Wert bricht den BOOT ab (boot-guard sttProfileFindings) - nicht erst den Render-Pfad
  // eines laufenden Anrufs.
  sttProfile: (process.env.STT_PROFILE || DEFAULT_STT_PROFILE).trim(),

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

  // Preise pro 1M Tokens in USD, PRO MODELL-ID und - seit B4a - PRO TOKEN-SORTE (vier
  // Raten, llm/ports.js LlmTokenUsage). Nur fuer den Budget-Guard (Regel 1). EINZIGE
  // Preisquelle: das Live-Gate (trackUsage) UND der Stripe-Ledger (aiCostCents) leiten
  // ihren Betrag hieraus ab (G5). Ein Modell, das hier NICHT steht, wird mit der
  // punktweisen Obergrenze ueber alle Staffeln gebucht (fail-closed, priceForModel/
  // worstCasePrice in state-ops.js) - nie mit 0, nie mit dem Haiku-Default.
  //
  // Die Tabelle ist die AUFLOESUNG der Staffeln (MODEL_PRICE_SCHEDULES, oben) auf den
  // heutigen Kalendertag. Ein terminierter Preiswechsel steht damit als validFrom in den
  // Daten statt im Kopf eines Menschen: eine flache Tabelle koennte "2.00 bis 31.08.,
  // 3.00 ab 01.09." nicht ausdruecken, weil keine der beiden Zahlen heute richtig ist.
  //
  // RESTRISIKO, bewusst akzeptiert: die Aufloesung passiert GENAU EINMAL, beim Boot. Ein
  // Prozess, der ohne Neustart ueber einen validFrom-Termin hinweg laeuft, bucht bis zum
  // Neustart die alte Staffel - bei Sonnet ab 2026-09-01 also ZU WENIG, die unsichere
  // Richtung. Gegenmassnahmen: die Boot-Banner-Zeile "Preisstaffeln:" (gewaehlte +
  // naechste validFrom) und die Kalenderzeile in STATUS.md. Die Alternative (Uhr an der
  // Buchungskante) haette zwei Uhren an derselben Buchung und traefe JEDE Buchung.
  //
  // Ein Modell ohne Staffel bricht seit B4a den BOOT ab (assertPricedModels, src/boot.js).
  // Achtung: eine DATIERTE Snapshot-ID ("claude-haiku-4-5-20251001") ist ein ANDERER
  // Schluessel als der Alias und laeuft damit in den Boot-Abbruch, nicht mehr in den
  // Fail-closed-Zweig.
  //
  // BEWUSST NICHT Object.freeze(...) auf dem AUFGELOESTEN Ergebnis: guardedConfig (unten)
  // wrapt jeden Objekt-Wert bei JEDEM Zugriff frisch in einen NEUEN Proxy. Fuer eine per
  // Object.freeze non-configurable GEMACHTE Eigenschaft verlangt die Sprache aber, dass
  // [[Get]] denselben (SameValue) Rueckgabewert liefert wie am Target - ein frischer
  // Wrapper verletzt diese Invariante und die Engine wirft TypeError bei JEDEM Zugriff
  // (auch auf bekannte Modelle), nicht nur bei unbekannten. Genau der
  // Fail-open-durch-Crash, den priceForModel verhindern soll. resolveModelPrices liefert
  // deshalb frische, ungefrorene Objekte (die gefrorene QUELLE bleibt davon unberuehrt).
  modelPricesUsd: resolveModelPrices(MODEL_PRICE_SCHEDULES, todayIsoDate()),
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
  // Leer (Default) = AUS -> heutiges Serving byte-identisch (nur public/, oeffentlich).
  // Gesetzt -> der Gateway liefert Marketing + App-Shell same-origin (server.js); die
  // Mount-Reihenfolge steht aus Shadowing-Gruenden fest. Pfad-Flag (Muster
  // MULTI_TENANT/PAYMENT_ENABLED, fail-closed).
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
    // OHNE receiver-Parameter (F1: Obergrenze 3 Argumente): Reflect.set schreibt damit
    // gegen das ZIEL statt gegen die Proxy. Fuer diese Oberflaeche ist das derselbe
    // Vorgang - jedes Blatt ist ein Accessor, dessen Setter ueber den rawConfig-Slot
    // schliesst und `this` gar nicht liest (makeNamespaceGroup); die Namespace-Gruppen
    // selbst sind nicht-schreibbare Datenfelder, dort schlaegt die Zuweisung so oder so
    // fehl. Der Setter-Durchschlag ist in test/config-namespaces.test.js fuer JEDES
    // primitive Blatt festgenagelt.
    set(obj, prop, value) {
      if (typeof prop === "symbol" || prop in obj) return Reflect.set(obj, prop, value);
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
  safety: ["outboundFrozen", "allowedCountryCodes", "maxCallsPerHour", "perTargetCallCap", "perTargetWindowMs", "capFarewellLeadMs", "reserveReleaseGraceMs", "rateLimitPerMin", "skipTwilioSignatureCheck", "fakeOriginate", "fakeOriginateElevenlabs"],
  billing: ["platformSpendCapCents", "paymentEnabled", "stripeSecretKey", "stripeApiBase", "numberSetupFeeCents", "paymentCurrency", "providerCurrency", "providerToBucketRateMicro", "costTruingDelayMinutes", "costTruingSweepIntervalMs", "costTruingMaxAttempts", "costTruingRequiredRecordTypes", "costTruingMinCoveragePercent", "costTruingCoverageStallSweeps", "costDriftWarnPercent", "costAlertDebounceMs", "costCalibrationMinSamples", "voiceTariffDomesticCents", "voiceTariffDefaultCents", "voiceTariffInboundCents", "voiceTariffFullCostFloorCents", "voiceTariffDomesticPrefixes", "defaultTenantBudgetCents", "smsCostCents", "platformSpendWarnPercent", "platformAlertSmsTo", "budgetMonthEnabled", "ttsCharacterQuota", "ttsCharacterQuotaWarnPercent", "ttsQuotaCycleAnchorDay", "platformFixedCostCentsPerMonth", "numberMonthlyCostCents", "stripeStarterPriceId", "stripeBusinessPriceId", "stripeWebhookSecret", "stripeCustomerRetryDelayMs", "flushEpochIso"],
  provisioning: ["maxNumbers", "maxNumbersPerTenant", "provisioningEnabled", "provisioningRedriveMaxAgeMs", "releaseGraceMs", "provisioningCountry", "forceNumberCountry", "geoEnabled", "geoDbPath", "worldDefaultLanguageEnabled", "ownerNumberSeed", "ownerNumberProvider", "bootstrapE164", "bootstrapProvider"],
  auth: ["mcpAuthToken", "mcpAuth", "oauthIssuerUrl", "oauthAudience", "sessionSecret", "oidcClientId", "oidcClientSecret", "workosApiBase", "workosManagementApiKey", "adminEmails", "loginRateLimitPerMin", "sessionTtlSeconds", "loginCookieTtlSeconds", "dashboardPassword", "ownerIdpSubject", "devLoginEnabled"],
  // 312k-Phase 5: Versand der Kuendigungsbestaetigung (Brevo/HTTP oder Zoho/SMTP) -
  // eigener Namespace statt Anhaengsel an auth/billing (eigenstaendige Domaene, s.
  // brevo-mail.js/smtp-mail.js/billing/cancellation-mail.js). HTTP-Fortsetzung:
  // brevoApiKey ergaenzt (Render sperrt SMTP auf kostenlosen Plaenen) -> 6.
  mail: ["brevoApiKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "mailFrom"],
  llm: ["anthropicApiKey", "llmProvider", "deepseekApiKey", "claudeModel", "llmRequestTimeoutMs", "llmMaxRetries", "llmBackoffMs", "llmBreakerThreshold", "llmBreakerWindowMs", "llmBreakerCooldownMs", "modelPricesUsd", "usdToEur", "briefingModel", "briefingTimeoutMs", "summaryTimeoutMs"],
  telnyx: ["telnyxElevenLabs", "telnyxAssistant"],
  voice: ["voiceEngine", "openaiApiKey", "realtimeModel", "realtimeVoice", "elevenLabsPlayTts", "elevenLabsToolToken", "elevenLabsOutbound", "sttProfile", "sttSpeechTimeoutSec", "maxEmptyTurns", "callerSubstanceMinLen", "sendSmsSummary", "dailySmsCap", "thinkingSignalEnabled", "toolFollowUpEnabled"],
  telephony: ["telnyxApiKey", "telnyxPublicKey", "telnyxApiBase", "telnyxConnectionId", "telnyxAccountSid", "telnyxDialTimeoutSecs", "machineDetection"],
  tenancy: ["multiTenant", "mcpUiEnabled", "assistantContextEnabled", "selfServiceEnabled", "profilesSeed", "precallBriefingEnabled", "consultEnabled", "inCallConsultEnabled", "consultWaitMs", "consultOpenMs"],
  server: ["port", "publicUrl", "isProduction", "deployedCommit", "dataDir", "publicDir", "webDistDir", "shutdownDrainTimeoutMs"],
  store: ["storeBackend", "databaseUrl", "queueBackend"],
  metrics: ["metricsEnabled"],
  privacy: ["retentionDays", "diagnosticRetentionDays", "evidenceRetentionDays"],
  research: ["researchEnabled", "researchMaxUses", "researchSearchFeeCents", "lookupEnabled", "lookupSearchFeeCents", "exaApiKey", "exaApiBase"],
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
      // Object.assign statt storage[key] = value: der Speicher ist ein Parameter, und
      // die Mutation ist hier der ZWECK der Fabrik (ein Blatt schreibt seinen Slot) -
      // sie wird deshalb als solche benannt, statt als Parameter-Mutation zu erscheinen
      // (P6/F2). Gleicher Schreibvorgang, gleicher Slot.
      set: (value) => {
        Object.assign(storage, { [key]: value });
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
// Die MCP-Tools/-Server sprechen mit der eigenen REST-API. resolveGatewayUrl() liefert
// zur Aufrufzeit die Adresse dafuer, aus drei Quellen in fester Rangfolge:
//  1. GATEWAY_URL aus der Umgebung - der KONFIGURIERTE Wert (Trailing-Slash gestrippt),
//  2. der beim Listen gebundene Port (s. setBoundGatewayPort),
//  3. der config-Port als Fallback.
export function gatewayUrlForPort(port) {
  return `http://localhost:${port}`;
}

// Der zur Laufzeit NACHGETRAGENE Wert: die eigene Adresse steht erst nach app.listen()
// fest, weil bei PORT=0 (Tests) das Betriebssystem den Port vergibt. Modul-eigener
// Halter statt process.env als globale Ablage (G35) - das ist keine Konfiguration aus
// der Umgebung, sondern eine Beobachtung DIESES Prozesses. In jedem Prozess, der nicht
// selbst listen()t (stdio-MCP-Server), bleibt er null; dort gelten 1. und 3.
let boundGatewayUrl = null;

// Einmal aus dem listen-Callback gerufen (src/boot.js). Die Rangfolge ist dieselbe wie
// beim frueheren "process.env.GATEWAY_URL ||= gatewayUrlForPort(port)": ein gesetztes
// GATEWAY_URL bleibt der staerkere Wert, der gebundene Port fuellt nur die Luecke.
export function setBoundGatewayPort(port) {
  boundGatewayUrl = gatewayUrlForPort(port);
}

export function resolveGatewayUrl() {
  return stripTrailingSlash(
    process.env.GATEWAY_URL || boundGatewayUrl || gatewayUrlForPort(config.server.port),
  );
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
// Die Footgun-Tabelle: je Eintrag EINE Bedingung und der Text, den sie ausloest. Als
// Tabelle statt als if-Kette, damit die Liste waechst, ohne dass die pruefende Funktion
// waechst (G30); Reihenfolge der Ausgabe ist die Reihenfolge dieser Liste und
// unveraendert.
const PRODUCTION_FOOTGUNS = Object.freeze([
  {
    trifftZu: (cfg) => !cfg.auth.dashboardPassword,
    befund:
      "DASHBOARD_PASSWORD fehlt - seit AUTH-P7 liest keine Route mehr diese Variable; " +
      "Boot-Pflicht bleibt bis AUTH-P8 ausschliesslich als Rollback-Sicherung (ein " +
      "Rollback auf einen Commit vor AUTH-P7 findet damit ein scharfes Gate vor).",
  },
  {
    trifftZu: (cfg) => cfg.auth.mcpAuth === "off",
    befund: "MCP_AUTH=off - /mcp ist ohne jede Pruefung offen (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => cfg.safety.skipTwilioSignatureCheck,
    befund:
      "SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks bleiben ungeprueft (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => isInsecureHttpIssuer(cfg.auth.oauthIssuerUrl),
    befund: "OAUTH_ISSUER_URL ist nicht https - SSRF/MITM-Footgun (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => cfg.store.storeBackend !== "pg",
    befund:
      "STORE_BACKEND ist nicht 'pg' - der json-Store liegt auf Renders fluechtigem Dateisystem (Datenverlust bei jedem Deploy/Neustart). Im Hosting STORE_BACKEND=pg + DATABASE_URL Pflicht.",
  },
  {
    // DEV_LOGIN_ENABLED ist ein lokaler Login-Shim (umgeht WorkOS) - im Hosting NIE erlaubt.
    // config.auth.devLoginEnabled ist auf Render ohnehin neutralisiert (=== false); diese zweite,
    // unabhaengige Sperre liest die ROHE Env, damit eine versehentlich auf Render gesetzte
    // DEV_LOGIN_ENABLED=true den Boot verweigert statt still ignoriert zu werden (Regel 3).
    trifftZu: () => process.env.DEV_LOGIN_ENABLED === "true",
    befund: "DEV_LOGIN_ENABLED=true - Login-Shim umgeht WorkOS (im Hosting unzulaessig).",
  },
  {
    // C-Telnyx: aktiver Assistant + entwaffnete Shim-Rate-Bremse (Regel 1). Nur wenn das
    // Flag an ist (Flag aus -> Shim 404, Bremse inert -> kein Footgun).
    trifftZu: (cfg) =>
      cfg.telnyx?.telnyxAssistant?.enabled &&
      cfg.telnyx?.telnyxAssistant?.shimMaxTurnsPerMin > TELNYX_SHIM_MAX_TURNS_CEILING,
    befund:
      "TELNYX_SHIM_MAX_TURNS_PER_MIN zu hoch - die per-Call-Turn-Bremse (Token-/Toll-Fraud) waere praktisch aus (im Hosting bei aktivem Assistant unzulaessig).",
  },
]);

export function productionFootguns(cfg = config, isProduction = detectProduction()) {
  if (!isProduction) return [];
  return PRODUCTION_FOOTGUNS.filter((footgun) => footgun.trifftZu(cfg)).map(
    (footgun) => footgun.befund,
  );
}

// EINE Quelle (G5) fuer das Self-Service-Reifekriterium: nur "scharf", wenn BEIDE Flags
// gesetzt sind (SELF_SERVICE_ENABLED + MULTI_TENANT). Reine Praedikatfunktion, per Import
// genutzt (auth-gate/web-login) statt vierfach woertlich. INV-3-Exemption-Reihenfolge
// bleibt strukturell unveraendert (nur die Bedingung wird benannt, nicht verschoben).
export function isSelfServiceLive(cfg) {
  return Boolean(cfg.tenancy.selfServiceEnabled && cfg.tenancy.multiTenant);
}

// Boot-Pflicht-Tabelle: je Eintrag EINE Bedingung und der Name, den die Diagnose als
// "fehlt/ungueltig" nennt. Tabelle statt if-Kette (G30) - die Liste darf wachsen, ohne
// dass die pruefende Funktion waechst; Reihenfolge der Meldung ist die dieser Liste und
// unveraendert. Die Bedingungen lesen den config-Singleton erst beim AUFRUF (Arrow),
// nicht beim Aufbau der Tabelle.
//
// Absendernummer + Owner-Identitaet sind keine Boot-Pflicht-Env mehr (P2b): sie leben
// im Store (Bootstrap-CLI/Onboarding/Self-Service), nicht in der Env. Stattdessen
// verlangt der Boot-Guard in server.js fail-closed eine aktive Nummer im Store
// (assertConfig bleibt storefrei).
// C-P5: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN sind KEINE Boot-Pflicht mehr - seit dem
// Adapter-Ausbau liest sie kein Codepfad. In Render stehen sie uebergangsweise noch und
// werden ignoriert; ein gesetzter, ungelesener Key ist harmlos.
const REQUIRED_CONFIG = Object.freeze([
  { fehlt: () => !config.llm.anthropicApiKey, name: "ANTHROPIC_API_KEY" },
  {
    // B5: der Fremdadapter ohne Schluessel wuerde JEDEN Aufruf mit 401 beantworten -
    // nicht-transient, also Degradation in jedem Turn, und das erst im Anruf sichtbar.
    // ANTHROPIC_API_KEY bleibt bewusst UNBEDINGT Pflicht (eine Lockerung waere das
    // Aufweichen einer bestehenden Pruefung ohne Not - B5 stellt den Live-Anbieter nicht um).
    fehlt: () => config.llm.llmProvider === LLM_PROVIDER.DEEPSEEK && !config.llm.deepseekApiKey,
    name: "DEEPSEEK_API_KEY (weil LLM_PROVIDER=deepseek)",
  },
  {
    fehlt: () => !config.server.publicUrl || config.server.publicUrl.includes("CHANGE-ME"),
    name: "PUBLIC_URL",
  },
  {
    fehlt: () => config.auth.mcpAuth === "oauth" && !config.auth.oauthIssuerUrl,
    name: "OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)",
  },
  {
    fehlt: () => config.store.storeBackend === "pg" && !config.store.databaseUrl,
    name: "DATABASE_URL (weil STORE_BACKEND=pg)",
  },
  {
    fehlt: () => config.billing.paymentEnabled && !config.billing.stripeSecretKey,
    name: "STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)",
  },
  {
    // W4: das Webhook-Signing-Secret ist sicherheitskritisch (ohne ist der Stripe-Webhook
    // fail-closed unverifizierbar -> kein Abo-Lifecycle). Boot-Pflicht bei aktivem Payment
    // (Muster STRIPE_SECRET_KEY). Die Price-Ids sind BEWUSST keine Boot-Pflicht: ein Tier
    // darf unbuchbar bleiben (Route-500), das stoppt den Boot nicht.
    fehlt: () => config.billing.paymentEnabled && !config.billing.stripeWebhookSecret,
    name: "STRIPE_WEBHOOK_SECRET (weil PAYMENT_ENABLED=true)",
  },
  {
    // numEnv() faengt einen nicht-numerischen NUMBER_SETUP_FEE_CENTS bereits am Env-Parse
    // ab (fatalConfigErrors -> Boot-Refusal). Dieser Check bleibt als Invariante auf dem
    // config-Wert (> 0 ganzzahlig bei PAYMENT_ENABLED) - direkt geprueft von
    // config-payment-guard.test.js, das den config-Wert ohne Env-Pfad mutiert.
    fehlt: () => config.billing.paymentEnabled && !isPositiveIntegerFee(config.billing.numberSetupFeeCents),
    name: "NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)",
  },
  {
    // Single-Origin (P1): WEB_DIST_DIR gesetzt, aber der Build (<dir>/index.html) fehlt ->
    // sichtbarer Boot-Fehler statt stiller 404. Ohne index.html faende express.static
    // nichts, jeder Marketing-Request fiele auf 404 durch statt die Landing zu zeigen.
    fehlt: () =>
      Boolean(config.server.webDistDir) &&
      !existsSync(path.join(config.server.webDistDir, "index.html")),
    name: "WEB_DIST_DIR-Build (kein index.html im angegebenen Verzeichnis - 'astro build' in apps/web?)",
  },
  // C-Telnyx (PLAN-TELNYX-AI-ASSISTANT.md, P10): der AI-Assistant-Pfad braucht bei aktivem
  // Flag die volle Origination-/Shim-Config, sonst bootet der Dienst in einen "Flag an, aber
  // Assistant/Shim unkonfiguriert"-Zustand (Regel 1/3, fail-closed). publicUrl ist bereits
  // oben Pflicht (Custom-LLM-URL des Assistants zeigt dorthin). apiKey/callControlAppId tragen
  // die Call-Control-Origination + Hangup; assistantId feuert ai_assistant_start (P5/P7);
  // connectionId (TeXML) bleibt Pflicht, weil der Inbound-/Nummern-Pfad weiter darueber laeuft.
  {
    fehlt: () => assistantEnabled() && !config.telnyx.telnyxAssistant.assistantId,
    name: "TELNYX_ASSISTANT_ID (weil TELNYX_AI_ASSISTANT_ENABLED=true)",
  },
  {
    fehlt: () => assistantEnabled() && !config.telephony.telnyxApiKey,
    name: "TELNYX_API_KEY (weil TELNYX_AI_ASSISTANT_ENABLED=true)",
  },
  {
    fehlt: () => assistantEnabled() && !config.telephony.telnyxConnectionId,
    name: "TELNYX_CONNECTION_ID (weil TELNYX_AI_ASSISTANT_ENABLED=true)",
  },
  {
    fehlt: () => assistantEnabled() && !config.telnyx.telnyxAssistant.callControlAppId,
    name: "TELNYX_CALL_CONTROL_APP_ID (weil TELNYX_AI_ASSISTANT_ENABLED=true)",
  },
  {
    fehlt: () => assistantEnabled() && !config.telnyx.telnyxAssistant.shimSharedSecret,
    name: "TELNYX_SHIM_SHARED_SECRET (weil TELNYX_AI_ASSISTANT_ENABLED=true)",
  },
]);

const assistantEnabled = () => config.telnyx.telnyxAssistant.enabled === true;
const isPositiveIntegerFee = (cents) => Number.isInteger(cents) && cents > 0;

// Fatal-Befunde, die den Boot stoppen (fail-closed statt stillem Gate-Aus):
//  - numerische (AC1/AC2): NaN/Infinity/Bereichsverletzung einer gesetzten Env-Var.
//  - Produktions-Footguns (H1): im Hosting (RENDER_EXTERNAL_URL) offene/abgeschaltete
//    Auth-/Signatur-Gates. Lokal liefert productionFootguns() ein leeres Array.
//  - Alarmkanal (GAP-07): scharfe Spend-Warnung ohne Empfaenger. Die Entscheidung selbst
//    lebt NICHT hier, sondern in der einen Wahrheitstabelle (boot-guard.alertChannelFindings) -
//    diese Zeile faltet nur ihren fatalen Anteil in dieselbe Ausgabe wie die uebrigen Fatals.
function fatalConfigFindings(isProduction) {
  return configFatalErrors()
    .concat(productionFootguns(config, isProduction))
    .concat(
      alertChannelFindings(config.billing)
        .filter((befund) => befund.fatal)
        .map((befund) => befund.message),
    );
}

function reportFatalConfig(missing, fatal) {
  console.error("\n[Konfiguration fatal] Boot wird verweigert:");
  for (const name of missing) console.error(`  - fehlt/ungueltig: ${name}`);
  for (const befund of fatal) console.error(`  - ${befund}`);
  console.error("(.env pruefen; .env.example kopieren: cp .env.example .env)\n");
}

// Footgun-Warnungen NUR im lokalen/Test-Modus: im Hosting (isProduction) sind
// dieselben Punkte bereits fatal (productionFootguns) -> kein Doppel-Report, lokal
// aber weiterhin ein sichtbarer Hinweis.
function warnLocalOnlyFootguns() {
  if (config.safety.skipTwilioSignatureCheck)
    console.error(
      "[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!",
    );
  if (config.auth.mcpAuth === "off")
    console.error("[Sicherheit] MCP_AUTH=off - /mcp ohne jede Pruefung offen (nur lokale Demos)!");
}

// Hinweise, die in JEDER Umgebung gelten: wirkungslose bzw. unvollstaendige
// Kombinationen. Kein Boot-Stopp - der Dienst laeuft, nur eben ohne den Teil, den der
// Operator vermutlich erwartet.
function warnConfigurationHints() {
  if (config.billing.paymentEnabled && !config.provisioning.provisioningEnabled)
    console.error(
      "[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).",
    );
  if (config.store.storeBackend !== "pg" && config.auth.sessionSecret)
    console.error("[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB).");
  // Self-Service ist seit der Login-Konvergenz web-session-only: die Routen sind NUR
  // im Web-Login-Block (SESSION_SECRET + STORE_BACKEND=pg) registriert. Flags an, aber
  // ohne diese Infra -> /api/self-service/* sind nicht erreichbar (404, fail-closed).
  if (isSelfServiceLive(config) && !webLoginInfraReady())
    console.error(
      "[Hinweis] SELF_SERVICE_ENABLED braucht den Web-Login (SESSION_SECRET + STORE_BACKEND=pg) - sonst sind die /api/self-service/*-Routen nicht erreichbar.",
    );
}

const webLoginInfraReady = () =>
  Boolean(config.auth.sessionSecret) && config.store.storeBackend === "pg";

export function assertConfig() {
  const isProduction = detectProduction();
  const missing = REQUIRED_CONFIG.filter((eintrag) => eintrag.fehlt()).map(
    (eintrag) => eintrag.name,
  );
  const fatal = fatalConfigFindings(isProduction);
  if (missing.length || fatal.length) reportFatalConfig(missing, fatal);
  if (!isProduction) warnLocalOnlyFootguns();
  warnConfigurationHints();
  // http-OIDC-Issuer: lokal nur ein Hinweis (Test-IdP), im Hosting oben bereits fatal.
  if (!isProduction && isInsecureHttpIssuer(config.auth.oauthIssuerUrl))
    console.error(
      "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!",
    );
  return missing.length === 0 && fatal.length === 0;
}
