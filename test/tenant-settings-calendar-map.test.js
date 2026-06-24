// I2: settings/calendar zu pro-Tenant-Maps (settingsFor/calendarFor analog usageFor).
// Drei Konzept-Gruppen: (1) Map-Trennung A/B unabhaengig, (2) json.load()-Migration
// eines alten flachen store.json auf die owner-keyed Map, (3) tenantContext(owner)
// byte-identisch zum Owner-Bucket. Reine Unit - KEIN Server-Spawn, KEINE pglite
// (Test-Isolation-Lehre P6a/P3). Testet state-ops + defaults + json.load() via
// tempDataDir.
//
// DATA_DIR wird im before VOR dem ersten config-/json-Import auf ein Temp-
// Verzeichnis gesetzt, damit json.js das echte data/store.json nie anfasst
// (Repo-Regel). Alles, was config.js zieht (config, json.js), wird deshalb
// dynamisch geladen; statisch importiert sind nur config-freie Module.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import {
  makeDefaultState,
  settingsFor,
  calendarFor,
  updateSettings,
  addCalendarEvent,
  getCalendar,
  findConflict,
  tenantContext,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, defaultSettings, demoCalendar } from "../src/store/defaults.js";

// Zwei NICHT-Owner-Tenants fuer die Map-Trennung: der Owner-Bucket ist vorbelegt
// (defaultSettingsMap/calendarMap) und taugt daher nicht fuer die "Bucket bleibt
// leer"-Invariante. Tenant-Identitaet pro-Tenant wird genau hier geprueft.
const TENANT_A = "alex";
const TENANT_B = "maria";

let config;
let jsonBackend;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  config = (await import("../src/config.js")).config;
  jsonBackend = await import("../src/store/json.js");
});

// ---- (1) Map-Trennung ----
test("settingsFor liefert verschiedene Buckets pro Tenant; updateSettings(B) laesst A unberuehrt", () => {
  const s = makeDefaultState();
  assert.notEqual(
    settingsFor(s, TENANT_A),
    settingsFor(s, TENANT_B),
    "A und B sind verschiedene Referenzen",
  );
  updateSettings(s, TENANT_B, { agentName: "Maria-Agent" });
  assert.equal(settingsFor(s, TENANT_B).agentName, "Maria-Agent");
  assert.equal(settingsFor(s, TENANT_A).agentName, defaultSettings().agentName, "A bleibt Default");
});

test("addCalendarEvent(B) erscheint nur in calendarFor(B), nicht in calendarFor(A)", () => {
  const s = makeDefaultState();
  addCalendarEvent(s, TENANT_B, "Termin B", "2030-01-01T10:00:00.000Z", "2030-01-01T11:00:00.000Z");
  assert.equal(calendarFor(s, TENANT_B).length, 1);
  assert.equal(calendarFor(s, TENANT_B)[0].title, "Termin B");
  assert.equal(calendarFor(s, TENANT_A).length, 0, "A-Bucket bleibt leer");
});

test("neuer Tenant ohne Bucket: settingsFor liefert frische Defaults, calendarFor eine leere Liste", () => {
  const s = makeDefaultState();
  assert.deepEqual(settingsFor(s, TENANT_B), defaultSettings(), "frische Default-Settings");
  assert.deepEqual(calendarFor(s, TENANT_B), [], "leere Liste (kein Owner-Demo-Kalender)");
});

// ---- (2) Migration ueber json.load() mit tempDataDir ----
// Schreibt ein altes FLACHES store.json (flaches settings + flache calendar-Liste)
// in ein frisches Temp-DATA_DIR und laedt es ueber ein isoliertes json.js-Modul.
// json.js memoisiert den State prozessweit UND liest config.dataDir nur beim ersten
// Modul-Load - deshalb wird config.dataDir (live mutierbar, wie die pg-Tests es mit
// config.twilioNumber tun) VOR dem Cache-gebusteten Import gesetzt, damit der
// frische Modul-Klon sein eigenes store.json sieht. Build-Operate-Check (P13).
let migrateSeq = 0;
async function loadFlatStore(flat) {
  const dir = tempDataDir();
  const fs = await import("fs");
  const path = await import("path");
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(flat, null, 2));
  config.dataDir = dir;
  const mod = await import(`../src/store/json.js?migrate=${migrateSeq++}`);
  return mod.load();
}

const FLAT_SETTINGS = {
  agentName: "Alt-Agent",
  greeting: "Hallo {owner}",
  allowCalendar: true,
  allowBooking: true,
  allowSummaries: true,
  allowPersonalData: false,
  allowBankData: false,
};

