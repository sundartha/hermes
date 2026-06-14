// Einfache JSON-Persistenz (data/store.json). Fuer die Demo bewusst ohne Datenbank.
// Die Fachlogik (Call-Record-Aufbau, Retention, Kostenformel, ...) lebt in
// state-ops.js und wird von beiden Backends geteilt; hier nur Datei-Persistenz
// und das PROFILES_JSON-Seeding (Render free plan, fluechtiges Dateisystem).
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { defaultSettings, emptyUsage, sanitizeProfile, OWNER_TENANT_ID } from "./defaults.js";
import * as ops from "./state-ops.js";

const FILE = path.join(config.dataDir, "store.json");

let state = null;

export function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, "utf8"));
    // Neue Default-Felder ergaenzen (Migrationen)
    state.settings = { ...defaultSettings(), ...state.settings };
    state.usage = { ...emptyUsage(), ...state.usage };
    state.notifications ||= [];
    state.profiles ||= {};
    state.numbers ||= [];
  } catch {
    state = ops.makeDefaultState();
    save();
  }
  seedProfilesFromEnv();
  // Owner-Nummer config-derived bei JEDEM load() idempotent sicherstellen (analog
  // seedProfilesFromEnv): ohne sie wuerde Inbound nach P3c fail-closed greifen,
  // weil seedState()-Tests/persistierte Stores keine numbers tragen.
  ops.seedOwnerNumber(state, config.twilioNumber, OWNER_TENANT_ID);
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

export const newId = ops.newId;

// ---- Calls ----
export function createCall(input) {
  const call = ops.createCall(load(), input);
  save();
  return call;
}

export function getCall(id) {
  return ops.getCall(load(), id);
}

export function addTranscript(callId, role, text) {
  if (ops.addTranscript(load(), callId, role, text)) save();
}

export function markAnswered(callId) {
  const { call, changed } = ops.markAnswered(load(), callId);
  if (changed) save();
  return call;
}

export function endCallRecord(callId, status = "completed") {
  const { call, changed } = ops.endCallRecord(load(), callId, status);
  if (changed) save();
  return call;
}

export function countOutboundCallsSince(sinceIso, requestedBy = null) {
  return ops.countOutboundCallsSince(load(), sinceIso, requestedBy);
}

// ---- Inbound-Routing: E.164 -> Tenant (P3c) ----
export function findTenantByNumber(e164) {
  return ops.findTenantByNumber(load(), e164);
}

// ---- Action Items ----
export function addActionItem(callId, text, type = "todo") {
  const item = ops.addActionItem(load(), callId, text, type);
  save();
  return item;
}

export function toggleActionItem(id) {
  const item = ops.toggleActionItem(load(), id);
  if (item) save();
  return item;
}

// ---- Kalender ----
export function getCalendar() {
  return ops.getCalendar(load());
}

export function addCalendarEvent(title, startIso, endIso) {
  const ev = ops.addCalendarEvent(load(), title, startIso, endIso);
  save();
  return ev;
}

export function findConflict(startIso, endIso) {
  return ops.findConflict(load(), startIso, endIso);
}

// ---- Usage / Budget-Guard ----
export function trackUsage(inputTokens, outputTokens, cfg) {
  const usage = ops.trackUsage(load(), inputTokens, outputTokens, cfg);
  save();
  return usage;
}

export function budgetExceeded(cfg) {
  return ops.budgetExceeded(load(), cfg);
}

// ---- Notifications ----
export function addNotification(title, body, callId) {
  ops.addNotification(load(), title, body, callId);
  save();
}

// ---- Retention (DSGVO-Datenminimierung) ----
export function pruneOldData(days = config.retentionDays) {
  const removed = ops.pruneOldData(load(), days);
  if (removed.calls || removed.notifications || removed.actionItems) save();
  return removed;
}

// ---- Settings ----
export function updateSettings(patch) {
  const result = ops.updateSettings(load(), patch);
  save();
  return result;
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
export function resolveProfile(email) {
  return ops.resolveProfile(load(), email);
}

export function listProfiles() {
  return ops.listProfiles(load());
}

export function setProfile(email, patch) {
  const result = ops.setProfile(load(), email, patch);
  save();
  return result;
}

export function deleteProfile(email) {
  const ok = ops.deleteProfile(load(), email);
  if (ok) save();
  return ok;
}
