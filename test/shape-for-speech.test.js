import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

let shapeForSpeech;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }] }),
  );
  await import("../src/config.js");
  ({ shapeForSpeech } = await import("../src/speech-shape.js"));
});

const CASES = [
  ["Guten   Tag,\n\nwie geht es Ihnen?", "Guten Tag, wie geht es Ihnen?"],
  ["Der Termin ist **fest** gebucht.", "Der Termin ist fest gebucht."],
  ["_Wichtig_: `code` und # Ueberschrift.", "Wichtig: code und Ueberschrift."],
  ["- Freitag 14 Uhr\n- Samstag 10 Uhr", "Freitag 14 Uhr Samstag 10 Uhr."],
  ["Alles klar - ich buche den Termin.", "Alles klar, ich buche den Termin."],
  ["Ich melde mich morgen", "Ich melde mich morgen."],
  ["Passt das fuer Sie?", "Passt das fuer Sie?"],
  ["Vielen Dank!", "Vielen Dank!"],
  ["Ich schicke die E-Mail an den Kuendigungs-Service.", "Ich schicke die E-Mail an den Kuendigungs-Service."],
  ["- **Freitag** um 14 Uhr - das passt gut", "Freitag um 14 Uhr, das passt gut."],
  ["  Alles klar.  ", "Alles klar."],
  ["Ich buche den Termin - ", "Ich buche den Termin."],
  ["Alles klar,", "Alles klar."],
];

test("I8: shapeForSpeech normalisiert Input/Output-Paare deterministisch", () => {
  for (const [input, expected] of CASES) {
    assert.equal(shapeForSpeech(input), expected, `Input: ${JSON.stringify(input)}`);
  }
});

test("I8-Grenzfaelle: leer/undefined/null bleiben falsy (Fallback-Entscheidung unberuehrt)", () => {
  assert.equal(shapeForSpeech(""), "");
  assert.equal(shapeForSpeech(undefined), undefined);
  assert.equal(shapeForSpeech(null), null);
});

test("I8-Idempotenz: bereits sauberer Satz bleibt byte-identisch", () => {
  const clean = "Alles klar, ich habe den Termin am Donnerstag um 17 Uhr gebucht.";
  assert.equal(shapeForSpeech(clean), clean);
  assert.equal(shapeForSpeech(shapeForSpeech(clean)), clean);
});
