// AL-P14: die Rueckfrage IM Gespraech. Der Agent stellt hoechstens EINE Sachfrage an
// seinen Auftraggeber, spricht dabei einen deterministischen Ueberbrueckungssatz und
// laeuft weiter - es wird NIRGENDS gewartet. Die Frist ist eine Wanduhr-Frist am
// Datensatz, ausgewertet beim NAECHSTEN Turn (advanceConsultWait). Ein Anruf kann
// dadurch strukturell nicht einfrieren.
//
// Diese Datei haelt die ENTSCHEIDUNGEN (darf/passt/gesaeubert), nicht die Turn-Mechanik -
// die bleibt in claude.js, dem einzigen Ort mit Turn-Kontrolle.
import { config } from "../config.js";
import * as store from "../store.js";
import { localeFor } from "../i18n/locales.js";
import { MS_PER_MINUTE } from "../utils/timer.js";
import { CONSULT_POLL_ABORT_MS } from "./delivery.js";
import { consultAllowedFor } from "./gate.js";
import { CONSULT_WAIT } from "../store/defaults.js";
import { callStartAnchorMs, inCallConsults } from "../store/state-ops.js";
import { sanitizeConsultQuestion } from "./question.js";

// Sprachinvarianter Tool-Name (G25): EINE Quelle fuer Schema, Registrierung und den
// Riegel im Tool-Loop.
export const GET_CONSULT_TOOL_NAME = "get_consult";

// Wie lange der Agent auf die Antwort wartet, bevor er im Rahmen seines Mandats
// entscheidet. KEIN Env-Knopf (Praezedenz CONSULT_POLL_HOLD_MS/MAX_OPEN_POLLS_*): ein zu
// gross gesetzter Wert waere genau die Klasse "neue abgeschaltete Sicherung", die
// CLAUDE.md verbietet - er liesse den Angerufenen beliebig lange in der Leitung haengen.
// HERLEITUNG, ehrlich als UNBESTAETIGT markiert: die einzige Zahl im Code ist
// PROVIDER_WEBHOOK_HARDCUT_MS (turn-budget.js), aus der Twilio-Doku abgeleitet und fuer
// den Shim-Pfad live unbestaetigt; die Messung dazu (AL-P2) ist bis heute nicht gelaufen.
// 4000 ms sind gut ein Viertel davon und decken sich mit der Repo-Lehre "4 s Wartezeit
// sind OK, Stille nicht" - deshalb spricht der Fueller, statt zu schweigen.
export const CONSULT_TIMEOUT_MS = 4000;

// Wie frisch ein Client-Poll sein muss, damit das Werkzeug ueberhaupt angeboten wird.
// Dieselbe Zahl wie die Abbruchgrenze des Polls (G5): ein Client in der Schleife
// erneuert den Wert lange vor Ablauf, ein abgewanderter nie.
export const CONSULT_POLL_FRESH_MS = CONSULT_POLL_ABORT_MS;

// Kosten-Riegel: hoechstens EINE Rueckfrage je Gespraech. Zaehlt NUR angenommene
// Rueckfragen - eine Ablehnung verbraucht das Kontingent nicht.
export const MAX_IN_CALL_CONSULTS_PER_CALL = 1;

// Ohne Abnehmen gab es kein Gespraech - und ohne answeredAt liesse sich ein Consult auch
// nicht als In-Call-Consult erkennen (isInCallConsult), das Kontingent waere blind.
function callAnswered(call) {
  return !Number.isNaN(Date.parse(call.answeredAt ?? ""));
}

// Wartet gerade ein Client auf diesem Call? Der Code kennt keinen Herkunfts-Marker
// "kam aus einem MCP-Client" - der frische Poll ist die staerkere, direkt gemessene
// Tatsache. Fehlendes Feld (Instanzwechsel, ephemer) -> false, fail-closed.
function clientIsPolling(call, nowMs) {
  return nowMs - (call.consultPolledAtMs || 0) <= CONSULT_POLL_FRESH_MS;
}

