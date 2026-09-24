// ---- Geldpfad: serverseitige Bestaetigung vor dem Waehlen (T2-13, N-10) -----------------
// WAS DIE BESTAETIGUNG BEWEIST: der Server hat fuer GENAU diese Anfrage (Mandant,
// normalisiertes Ziel, alle uebrigen Argumente) innerhalb der letzten maximal
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
// Brute-Force-Rechnung (Pre-Mortem Punkt 10): 32^6 = 2^30, rund 1,07e9 moegliche Codes.
// Bei RATE_LIMIT_PER_MIN=120 Aufrufen/Minute je Mandant (src/config.js) und einer
// Gueltigkeit von ACCEPTED_WINDOWS*CONFIRMATION_WINDOW_MS = 10 Minuten sind das hoechstens
// 1200 Versuche je Gueltigkeitsfenster, P(Treffer) also rund 1200/1.07e9 = 1,1e-6. Dazu
// kommt: jeder Versuch muss dieselben Argumente (to/objective/briefing/...) tragen, sonst
// prueft er gegen einen anderen Code.
export const CONFIRMATION_CODE_LENGTH = 6;
// Fenstergroesse: ein frisch ausgestellter Code ist sofort bis zu CONFIRMATION_WINDOW_MINUTES
// Minuten gueltig (MS_PER_MINUTE = bestehende Zeit-Umrechnung, src/utils/timer.js).
const CONFIRMATION_WINDOW_MINUTES = 5;
export const CONFIRMATION_WINDOW_MS = CONFIRMATION_WINDOW_MINUTES * MS_PER_MINUTE;
// Akzeptiert werden das aktuelle und das vorherige Fenster - Gueltigkeit damit effektiv
// zwischen 5 und 10 Minuten (abhaengig davon, wie kurz vor Fensterende ausgestellt wurde).
export const ACCEPTED_WINDOWS = 2;
// Ein kuerzeres/leeres Geheimnis ergibt keinen Schluessel (fail-closed, s. deriveConfirmationKey).
export const CONFIRMATION_SECRET_MIN_LENGTH = 32;
// Versions-Praefix in der Ableitung: eine kuenftige Aenderung bekommt ein eigenes Praefix
// und kollidiert nicht mit alten Codes (Muster tenant-tool-token.js).
export const DERIVATION_VERSION = "v1";
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
// werden gleich behandelt (beide verschwinden aus dem Ergebnis). Strings bleiben exakt,
// kein Trim - ein Leerzeichen mehr im Briefing ist ein ANDERER Anruf.
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
 * Bindet ALLE Argumente ausser confirmation_code, mit `to` in NORMALISIERTER Form (Aufrufer
 * uebergibt das schon aufgeloeste Ziel separat - es ersetzt ein eventuelles args.to).
 */
export function canonicalCallRequest({ to, args }) {
  const { confirmation_code: _ignored, ...rest } = args || {};
  return JSON.stringify(sortedCanonical({ ...rest, to }));
}

function windowIndexFor(nowMs) {
  return Math.floor(nowMs / CONFIRMATION_WINDOW_MS);
}

function codeForWindow({ key, tenantId, canonical, windowIdx }) {
  const mac = createHmac("sha256", key)
    .update(`${DERIVATION_VERSION}|${tenantId}|${windowIdx}|${canonical}`)
    .digest();
  let code = "";
  for (let i = 0; i < CONFIRMATION_CODE_LENGTH; i++) {
    code += CONFIRMATION_CODE_ALPHABET[mac[i] % CONFIRMATION_CODE_ALPHABET.length];
  }
  return code;
}

/** Stellt einen Code fuer das AKTUELLE Fenster aus, plus dessen fruehesten Ablaufzeitpunkt. */
export function issueConfirmationCode({ key, tenantId, canonical, nowMs }) {
  const windowIdx = windowIndexFor(nowMs);
  return {
    code: codeForWindow({ key, tenantId, canonical, windowIdx }),
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

/**
 * Welches Fenster (aktuell oder vorheriges) den vorgelegten Code bestaetigt, oder null.
 * Timing-sicherer Vergleich (safeEqual, Absolute Regel 3). key === null (nicht ableitbares
 * Geheimnis) ergibt immer null - niemals ein Match ohne echten Schluessel. Der Aufrufer
 * braucht den WindowIndex fuer den Einmal-Verbrauch-Digest (Mandant+Fenster+Code).
 */
export function matchedWindowIndex({ key, tenantId, canonical, code, nowMs }) {
  if (!key) return null;
  const normalized = normalizeConfirmationCode(code);
  if (!normalized) return null;
  const currentWindow = windowIndexFor(nowMs);
  for (let offset = 0; offset < ACCEPTED_WINDOWS; offset++) {
    const windowIdx = currentWindow - offset;
    const candidate = codeForWindow({ key, tenantId, canonical, windowIdx });
    if (safeEqual(normalized, candidate)) return windowIdx;
  }
  return null;
}

/** Boolean-Fassade von matchedWindowIndex - fuer Aufrufer, die nur JA/NEIN brauchen. */
export function verifyConfirmationCode(args) {
  return matchedWindowIndex(args) !== null;
}
