import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, OWNER_TEST_NUMBER, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { oeffneSpeicherAn } from "../gemeinsam/speicher-oeffnen.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://loeschtakt-memory-attrappe.invalid/hermes",
  SESSION_SECRET: "loeschtakt-memory-signierwert",
  QUEUE_BACKEND: "memory",
  WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "500",
});

let store = null;
const db = await aufraeumenVormerken(() => store)(await vorlage("leer", async () => {}, []));
await db.exec(`CREATE ROLE loeschtakt_memory_app NOSUPERUSER NOBYPASSRLS;
  GRANT CREATE, USAGE ON SCHEMA public TO loeschtakt_memory_app;
  GRANT CREATE ON DATABASE postgres TO loeschtakt_memory_app;
  SET ROLE loeschtakt_memory_app;`);
poolAufPglite(db);
store = await import("../../src/store.js").then(oeffneSpeicherAn);
{
  const zustand = store.load();
  zustand.numbers.push({ id: "num_loeschtakt_memory", ...OWNER_TEST_NUMBER, tenantId: zustand.tenants[0].id, status: "active", providerNumberId: null });
  store.save();
  await store.drainFlushes();
}

test("Loeschtakt-Boot-2: memory mit 500 ms startet und loescht im Takt von 500 ms", async () => {
  const meldungen = [];
  const protokoll = mock.method(console, "log", (...teile) => meldungen.push(teile.map(String).join(" ")));
  const ende = mock.method(process, "exit", () => {
    throw new Error("process.exit aufgerufen");
  });
  let server = null;
  try {
    server = await serverImportieren();
  } finally {
    protokoll.mock.restore();
    ende.mock.restore();
  }
  after(() => {
    server.closeAllConnections();
    server.close();
  });
  assert.equal(ende.mock.calls.length, 0);
  assert.ok(meldungen.includes("[webhook-zustellung] loeschtakt_ms=500 ablage=speicher"), meldungen.join("\n"));
});