// Registrierungs-Gate: darf get_consult in DIESEM Turn ueberhaupt im Werkzeugsatz stehen?
// Schnittmenge, fail-closed in jedem Faktor. Der Flag-Vergleich steht vorn, damit bei
// ausgeschaltetem Feature nicht einmal der Store gelesen wird (Bestand byte-identisch).
// Das Richtungs-Gate ist der Sicherheitskern: ein fremder Inbound-Anrufer darf seine
// Aeusserungen NIE als "Rueckfrage" in den Kontext des Tenants exportieren.
export function consultAvailableFor(call, nowMs = Date.now()) {
  return (
    config.tenancy.inCallConsultEnabled === true &&
    consultAllowedFor(store.resolveProfile(call.tenantId)) &&
    call.direction === "outbound" &&
    call.status === "active" &&
    callAnswered(call) &&
    clientIsPolling(call, nowMs) &&
    inCallConsults(call).length < MAX_IN_CALL_CONSULTS_PER_CALL
  );
}

// Zeitfenster-Regel: passt die Wartezeit noch in die LAUFENDE Abrechnungsminute? Sonst
// reisst eine Rueckfrage kurz vor dem Minutenwechsel eine ganze weitere Minute auf.
// Fehlender/unlesbarer Anker oder Uhr-Ruecksprung -> false (fail-closed).
export function consultFitsBillingMinute(call, nowMs = Date.now()) {
  const anchorMs = callStartAnchorMs(call);
  if (!Number.isFinite(anchorMs) || nowMs < anchorMs) return false;
  return ((nowMs - anchorMs) % MS_PER_MINUTE) + CONSULT_TIMEOUT_MS <= MS_PER_MINUTE;
}

// PII-frei: server-generierte callId + Frist. Nie die Frage, nie eine Nummer.
function logConsultAsked(callId) {
  console.log(`[consult] gestellt call=${callId} frist_ms=${CONSULT_TIMEOUT_MS}`);
}

/**
 * Entscheidet ueber ein get_consult dieser Tool-Runde. Nebeneffekt im Namen (N7): bei
 * Annahme entsteht der Consult-Datensatz.
 *
 * @param {object} call
 * @param {Array<{name: string, input?: object}>} toolUses  Werkzeuge DIESER Runde.
 * @returns {null|{accepted: true, speech: string}|{accepted: false, toolResult: string}}
 *   null = diese Runde enthaelt gar kein get_consult.
 */
export function decideConsultRequest(call, toolUses) {
  const requested = toolUses.find((tu) => tu.name === GET_CONSULT_TOOL_NAME);
  if (!requested) return null;
  const loc = localeFor(call.language);
  const declined = { accepted: false, toolResult: loc.prompt.turnControl.consultDeclined };
  // Reihenfolge bindend: erst die Alleinstellung in der Runde, dann das
  // Registrierungs-Gate, dann das Geld, zuletzt die Form der Frage.
  //
  // ALLEINSTELLUNG: eine angenommene Rueckfrage beendet den Turn SOFORT - jedes weitere
  // Werkzeug derselben Runde wuerde dabei verschluckt (ein take_message ginge lautlos
  // verloren) oder widerspraeche der Wartezeit (end_call). EIN Riegel statt einer je
  // Werkzeugart, und er braucht keine Kenntnis fremder Werkzeugnamen (G5/G27).
  if (toolUses.length > 1) return declined;
  if (!consultAvailableFor(call)) return declined;
  if (!consultFitsBillingMinute(call)) return declined;
  const question = sanitizeConsultQuestion(requested.input?.question, call.transcript);
  if (!question) return declined;
  store.emitConsult(call.id, [question]);
  logConsultAsked(call.id);
  return { accepted: true, speech: loc.consultFillerSpeech };
}

// Der EINE Zustandsschritt der laufenden Rueckfrage, einmal je Turn. Bei
// ausgeschaltetem Flag ein reiner Boolean-Vergleich ohne Store-Zugriff - der
// Bestands-Turn bleibt byte-identisch. Nebeneffekt im Namen (N7).
export function advanceConsultWait(call) {
  if (config.tenancy.inCallConsultEnabled !== true) return CONSULT_WAIT.NONE;
  return store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    timeoutMs: CONSULT_TIMEOUT_MS,
  });
}
