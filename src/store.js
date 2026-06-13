// Einfache JSON-Persistenz (data/store.json). Fuer die Demo bewusst ohne Datenbank.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "./config.js";

const FILE = path.join(config.dataDir, "store.json");

const defaults = () => ({
  settings: {
    agentName: "Vodafone Agent",
    greeting:
      "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann Nachrichten aufnehmen oder direkt einen Termin vereinbaren. Wie kann ich helfen?",
    allowCalendar: true,
    allowBooking: true,
    allowSummaries: true,
    allowPersonalData: false,
    allowBankData: false,
  },
  calls: [], // {id, direction, from, to, goal, status, startedAt, endedAt, transcript:[{role,text,at}], summary, actionItems:[ids]}
  actionItems: [], // {id, callId, text, type:"todo"|"appointment", done, createdAt}
  calendar: [
    // Demo-Termine, damit der Agent echte Verfuegbarkeiten hat
    { id: "ev1", title: "Team-Meeting", start: nextWeekday(1, 10), end: nextWeekday(1, 11) },
    { id: "ev2", title: "Mittagessen mit Alex", start: nextWeekday(2, 12), end: nextWeekday(2, 13) },
    { id: "ev3", title: "Projekt-Review", start: nextWeekday(3, 15), end: nextWeekday(3, 16.5) },
  ],
  usage: { inputTokens: 0, outputTokens: 0, costEur: 0, calls: 0 },
  notifications: [], // {id, title, body, at, callId}
  // Rechteprofile pro Nutzer (Phase 2): { "<email>": {<Profil-Felder>} }. Eigener
  // Top-Level-Key - updateSettings faesst ihn bewusst NICHT an.
  profiles: {},
});

function nextWeekday(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
  return d.toISOString();
}

let state = null;

export function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, "utf8"));
    // Neue Default-Felder ergaenzen (Migrationen)
    const d = defaults();
    state.settings = { ...d.settings, ...state.settings };
    state.usage = { ...d.usage, ...state.usage };
    state.notifications ||= [];
    state.profiles ||= {};
  } catch {
    state = defaults();
    save();
  }
  seedProfilesFromEnv();
  return state;
}

// Profile aus config.profilesSeed (Env-Var PROFILES_JSON) in den Store mergen.
// Render (free plan) hat ein fluechtiges Dateisystem -> ohne diesen Seed waeren
// Profile nach jedem Neustart weg. Bereits im Store vorhandene (per-API) Eintraege
// gewinnen pro Schluessel; jeder Seed wird wie ueber die API sanitisiert (Whitelist).
// Kaputtes JSON crasht den Start NICHT (wird geloggt und ignoriert - fail-safe).
function seedProfilesFromEnv() {
  if (!config.profilesSeed) return;
  let parsed;
  try {
    parsed = JSON.parse(config.profilesSeed);
  } catch {
    console.error("[profiles] PROFILES_JSON ist kein gueltiges JSON - ignoriert");
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("[profiles] PROFILES_JSON muss ein Objekt {identity: {...}} sein - ignoriert");
    return;
  }
  const seeded = {};
  for (const [key, value] of Object.entries(parsed)) seeded[key] = sanitizeProfile(value);
  state.profiles = { ...seeded, ...state.profiles };
}

export function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---- Calls ----
export function createCall({ direction, from, to, goal, twilioSid, briefing, constraints, callerName, language, maxDurationS, requestedBy }) {
  const s = load();
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
  save();
  return call;
}

export function getCall(id) {
  return load().calls.find((c) => c.id === id || c.twilioSid === id) || null;
}

export function addTranscript(callId, role, text) {
  const call = getCall(callId);
  if (!call) return;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  save();
}

export function markAnswered(callId) {
  const call = getCall(callId);
  if (call && !call.answeredAt) {
    call.answeredAt = new Date().toISOString();
    save();
  }
  return call;
}

export function endCallRecord(callId, status = "completed") {
  const call = getCall(callId);
  if (!call) return null;
  if (call.status === "active") {
    call.status = status;
    call.endedAt = new Date().toISOString();
    save();
  }
  return call;
}

