// Einfache JSON-Persistenz (data/store.json). Fuer die Demo bewusst ohne Datenbank.
// Die Fachlogik (Call-Record-Aufbau, Retention, Kostenformel, ...) lebt in
// state-ops.js und wird von beiden Backends geteilt; hier nur Datei-Persistenz
// und das PROFILES_JSON-Seeding (Render free plan, fluechtiges Dateisystem).
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import {
  defaultSettings,
  defaultSettingsMap,
  demoCalendar,
  calendarMap,
  emptyUsage,
  emptyUsageMap,
  sanitizeProfile,
  BOOTSTRAP_TENANT_ID,
  normNum,
  E164,
  resolveSeedProvider,
} from "./defaults.js";
import { findActiveNumber } from "./views.js";
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
// verloren geht (sonst griffe Inbound nach P3c fail-closed - vgl. seedBootstrapNumber unten).
function finishLoad() {
  seedProfilesFromEnv();
  // render-owner-autoseed: die Owner-/Betriebsnummer wird (nur) bei gesetzter Env-Var
  // OWNER_NUMBER_SEED idempotent geseedet - Render (free plan) hat ein fluechtiges
  // Dateisystem, sonst braeche der Boot-Guard nach jedem Deploy fail-closed ab. Liegt in
  // finishLoad (= gemeinsamer Abschluss ALLER load()-Zweige) -> kein Seed-Pfad geht
  // verloren, und der Seed laeuft VOR dem Boot-Guard (server.js: store.load() < Guard).
  // Tenant-Record (status active), Identitaet (ownerName) und private Summary-Nummer
  // bleiben config-frei: erster Tenant via scripts/bootstrap-tenant.js, Rest ueber
  // Self-Service. Leere OWNER_NUMBER_SEED -> kein Seed -> Boot bleibt fail-closed.
  seedOwnerNumberFromEnv();
  seedOwnerIdpSubjectFromEnv();
  seedOwnerKyc();
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
    return { [BOOTSTRAP_TENANT_ID]: { ...emptyUsage(), ...usage } };
  }
  // Bereits eine Map: jeden Bucket gegen den Default auffuellen, Owner sicherstellen.
  const map = {};
  for (const [tenantId, bucket] of Object.entries(usage)) {
    map[tenantId] = { ...emptyUsage(), ...bucket };
  }
  map[BOOTSTRAP_TENANT_ID] ||= emptyUsage();
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
    return { [BOOTSTRAP_TENANT_ID]: { ...defaultSettings(), ...settings } };
  }
  const map = {};
  for (const [tenantId, bucket] of Object.entries(settings)) {
    map[tenantId] = { ...defaultSettings(), ...bucket };
  }
  map[BOOTSTRAP_TENANT_ID] ||= defaultSettings();
  return map;
}

// Migriert eine alte FLACHE calendar-Liste auf die owner-keyed Map (I2). Erkennt
// das alte Shape an Array.isArray. Defensiv (fehlend -> calendarMap) + idempotent
// (bereits Map -> frisch aufbauen wie migrateUsage/SettingsToMap, fremde Buckets
// uebernehmen, Owner sicherstellen).
function migrateCalendarToMap(calendar) {
  if (Array.isArray(calendar)) return { [BOOTSTRAP_TENANT_ID]: calendar };
  if (!calendar || typeof calendar !== "object") return calendarMap();
  const map = {};
  for (const [tenantId, events] of Object.entries(calendar)) {
    map[tenantId] = events;
  }
  map[BOOTSTRAP_TENANT_ID] ||= demoCalendar();
  return map;
}

// Profile aus config.profilesSeed (Env-Var PROFILES_JSON) in den Store mergen.
// Render (free plan) hat ein fluechtiges Dateisystem -> ohne diesen Seed waeren
// Profile nach jedem Neustart weg. Schluessel sind seit Phase S tenantIds (vormals
// emails) - der Operator stellt PROFILES_JSON auf tenantId-Keys um (.env.example).
// Bereits im Store vorhandene (per-API) Eintraege gewinnen pro Schluessel; jeder Seed
// wird wie ueber die API sanitisiert (Whitelist). Kaputtes JSON crasht den Start NICHT
// (wird geloggt und ignoriert - fail-safe).
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
    console.error("[profiles] PROFILES_JSON muss ein Objekt {tenantId: {...}} sein - ignoriert");
    return;
  }
  const seeded = {};
  for (const [key, value] of Object.entries(parsed)) seeded[key] = sanitizeProfile(value);
  state.profiles = { ...seeded, ...state.profiles };
}

