import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { BASE_ENV, OWNER_TEST_NUMBER, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { oeffneSpeicherAn } from "../gemeinsam/speicher-oeffnen.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const EXIT_AUS = new Error("process.exit aufgerufen");
const ZEITPLAN_EINTRAG = /INSERT INTO \S+\.schedule/;

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://zeitplan-boot-attrappe.invalid/hermes",
  SESSION_SECRET: "zeitplan-boot-signierwert",
  QUEUE_BACKEND: "pgboss",
});

let store = null;
const db = await aufraeumenVormerken(() => store)(await vorlage("leer", async () => {}, []));
await db.exec(`CREATE ROLE zeitplan_boot_app NOSUPERUSER NOBYPASSRLS;
  GRANT CREATE, USAGE ON SCHEMA public TO zeitplan_boot_app;
  GRANT CREATE ON DATABASE postgres TO zeitplan_boot_app;
  SET ROLE zeitplan_boot_app;`);
poolAufPglite(db);
const PgPool = pg.Pool;
pg.Pool = class ZeitplanAbgelehntPool extends PgPool {
  async query(text, parameter) {
    if (ZEITPLAN_EINTRAG.test(String(text))) throw new Error("Zeitplan abgelehnt");
    const client = await this.connect();
    try {
      return await client.query(text, parameter);
    } finally {
      client.release();
    }
  }
};
store = await import("../../src/store.js").then(oeffneSpeicherAn);
{
  const zustand = store.load();
  zustand.numbers.push({ id: "num_zeitplan_boot", ...OWNER_TEST_NUMBER, tenantId: zustand.tenants[0].id, status: "active", providerNumberId: null });
  store.save();
  await store.drainFlushes();
}

const { PgBoss } = await import("pg-boss");
const gestartet = [];
const echterStart = PgBoss.prototype.start;
PgBoss.prototype.start = async function startMerken(...argumente) {
  gestartet.push(this);
  return echterStart.apply(this, argumente);
};
after(async () => {
  PgBoss.prototype.start = echterStart;
  await Promise.all(gestartet.map((instanz) => instanz.stop({ graceful: false, close: true })));
});

test("Zeitplan-Boot-1: scheitert die Anmeldung der Web-Login-Zeitplaene nach startQueue, endet der Boot mit Exit 1 und fail-closed", async () => {
  const fehler = mock.method(console, "error", () => {});
  const ende = mock.method(process, "exit", () => {
    throw EXIT_AUS;
  });
  try {
    const abbruch = await serverImportieren().then(
      (server) => {
        server.closeAllConnections();
        server.close();
        return null;
      },
      (fehlerBeimStart) => fehlerBeimStart,
    );
    assert.equal(abbruch, EXIT_AUS);
    assert.deepEqual(ende.mock.calls.map((aufruf) => aufruf.arguments), [[1]]);
    assert.ok(fehler.mock.calls.some((aufruf) => /Web-Login-Zeitpläne nicht anmeldbar - fail-closed, kein Start: Zeitplan abgelehnt/.test(String(aufruf.arguments[0]))));
  } finally {
    ende.mock.restore();
    fehler.mock.restore();
  }
});