test("Migration: flaches settings + flache calendar-Liste -> owner-keyed Map", async () => {
  const ev = {
    id: "ev_old",
    title: "Alt-Termin",
    start: "2030-02-01T09:00:00.000Z",
    end: "2030-02-01T10:00:00.000Z",
  };
  const state = await loadFlatStore({ settings: FLAT_SETTINGS, calendar: [ev] });
  assert.equal(
    state.settings[BOOTSTRAP_TENANT_ID].agentName,
    "Alt-Agent",
    "altes settings im Owner-Bucket",
  );
  assert.equal(state.calendar[BOOTSTRAP_TENANT_ID][0].id, "ev_old", "alter Kalender im Owner-Bucket");
  assert.equal(
    typeof state.settings.agentName,
    "undefined",
    "settings ist eine Map (kein flaches Feld)",
  );
});

test("Migration: leere calendar-Liste -> leerer Owner-Bucket", async () => {
  const state = await loadFlatStore({ settings: FLAT_SETTINGS, calendar: [] });
  assert.deepEqual(state.calendar[BOOTSTRAP_TENANT_ID], [], "leerer Owner-Kalender bleibt leer");
});

test("Migration ist idempotent: bereits-Map-Shape bleibt unveraendert (Owner-Bucket gleich)", async () => {
  const mapShape = {
    settings: { [BOOTSTRAP_TENANT_ID]: FLAT_SETTINGS },
    calendar: { [BOOTSTRAP_TENANT_ID]: [] },
  };
  const state = await loadFlatStore(mapShape);
  assert.equal(
    state.settings[BOOTSTRAP_TENANT_ID].agentName,
    "Alt-Agent",
    "Owner-Settings unveraendert",
  );
  assert.deepEqual(
    state.calendar[BOOTSTRAP_TENANT_ID],
    [],
    "Owner-Kalender unveraendert (leer bleibt leer)",
  );
});

test("Migration forward-compat: flaches settings ohne neues Feld -> Default im Owner-Bucket", async () => {
  const { allowBankData, ...withoutBankData } = FLAT_SETTINGS;
  const state = await loadFlatStore({ settings: withoutBankData, calendar: [] });
  assert.equal(
    state.settings[BOOTSTRAP_TENANT_ID].allowBankData,
    defaultSettings().allowBankData,
    "fehlendes Feld faellt auf den defaultSettings()-Default",
  );
});

// ---- (3) tenantContext(owner) byte-identisch ----
test("tenantContext(owner).settings/.calendar sind die Owner-Bucket-Referenzen", () => {
  const s = makeDefaultState();
  const ctx = tenantContext(s, config.ownerName, BOOTSTRAP_TENANT_ID);
  assert.equal(ctx.settings, settingsFor(s, BOOTSTRAP_TENANT_ID));
  assert.equal(ctx.settings, s.settings[BOOTSTRAP_TENANT_ID], "Owner-Bucket-Referenz, nicht die Map");
  assert.equal(ctx.calendar, calendarFor(s, BOOTSTRAP_TENANT_ID));
});

test("tenantContext(owner) bei frischem State: settings == defaults, calendar == demoCalendar", () => {
  const s = makeDefaultState();
  const ctx = tenantContext(s, config.ownerName, BOOTSTRAP_TENANT_ID);
  assert.deepEqual(ctx.settings, defaultSettings());
  assert.deepEqual(ctx.calendar, demoCalendar());
});

// Stellt sicher, dass die Fassade die tenantId-Signatur durchreicht (Re-Export +
// Wrapper-Parity): findConflict findet den ueber addCalendarEvent gebuchten Termin
// im selben Owner-Bucket (json-Backend, gegen das migrierte Temp-store.json).
test("Fassade json.js: addCalendarEvent/findConflict round-trippen ueber tenantId", () => {
  jsonBackend.addCalendarEvent(
    BOOTSTRAP_TENANT_ID,
    "Fassaden-Termin",
    "2031-01-01T10:00:00.000Z",
    "2031-01-01T11:00:00.000Z",
  );
  const conflict = jsonBackend.findConflict(
    BOOTSTRAP_TENANT_ID,
    "2031-01-01T10:30:00.000Z",
    "2031-01-01T10:45:00.000Z",
  );
  assert.ok(conflict, "gebuchter Termin wird als Konflikt gefunden");
  assert.equal(
    jsonBackend.getCalendar(BOOTSTRAP_TENANT_ID).some((e) => e.title === "Fassaden-Termin"),
    true,
  );
});