// Zaehlt Outbound-Calls mit startedAt >= sinceIso (gleitendes Fenster fuers
// Pro-Stunde-Gate in server.js). Ohne requestedBy: ALLE Outbound-Records (globale
// Bremse, Bestand). Mit requestedBy: nur die Calls dieses Nutzers (pro-Nutzer-
// Limit). Zaehlt bewusst auch fehlgeschlagene - konservative Toll-Fraud-Bremse.
export function countOutboundCallsSince(sinceIso, requestedBy = null) {
  return load().calls.filter(
    (c) =>
      c.direction === "outbound" &&
      c.startedAt >= sinceIso &&
      (requestedBy == null || c.requestedBy === requestedBy)
  ).length;
}

// ---- Action Items ----
export function addActionItem(callId, text, type = "todo") {
  const s = load();
  const item = {
    id: newId("ai"),
    callId,
    text,
    type,
    done: false,
    createdAt: new Date().toISOString(),
  };
  s.actionItems.unshift(item);
  const call = getCall(callId);
  if (call) call.actionItemIds.push(item.id);
  save();
  return item;
}

export function toggleActionItem(id) {
  const s = load();
  const item = s.actionItems.find((a) => a.id === id);
  if (item) {
    item.done = !item.done;
    save();
  }
  return item;
}

// ---- Kalender ----
export function getCalendar() {
  return load().calendar.sort((a, b) => a.start.localeCompare(b.start));
}

export function addCalendarEvent(title, startIso, endIso) {
  const s = load();
  const ev = { id: newId("ev"), title, start: startIso, end: endIso };
  s.calendar.push(ev);
  save();
  return ev;
}

export function findConflict(startIso, endIso) {
  return getCalendar().find((ev) => ev.start < endIso && startIso < ev.end) || null;
}

// ---- Usage / Budget-Guard ----
export function trackUsage(inputTokens, outputTokens, cfg) {
  const s = load();
  s.usage.inputTokens += inputTokens;
  s.usage.outputTokens += outputTokens;
  const usd =
    (inputTokens / 1e6) * cfg.priceInPerMTokUsd +
    (outputTokens / 1e6) * cfg.priceOutPerMTokUsd;
  s.usage.costEur += usd * cfg.usdToEur;
  save();
  return s.usage;
}

export function budgetExceeded(cfg) {
  return load().usage.costEur >= cfg.maxBudgetEur;
}

// ---- Notifications ----
export function addNotification(title, body, callId) {
  const s = load();
  s.notifications.unshift({
    id: newId("nt"),
    title,
    body,
    callId: callId || null,
    at: new Date().toISOString(),
  });
  s.notifications = s.notifications.slice(0, 50);
  save();
}

// ---- Retention (DSGVO-Datenminimierung) ----
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Loescht beendete Calls (samt Transkript), Notifications und ERLEDIGTE Action
// Items, die aelter als `days` sind. Aktive Calls und offene Action Items
// bleiben immer erhalten. days <= 0 schaltet die Retention ab.
export function pruneOldData(days = config.retentionDays) {
  const removed = { calls: 0, notifications: 0, actionItems: 0 };
  if (!days || days <= 0) return removed;
  const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  const s = load();

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

  if (removed.calls || removed.notifications || removed.actionItems) save();
  return removed;
}

// ---- Settings ----
// Whitelist gegen die Default-Settings: nur bekannte Keys mit passendem Typ.
// Unbekannte Keys / falsche Typen werden ignoriert - POST /api/settings kann
// so keine fremden Felder in den Store schreiben oder Typen kippen.
// Liefert auch die uebernommenen Keys (fuers Audit-Log in server.js).
export function updateSettings(patch) {
  const s = load();
  const allowed = defaults().settings;
  const changed = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in allowed && typeof value === typeof allowed[key]) {
      s.settings[key] = value;
      changed.push(key);
    }
  }
  save();
  return { settings: s.settings, changed };
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
// Ein Profil kann die GLOBALE Allowlist fuer einen Nutzer lockern
// (unrestricted / eigene allowedNumbers). Alle anderen Gates (Denylist, Land,
// Stunde, Budget, Max-Dauer) bleiben harte Obergrenzen - ein Profil kann sie nur
// WEITER einschraenken (Land-Schnittmenge, min-Stundenlimit), nie aufweichen.

