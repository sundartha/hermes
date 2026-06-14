// Reine In-Memory-Operationen auf dem verschachtelten Store-Zustand
// {settings, calls, actionItems, calendar, usage, notifications, profiles}.
// KEIN IO: weder Datei noch DB. Beide Backends (json.js, pg.js) halten denselben
// Zustands-Shape und delegieren die Mutationen hierher - so lebt die Fachlogik
// (Call-Record-Aufbau, Retention-Praedikate, Kostenformel, ...) genau EINMAL
// (Duplizierung vermieden). Die Backends kuemmern sich nur um Persistenz.
import crypto from "crypto";
import {
  defaultSettings,
  demoCalendar,
  emptyUsage,
  sanitizeProfile,
  resolveProfileFrom,
  MAX_NOTIFICATIONS,
} from "./defaults.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function makeDefaultState() {
  return {
    settings: defaultSettings(),
    calls: [], // {id, direction, from, to, goal, status, startedAt, endedAt, transcript:[{role,text,at}], summary, actionItemIds:[ids]}
    actionItems: [], // {id, callId, text, type:"todo"|"appointment", done, createdAt}
    calendar: demoCalendar(),
    usage: emptyUsage(),
    notifications: [], // {id, title, body, at, callId}
    // Rechteprofile pro Nutzer (Phase 2): { "<email>": {<Profil-Felder>} }. Eigener
    // Top-Level-Key - updateSettings faesst ihn bewusst NICHT an.
    profiles: {},
  };
}

export function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---- Calls ----
export function createCall(s, { direction, from, to, goal, twilioSid, briefing, constraints, callerName, language, maxDurationS, requestedBy }) {
  const call = {
    id: newId("call"),
    // Zugangsgeheimnis fuer den /media-WebSocket (steht im TwiML, das nur Twilio
    // sieht). Wird von der Bridge beim start-Event geprueft und darf NIE ueber
    // die API ausgegeben werden (server.js publicCall).
    streamToken: crypto.randomBytes(16).toString("hex"),
    twilioSid: twilioSid || null,
    direction, // "inbound" | "outbound"
    from,
    to,
    goal: goal || null,
    briefing: briefing || null,
    constraints: constraints || null,
    callerName: callerName || null,
    language: language || "de",
    maxDurationS: maxDurationS || null,
    // Wer den Call ausgeloest hat: <email> bei authentifizierten MCP-Nutzern,
    // sonst "owner" (localhost/stdio). Fuer Audit + pro-Nutzer-Stundenlimit.
    requestedBy: requestedBy || null,
    status: "active", // active | completed | failed | cancelled
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    actionItemIds: [],
  };
  s.calls.unshift(call);
  s.usage.calls++;
  return call;
}

export function getCall(s, id) {
  return s.calls.find((c) => c.id === id || c.twilioSid === id) || null;
}

export function addTranscript(s, callId, role, text) {
  const call = getCall(s, callId);
  if (!call) return false;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  return true;
}

