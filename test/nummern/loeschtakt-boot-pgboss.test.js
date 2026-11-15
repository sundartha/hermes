import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, OWNER_TEST_NUMBER, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { oeffneSpeicherAn } from "../gemeinsam/speicher-oeffnen.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

const EXIT_AUS = new Error("process.exit aufgerufen");

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://loeschtakt-boot-attrappe.invalid/hermes",
  SESSION_SECRET: "loeschtakt-boot-signierwert",
  QUEUE_BACKEND: "pgboss",
  WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "500",
});

let store = null;
const db = await aufraeumenVormerken(() => store)(await vorlage("leer", async () => {}, []));
await db.exec(`CREATE ROLE loeschtakt_boot_app NOSUPERUSER NOBYPASSRLS;
  GRANT CREATE, USAGE ON SCHEMA public TO loeschtakt_boot_app;
  GRANT CREATE ON DATABASE postgres TO loeschtakt_boot_app;
  SET ROLE loeschtakt_boot_app;`);
poolAufPglite(db);
store = await import("../../src/store.js").then(oeffneSpeicherAn);
{
  const zustand = store.load();
  zustand.numbers.push({ id: "num_loeschtakt_boot", ...OWNER_TEST_NUMBER, tenantId: zustand.tenants[0].id, status: "active", providerNumberId: null });
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

test("Loeschtakt-Boot-1: pgboss mit 500 ms endet mit Exit 1, nennt ganze Minuten und startet weder Warteschlange noch Loeschtakt", async () => {
  const meldungen = [];
  const fehler = mock.method(console, "error", (...teile) => meldungen.push(teile.map(String).join(" ")));
  const protokoll = mock.method(console, "log", (...teile) => meldungen.push(teile.map(String).join(" ")));
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
  } finally {
    ende.mock.restore();
    protokoll.mock.restore();
    fehler.mock.restore();
  }
  assert.ok(meldungen.some((zeile) => /WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS=500 .*ganze Minuten/.test(zeile)), meldungen.join("\n"));
  assert.equal(gestartet.length, 0);
  assert.equal(meldungen.filter((zeile) => zeile.includes("loeschtakt_ms=")).length, 0);
});
