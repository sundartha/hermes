import dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CENTS_PER_EUR, MODEL_PRICE_RATE_FIELDS, setWorldDefaultLanguageEnabled } from "./store/defaults.js";
// GAP-07: boot-guard.js und telephony/stt-profile.js importieren ihrerseits nur
// import-freie bzw. Blatt-Module -> kein Zyklus, obwohl beide sonst downstream sitzen.
import { alertChannelFindings, alertChannelInputs } from "./boot-guard.js";
// KV2-10: die gueltigen Werte von VOICE_TARIFF_GRUNDBETRAG_CENTS sind die Kostenprofile
// der Engine-Weiche. billing/kostenarten.js ist importfrei (Blatt, Praezedenz boot-guard
// oben) - kein Zyklus, keine zweite Routen-Liste hier.
import { KOSTENPROFIL } from "./billing/kostenarten.js";
import { DEFAULT_STT_PROFILE } from "./telephony/stt-profile.js";
// IEX-A9: Blatt-Modul ohne Imports (kein Zyklus).
import { DEFAULT_INBOUND_EL_SCOPE } from "./elevenlabs/inbound-scope.js";
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
// P2 (W2): Obergrenze JEDER der drei EL-Rueckfrage-Fristen. Bindend ist
// response_timeout_secs = 60 am Werkzeug get_consult (live gemessen, Vorlage
// tools.get_consult.tool_config); 55 s lassen 5 s fuer Netz und Verarbeitung. EINE Zahl
// fuer alle drei Stufen (G5) - eine Stufe, die ueber das Werkzeug-Zeitlimit hinaus haelt,
// laesst den Anbieter den Aufruf abbrechen, statt zu antworten.
const EL_CONSULT_STAGE_MAX_MS = 55_000;

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

// OUTBOUND-E3b: Default-Vielfache fuer die Entprellung/Wiederholung des Ausfall-Melders
// (G25: benannte Konstanten statt Zahlenketten im Ausdruck).
const OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT = 6;
const OUTAGE_ALERT_RETRY_MINUTES_DEFAULT = 15;
// FW2: Standard-Haltedauer des Guthaben-Latch (G25/G35, Muster
// OUTAGE_ALERT_RETRY_MINUTES_DEFAULT).
const LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT = 15;
// OUTBOUND-E3b (Review-Blocker Runde 2, C8b/Plan-Abschnitt "Meldeweg und Alarm-Body"): ein
// Kanal, der zwoelf Monate nie ausgeloest wurde, ist kein bewiesener Kanal - der Selbsttest
// laeuft im selben monatlichen Rhythmus, den der Plan nennt.
const OUTAGE_ALERT_SELF_TEST_DAYS_DEFAULT = 30;
// C8 (F-8): Eskalations-Schwelle einer haengenden Kuendigungs-Nummernfreigabe - "24-h-
// Eskalation" ist der woertliche Owner-Beschluss (Plan-Abschnitt 9).
const PLATFORM_HOLD_ESCALATION_HOURS_DEFAULT = 24;
// GP-P0 (PLAN-GELDPFAD.md): Frist, die ein aktiver Subscriber ohne Live-Nummer bleiben
// darf, bevor der Selektor ihn meldet. 1 h, weil der Sweep im Stunden-Takt laeuft - eine
// kuerzere Frist meldete nur Rauschen.
const PAID_WITHOUT_NUMBER_GRACE_HOURS_DEFAULT = 1;

// Reine EUR->Cents-Rundung (G26: Money at rest ist Ganzzahl). Eigene, exportierte
// Funktion statt Inline-Ausdruck, DAMIT ein Unit-Test die Float-Falle direkt trifft:
// 0.29 * 100 === 28.999999999999996 in JS (node -e verifiziert) - ohne Math.round
// wuerde platformSpendCapCents lautlos knapp UNTER dem konfigurierten Cap liegen und der
// Test braeuchte sonst den vollen Boot-Spawn-Pfad (P12 F.I.R.S.T: fast/independent).
export function eurToCents(eur) {
  return Math.round(eur * CENTS_PER_EUR);
}

// Name der einzigen Voice-Engine (G25). Seit IE6-S2 kein Schalter mehr: die Realtime-
// Bridge ist entfernt, VOICE_ENGINE aus der Umgebung wird nicht mehr gelesen. Der Wert
// bleibt als benanntes Statusfeld (Boot-Banner, agent.voiceEngine, get_agent_status).
export const VOICE_ENGINE = Object.freeze({ BUDGET: "budget" });

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
// Exportiert fuer scripts/iel-geheimnisse-schalter.mjs (Allowlist-Uebernahme, dieselbe Zerlegung
// wie am Server).
export function csvEnv(raw) {
  return (raw || "")
    .split(",")
    .map((eintrag) => eintrag.trim())
    .filter(Boolean);
}

