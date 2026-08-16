// Einfache JSON-Persistenz (data/store.json). Fuer die Demo bewusst ohne Datenbank.
// Die Fachlogik (Call-Record-Aufbau, Retention, Kostenformel, ...) lebt in
// state-ops.js und wird von beiden Backends geteilt; hier nur Datei-Persistenz
// und das PROFILES_JSON-Seeding (Render free plan, fluechtiges Dateisystem).
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import {
  defaultSettings,
  demoCalendar,
  calendarMap,
  emptyUsage,
  emptyPlatformTtsUsage,
  emptyCostCrossCheck,
  sanitizeProfile,
  BOOTSTRAP_TENANT_ID,
  normNum,
  E164,
  resolveSeedProvider,
  CENTS_PER_EUR,
} from "./defaults.js";
import { findActiveNumber, tenantLanguage as tenantLanguageOf } from "./views.js";
import * as ops from "./state-ops.js";
import { backfillGreetingNotices } from "./greeting-notice-migration.js";

const FILE = path.join(config.server.dataDir, "store.json");

// Zufallssuffix des Temp-Files in save(): Math.random().toString(36) liefert
// "0.<ziffern+kleinbuchstaben>" - TMP_SUFFIX_RADIX ist diese Basis, TMP_SUFFIX_START
// schneidet das fuehrende "0." ab. Reine Kollisionsvermeidung zwischen gleichzeitigen
// Schreibern, KEINE Krypto-Anforderung.
const TMP_SUFFIX_RADIX = 36;
const TMP_SUFFIX_START = 2;
// Einrueckung des persistierten store.json (menschenlesbar, wie im Bestand).
const JSON_INDENT = 2;

let state = null;

export function load() {
  if (state) return state;
  let raw;
  try {
    raw = fs.readFileSync(FILE, "utf8");
  } catch (err) {
    // Genuine First-Boot (File ABWESEND, ENOENT): Defaults sind OK, kein Alarm. Jeder
    // ANDERE Read-Fehler (z.B. EACCES auf existierendem File) wird re-thrown -> sichtbar
    // nach oben (P0-Netz faengt), NIE als First-Boot fehlinterpretiert (OT-3 AC3).
    if (err.code === "ENOENT") {
      state = ops.makeDefaultState();
      save();
      return finishLoad();
    }
    throw err;
  }
  try {
    state = JSON.parse(raw);
    migrateLoadedState();
  } catch {
    // Der catch umspannt BEWUSST Parse UND Migration: ein Store, dessen Felder sich nicht
    // migrieren lassen, ist genauso unbrauchbar wie unparsebares JSON und nimmt denselben
    // forensischen Weg.
    recoverFromCorruptFile();
  }
  return finishLoad();
}

