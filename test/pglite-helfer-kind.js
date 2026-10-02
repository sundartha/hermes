import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";
import { neuePglite } from "./pglite-helfer.js";

function laufenderSpeichervorgang() {
  test("Speichervorgang laeuft bei Testende", async () => {
    const { store } = await makePgTestStore();
    store.updateSettings(BOOTSTRAP_TENANT_ID, {});
  });
}

function laufendeAbfrageOhneSpeicher() {
  test("Abfrage laeuft bei Testende", async () => {
    const db = await neuePglite();
    await db.exec("CREATE TABLE probe (wert int)");
    db.query("INSERT INTO probe VALUES (1)");
  });
}

function verlorenerHaken() {
  let gehalten = null;
  test("Test 1 legt ein Versprechen an", () => {
    gehalten = Promise.resolve();
  });
  test("Test 2 wartet darauf und legt danach eine Datenbank an", async () => {
    await gehalten;
    const { db } = await makePgTestStore();
    const { rows } = await db.query("SELECT count(*)::int AS anzahl FROM tenant");
    assert.ok(rows[0].anzahl > 0);
  });
}

const FAELLE = new Map([
  ["a", laufenderSpeichervorgang],
  ["b", laufendeAbfrageOhneSpeicher],
  ["c", verlorenerHaken],
]);

const fall = FAELLE.get(process.argv[2]);
assert.ok(fall, `unbekannter Fall: ${process.argv[2]}`);
fall();
