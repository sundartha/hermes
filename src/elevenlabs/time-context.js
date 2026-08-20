// ---- Zeitkontext eines Anrufs: zwei Zonen und das heutige Datum ----------------------
// Der Agent des ANBIETERS weiss ausschliesslich, was der Anrufstart ihm mitgibt. Der
// Bestandsweg loest beides PRO ANRUF auf (src/claude.js promptInputs: Zeitzone des
// Tenants plus ein frisches `now` im Systemprompt, P8/FMT-28 - der Agent nannte deutschen
// Anrufern zuvor eine um 1-2 h falsche Uhrzeit, weil der Serverprozess UTC faehrt). Dieses
// Modul ist die Entsprechung fuer den ElevenLabs-Weg: reine Funktionen ueber Store-Werten,
// kein Store, keine Config, kein IO.
//
// NUR ANZEIGE, KEIN GATE (LAW-07): hier wird nichts ENTSCHIEDEN, nur beschrieben. Das
// Anrufzeit-Gate ist ausdruecklich abgelehnt (Owner-Auflage 7.6); dass kein Gate-Modul die
// Zeitzone liest, haelt test/p8-timezone-no-gate.test.js strukturell fest. Deshalb liegt
// die Ableitung HIER und nicht im Aufrufer: src/routes/api-calls.js steht dort auf der
// VERBOTS-Liste.
//
// NIE RATEN (Eigentuemer-Entscheidung E2): fuer die Zone des ANGERUFENEN gibt es kein
// Feld, nur das Land seiner Nummer. Laesst es sich nicht ableiten - und das ist bei JEDER
// +1-Nummer der Fall, weil 25 NANP-Laender die Vorwahl teilen und countryForE164 dort
// bewusst null liefert -, reist KEINE TATSACHE. Der Rueckfall auf DEFAULT_TIMEZONE, den
// timezoneForCountry fuer die Anzeige faehrt, waere an dieser Stelle ein Schaden: er
// behauptete fuer jeden US-Anruf lautlos die Berliner Zone. Eine falsche Zone ist
// schlimmer als keine - mit ihr rechnet der Agent um und sagt einen Termin zu, den beide
// Seiten verschieden verstehen.
//
// TATSACHE UND HYPOTHESE SIND ZWEI DINGE (Eigentuemer-Entscheidung 2026-08-15) und stehen
// deshalb in zwei Feldern: die Zone aus dem LAND steht fest, die aus der VORWAHL einer
// +1-Nummer ist eine Vermutung (nanp-area-codes.js). Eine Vermutung wird hier nie zur
// Tatsache aufgewertet und eine Tatsache nie zur Vermutung herabgestuft; wie der Agent mit
// jeder der beiden Lagen spricht - und was er ohne jede Zone tut -, entscheidet der
// Aufrufer (calleeTimezoneText in outbound.js).
import { TIMEZONE_FOR_COUNTRY } from "../geo/resolve.js";
import { LOCALES } from "../i18n/locales.js";
import { countryForE164, resolveTimezone } from "../store/defaults.js";
import { timezoneHypothesisForNumber } from "./nanp-area-codes.js";

// Kein ableitbares Land -> kein Wert (s. Kopfnotiz). Benannt, weil der leere String hier
// eine Aussage ist ("wir wissen es nicht") und kein vergessener Default.
const KEINE_ZONE = "";

// Datums-Schreibweise fuer ein Sprachmodell: ausgeschriebener Monat statt Ziffern, damit
// 08/09 nicht zugleich als 9. August und als 8. September lesbar ist, und MIT Wochentag,
// weil fast jeder Auftrag "naechsten Donnerstag" verhandelt. Die Locale ist die des
// englischen Bestands-Prompts (LOCALES.en.dateLocale) - der Agent der Vorlage ist fest
// englisch (agent.language "en"), eine zweite, hier getippte Locale waere eine zweite
// Wahrheit (G5).
const DATE_LOCALE = LOCALES.en.dateLocale;
const DATE_FORMAT = Object.freeze({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Die Zone des Angerufenen aus dem Land seiner Nummer - oder gar nichts. Die Tabelle wird
// DIREKT gelesen und nicht ueber timezoneForCountry: genau deren Rueckfall auf den Default
// ist hier verboten. countryForE164 liefert bereits den kanonischen Grossbuchstaben-
// Schluessel derselben Tabellen-Familie, eine zweite Normalisierung waere Dopplung.
export function calleeTimezone(e164) {
  const land = countryForE164(e164);
  return (land && TIMEZONE_FOR_COUNTRY[land]) || KEINE_ZONE;
}

// Das heutige Datum in EINER Zone. Es ist die des AUFTRAGGEBERS: in seiner Zeit steht der
// Termin hinterher in seinem Kalender, und zwischen zwei weit auseinanderliegenden Zonen
// kann ein Datumswechsel liegen.
export function todayIn(timeZone) {
  return new Intl.DateTimeFormat(DATE_LOCALE, { ...DATE_FORMAT, timeZone }).format(new Date());
}

/**
 * Der Zeitkontext EINES Anrufs, aus den Werten, die der Aufrufer bereits hat.
 *
 * ownerZone laeuft ueber resolveTimezone und ist damit IMMER ein gueltiger IANA-Bezeichner
 * (fehlend/Muell -> DEFAULT_TIMEZONE) - genau wie im Bestandsweg, und dort wie hier
 * zwingend: Intl wirft bei unbekannter Zone einen RangeError, und ein Wurf an dieser
 * Stelle toetete den Anruf. Fuer die Gegenstelle gilt das Gegenteil (s. Kopfnotiz): dort
 * gibt es keinen Ersatzwert, nur den leeren - und zwei getrennte Felder, weil calleeZone
 * feststeht und calleeZoneHypothesis nur vermutet ist.
 */
export function callTimeContext({ tenantTimezone, callee }) {
  const ownerZone = resolveTimezone(tenantTimezone);
  const calleeZone = calleeTimezone(callee);
  return {
    ownerZone,
    calleeZone,
    // Die Vermutung tritt NUR ein, wo keine Tatsache steht. Beide zugleich kann es heute
    // nicht geben (die Vorwahl-Tabelle kennt nur +1, und genau dort liefert countryForE164
    // nichts) - die Bedingung haelt das fest, statt sich darauf zu verlassen.
    calleeZoneHypothesis: calleeZone ? KEINE_ZONE : timezoneHypothesisForNumber(callee),
    today: todayIn(ownerZone),
  };
}
