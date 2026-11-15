import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, OWNER_TEST_NUMBER, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { oeffneSpeicherAn } from "../gemeinsam/speicher-oeffnen.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";

const EXIT_AUS = new Error("process.exit aufgerufen");

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://zeitplan-boot-attrappe.invalid/hermes",
});

let store = null;
const db = await aufraeumenVormerken(() => store)(await vorlage("leer", async () => {}, []));
await db.exec(`CREATE ROLE zeitplan_boot_app NOSUPERUSER NOBYPASSRLS;
  GRANT CREATE, USAGE ON SCHEMA public TO zeitplan_boot_app;
  SET ROLE zeitplan_boot_app;`);
poolAufPglite(db);
store = await import("../../src/store.js").then(oeffneSpeicherAn);
{
  const zustand = store.load();
  zustand.numbers.push({ id: "num_zeitplan_boot", ...OWNER_TEST_NUMBER, tenantId: zustand.tenants[0].id, status: "active", providerNumberId: null });
  store.save();
  await store.drainFlushes();
}
const { config } = await import("../../src/config.js");
const { bootServer } = await import("../../src/boot.js");

function abhaengigkeiten(ablauf, zeitplaeneAnmelden) {
  return {
    config,
    store,
    provisioning: {
      startQueue: async () => {
        ablauf.push("startQueue");
      },
    },
    durableAudit: () => {},
    zeitplaeneAnmelden,
  };
}

test("Zeitplan-Boot-1: scheitert die Anmeldung der Web-Login-Zeitplaene nach startQueue, endet der Boot mit Exit 1 und fail-closed", async () => {
  const ablauf = [];
  const fehler = mock.method(console, "error", () => {});
  const ende = mock.method(process, "exit", () => {
    throw EXIT_AUS;
  });
  try {
    const abbruch = await bootServer(
      abhaengigkeiten(ablauf, async () => {
        ablauf.push("anmelden");
        throw new Error("Zeitplan abgelehnt");
      }),
    ).catch((f) => f);
    assert.equal(abbruch, EXIT_AUS);
    assert.deepEqual(ende.mock.calls.map((aufruf) => aufruf.arguments), [[1]]);
    assert.deepEqual(ablauf, ["startQueue", "anmelden"]);
    assert.ok(fehler.mock.calls.some((aufruf) => /Web-Login-Zeitpläne nicht anmeldbar - fail-closed, kein Start: Zeitplan abgelehnt/.test(String(aufruf.arguments[0]))));
  } finally {
    ende.mock.restore();
    fehler.mock.restore();
  }
});
