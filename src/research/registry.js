// Recherche-Registry: EINE Stelle, die (a) die Anbieter-Tabelle haelt und (b) die
// SCHNITTMENGE aus globalem Master-Schalter und Per-Tenant-Setting bildet. Muster
// src/telephony/registry.js (ADAPTERS-Tabelle statt verstreuter Ternaries).
//
// Fail-closed: Master aus ODER Tenant aus -> null -> der Aufrufer laeuft byte-identisch
// zum Bestand weiter (kein Werkzeug im tools-Array, keine Gebuehr).
//
// Anbieterwechsel = eine Adapter-Datei + ein Tabelleneintrag. AL-P10c hat genau das
// vorgefuehrt: der In-Call-Anbieter wurde getauscht, ohne Umbau an in-call.js/ports.js.
// Ein zweiter In-Call-Anbieter passt jederzeit in die Tabelle - er wird erst gebaut, wenn
// er gebraucht wird.
import { anthropicWebSearch } from "./adapters/anthropic-web-search.js";
import { exaSearch } from "./adapters/exa-search.js";
import { config } from "../config.js";
import { elevenLabsLookupCount } from "../store/state-ops.js";

const RESEARCH_PROVIDER = Object.freeze({
  ANTHROPIC_WEB_SEARCH: "anthropic_web_search",
  EXA_SEARCH: "exa_search",
});

const PRECALL_ADAPTERS = Object.freeze({
  [RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH]: anthropicWebSearch,
});

const PRECALL_PROVIDER = RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH;

// AL-P10b: der zweite Adapter-Platz. Anderer Vertrag (ports.js InCallSearchProvider),
// dieselbe Tabellen-Mechanik.
const IN_CALL_ADAPTERS = Object.freeze({
  [RESEARCH_PROVIDER.EXA_SEARCH]: exaSearch,
});

const IN_CALL_PROVIDER = RESEARCH_PROVIDER.EXA_SEARCH;

/**
 * @param {{ tenantAllows: boolean }} gate
 * @returns {import("./ports.js").PrecallResearchProvider|null}
 */
export function precallResearchProvider({ tenantAllows }) {
  if (!config.research.researchEnabled || !tenantAllows) return null;
  return PRECALL_ADAPTERS[PRECALL_PROVIDER];
}

/**
 * AL-P10b: EINE Stelle fuer die ANBIETER-Frage des In-Call-Nachschlags - Schnittmenge
 * aus Master-Schalter, Per-Tenant-Recht und vorhandenem Secret. OHNE Key fail-closed
 * inaktiv (ein Adapter ohne Secret liefert nur 401 und kostet Turn-Zeit). Die
 * CALL-seitigen Bedingungen (Richtung/Status/Kontingent) liegen in research/in-call.js.
 *
 * @param {{ tenantAllows: boolean }} gate
 * @returns {import("./ports.js").InCallSearchProvider|null}
 */
export function inCallSearchProvider({ tenantAllows }) {
  if (!config.research.lookupEnabled || !tenantAllows) return null;
  if (!config.research.exaApiKey) return null;
  return IN_CALL_ADAPTERS[IN_CALL_PROVIDER];
}

// Kosten-Riegel: hoechstens so viele Suchen je Gespraech, auf BEIDEN Wegen (Budget-
// Turn-Loop UND ElevenLabs-Webhook). Thema B (2026-08-19): aus research/in-call.js
// HIERHER gezogen (dort re-exportiert, kein Konsument bricht), weil das EL-Gate unten
// ihn braucht und dieser Import-Graph fassaden-frei bleiben muss - in-call.js laedt
// die Store-Fassade, und die bindet beim Import ihr Backend samt DATA_DIR (Begruendung
// und der gemessene Unfall: src/elevenlabs/opening-line.js, Kopf). KEIN Env-Knopf
// (Praezedenz MAX_IN_CALL_CONSULTS_PER_CALL): ein zu gross gesetzter Wert waere genau
// die Klasse "neue abgeschaltete Sicherung", die CLAUDE.md verbietet.
export const LOOKUP_MAX_PER_CALL = 2;

/**
 * Thema B (2026-08-19): DARF dieser ElevenLabs-Anruf recherchieren? Die EINE
 * Berechtigungs-Frage fuer BEIDE Konsumenten - den Anrufstart (dynamische Variable
 * {{lookup_available}}, elevenlabs/outbound.js) und den Webhook
 * (routes/webhooks-elevenlabs.js). Ein zweiter Nachbau des Gates war Blocker BL-2
 * des Rueckfrage-Webhooks und wird hier nicht wiederholt.
 *
 * Faktoren: Richtung outbound (der Sicherheitskern - eine im Gespraech mit einem
 * FREMDEN Inbound-Anrufer entstandene Frage darf nie an einen Suchindex gehen),
 * laufender Anruf, dann die Schnittmenge Master-Schalter x Secret x Per-Tenant-Recht
 * (inCallSearchProvider oben). BEWUSST OHNE die zwei Turn-Loop-Faktoren des
 * Budget-Wegs (research/in-call.js#lookupProviderFor): voiceEngine und
 * assistantContextEnabled sind Fakten UNSERER Turn-Schleife - auf dem EL-Weg fuehrt
 * der Agent des Anbieters das Gespraech, und der Treffer geht als Werkzeug-Antwort
 * direkt an sein Modell statt in call.context (dieselbe Abgrenzung wie beim
 * Consult-Webhook, s. dessen consultAllowed-Kommentar).
 *
 * Das KONTINGENT (LOOKUP_MAX_PER_CALL) prueft diese Funktion NICHT: der Webhook
 * muss "nicht berechtigt" (404) von "Deckel erreicht" (sprechbare Ablehnung, das
 * Gespraech laeuft weiter - Auflage B3) unterscheiden koennen.
 *
 * @param {object} call
 * @param {(tenantId: string) => object|null} resolveProfile store.resolveProfile,
 *   als Funktion hereingereicht (dieser Graph laedt die Fassade nicht selbst).
 * @returns {import("./ports.js").InCallSearchProvider|null}
 */
export function elevenLabsLookupProviderFor(call, resolveProfile) {
  if (call?.direction !== "outbound") return null;
  if (call?.status !== "active") return null;
  return inCallSearchProvider({
    tenantAllows: resolveProfile(call.tenantId)?.allowLookup === true,
  });
}

/**
 * Beide Fragen zusammen, fuer den Anrufstart: berechtigt UND unter dem Deckel.
 * (Der Webhook stellt sie getrennt, s.o.)
 *
 * @param {object} call
 * @param {(tenantId: string) => object|null} resolveProfile
 * @returns {boolean}
 */
export function elevenLabsLookupAvailableFor(call, resolveProfile) {
  if (elevenLabsLookupProviderFor(call, resolveProfile) === null) return false;
  return elevenLabsLookupCount(call) < LOOKUP_MAX_PER_CALL;
}
