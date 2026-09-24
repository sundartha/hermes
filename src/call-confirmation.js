// ---- Geldpfad: serverseitige Bestaetigung vor dem Waehlen (T2-13, N-10) -----------------
// WAS DIE BESTAETIGUNG BEWEIST: der Server hat fuer GENAU diese Anfrage (Mandant,
// normalisiertes Ziel, ALLE uebrigen Argumente inkl. briefing/context) innerhalb der
// letzten maximal
// CONFIRMATION_WINDOW_MS * ACCEPTED_WINDOWS einen Code ausgestellt, und dieser Code ist noch
// nicht verbraucht. Der Code steht nur im Ergebnis-`_meta` von `prepare_call` (Karte, nicht
// Modelltext) - auf einem Host, der sich an diesen Vertrag haelt, erreicht er das Modell also
// nur ueber eine Nutzerhandlung.
//
// WAS SIE NICHT BEWEIST: dass ein Mensch die Vorschau gelesen hat (reicht ein Host `_meta`
// doch ans Modell weiter, kann das Modell sich unbemerkt selbst bestaetigen), dass die
// klickende Person der Kontoinhaber ist, oder eine Autorisierung - sie ersetzt KEIN Gate.
// Abo+KYC-Permit, OUTBOUND_FROZEN, Denylist, Land, Stundenlimit/Ziel-Cap, Tenant-Kostendecke,
// Max-Dauer und die Signaturpruefung laufen beim echten Waehlen unveraendert in
// POST /api/calls. Details/Grenzen: PLAN-SECURITY.md, Abschnitt "OpenAI-T2-13".
//
// Reines Modul (Muster src/elevenlabs/tenant-tool-token.js): keine Store-, keine Netz-
// Abhaengigkeit, komplett unit-testbar.
import { createHmac, hkdfSync } from "node:crypto";

import { safeEqual } from "./util.js";
import { MS_PER_MINUTE } from "./utils/timer.js";

// Alphabet: Crockford-Base32 ohne I/L/O/U (Verwechslungsgefahr beim Vorlesen/Abtippen).
export const CONFIRMATION_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
// Brute-Force-Rechnung (KORRIGIERT, Safety-Review T2-13; die erste Fassung zaehlte nur EINEN
// Kandidaten je Versuch und nahm das Rate-Limit als einzige Bremse):
// - Suchraum: 32^6 = 2^30, rund 1,07e9 moegliche Codes.
// - Kandidaten je Versuch: ein vorgelegter Code wird gegen GENAU EINEN Code je akzeptiertem
//   Fenster geprueft (den des aktuellen Slots, s. matchedWindowIndex/slotForWindow), also
//   gegen hoechstens ACCEPTED_WINDOWS = 2 Kandidaten. P(Treffer je Versuch) <= 2/2^30 =
//   2^-29, rund 1,9e-9.
// - Versuche: das Rate-Limit (RATE_LIMIT_PER_MIN, Default 120/min je Mandant auf POST /mcp)
//   allein reicht NICHT - es erlaubt rund 6,3e7 Versuche im Jahr (P ~ 11 %), und stdio
//   laeuft ueber Loopback ganz ohne Rate-Limit. Deshalb die Fehlversuchsbremse
//   MAX_FAILED_CONFIRMATIONS_PER_WINDOW (unten): hoechstens 10 Fehlversuche je Mandant und
//   CONFIRMATION_WINDOW_MS (5 min) je App-Instanz, danach wird bis Fensterende JEDER Code
//   abgelehnt (auch ein richtiger - fail-closed).
// - Ergebnis (Summenschranke): je 5-Minuten-Fenster <= 10 * 2^-29 ~ 1,9e-8, je Tag (288
//   Fenster) ~ 5,4e-6, je Jahr (~1,05e6 Versuche) ~ 2e-3 - je App-Instanz; bei N Instanzen
//   das N-fache (Bremse und Register leben im Prozessspeicher, s. PLAN-SECURITY.md).
// Jeder Versuch muss zudem dieselben gebundenen Argumente tragen, sonst prueft er gegen den
// Code einer anderen Anfrage.
export const CONFIRMATION_CODE_LENGTH = 6;
// Fenstergroesse: ein frisch ausgestellter Code ist sofort bis zu CONFIRMATION_WINDOW_MINUTES
// Minuten gueltig (MS_PER_MINUTE = bestehende Zeit-Umrechnung, src/utils/timer.js).
const CONFIRMATION_WINDOW_MINUTES = 5;
export const CONFIRMATION_WINDOW_MS = CONFIRMATION_WINDOW_MINUTES * MS_PER_MINUTE;
// Akzeptiert werden das aktuelle und das vorherige Fenster - Gueltigkeit damit effektiv
// zwischen 5 und 10 Minuten (abhaengig davon, wie kurz vor Fensterende ausgestellt wurde).
// Das ist zugleich die kleinste Kandidatenmenge, die der Entwurf fachlich braucht: mit nur
// EINEM Fenster liefe ein kurz vor der Fenstergrenze ausgestellter Code nach Sekunden ab,
// bevor ein Mensch die Karte gelesen hat.
export const ACCEPTED_WINDOWS = 2;
// Fehlversuchsbremse je Mandant und Fenster (Rechnung oben). 10 laesst einem Menschen
// Luft fuer ein paar echte Fehlgriffe (abgelaufener Code, umformuliertes Anliegen) und
// haelt die Trefferwahrscheinlichkeit trotzdem im Promille-Bereich je Jahr.
export const MAX_FAILED_CONFIRMATIONS_PER_WINDOW = 10;
// Ein kuerzeres/leeres Geheimnis ergibt keinen Schluessel (fail-closed, s. deriveConfirmationKey).
export const CONFIRMATION_SECRET_MIN_LENGTH = 32;
// Versions-Praefix in der Ableitung: eine kuenftige Aenderung bekommt ein eigenes Praefix
// und kollidiert nicht mit alten Codes (Muster tenant-tool-token.js). v2 (Safety-Review
// T2-13): HMAC-Eingabe als JSON-Tupel statt "|"-Verkettung, Slot als eigenes Element.
export const DERIVATION_VERSION = "v2";
const HKDF_INFO = Buffer.from("hermes-call-confirmation-v1", "utf8");
const HKDF_KEY_LENGTH = 32;

