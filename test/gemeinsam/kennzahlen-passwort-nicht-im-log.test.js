import assert from "node:assert/strict";
import { test } from "node:test";

import { KENNZAHLEN_PASSWORT } from "./erfundene-geheimnisse.js";
import { schreibeNachLauf, starteMitKennzahlenPasswort } from "./kennzahlen-passwort-hilfen.js";

await starteMitKennzahlenPasswort(KENNZAHLEN_PASSWORT);

test("S28: Das Passwort der Kennzahlen-Adresse steht in keiner Logzeile", async () => {
  const adresse = `postgres://kennzahlen_leser:${KENNZAHLEN_PASSWORT}@kennzahlen-attrappe.invalid/hermes`;
  const ausgabe = await schreibeNachLauf([`connect ECONNREFUSED ${adresse}`, `Passwort ${KENNZAHLEN_PASSWORT}`]);
  assert.ok(ausgabe.includes("kennzahlen_leser"));
  assert.equal(ausgabe.includes(KENNZAHLEN_PASSWORT), false);
});

test("Eine Kennzahlen-Adresse ohne Passwort lässt Logzeilen unverändert", async () => {
  const { config } = await import("../../src/config.js");
  config.store.kennzahlenDatabaseUrl = "postgres://kennzahlen_leser@kennzahlen-attrappe.invalid/hermes";
  const ausgabe = await schreibeNachLauf(["Anrufe heute 12 ende"]);
  assert.equal(ausgabe, "Anrufe heute 12 ende\n");
});
