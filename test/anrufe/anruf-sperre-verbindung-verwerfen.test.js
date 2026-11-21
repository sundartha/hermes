import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";

const MANDANT = "tenant_verwerfen";
const freigaben = [];
const verhalten = { scheitert: () => false };
let store = null;

async function datenbankAnlegen() {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://verwerfen-attrappe.invalid/hermes",
    SESSION_SECRET: "verwerfen-signierwert",
  });
  const anlegen = aufraeumenVormerken(() => store);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE verwerfen_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO verwerfen_app;
    SET ROLE verwerfen_app;`);
  const huelle = {
    query: async (text, parameter) => {
      if (verhalten.scheitert(text)) throw new Error(`fehler bei ${text}`);
      return db.query(text, parameter);
    },
    exec: (text) => db.exec(text),
    transaction: (arbeit) => db.transaction(arbeit),
  };
  poolAufPglite(huelle);
  const verbinden = pg.Pool.prototype.connect;
  pg.Pool.prototype.connect = async function beobachtend() {
    const client = await verbinden.call(this);
    const freigeben = client.release;
    client.release = (fehler) => {
      freigaben.push(fehler);
      return freigeben();
    };
    return client;
  };
  return db;
}

await datenbankAnlegen();
store = await import("../../src/store.js");
await store.oeffneSpeicher();

function zuruecksetzen() {
  freigaben.length = 0;
  verhalten.scheitert = () => false;
}

test("scheitern Aufheben und Aufheben-aller, wird die Verbindung verworfen und das Ergebnis bleibt", async (t) => {
  zuruecksetzen();
  t.mock.method(console, "error", () => {});
  verhalten.scheitert = (text) => /pg_advisory_unlock/.test(text);
  assert.equal(await store.mitAnrufSperre(MANDANT, async () => "bleibt"), "bleibt");
  assert.equal(freigaben.length, 1);
  assert.match(freigaben[0].message, /pg_advisory_unlock_all/);
  zuruecksetzen();
  assert.equal(await store.mitAnrufSperre(MANDANT, async () => "danach"), "danach");
});

test("gelingt das Aufheben erst ueber unlock_all, geht die Verbindung in den Pool zurueck", async (t) => {
  zuruecksetzen();
  t.mock.method(console, "error", () => {});
  verhalten.scheitert = (text) => /^SELECT pg_advisory_unlock\(/.test(text);
  assert.equal(await store.mitAnrufSperre(MANDANT, async () => "bleibt"), "bleibt");
  assert.deepEqual(freigaben, [undefined]);
});

test("gelingt das Aufheben, geht die Verbindung in den Pool zurueck", async () => {
  zuruecksetzen();
  await store.mitAnrufSperre(MANDANT, async () => "ok");
  assert.deepEqual(freigaben, [undefined]);
});

test("der Fehler der Arbeit bleibt, auch wenn die Verbindung verworfen wird", async (t) => {
  zuruecksetzen();
  t.mock.method(console, "error", () => {});
  verhalten.scheitert = (text) => /pg_advisory_unlock/.test(text);
  await assert.rejects(
    store.mitAnrufSperre(MANDANT, async () => {
      throw new Error("arbeit kaputt");
    }),
    /arbeit kaputt/,
  );
  assert.match(freigaben[0].message, /pg_advisory_unlock_all/);
});