// Owner-/Betriebsnummer aus config.ownerNumberSeed (Env OWNER_NUMBER_SEED) beim Boot
// idempotent in den json-Store seeden (render-owner-autoseed). Render (free plan) hat ein
// fluechtiges Dateisystem -> ohne diesen Seed waere nach jedem Deploy keine aktive
// Owner-Nummer im Store und der Boot-Guard (server.js) braeche fail-closed mit exit(1) ab.
// Muster wie seedProfilesFromEnv (config-gegated, fail-safe, in-memory). Fail-closed:
//   - leere Var               -> kein Seed (Boot-Guard bleibt, AC2)
//   - aktive Owner-Nummer da   -> No-Op (Store gewinnt, kein Doppel-Seed/Drift, AC6/AC8)
//   - kein gueltiges E.164     -> kein Seed (kein gruener Boot mit totem Routing, AC3)
//   - ungueltiger Provider     -> kein Seed (kein stiller Falsch-Carrier, AC4/R1)
// Die E.164-Pruefung sitzt BEWUSST hier im Wrapper (nicht in seedBootstrapNumberFromConfig):
// normNum strippt nur Trennzeichen, validiert KEIN Format - "hallo" waere sonst truthy und
// als aktive Nummer geseedet. Keine Diagnose loggt die Nummer (nur Var-Name + Erwartung,
// AC7: kein PII-Leak).
function seedOwnerNumberFromEnv() {
  const raw = config.ownerNumberSeed;
  if (!raw) return; // AC2: leere Var = kein Seed -> Boot-Guard bleibt fail-closed
  if (findActiveNumber(state, BOOTSTRAP_TENANT_ID)) return; // AC6/AC8: Store gewinnt
  const norm = normNum(raw);
  if (!E164.test(norm)) {
    console.error("[owner-number] OWNER_NUMBER_SEED hat kein gueltiges E.164-Format - ignoriert");
    return; // AC3: kein Seed -> Guard greift (AC7: Nummer NIE im Log)
  }
  const provider = resolveSeedProvider(config.ownerNumberProvider);
  if (provider === null) {
    console.error(
      "[owner-number] OWNER_NUMBER_PROVIDER ungueltig (erwartet twilio|telnyx) - ignoriert",
    );
    return; // AC4: kein Seed -> Guard greift
  }
  // provider ist hier garantiert gueltig; seedBootstrapNumberFromConfig re-validiert ihn
  // intern gegen dasselbe PROVIDER-Set (gewollte Defense-in-Depth, damit das Primitiv
  // eigenstaendig sicher bleibt) - aus diesem Aufrufpfad kann das innere Gate nie greifen.
  ops.seedBootstrapNumberFromConfig(state, norm, BOOTSTRAP_TENANT_ID, provider);
}

// AM6: Owner-OAuth-Identitaet aus OWNER_IDP_SUBJECT idempotent an den Bootstrap-Tenant
// binden (set-if-absent). Muster wie seedOwnerNumberFromEnv (config-gegated, fail-safe,
// in-memory; re-seedet jeden Boot, idempotent). Leer -> kein Seed (Tenant bleibt ohne
// Bindung -> resolveTenant fail-closed). Loggt KEINE Identitaet.
function seedOwnerIdpSubjectFromEnv() {
  ops.seedBootstrapIdpSubject(state, config.ownerIdpSubject, BOOTSTRAP_TENANT_ID);
}

