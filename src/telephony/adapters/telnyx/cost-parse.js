// Telnyx-Geld-Parsing: Dezimal-/Exponentialstring der Provider-HAUPTWAEHRUNG (USD) ->
// GANZZAHL Mikro-Cents. REIN STRING-BASIERT: kein parseFloat, kein Number auf dem
// Geldstring (G26 - Geld nie als Fliesskomma). Der Dezimalpunkt wird durch Stellen-
// SCHIEBEN verlegt, nicht durch Multiplikation.
//
// Nicht parsebar, negativ, Exponent ausser Bereich, absurd gross -> null = KEIN RECORD.
// NIEMALS 0. Ein stillschweigend zu 0 gewordener Preis ist die gefaehrlichste Zahl der
// ganzen Kette (PLAN-LIVE-COST-TRACING P4): er sieht aus wie eine gemessene Null.
// Eine ECHTE Null ist etwas anderes und bleibt gueltig - speech-to-text liefert
// "0.0000" bei rate "0.01500" real aus (Messung 2026-07-20, 293 Records).
//
// Wissenschaftliche Notation ist NORMALBETRIEB, keine Korruption: 16 von 50
// text-to-speech-Records tragen "1.61E-4"/"1.687E-4"/"1.75E-4", inference-rate "1.0E-4",
// tts-rate "7.0E-7" (dieselbe Messung). Klein-e und Gross-E sind gleichwertig.
import { CENTS_PER_EUR, MICRO_CENTS_PER_CENT } from "../../../store/defaults.js";

// Hauptwaehrungseinheit -> Mikro-Cent. ZUSAMMENGESETZT aus den beiden vorhandenen
// Konstanten, NICHT als nackte 10^8 (G25/G5): eine zweite, unabhaengig gepflegte 100
// waere genau die Drift, an der der naechste Einheiten-Fehler entsteht. CENTS_PER_EUR ist
// hier die waehrungs-UNABHAENGIGE Untereinheiten-Teilung (100 Cent je Einheit) - USD
// teilt genauso. Live belegt: sip-trunking rate "0.0401" / cost "0.0802" bei
// billed_sec 120, currency USD -> 4,01 USD-Cent je Minute.
const MICRO_CENTS_PER_CURRENCY_UNIT = CENTS_PER_EUR * MICRO_CENTS_PER_CENT;
// Stellenzahl dieses Faktors = Ziel-Nachkommastellen beim Schieben. Aus dem Faktor
// ABGELEITET statt als zweite 8 gepflegt.
const MICRO_CENT_DECIMALS = String(MICRO_CENTS_PER_CURRENCY_UNIT).length - 1; // 8

// Erlaubter Exponentbereich. Beobachtet: -7 bis -4. Alles darueber/darunter ist kein
// Preis, sondern ein Datenfehler -> kein Record (statt "still gross").
const COST_EXPONENT_MIN = -12;
const COST_EXPONENT_MAX = 6;
// Laengenriegel VOR jeder Zahl-Konversion: begrenzt Mantisse/Exponent-Ziffernketten und
// das Ergebnis, damit die abschliessende Konversion des reinen Ziffernstrings exakt
// bleibt (< 2^53). Ueberschreitung -> kein Record.
const COST_EXPONENT_MAX_DIGITS = 4;
const MICRO_CENTS_MAX_DIGITS = 15;

// Ganzzahl | Dezimal, optional mit Exponent. Vorzeichen wird MITGELESEN, damit "-0.01"
// einen eigenen Ablehnungsgrund bekommt statt als Syntaxmuell durchzugehen.
// Nachkommateil braucht mindestens eine Ziffer ("1." ist ungueltig).
const COST_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

// Nur Ziffern, kein Vorzeichen - billed_sec ist niemals negativ, ein Vorzeichen
// waere schon strukturell ein Datenfehler statt einer gueltigen Sekundenzahl.
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

// Exponent-Teil pruefen und in eine Ganzzahl uebersetzen. Laengenriegel VOR der
// Number()-Konversion: die Exponent-Ziffernkette ist kein Geldstring (G26 verbietet
// Number() nur fuer den Geldbetrag selbst), aber erst formatgeprueft + laengenbegrenzt,
// dann exakt konvertierbar.
function parseCostExponent(rawExponent) {
  if (rawExponent === undefined) return 0;
  const digits = rawExponent.replace(/^[+-]/, "");
  if (digits.length > COST_EXPONENT_MAX_DIGITS) return null;
  const exponent = Number(rawExponent);
  if (exponent < COST_EXPONENT_MIN || exponent > COST_EXPONENT_MAX) return null;
  return exponent;
}

// Dezimalpunkt per Stellen-SCHIEBEN auf MICRO_CENT_DECIMALS Nachkommastellen bringen (nie
// Multiplikation/parseFloat). shift >= 0 -> mit Nullen auffuellen; shift < 0 -> die
// ueberzaehligen Nachkommastellen abschneiden (Richtung 0), bei einem Ueberschuss >= der
// gesamten Ziffernkette bleibt "0" (gueltiger Record, s. Kopf-Kommentar).
function shiftDecimalToMicroCents(digits, fracLength, exponent) {
  const shift = MICRO_CENT_DECIMALS - (fracLength - exponent);
  let shifted;
  if (shift >= 0) shifted = digits + "0".repeat(shift);
  else if (shift <= -digits.length) shifted = "0";
  else shifted = digits.slice(0, shift);
  const microDigits = shifted.replace(/^0+/, "") || "0";
  if (microDigits.length > MICRO_CENTS_MAX_DIGITS) return null;
  // Reiner, laengengepruefter Ziffernstring -> exakt (< 2^53). Der Geldstring selbst ist
  // an dieser Stelle bereits vollstaendig string-basiert in Ganzzahl-Form ueberfuehrt -
  // kein Verstoss gegen "kein Number auf Geldstrings" (G26).
  return Number(microDigits);
}

// Telnyx-`cost`-Dezimalstring (Provider-Hauptwaehrungseinheit, z.B. USD) -> GANZZAHL
// Mikro-Cents. Nicht parsebar, mit Vorzeichen (auch fuehrendes "+", nie beobachtet),
// Exponent ausser Bereich oder Ergebnis zu lang -> null = KEIN RECORD (niemals 0).
export function parseDecimalToMicroCents(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = COST_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, sign, intPart, fracPart = "", rawExponent] = match;
  if (sign) return null; // "-" = negativ, "+" nie beobachtet -> beide ungueltig
  const exponent = parseCostExponent(rawExponent);
  if (exponent === null) return null;
  return shiftDecimalToMicroCents(intPart + fracPart, fracPart.length, exponent);
}

// z.B. billed_sec: string|number -> Ganzzahl >= 0, oder null. KEINE Geldgroesse (deshalb
// gelten die Money-Restriktionen aus parseDecimalToMicroCents hier nicht) - eigener,
// strenger Voll-String-Check. NUM_ENV_INTEGER_PATTERN (config.js) ist an numEnv/
// fatalConfigErrors gekoppelt (env-gebunden) und erlaubt zusaetzlich ein Vorzeichen ->
// hier nicht wiederverwendbar, deshalb lokal und eigens benannt.
export function parseNonNegativeInteger(raw) {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return Number.isSafeInteger(n) ? n : null;
}
