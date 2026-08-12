// W4: DOM-Bau der read-only Anrufliste (inkl. aufklappbarer Chat-Historie je
// Anruf). BEWUSST getrennt von der Insel, damit der Bau testbar ist (ohne
// Browser-DOM, ohne Astro) UND die el()-Boilerplate genau EINMAL existiert
// (G5). Die Insel liefert nur `document` + den state und haengt die fertigen
// Knoten in ihren Container.
//
// XSS-SCHUTZ (Leitplanke): Tenant-Strings (Gegenstelle, goal, Transkript-Text,
// Summary) gehen AUSSCHLIESSLICH ueber node.textContent in den DOM -- NIE ueber
// innerHTML. textContent interpretiert nie HTML, daher kann kein "<script>"/
// Attribut-Ausbruch aus Tenant-Daten entstehen. Dieses Modul nutzt kein
// innerHTML; der Beleg ist ein Test (render.test.js) + ein grep-Gate.

import {
  AUTH_STATE,
  AUTH_EVENT,
  CALL_DIRECTION,
  callsFrom,
  callCounterparty,
  callSubtitle,
  callStatusLabel,
  callStatusKind,
  transcriptFrom,
  isAgentTurn,
  turnRoleLabel,
  turnTimeLabel,
  callSummary,
} from "./api.js";

// Beschriftungen/Glyphen (keine Magic-Strings an den Verwendungsstellen, G25).
const EMPTY_CALLS = "No calls yet — connect your first agent!";
const EMPTY_TRANSCRIPT = "No conversation recorded.";
const SUMMARY_LABEL = "Summary";
// Richtungs-Pfeile als echte Unicode-Zeichen (kein roher HTML-Entity-String;
// textContent-sicher). Out = nach oben rechts, In = nach unten links.
const ARROW_OUT = "↗";
const ARROW_IN = "↙";
// Aufklapp-Pfeil des Anruf-Triggers (dreht sich per CSS ueber aria-expanded).
const CARET = "▾";

// Element-Fabrik: setzt className optional, Text NUR ueber textContent. `doc`
// ist injiziert (DIP) -> derselbe Bau in Produktion (document) UND im Test
// (Fake-Document). undefined-Text bleibt unangetastet (leerer Knoten). Exportiert,
// damit lib/subscribe.js denselben textContent-only Bau nutzt (G5, eine el-Quelle).
export function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function emptyRow(doc, text) {
  return el(doc, "li", "data-empty", text);
}

// ---- Anrufe (Zeile + aufklappbare Chat-Historie) ------------------------------
function directionIcon(doc, call) {
  const isOutbound = call.direction === CALL_DIRECTION.OUTBOUND;
  return el(
    doc,
    "span",
    `call-dir call-dir--${isOutbound ? "out" : "in"}`,
    isOutbound ? ARROW_OUT : ARROW_IN,
  );
}

function callBody(doc, call) {
  const body = el(doc, "div", "call-body");
  body.append(
    el(doc, "span", "call-who", callCounterparty(call)),
    el(doc, "span", "call-sub", callSubtitle(call)),
  );
  return body;
}

function statusBadge(doc, call) {
  return el(doc, "span", `status-badge status-badge--${callStatusKind(call)}`, callStatusLabel(call));
}

// Trigger-Knopf einer Anrufzeile: ein ECHTER <button> (nicht nur ein klickbares
// div) -- so bleibt die Zeile per Tastatur bedienbar (Enter/Space) ohne
// zusaetzliche Keydown-Verdrahtung. aria-expanded/aria-controls tragen den
// Aufklapp-Zustand fuer Screenreader; dieselben Attribute steuert auch das
// scoped CSS der Insel (Caret-Rotation), kein zweiter State.
function callTrigger(doc, call, panelId, index) {
  const button = el(doc, "button", "call-row__trigger");
  button.type = "button";
  button.id = `call-trigger-${index}`;
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", panelId);
  button.append(directionIcon(doc, call), callBody(doc, call), statusBadge(doc, call));
  button.append(el(doc, "span", "call-row__caret", CARET));
  return button;
}

