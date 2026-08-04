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

// GQ-P2: die kurze Frist - wie lange der Agent im laufenden Turn auf die Antwort WARTET,
// bevor er ueberbrueckt. Sie reserviert zugleich Platz in der laufenden Abrechnungsminute
// (consultFitsBillingMinute). Der Wert liegt in config.js (Rueckweg der Phase: alter Wert
// = altes Verhalten) und ist dort nach oben geklemmt - er kann keine Sicherung abschalten.
export const CONSULT_WAIT_MS = config.tenancy.consultWaitMs;

// GQ-P2 (W2): die lange Frist - wie lange die Rueckfrage OFFEN bleibt und eine
// eintreffende Antwort noch annimmt. Getrennt von CONSULT_WAIT_MS, weil "warten" und
// "sterben" zwei verschiedene Dinge sind: der Agent spricht laengst weiter, waehrend der
// Kanal noch offen ist. Ein laenger offener Consult verlaengert KEIN Gespraech - es wird
// nirgends gewartet, und expireOpenConsults schliesst ihn spaetestens am Call-Ende.
export const CONSULT_OPEN_MS = config.tenancy.consultOpenMs;

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
//
// AL-D1: exportiert, weil dies der EINZIGE Faktor von consultAvailableFor ist, der weder
// im Boot-Banner noch in der Datenbank steht - er haengt an der Wanduhr. Die Shim-Diagnose
// liest genau dieses Praedikat (G5: keine zweite, driftende Frischepruefung).
export function consultClientIsPolling(call, nowMs = Date.now()) {
  return nowMs - (call.consultPolledAtMs || 0) <= CONSULT_POLL_FRESH_MS;
}

// GQ-P2/B-2: WIE ALT ist der letzte Client-Poll? Der Boolean consultClientIsPolling kann
// "nie gepollt" nicht von "um Millisekunden zu alt" trennen - genau diese Mehrdeutigkeit
// liess B-2 nach dem Live-Anruf offen. Eine Zahl, kein Text (PII-Freiheit der Log-Zeile
// unberuehrt). Reiner Leser.
export const CONSULT_POLL_NEVER = -1;
export function consultPollAgeMs(call, nowMs = Date.now()) {
  return call.consultPolledAtMs ? nowMs - call.consultPolledAtMs : CONSULT_POLL_NEVER;
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
    consultClientIsPolling(call, nowMs) &&
    inCallConsults(call).length < MAX_IN_CALL_CONSULTS_PER_CALL
  );
}

// Zeitfenster-Regel: passt die Wartezeit noch in die LAUFENDE Abrechnungsminute? Sonst
// reisst eine Rueckfrage kurz vor dem Minutenwechsel eine ganze weitere Minute auf.
// Fehlender/unlesbarer Anker oder Uhr-Ruecksprung -> false (fail-closed).
export function consultFitsBillingMinute(call, nowMs = Date.now()) {
  const anchorMs = callStartAnchorMs(call);
  if (!Number.isFinite(anchorMs) || nowMs < anchorMs) return false;
  return ((nowMs - anchorMs) % MS_PER_MINUTE) + CONSULT_WAIT_MS <= MS_PER_MINUTE;
}

// PII-frei: server-generierte callId + Fristen. Nie die Frage, nie eine Nummer.
function logConsultAsked(callId) {
  console.log(`[consult] gestellt call=${callId} warte_ms=${CONSULT_WAIT_MS} offen_ms=${CONSULT_OPEN_MS}`);
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
    waitMs: CONSULT_WAIT_MS,
    openMs: CONSULT_OPEN_MS,
  });
}

// GQ-P2: das Gegenstueck zu advanceConsultWait auf der ANTWORT-Seite. Die Frist lebt an
// EINER Stelle (G5/G22) - die Route kennt den Kanal, nicht die Uhr. Nebeneffekt im Namen
// (N7): bei Annahme wandern die Fakten in call.context.key_facts.
export function acceptConsultAnswer(call, { eventId, facts }) {
  return store.answerConsult(call.id, {
    eventId,
    facts,
    nowMs: Date.now(),
    openMs: CONSULT_OPEN_MS,
  });
}
