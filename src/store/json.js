// Einfache JSON-Persistenz (data/store.json). Fuer die Demo bewusst ohne Datenbank.
// Die Fachlogik (Call-Record-Aufbau, Retention, Kostenformel, ...) lebt in
// state-ops.js und wird von beiden Backends geteilt; hier nur Datei-Persistenz
// und das PROFILES_JSON-Seeding (Render free plan, fluechtiges Dateisystem).
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { defaultSettings, defaultSettingsMap, demoCalendar, calendarMap, emptyUsage, emptyUsageMap, sanitizeProfile, OWNER_TENANT_ID, PROVIDER } from "./defaults.js";
import * as ops from "./state-ops.js";

const FILE = path.join(config.dataDir, "store.json");

let state = null;

export function load() {
  if (state) return state;
  let raw;
  try {
    raw = fs.readFileSync(FILE, "utf8");
  } catch (e) {
    // Genuine First-Boot (File ABWESEND, ENOENT): Defaults sind OK, kein Alarm. Jeder
    // ANDERE Read-Fehler (z.B. EACCES auf existierendem File) wird re-thrown -> sichtbar
    // nach oben (P0-Netz faengt), NIE als First-Boot fehlinterpretiert (OT-3 AC3).
    if (e.code === "ENOENT") {
      state = ops.makeDefaultState();
      save();
      return finishLoad();
    }
    throw e;
  }
  try {
    state = JSON.parse(raw);
    // Neue Default-Felder ergaenzen (Migrationen)
    state.settings = migrateSettingsToMap(state.settings);
    state.calendar = migrateCalendarToMap(state.calendar);
    state.usage = migrateUsageToMap(state.usage);
    state.notifications ||= [];
    state.profiles ||= {};
    state.numbers ||= [];
    state.provisioningJobs ||= []; // P6b2: Job-Spur in bestehenden Stores nachziehen
    state.tenantBudgets ||= []; // P6b3: per-Tenant-Kostendecke nachziehen
    state.usageEvents ||= []; // P6b3: append-only Usage-Ledger nachziehen
  } catch {
    // File VORHANDEN, aber unparsebar -> KORRUPTION. NIE still wischen (OT-3 AC3):
    // erst forensisch nach .corrupt-<ts> sichern, LAUT loggen, dann mit Defaults weiter
    // (Telefonie ueberlebt - aber sichtbar, mit Datenverlust-Hinweis statt stillem Wipe).
    const corruptPath = `${FILE}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      fs.renameSync(FILE, corruptPath);
    } catch (re) {
      console.error("[store] .corrupt-Rename fehlgeschlagen:", re.message);
    }
    console.error(
      `[store] KORRUPTES store.json erkannt - umbenannt nach ${corruptPath}. ` +
        "Store startet mit Defaults. DATENVERLUST moeglich, File pruefen.",
    );
    state = ops.makeDefaultState();
    save();
  }
  return finishLoad();
}

// Gemeinsamer Abschluss von load(): First-Boot, Parse-Erfolg UND der Korruptions-Pfad
// laufen hier durch. Ein Helper, damit KEIN Seed-Schritt in einem der drei Zweige
// verloren geht (sonst griffe Inbound nach P3c fail-closed - vgl. seedOwnerNumber unten).
function finishLoad() {
  seedProfilesFromEnv();
  // Owner-Nummer config-derived bei JEDEM load() idempotent sicherstellen (analog
  // seedProfilesFromEnv): ohne sie wuerde Inbound nach P3c fail-closed greifen,
  // weil seedState()-Tests/persistierte Stores keine numbers tragen.
  ops.seedOwnerNumber(state, config.twilioNumber, OWNER_TENANT_ID);
  // Telnyx-Owner-Nummer config-derived idempotent mitseeden (NUR wenn TELNYX_NUMBER
  // gesetzt; der !e164-Guard in seedOwnerNumber erledigt das env-gating). Leer ->
  // kein Seed -> alle Telnyx-Inbound fail-closed (kein Default-Tenant).
  ops.seedOwnerNumber(state, config.telnyxNumber, OWNER_TENANT_ID, PROVIDER.TELNYX);
  // Owner-Identitaet config-derived idempotent seeden (Variante a, G1): schuetzt den
  // ungegateten Inbound-Greeting + summarizeCall. Leere Config -> kein Seed
  // (assertConfig verweigert dann ohnehin den Boot).
  ops.seedOwnerIdentity(state, config.ownerFirstName, config.ownerLastName, OWNER_TENANT_ID);
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

// Migriert ein altes FLACHES settings-{agentName,...} auf die owner-keyed Map (I2).
// Erkennt das alte Shape an typeof agentName==="string" (stabiler Marker, NICHT
// Anzahl). Die alte forward-compat-Zeile ({...defaultSettings(),...flach}) lebt im
// Owner-Bucket weiter. Defensiv (fehlend -> frische Map) + idempotent (bereits Map
// -> jeden Bucket gegen den Default auffuellen, Owner sicherstellen).
function migrateSettingsToMap(settings) {
  if (!settings || typeof settings !== "object") return defaultSettingsMap();
  if (typeof settings.agentName === "string") {
    return { [OWNER_TENANT_ID]: { ...defaultSettings(), ...settings } };
  }
  const map = {};
  for (const [tenantId, bucket] of Object.entries(settings)) {
    map[tenantId] = { ...defaultSettings(), ...bucket };
  }
  map[OWNER_TENANT_ID] ||= defaultSettings();
  return map;
}

// Migriert eine alte FLACHE calendar-Liste auf die owner-keyed Map (I2). Erkennt
// das alte Shape an Array.isArray. Defensiv (fehlend -> calendarMap) + idempotent
// (bereits Map -> frisch aufbauen wie migrateUsage/SettingsToMap, fremde Buckets
// uebernehmen, Owner sicherstellen).
function migrateCalendarToMap(calendar) {
  if (Array.isArray(calendar)) return { [OWNER_TENANT_ID]: calendar };
  if (!calendar || typeof calendar !== "object") return calendarMap();
  const map = {};
  for (const [tenantId, events] of Object.entries(calendar)) {
    map[tenantId] = events;
  }
  map[OWNER_TENANT_ID] ||= demoCalendar();
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
  // Atomic write (OT-3 AC1): erst in ein Temp-File IM SELBEN Verzeichnis schreiben +
  // fsync, dann atomar ueber FILE renamen. Ein Crash/Kill mid-write hinterlaesst so
  // hoechstens ein verwaistes .tmp-File, NIE ein truncated store.json. Das tmp MUSS im
  // selben Verzeichnis liegen (gleiches Filesystem) -> renameSync ist atomar (POSIX),
  // kein EXDEV (siehe PLAN-SECURITY.md OT-3).
  const tmp = `${FILE}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(state, null, 2));
    fs.fsyncSync(fd); // Daten muessen auf der Platte sein, BEVOR der Rename committet
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, FILE);
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
export function getCalendar(tenantId) {
  return ops.getCalendar(load(), tenantId);
}

