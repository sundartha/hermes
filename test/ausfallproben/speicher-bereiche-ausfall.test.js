import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, makePgTestStore } from "../pg-helpers.js";

const BUCKET = "not-placed:invite-403";
const NOW_MS = Date.parse("2026-08-27T16:45:00Z");
const NOW_ISO = new Date(NOW_MS).toISOString();
const ZEILEN_SQL = `SELECT code, last_seen_at, last_attempt_at, reported_at, delivered_channels, closed_at
  FROM outage_alert ORDER BY first_seen_at, code`;

const { store: echterSpeicher, db, runner } = await makePgTestStore();
const { ausfall } = speicherBereiche(echterSpeicher);

async function marker(code, felder = {}) {
  await db.query(
    `INSERT INTO outage_alert (id, code, first_seen_at, last_seen_at, last_attempt_at, closed_at)
     VALUES ($1, $2, $3, $3, $4, $5)`,
    [`otg_${code}`, code, "2026-08-27T16:00:00Z", felder.lastAttemptAt ?? null, felder.closedAt ?? null],
  );
}

async function leeren() {
  await db.query("DELETE FROM outage_alert");
}

async function zeilen() {
  return (await db.query(ZEILEN_SQL)).rows;
}

const zeit = (wert) => (wert ? wert.toISOString() : null);

async function kaputterAusfall() {
  const zustand = { kaputt: false };
  const kaputtesRunner = {
    withClient: (fn) =>
      runner.withClient((client) =>
        fn({
          query: async (text, parameter) => {
            if (zustand.kaputt) throw new Error("kaputt");
            return client.query(text, parameter);
          },
          exec: client.exec,
        }),
      ),
  };
  const speicher = makePgStoreMitSperre(kaputtesRunner);
  await speicher.init();
  return { zustand, ausfall: speicherBereiche(speicher).ausfall };
}

test("ausfall: Bereichsfunktionen sind Promises und schreiben erst beim Aufruf in die Tabelle, ein Lesefehler wirft", async () => {
  await leeren();
  assert.deepEqual(await zeilen(), []);
  const antwort = ausfall.notizClaimen({ code: BUCKET, nowMs: NOW_MS });
  assert.ok(antwort instanceof Promise);
  await antwort;
  assert.equal((await zeilen())[0].code, BUCKET);
  assert.ok(ausfall.sendeplatzReserviert({ bucket: BUCKET, nowMs: NOW_MS }) instanceof Promise);
  const { zustand, ausfall: kaputt } = await kaputterAusfall();
  zustand.kaputt = true;
  await assert.rejects(kaputt.offeneAusfallZustand(), /kaputt/);
});

test("ausfall: Sendeplatz ist nur beim gleichen Marker und gleichen Versandzeitpunkt reserviert", async () => {
  await leeren();
  await marker(BUCKET, { lastAttemptAt: NOW_ISO });
  assert.equal(await ausfall.sendeplatzReserviert({ bucket: BUCKET, nowMs: NOW_MS }), true);
  assert.equal(await ausfall.sendeplatzReserviert({ bucket: BUCKET, nowMs: NOW_MS + 1000 }), false);
  assert.equal(await ausfall.sendeplatzReserviert({ bucket: "anderer", nowMs: NOW_MS }), false);
});

test("ausfall: Reservieren aendert die Tabelle nur, wenn der Platz frei ist", async () => {
  await leeren();
  assert.equal(await ausfall.sendeplatzReservieren({ bucket: BUCKET, nowMs: NOW_MS, frei: () => false }), false);
  assert.deepEqual(await zeilen(), []);
  assert.equal(await ausfall.sendeplatzReservieren({ bucket: BUCKET, nowMs: NOW_MS, frei: (m) => m === undefined }), true);
  const [zeile, ...rest] = await zeilen();
  assert.equal(rest.length, 0);
  assert.equal(zeit(zeile.last_attempt_at), NOW_ISO);
  assert.equal(zeile.delivered_channels, null);
});

test("ausfall: Urteil sieht Anrufe und Marker und reserviert nur bei Alarm", async () => {
  await leeren();
  await marker(BUCKET);
  const gesehen = [];
  const beurteile = (eingabe) => {
    gesehen.push(eingabe);
    return { urteil: "x" };
  };
  assert.deepEqual(await ausfall.urteilClaimen({ bucket: BUCKET, nowMs: NOW_MS, beurteile, istAlarm: () => false }), { urteil: "x" });
  assert.deepEqual(gesehen[0].calls, []);
  assert.equal(gesehen[0].marker.id, `otg_${BUCKET}`);
  assert.equal(gesehen[0].marker.code, BUCKET);
  assert.equal((await zeilen())[0].last_attempt_at, null);
  await ausfall.urteilClaimen({ bucket: BUCKET, nowMs: NOW_MS, beurteile, istAlarm: () => true });
  assert.equal(zeit((await zeilen())[0].last_attempt_at), NOW_ISO);
});

