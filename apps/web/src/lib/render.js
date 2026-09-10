// W4/Dashboard-Design-Spec §7+§8: DOM-Bau der read-only Anrufliste + des
// Detail-Fensters (Modal). BEWUSST getrennt von der Insel, damit der Bau
// testbar ist (ohne Browser-DOM, ohne Astro) UND die el()-Boilerplate genau
// EINMAL existiert (G5). Die Insel liefert nur `document` + den state und
// haengt die fertigen Knoten in ihren Container bzw. in das EINE, statisch in
// CallsIsland.astro vorhandene Modal-Element.
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
  callStatusKind,
  transcriptFrom,
  isAgentTurn,
  turnRoleLabel,
  turnTimeLabel,
  callSummary,
} from "./api.js";
import { tPair, tDyn } from "./i18n.js";

// Beschriftungen/Glyphen (keine Magic-Strings an den Verwendungsstellen, G25).
// EN bleibt Quelle der Wahrheit (Name/Wert test-gepinnt); die "_DE"-Geschwister
// sind Etappe 2 (dynamische Strings, s. lib/i18n.js Kopf-Kommentar zu tPair/tDyn).
const EMPTY_CALLS = "No calls yet — connect your first agent!";
const EMPTY_CALLS_DE = "Noch keine Anrufe — verbinde deinen ersten Agenten!";
const EMPTY_TRANSCRIPT = "No conversation recorded.";
const EMPTY_TRANSCRIPT_DE = "Kein Gespräch aufgezeichnet.";
const SUMMARY_LABEL = "Summary";
const SUMMARY_LABEL_DE = "Zusammenfassung";
const CONTACT_LABEL = "CONTACT";
const CONTACT_LABEL_DE = "KONTAKT";
// Richtungs-Pfeile als echte Unicode-Zeichen (kein roher HTML-Entity-String;
// textContent-sicher). Out = nach oben rechts, In = nach unten links.
const ARROW_OUT = "↗";
const ARROW_IN = "↙";
const DIRECTION_LABEL_IN = "Incoming";
const DIRECTION_LABEL_IN_DE = "Eingehend";
const DIRECTION_LABEL_OUT = "Outgoing";
const DIRECTION_LABEL_OUT_DE = "Ausgehend";

// Sichtbare Status-Pillentexte (Spec §7-Tabelle) -- eine EIGENE, kurze
// Beschriftung, unabhaengig von der laenger gefassten API-Beschriftung
// (callStatusLabel in lib/api.js). lib/api.js ist fuer diesen Umbau gesperrt
// (Auftrag), darum lebt die Anzeige-Kurzform hier. Schluessel = callStatusKind().
// Exportiert NUR fuer den Woerterbuch-Paritaets-Waechter (test/dashboard-i18n-
// surface.test.js) -- kein anderer Verbraucher ausserhalb dieses Moduls.
export const STATUS_PILL_LABELS = Object.freeze({
  active: "LIVE",
  completed: "ENDED",
  cancelled: "CANCELLED",
  failed: "FAILED",
});
export const STATUS_PILL_LABELS_DE = Object.freeze({
  active: "LIVE",
  completed: "BEENDET",
  cancelled: "ABGEBROCHEN",
  failed: "FEHLGESCHLAGEN",
});

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

// ---- Anruf-Meta: Zeitpunkt + Dauer (Zeilen-Meta + Detail-Fenster) -----------
// Reine, DOM-freie Helfer. Lesen startedAt/answeredAt/endedAt DIREKT vom
// Call-Record -- publicCall (src/store/views.js) streift diese drei Felder
// NICHT (nur streamToken/interne Kostenfelder), sie erreichen die state-
// Antwort unveraendert. Kein Umweg ueber lib/api.js: die Datei ist fuer
// diesen Umbau gesperrt (Auftrag), der Client kann ausserdem keinen Server-
// Code importieren (Strategie 2.3).

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
// Mittelpunkt-Trenner der Meta-Zeile ("Today, 09:12 · 2:40", Entwurf).
const META_SEPARATOR = " · ";

