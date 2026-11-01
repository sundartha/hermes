import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import {
  makeDefaultState,
  settingsFor,
  bindSubToTenant,
  resolveTenant,
  setProfile,
  calendarFor,
  updateSettings,
  addCalendarEvent,
  getCalendar,
  findConflict,
  tenantContext,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, defaultSettings, demoCalendar } from "../src/store/defaults.js";

const TENANT_A = "alex";
const TENANT_B = "maria";

let config;
let jsonBackend;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  config = (await import("../src/config.js")).config;
  jsonBackend = await import("../src/store/json.js");
});

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
  addCalendarEvent(s, {
    tenantId: TENANT_B,
    title: "Termin B",
    startIso: "2030-01-01T10:00:00.000Z",
    endIso: "2030-01-01T11:00:00.000Z",
  });
  assert.equal(calendarFor(s, TENANT_B).length, 1);
  assert.equal(calendarFor(s, TENANT_B)[0].title, "Termin B");
  assert.equal(calendarFor(s, TENANT_A).length, 0, "A-Bucket bleibt leer");
});

test("neuer Tenant ohne Bucket: settingsFor liefert frische Defaults, calendarFor eine leere Liste", () => {
  const s = makeDefaultState();
  assert.deepEqual(settingsFor(s, TENANT_B), defaultSettings(), "frische Default-Settings");
  assert.deepEqual(calendarFor(s, TENANT_B), [], "leere Liste (kein Owner-Demo-Kalender)");
});

let migrateSeq = 0;
async function loadFlatStore(flat) {
  const dir = tempDataDir();
  const fs = await import("fs");
  const path = await import("path");
  fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(flat, null, 2));
  config.server.dataDir = dir;
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

test("tenantContext(owner).settings/.calendar sind die Owner-Bucket-Referenzen", () => {
  const s = makeDefaultState();
  const ctx = tenantContext(s, "", BOOTSTRAP_TENANT_ID);
  assert.equal(ctx.settings, settingsFor(s, BOOTSTRAP_TENANT_ID));
  assert.equal(ctx.settings, s.settings[BOOTSTRAP_TENANT_ID], "Owner-Bucket-Referenz, nicht die Map");
  assert.equal(ctx.calendar, calendarFor(s, BOOTSTRAP_TENANT_ID));
});

test("tenantContext(owner) bei frischem State: settings == defaults, calendar == demoCalendar", () => {
  const s = makeDefaultState();
  const ctx = tenantContext(s, "", BOOTSTRAP_TENANT_ID);
  assert.deepEqual(ctx.settings, defaultSettings());
  assert.deepEqual(ctx.calendar, demoCalendar());
});

test("Fassade json.js: addCalendarEvent/findConflict round-trippen ueber tenantId", () => {
  jsonBackend.addCalendarEvent({
    tenantId: BOOTSTRAP_TENANT_ID,
    title: "Fassaden-Termin",
    startIso: "2031-01-01T10:00:00.000Z",
    endIso: "2031-01-01T11:00:00.000Z",
  });
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

const STIL_WARM = "warm-persoenlich";

test("updateSettings: null und leerer Text setzen eine optionale Auswahl zurueck und gelten als geaendert", () => {
  for (const leer of [null, ""]) {
    const zustand = makeDefaultState();
    updateSettings(zustand, TENANT_B, { agentStyle: STIL_WARM });
    const ergebnis = updateSettings(zustand, TENANT_B, { agentStyle: leer });
    assert.deepEqual(ergebnis.changed, ["agentStyle"]);
    assert.equal(settingsFor(zustand, TENANT_B).agentStyle, null);
  }
});

test("updateSettings: Auswahl wird gross/klein-unabhaengig auf die Schreibweise der Liste gesetzt", () => {
  const zustand = makeDefaultState();
  const ergebnis = updateSettings(zustand, TENANT_B, { agentStyle: STIL_WARM.toUpperCase() });
  assert.deepEqual(ergebnis.changed, ["agentStyle"]);
  assert.equal(settingsFor(zustand, TENANT_B).agentStyle, STIL_WARM);
});

test("updateSettings: Nicht-Text und unbekannter Text bei einer Auswahl werden abgelehnt, nichts aendert sich", () => {
  const zustand = makeDefaultState();
  updateSettings(zustand, TENANT_B, { agentStyle: STIL_WARM });
  const ergebnis = updateSettings(zustand, TENANT_B, { agentStyle: 5, language: "gibt-es-nicht" });
  assert.deepEqual(ergebnis.changed, []);
  assert.equal(settingsFor(zustand, TENANT_B).agentStyle, STIL_WARM);
  assert.equal(settingsFor(zustand, TENANT_B).language, null);
});

test("updateSettings: unbekannte Schluessel werden ignoriert", () => {
  const zustand = makeDefaultState();
  const ergebnis = updateSettings(zustand, TENANT_B, { unbekannt: undefined, toString: undefined });
  assert.deepEqual(ergebnis.changed, []);
  assert.equal(Object.hasOwn(settingsFor(zustand, TENANT_B), "unbekannt"), false);
});

test("bindSubToTenant: ohne Subjekt oder ohne Mandant wird nichts eingetragen", () => {
  const zustand = makeDefaultState();
  bindSubToTenant(zustand, "sub-1", "");
  bindSubToTenant(zustand, "", TENANT_A);
  bindSubToTenant(zustand, "sub-2", undefined);
  assert.deepEqual(zustand.subIndex, {});
  bindSubToTenant(zustand, "sub-3", TENANT_B);
  assert.deepEqual(zustand.subIndex, { "sub-3": TENANT_B });
});

test("resolveTenant: ohne Subjekt gibt es null, auch wenn ein Mandant kein Subjekt hat", () => {
  const zustand = makeDefaultState();
  zustand.tenants.push({ id: TENANT_B });
  assert.equal(resolveTenant(zustand, undefined), null);
  assert.equal(resolveTenant(zustand, ""), null);
});

test("setProfile: spaetere Aenderung behaelt die frueheren Felder des Mandanten", () => {
  const zustand = makeDefaultState();
  setProfile(zustand, TENANT_B, { allowCalendar: true });
  const ergebnis = setProfile(zustand, TENANT_B, { allowBooking: false });
  assert.deepEqual(ergebnis.changed, ["allowBooking"]);
  assert.deepEqual(zustand.profiles[TENANT_B], { allowCalendar: true, allowBooking: false });
});
