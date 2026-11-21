import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "tenant_halten";
const SPERRE_NAMENSRAUM = 2667;
const SPERRE_FRIST = "5000";
const UNTERSUCHT = /^(BEGIN|COMMIT|ROLLBACK|SELECT 1|SELECT set_config\('lock_timeout'|SELECT pg_advisory_)/;

const protokoll = [];
const verhalten = { scheitert: () => false, haelt: null };
let verbindungen = 0;
let store = null;

function eintrag(text, parameter) {
  return parameter === undefined ? text : `${text} ${JSON.stringify(parameter)}`;
}

async function beobachtet(text, parameter, ausfuehren) {
  if (!UNTERSUCHT.test(text)) return ausfuehren();
  protokoll.push(`start ${eintrag(text, parameter)}`);
  if (verhalten.scheitert(text)) {
    protokoll.push(`fehler ${text}`);
    throw new Error(`fehler bei ${text}`);
  }
  if (verhalten.haelt && text === "SELECT 1") await verhalten.haelt();
  const ergebnis = await ausfuehren();
  protokoll.push(`ende ${text}`);
  return ergebnis;
}

async function datenbankAnlegen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://halten-attrappe.invalid/hermes",
    SESSION_SECRET: "halten-signierwert",
  });
  const anlegen = aufraeumenVormerken(() => store);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE halten_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO halten_app;
    SET ROLE halten_app;`);
  const huelle = {
    query: (text, parameter) => beobachtet(text, parameter, () => db.query(text, parameter)),
    exec: (text) => beobachtet(text, undefined, () => db.exec(text)),
    transaction: (arbeit) => db.transaction(arbeit),
  };
  poolAufPglite(huelle);
  const verbinden = pg.Pool.prototype.connect;
  pg.Pool.prototype.connect = function zaehlend() {
    verbindungen += 1;
    return verbinden.call(this);
  };
  return db;
}

const db = await datenbankAnlegen();
store = await import("../../src/store.js");
await store.oeffneSpeicher();

function zuruecksetzen() {
  protokoll.length = 0;
  verhalten.scheitert = () => false;
  verhalten.haelt = null;
  verbindungen = 0;
}

const SPERRE_SCHRITTE = [
  "start BEGIN",
  "ende BEGIN",
  `start SELECT set_config('lock_timeout', $1, true) ["${SPERRE_FRIST}"]`,
  "ende SELECT set_config('lock_timeout', $1, true)",
  `start SELECT pg_advisory_lock($1, hashtext($2)) [${SPERRE_NAMENSRAUM},"${MANDANT}"]`,
  "ende SELECT pg_advisory_lock($1, hashtext($2))",
  "start COMMIT",
  "ende COMMIT",
];
const FREIGABE_SCHRITTE = [
  `start SELECT pg_advisory_unlock($1, hashtext($2)) [${SPERRE_NAMENSRAUM},"${MANDANT}"]`,
  "ende SELECT pg_advisory_unlock($1, hashtext($2))",
];

test("mitAnrufSperre: nimmt die Sperre des Mandanten mit Frist, fuehrt die Arbeit aus, gibt die Sperre frei, eine Verbindung", async () => {
  zuruecksetzen();
  const ergebnis = await store.mitAnrufSperre(MANDANT, async () => {
    protokoll.push("arbeit");
    return "ergebnis";
  });
  assert.equal(ergebnis, "ergebnis");
  assert.deepEqual(protokoll, [...SPERRE_SCHRITTE, "arbeit", ...FREIGABE_SCHRITTE]);
  assert.equal(verbindungen, 1);
});

test("mitAnrufSperre: Abfragen der Arbeit laufen auf der gehaltenen Verbindung, auch verschachtelt, ohne weitere Verbindung", async () => {
  zuruecksetzen();
  await store.mitAnrufSperre(MANDANT, async () => {
    await store.pruefeVerbindung();
    await Promise.all([store.pruefeVerbindung(), store.pruefeVerbindung()]);
  });
  assert.equal(verbindungen, 1);
  assert.equal(protokoll.filter((zeile) => zeile === "ende SELECT 1").length, 3);
});

test("mitAnrufSperre: gleichzeitige Abfragen der Arbeit laufen nacheinander", async () => {
  zuruecksetzen();
  const tor = Promise.withResolvers();
  verhalten.haelt = () => tor.promise;
  await store.mitAnrufSperre(MANDANT, async () => {
    const beide = Promise.all([store.pruefeVerbindung(), store.pruefeVerbindung()]);
    await Promise.resolve();
    while (!protokoll.includes("start SELECT 1")) await Promise.resolve();
    for (let runde = 0; runde < 20; runde += 1) await Promise.resolve();
    assert.equal(protokoll.filter((zeile) => zeile === "start SELECT 1").length, 1, "die zweite wartet auf die erste");
    verhalten.haelt = null;
    tor.resolve();
    await beide;
  });
  const abfolge = protokoll.filter((zeile) => zeile.endsWith("SELECT 1"));
  assert.deepEqual(abfolge, ["start SELECT 1", "ende SELECT 1", "start SELECT 1", "ende SELECT 1"]);
});

test("mitAnrufSperre: Arbeit, die erst nach der Freigabe anlaeuft, nimmt wieder eine eigene Verbindung", async () => {
  zuruecksetzen();
  const tor = Promise.withResolvers();
  let spaeter;
  await store.mitAnrufSperre(MANDANT, async () => {
    spaeter = tor.promise.then(() => store.pruefeVerbindung());
  });
  assert.equal(verbindungen, 1);
  tor.resolve();
  await spaeter;
  assert.equal(verbindungen, 2);
});

test("mitAnrufSperre: wirft die Arbeit, kommt der Fehler an und die Sperre ist freigegeben, der naechste Aufruf laeuft", async () => {
  zuruecksetzen();
  await assert.rejects(
    store.mitAnrufSperre(MANDANT, async () => {
      throw new Error("arbeit kaputt");
    }),
    /arbeit kaputt/,
  );
  assert.deepEqual(protokoll.slice(-2), FREIGABE_SCHRITTE);
  assert.equal(await store.mitAnrufSperre(MANDANT, async () => "danach"), "danach");
});

test("mitAnrufSperre: ist die Sperre nicht zu haben, wird zurueckgerollt, alles aufgehoben, geworfen und die Arbeit nicht ausgefuehrt", async () => {
  zuruecksetzen();
  verhalten.scheitert = (text) => text.startsWith("SELECT pg_advisory_lock");
  let gearbeitet = false;
  await assert.rejects(
    store.mitAnrufSperre(MANDANT, async () => {
      gearbeitet = true;
    }),
    /fehler bei SELECT pg_advisory_lock/,
  );
  assert.equal(gearbeitet, false);
  assert.deepEqual(
    protokoll.filter((zeile) => /ROLLBACK|unlock_all/.test(zeile)),
    ["start ROLLBACK", "ende ROLLBACK", "start SELECT pg_advisory_unlock_all()", "ende SELECT pg_advisory_unlock_all()"],
  );
  verhalten.scheitert = () => false;
  assert.equal(await store.mitAnrufSperre(MANDANT, async () => "danach"), "danach");
});

test("mitAnrufSperre: scheitert das Freigeben, hebt unlock_all alles auf, der Fehler wird gemeldet und das Ergebnis der Arbeit bleibt", async (t) => {
  zuruecksetzen();
  const meldungen = [];
  t.mock.method(console, "error", (...teile) => meldungen.push(teile.map(String).join(" ")));
  verhalten.scheitert = (text) => text.startsWith("SELECT pg_advisory_unlock(");
  assert.equal(await store.mitAnrufSperre(MANDANT, async () => "bleibt"), "bleibt");
  assert.deepEqual(protokoll.slice(-3), [
    "fehler SELECT pg_advisory_unlock($1, hashtext($2))",
    "start SELECT pg_advisory_unlock_all()",
    "ende SELECT pg_advisory_unlock_all()",
  ]);
  assert.deepEqual(meldungen, [
    "[anruf-sperre] Sperre nicht freigegeben, Verbindungssperren werden aufgehoben: fehler bei SELECT pg_advisory_unlock($1, hashtext($2))",
  ]);
});

test("mitAnrufSperre: gescheitertes unlock_all wird gemeldet und wirft nicht", async (t) => {
  zuruecksetzen();
  const meldungen = [];
  t.mock.method(console, "error", (...teile) => meldungen.push(teile.map(String).join(" ")));
  verhalten.scheitert = (text) => /^SELECT pg_advisory_unlock/.test(text);
  assert.equal(await store.mitAnrufSperre(MANDANT, async () => "bleibt"), "bleibt");
  assert.equal(meldungen.length, 2);
  assert.match(meldungen[1], /^\[anruf-sperre\] Sperren der Verbindung nicht aufgehoben, enden mit der Verbindung: fehler bei SELECT pg_advisory_unlock_all\(\)$/);
  verhalten.scheitert = () => false;
  await db.query("SELECT pg_advisory_unlock_all()");
});

test("die Verbindung ist nach der Sperre wieder frei und der Pool nimmt neue Arbeit", async () => {
  zuruecksetzen();
  await store.mitAnrufSperre(MANDANT, async () => {});
  await store.pruefeVerbindung();
  assert.equal(verbindungen, 2);
  const { rows } = await db.query("SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory'");
  assert.equal(rows[0].anzahl, 0);
});