// Monatsnamen als statisches Array -- KEIN Intl-/toLocale-Aufruf. Der i18n-
// Drift-Test WEB-18 (test/dashboard-i18n-surface.test.js) zaehlt jede
// toLocale*/Intl-Aufrufstelle im gesamten apps/web/src-Baum und erwartet
// exakt zwei (beide in lib/subscribe.js) -- ein drittes Vorkommen bricht ihn.
// Das gilt unveraendert: die deutschen Kuerzel unten sind ein zweites Array,
// KEIN toLocale-Aufruf.
const MONTH_LABELS = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);
const MONTH_LABELS_DE = Object.freeze([
  "Jan.", "Feb.", "März", "Apr.", "Mai", "Jun.", "Jul.", "Aug.", "Sep.", "Okt.", "Nov.", "Dez.",
]);
const TODAY_LABEL = "Today";
const TODAY_LABEL_DE = "Heute";

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Anker-Zeitpunkt eines Calls: answeredAt (abgenommen), sonst startedAt
// (klingelt noch/nie abgenommen) -- dieselbe Praezedenz wie state-ops.js
// callStartAnchorMs (Server), hier als eigene reine Kopie fuer die Anzeige.
function callAnchorMs(call) {
  return Date.parse((call && (call.answeredAt ?? call.startedAt)) ?? "");
}

// "Today, 09:12" (gleicher Kalendertag wie `now`) oder "Aug 13, 09:12"
// (aeltere Anrufe). `now` injiziert (DIP) -- testbar ohne Systemzeit-
// Abhaengigkeit. Kein gueltiger Anker -> "" (kein erfundenes Datum).
export function callTimeLabel(call, now = new Date()) {
  const ms = callAnchorMs(call);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const month = tDyn({ en: MONTH_LABELS, de: MONTH_LABELS_DE }, d.getMonth());
  const day = sameDay ? tPair(TODAY_LABEL, TODAY_LABEL_DE) : `${month} ${d.getDate()}`;
  return `${day}, ${time}`;
}