test("ausfall: Versandmarkierung, Notiz und Schliessen schreiben die Marker", async () => {
  await leeren();
  await marker(BUCKET);
  await marker("zu");
  const zeile = async (code) => (await zeilen()).find((eintrag) => eintrag.code === code);
  await ausfall.alarmVersendet({ code: BUCKET, nowMs: NOW_MS, channels: ["mail"] });
  assert.equal((await zeile(BUCKET)).delivered_channels, "mail");
  assert.equal(zeit((await zeile(BUCKET)).last_attempt_at), NOW_ISO);
  await ausfall.notizClaimen({ code: "zu", nowMs: NOW_MS });
  assert.equal((await zeile("zu")).last_attempt_at, null);
  assert.equal(zeit((await zeile("zu")).last_seen_at), NOW_ISO);
  await ausfall.markerSchliessen({ code: "zu", nowMs: NOW_MS });
  assert.equal(zeit((await zeile("zu")).closed_at), NOW_ISO);
  assert.equal((await zeile(BUCKET)).closed_at, null);
});

test("ausfall: Hold-Eskalation und Selbsttest werden je Platz genau einmal beansprucht", async () => {
  await leeren();
  assert.equal(await ausfall.holdEskalationClaimen({ bucket: "hold:x", nowMs: NOW_MS }), true);
  assert.equal(await ausfall.holdEskalationClaimen({ bucket: "hold:x", nowMs: NOW_MS }), false);
  assert.equal((await zeilen()).length, 1);
  assert.equal(zeit((await zeilen())[0].last_attempt_at), NOW_ISO);
  assert.equal(await ausfall.selbsttestClaimen({ bucket: "st", nowMs: NOW_MS, faellig: () => false }), false);
  assert.equal((await zeilen()).length, 1);
  assert.equal(await ausfall.selbsttestClaimen({ bucket: "st", nowMs: NOW_MS, faellig: (m) => m === undefined }), true);
  const selbsttest = (await zeilen()).find((eintrag) => eintrag.code === "st");
  assert.equal(zeit(selbsttest.last_attempt_at), NOW_ISO);
});

test("ausfall: offener Zustand enthaelt nur offene Marker, Hold-Kandidaten kommen aus dem Zustand", async () => {
  await leeren();
  await marker("a");
  await marker("b", { closedAt: NOW_ISO });
  const offen = await ausfall.offeneAusfallZustand();
  assert.deepEqual(offen.calls, []);
  assert.deepEqual(offen.outageAlerts.map((m) => m.code), ["a"]);
  assert.deepEqual(await ausfall.holdKandidaten({ nowMs: NOW_MS, maxAgeMs: 1 }), []);
});

test("ausfall: zwei gleichzeitige Reservierungen im selben Fenster ergeben genau einen Platz", async () => {
  await leeren();
  await marker(BUCKET);
  const frei = (offen) => offen.lastAttemptAt === null;
  const eingabe = { bucket: BUCKET, nowMs: NOW_MS, frei };
  const ergebnisse = await Promise.all([ausfall.sendeplatzReservieren(eingabe), ausfall.sendeplatzReservieren(eingabe)]);
  assert.deepEqual(ergebnisse, [true, false]);
  assert.equal(zeit((await zeilen())[0].last_attempt_at), NOW_ISO);
});

test("ausfall: Ist die Datenbank nicht erreichbar, lehnt jede schreibende Bereichsfunktion ab und es entsteht keine Zeile", async (t) => {
  await leeren();
  t.mock.method(console, "error", () => {});
  const { zustand, ausfall: kaputt } = await kaputterAusfall();
  zustand.kaputt = true;
  await assert.rejects(kaputt.alarmVersendet({ code: BUCKET, nowMs: NOW_MS, channels: [] }), /kaputt/);
  await assert.rejects(kaputt.sendeplatzReservieren({ bucket: BUCKET, nowMs: NOW_MS, frei: () => true }), /kaputt/);
  assert.deepEqual(await zeilen(), []);
});

test("ausfall: Schliessen ohne offenen Marker aendert nichts", async () => {
  await leeren();
  await marker(BUCKET, { closedAt: NOW_ISO });
  await ausfall.markerSchliessen({ code: BUCKET, nowMs: NOW_MS + 5000 });
  assert.equal(zeit((await zeilen())[0].closed_at), NOW_ISO);
});
