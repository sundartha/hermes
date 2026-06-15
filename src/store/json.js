// Einfache JSON-Persistenz (data/store.json). Fuer die Demo bewusst ohne Datenbank.
// Die Fachlogik (Call-Record-Aufbau, Retention, Kostenformel, ...) lebt in
// state-ops.js und wird von beiden Backends geteilt; hier nur Datei-Persistenz
// und das PROFILES_JSON-Seeding (Render free plan, fluechtiges Dateisystem).
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { defaultSettings, emptyUsage, emptyUsageMap, sanitizeProfile, OWNER_TENANT_ID, PROVIDER } from "./defaults.js";
import * as ops from "./state-ops.js";

const FILE = path.join(config.dataDir, "store.json");

let state = null;

export function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, "utf8"));
    // Neue Default-Felder ergaenzen (Migrationen)
    state.settings = { ...defaultSettings(), ...state.settings };
    state.usage = migrateUsageToMap(state.usage);
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
  // Telnyx-Owner-Nummer config-derived idempotent mitseeden (NUR wenn TELNYX_NUMBER
  // gesetzt; der !e164-Guard in seedOwnerNumber erledigt das env-gating). Leer ->
  // kein Seed -> alle Telnyx-Inbound fail-closed (kein Default-Tenant).
  ops.seedOwnerNumber(state, config.telnyxNumber, OWNER_TENANT_ID, PROVIDER.TELNYX);
  return state;
}

// Migriert einen alten FLACHEN usage-{inputTokens,...} Store auf die owner-keyed
// Usage-Map (P4). Erkennt das alte Shape an einem numerischen costEur auf der
// Top-Ebene. Defensiv (fehlend -> frische Map) + idempotent (bereits eine Map ->
// fehlende Bucket-Felder defaulten). seedState()-Tests seeden usage flach ->
// diese Migration haelt sie gruen, ohne jeden seedState-Aufrufer anzufassen.
function migrateUsageToMap(usage) {
  if (!usage || typeof usage !== "object") return emptyUsageMap();
  if (typeof usage.costEur === "number") {
    // Altes flaches Shape -> wird der Owner-Bucket.
    return { [OWNER_TENANT_ID]: { ...emptyUsage(), ...usage } };
  }
  // Bereits eine Map: jeden Bucket gegen den Default auffuellen, Owner sicherstellen.
  const map = {};
  for (const [tenantId, bucket] of Object.entries(usage)) {
    map[tenantId] = { ...emptyUsage(), ...bucket };
  }
  map[OWNER_TENANT_ID] ||= emptyUsage();
  return map;
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

// Roh-Transkript-Purge (#7): leert das Transkript des Calls + persistiert (save()
// schreibt den Gesamt-Store). Muster identisch zu addTranscript (changed -> save).
export function purgeTranscript(callId) {
  if (ops.purgeTranscript(load(), callId)) save();
}

// Per-Tenant-DSGVO-Loeschung (Art. 17): entfernt call-verknuepfte Daten des
// Tenants + persistiert nur bei Aenderung (Muster wie pruneOldData).
export function eraseTenantData(tenantId) {
  const removed = ops.eraseTenantData(load(), tenantId);
  if (removed.calls || removed.actionItems || removed.notifications) save();
  return removed;
}

// Nicht-destruktive Auskunft/Export (Art. 15/20): reine Query, kein save.
export function exportTenantData(tenantId) {
  return ops.exportTenantData(load(), tenantId);
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

export function countOutboundCallsSince(sinceIso, filters = {}) {
  return ops.countOutboundCallsSince(load(), sinceIso, filters);
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

// ---- Tenant-Kontext-Seam (I0) ----
// Reicht config.ownerName als Owner-Fallback an die config-freie ops-Funktion
// (Muster wie cfg bei trackUsage/budgetExceeded). Reine Query, kein save.
export function tenantContext(tenantId) {
  return ops.tenantContext(load(), config.ownerName, tenantId);
}

// ---- Usage / Budget-Guard ----
export function trackUsage(tenantId, inputTokens, outputTokens, cfg) {
  const usage = ops.trackUsage(load(), tenantId, inputTokens, outputTokens, cfg);
  save();
  return usage;
}

export function budgetExceeded(tenantId, cfg) {
  return ops.budgetExceeded(load(), tenantId, cfg);
}

export function globalBudgetExceeded(cfg) {
  return ops.globalBudgetExceeded(load(), cfg);
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
