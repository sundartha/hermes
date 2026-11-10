import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "../helpers.js";

const MANDANTEN = [
  { id: "t-vorname-mehrere", ownerName: "Anna Maria Berg" },
  { id: "t-vorname-leerraum", ownerName: "  \tAnna Berg" },
  { id: "t-vorname-ein-wort", ownerName: "Mara" },
  { id: "t-vorname-nur-leerraum", ownerName: "   " },
  { id: "t-vorname-keine-zeichenkette", ownerName: 42 },
  { id: "t-vorname-ohne-namen" },
  { id: "t-vorname-eigener", ownerName: "Anna Berg", firstName: "Annie" },
];

let store;
before(async () => {
  const tenants = MANDANTEN.map((tenant) => ({ status: "active", ...tenant }));
  process.env.DATA_DIR = tempDataDir(seedState({ tenants }));
  await import("../../src/config.js");
  store = await import("../../src/store.js");
});

test("Vorname ist das erste Wort des Inhabernamens", () => {
  assert.equal(store.tenantContext("t-vorname-mehrere").firstName, "Anna");
});

test("Vorname ignoriert führende Leerzeichen und Tabs im Inhabernamen", () => {
  assert.equal(store.tenantContext("t-vorname-leerraum").firstName, "Anna");
});

test("Vorname bleibt ganz, wenn der Inhabername nur ein Wort hat", () => {
  assert.equal(store.tenantContext("t-vorname-ein-wort").firstName, "Mara");
});

test("Vorname ist leer, wenn der Inhabername nur aus Leerzeichen besteht", () => {
  assert.equal(store.tenantContext("t-vorname-nur-leerraum").firstName, "");
});

test("Vorname ist leer, wenn der Inhabername keine Zeichenkette ist", () => {
  assert.equal(store.tenantContext("t-vorname-keine-zeichenkette").firstName, "");
});

test("Vorname ist leer, wenn der Mandant keinen Namen hat", () => {
  assert.equal(store.tenantContext("t-vorname-ohne-namen").firstName, "");
});

test("Vorname des Mandanten gewinnt vor dem Inhabernamen", () => {
  assert.equal(store.tenantContext("t-vorname-eigener").firstName, "Annie");
});
