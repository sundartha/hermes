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

const EMPTY_CALLS = "No calls yet — connect your first agent!";
const EMPTY_CALLS_DE = "Noch keine Anrufe — verbinde deinen ersten Agenten!";
const EMPTY_TRANSCRIPT = "No conversation recorded.";
const EMPTY_TRANSCRIPT_DE = "Kein Gespräch aufgezeichnet.";
const SUMMARY_LABEL = "Summary";
const SUMMARY_LABEL_DE = "Zusammenfassung";
const CONTACT_LABEL = "CONTACT";
const CONTACT_LABEL_DE = "KONTAKT";
const ARROW_OUT = "↗";
const ARROW_IN = "↙";
const DIRECTION_LABEL_IN = "Incoming";
const DIRECTION_LABEL_IN_DE = "Eingehend";
const DIRECTION_LABEL_OUT = "Outgoing";
const DIRECTION_LABEL_OUT_DE = "Ausgehend";

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

export function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function emptyRow(doc, text) {
  return el(doc, "li", "data-empty", text);
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const META_SEPARATOR = " · ";

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

function callAnchorMs(call) {
  return Date.parse((call && (call.answeredAt ?? call.startedAt)) ?? "");
}

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

export function callMetaLabel(call, now = new Date()) {
  const time = callTimeLabel(call, now);
  if (!time) return "";
  const duration = callDurationLabel(call, now);
  return duration ? `${time}${META_SEPARATOR}${duration}` : time;
}

export function callDirectionLabel(call) {
  const outbound = Boolean(call) && call.direction === CALL_DIRECTION.OUTBOUND;
  return outbound
    ? tPair(DIRECTION_LABEL_OUT, DIRECTION_LABEL_OUT_DE)
    : tPair(DIRECTION_LABEL_IN, DIRECTION_LABEL_IN_DE);
}

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

function callRow(doc, call, onSelect) {
  const li = el(doc, "li", "call-row");
  const button = el(doc, "button", "call-row__link");
  button.type = "button";
  button.append(directionIcon(doc, call), callBody(doc, call), statusBadge(doc, call));
  button.addEventListener("click", () => onSelect(call, button));
  li.append(button);
  return li;
}

export function callRows(doc, data, onSelect = () => {}) {
  const calls = callsFrom(data);
  if (!calls.length) return [emptyRow(doc, tPair(EMPTY_CALLS, EMPTY_CALLS_DE))];
  return calls.map((call) => callRow(doc, call, onSelect));
}

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

function chatLog(doc, call) {
  const turns = transcriptFrom(call);
  if (!turns.length) return el(doc, "p", "call-modal__empty muted", tPair(EMPTY_TRANSCRIPT, EMPTY_TRANSCRIPT_DE));
  const list = el(doc, "ul", "chat-log");
  list.append(...turns.map((t) => chatBubble(doc, t)));
  return list;
}

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

export function fillCallModal(doc, targets, call) {
  const { directionEl, contactEl, summaryEl, transcriptEl } = targets;
  directionEl.textContent = callDirectionLabel(call);
  contactEl.replaceChildren(...contactRowNodes(doc, call));
  fillSummaryBlock(doc, summaryEl, call);
  transcriptEl.replaceChildren(chatLog(doc, call));
}

export function bindList(doc, listId, rowsFn) {
  const listEl = doc.getElementById(listId);
  doc.addEventListener(AUTH_EVENT, (event) => {
    const { state, data } = event.detail;
    if (state === AUTH_STATE.AUTHENTICATED) listEl.replaceChildren(...rowsFn(doc, data));
    else listEl.replaceChildren();
  });
}