// Dauer "m:ss" von answeredAt bis endedAt (beendeter Anruf) bzw. bis `now`
// (noch laufender Anruf). Kein answeredAt (nie abgenommen: failed/cancelled
// vor Abnahme) -> "" -- erfindet keine Dauer fuer ein Gespraech, das nie
// stattfand.
export function callDurationLabel(call, now = new Date()) {
  const startMs = Date.parse((call && call.answeredAt) ?? "");
  if (Number.isNaN(startMs)) return "";
  const endMs = call.endedAt ? Date.parse(call.endedAt) : now.getTime();
  if (Number.isNaN(endMs)) return "";
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${pad2(seconds)}`;
}

// Mono-Meta-Zeile: Zeit + Dauer, oder nur Zeit, wenn keine Dauer ermittelbar
// ist (z.B. nie abgenommen). Kein Zeit-Anker -> "" (der Aufrufer laesst die
// Zeile dann einfach weg, statt einen Platzhalter zu erfinden).
export function callMetaLabel(call, now = new Date()) {
  const time = callTimeLabel(call, now);
  if (!time) return "";
  const duration = callDurationLabel(call, now);
  return duration ? `${time}${META_SEPARATOR}${duration}` : time;
}

// Richtungs-Beschriftung des Detail-Fenster-Kopfs (Spec §8: "Incoming"/
// "Outgoing"). Fehlende/unbekannte Richtung faellt wie directionIcon auf
// eingehend zurueck (kein drittes Enum).
export function callDirectionLabel(call) {
  const outbound = Boolean(call) && call.direction === CALL_DIRECTION.OUTBOUND;
  return outbound
    ? tPair(DIRECTION_LABEL_OUT, DIRECTION_LABEL_OUT_DE)
    : tPair(DIRECTION_LABEL_IN, DIRECTION_LABEL_IN_DE);
}

// ---- Anrufzeile (Spec §7) ----------------------------------------------------
function directionIcon(doc, call) {
  const isOutbound = call.direction === CALL_DIRECTION.OUTBOUND;
  return el(
    doc,
    "span",
    `call-dir call-dir--${isOutbound ? "out" : "in"}`,
    isOutbound ? ARROW_OUT : ARROW_IN,
  );
}

// Name/Nummer, Mono-Meta (Zeit · Dauer, nur wenn ermittelbar) und die
// einzeilige (CSS-geclampte) Zusammenfassung -- 1:1 die drei Zeilen aus Spec §7.
//
// Befund 3 (Fix-Runde): die dritte Zeile zeigt die Gespraechs-Zusammenfassung
// (callSummary), NICHT den Richtungs-Untertitel. Fallback auf callSubtitle nur,
// wenn (noch) keine Summary vorliegt -- kein leerer Platz, kein erfundener Text.
function callBody(doc, call) {
  const body = el(doc, "div", "call-body");
  body.append(el(doc, "span", "call-who", callCounterparty(call)));
  const meta = callMetaLabel(call);
  if (meta) body.append(el(doc, "span", "call-meta", meta));
  const summary = callSummary(call);
  body.append(el(doc, "span", "call-sub", summary || callSubtitle(call)));
  return body;
}

function statusBadge(doc, call) {
  const kind = callStatusKind(call);
  const label = tDyn({ en: STATUS_PILL_LABELS, de: STATUS_PILL_LABELS_DE }, kind);
  return el(doc, "span", `status-badge status-badge--${kind}`, label);
}

// Eine ganze Anrufzeile als ECHTER <button> (nicht nur ein klickbares div) --
// so bleibt sie per Tastatur bedienbar (Enter/Space) ohne zusaetzliche
// Keydown-Verdrahtung. Ein Klick ruft `onSelect(call, button)` -- die Insel
// oeffnet damit das EINE Detail-Fenster (Spec §8) und merkt sich `button` als
// Fokus-Rueckkehrpunkt beim Schliessen.
function callRow(doc, call, onSelect) {
  const li = el(doc, "li", "call-row");
  const button = el(doc, "button", "call-row__link");
  button.type = "button";
  button.append(directionIcon(doc, call), callBody(doc, call), statusBadge(doc, call));
  button.addEventListener("click", () => onSelect(call, button));
  li.append(button);
  return li;
}

// `onSelect` optional (Default: no-op) -- Tests/Aufrufer, die nur die Liste
// pruefen, muessen keinen Handler durchreichen.
export function callRows(doc, data, onSelect = () => {}) {
  const calls = callsFrom(data);
  if (!calls.length) return [emptyRow(doc, tPair(EMPTY_CALLS, EMPTY_CALLS_DE))];
  return calls.map((call) => callRow(doc, call, onSelect));
}

// Benachrichtigungs-Feed (OUTBOUND-E3a, F2a, L8): auf Owner-Wunsch 2026-09-10
// ersatzlos aus der Oberflaeche entfernt -- die Meldungen standen als zweite
// Karte unter den Anrufen und wiederholten nur, was die Anrufzeile ohnehin
// zeigt. Der Feed selbst bleibt SERVERSEITIG unangetastet (store, audit,
// state-Antwort von routes/api-read.js + self-service-routes.js); es faellt
// nur der Renderer weg. Praezedenz: Summary-SMS-Block (0798ba0) und
// Permissions-Block (28a5f4f) -- Oberflaeche raus, Backend bleibt.

// ---- Detail-Fenster (Spec §8): Transkript-Chat ------------------------------
// Eine Chat-Blase je Turn. role unterscheidet Agent/Gegenstelle optisch
// (chat-bubble--agent/--counterparty). Sprecher-Label + Uhrzeit stehen
// GEMEINSAM ueber dem Blasentext (Spec §8); die Uhrzeit fehlt einfach, wenn
// `at` fehlt/ungueltig ist (turnTimeLabel liefert dann "").
function chatBubbleHead(doc, turn) {
  const head = el(doc, "div", "chat-bubble__head");
  head.append(el(doc, "span", "chat-bubble__role", turnRoleLabel(turn)));
  const time = turnTimeLabel(turn);
  if (time) head.append(el(doc, "span", "chat-bubble__time", time));
  return head;
}

function chatBubble(doc, turn) {
  const bubble = el(doc, "li", `chat-bubble chat-bubble--${isAgentTurn(turn) ? "agent" : "counterparty"}`);
  bubble.append(chatBubbleHead(doc, turn));
  bubble.append(el(doc, "p", "chat-bubble__text", (turn && turn.text) || ""));
  return bubble;
}

// Turns als Liste -- kein leeres Loch, wenn (noch) kein Transkript vorliegt
// (z.B. Anruf ohne Aufzeichnung/laeuft noch): eine ruhige Hinweiszeile statt
// eines leeren <ul>.
function chatLog(doc, call) {
  const turns = transcriptFrom(call);
  if (!turns.length) return el(doc, "p", "call-modal__empty muted", tPair(EMPTY_TRANSCRIPT, EMPTY_TRANSCRIPT_DE));
  const list = el(doc, "ul", "chat-log");
  list.append(...turns.map((t) => chatBubble(doc, t)));
  return list;
}

// Anrufer-Zeile im Kopf des Detail-Fensters (Spec §8): Punkt + Mono-Label
// CONTACT + Name/Nummer + Mono-Meta + Status-Pille. Der Name traegt eine feste
// id -- `aria-labelledby` der Dialog-Karte zeigt fest darauf (nur EIN Modal im
// DOM, die id kollidiert nie).
const MODAL_CONTACT_NAME_ID = "call-modal-name";
function contactRowNodes(doc, call) {
  const dot = el(doc, "span", "call-modal__contact-dot");
  dot.setAttribute("aria-hidden", "true");
  const body = el(doc, "span", "call-modal__contact-body");
  body.append(el(doc, "span", "call-modal__contact-label", tPair(CONTACT_LABEL, CONTACT_LABEL_DE)));
  const name = el(doc, "span", "call-modal__contact-name", callCounterparty(call));
  name.id = MODAL_CONTACT_NAME_ID;
  body.append(name);
  const meta = callMetaLabel(call);
  if (meta) body.append(el(doc, "span", "call-modal__contact-meta", meta));
  return [dot, body, statusBadge(doc, call)];
}

// Summary-Box: eingelassenes Feld, nur sichtbar, wenn eine Summary existiert
// (summarizeCall setzt sie nachtraeglich; initial null). Anders als die drei
// uebrigen Ziele bleibt DIESER Container manchmal leer+versteckt -- eigene
// Funktion statt eines weiteren Sonderfalls in fillCallModal (G30).
function fillSummaryBlock(doc, summaryEl, call) {
  const summary = callSummary(call);
  summaryEl.hidden = !summary;
  if (!summary) {
    summaryEl.replaceChildren();
    return;
  }
  summaryEl.replaceChildren(
    el(doc, "span", "call-modal__summary-label", tPair(SUMMARY_LABEL, SUMMARY_LABEL_DE)),
    el(doc, "p", "call-modal__summary-text", summary),
  );
}

// Befuellt das EINE, statisch in CallsIsland.astro vorhandene Detail-Fenster
// mit den Daten EINES Calls -- kein Modal pro Anrufzeile (Auftrag). `targets`
// buendelt die vier Ziel-Knoten (F1: Objekt statt vier Einzelargumente).
export function fillCallModal(doc, targets, call) {
  const { directionEl, contactEl, summaryEl, transcriptEl } = targets;
  directionEl.textContent = callDirectionLabel(call);
  contactEl.replaceChildren(...contactRowNodes(doc, call));
  fillSummaryBlock(doc, summaryEl, call);
  transcriptEl.replaceChildren(chatLog(doc, call));
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
