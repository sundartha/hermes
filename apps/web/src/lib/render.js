// W4: DOM-Bau der read-only Datensicht (Anrufe / Action Items / Kalender).
// BEWUSST getrennt von den Inseln, damit der Bau testbar ist (ohne Browser-DOM,
// ohne Astro) UND die el()-Boilerplate genau EINMAL existiert (G5, kein Drift
// ueber drei Inseln). Die Inseln liefern nur `document` + den state und haengen
// die fertigen Knoten in ihren Container.
//
// XSS-SCHUTZ (Leitplanke): Tenant-Strings (Gegenstelle, goal, Item-Text,
// Kalender-Titel) gehen AUSSCHLIESSLICH ueber node.textContent in den DOM --
// NIE ueber innerHTML. textContent interpretiert nie HTML, daher kann kein
// "<script>"/Attribut-Ausbruch aus Tenant-Daten entstehen. Dieses Modul nutzt
// kein innerHTML; der Beleg ist ein Test (render.test.js) + ein grep-Gate.

import {
  AUTH_STATE,
  AUTH_EVENT,
  CALL_DIRECTION,
  callsFrom,
  callCounterparty,
  callSubtitle,
  callStatusLabel,
  callStatusKind,
  actionItemsFrom,
  isAppointment,
  calendarFrom,
  calendarDateParts,
} from "./api.js";

// Anzeige-Grenzen wie im Bestand (tenant.html): nur die ersten N Eintraege.
const MAX_ACTION_ITEMS = 12;
const MAX_CALENDAR_EVENTS = 6;

// Beschriftungen/Glyphen (keine Magic-Strings an den Verwendungsstellen, G25).
const EMPTY_CALLS = "Keine Anrufe.";
const EMPTY_ACTION_ITEMS = "Keine Action Items.";
const EMPTY_CALENDAR = "Keine Termine.";
const APPOINTMENT_TAG = "Termin";
// Richtungs-Pfeile als echte Unicode-Zeichen (kein roher HTML-Entity-String;
// textContent-sicher). Out = nach oben rechts, In = nach unten links.
const ARROW_OUT = "↗";
const ARROW_IN = "↙";

// Element-Fabrik: setzt className optional, Text NUR ueber textContent. `doc`
// ist injiziert (DIP) -> derselbe Bau in Produktion (document) UND im Test
// (Fake-Document). undefined-Text bleibt unangetastet (leerer Knoten).
function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function emptyRow(doc, text) {
  return el(doc, "li", "data-empty", text);
}

// ---- Anrufe ----
function directionIcon(doc, call) {
  const isOutbound = call.direction === CALL_DIRECTION.OUTBOUND;
  return el(doc, "span", `call-dir call-dir--${isOutbound ? "out" : "in"}`, isOutbound ? ARROW_OUT : ARROW_IN);
}

function callBody(doc, call) {
  const body = el(doc, "div", "call-body");
  body.append(
    el(doc, "span", "call-who", callCounterparty(call)),
    el(doc, "span", "call-sub", callSubtitle(call))
  );
  return body;
}

function callRow(doc, call) {
  const row = el(doc, "li", "call-row");
  const badge = el(doc, "span", `status-badge status-badge--${callStatusKind(call)}`, callStatusLabel(call));
  row.append(directionIcon(doc, call), callBody(doc, call), badge);
  return row;
}

export function callRows(doc, data) {
  const calls = callsFrom(data);
  return calls.length ? calls.map((c) => callRow(doc, c)) : [emptyRow(doc, EMPTY_CALLS)];
}

// ---- Action Items ----
function actionItemRow(doc, item) {
  const rowClass = item.done ? "ai-row ai-row--done" : "ai-row";
  const row = el(doc, "li", rowClass);
  row.append(el(doc, "span", "ai-text", item.text || ""));
  if (isAppointment(item)) row.append(el(doc, "span", "tag tag--appointment", APPOINTMENT_TAG));
  return row;
}

export function actionItemRows(doc, data) {
  const items = actionItemsFrom(data).slice(0, MAX_ACTION_ITEMS);
  return items.length ? items.map((i) => actionItemRow(doc, i)) : [emptyRow(doc, EMPTY_ACTION_ITEMS)];
}

// ---- Kalender ----
function calendarDateBlock(doc, parts) {
  const block = el(doc, "div", "cal-date");
  block.append(el(doc, "strong", "cal-date__day", parts.day), el(doc, "small", "cal-date__month", parts.month));
  return block;
}

function calendarBody(doc, event, parts) {
  const body = el(doc, "div", "cal-body");
  body.append(el(doc, "strong", "cal-title", event.title || ""), el(doc, "span", "cal-when", parts.when));
  return body;
}

function calendarRow(doc, event) {
  const parts = calendarDateParts(event);
  const row = el(doc, "li", "cal-row");
  row.append(calendarDateBlock(doc, parts), calendarBody(doc, event, parts));
  return row;
}

export function calendarRows(doc, data) {
  const events = calendarFrom(data).slice(0, MAX_CALENDAR_EVENTS);
  return events.length ? events.map((e) => calendarRow(doc, e)) : [emptyRow(doc, EMPTY_CALENDAR)];
}

// ---- Insel-Verdrahtung ------------------------------------------------------
// Bindet eine Datensicht-Insel an den EINEN state-Fetch: hoert auf AUTH_EVENT
// und fuellt das Container-Element mit den von `rowsFn` gebauten Zeilen. Genau
// EINE Stelle (G5), statt die identische 3-Zeilen-Verdrahtung in jeder der drei
// Inseln zu wiederholen. `doc` injiziert (DIP), damit der Bau testbar bleibt.
//
// Stale-Daten-Schutz: nur im AUTHENTICATED-Zustand wird gerendert; jeder andere
// Zustand (anonym/pending/Fehler bzw. data==null) LEERT den Container -- kein
// stehen gebliebenes Tenant-Datum.
export function bindList(doc, listId, rowsFn) {
  const listEl = doc.getElementById(listId);
  doc.addEventListener(AUTH_EVENT, (event) => {
    const { state, data } = event.detail;
    if (state === AUTH_STATE.AUTHENTICATED) listEl.replaceChildren(...rowsFn(doc, data));
    else listEl.replaceChildren();
  });
}