/**
 * Der aus dem Betriebsgeheimnis abgeleitete Bestaetigungs-Schluessel. null heisst: nicht
 * ableitbar (fehlendes oder zu kurzes Geheimnis) - fail-closed, nie ein schwacher Schluessel.
 */
export function deriveConfirmationKey(secret) {
  if (typeof secret !== "string" || secret.length < CONFIRMATION_SECRET_MIN_LENGTH) return null;
  return Buffer.from(hkdfSync("sha256", secret, "", HKDF_INFO, HKDF_KEY_LENGTH));
}

// Rekursiv sortierte Kopie: Schluesselreihenfolge wird egal, undefined/fehlende Felder
// werden gleich behandelt (beide verschwinden aus dem Ergebnis - "nicht gesetzt"; ueber
// den JSON-Body der Route kommt undefined ohnehin nie an). Alles andere bleibt ein
// EIGENER Wert: "" ist nicht "fehlt", {} nicht "fehlt", null nicht "". Strings bleiben
// exakt, kein Trim - ein Leerzeichen mehr im Briefing ist ein ANDERER Anruf.
function sortedCanonical(value) {
  if (Array.isArray(value)) return value.map(sortedCanonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = sortedCanonical(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Bindet ALLE Argumente ausser confirmation_code - to (normalisiert), objective, language,
 * max_duration_s, constraints, mandate, diagnostic UND briefing/context. KORRIGIERT
 * (Safety-Review T2-13, Lead-Entscheidung): briefing/context waren kurz ungebunden; die
 * Vorschau zeigt sie aber, und ein per Prompt-Injection gesteuertes Modell haette nach dem
 * Klick Inhalt und Ton des Anrufs tauschen koennen. Der Nutzer bestaetigt, was tatsaechlich
 * passiert - jede Aenderung nach dem Klick braucht ein neues prepare_call. Ausschluss statt
 * Positivliste: jedes KUENFTIGE Argument ist damit automatisch gebunden (fail-closed).
 * `to` in NORMALISIERTER Form (der Aufrufer uebergibt das aufgeloeste Ziel separat - es
 * ersetzt ein eventuelles args.to).
 */
export function canonicalCallRequest({ to, args }) {
  const { confirmation_code: _notBound, ...bound } = args || {};
  return JSON.stringify(sortedCanonical({ ...bound, to }));
}

function* acceptedWindowIndices(nowMs) {
  const currentWindow = windowIndexFor(nowMs);
  for (let offset = 0; offset < ACCEPTED_WINDOWS; offset++) yield currentWindow - offset;
}

/**
 * Bis wann ein in Fenster windowIdx ausgestellter Code angenommen wird (Ende des letzten
 * akzeptierten Fensters). Einmal-Verbrauch und Slot-Register muessen ihre Eintraege
 * MINDESTENS so lange halten - sonst waere ein verbrauchter Code im Folgefenster erneut
 * gueltig.
 */
export function acceptanceEndMs(windowIdx) {
  return (windowIdx + ACCEPTED_WINDOWS) * CONFIRMATION_WINDOW_MS;
}

// Exportiert (Safety-Nachbesserung T2-13): der Aufrufer (die Bestaetigungs-Route) braucht
// denselben WindowIndex fuer das Slot-Register, das nach einem Verbrauch einen frischen
// Code erzwingt (s. api-call-confirmations.js) - EINE Formel statt einer zweiten Kopie.
export function windowIndexFor(nowMs) {
  return Math.floor(nowMs / CONFIRMATION_WINDOW_MS);
}

// HMAC-Eingabe als JSON-Tupel: jedes Element ist eindeutig abgegrenzt, auch wenn ein
// Mandant oder die kanonische Anfrage das Trennzeichen einer Verkettung enthielte. Der Slot
// (Slot-Register in src/routes/api-call-confirmations.js: nach einem Verbrauch stellt
// prepare_call fuer dieselbe Anfrage einen Code des NAECHSTEN Slots aus) geht NUR in die
// Ableitung ein, nicht in das, was der Code inhaltlich bindet.
function codeForWindow({ key, tenantId, canonical, windowIdx, slot }) {
  const mac = createHmac("sha256", key)
    .update(JSON.stringify([DERIVATION_VERSION, tenantId, windowIdx, slot, canonical]))
    .digest();
  let code = "";
  for (let i = 0; i < CONFIRMATION_CODE_LENGTH; i++) {
    code += CONFIRMATION_CODE_ALPHABET[mac[i] % CONFIRMATION_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Stellt einen Code fuer das AKTUELLE Fenster (und den gegebenen Slot, Default 0) aus, plus
 * dessen fruehesten Ablaufzeitpunkt.
 */
export function issueConfirmationCode({ key, tenantId, canonical, nowMs, slot = 0 }) {
  const windowIdx = windowIndexFor(nowMs);
  return {
    code: codeForWindow({ key, tenantId, canonical, windowIdx, slot }),
    expiresAtMs: (windowIdx + 1) * CONFIRMATION_WINDOW_MS,
  };
}

// Eingabe-Normalisierung: Grossbuchstaben, Leerzeichen und Bindestriche raus (Menschen
// tippen/lesen Codes oft mit Trenner-Formatierung vor). Exportiert, damit der Aufrufer
// (die Bestaetigungs-Route) denselben normalisierten Wert fuer den Einmal-Verbrauch-Digest
// verwenden kann wie diese Pruefung selbst - sonst koennte "abc-123" und "ABC123" als zwei
// verschiedene Codes durchgehen und den Einmal-Verbrauch umgehen.
export function normalizeConfirmationCode(code) {
  if (typeof code !== "string") return "";
  return code.toUpperCase().replace(/[\s-]/g, "");
}

const NO_SLOT_REGISTER = () => 0;

/**
 * Welches Fenster (aktuell oder vorheriges) den vorgelegten Code bestaetigt, oder null.
 * Geprueft wird je akzeptiertem Fenster GENAU EIN Kandidat: der Code des Slots, den
 * slotForWindow(windowIdx) als aktuell meldet (ohne Register: Slot 0) - also hoechstens
 * ACCEPTED_WINDOWS Kandidaten je Versuch (Rechnung oben). Codes aelterer Slots sind damit
 * ungueltig, noch nie ausgestellte spaetere Slots ebenso.
 * Timing-sicherer Vergleich (safeEqual, Absolute Regel 3). key === null (nicht ableitbares
 * Geheimnis) ergibt immer null - niemals ein Match ohne echten Schluessel. Der Aufrufer
 * braucht den WindowIndex fuer den Einmal-Verbrauch-Digest (Mandant+Fenster+Code).
 */
export function matchedWindowIndex({ key, tenantId, canonical, code, nowMs, slotForWindow = NO_SLOT_REGISTER }) {
  if (!key) return null;
  const normalized = normalizeConfirmationCode(code);
  if (!normalized) return null;
  for (const windowIdx of acceptedWindowIndices(nowMs)) {
    const candidate = codeForWindow({ key, tenantId, canonical, windowIdx, slot: slotForWindow(windowIdx) });
    if (safeEqual(normalized, candidate)) return windowIdx;
  }
  return null;
}

/** Boolean-Fassade von matchedWindowIndex - fuer Aufrufer, die nur JA/NEIN brauchen. */
export function verifyConfirmationCode(args) {
  return matchedWindowIndex(args) !== null;
}