// Eine Chat-Blase je Turn. role unterscheidet Agent/Gegenstelle optisch
// (chat-bubble--agent/--counterparty); die Uhrzeit fehlt einfach, wenn `at`
// fehlt/ungueltig ist (turnTimeLabel liefert dann "").
function chatBubble(doc, turn) {
  const bubble = el(doc, "li", `chat-bubble chat-bubble--${isAgentTurn(turn) ? "agent" : "counterparty"}`);
  bubble.append(el(doc, "span", "chat-bubble__role", turnRoleLabel(turn)));
  bubble.append(el(doc, "p", "chat-bubble__text", (turn && turn.text) || ""));
  const time = turnTimeLabel(turn);
  if (time) bubble.append(el(doc, "span", "chat-bubble__time", time));
  return bubble;
}

// Turns als Liste -- kein leeres Loch, wenn (noch) kein Transkript vorliegt
// (z.B. Anruf ohne Aufzeichnung/laeuft noch): eine ruhige Hinweiszeile statt
// eines leeren <ul>.
function chatLog(doc, call) {
  const turns = transcriptFrom(call);
  if (!turns.length) return el(doc, "p", "call-panel__empty muted", EMPTY_TRANSCRIPT);
  const list = el(doc, "ul", "chat-log");
  list.append(...turns.map((t) => chatBubble(doc, t)));
  return list;
}

// Summary abgesetzt ueber der Chat-Historie -- nur, wenn eine existiert
// (summarizeCall setzt sie nachtraeglich; initial null).
function callSummaryBlock(doc, call) {
  const summary = callSummary(call);
  if (!summary) return null;
  const block = el(doc, "p", "call-summary");
  block.append(el(doc, "span", "call-summary__label", SUMMARY_LABEL));
  block.append(el(doc, "span", "call-summary__text", summary));
  return block;
}

// Das aufklappbare Panel unter dem Trigger: Summary (optional) + Chat-Log.
// Startet IMMER geschlossen (hidden) -- der Trigger-Klick oeffnet es.
function callPanel(doc, call, panelId) {
  const panel = el(doc, "div", "call-panel");
  panel.id = panelId;
  panel.hidden = true;
  const summaryBlock = callSummaryBlock(doc, call);
  if (summaryBlock) panel.append(summaryBlock);
  panel.append(chatLog(doc, call));
  return panel;
}

function setPanelOpen(entry, open) {
  entry.panel.hidden = !open;
  entry.button.setAttribute("aria-expanded", open ? "true" : "false");
}

// Accordion: GENAU ein Anruf offen. Bei vielen Anrufen bleibt die Liste
// uebersichtlich statt dass mehrere lange Transkripte gleichzeitig die Seite
// strecken; ein zweiter Klick auf die offene Zeile klappt sie wieder zu.
function wireAccordion(entries) {
  for (const entry of entries) {
    entry.button.addEventListener("click", () => {
      const wasOpen = entry.button.getAttribute("aria-expanded") === "true";
      for (const other of entries) setPanelOpen(other, false);
      setPanelOpen(entry, !wasOpen);
    });
  }
}

function callRow(doc, call, index) {
  const row = el(doc, "li", "call-row");
  const panelId = `call-panel-${index}`;
  const button = callTrigger(doc, call, panelId, index);
  const panel = callPanel(doc, call, panelId);
  row.append(button, panel);
  return { row, entry: { button, panel } };
}

export function callRows(doc, data) {
  const calls = callsFrom(data);
  if (!calls.length) return [emptyRow(doc, EMPTY_CALLS)];
  const built = calls.map((call, index) => callRow(doc, call, index));
  wireAccordion(built.map((b) => b.entry));
  return built.map((b) => b.row);
}

// ---- Insel-Verdrahtung ------------------------------------------------------
// Bindet eine Datensicht-Insel an den EINEN state-Fetch: hoert auf AUTH_EVENT
// und fuellt das Container-Element mit den von `rowsFn` gebauten Zeilen. `doc`
// injiziert (DIP), damit der Bau testbar bleibt.
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