// File VORHANDEN, aber unbrauchbar -> KORRUPTION. NIE still wischen (OT-3 AC3): erst
// forensisch nach .corrupt-<ts> sichern. NUR wenn die Sicherung GELINGT, darf der Store mit
// Defaults weiterlaufen (das korrupte Original ist dann sicher weggeschrieben). Scheitert die
// Sicherung (z.B. nicht-schreibbares dataDir), waere makeDefaultState()+save() ein stiller
// Wipe des korrupten Originals OHNE Forensik-Backup (S1-4) -> stattdessen fail-closed werfen;
// boot.js beendet den Boot dann sichtbar (exit 1). Der Wurf verlaesst load() unveraendert
// (die Funktion laeuft im catch-Zweig von load).
function recoverFromCorruptFile() {
  const corruptPath = `${FILE}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let backedUp = false;
  try {
    fs.renameSync(FILE, corruptPath);
    backedUp = true;
  } catch (re) {
    console.error(
      `[store] KORRUPTES store.json erkannt - Sicherung FEHLGESCHLAGEN (${re.message}). ` +
        `Original bleibt unveraendert unter ${FILE}. Fail-closed: kein Start mit Defaults.`,
    );
  }
  if (!backedUp) {
    throw new Error("store.json korrupt und forensische Sicherung fehlgeschlagen - fail-closed");
  }
  console.error(
    `[store] KORRUPTES store.json erkannt - umbenannt nach ${corruptPath}. ` +
      "Store startet mit Defaults. DATENVERLUST moeglich, File pruefen.",
  );
  state = ops.makeDefaultState();
  save();
}

// "Top-Level-Feld fehlt in einem Bestands-store.json" ist EINE Frage mit EINER Antwort -
// dieselbe wie CALL_FIELD_DEFAULTS weiter unten, nur eine Ebene hoeher. Fabriken statt
// Literalen: jeder Eintrag MUSS einen frischen Wert liefern (ein geteiltes [] waere ein
// stiller Alias zwischen zwei Feldern). ||= laesst gesetzte Werte unangetastet und ruft die
// Fabrik gar nicht erst -> idempotent, Reihenfolge wie im Bestand.
const STATE_FIELD_DEFAULTS = Object.freeze({
  notifications: () => [],
  profiles: () => ({}),
  numbers: () => [],
  provisioningJobs: () => [], // P6b2: Job-Spur in bestehenden Stores nachziehen
  tenantBudgets: () => [], // P6b3: per-Tenant-Kostendecke nachziehen
  usageEvents: () => [], // P6b3: append-only Usage-Ledger nachziehen
  reservations: () => ({}), // OUT-05: nur DEFENSIV (Platte traegt es nie) -> Ergebnis immer leer
  subIndex: () => ({}), // tenant-prolif-b: nur DEFENSIV (ephemer, Platte traegt es nie)
  platformTtsUsage: emptyPlatformTtsUsage, // LCT P7: Bestands-store.json ohne die Zeile nachziehen
  costCrossCheck: emptyCostCrossCheck, // KV-M4: Bestands-store.json ohne die Zeile nachziehen
});

// Neue Default-Felder ergaenzen (Migrationen). Arbeitet wie finishLoad/seed* auf dem
// Modul-state, nicht auf einem Parameter - der Store ist hier bereits geparst.
function migrateLoadedState() {
  state.settings = migrateSettingsToMap(state.settings);
  state.calendar = migrateCalendarToMap(state.calendar);
  state.usage = migrateUsageToMap(state.usage);
  for (const [field, makeDefault] of Object.entries(STATE_FIELD_DEFAULTS)) {
    state[field] ||= makeDefault();
  }
  state.calls = migrateCallFields(state.calls || []);
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
  // O7-Migration (GAP-14): Bestandsgreetings einmalig um den Pflichtsatz ergaenzen.
  // In finishLoad, weil hier ALLE drei load()-Zweige durchlaufen (kein Pfad ausgelassen)
  // und state.numbers/settings zu diesem Zeitpunkt garantiert normalisiert sind.
  // Nur bei echter Aenderung schreiben -> zweiter Boot ist ein No-Op.
  if (backfillGreetingNotices(state).length) save();
  return state;
}

// Konvertiert einen (evtl. Alt-Shape) Usage-Bucket auf costCents als autoritativen Geldwert
// (P1). Alt-Bucket traegt numerisches costEur (Float) -> Ganzzahl-Cents; costEur wird entfernt.
// costMicroCentsRem ist ephemer -> defaultet ueber emptyUsage() auf 0 (Boot startet bei 0).
// spendMonthKey/spendMonthCostCents (P4) und budgetPeriodKey/budgetPeriodBaselineCents
// (GAP-01) defaulten fuer Bestandsbuckets ueber denselben emptyUsage()-Spread auf null/0 -
// keine eigene Migration noetig.
function bucketToCents(bucket) {
  const merged = { ...emptyUsage(), ...bucket };
  if (typeof bucket.costEur === "number") merged.costCents = Math.round(bucket.costEur * CENTS_PER_EUR);
  delete merged.costEur;
  return merged;
}

// Generischer Alt-Shape->owner-keyed-Map-Migrator (G5): usage/settings teilten dieselbe
// Form. Kollabiert den "kein Objekt"-Sonderfall in den generischen Merge-Pfad (leere
// Quelle -> nur der Owner-Default-Bucket, byte-identisch zu emptyUsageMap/defaultSettingsMap).
// migrateCalendarToMap bleibt SEPARAT (Array-Shape, kein Bucket-Transform - kein erzwungener Fit).
function migrateFlatToMap(value, { isFlat, mapBucket, defaultBucket }) {
  const source = value && typeof value === "object" ? value : {};
  if (isFlat(source)) return { [BOOTSTRAP_TENANT_ID]: mapBucket(source) };
  const map = {};
  for (const [tenantId, bucket] of Object.entries(source)) map[tenantId] = mapBucket(bucket);
  map[BOOTSTRAP_TENANT_ID] ||= defaultBucket();
  return map;
}

// Migriert einen alten FLACHEN usage-{inputTokens,...} Store auf die owner-keyed
// Usage-Map (P4). Erkennt das alte Shape an einem numerischen costEur auf der
// Top-Ebene. Defensiv (fehlend -> frische Map) + idempotent (bereits eine Map ->
// fehlende Bucket-Felder defaulten). seedState()-Tests seeden usage flach ->
// diese Migration haelt sie gruen, ohne jeden seedState-Aufrufer anzufassen.
function migrateUsageToMap(usage) {
  return migrateFlatToMap(usage, {
    isFlat: (bucket) => typeof bucket.costEur === "number",
    mapBucket: bucketToCents,
    defaultBucket: emptyUsage,
  });
}

// Migriert ein altes FLACHES settings-{agentName,...} auf die owner-keyed Map (I2).
// Erkennt das alte Shape an typeof agentName==="string" (stabiler Marker, NICHT
// Anzahl). Die alte forward-compat-Zeile ({...defaultSettings(),...flach}) lebt im
// Owner-Bucket weiter. Defensiv (fehlend -> frische Map) + idempotent (bereits Map
// -> jeden Bucket gegen den Default auffuellen, Owner sicherstellen).
function migrateSettingsToMap(settings) {
  return migrateFlatToMap(settings, {
    isFlat: (bucket) => typeof bucket.agentName === "string",
    mapBucket: (bucket) => ({ ...defaultSettings(), ...bucket }),
    defaultBucket: defaultSettings,
  });
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

// "Feld fehlt in einem Bestands-store.json" ist EINE Frage mit EINER Antwort - bisher
// stand sie in zwei strukturgleichen Schleifen (LCT P2, AL-P1), AL-P11 haette die dritte
// gebracht (G5/S2). undefined ist hier gefaehrlich und nicht bloss unsauber: costTruingAttempts
// und callerTurns werden inkrementiert, und undefined + 1 ist NaN - ein Riegel, der nie
// greift. "fehlt" heisst deshalb strukturell null bzw. 0 (G27). Idempotent: ??= laesst
// gesetzte Werte - auch die 0 - unangetastet.
const CALL_FIELD_DEFAULTS = Object.freeze({
  estimatedCostCents: null,
  // KS-P5: die zwei Belastungs-Anker (json<->pg-Parity, rowToCall liefert null). Ein
  // Bestands-store.json ohne die Felder hydriert damit strukturell auf null, nie auf
  // undefined - die Gutschrift faellt dann fail-closed auf die Lebenszeit-Achse.
  estimatedCostSpendMonthKey: null,
  estimatedCostPeriodKey: null,
  actualCostMicroCents: null,
  costTruedAt: null,
  costTruedSource: null,
  costTruingAttempts: 0,
  telnyxConversationId: null,
  // EL-BL1: das zweite Provider-Handle (ElevenLabs, json<->pg-Parity - rowToCall
  // liefert null). Ein Bestands-store.json ohne das Feld hydriert damit strukturell auf
  // null statt auf undefined; ueber genau dieses Feld bindet der Rueckfrage-Webhook
  // eine eingehende Kennung an einen laufenden Anruf.
  elevenlabsConversationId: null,
  callerTurns: 0,
  // AL-P11: Ergebnis-Karte (json<->pg-Parity, rowToCall liefert null).
  result: null,
  // AL-P13: Consult-Kette (json<->pg-Parity, rowToCall liefert null).
  consults: null,
});

function migrateCallFields(calls) {
  for (const call of calls) {
    for (const [field, fallback] of Object.entries(CALL_FIELD_DEFAULTS)) call[field] ??= fallback;
  }
  return calls;
}

// Profile aus config.tenancy.profilesSeed (Env-Var PROFILES_JSON) in den Store mergen.
// Render (free plan) hat ein fluechtiges Dateisystem -> ohne diesen Seed waeren
// Profile nach jedem Neustart weg. Schluessel sind seit Phase S tenantIds (vormals
// emails) - der Operator stellt PROFILES_JSON auf tenantId-Keys um (.env.example).
// Bereits im Store vorhandene (per-API) Eintraege gewinnen pro Schluessel; jeder Seed
// wird wie ueber die API sanitisiert (Whitelist). Kaputtes JSON crasht den Start NICHT
// (wird geloggt und ignoriert - fail-safe).
function seedProfilesFromEnv() {
  if (!config.tenancy.profilesSeed) return;
  let parsed;
  try {
    parsed = JSON.parse(config.tenancy.profilesSeed);
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

// Owner-/Betriebsnummer aus config.provisioning.ownerNumberSeed (Env OWNER_NUMBER_SEED) beim Boot
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
  const raw = config.provisioning.ownerNumberSeed;
  if (!raw) return; // AC2: leere Var = kein Seed -> Boot-Guard bleibt fail-closed
  if (findActiveNumber(state, BOOTSTRAP_TENANT_ID)) return; // AC6/AC8: Store gewinnt
  const norm = normNum(raw);
  if (!E164.test(norm)) {
    console.error("[owner-number] OWNER_NUMBER_SEED hat kein gueltiges E.164-Format - ignoriert");
    return; // AC3: kein Seed -> Guard greift (AC7: Nummer NIE im Log)
  }
  const provider = resolveSeedProvider(config.provisioning.ownerNumberProvider);
  if (provider === null) {
    console.error(
      "[owner-number] OWNER_NUMBER_PROVIDER ungueltig (erwartet telnyx) - ignoriert",
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
  ops.seedBootstrapIdpSubject(state, config.auth.ownerIdpSubject, BOOTSTRAP_TENANT_ID);
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
  fs.mkdirSync(config.server.dataDir, { recursive: true });
  // Atomic write (OT-3 AC1): erst in ein Temp-File IM SELBEN Verzeichnis schreiben +
  // fsync, dann atomar ueber FILE renamen. Ein Crash/Kill mid-write hinterlaesst so
  // hoechstens ein verwaistes .tmp-File, NIE ein truncated store.json. Das tmp MUSS im
  // selben Verzeichnis liegen (gleiches Filesystem) -> renameSync ist atomar (POSIX),
  // kein EXDEV (siehe PLAN-SECURITY.md OT-3).
  const suffix = Math.random().toString(TMP_SUFFIX_RADIX).slice(TMP_SUFFIX_START);
  const tmp = `${FILE}.tmp-${process.pid}-${suffix}`;
  const fd = fs.openSync(tmp, "w");
  try {
    // OUT-05: s.reservations ist STRUKTURELL EPHEMER - nie auf Platte. Die Rest-
    // Destrukturierung schliesst genau diesen Key aus JEDEM save() aus (kein fragiler
    // load()-Reset, Pre-Mortem MAJOR 3); der In-Prozess-state.reservations akkumuliert
    // prozessweit weiter korrekt, nur die PLATTE ist per Konstruktion reserve-frei. Die
    // reservations UND subIndex sind strukturell ephemer (nie auf Platte): idiomatisches
    // rest-omit (tenant-prolif-b: der Index wird jeden Boot neu aufgebaut, kein Persist-Drift).
    // platformSpendWarnedMonth (Budget-Achsen P6) ist derselbe Fall: der Fruehwarn-Marker ist
    // strukturell ephemer (s. state-ops.js Modul-Doc), NIE auf Platte.
    const { reservations, subIndex, platformSpendWarnedMonth, ...persisted } = state;
    // F9 (A6): _finished ist ein transienter In-Prozess-Dedup-Marker von finishCall
    // (server.js) - NIE auf Platte, wie reservations. Ein persistiertes _finished wuerde nach
    // einem Restart die (idempotente) Abrechnung ueberspringen (Unter-Zaehlung). Der persistierte
    // billedAt-Marker ist der prozessuebergreifende Idempotenz-Weg; _finished bleibt strikt ephemer
    // (pg persistiert es ohnehin nie -> Backend-Parity). Der In-Prozess-state bleibt unberuehrt.
    // costMicroCentsRem (P1) ist derselbe Fall: der Sub-Cent-Rest der KI-Akkumulation ist
    // strukturell ephemer (wie reservations) - pg persistiert ihn ohnehin nie (Backend-Parity),
    // ein persistierter Rest wuerde bei Reload den falschen Cent-Uebertrag vortaeuschen.
    // P4-ASYMMETRIE, bewusst: spendMonthCostCents/spendMonthKey stehen NICHT auf dieser
    // Liste - sie WERDEN persistiert. Ein Monats-Anker nur im Prozess-Spiegel wuerde bei
    // jedem Boot neu gestempelt und den Cap nach P7 faktisch wirkungslos machen.
    // costMicroCentsRem bleibt ephemer -> die Monats-Achse driftet ueber einen Neustart
    // minimal anders als costCents: < 1 Cent pro Neustart, akzeptiert (s. schema.sql).
    const stripEphemeral = (key, value) =>
      key === "_finished" || key === "costMicroCentsRem" ? undefined : value;
    fs.writeFileSync(fd, JSON.stringify(persisted, stripEphemeral, JSON_INDENT));
    fs.fsyncSync(fd); // Daten muessen auf der Platte sein, BEVOR der Rename committet
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, FILE);
}

// F11/S1-2: Backend-Parity zu store/pg.js. Vertrag: ein fehlgeschlagener finaler Flush ist fuer
// gracefulShutdown beobachtbar. pg deferrt den DB-Write an eine asynchrone flushChain und laesst
// den Fehler ueber drainFlushes() werfen; das json-Backend schreibt in save() vollstaendig
// synchron (writeFileSync+fsyncSync ab, BEVOR save() zurueckkehrt) und WIRFT eine Schreib-/Rename-
// Stoerung bereits synchron aus save() heraus (gracefulShutdown faengt sie im selben try/catch).
// Es gibt daher keinen deferred Fehlerzustand, den drainFlushes() nachreichen muesste -> No-Op,
// nur damit store.drainFlushes() bei STORE_BACKEND=json nicht undefined ist (siehe store.js).
export async function drainFlushes() {}

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

export function getCallByControlId(callControlId) {
  return ops.getCallByControlId(load(), callControlId);
}

// F12 (A6): Der EINE json-Prozess hat keinen divergenten Spiegel - er kennt jeden Call.
// Re-Attach ist daher identisch zu getCall (unbekannte id -> null). Der server.js-Re-
// Attach-Pfad bleibt unter STORE_BACKEND=json byte-identisch zum Bestand: im fail-closed
// Zweig hat getCall bereits null/nicht-aktiv geliefert -> attachActiveCall ebenso ->
// logUnknown-Hangup wie zuvor (voice-unknown-call-log.test.js bleibt gruen).
export const attachActiveCall = getCall;

// KS-P1b: dieselbe Begruendung wie attachActiveCall, nur ueber die Telnyx-eigene
// call_control_id (der Shim kennt keine callId). Der json-Prozess hat keinen divergenten
// Spiegel -> Re-Attach ist identisch zur Spiegel-Query. Der Status-Guard sitzt im
// Re-Attach-Kern (telephony/reattach.js), exakt wie bei attachActiveCall.
export const attachActiveCallByControlId = getCallByControlId;

export function addTranscript(callId, role, text) {
  if (ops.addTranscript(load(), callId, role, text)) save();
}

// Roh-Transkript-Purge (#7): leert das Transkript des Calls + persistiert (save()
// GQ-H1-a: verworfene Antwort aus dem Transkript nehmen. Muster identisch zu
// addTranscript (changed -> save).
// LIEFERT den Befund zurueck - anders als addTranscript/purgeTranscript, die nichts
// zurueckgeben. Der Shim verzweigt darauf (nur eine tatsaechliche Entfernung erzeugt die
// discarded_answer-Zeile). Ohne das return meldet die Operation still undefined, die
// Entfernung passiert - und das Messinstrument der Phase bleibt blind.
export function dropLastAgentTranscript(callId) {
  const entfernt = ops.dropLastAgentTranscript(load(), callId);
  if (entfernt) save();
  return entfernt;
}

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

// KS-EL1: der Anker nachziehen - mutiert -> save immer (Muster ops.trueUpAnsweredAt:
// changed ist dort unbedingt true).
export function trueUpAnsweredAt(callId, answeredAtIso) {
  const { call, changed } = ops.trueUpAnsweredAt(load(), callId, answeredAtIso);
  if (changed) save();
  return call;
}

// KS-EL1: der Grund, wenn der Anker nicht ermittelbar war - mutiert -> save bei changed
// (Muster recordElevenlabsConversationId).
export function recordAnsweredUnclearReason(callId, reason) {
  const { call, changed } = ops.recordAnsweredUnclearReason(load(), callId, reason);
  if (changed) save();
  return call;
}

export function endCallRecord(callId, status = "completed") {
  const { call, changed } = ops.endCallRecord(load(), callId, status);
  if (changed) save();
  return call;
}

// F9 (A6): Terminalisierung mit explizitem Anker (F10/F12-Seam). Muster endCallRecord.
export function setCallEndedAt(callId, status, endedAtIso) {
  const { call, changed } = ops.setCallEndedAt(load(), callId, status, endedAtIso);
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

// F9 (A6): persistierter Bucht-Marker - mutiert -> save bei changed (Muster markSummarySmsSent).
export function markBilled(callId) {
  const { call, changed } = ops.markBilled(load(), callId);
  if (changed) save();
  return call;
}

// LCT P2: gebuchter Schaetzbetrag am Call - mutiert -> save bei changed (Muster markBilled).
// KS-P5: input = { costCents, chargeAnchors } (Muster recordCallCostTruingResult).
export function recordCallEstimatedCostCents(callId, input) {
  const { call, changed } = ops.recordCallEstimatedCostCents(load(), callId, input);
  if (changed) save();
  return call;
}

// LCT P3: Abgleich-Ergebnis am Call - mutiert -> save bei changed (Muster markBilled).
export function recordCallCostTruingResult(callId, outcome) {
  const { call, changed } = ops.recordCallCostTruingResult(load(), callId, outcome);
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

// AL-P1: Conversation-UUID + Anrufer-Turn-Zaehler - Wrapper-Paritaet zu pg.js. BEIDE
// saven: die Felder liegen persistent auf Platte (migrateCallDiagnosticFields).
export function recordTelnyxConversationId(callId, conversationId) {
  const { call, changed } = ops.recordTelnyxConversationId(load(), callId, conversationId);
  if (changed) save();
  return call;
}

// EL-BL1: dasselbe fuer das ElevenLabs-Handle - Wrapper-Paritaet zu pg.js. Saved wie
// recordTelnyxConversationId: das Feld liegt persistent auf Platte, und ohne Save waere
// die Bindung nach einem Prozess-Neustart weg (der Webhook fiele auf 404 zurueck).
export function recordElevenlabsConversationId(callId, conversationId) {
  const { call, changed } = ops.recordElevenlabsConversationId(load(), callId, conversationId);
  if (changed) save();
  return call;
}

// EL-Anrufstart: Zusammenfassung + Befund eines vom Anbieter gefuehrten Gespraechs -
// Wrapper-Paritaet zu pg.js. Saved wie recordElevenlabsConversationId: beide Felder liegen
// persistent auf Platte, und get_transcript liest sie nach dem Anruf.
export function recordProviderCallResult(callId, result) {
  const { call, changed } = ops.recordProviderCallResult(load(), callId, result);
  if (changed) save();
  return call;
}

// ABNAHME-D1 (TEIL 2): die vier strukturiert gesammelten Angaben - Wrapper-Paritaet zu
// pg.js. Saved wie recordProviderCallResult: die Felder liegen persistent auf Platte.
export function recordProviderCollectedFields(callId, fields) {
  const { call, changed } = ops.recordProviderCollectedFields(load(), callId, fields);
  if (changed) save();
  return call;
}

// ABNAHME-D1 (TEIL 3): die bestaetigte Zeitzone des Angerufenen (Wert + Herkunft +
// Zeitstempel) - Wrapper-Paritaet zu pg.js. Saved wie recordProviderCollectedFields.
export function recordCalleeConfirmedTimezone(callId, confirmed) {
  const { call, changed } = ops.recordCalleeConfirmedTimezone(load(), callId, confirmed);
  if (changed) save();
  return call;
}

export function countCallerTurn(callId) {
  const { call, changed } = ops.countCallerTurn(load(), callId);
  if (changed) save();
  return call ? call.callerTurns : 0;
}

// AL-P13: Consult-Kette - Wrapper-Paritaet zu pg.js. emit/answer/expire saven (das Feld
// liegt persistent auf Platte); pendingConsult ist ein reiner Leser (kein save).
export function emitConsult(callId, questions) {
  const { call, changed } = ops.emitConsult(load(), callId, questions);
  if (changed) save();
  return call;
}

export function answerConsult(callId, input) {
  const result = ops.answerConsult(load(), callId, input);
  if (result.changed) save();
  return result;
}

// GQ-P7: saved wie answerConsult - deliveredAt liegt in derselben consults-Spalte und muss
// einen Instanzwechsel ueberleben (sonst oeffnet dieselbe Antwort ein zweites Zustellfenster).
export function markConsultAnswerDelivered(callId) {
  const result = ops.markConsultAnswerDelivered(load(), callId);
  if (result.changed) save();
  return result;
}

export function expireOpenConsults(callId) {
  const { call, changed } = ops.expireOpenConsults(load(), callId);
  if (changed) save();
  return call;
}

export function pendingConsult(callId, afterEventId) {
  return ops.pendingConsult(load(), callId, afterEventId);
}

// AL-P14: Zustandsschritt der Wartezeit - saved wie answerConsult (der Status liegt in
// der consults-Spalte). noteConsultPoll saved NICHT: ephemer, es gibt keine Spalte
// (Muster countNoSpeechTurn / releaseOutboundReserve).
export function advanceInCallConsult(callId, input) {
  const { changed, wait } = ops.advanceInCallConsult(load(), callId, input);
  if (changed) save();
  return wait;
}

export function noteConsultPoll(callId) {
  ops.noteConsultPoll(load(), callId);
}

// AL-P10b: Suchtreffer im Kontext - saved wie answerConsult (context ist persistent und
// steht seit AL-P13 im pg-UPDATE-SET). countCallLookup saved NICHT: ephemer, keine Spalte
// (Muster countNoSpeechTurn / noteConsultPoll).
export function addLookupFacts(callId, facts) {
  const { changed, added } = ops.addLookupFacts(load(), callId, facts);
  if (changed) save();
  return added;
}

export function countCallLookup(callId) {
  return ops.countCallLookup(load(), callId);
}

// P3.2: ephemerer No-Speech-Streak - KEIN save() (das Feld ist wie reserveCents nicht
// persistenz-tragend; ein Flush aus anderem Anlass nimmt es folgenlos mit).
export function countNoSpeechTurn(callId) {
  return ops.countNoSpeechTurn(load(), callId);
}

export function clearNoSpeechStreak(callId) {
  ops.clearNoSpeechStreak(load(), callId);
}

export function countOutboundCallsSince(sinceIso, filters = {}) {
  return ops.countOutboundCallsSince(load(), sinceIso, filters);
}

// AL-P12: reiner Leser (kein save) - Wrapper-Paritaet zu pg.js.
export function counterpartyMemory(tenantId, e164) {
  return ops.counterpartyMemory(load(), tenantId, e164);
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

// Sprache eines Tenants OHNE laufenden Call - dieselbe eine Regel wie im Anruf
// (views.tenantLanguage -> resolveCallLanguage mit der aktiven Nummer als Geo-Anker).
// Als Store-Methode angeboten, weil die Outbound-Gate-Kette (P15/T2) sie fuer den
// Anzeigetext einer Ablehnung braucht und dafuer keinen zweiten Resolver bekommt (G5).
export function tenantLanguage(tenantId) {
  return tenantLanguageOf(load(), tenantId);
}

// ---- Action Items ----
export function addActionItem(callId, text, type = "todo") {
  const result = ops.addActionItem(load(), callId, text, type);
  // GQ-P4: eine Dublette hat NICHTS geaendert - kein Grund, die Datei neu zu schreiben.
  if (!result.duplicate) save();
  return result;
}

// GQ-P10: reiner Leser - kein save (Muster pendingConsult).
export function callActionItems(callId) {
  return ops.callActionItems(load(), callId);
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

// event = { tenantId, title, startIso, endIso } - die vier Felder reisen zusammen und
// sind deshalb EIN Objekt (die Shape lebt in ops.addCalendarEvent, die Fassade reicht sie
// nur durch; Muster wie recordUsageEvent/applyCostCorrectionCents).
export function addCalendarEvent(event) {
  const ev = ops.addCalendarEvent(load(), event);
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
// nowIso wird HIER erzeugt (IO-Grenze) und an die zeit-freie ops-Funktion durchgereicht
// (P4, Muster setSuspendedAtIfAbsent) - die Fassaden-Signatur bleibt unveraendert.
export function trackUsage(tenantId, tokens, cfg) {
  const usage = ops.trackUsage(load(), tenantId, tokens, cfg, new Date().toISOString());
  save();
  return usage;
}

// Lese-Zugriff auf den Usage-Bucket eines Tenants (I5): reine Query, kein save
// (Lazy-Default geerbt von ops.usageOf -> usageFor). /api/state liest darueber den
// Bucket des Request-Tenants statt s.usage[BOOTSTRAP_TENANT_ID] direkt.
export function usageOf(tenantId) {
  return ops.usageOf(load(), tenantId);
}

// nowIso wird HIER erzeugt (IO-Grenze) und an die zeit-freie ops-Funktion durchgereicht
// (P7, Muster trackUsage): die Fassaden-Signatur bleibt unveraendert.
export function budgetExceeded(tenantId, cfg) {
  return ops.budgetExceeded(load(), tenantId, cfg, new Date().toISOString());
}

// KS-P2: Live-Variante von budgetExceeded (Mid-Call-Pruefung). liveCents kommt vom Aufrufer
// (budget-gate.js), nowIso wie bei budgetExceeded HIER an der IO-Grenze.
export function liveBudgetExceeded(tenantId, liveCents, cfg) {
  return ops.liveBudgetExceeded(load(), tenantId, liveCents, cfg, new Date().toISOString());
}

// KS-P2/KV-P2: Basis des Live-Terms - reine Query, kein save (wie budgetExceeded).
export function activeCallsFor(tenantId) {
  return ops.activeCallsFor(load(), tenantId);
}

// Vorab-Reservierung (outbound-p1c): reine Query, kein save (wie budgetExceeded).
export function reserveExceedsBudget(tenantId, reserveCents, cfg) {
  return ops.reserveExceedsBudget(load(), tenantId, reserveCents, cfg, new Date().toISOString());
}

// Diagnose-Snapshot der Tenant-Achse (P5a, Anzeige + Ablehnungstexte): reine Query,
// kein save (wie budgetExceeded). KS-P4: nowIso wird HIER erzeugt (IO-Grenze) und an die
// zeit-freie ops-Funktion durchgereicht - dasselbe Muster wie budgetExceeded, weil der
// Snapshot seit KS-P4 dieselbe aufgeloeste Gate-Groesse liest. Die Fassaden-Signatur
// nach aussen bleibt unveraendert.
export function tenantBudgetSnapshot(tenantId, cfg) {
  return ops.tenantBudgetSnapshot(load(), tenantId, cfg, new Date().toISOString());
}

// Reconcile (outbound-p1c): Mutation -> save (wie trackUsage). nowIso s. trackUsage (P4).
export function addVoiceUsageCostCents(tenantId, costCents) {
  const usage = ops.addVoiceUsageCostCents(load(), tenantId, costCents, new Date().toISOString());
  save();
  return usage;
}

// AL-P10: Suchgebuehr - Mutation -> save (wie addVoiceUsageCostCents/trackUsage).
export function addResearchFeeCostCents(tenantId, costCents) {
  const usage = ops.addResearchFeeCostCents(load(), tenantId, costCents, new Date().toISOString());
  save();
  return usage;
}

// LCT P4: Korrekturbuchung - save NUR bei booked (Muster recordCallCostTruingResult). Ein
// verworfener Lauf mutiert nichts, auch nicht den Rest -> kein save.
export function applyCostCorrectionCents(tenantId, input) {
  const result = ops.applyCostCorrectionCents(load(), tenantId, input, new Date().toISOString());
  if (result.booked) save();
  return result;
}

// ---- Reserve-Ledger (OUT-05): atomare In-Flight-Reservierung ----
// KEIN save(): reservations ist strukturell ephemer (nie auf Platte). Der Wrapper mutiert
// NUR den In-Prozess-state (load() liefert das eine Singleton); die Serialisierung im
// server.js-Aufrufpfad (F2) uebernimmt store.withStoreLock. reservationOf ist reine Query
// (Fassaden-Name analog usageOf zu usageFor, G11).
export function tryReserveOutboundBudget(tenantId, reserveCents, cfg) {
  return ops.tryReserveOutboundBudget(load(), tenantId, reserveCents, cfg, new Date().toISOString());
}

export function releaseOutboundReserve(call) {
  return ops.releaseOutboundReserve(load(), call);
}

export function reservationOf(tenantId) {
  return ops.reservationFor(load(), tenantId);
}

// Plattform-Fruehwarnung (Budget-Achsen P6): reine In-Memory-Mutation auf
// platformSpendWarnedMonth, KEIN save() - der Marker ist strukturell ephemer (wie
// reservations, s. state-ops.js Modul-Doc). cfg wird vom Aufrufer (outbound-gates.js)
// hereingereicht, wie bei tryReserveOutboundBudget.
export function claimPlatformSpendWarning(cfg, nowIso) {
  return ops.claimPlatformSpendWarning(load(), cfg, nowIso);
}

// ---- ElevenLabs-Kontingent-Zaehler (LCT P7) ----
// ANDERS als claimPlatformSpendWarning darueber: platformTtsUsage PERSISTIERT (s.
// state-ops.js Modul-Doc) -> save() NUR bei changed (Muster recordCallCostTruingResult).
// cfg = config.billing (dieselbe Instanz, die alle anderen Fassaden-Methoden hier lesen).
export function recordTtsCharacters(chars, nowIso) {
  const result = ops.recordTtsCharacters(load(), chars, config.billing, nowIso);
  if (result.changed) save();
  return result.warning;
}

// Reine Leseprojektion (kein save). nowIso vom Aufrufer (Muster tenantBudgetSnapshot).
export function platformTtsUsageView(nowIso) {
  return ops.platformTtsUsageView(load(), config.billing, nowIso);
}

// ---- ElevenLabs-Zeichen pro Tenant (KE-P6) ----
// PERSISTIERT (usage-Bucket) -> save() NUR bei changed (Muster recordTtsCharacters daneben).
// KEIN cfg-Parameter: die Operation kennt weder Zyklus noch Schwelle.
export function recordTenantTtsCharacters(tenantId, chars) {
  const result = ops.recordTenantTtsCharacters(load(), tenantId, chars);
  if (result.changed) save();
  return result;
}

// KV-P7 (Massnahme 3): Telnyx-Relay-Verbrauch - PERSISTIERT ZWEI Tabellen (usage-Bucket
// des Tenants UND platformTtsUsage) -> save() deckt beide (EIN load()/save()-Zyklus,
// Muster recordTtsCharacters). Rueckgabe-Parity zu recordTtsCharacters (nur die Warnung,
// nicht das interne {changed}).
export function recordRelayTtsCharacters(tenantId, chars, nowIso) {
  const result = ops.recordRelayTtsCharacters(load(), {
    tenantId,
    chars,
    cfg: config.billing,
    nowIso,
  });
  if (result.changed) save();
  return result.warning;
}

// ---- KV-M4: Riegel der monatlichen Gegenprobe ----
// PERSISTIERT (Muster recordTtsCharacters) -> save() NUR bei tatsaechlicher Aenderung
// (laterMonotonicKey kann bei einem bereits gestempelten/zukuenftigen Monat No-op sein).
export function markCostCrossCheckAttempted(monthKey) {
  const loaded = load();
  const before = loaded.costCrossCheck.lastCheckedMonthKey;
  ops.markCrossCheckAttempted(loaded, monthKey);
  if (loaded.costCrossCheck.lastCheckedMonthKey !== before) save();
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
  const sentCount = ops.markMeterEventsSent(load(), eventIds);
  if (sentCount) save();
  return sentCount;
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

// ---- suspended_at Grace-Anker (tenant-prolif-c) ----
// setSuspendedAtIfAbsent/clearSuspendedAt mutieren -> save bei changed (Muster markBilled);
// tenantSuspendedAt ist reine Query (kein save, analog tenantStripe). now an der IO-Grenze erzeugt
// (ops bleibt zeit-injiziert + testbar). json persistiert den Tenant-Record als Ganzes -> kein
// Spalten-Mapping noetig (das Feld reist im save() automatisch mit).
export function setSuspendedAtIfAbsent(tenantId) {
  const { changed } = ops.setSuspendedAtIfAbsent(load(), tenantId, new Date().toISOString());
  if (changed) save();
}

export function clearSuspendedAt(tenantId) {
  const { changed } = ops.clearSuspendedAt(load(), tenantId);
  if (changed) save();
}

// ---- Perioden-Fenster des Budget-Gates (GAP-01) ----
// Mutiert -> save bei changed (Muster clearSuspendedAt). Liefert den Boolean nach aussen:
// der Aufrufer (billing/activation.js) auditiert, OB ein neues Fenster begonnen hat.
export function stampBudgetPeriod(tenantId, periodStartIso) {
  const { changed } = ops.stampBudgetPeriod(load(), tenantId, periodStartIso);
  if (changed) save();
  return changed;
}

export function tenantSuspendedAt(tenantId) {
  return ops.tenantSuspendedAt(load(), tenantId);
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
// LCT P6: deriveTenantBudgetFromPlan laeuft NACH setTenantSubscription, im selben
// save()-Fenster (Wrapper-Parity zu pg.js) - tenant.stripePlanSlug ist dann bereits der
// EFFEKTIVE Slug.
export function setTenantSubscription(tenantId, patch) {
  const tenant = ops.setTenantSubscription(load(), tenantId, patch);
  ops.deriveTenantBudgetFromPlan(load(), tenantId, config.billing);
  save();
  return tenant;
}

export function tenantSubscription(tenantId) {
  return ops.tenantSubscription(load(), tenantId);
}

export function findTenantBySubscription(subscriptionId) {
  return ops.findTenantBySubscription(load(), subscriptionId);
}

// ---- Billing-Hold (GAP-03, O2): Wrapper-Parity zu pg.js ----
// findTenantByCustomer ist reine Query (kein save, analog findTenantBySubscription).
// setBillingHold/clearBillingHold mutieren -> save (Muster setTenantStripe).
// billingHoldActive ist reine Query; now an der IO-Grenze erzeugt (Muster budgetExceeded).
export function findTenantByCustomer(customerId) {
  return ops.findTenantByCustomer(load(), customerId);
}

export function setBillingHold(tenantId, patch) {
  ops.setBillingHold(load(), tenantId, patch);
  save();
}

export function clearBillingHold(tenantId) {
  ops.clearBillingHold(load(), tenantId);
  save();
}

export function billingHoldActive(tenantId) {
  return ops.billingHoldActive(load(), tenantId, new Date().toISOString());
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

// Leser der Geo-Felder (F1). Reine Query, kein save. Wird von der Denial-Metrik in
// routes/api-calls.js gebraucht (GAP-35) - ohne diesen Re-Export waere store.tenantGeo
// auf der Fassade undefined und die Senke wuerfe zur Laufzeit einen TypeError.
export function tenantGeo(tenantId) {
  return ops.tenantGeo(load(), tenantId);
}

// Leser des Tenant-Felds timezone (P8, nur Anzeige). Reine Query, kein save.
export function tenantTimezone(tenantId) {
  return ops.tenantTimezone(load(), tenantId);
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
// P2b: zweite, strengere Frist fuer Diagnose-Transkripte. Positionaler Bestandsvertrag
// bleibt (Tests/Produktion rufen no-arg bzw. mit einer Zahl); die Defaults kommen wie
// bisher aus config.privacy.
// AL-P11: dritte, kuerzeste Frist (Zitate).
export function pruneOldData(
  days = config.privacy.retentionDays,
  diagnosticDays = config.privacy.diagnosticRetentionDays,
  evidenceDays = config.privacy.evidenceRetentionDays,
) {
  const removed = ops.pruneOldData(load(), {
    retentionDays: days,
    diagnosticRetentionDays: diagnosticDays,
    evidenceRetentionDays: evidenceDays,
  });
  if (ops.hasPrunedSomething(removed)) save();
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

// tenant-prolif-b: Fassaden-Parity (store.js re-exportiert fuer BEIDE Backends; ohne diesen
// Export waere store.bindSubToTenant undefined -> TypeError beim mintSession-DI-Aufruf).
// Unter json gibt es keinen Email-Merge (kein account/Web-Login) -> der idpSubject-Fallback in
// resolveTenant deckt 1:1 bereits ab; diese Mutation haelt den Index nur konsistent. KEIN save
// (Index ist ephemer, save() schliesst subIndex ohnehin aus).
export function bindSubToTenant(sub, tenantId) {
  ops.bindSubToTenant(load(), sub, tenantId);
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
