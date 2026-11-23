import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeReadRoutes } from "../../src/routes/api-read.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgTestStore, makePgStore, legeMandantAn } from "../pg-helpers.js";

const EIGENTUEMER = "owner";
const ANDERER = "mandant-kalender";
const MORGEN = "2030-03-01T10:00:00.000Z";
const MORGEN_ENDE = "2030-03-01T11:00:00.000Z";
const SPAETER = "2030-03-02T10:00:00.000Z";
const SPAETER_ENDE = "2030-03-02T11:00:00.000Z";
const ZEILEN_SQL =
  "SELECT id, tenant_id, title, starts_at, ends_at FROM calendar_event WHERE title LIKE 'T-%' ORDER BY title";

async function zweiInstanzen() {
  const { store: a, runner, db } = await makePgTestStore();
  const b = makePgStore(runner);
  await b.init();
  const zeilen = async () => (await db.query(ZEILEN_SQL)).rows;
  return { a, b, zeilen, db };
}

const termin = (tenantId, title, [startIso, endIso]) => ({ tenantId, title, startIso, endIso });
const FRUEH = [MORGEN, MORGEN_ENDE];
const SPAET = [SPAETER, SPAETER_ENDE];

test("Instanz B liest den Termin von Instanz A ohne Neustart", async () => {
  const { a, b } = await zweiInstanzen();
  const angelegt = await a.addCalendarEvent(termin(EIGENTUEMER, "T-A", FRUEH));
  const gelesen = (await b.getCalendar(EIGENTUEMER)).filter((ev) => ev.title === "T-A");
  assert.deepEqual(gelesen, [{ id: angelegt.id, title: "T-A", start: MORGEN, end: MORGEN_ENDE }]);
});

test("Instanz A loescht beim Speichern den Termin von Instanz B nicht", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  await b.addCalendarEvent(termin(EIGENTUEMER, "T-B", FRUEH));
  await a.save();
  await a.drainFlushes();
  assert.deepEqual(
    (await zeilen()).map((zeile) => zeile.title),
    ["T-B"],
  );
});

test("Instanz A ueberschreibt beim Speichern den Termin von Instanz B nicht", async () => {
  const { a, b, zeilen } = await zweiInstanzen();
  await a.addCalendarEvent(termin(EIGENTUEMER, "T-A", FRUEH));
  await b.addCalendarEvent(termin(EIGENTUEMER, "T-B", SPAET));
  await b.save();
  await b.drainFlushes();
  assert.deepEqual(
    (await zeilen()).map((zeile) => [zeile.title, zeile.starts_at, zeile.ends_at]),
    [
      ["T-A", MORGEN, MORGEN_ENDE],
      ["T-B", SPAETER, SPAETER_ENDE],
    ],
  );
});

test("Der Kalender ist nach Beginn sortiert", async () => {
  const { a, b } = await zweiInstanzen();
  await a.addCalendarEvent(termin(EIGENTUEMER, "T-spaet", SPAET));
  await b.addCalendarEvent(termin(EIGENTUEMER, "T-frueh", FRUEH));
  const titel = (await a.getCalendar(EIGENTUEMER))
    .filter((ev) => ev.title.startsWith("T-"))
    .map((ev) => ev.title);
  assert.deepEqual(titel, ["T-frueh", "T-spaet"]);
});

test("Ein Terminkonflikt zeigt den Termin von Instanz A in Instanz B", async () => {
  const { a, b } = await zweiInstanzen();
  const angelegt = await a.addCalendarEvent(termin(EIGENTUEMER, "T-A", FRUEH));
  const konflikt = await b.findConflict(
    EIGENTUEMER,
    "2030-03-01T10:30:00.000Z",
    "2030-03-01T10:45:00.000Z",
  );
  assert.equal(konflikt.id, angelegt.id);
  assert.equal(await b.findConflict(EIGENTUEMER, MORGEN_ENDE, SPAETER), null);
});

test("Ein Mandant liest keinen Termin eines anderen Mandanten", async () => {
  const { a, b } = await zweiInstanzen();
  await legeMandantAn(a, ANDERER);
  await a.addCalendarEvent(termin(ANDERER, "T-fremd", FRUEH));
  assert.deepEqual(
    (await b.getCalendar(EIGENTUEMER)).filter((ev) => ev.title === "T-fremd"),
    [],
  );
  assert.deepEqual(
    (await b.getCalendar(ANDERER)).map((ev) => ev.title),
    ["T-fremd"],
  );
  assert.equal(await b.findConflict(EIGENTUEMER, MORGEN, MORGEN_ENDE), null);
});

test("Ein Fehler der Kalendertabelle wirft und wird gemeldet", async () => {
  const { runner } = await makePgTestStore();
  const meldungen = [];
  const original = console.error;
  console.error = (...teile) => meldungen.push(teile.join(" "));
  const defekt = {
    withClient: (arbeit) =>
      runner.withClient((client) =>
        arbeit({
          ...client,
          query: (text, parameter) =>
            text.includes("calendar_event")
              ? Promise.reject(new Error("Tabelle weg"))
              : client.query(text, parameter),
        }),
      ),
  };
  const store = makePgStore(defekt);
  try {
    await assert.rejects(() => store.getCalendar(EIGENTUEMER), /Tabelle weg/);
    await assert.rejects(
      () => store.addCalendarEvent(termin(EIGENTUEMER, "T-x", MORGEN, MORGEN_ENDE)),
      /Tabelle weg/,
    );
  } finally {
    console.error = original;
  }
  assert.equal(
    meldungen.filter((text) => text.includes("[pg] kalender fehlgeschlagen: Tabelle weg")).length,
    2,
  );
});

const JETZT = "2030-03-01T12:00:00.000Z";

async function kalenderAmZustand(t, termine) {
  const store = {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [], usageEvents: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    exportTenantData: () => ({ calls: [], actionItems: [], notifications: [] }),
    exportTenantDataGelesen: () => ({ calls: [], actionItems: [], notifications: [] }),
    zaehleAnrufeSeit: () => 0,
    usageOf: () => ({ inputTokens: 0, outputTokens: 0, costCents: 0, calls: 0 }),
    tenantSubscription: () => ({
      planSlug: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      periodCreditRevoked: false,
    }),
    getCalendar: async () => termine,
  };
  const app = express();
  app.use(
    makeReadRoutes({
      store,
      config: withConfigNamespaces({ claudeModel: "claude-haiku-4-5", voiceEngine: "budget" }),
      audit: () => {},
      tenant: {
        requestTenant: () => EIGENTUEMER,
        requireTenant: () => EIGENTUEMER,
        tenantOwnsCall: () => true,
      },
    }),
  );
  const server = await new Promise((fertig) => {
    const s = app.listen(0, "127.0.0.1", () => fertig(s));
  });
  try {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(JETZT).getTime() });
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/state`);
    t.mock.timers.reset();
    return (await antwort.json()).calendar;
  } finally {
    t.mock.timers.reset();
    await new Promise((fertig) => server.close(fertig));
  }
}

test("Ein Termin, der genau jetzt endet, steht noch im anstehenden Kalender", async (t) => {
  const davor = { id: "davor", end: "2030-03-01T11:59:59.999Z" };
  const genau = { id: "genau", end: JETZT };
  const danach = { id: "danach", end: "2030-03-01T12:00:00.001Z" };
  assert.deepEqual(await kalenderAmZustand(t, [davor, genau, danach]), [genau, danach]);
});
