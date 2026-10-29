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
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_GREETING,
  calendarMap,
  defaultSettings,
  defaultSettingsMap,
  demoCalendar,
  emptyUsage,
  emptyUsageMap,
} from "../src/store/defaults.js";

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

const JAHR = 2027;
const JANUAR = 0;
const lokal = (tagImMonat, stunde, minute) =>
  new Date(JAHR, JANUAR, tagImMonat, stunde, minute).toISOString();

test("[NIE1] demoCalendar: Uhr 30.01.2027 09:00, drei Termine in Ortszeit, jedes Mal frische Objekte", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(JAHR, JANUAR, 30, 9, 0) });
  const kalender = demoCalendar();
  assert.deepEqual(kalender, [
    { id: "ev1", title: "Team-Meeting", start: lokal(31, 10, 0), end: lokal(31, 11, 0) },
    { id: "ev2", title: "Mittagessen mit Alex", start: lokal(32, 12, 0), end: lokal(32, 13, 0) },
    { id: "ev3", title: "Projekt-Review", start: lokal(33, 15, 0), end: lokal(33, 16, 30) },
  ]);
  const zweiter = demoCalendar();
  assert.notEqual(zweiter, kalender);
  assert.notEqual(zweiter[0], kalender[0]);
});

test("[NIE2] defaultSettings: Rechte aus, language/agentStyle null, frisches Objekt, Begrüßung nennt KI und Transkription", () => {
  const einstellungen = defaultSettings();
  for (const feld of ["allowPersonalData", "allowBankData", "allowResearch", "allowCallMemory"]) {
    assert.equal(einstellungen[feld], false, feld);
  }
  assert.equal(einstellungen.language, null);
  assert.equal(einstellungen.agentStyle, null);
  assert.equal(einstellungen.greeting, DEFAULT_GREETING);
  assert.notEqual(defaultSettings(), einstellungen);
  assert.match(DEFAULT_GREETING, /KI/);
  assert.match(DEFAULT_GREETING, /transkribiert/);
});

test("[NIE3] defaultSettingsMap, calendarMap, emptyUsageMap führen nur owner und liefern neue Objekte", () => {
  const erwarteteWerte = [
    [defaultSettingsMap, defaultSettings()],
    [emptyUsageMap, emptyUsage()],
  ];
  for (const [fabrik, erwartet] of erwarteteWerte) {
    const karte = fabrik();
    assert.deepEqual(Object.keys(karte), [BOOTSTRAP_TENANT_ID]);
    assert.deepEqual(karte[BOOTSTRAP_TENANT_ID], erwartet);
    assert.notEqual(fabrik(), karte);
    assert.notEqual(fabrik()[BOOTSTRAP_TENANT_ID], karte[BOOTSTRAP_TENANT_ID]);
  }
  const kalender = calendarMap();
  assert.deepEqual(Object.keys(kalender), [BOOTSTRAP_TENANT_ID]);
  assert.equal(kalender[BOOTSTRAP_TENANT_ID].length, demoCalendar().length);
  assert.notEqual(calendarMap(), kalender);
  assert.notEqual(calendarMap()[BOOTSTRAP_TENANT_ID], kalender[BOOTSTRAP_TENANT_ID]);
});