// Phase outbound-p1: den Bootstrap/Owner-Tenant idempotent auf id_verified heilen, damit
// er den fail-closed kycReached-Flip ueberlebt (sonst 403 am ersten Outbound-Gate).
// CONFIG-FREI (kein Env, anders als die Number/IdP-Seeds): der Betreiber ist intrinsisch
// verifiziert. In-memory pro Boot (idempotent, set-if-absent). Render free-tier laeuft auf
// pg (dort heilt pg.init); dieser Pfad deckt lokale/json-Stores ab. Muster: kein save hier
// (re-seedet jeden Boot, wie seedOwnerIdpSubjectFromEnv).
function seedOwnerKyc() {
  ops.seedBootstrapKyc(state, BOOTSTRAP_TENANT_ID);
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
  // F2 P10: auch eine geloeschte privateNumber (PII) muss persistieren - sonst kaeme sie
  // bei einem Tenant ganz ohne Calls nach dem Restart zurueck.
  if (removed.calls || removed.actionItems || removed.notifications || removed.privateNumber)
    save();
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

// Persistierter Summary-SMS-Dedup-Marker (F2 P9): mutiert -> save bei changed (Muster
// wie markAnswered). Der Marker ueberlebt den Prozess-Restart (M2).
export function markSummarySmsSent(callId) {
  const { call, changed } = ops.markSummarySmsSent(load(), callId);
  if (changed) save();
  return call;
}

// CDF1 (Report #2 5.4): persistierter Fehlergrund (mapped Token): mutiert -> save bei
// changed (Muster wie markSummarySmsSent). Der Grund ueberlebt den Prozess-Restart.
export function recordFailureReason(callId, reason) {
  const { call, changed } = ops.recordFailureReason(load(), callId, reason);
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

// Schwester-Query + Sprach-Aufloesung (F1 Phase 4). Reine Leser (kein save).
export function numberRecordByE164(e164) {
  return ops.numberRecordByE164(load(), e164);
}

export function resolveCallLanguage(args) {
  return ops.resolveCallLanguage(load(), args);
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
// Owner-Identitaet ist nicht mehr config-derived (P2b): kein config.ownerName-Fallback
// mehr. Der Owner-Tenant traegt seinen ownerName im Store (Self-Service); fehlt er, gilt
// der leere Fallback "" - fail-closed (kein Default-Name, das Outbound-Gate in /api/calls
// faengt einen leeren ownerName ab). Reine Query, kein save.
export function tenantContext(tenantId) {
  return ops.tenantContext(load(), "", tenantId);
}

// ---- Usage / Budget-Guard ----
export function trackUsage(tenantId, inputTokens, outputTokens, cfg) {
  const usage = ops.trackUsage(load(), tenantId, inputTokens, outputTokens, cfg);
  save();
  return usage;
}

// Lese-Zugriff auf den Usage-Bucket eines Tenants (I5): reine Query, kein save
// (Lazy-Default geerbt von ops.usageOf -> usageFor). /api/state liest darueber den
// Bucket des Request-Tenants statt s.usage[BOOTSTRAP_TENANT_ID] direkt.
export function usageOf(tenantId) {
  return ops.usageOf(load(), tenantId);
}

export function budgetExceeded(tenantId, cfg) {
  return ops.budgetExceeded(load(), tenantId, cfg);
}

export function globalBudgetExceeded(cfg) {
  return ops.globalBudgetExceeded(load(), cfg);
}

// Vorab-Reservierung (outbound-p1c): reine Query, kein save (wie budgetExceeded).
export function reserveExceedsBudget(tenantId, reserveCents, cfg) {
  return ops.reserveExceedsBudget(load(), tenantId, reserveCents, cfg);
}

// Reconcile (outbound-p1c): Mutation -> save (wie trackUsage).
export function addVoiceUsageCostCents(tenantId, costCents) {
  const usage = ops.addVoiceUsageCostCents(load(), tenantId, costCents);
  save();
  return usage;
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

// Tages-Cap-Zaehler der gesendeten Summary-SMS eines Tenants (F2 P8): reine Query
// (kein save, analog tenantStripe). finishCall->planSummarySms liest darueber.
export function dailySmsCount(tenantId, sinceIso) {
  return ops.dailySmsCount(load(), tenantId, sinceIso);
}

// Minuten-Kontingent-Gate-Praedikat (B1b): reine Query, kein save (wie budgetExceeded).
// opts = { includedMinutes, periodStartIso }, fail-closed in state-ops.
export function planMinutesExceeded(tenantId, opts) {
  return ops.planMinutesExceeded(load(), tenantId, opts);
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

// ---- Abo-gekoppeltes Outbound-Allowlist-Gate (W5) ----
// Beide reine Queries (kein save, analog kycReached): tenantActiveSubscriber liefert dem
// Gate das Allowlist-Lockerungssignal (aktiver + KYC-verifizierter Subscriber),
// tenantInactive den Defense-in-depth-Hard-Block (suspendierter/geschlossener Tenant).
export function tenantActiveSubscriber(tenantId, minLevel) {
  return ops.tenantActiveSubscriber(load(), tenantId, minLevel);
}

export function tenantInactive(tenantId) {
  return ops.tenantInactive(load(), tenantId);
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

// ---- Abo-Referenzen pro Tenant (W4) ----
// setTenantSubscription mutiert -> save (Muster wie setTenantStripe); tenantSubscription
// und findTenantBySubscription sind reine Queries (kein save, analog tenantStripe).
export function setTenantSubscription(tenantId, patch) {
  const tenant = ops.setTenantSubscription(load(), tenantId, patch);
  save();
  return tenant;
}

export function tenantSubscription(tenantId) {
  return ops.tenantSubscription(load(), tenantId);
}

export function findTenantBySubscription(subscriptionId) {
  return ops.findTenantBySubscription(load(), subscriptionId);
}

// ---- Stripe-Cancel-Nummer-Leak Fix (P1) ----
// markTenantNumbersCancelled/reactivateTenantCancelledNumbers mutieren -> save (Muster
// wie setKycLevel).
export function markTenantNumbersCancelled(tenantId) {
  const numbers = ops.markTenantNumbersCancelled(load(), tenantId);
  save();
  return numbers;
}

export function reactivateTenantCancelledNumbers(tenantId) {
  const numbers = ops.reactivateTenantCancelledNumbers(load(), tenantId);
  save();
  return numbers;
}

// ---- Private Summary-Nummer pro Tenant (F2) ----
// setPrivateNumber mutiert -> save (Muster wie setTenantStripe); tenantPrivateNumber
// ist reine Query (kein save, analog tenantStripe). PII: der Wert wird hier nie geloggt.
export function setPrivateNumber(tenantId, raw) {
  const tenant = ops.setPrivateNumber(load(), tenantId, raw);
  save();
  return tenant;
}

export function tenantPrivateNumber(tenantId) {
  return ops.tenantPrivateNumber(load(), tenantId);
}

// ---- Geo-Location pro Tenant (F1) ----
// setTenantGeo mutiert -> save (Muster wie setTenantStripe). Die settings.language-
// Migration braucht keinen eigenen Code (migrateSettingsToMap backfillt via
// defaultSettings()-Merge); dieser Setter ist fuer den store.js-Fassaden-Export noetig.
export function setTenantGeo(tenantId, patch) {
  const tenant = ops.setTenantGeo(load(), tenantId, patch);
  save();
  return tenant;
}

// ---- Notifications ----
export function addNotification(title, body, callId) {
  ops.addNotification(load(), title, body, callId);
  save();
}

// ---- Owner-/Bestandsnummer eintragen (CLI scripts/seed-owner-number.js) ----
// Bestandsnummer (bereits beim Provider gekauft) direkt 'active' eintragen - die
// EINE legitime Ausnahme zur Transition-Kette (state-ops.seedBootstrapNumber, idempotent
// ueber normNum). Kein Provider-Kauf, kein 'requested'-Vorzustand.
export function seedBootstrapNumber(e164, tenantId, provider) {
  ops.seedBootstrapNumber(load(), e164, tenantId, provider);
  save();
}

// ---- Bootstrap-Tenant (CLI scripts/bootstrap-tenant.js, P2b) ----
// Legt den ersten Tenant an (status active) + traegt seine aktive Bestandsnummer ein,
// in EINER Mutation (state-ops.bootstrapTenant). Loest den fruehen config-derived
// Boot-Seed ab. Idempotent (zweiter Lauf = No-Op). Muster wie seedBootstrapNumber.
export function bootstrapTenant(e164, tenantId, provider) {
  ops.bootstrapTenant(load(), e164, tenantId, provider);
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

// ---- Rechteprofile pro Tenant (Phase 2, Phase S re-keyed) ----
export function resolveProfile(tenantId) {
  return ops.resolveProfile(load(), tenantId);
}

// Tenant-Aufloesung (I4): reine Query, kein save (analog resolveProfile).
export function resolveTenant(idpSubject) {
  return ops.resolveTenant(load(), idpSubject);
}

// Nach-Boot-Spiegel-Nachzug eines Tenants (Signup-Hydrierung): No-Op im json-Backend.
// Der OIDC-Web-Login/Self-Service ist nur mit STORE_BACKEND=pg gemountet (server.js) -
// json hat keine separate accounts-DB, aus der ein nach Boot angelegter Tenant nachzuziehen
// waere (load() haelt ohnehin den einen In-Memory-Zustand). Der Export existiert fuer
// Fassaden-Vollstaendigkeit (store.js re-exportiert ihn fuer beide Backends).
export async function ensureTenant() {
  return false;
}

export function listProfiles() {
  return ops.listProfiles(load());
}

export function setProfile(tenantId, patch) {
  const result = ops.setProfile(load(), tenantId, patch);
  save();
  return result;
}

export function deleteProfile(tenantId) {
  const ok = ops.deleteProfile(load(), tenantId);
  if (ok) save();
  return ok;
}