// KV2-10: csv-KARTE "profil:cents" -> Objekt (z.B. "el_convai_sip:23,telnyx_budget:5").
// Fail-closed wie numEnv: ein unbekanntes Profil, ein Muell-Cent oder ein Eintrag ohne
// Trenner landet in fatalConfigErrors (Boot-Refusal), nie still als 0 - ein vertippter
// Grundbetrag muesste sonst erst am Alarm-Bildschirm auffallen. abwesend/leer -> {}
// (alle Routen 0 = "noch nicht gesetzt", die heutige Reserve-Wahrheit). gueltigeRouten
// kommt vom Aufrufer (Object.values(KOSTENPROFIL), EINE Quelle) - diese Datei fuehrt
// keine zweite Routen-Liste.
function routeCentsEnv(name, raw, gueltigeRouten) {
  const karte = {};
  for (const eintrag of csvEnv(raw)) {
    const trennIndex = eintrag.lastIndexOf(":");
    const profil = trennIndex === -1 ? "" : eintrag.slice(0, trennIndex);
    const cents = trennIndex === -1 ? null : parseNumEnv(eintrag.slice(trennIndex + 1), true);
    if (!gueltigeRouten.includes(profil) || cents === null || cents < 0) {
      fatalConfigErrors.push(
        `${name}="${eintrag}" ist keine gueltige Karte profil:ganze-cent ` +
          `(gueltige Profile: ${gueltigeRouten.join("|")}).`,
      );
      continue;
    }
    karte[profil] = cents;
  }
  return karte;
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
  // FW2: Ausweich-Anbieter fuer den Guthaben-Latch. Leer/ungesetzt = Funktion AUS
  // (Verhalten byte-identisch zum Bestand). Gleiche gueltige Menge wie LLM_PROVIDER,
  // unbekannter Wert bricht den Boot ab (enumEnv). Identisch mit LLM_PROVIDER = kein
  // Ausweichen moeglich -> Konfig-Warnung beim Boot (llmFallbackFindings, boot-guard.js).
  llmProviderFallback: enumEnv("LLM_PROVIDER_FALLBACK", process.env.LLM_PROVIDER_FALLBACK, {
    allowed: LLM_PROVIDER_VALUES,
    fallback: "",
  }),
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
  // FW2: wie lange der Guthaben-Vermerk haelt. Der Latch ist ein Notbehelf MIT
  // Verfallsdatum - ein wieder aufgeladenes Konto uebernimmt ohne Neustart wieder.
  llmBillingLatchCooldownMs: numEnv("LLM_BILLING_LATCH_COOLDOWN_MS", process.env.LLM_BILLING_LATCH_COOLDOWN_MS, {
    fallback: LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT * MS_PER_MINUTE,
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
  // OUTBOUND-E4 (Drift-Waechter, Pruefung 2/6): die FQDN-Connection, an der der
  // ANI-Override der Plattform-Absendernummer haengt (gemessen 27.08.2026:
  // "3026479542865757220", ElevenLabs-SIP-Trunk). NICHT verwechseln mit
  // telnyxConnectionId (TeXML) - zwei getrennte Telnyx-Objekttypen. Leer -> der Waechter
  // meldet Pruefung 2/6 als unbekannt (nie fatal, boot-guard.js#driftConfigFindings).
  telnyxFqdnConnectionId: (process.env.TELNYX_FQDN_CONNECTION_ID || "").trim(),
  // OUTBOUND-E4 (Drift-Waechter, Pruefung 7): das Outbound-Voice-Profile, dessen
  // whitelisted_destinations mit den tatsaechlich bedienten Laendern abgeglichen wird.
  // Leer -> der Waechter meldet Pruefung 7 als unbekannt.
  telnyxOutboundVoiceProfileId: (process.env.TELNYX_OUTBOUND_VOICE_PROFILE_ID || "").trim(),
  // OUTBOUND-E5 (F3): Digest-Zugangsdaten der SIP-Trunk-FQDN-Connection
  // (fqdn_authentication_method: "credential-authentication", gemessen 2026-08-29). Nur
  // gebraucht fuer das ANLEGEN einer ElevenLabs-Nummernregistrierung (outbound_trunk_config.
  // credentials) - der Anrufstart selbst braucht sie nicht. Leer -> makeElSipRegistrar
  // (elevenlabs/nummern-registrierung.js) wirft VOR jedem Netzzugriff, jeder Aufrufer faengt
  // das als benannten Fehlschlag ab (fail-closed, KEIN No-op - Review-Blocker Runde 1).
  telnyxSipTrunkUsername: (process.env.TELNYX_SIP_TRUNK_USERNAME || "").trim(),
  // SECRET - nie loggen, nie in eine API-/MCP-Antwort, nie in einen Fehlertext.
  telnyxSipTrunkPassword: process.env.TELNYX_SIP_TRUNK_PASSWORD || "",
  // Globale ElevenLabs-Plattform-Stimme: der Rueckfallwert der Stimm-Karte, wenn eine
  // Sprache keine eigene Kennung hat (elevenLabsVoiceIdFor). EIN Leser:
  // elevenlabs/outbound.js#callLocaleOf (defaultVoiceId). Der Env-Name ist historisch
  // (bis IP3 Telnyx-Relay, bis IE6-S1 Assistant-Pfad) - eine Umbenennung ist eine
  // eigene Entscheidung, nicht Teil dieser Phase.
  telnyxElevenLabs: {
    voiceId: process.env.TELNYX_ELEVENLABS_VOICE_ID || "",
  },

  // Play-TTS: ElevenLabs-Stimme via <Play> in der Budget-Engine (Telnyx). GETRENNT vom
  // Block telnyxElevenLabs oben: dort baute Telnyx bis IP3 einen Live-Relay-Stream (der
  // den Inbound-Track unterdrueckte -> STT leer, A/B-belegt; Zweig entfernt); HIER
  // synthetisiert unser Server die mp3 vorab und Telnyx spielt eine STATISCHE Datei ->
  // Inbound-Track lebt. Gate
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
    // IE7/Owner-Entscheidung 2026-09-13: EIN Modell fuer ALLE Sprachen - es gibt keine
    // Modellwahl je Sprache und es soll auch keine geben. Der Latenz-Grund fuer
    // eleven_flash_v2_5 ist mit dem Streaming-Umbau entfallen (erstes Paket 351-391 ms
    // statt 2596-6370 ms Vollabruf). Rueckweg ohne Codeaenderung, falls das Modell doch
    // die Ursache ist: ELEVENLABS_MODEL=eleven_flash_v2_5.
    model: (process.env.ELEVENLABS_MODEL || "eleven_v3_conversational").trim(),
    apiBase: ELEVENLABS_API_BASE,
    outputFormat: (process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128").trim(), // Owner-Wahl mp3
    // IE7: die Frist bis zum ERSTEN Audio-Paket, NICHT mehr bis zur fertigen Datei
    // (src/tts/synth.js streamt). Genau dieses Warten liegt noch auf der Webhook-Wanduhr
    // und bleibt deshalb Summand der Rechnung in src/turn-budget.js (EINE Quelle):
    // 11250 + 2000 + 1500 (Reserve) = 14750 <= 15000. Gemessen liegt das erste Paket bei
    // 351-391 ms; 2000 ms ist der Puffer darueber.
    // GAP-22 (unveraendert gueltig): der Schnitt liegt bewusst HIER und nicht bei den
    // LLM-Werten - ein Synthese-Timeout faellt fail-safe auf Azure-<Say> zurueck (der Call
    // ueberlebt), ein gekuerzter LLM-Timeout kostet Antworten.
    synthTimeoutMs: numEnv("ELEVENLABS_SYNTH_TIMEOUT_MS", process.env.ELEVENLABS_SYNTH_TIMEOUT_MS, {
      fallback: 2000,
      min: 500,
      max: 10000,
    }),
    // IE7: Gesamtfrist des HINTERGRUND-Stroms, ab Aufrufbeginn. Sie liegt NICHT auf der
    // Webhook-Wanduhr (der Webhook hat nach dem ersten Paket schon geantwortet) und taucht
    // in src/turn-budget.js deshalb bewusst NICHT auf. Sie begrenzt, wie lange
    // GET /voice/tts/:token auf den Rest warten kann; reisst sie, liefert der Abruf das
    // bisher Empfangene - ein abgeschnittener gesprochener Satz, nie Stille. Gemessen:
    // vollstaendig nach 1761-2101 ms. Bleibt bewusst unter ELEVENLABS_TTS_TOKEN_TTL_MS.
    synthTotalTimeoutMs: numEnv(
      "ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS",
      process.env.ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS,
      { fallback: 10000, min: 1000, max: 30000 },
    ),
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

  // SEC-P4: der SCHARFE Zustand der Mandanten-Bindung dieses Tokens
  // (elevenlabs/tenant-tool-token.js). DEFAULT AUS, und das ist keine Bequemlichkeit:
  // die Werkzeug-Definition am Anbieter schickt den abgeleiteten Wert noch nicht mit
  // (ihr Push ist eine Eigentuemer-Handlung). AN, bevor der Anbieter sendet, hiesse:
  // look_up und get_consult antworten 404, die In-Call-Recherche stirbt und der Agent
  // steht im laufenden Gespraech stumm da (Lehre in-call-research-is-mandatory). AUS
  // wird ein FEHLENDER Wert wie bisher behandelt, ein VORGELEGTER falscher Wert aber
  // schon jetzt abgelehnt.
  elevenLabsTenantTokenRequired: boolEnv(
    "ELEVENLABS_TENANT_TOKEN_REQUIRED",
    process.env.ELEVENLABS_TENANT_TOKEN_REQUIRED,
    { fallback: false },
  ),

  // ---- ElevenLabs-Anrufstart (Convai SIP-Trunk-Outbound; optional) ----
  // Zweiter Outbound-Weg neben TeXML: das Gespraech fuehrt der
  // Agent des ANBIETERS. Der PROVIDER des Anrufs bleibt telnyx - die DID liegt dort,
  // ElevenLabs haengt per SIP-Trunk daran; es ist ein ENGINE-Zweig, kein zweiter Anbieter.
  // Der Weichenschalter steht DEFAULT AUS (fail-closed, Muster PAYMENT_ENABLED):
  // aus -> jeder Anruf laeuft unveraendert ueber den TeXML-Zweig.
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
    // OUTBOUND-E5 (F3): Schalter fuer den EINZIGEN neuen Anbieter-SCHREIBZUGRIFF dieser
    // Etappe (Anlegen einer Nummernregistrierung im Provisioning). Default AUS: der Merge
    // ist damit inert, unabhaengig von ELEVENLABS_OUTBOUND_ENABLED - kein automatisches
    // Anlegen ohne diese ausdrueckliche zweite Zustimmung (s. worker/provisioning-
    // orchestrator.js, Dreifach-Gate).
    numberRegistrationEnabled: boolEnv(
      "ELEVENLABS_NUMBER_REGISTRATION_ENABLED",
      process.env.ELEVENLABS_NUMBER_REGISTRATION_ENABLED,
      { fallback: false },
    ),
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

  // ---- ElevenLabs-Inbound (Kandidat K1, PLAN-INBOUND-PARITAET.md) ----
  // Der Gegenpart zu elevenLabsOutbound in der EINGEHENDEN Richtung: unser Webhook nimmt
  // an, laeuft durch alle sieben Sicherungen und uebergibt das Bein DANACH per SIP an denselben
  // Agenten, der den Hinweis in seiner Eroeffnung spricht (IEX-A3). Der PROVIDER bleibt telnyx, das Carrier-Bein
  // bleibt unser (und damit der Hangup-Griff).
  // DEFAULT AUS, fail-closed wie alle Engine-Weichen.
  //
  // STAND IEX-A9: dreiwertige Sprechpfad-Weiche in /voice/incoming (inboundPfadEntscheidung). Weitere Leser: drei
  // Boot-Riegel (latentCostPathFindings: Kostenpfad hat Einsammler; elInboundAccessFindings:
  // Zugang vollstaendig; elInboundScopeFindings: Scope bekannt) und die Banner-Zeile. Die Reihenfolge, die der Kostenarten-Katalog
  // verlangt, bleibt: die Katalogzeile und ihr Riegel stehen, BEVOR der Weg live gehen kann -
  // "Flag an, Kosten unsichtbar" ist damit strukturell ausgeschlossen, nicht per Disziplin.
  elevenLabsInbound: {
    enabled: boolEnv("ELEVENLABS_INBOUND_ENABLED", process.env.ELEVENLABS_INBOUND_ENABLED, {
      fallback: false,
    }),
    // IEL-B1: WELCHE Tenants den EL-Inbound-Weg ueberhaupt bekommen. LEER = NIEMAND, nie
    // JEDER (Muster ownerSelfCallTenantIds). Einmal gesplittet/getrimmt (csvEnv), das
    // Praedikat (elevenlabs/inbound-path-decision.js) vergleicht nur noch strikt.
    tenantIds: csvEnv(process.env.ELEVENLABS_INBOUND_TENANT_IDS),
    // IEX-A9 (E9): WIRKUNGSBEREICH des Wegs - allowlist (nur tenantIds, Default = heutiges Verhalten) oder
    // registrierte_dids (jede aktive DID mit gueltigem Registrierungs-Beleg; Tenant-Liste ohne Wirkung; ohne
    // Beleg Fehlersatz + Auflegen). Kein Wildcard. Getrimmt wie sttProfile; ein unbekannter Wert bricht den
    // BOOT ab (boot-guard elInboundScopeFindings), nicht erst den Anruf.
    scope: (process.env.ELEVENLABS_INBOUND_SCOPE || DEFAULT_INBOUND_EL_SCOPE).trim(),
    // IEL-B1: Digest-Zugang, mit dem unser <Dial><Sip> sich bei ElevenLabs anmeldet - EIN
    // gemeinsamer Zugang fuer alle gepinnten DIDs. Passwort SECRET - nie loggen/leaken.
    // .trim() wie bei elevenLabsToolToken: ein eingefuegtes Newline waere ein Zugang, der
    // nie passt. Mindestlaenge und Boot-Riegel: inbound-path-decision.js / boot-guard.js.
    sipUser: (process.env.ELEVENLABS_INBOUND_SIP_USER || "").trim(),
    sipPassword: (process.env.ELEVENLABS_INBOUND_SIP_PASSWORD || "").trim(), // SECRET
    // IEL-B1: geteiltes Geheimnis des Conversation-Initiation-Webhooks. SECRET - nie
    // loggen, nie in eine Antwort. Heute liest es nur der Boot-Riegel.
    initWebhookToken: (process.env.ELEVENLABS_INIT_WEBHOOK_TOKEN || "").trim(), // SECRET
  },

  // ---- Werkzeug-Schluessel (IEL-B9/B10) - KEIN Serverwert, eigener Namespace `werkzeug` ----
  // RENDER_API_KEY: nur Werkzeuge lesen ihn - scripts/push-elevenlabs.mjs (Ziel-Urteil des
  // Workspace-Init-Webhooks, nur GET) und scripts/iel-geheimnisse.mjs (GET + PUT auf genau fuenf
  // benannte Render-Schluessel). Bis IEL-B10 lag er unter voice.elevenLabsInbound; dort stand er
  // neben den Inbound-Geheimnissen, die das Geheimnis-Werkzeug nie aus der lokalen Konfiguration
  // lesen darf (Abnahme-Grep der Spec). Eigener Namespace = EIN Leser, keine zweite process.env-Stelle
  // ausserhalb dieser Datei (G5/G35). Voller Render-Workspace-Zugriff: SECRET, nie loggen, nie in
  // render.yaml, nie im Dienst gesetzt. Die Render-BASIS ist bewusst KEIN Env-Wert (Konstante in
  // src/render-api.js).
  renderApiKey: (process.env.RENDER_API_KEY || "").trim(), // SECRET

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
  // KV2-7 (Owner-Entscheidung 3, 2026-08-30): Frist bis zum Zwangs-Abschluss eines
  // Anrufs, in Stunden. Nach ihr wird geschlossen, auch wenn ein Pflicht-Traeger fehlt
  // (Matrix 4.6: nachbuchen ja, erstatten nie). VORGABE, kein Default: 48. Sie ist
  // bewusst grosszuegig - der "binnen Stunden"-Anspruch haengt am Herzschlag (KV2-6),
  // nicht an dieser Frist. min 1: eine Frist von 0 schloesse jeden Anruf sofort und
  // machte die Belegsammlung wirkungslos. Muss KLEINER bleiben als das providerseitige
  // Belegfenster (PROVIDER_COST_RECORD_WINDOW_DAYS = 7, cost-truing.js), sonst schliesst
  // die Frist erst, wenn der Beleg strukturell nicht mehr zu holen ist.
  costSettleDeadlineHours: numEnv("COST_SETTLE_DEADLINE_HOURS", process.env.COST_SETTLE_DEADLINE_HOURS, { fallback: 48, min: 1 }),
  // KV2-9 (Plan 4.4): Mindestalter eines beendeten Gespraechs, bevor der ZWEITE
  // ElevenLabs-Abruf die Belegzeile von 'vorlaeufig' auf 'belegt' hebt.
  // DER WERT IST VERMUTET, NICHT GEMESSEN (befund-elevenlabs.md 2): belegt ist
  // Stabilitaet ab 4 h 20 min (26 byteidentische Abrufe); das Verhalten in den ersten
  // Sekunden bis Minuten nach Gespraechsende hat NIE jemand gemessen, weil es in der
  // Kontohistorie keinen juengeren Anruf gab und ein Testanruf verboten war. 15 Minuten
  // sind der bewusst grosszuegige Abstand dazwischen. Der Abweichungszaehler in der
  // Sweep-Zeile IST die nachgeholte Messung (Abnahme (f)): zeigt er ueber N Anrufen 0,
  // darf die Frist gesenkt werden - als OWNER-Entscheidung, nie automatisch.
  // min 0 (sofort reifen) ist zulaessig und der Rollback-Hebel nach unten.
  elEvidenceMinAgeMinutes: numEnv("EL_EVIDENCE_MIN_AGE_MINUTES", process.env.EL_EVIDENCE_MIN_AGE_MINUTES, { fallback: 15, min: 0 }),
  // Pflicht-Menge der record_types, die ein GESUNDER Call zeigen muss. CODE-DEFAULT IST
  // DIE LEERE MENGE, und leer bedeutet 'incomplete' - nicht "alles erlaubt", sondern
  // "nichts bewiesen". BEWUSST KEIN geratener Nicht-leer-Default: ein vorbelegtes
  // ['call-control'] saehe nach Vollstaendigkeit aus und liesse ab P4 Rueckerstattungen
  // auf genau der duennen Datenlage zu, gegen die P4 argumentiert. Die Menge wird
  // gesetzt, wenn sie am Live-Beleg gemessen ist (Kandidaten aus der Messung vom
  // 2026-07-20: sip-trunking, call-control, speech-to-text, text-to-speech, recording,
  // inference, ai-voice-assistant - "call" existiert NICHT).
  // KV2-5: dieser Wert ist seit der Umstellung auf profil-adressierte Pflichtmengen die
  // Pflicht-Typmenge der ZWEI Telnyx-Profile mit Env-Marker (telnyx_budget,
  // telnyx_inbound_budget) - unveraendert wie zuvor global.
  // Das Profil el_convai_sip liest ihn NICHT: es fuehrt seine eigene, am Anbieter gemessene
  // Menge als Literal in src/billing/kostenarten.js (KOSTENPROFILE[...].pflichttypen).
  // Eine Aenderung hier bewegt weiterhin beide Telnyx-Profile gleichzeitig - bewusst
  // akzeptiertes Restrisiko (Spec KV2-5(f)); eine Aufteilung waere eine
  // Verhaltensaenderung an der Erstattungsbedingung.
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
  // KV2-6: Fensterlaenge des HERZSCHLAGS in Stunden ("gab es in den letzten N Stunden
  // beendete Anrufe mit einem Profil, das Traeger X als Pflicht fuehrt, und wurde KEIN
  // einziger Beleg dieses Traegers angelegt?"). Diese Klasse haengt an KEINER Faelligkeit
  // und ist die einzige, die den Zustand vom 19.08. binnen Stunden gemeldet haette.
  // 0 schaltet den Herzschlag AUS (Rollback-Hebel, Muster OUTAGE_ALERT_WINDOW_MS /
  // OUTAGE_ALERT_SELF_TEST_INTERVAL_MS) - sichtbar als herzschlag=aus in der Sweep-Zeile,
  // nicht still. Der Sweep zieht von diesem Fenster zusaetzlich eine ABGELEITETE Karenz
  // ab (COST_TRUING_DELAY_MINUTES + COST_TRUING_SWEEP_INTERVAL_MS): ein Anruf, der gerade
  // erst endete, kann noch keinen Telnyx-Beleg haben, und ein Alarm darauf waere der
  // Dauer-Alarm, den 4.4 verwirft. Ein Fenster KLEINER als diese Karenz ergibt ein leeres
  // Fenster - dann meldet die Sweep-Zeile herzschlag=aus.
  kostenHeartbeatFensterH: numEnv("KOSTEN_HEARTBEAT_FENSTER_H", process.env.KOSTEN_HEARTBEAT_FENSTER_H, { fallback: 6, min: 0 }),
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
  // nicht sinken darf, ohne dass ein Boot-Guard (WARN) anschlaegt. Seit KV2-10
  // DECKUNGS-UNABHAENGIG (belowFloor allein ist Ausloeser, s. boot-guard.js). GANZZAHL
  // EUR-Cent (wie der Tarif). Neuherleitung KV2-10 aus der gemessenen Vollkosten-
  // Stichprobe statt aus der (noch) aktivierbaren Assistant-Konfiguration: p95 der
  // Vollkosten je Minute der Route el_convai_sip (B2+O2: 0,1576 USD x 0,92 = 14,5 ->
  // aufgerundet 15; ohne Eigen-Achsen, Kurs 0,92). Mit gesetztem Grundbetrag
  // (VOICE_TARIFF_GRUNDBETRAG_CENTS) kann die Schwelle sinken - Neuherleitung dann ueber
  // den Tarifpaar-Report (cost-calibration.js). min:0 ist die test-neutrale Abschaltung
  // (wie VOICE_TARIFF_DOMESTIC_CENTS=0 in der Suite): unset faellt auf 15 (armiert)
  // zurueck; 0 deaktiviert den WARN bewusst und sichtbar (er ist eine Diagnose, kein
  // Geld-Gate - kein per-Default abgeschaltetes Safety-Gate).
  voiceTariffFullCostFloorCents: numEnv(
    "VOICE_TARIFF_FULL_COST_FLOOR_CENTS",
    process.env.VOICE_TARIFF_FULL_COST_FLOOR_CENTS,
    { fallback: 15, min: 0 },
  ),
  // KV2-10 (Owner-Entscheidung 5): Grundbetrag des ZWEITEILIGEN Tarifs, je Route
  // (Kostenprofil) in GANZZAHL EUR-Cent je ANRUF - csv-Karte profil:cents. Der Minutensatz
  // bleibt voiceTariffDomesticCents (Outbound-Routen) bzw. voiceTariffInboundCents
  // (Inbound-Routen); der Tarifpaar-Waechter (cost-calibration.js) prueft beide gegeneinander.
  // Herkunft des Vorschlags: KV2-10-Stichprobe, 20 ct + 18 ct/min fuer el_convai_sip.
  // GESETZT wird der Wert vom Menschen (Owner-Entscheidung 6: keine automatische
  // Justierung). Default {} = alle Routen 0 ("noch nicht gesetzt") - genau die heutige
  // Reserve-Wahrheit: dieser Grundbetrag geht in KEINE Reserve-Rechnung (KV2-10
  // Scope-Riegel), die waere eine eigene Phase. OFFENER PUNKT: der Waechter misst erst,
  // wenn eine je-Anruf-Quelle fuer die Eigen-Achsen existiert (eigenCentJeAnruf, s.
  // cost-calibration.js) - bis dahin meldet jede Zeile tarifpaar_zu_wenig_proben.
  voiceTariffGrundbetragCentsJeRoute: routeCentsEnv(
    "VOICE_TARIFF_GRUNDBETRAG_CENTS",
    process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS,
    Object.values(KOSTENPROFIL),
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
  // ---- Systematischer-Ausfall-Melder (OUTBOUND-E3b, PLAN-OUTBOUND-RESILIENZ.md E-4) ----
  // Zeitfenster, ueber das die not-placed-Fehlerquote je Klasse (Eimer) gezaehlt wird.
  // 0 = Melder KOMPLETT AUS (Rollback-Hebel, ein einziger Wert/Guard/Test statt zwei
  // verstreuter Env-Werte).
  outageAlertWindowMs: numEnv("OUTAGE_ALERT_WINDOW_MS", process.env.OUTAGE_ALERT_WINDOW_MS, {
    fallback: MS_PER_HOUR,
    min: 0,
  }),
  // K1 (kleines Volumen): Mindestzahl Fehler derselben Klasse im Fenster, BEVOR ueberhaupt
  // Alarm moeglich ist. Der gemessene Vorfall (27.08.2026) erzeugte 4 Versuche - N=3 feuert
  // vor dem letzten, ohne dass ein einzelner Fehlversuch schon eine echte SMS+Mail kostet.
  outageAlertMinFailures: numEnv("OUTAGE_ALERT_MIN_FAILURES", process.env.OUTAGE_ALERT_MIN_FAILURES, {
    fallback: 3,
    min: 1,
  }),
  // Mindestnenner, ab dem K2 (Skala) statt K1 (kleines Volumen) entscheidet UND ab dem der
  // Anteilsvergleich ueberhaupt aussagekraeftig ist (bei M=20 bedeuten 20% nie weniger als
  // 4 Fehler - K2 kann also nie schwaecher sein als K1).
  outageAlertMinAttempts: numEnv("OUTAGE_ALERT_MIN_ATTEMPTS", process.env.OUTAGE_ALERT_MIN_ATTEMPTS, {
    fallback: 20,
    min: 1,
  }),
  // K2-Schwelle in Prozent (ganzzahlig, Deviation D-4 - kein Fliesskomma-Prozent-Env im
  // Repo). 20-facher Abstand zum plausiblen Grundrauschen (<=1% not-placed im gesunden
  // Betrieb) und deutlich unterhalb jedes echten Teilausfalls.
  outageAlertFailSharePercent: numEnv(
    "OUTAGE_ALERT_FAIL_SHARE_PERCENT",
    process.env.OUTAGE_ALERT_FAIL_SHARE_PERCENT,
    { fallback: 20, min: 0, max: 100 },
  ),
  // Mindest-Wiederholfrist NACH einer bereits ZUGESTELLTEN Meldung (entprellt am VORFALL,
  // nicht am einzelnen Anruf) - derselbe Wert, den E3a bereits fuer die Nutzer-Mail
  // ausliefert (NOT_PLACED_MAIL_DEBOUNCE_MS), hier als eigener Wert, weil Nutzer- und
  // Betreiber-Kanal unabhaengig entprellt werden.
  outageAlertDebounceMs: numEnv("OUTAGE_ALERT_DEBOUNCE_MS", process.env.OUTAGE_ALERT_DEBOUNCE_MS, {
    fallback: OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT * MS_PER_HOUR,
    min: 0,
  }),
  // Mindest-Wiederholfrist nach einem VERSUCHTEN, aber NICHT zugestellten Versand (S3-2):
  // ohne diesen Wert gibt es nach einer fehlgeschlagenen Mail NULL Meldungen zum echten
  // Vorfall, solange die Entprellfrist der (nie zugestellten) Meldung laeuft.
  outageAlertRetryMs: numEnv("OUTAGE_ALERT_RETRY_MS", process.env.OUTAGE_ALERT_RETRY_MS, {
    fallback: OUTAGE_ALERT_RETRY_MINUTES_DEFAULT * MS_PER_MINUTE,
    min: 0,
  }),
  // C8b (Plan-Abschnitt "Meldeweg und Alarm-Body"): Mindestabstand zwischen zwei
  // Selbsttests desselben Kanals - "ein Kanal, der zwoelf Monate nie ausgeloest wurde, ist
  // kein bewiesener Kanal". 0 = Selbsttest KOMPLETT AUS (Rollback-Hebel, Muster
  // outageAlertWindowMs).
  outageAlertSelfTestIntervalMs: numEnv(
    "OUTAGE_ALERT_SELF_TEST_INTERVAL_MS",
    process.env.OUTAGE_ALERT_SELF_TEST_INTERVAL_MS,
    { fallback: OUTAGE_ALERT_SELF_TEST_DAYS_DEFAULT * MS_PER_DAY, min: 0 },
  ),
  // C8 (Owner-Entscheidung F-8, PLAN-OUTBOUND-RESILIENZ.md Abschnitt 9): "Darf eine
  // Kuendigung wegen einer Plattform-Bindung haengen bleiben? Ja, mit HOLD + Audit +
  // 24-h-Eskalation." Mindestalter (ab tenant.suspendedAt), ab dem ein HOLD
  // platform_number_in_use GENAU EINEN Betreiber-Befund ueber denselben Meldeweg erzeugt
  // wie der Ausfall-Alarm. 0 = Eskalation KOMPLETT AUS (Rollback-Hebel, Muster
  // outageAlertWindowMs/outageAlertSelfTestIntervalMs).
  platformHoldEscalationMaxAgeMs: numEnv(
    "PLATFORM_HOLD_ESCALATION_MAX_AGE_MS",
    process.env.PLATFORM_HOLD_ESCALATION_MAX_AGE_MS,
    { fallback: PLATFORM_HOLD_ESCALATION_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
  ),
  // GP-P0 (PLAN-GELDPFAD.md 2): Mindestdauer, die ein AKTIVER, verifizierter Subscriber
  // ohne Live-Nummer bleiben darf, bevor der Beobachtungs-Zweig des Stunden-Sweeps GENAU
  // EINEN Betreiber-Befund erzeugt. Gemessen ab dem Beginn der laufenden Stripe-
  // Abrechnungsperiode (billing/period.js#resolvePeriodStartIso - EIN Zeitbegriff, kein
  // zweiter Anker). 0 = Beobachtung KOMPLETT AUS (Rollback-Hebel, Muster
  // platformHoldEscalationMaxAgeMs).
  paidWithoutNumberGraceMs: numEnv(
    "PAID_WITHOUT_NUMBER_GRACE_MS",
    process.env.PAID_WITHOUT_NUMBER_GRACE_MS,
    { fallback: PAID_WITHOUT_NUMBER_GRACE_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
  ),
  // ---- Drift-Waechter (OUTBOUND-E4, F4, PLAN-OUTBOUND-RESILIENZ.md E-6) ----
  // Mindestfrist zwischen zwei beanspruchten Laeufen (PM-26, Single-Flight/Deploy-
  // Sturm-Schutz). 0 = der Waechter ist KOMPLETT AUS (Rollback-Hebel, Muster
  // outageAlertWindowMs). Default 10 min.
  outboundDriftMinIntervalMs: numEnv(
    "OUTBOUND_DRIFT_MIN_INTERVAL_MS",
    process.env.OUTBOUND_DRIFT_MIN_INTERVAL_MS,
    { fallback: 600000, min: 0 },
  ),
  // Ab wann die letzte ERFOLGREICHE Messung als "watchdog_stale" gilt (fuenfte
  // Befundklasse, PM-5): faengt einen abgelaufenen Schluessel, ein dauerhaftes 5xx oder
  // einen deaktivierten Actions-Workflow, die den gesamten Fruehwarner sonst STILL
  // abschalten wuerden. Default 6 h.
  outboundDriftStaleMs: numEnv("OUTBOUND_DRIFT_STALE_MS", process.env.OUTBOUND_DRIFT_STALE_MS, {
    fallback: 21600000,
    min: 0,
  }),
  // Guthaben-REICHWEITE (nicht Betrag, s. Modul-Doc outbound-config-drift.js): Guthaben
  // reicht fuer weniger als so viele Stunden bei aktuellem 24h-Verbrauch -> balance_low.
  // Default 72 h.
  outboundDriftBalanceMinHours: numEnv(
    "OUTBOUND_DRIFT_BALANCE_MIN_HOURS",
    process.env.OUTBOUND_DRIFT_BALANCE_MIN_HOURS,
    { fallback: 72, min: 0 },
  ),
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
  // KV2-10 (Katalogzeile #8, Waehrungs-Klarstellung): ElevenLabs-Grundgebuehr in GANZZAHL
  // US-Cent (LISTENPREIS; belegt: next_invoice.subtotal_cents = 600 = 6,00 USD,
  // befund-elevenlabs.md 3). Vor KV2-10 hiess der Key platformFixedCostCentsPerMonth und
  // wurde in api-billing.js als EUR-Cent angezeigt, obwohl die Rechnung auf US-Cent lautet;
  // jetzt rechnet die Route ueber DEN EINEN Kurs nach EUR-Cent um und gibt den
  // USD-Listenpreis separat mit. Der ENV-NAME bleibt unveraendert (Rename einer Env ist
  // eine eigene Entscheidung, Praezedenz SKIP_TWILIO_SIGNATURE_CHECK).
  platformFixedCostUsdCentsPerMonth: numEnv(
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
  // Stripe-Price-Ids (recurring monatlich, EUR) je Tier. Leer ist seit GP-P6 bei
  // PAYMENT_ENABLED=true ein BOOT-REFUSAL (boot.js#assertPricedPlans gegen PLAN_CATALOG);
  // bei PAYMENT_ENABLED=false bleibt leer folgenlos. Opake price_-Referenzen,
  // KEINE Secrets.
  stripeStarterPriceId: process.env.STRIPE_STARTER_PRICE_ID || "",
  stripeBusinessPriceId: process.env.STRIPE_BUSINESS_PRICE_ID || "",
  // ---- Preis-Waechter (GP-P6, PLAN-GELDPFAD.md) ----
  // Mindestabstand zweier Preis-Pruefungen. Der Waechter haengt im Stunden-Sweep, prueft
  // aber nur einmal am Tag (Owner-Entscheidung 11.09.2026, Frage 12): Stripe-Preise
  // aendern sich seltener als Telefonie-Konfiguration, und jede Pruefung ist ein
  // Anbieter-Aufruf. 0 = der Waechter ist KOMPLETT AUS (Rollback-Hebel, Muster
  // outboundDriftMinIntervalMs).
  priceDriftMinIntervalMs: numEnv("PRICE_DRIFT_MIN_INTERVAL_MS", process.env.PRICE_DRIFT_MIN_INTERVAL_MS, {
    fallback: MS_PER_DAY,
    min: 0,
  }),
  // Aufeinanderfolgende Laeufe OHNE Urteil (Netzfehler/fehlendes Lese-Scope), nach denen
  // der Waechter seine eigene Unwissenheit meldet - GENAU EINMAL. Ein einzelner
  // Netzfehler ist keine Betreiber-Meldung wert, ein dauerhaft fehlendes Scope sehr wohl
  // (Owner-Frage 13). 0 = Unwissenheits-Eskalation AUS.
  priceDriftUnknownEscalateAfter: numEnv(
    "PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER",
    process.env.PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER,
    { fallback: 3, min: 0 },
  ),
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

  // OUTBOUND-E1: die Absendernummer (ANI) des Produkt-Outbounds als E.164. Heute steht sie
  // NUR in zwei Anbieter-Konfigurationen, die KEIN Produktivcode kennt (ElevenLabs-
  // Nummernregistrierung + Telnyx ani_override) - genau deshalb konnte der Loeschweg eines
  // Wegwerf-Kontos sie am 24.08.2026 freigeben, ohne dass irgendetwas widersprach.
  // Aus diesem Wert leitet der Boot die Plattform-Bindung ab (kein von Hand gepflegtes
  // Register: ein leeres Register sieht aus wie ein gruenes).
  // Leer = KEINE Bindung -> Bestandsverhalten, und der Boot-Guard sagt das laut (nicht
  // fatal: ein Boot-Refusal tauschte ein Outbound-Problem gegen einen Inbound-Totalausfall,
  // dieselbe Abwaegung wie in boot-guard.js). Live dashboard-verwaltet - render.yaml
  // allein setzt hier nichts.
  // ABGRENZUNG zu ELEVENLABS_AGENT_PHONE_NUMBER_ID: das ist eine opake Anbieter-ID
  // (phnum_...), KEINE E.164, und aus ihr laesst sich keine Bindung ableiten.
  platformAniE164: (process.env.PLATFORM_ANI_E164 || "").trim(),

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
  // GP-P3 (PLAN-GELDPFAD.md 2): Versuchsdeckel je Mandant fuer den AUTOMATISCHEN
  // Wiederanlauf des Nummern-Provisionings nach einem Kartenwechsel. Gezaehlt werden die
  // terminal 'failed' Nummern-Datensaetze des Mandanten (state-ops failedNumberCount).
  // Erschoepft -> needs_manual_reconcile, Uebergabe an den Handbetrieb (POST
  // /api/onboard/retry, admin-only - der Deckel gilt dort NICHT, sonst gaebe es keinen
  // Ausweg). 0 = automatischer Wiederanlauf KOMPLETT AUS (Rollback-Hebel, Muster
  // provisioningRedriveMaxAgeMs) - ausdruecklich NICHT "sofort erschoepft". Der Deckel
  // ERSETZT keine Cap (MAX_NUMBERS/MAX_NUMBERS_PER_TENANT bleiben unberuehrt), er
  // ergaenzt sie an genau der Achse, an der sie strukturell nicht greifen.
  provisioningRetryMaxAttempts: numEnv(
    "PROVISIONING_RETRY_MAX_ATTEMPTS",
    process.env.PROVISIONING_RETRY_MAX_ATTEMPTS,
    { fallback: 3, min: 0 },
  ),
  // GP-P4 (PLAN-GELDPFAD.md 2): Mindestfrist zwischen zwei AUTOMATISCHEN Anstoessen
  // DESSELBEN Mandanten durch den zeitgesteuerten Wiederanlauf (Entprellung). Gemessen ab
  // dem letzten beanspruchten Anstoss (Zeitanker in state.outageAlerts, Muster drift:lauf).
  // Default 24 h: der Sweep haengt im Stunden-Takt - eine kuerzere Frist verbrennt den
  // Deckel PROVISIONING_RETRY_MAX_ATTEMPTS=3 in drei Stunden. 0 = der zeitgesteuerte
  // Zweig ist KOMPLETT AUS (Rollback-Hebel, Muster outboundDriftMinIntervalMs); der
  // ereignisgetriebene Wiederanlauf nach Kartenwechsel (GP-P3) bleibt davon unberuehrt.
  provisioningRetryMinIntervalMs: numEnv(
    "PROVISIONING_RETRY_MIN_INTERVAL_MS",
    process.env.PROVISIONING_RETRY_MIN_INTERVAL_MS,
    { fallback: MS_PER_DAY, min: 0 },
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
  // P2 (W2/E-1): der Halt des ElevenLabs-Rueckfrage-Webhooks ist GESTAFFELT - erst wird
  // geprueft, ob der Kanal traegt, dann wird auf die Antwort gewartet. Eine pauschale
  // Frist kann "kann hier ueberhaupt jemand antworten?" (Millisekunden) und "wie lautet
  // die Antwort?" (Sekunden) nicht gleichzeitig beantworten.
  // ENV-AENDERBAR und NICHT Modul-Konstante (E-1): genau die Zahl, die den Kanal toeten
  // kann, muss ohne Code-Aenderung korrigierbar sein.
  // ALLE DREI SIND VORLAEUFIG (E-6): fuer Stufe 0 und 1 existiert KEINE Messung, weil
  // genau diese Zeitpunkte bis heute nicht protokolliert werden (N-10). Sie sind in EINE
  // Richtung sicher gewaehlt - zu kurz heisst "der Agent redet weiter", zu lang heisst
  // "Stille am Telefon". P3 liefert die Telemetrie, aus der beide nachkalibriert werden.
  // Stufe 0: wurde die Frage an einen pollenden Client AUSGELIEFERT?
  elConsultDeliveryMs: numEnv("EL_CONSULT_DELIVERY_MS", process.env.EL_CONSULT_DELIVERY_MS, {
    fallback: 5000,
    min: 0,
    max: EL_CONSULT_STAGE_MAX_MS,
  }),
  // Stufe 1: hat der Client quittiert? ZUSAETZLICH zu Stufe 0 (Summe = 10 000 ms ab
  // Entstehung). Das Ausbleiben der Quittung IST der Berechtigungstest: fehlt die
  // Connector-Berechtigung fuer answer_consult, laeuft die Quittung in denselben Dialog
  // und bleibt aus - Abbruch nach 10 s statt nach 47 s (N-10, Aussage des Eigentuemers).
  elConsultAckMs: numEnv("EL_CONSULT_ACK_MS", process.env.EL_CONSULT_ACK_MS, {
    fallback: 5000,
    min: 0,
    max: EL_CONSULT_STAGE_MAX_MS,
  }),
  // Stufe 2: die eigentliche Antwort, GESAMT ab Entstehung. GEMESSEN hergeleitet: alle je
  // beantworteten Rueckfragen dieses Tenants kamen in 7,8-19,6 s (5 Faelle, gesamte
  // Historie) - 30 s tragen diesen Normalfall mit Marge.
  elConsultAnswerMs: numEnv("EL_CONSULT_ANSWER_MS", process.env.EL_CONSULT_ANSWER_MS, {
    fallback: 30000,
    min: 0,
    max: EL_CONSULT_STAGE_MAX_MS,
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
  // IE2 (PLAN-INBOUND-PARITAET.md): Takt des wiederkehrenden Geld-Waechters je aktivem
  // Anruf (telephony/budget-watchdog.js). Er fragt die EINE Achse (blockingBudgetAxis) und
  // beendet ueber den EINEN Terminierungspfad - B8: alle vier bestehenden Fragestellen sind
  // ereignisgebunden (Turn-Runde, Shim-Turn, EL-Werkzeug-Webhook, /voice/*-Re-Attach); ein
  // Anruf ohne Turn und ohne Werkzeug erreicht die Decke nie.
  // Der Betrag IST die bewusst akzeptierte Ueberziehung zwischen zwei Runden: hoechstens
  // dieser Takt an Gespraechszeit je laufendem Leg (bei VOICE_TARIFF_DEFAULT_CENTS=30
  // rund 7,5 Cent), nicht kumulativ - jede Runde liest den Ist-Stand. Deutlich unter der
  // Abrechnungsminute (Telnyx rundet auf 60 s auf), damit die Ueberziehung keine ganze
  // Carrier-Minute erreicht.
  // 0 = KOMPLETT AUS (Rueckfall-Hebel ohne Deploy, Muster PRICE_DRIFT_MIN_INTERVAL_MS).
  // Max 600000 (10 min) gegen absurde Werte - laenger als der Max-Dauer-Cap waere sinnlos.
  budgetWatchdogIntervalMs: numEnv("BUDGET_WATCHDOG_INTERVAL_MS", process.env.BUDGET_WATCHDOG_INTERVAL_MS, {
    fallback: 15000,
    min: 0,
    max: 600000,
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
  // Der Prompt-Block wirkt; einen Abnehmer fuer den gesprochenen Ueberbrueckungssatz gibt
  // es seit IE6-S1 nicht mehr (Rest-Befund R-1, entfaellt mit IE6 Stufe 3). Kein
  // Footgun-Eintrag: das Flag entwaffnet keine Sicherung, es aendert nur, WAS gesprochen wird.
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
  // OC-P1 (PLAN-OWNER-CALL): Scharfschalter der Offenlegungs-Ausnahme fuer Anrufe an die
  // EIGENE hinterlegte Nummer des anrufenden Tenants. DEFAULT AUS (fail-closed): aus ->
  // calleeIsOwner ist fuer JEDEN Anruf false -> Offenlegung ueberall, exaktes
  // Bestandsverhalten. Er ist zugleich der Notaus: ein Dashboard-Feld, kein Deploy.
  // Er schaltet NIE die Offenlegung fuer Dritte ab - er ist nur EINE von vier
  // Konjunktionen (s. src/callee-is-owner.js). Wirkt erst ab OC-P2; in OC-P1 liest das
  // Ergebnis niemand. Kein Footgun-Eintrag: ein fataler Boot-Refusal machte genau die
  // Scharfstellung unmoeglich, fuer die der Schalter existiert.
  ownerSelfCallEnabled: boolEnv(
    "OWNER_SELF_CALL_ENABLED",
    process.env.OWNER_SELF_CALL_ENABLED,
    { fallback: false },
  ),
  // OC-P1: WELCHE Tenants die Ausnahme ueberhaupt ausloesen duerfen. LEER = NIEMAND, nie
  // JEDER (Lehre streaming-armierung-allowlist). Hier wird EINMAL gesplittet/getrimmt/von
  // leeren Eintraegen befreit (csvEnv), damit das Praedikat strikt vergleichen kann und
  // nirgends ein zweites Trim-Zauberstueck entsteht. Immer ein Array of Strings, nie
  // undefined. Warum die Liste kein Beiwerk ist: POST /api/self-service/private-number
  // haengt allein hinter webAuthMw - jeder eingeloggte Tenant darf jede format-/land-
  // gueltige Nummer eintragen. Ohne die Liste waere die einzige Absicherung ein Mensch,
  // der sich an einen Env-Flip erinnert. Vor dem Launch gehoert hier ausschliesslich ein
  // Account hinein, der uns gehoert.
  ownerSelfCallTenantIds: csvEnv(process.env.OWNER_SELF_CALL_TENANT_IDS),
  // Rate-Limit pro IP und Minute fuer alle Routen ausser /voice (Provider-Webhooks;
  // localhost-Socket ausgenommen). Default 120: Dashboard pollt alle 2,5s (~24/min)
  // plus Interaktionen.
  rateLimitPerMin: numEnv("RATE_LIMIT_PER_MIN", process.env.RATE_LIMIT_PER_MIN, {
    fallback: 120,
    min: 0,
  }),
  // SEC-P3: Herkunftspruefung auf den zustandsaendernden Self-Service-Routen. Default AN.
  // Der Schalter existiert ALS RUECKFALL, nicht als Bequemlichkeit: bricht ein Deployment
  // die Annahme "Origin-Host == Request-Host" (z.B. ein Proxy, der den Host-Header
  // umschreibt), ist das Dashboard sonst nicht mehr bedienbar. BEWUSST NICHT in
  // PRODUCTION_FOOTGUNS: jeder Treffer dort ist FATAL - ein Not-Aus, der den Boot
  // verweigert, ist kein Not-Aus.
  csrfEnforce: boolEnv("CSRF_ENFORCE", process.env.CSRF_ENFORCE, { fallback: true }),
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

  // ---- OUTBOUND-E4 (F4): der ANI-Riegel - das EINZIGE Gate dieser Etappe ----
  // Default AUS: der Riegel lehnt NUR ab, wenn eine FRISCHE, LIVE-nachgemessene
  // ownership_lost-Messung vorliegt (s. outbound-gates.js). OUTBOUND_FROZEN bleibt der
  // bewusste Notaus - dieses Gate wird von KEINEM Codepfad automatisch gesetzt.
  outboundAniGateEnabled: boolEnv("OUTBOUND_ANI_GATE_ENABLED", process.env.OUTBOUND_ANI_GATE_ENABLED, {
    fallback: false,
  }),
  // Frische-Grenze: eine Messung aelter als dieser Wert gated NIE (auf plan:free steht
  // der Prozess still - eine fast stundenalte Messung darf einen Anruf nicht ablehnen,
  // obwohl der Eigentuemer laengst eine neue DID gekauft hat). Default 15 min.
  outboundAniGateMaxAgeMs: numEnv("OUTBOUND_ANI_GATE_MAX_AGE_MS", process.env.OUTBOUND_ANI_GATE_MAX_AGE_MS, {
    fallback: 900000,
    min: 0,
  }),

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
  // OUTBOUND-E3b (PM-4/BA-12): Betreiber-Zieladresse des systematischen-Ausfall-Melders.
  // BEWUSST der PRIMAERE Kanal - anders als PLATFORM_ALERT_SMS_TO (billing-Namespace)
  // haengt Mail an KEINEM Carrier: der heutige einzige Betreiber-SMS-Kanal laeuft ueber
  // dasselbe Telnyx-Konto und dieselbe Nummern-Tabelle wie der ausgefallene Outbound - ein
  // Alarm, den derselbe Defekt mitreisst, ist keiner. LEER = kein Mail-Versand, nur
  // Audit-Log (der Boot-Guard meldet das - s. boot-guard.js#alertChannelFindings - fatal,
  // wenn zusaetzlich beide anderen Bedingungen zutreffen).
  platformAlertMailTo: process.env.PLATFORM_ALERT_MAIL_TO || "",

  // ---- Voice-Engine ----
  // Fester Statuswert (IE6-S2), nicht konfigurierbar: ein gelesener, aber wirkungsloser
  // Env-Wert waere eine Statusluege (G2), ein Schalter ohne zweite Stellung toter Code (G9).
  voiceEngine: VOICE_ENGINE.BUDGET,

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
  safety: ["outboundFrozen", "allowedCountryCodes", "maxCallsPerHour", "perTargetCallCap", "perTargetWindowMs", "capFarewellLeadMs", "reserveReleaseGraceMs", "budgetWatchdogIntervalMs", "rateLimitPerMin", "csrfEnforce", "skipTwilioSignatureCheck", "fakeOriginate", "fakeOriginateElevenlabs", "outboundAniGateEnabled", "outboundAniGateMaxAgeMs"],
  billing: ["platformSpendCapCents", "paymentEnabled", "stripeSecretKey", "stripeApiBase", "numberSetupFeeCents", "paymentCurrency", "providerCurrency", "providerToBucketRateMicro", "costTruingDelayMinutes", "costTruingSweepIntervalMs", "costTruingMaxAttempts", "costSettleDeadlineHours", "elEvidenceMinAgeMinutes", "costTruingRequiredRecordTypes", "costTruingMinCoveragePercent", "costTruingCoverageStallSweeps", "kostenHeartbeatFensterH", "costDriftWarnPercent", "costAlertDebounceMs", "costCalibrationMinSamples", "voiceTariffDomesticCents", "voiceTariffDefaultCents", "voiceTariffInboundCents", "voiceTariffFullCostFloorCents", "voiceTariffGrundbetragCentsJeRoute", "voiceTariffDomesticPrefixes", "defaultTenantBudgetCents", "smsCostCents", "platformSpendWarnPercent", "platformAlertSmsTo", "outageAlertWindowMs", "outageAlertMinFailures", "outageAlertMinAttempts", "outageAlertFailSharePercent", "outageAlertDebounceMs", "outageAlertRetryMs", "outageAlertSelfTestIntervalMs", "platformHoldEscalationMaxAgeMs", "paidWithoutNumberGraceMs", "outboundDriftMinIntervalMs", "outboundDriftStaleMs", "outboundDriftBalanceMinHours", "budgetMonthEnabled", "ttsCharacterQuota", "ttsCharacterQuotaWarnPercent", "ttsQuotaCycleAnchorDay", "platformFixedCostUsdCentsPerMonth", "numberMonthlyCostCents", "stripeStarterPriceId", "stripeBusinessPriceId", "stripeWebhookSecret", "stripeCustomerRetryDelayMs", "flushEpochIso", "priceDriftMinIntervalMs", "priceDriftUnknownEscalateAfter"],
  provisioning: ["maxNumbers", "maxNumbersPerTenant", "provisioningEnabled", "provisioningRedriveMaxAgeMs", "provisioningRetryMaxAttempts", "provisioningRetryMinIntervalMs", "releaseGraceMs", "provisioningCountry", "forceNumberCountry", "geoEnabled", "geoDbPath", "worldDefaultLanguageEnabled", "ownerNumberSeed", "ownerNumberProvider", "bootstrapE164", "bootstrapProvider", "platformAniE164"],
  auth: ["mcpAuthToken", "mcpAuth", "oauthIssuerUrl", "oauthAudience", "sessionSecret", "oidcClientId", "oidcClientSecret", "workosApiBase", "workosManagementApiKey", "adminEmails", "loginRateLimitPerMin", "sessionTtlSeconds", "loginCookieTtlSeconds", "dashboardPassword", "ownerIdpSubject", "devLoginEnabled"],
  // 312k-Phase 5: Versand der Kuendigungsbestaetigung (Brevo/HTTP oder Zoho/SMTP) -
  // eigener Namespace statt Anhaengsel an auth/billing (eigenstaendige Domaene, s.
  // brevo-mail.js/smtp-mail.js/billing/cancellation-mail.js). HTTP-Fortsetzung:
  // brevoApiKey ergaenzt (Render sperrt SMTP auf kostenlosen Plaenen) -> 6.
  mail: ["brevoApiKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "mailFrom", "platformAlertMailTo"],
  llm: ["anthropicApiKey", "llmProvider", "deepseekApiKey", "claudeModel", "llmRequestTimeoutMs", "llmMaxRetries", "llmBackoffMs", "llmBreakerThreshold", "llmBreakerWindowMs", "llmBreakerCooldownMs", "llmProviderFallback", "llmBillingLatchCooldownMs", "modelPricesUsd", "usdToEur", "briefingModel", "briefingTimeoutMs", "summaryTimeoutMs"],
  telnyx: ["telnyxElevenLabs"],
  voice: ["voiceEngine", "elevenLabsPlayTts", "elevenLabsToolToken", "elevenLabsTenantTokenRequired", "elevenLabsOutbound", "elevenLabsInbound", "sttProfile", "sttSpeechTimeoutSec", "maxEmptyTurns", "callerSubstanceMinLen", "sendSmsSummary", "dailySmsCap", "thinkingSignalEnabled", "toolFollowUpEnabled", "ownerSelfCallEnabled", "ownerSelfCallTenantIds"],
  telephony: ["telnyxApiKey", "telnyxPublicKey", "telnyxApiBase", "telnyxConnectionId", "telnyxAccountSid", "machineDetection", "telnyxFqdnConnectionId", "telnyxOutboundVoiceProfileId", "telnyxSipTrunkUsername", "telnyxSipTrunkPassword"],
  tenancy: ["multiTenant", "mcpUiEnabled", "assistantContextEnabled", "selfServiceEnabled", "profilesSeed", "precallBriefingEnabled", "consultEnabled", "inCallConsultEnabled", "consultWaitMs", "consultOpenMs", "elConsultDeliveryMs", "elConsultAckMs", "elConsultAnswerMs"],
  server: ["port", "publicUrl", "isProduction", "deployedCommit", "dataDir", "publicDir", "webDistDir", "shutdownDrainTimeoutMs"],
  store: ["storeBackend", "databaseUrl", "queueBackend"],
  metrics: ["metricsEnabled"],
  privacy: ["retentionDays", "diagnosticRetentionDays", "evidenceRetentionDays"],
  research: ["researchEnabled", "researchMaxUses", "researchSearchFeeCents", "lookupEnabled", "lookupSearchFeeCents", "exaApiKey", "exaApiBase"],
  // IEL-B10: Schluessel, die nur Werkzeuge (scripts/) lesen - nie der Server.
  werkzeug: ["renderApiKey"],
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
    // FW2: derselbe Schluessel, zweiter Anlass - ein gesetzter Ausweich-Anbieter ohne
    // Schluessel wuerde JEDEN Aufruf nach dem Latch mit 401 beantworten, also genau im
    // Notfall versagen.
    fehlt: () =>
      (config.llm.llmProvider === LLM_PROVIDER.DEEPSEEK ||
        config.llm.llmProviderFallback === LLM_PROVIDER.DEEPSEEK) &&
      !config.llm.deepseekApiKey,
    name: "DEEPSEEK_API_KEY (weil LLM_PROVIDER/LLM_PROVIDER_FALLBACK=deepseek)",
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
    // (Muster STRIPE_SECRET_KEY). Die Price-Ids stehen NICHT in dieser Tabelle, sind seit
    // GP-P6 aber sehr wohl Boot-Pflicht bei aktivem Payment - geprueft in
    // boot.js#assertPricedPlans gegen PLAN_CATALOG, nicht hier (die Slug->Price-Zuordnung
    // lebt in billing/subscribe.js, G13).
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
]);

const isPositiveIntegerFee = (cents) => Number.isInteger(cents) && cents > 0;

// Fatal-Befunde, die den Boot stoppen (fail-closed statt stillem Gate-Aus):
//  - numerische (AC1/AC2): NaN/Infinity/Bereichsverletzung einer gesetzten Env-Var.
//  - Produktions-Footguns (H1): im Hosting (RENDER_EXTERNAL_URL) offene/abgeschaltete
//    Auth-/Signatur-Gates. Lokal liefert productionFootguns() ein leeres Array.
//  - Alarmkanal (GAP-07): scharfe Spend-Warnung ohne Empfaenger. Die Entscheidung selbst
//    lebt NICHT hier, sondern in der einen Wahrheitstabelle (boot-guard.alertChannelFindings) -
//    diese Zeile faltet nur ihren fatalen Anteil in dieselbe Ausgabe wie die uebrigen Fatals.
function fatalConfigFindings(isProduction) {
  // OUTBOUND-E3b: aus dem Aufruf-Ausdruck herausgezogen (G36/no-restricted-syntax) - die
  // Kombination aus tief verschachtelten Feldzugriffen UND der .filter().map()-Kette
  // darunter riss sonst ueber die erlaubte Verkettungstiefe. Die Zusammenfuehrung selbst
  // kommt aus boot-guard.alertChannelInputs (G5-Fix: EINE Quelle statt zweier
  // byte-identischer Kopien, geteilt mit warnAlertChannelUnset in boot.js).
  const alertChannelConfig = alertChannelInputs({
    billing: config.billing,
    mail: config.mail,
    voice: config.voice,
  });
  return configFatalErrors()
    .concat(productionFootguns(config, isProduction))
    .concat(
      alertChannelFindings(alertChannelConfig)
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
