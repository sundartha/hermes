import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { seedCall } from "../helpers.js";

const ALT = `alt-host:${randomUUID()}`;
const FREMDER = `fremd-host:${randomUUID()}`;
const LAUF = randomUUID();

test("Eintragung: unter dem JSON-Speicher wechselt ein aktiver Anruf nur beim erwarteten Besitzer, einmal und nur solange er aktiv ist", async () => {
  const speicher = await import("../../src/store.js");
  await speicher.oeffneSpeicher();
  const { eigene } = await speicher.besitzLage();
  const { calls } = speicher.load();
  calls.push(
    seedCall({ id: `call_json_alt_${LAUF}`, instanz: ALT }),
    seedCall({ id: `call_json_ohne_${LAUF}`, instanz: undefined }),
    seedCall({ id: `call_json_beendet_${LAUF}`, instanz: ALT, status: "completed" }),
  );
  const besitzerVon = (id) => calls.find((call) => call.id === id).instanz;
  assert.equal(await speicher.uebernimmAnruf({ callId: `call_json_alt_${LAUF}`, alt: FREMDER }), false);
  assert.equal(besitzerVon(`call_json_alt_${LAUF}`), ALT);
  assert.equal(await speicher.uebernimmAnruf({ callId: `call_json_alt_${LAUF}`, alt: ALT }), true);
  assert.equal(besitzerVon(`call_json_alt_${LAUF}`), eigene);
  assert.equal(await speicher.uebernimmAnruf({ callId: `call_json_alt_${LAUF}`, alt: ALT }), false);
  assert.equal(await speicher.uebernimmAnruf({ callId: `call_json_ohne_${LAUF}`, alt: ALT }), false);
  assert.equal(await speicher.uebernimmAnruf({ callId: `call_json_ohne_${LAUF}` }), true);
  assert.equal(besitzerVon(`call_json_ohne_${LAUF}`), eigene);
  assert.equal(await speicher.uebernimmAnruf({ callId: `call_json_beendet_${LAUF}`, alt: ALT }), false);
  assert.equal(besitzerVon(`call_json_beendet_${LAUF}`), ALT);
  assert.equal(await speicher.uebernimmAnruf({ callId: `call_json_unbekannt_${LAUF}`, alt: ALT }), false);
});