export function markAnswered(s, callId) {
  const call = getCall(s, callId);
  let changed = false;
  if (call && !call.answeredAt) {
    call.answeredAt = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}

export function endCallRecord(s, callId, status = "completed") {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false };
  let changed = false;
  if (call.status === "active") {
    call.status = status;
    call.endedAt = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}

// Zaehlt Outbound-Calls mit startedAt >= sinceIso (gleitendes Fenster fuers
// Pro-Stunde-Gate in server.js). Ohne requestedBy: ALLE Outbound-Records (globale
// Bremse, Bestand). Mit requestedBy: nur die Calls dieses Nutzers (pro-Nutzer-
// Limit). Zaehlt bewusst auch fehlgeschlagene - konservative Toll-Fraud-Bremse.
export function countOutboundCallsSince(s, sinceIso, requestedBy = null) {
  return s.calls.filter(
    (c) =>
      c.direction === "outbound" &&
      c.startedAt >= sinceIso &&
      (requestedBy == null || c.requestedBy === requestedBy)
  ).length;
}

// ---- Action Items ----
export function addActionItem(s, callId, text, type = "todo") {
  const item = {
    id: newId("ai"),
    callId,
    text,
    type,
    done: false,
    createdAt: new Date().toISOString(),
  };
  s.actionItems.unshift(item);
  const call = getCall(s, callId);
  if (call) call.actionItemIds.push(item.id);
  return item;
}

export function toggleActionItem(s, id) {
  const item = s.actionItems.find((a) => a.id === id);
  if (item) item.done = !item.done;
  return item;
}

// ---- Kalender ----
export function getCalendar(s) {
  return s.calendar.sort((a, b) => a.start.localeCompare(b.start));
}

export function addCalendarEvent(s, title, startIso, endIso) {
  const ev = { id: newId("ev"), title, start: startIso, end: endIso };
  s.calendar.push(ev);
  return ev;
}

export function findConflict(s, startIso, endIso) {
  return getCalendar(s).find((ev) => ev.start < endIso && startIso < ev.end) || null;
}

// ---- Usage / Budget-Guard ----
export function trackUsage(s, inputTokens, outputTokens, cfg) {
  s.usage.inputTokens += inputTokens;
  s.usage.outputTokens += outputTokens;
  const usd =
    (inputTokens / 1e6) * cfg.priceInPerMTokUsd +
    (outputTokens / 1e6) * cfg.priceOutPerMTokUsd;
  s.usage.costEur += usd * cfg.usdToEur;
  return s.usage;
}

export function budgetExceeded(s, cfg) {
  return s.usage.costEur >= cfg.maxBudgetEur;
}

// ---- Notifications ----
export function addNotification(s, title, body, callId) {
  s.notifications.unshift({
    id: newId("nt"),
    title,
    body,
    callId: callId || null,
    at: new Date().toISOString(),
  });
  s.notifications = s.notifications.slice(0, MAX_NOTIFICATIONS);
}

// ---- Retention (DSGVO-Datenminimierung) ----
// Loescht beendete Calls (samt Transkript), Notifications und ERLEDIGTE Action
// Items, die aelter als `days` sind. Aktive Calls und offene Action Items
// bleiben immer erhalten. days <= 0 schaltet die Retention ab.
export function pruneOldData(s, days) {
  const removed = { calls: 0, notifications: 0, actionItems: 0 };
  if (!days || days <= 0) return removed;
  const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();

  const keepCall = (c) => c.status === "active" || !c.endedAt || c.endedAt >= cutoff;
  const keepNotification = (n) => n.at >= cutoff;
  const keepActionItem = (a) => !a.done || a.createdAt >= cutoff;

  const before = { calls: s.calls.length, notifications: s.notifications.length, actionItems: s.actionItems.length };
  s.calls = s.calls.filter(keepCall);
  s.notifications = s.notifications.filter(keepNotification);
  s.actionItems = s.actionItems.filter(keepActionItem);
  removed.calls = before.calls - s.calls.length;
  removed.notifications = before.notifications - s.notifications.length;
  removed.actionItems = before.actionItems - s.actionItems.length;
  return removed;
}

// ---- Settings ----
// Whitelist gegen die Default-Settings: nur bekannte Keys mit passendem Typ.
// Unbekannte Keys / falsche Typen werden ignoriert - POST /api/settings kann
// so keine fremden Felder in den Store schreiben oder Typen kippen.
// Liefert auch die uebernommenen Keys (fuers Audit-Log in server.js).
export function updateSettings(s, patch) {
  const allowed = defaultSettings();
  const changed = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in allowed && typeof value === typeof allowed[key]) {
      s.settings[key] = value;
      changed.push(key);
    }
  }
  return { settings: s.settings, changed };
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
// Effektives Profil fuer eine Identitaet. null/leer (localhost/stdio ohne JWT)
// -> Owner. Bekannte Identitaet -> gespeichertes Profil ueber DEFAULT gemerged
// (fehlende Felder fallen restriktiv zurueck). Unbekannt -> DEFAULT.
export function resolveProfile(s, email) {
  return resolveProfileFrom(email, email ? s.profiles[email] : undefined);
}

export function listProfiles(s) {
  return s.profiles;
}

// Legt ein Profil an oder ergaenzt es (Merge der sanitisierten Felder). Liefert
// das gespeicherte Profil + die uebernommenen Keys (fuers Audit-Log, ohne Werte).
export function setProfile(s, email, patch) {
  const clean = sanitizeProfile(patch);
  s.profiles[email] = { ...(s.profiles[email] || {}), ...clean };
  return { profile: s.profiles[email], changed: Object.keys(clean) };
}

export function deleteProfile(s, email) {
  if (!(email in s.profiles)) return false;
  delete s.profiles[email];
  return true;
}
