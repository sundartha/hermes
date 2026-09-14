// AL-P10b: der Nachschlag IM Gespraech. Der Agent holt hoechstens LOOKUP_MAX_PER_CALL
// kurze SACHfragen bei einem Such-Anbieter - waehrend der Anrufer den Ueberbrueckungssatz
// des Denk-Signals (AL-P7b) hoert, nicht eine tote Leitung.
//
// Diese Datei haelt die ENTSCHEIDUNGEN (darf/erlaubt/bezahlt/gesaeubert), nicht die
// Turn-Mechanik - die bleibt in claude.js, dem einzigen Ort mit Turn-Kontrolle (Muster
// src/consult/in-call.js).
import { config } from "../config.js";
import * as store from "../store.js";
import { localeFor } from "../i18n/locales.js";
import { bookLookupSearchFee } from "../llm-usage.js";
import { callLookups } from "../store/state-ops.js";
import { LOOKUP_MAX_PER_CALL, inCallSearchProvider } from "./registry.js";
import { lookupFactsFrom, sanitizeLookupQuery } from "./lookup-guard.js";

// Sprachinvarianter Tool-Name (G25): EINE Quelle fuer Schema, Registrierung und den
// Riegel im Tool-Loop.
export const LOOK_UP_TOOL_NAME = "look_up";

// Kosten-Riegel des Nachschlags: seit Thema B (2026-08-19) in registry.js beheimatet
// (der EL-Weg braucht ihn in einem fassaden-freien Graphen, Begruendung dort) - hier
// re-exportiert, damit die Bestands-Konsumenten (Tool-Loop, Tests) ihre Quelle
// behalten. Zaehlt NUR ausgeloeste Suchen - eine am Egress-Filter verworfene
// verbraucht das Kontingent nicht.
export { LOOKUP_MAX_PER_CALL } from "./registry.js";

// Wie lange auf den Such-Anbieter gewartet wird, bevor der Zug ohne Treffer weiterlaeuft.
// HERLEITUNG (nichts behaupten, was nicht gemessen ist): AL-P2 hat den Telnyx-Turn-Timeout
// mit ueber 30 s gemessen - er ist also NICHT die bindende Grenze. Bindend ist die eigene
// Frist des Tool-Loops, turnLoopDeadlineMs(synthTimeoutMs=2000) = 11500 ms. Nach der in
// AL-P1 live gemessenen ersten Runde (Median 1339 ms) bleiben mit 2500 ms Suche noch ueber
// 3500 ms fuer einen vollen Folgeversuch (config.llm.llmRequestTimeoutMs) - die zweite
// Runde laeuft also, und die Antwort auf den Treffer ist gedeckt.
export const LOOKUP_TIMEOUT_MS = 2500;

// Registrierungs-Gate: darf look_up in DIESEM Zug ueberhaupt im Werkzeugsatz stehen, und
// wenn ja, WER sucht? Schnittmenge, fail-closed in jedem Faktor; Reihenfolge bindend -
// der Flag-Vergleich steht vorn, damit bei ausgeschaltetem Feature nicht einmal der Store
// gelesen wird (Bestand byte-identisch und kostenlos).
//
// assistantContextEnabled ist PFLICHT-Faktor, nicht Kosmetik: der Treffer landet in
// call.context.key_facts, und assistantContextSection (claude.js) rendert bei
// ausgeschaltetem Kanal "" - die Suche waere sonst bezahlter Muell. Dieselbe Kopplung wie
// consult/gate.js.
//
// Das Richtungs-Gate ist der Sicherheitskern: eine im Gespraech mit einem FREMDEN
// Inbound-Anrufer entstandene Frage darf nie an einen Suchindex gehen.
export function lookupProviderFor(call) {
  if (config.research.lookupEnabled !== true) return null;
  if (config.tenancy.assistantContextEnabled !== true) return null;
  if (call.direction !== "outbound") return null;
  if (call.status !== "active") return null;
  if (callLookups(call) >= LOOKUP_MAX_PER_CALL) return null;
  return inCallSearchProvider({
    tenantAllows: store.resolveProfile(call.tenantId)?.allowLookup === true,
  });
}

export const lookupAvailableFor = (call) => lookupProviderFor(call) !== null;

// PII-frei: server-generierte callId, sonst nur Codes/Zahlen. NIE die Query, NIE der
// Treffer, NIE eine Rufnummer, NIE der API-Key (Regel 4).
function logLookupBlocked(callId) {
  console.warn(`[lookup] verworfen grund=egress call=${callId}`);
}

// dauer_ms ist die Zahl, aus der die Abnahme (p50/p95 ueber >= 20 Suchen) erhoben wird.
function logLookupDone({ callId, ok, dauerMs, fakten }) {
  console.log(`[lookup] fertig call=${callId} ok=${ok} dauer_ms=${dauerMs} fakten=${fakten}`);
}

/**
 * Entscheidet ueber ein look_up dieser Tool-Runde und fuehrt es aus. Nebeneffekte im
 * Namen (N7): Kontingent, Gebuehr, Egress, Fakten-Merge.
 *
 * @param {{call: object, toolUses: Array<{name: string, input?: object}>,
 *          loopContinues: boolean}} input
 * @returns {Promise<null|{toolResult: string}>} null = diese Runde enthaelt kein look_up.
 */
export async function performLookupRequest({ call, toolUses, loopContinues }) {
  const requested = toolUses.find((tu) => tu.name === LOOK_UP_TOOL_NAME);
  if (!requested) return null;
  const tc = localeFor(call.language).prompt.turnControl;
  const declined = { toolResult: tc.lookUpDeclined };
  // Endet der Zug ohnehin (end_call/Seiteneffekt-Runde mit Text), waere die Suche Geld
  // fuer ein Ergebnis, das niemand mehr sieht - Regel 1, kein Egress, keine Gebuehr.
  if (!loopContinues) return declined;
  const provider = lookupProviderFor(call);
  if (!provider) return declined;
  const query = sanitizeLookupQuery(requested.input?.query, call);
  if (!query) {
    logLookupBlocked(call.id);
    return declined;
  }
  // Kontingent + Gebuehr VOR dem Absenden: eine ausgeloeste Suche ist bezahlt, auch wenn
  // die Antwort nie ankommt - und das Budget-Gate der NAECHSTEN Runde sieht sie.
  store.countCallLookup(call.id);
  bookLookupSearchFee({ tenantId: call.tenantId });
  const startedAt = Date.now();
  const res = await provider.searchFacts({ query, timeoutMs: LOOKUP_TIMEOUT_MS });
  const facts = res.ok ? lookupFactsFrom(res.facts) : [];
  logLookupDone({
    callId: call.id,
    ok: res.ok === true,
    dauerMs: Date.now() - startedAt,
    fakten: facts.length,
  });
  if (!facts.length) return { toolResult: tc.lookUpUnavailable };
  // Der Merge ist die EINZIGE Stelle, an der ein Treffer den Prompt erreicht (HINTERGRUND
  // mit Guardrail-Zeile). Nichts uebernommen (Deckel KEY_FACTS_LIMITS.maxItems erreicht)
  // heisst fuer den Zug dasselbe wie kein Treffer.
  const added = store.addLookupFacts(call.id, facts);
  return { toolResult: added > 0 ? tc.lookUpResult : tc.lookUpUnavailable };
}