export function addCalendarEvent(tenantId, title, startIso, endIso) {
  const ev = ops.addCalendarEvent(load(), tenantId, title, startIso, endIso);
  save();
  return ev;
}

export function findConflict(tenantId, startIso, endIso) {
  return ops.findConflict(load(), tenantId, startIso, endIso);
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

// Lese-Zugriff auf den Usage-Bucket eines Tenants (I5): reine Query, kein save
// (Lazy-Default geerbt von ops.usageOf -> usageFor). /api/state liest darueber den
// Bucket des Request-Tenants statt s.usage[OWNER_TENANT_ID] direkt.
export function usageOf(tenantId) {
  return ops.usageOf(load(), tenantId);
}

export function budgetExceeded(tenantId, cfg) {
  return ops.budgetExceeded(load(), tenantId, cfg);
}

export function globalBudgetExceeded(cfg) {
  return ops.globalBudgetExceeded(load(), cfg);
}

// ---- Per-Tenant-Budget + Metering (P6b3) ----
export function setTenantBudget(tenantId, amounts) {
  const row = ops.setTenantBudget(load(), tenantId, amounts);
  save();
  return row;
}

export function recordUsageEvent(input) {
  const event = ops.recordUsageEvent(load(), input);
  save();
  return event;
}

export function pendingMeterEvents() {
  return ops.pendingMeterEvents(load());
}

export function markMeterEventsSent(eventIds) {
  const n = ops.markMeterEventsSent(load(), eventIds);
  if (n) save();
  return n;
}

// ---- KYC (P6b4) ----
// setKycLevel mutiert -> save; kycReached ist reine Query (kein save), analog
// budgetExceeded/resolveTenant.
export function setKycLevel(tenantId, level) {
  const tenant = ops.setKycLevel(load(), tenantId, level);
  save();
  return tenant;
}

export function kycReached(tenantId, minLevel) {
  return ops.kycReached(load(), tenantId, minLevel);
}

// ---- Stripe-Customer/Karte pro Tenant (Pay1) ----
// setTenantStripe mutiert -> save (Muster wie setKycLevel); tenantStripe ist reine
// Query (kein save, analog kycReached).
export function setTenantStripe(tenantId, patch) {
  const tenant = ops.setTenantStripe(load(), tenantId, patch);
  save();
  return tenant;
}

export function tenantStripe(tenantId) {
  return ops.tenantStripe(load(), tenantId);
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
export function updateSettings(tenantId, patch) {
  const result = ops.updateSettings(load(), tenantId, patch);
  save();
  return result;
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
export function resolveProfile(email) {
  return ops.resolveProfile(load(), email);
}

// Tenant-Aufloesung (I4): reine Query, kein save (analog resolveProfile).
export function resolveTenant(idpSubject) {
  return ops.resolveTenant(load(), idpSubject);
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
