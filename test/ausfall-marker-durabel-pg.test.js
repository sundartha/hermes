// OUTBOUND-E3b (PM-23): der Entprell-/Zustandsmarker des Ausfall-Melders MUSS einen
// Prozess-Neustart ueberleben - auf plan:free ist JEDES Aufwachen ein Prozessstart, ein
// Marker im Speicher hiesse Alarm bei jedem Aufwachen. PGlite (Postgres-in-WASM, KEIN
// Netz, keine externe DB -> F.I.R.S.T. erfuellt), Muster
// test/plattform-nummer-bindung-pg.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { beurteileAusfall, OUTAGE_VERDICT } from "../src/telephony/outage-detection.js";
import * as ops from "../src/store/state-ops.js";
import { makePgTestStore } from "./pg-helpers.js";

const BUCKET = "not-placed:invite-403";
const SCHWELLEN = Object.freeze({
  windowMs: 3600000,
  minFailures: 3,
  minAttempts: 20,
  failSharePercent: 20,
  debounceMs: 21600000,
  retryMs: 900000,
});
const T0_ISO = "2026-08-27T16:45:00Z";
const T0_MS = Date.parse(T0_ISO);
const EINE_MINUTE_SPAETER_MS = Date.parse("2026-08-27T16:46:00Z");
const NACH_DEBOUNCE_MS = Date.parse("2026-08-27T22:45:01Z"); // T0 + 6h + 1s

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("N1: NEUSTART-ROUND-TRIP - claimen, speichern, Spiegel verwerfen, neu hydrieren, lesen", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS, sent: true, channels: ["mail"] });
  await store.save();

  const reopened = await reopen(db);
  const marker = ops.openOutageAlert(reopened.load(), BUCKET);
  assert.ok(marker, "Marker ueberlebt den Neustart");
  assert.equal(marker.firstSeenAt, new Date(T0_MS).toISOString());
  assert.ok(marker.reportedAt, "reportedAt ueberlebt byte-identisch");
  assert.equal(marker.closedAt, null);
});

test("N2: KEIN ZWEITER ALARM NACH DEM AUFWACHEN (die eigentliche PM-23-Aussage)", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS, sent: true, channels: ["mail"] });
  await store.save();

  const reopened = await reopen(db);
  const marker = ops.openOutageAlert(reopened.load(), BUCKET);
  const fenster = { fehler: 3, versuche: 3, erfolge: 0, tenants: 1 };
  const kurzDanach = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: EINE_MINUTE_SPAETER_MS });
  assert.equal(kurzDanach.urteil, OUTAGE_VERDICT.NONE, "Entprellung hat den Neustart ueberlebt");

  const nachEntprellfrist = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: NACH_DEBOUNCE_MS });
  assert.equal(nachEntprellfrist.urteil, OUTAGE_VERDICT.ALERT);
});

test("N3: NEGATIV-KONTROLLE der Mechanik - ohne save()/reopen() gibt es keinen Marker", async () => {
  const { store } = await makePgTestStore();
  const marker = ops.openOutageAlert(store.load(), BUCKET);
  assert.equal(marker, undefined, "kein Marker geschrieben -> nichts zu finden");
  const fenster = { fehler: 3, versuche: 3, erfolge: 0, tenants: 1 };
  const urteil = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: EINE_MINUTE_SPAETER_MS });
  assert.equal(urteil.urteil, OUTAGE_VERDICT.FIRST, "ohne Marker ist es K0, nicht K1/K2");
});

test("N4: Flush-Prune - leere keep-Liste raeumt die Tabelle (Parity zu deleteMissingPlatformNumberUse)", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.claimOutageAlert(state, { code: BUCKET, nowMs: T0_MS });
  await store.save();

  const vorher = (await db.query(`SELECT id FROM outage_alert`)).rows;
  assert.equal(vorher.length, 1);

  state.outageAlerts = [];
  await store.save();
  const nachher = (await db.query(`SELECT id FROM outage_alert`)).rows;
  assert.equal(nachher.length, 0, "leere keep-Liste raeumt die Tabelle");
});
