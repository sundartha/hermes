import assert from "node:assert/strict";
import { test } from "node:test";

import { seedCall } from "../helpers.js";

const ALT = "alt-host:00000000-0000-4000-8000-000000000021";
const FREMDER = "fremd-host:00000000-0000-4000-8000-000000000022";

test("Eintragung: unter dem JSON-Speicher wechselt ein aktiver Anruf nur beim erwarteten Besitzer, einmal und nur solange er aktiv ist", async () => {
  const speicher = await import("../../src/store.js");
  await speicher.oeffneSpeicher();
  const { eigene } = await speicher.besitzLage();
  const { calls } = speicher.load();
  calls.push(
    seedCall({ id: "call_json_alt", instanz: ALT }),
    seedCall({ id: "call_json_ohne", instanz: undefined }),
    seedCall({ id: "call_json_beendet", instanz: ALT, status: "completed" }),
  );
  const besitzerVon = (id) => calls.find((call) => call.id === id).instanz;
  assert.equal(await speicher.uebernimmAnruf({ callId: "call_json_alt", alt: FREMDER }), false);
  assert.equal(besitzerVon("call_json_alt"), ALT);
  assert.equal(await speicher.uebernimmAnruf({ callId: "call_json_alt", alt: ALT }), true);
  assert.equal(besitzerVon("call_json_alt"), eigene);
  assert.equal(await speicher.uebernimmAnruf({ callId: "call_json_alt", alt: ALT }), false);
  assert.equal(await speicher.uebernimmAnruf({ callId: "call_json_ohne", alt: ALT }), false);
  assert.equal(await speicher.uebernimmAnruf({ callId: "call_json_ohne" }), true);
  assert.equal(besitzerVon("call_json_ohne"), eigene);
  assert.equal(await speicher.uebernimmAnruf({ callId: "call_json_beendet", alt: ALT }), false);
  assert.equal(besitzerVon("call_json_beendet"), ALT);
  assert.equal(await speicher.uebernimmAnruf({ callId: "call_json_unbekannt", alt: ALT }), false);
});