// Profil-Felder mit erwartetem Typ (Whitelist gegen sanitizeProfile, analog
// updateSettings). "string[]" = Array aus Strings.
const PROFILE_FIELDS = {
  allowedNumbers: "string[]", // eigene Allowlist (zusaetzlich zur globalen)
  allowedCountryCodes: "string[]", // engt das globale Land-Gate weiter ein (nie auf)
  unrestricted: "boolean", // hebt die GLOBALE Allowlist auf (nur die Allowlist!)
  allowCalendar: "boolean", // get_calendar-MCP-Tool
  allowBooking: "boolean", // POST /api/calendar
  maxCallsPerHour: "number", // pro-Nutzer-Stundenlimit (effektiv min(global, profil))
};

// Default-Profil: kleines Stundenlimit (fail-closed fuer profillose Nutzer).
const DEFAULT_PROFILE_MAX_CALLS_PER_HOUR = 2;

// Owner = localhost/stdio ohne Identitaet: permissiv = heutiges Verhalten. Die
// globale Allowlist greift weiter (unrestricted=false, leere Profil-Allowlist),
// kein Zusatz-Stundenlimit (maxCallsPerHour=null -> effektiv global), Kalender/
// Booking erlaubt. So bleiben die Phase-0-Tests (localhost = Owner) gruen.
const OWNER_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: true,
  allowBooking: true,
  maxCallsPerHour: null,
};

// Default = authentifiziert, aber (noch) ohne Profil: fail-closed/restriktiv.
// Keine Allowlist-Lockerung, kleines Stundenlimit, kein Kalender/Booking.
const DEFAULT_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: false,
  allowBooking: false,
  maxCallsPerHour: DEFAULT_PROFILE_MAX_CALLS_PER_HOUR,
};

// Effektives Profil fuer eine Identitaet. null/leer (localhost/stdio ohne JWT)
// -> Owner. Bekannte Identitaet -> gespeichertes Profil ueber DEFAULT gemerged
// (fehlende Felder fallen restriktiv zurueck). Unbekannt -> DEFAULT.
export function resolveProfile(email) {
  if (!email) return { ...OWNER_PROFILE };
  const stored = load().profiles[email];
  return stored ? { ...DEFAULT_PROFILE, ...stored } : { ...DEFAULT_PROFILE };
}

// Whitelist gegen PROFILE_FIELDS (Key + Typ). Unbekannte Keys / falsche Typen
// werden verworfen. allowedNumbers wird wie config.allowedNumbers normalisiert,
// damit der Gate-Vergleich gegen E.164 trifft; Laendercodes nur getrimmt.
function sanitizeProfile(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const type = PROFILE_FIELDS[key];
    if (!type) continue;
    if (type === "string[]") {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        clean[key] =
          key === "allowedNumbers"
            ? value.map((n) => n.replace(/[\s\-()]/g, "")).filter(Boolean)
            : value.map((c) => c.trim()).filter(Boolean);
      }
    } else if (typeof value === type) {
      clean[key] = value;
    }
  }
  return clean;
}

export function listProfiles() {
  return load().profiles;
}

// Legt ein Profil an oder ergaenzt es (Merge der sanitisierten Felder). Liefert
// das gespeicherte Profil + die uebernommenen Keys (fuers Audit-Log, ohne Werte).
export function setProfile(email, patch) {
  const s = load();
  const clean = sanitizeProfile(patch);
  s.profiles[email] = { ...(s.profiles[email] || {}), ...clean };
  save();
  return { profile: s.profiles[email], changed: Object.keys(clean) };
}

export function deleteProfile(email) {
  const s = load();
  if (!(email in s.profiles)) return false;
  delete s.profiles[email];
  save();
  return true;
}
