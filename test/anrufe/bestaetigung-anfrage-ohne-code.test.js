import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalCallRequest } from "../../src/call-confirmation.js";

const ZIEL = "+4917212345678";

const FALLE = [
  { name: "Argumente mit Code: der Code fehlt, der Rest bleibt", args: { objective: "Termin", confirmation_code: "ABC123" }, erwartet: { objective: "Termin", to: ZIEL } },
  { name: "Argumente ohne Code: der Rest bleibt", args: { objective: "Termin", language: "de-DE" }, erwartet: { objective: "Termin", language: "de-DE", to: ZIEL } },
  { name: "nur der Code: nur das Ziel bleibt", args: { confirmation_code: "ABC123" }, erwartet: { to: ZIEL } },
  { name: "Argumente null: nur das Ziel bleibt", args: null, erwartet: { to: ZIEL } },
  { name: "Argumente fehlen: nur das Ziel bleibt", args: undefined, erwartet: { to: ZIEL } },
  { name: "Argumente nennen ein anderes Ziel: das gewählte Ziel gilt", args: { to: "+49000", objective: "Termin" }, erwartet: { objective: "Termin", to: ZIEL } },
];

test("canonicalCallRequest: bindet nur die Argumente ohne den Code und das gewählte Ziel", () => {
  for (const fall of FALLE) {
    const kanonisch = canonicalCallRequest({ to: ZIEL, args: fall.args });
    assert.deepEqual(JSON.parse(kanonisch), fall.erwartet, fall.name);
  }
});

test("canonicalCallRequest: die übergebenen Argumente bleiben unverändert, auch der Code", () => {
  const args = { objective: "Termin", confirmation_code: "ABC123" };
  canonicalCallRequest({ to: ZIEL, args });
  assert.deepEqual(args, { objective: "Termin", confirmation_code: "ABC123" });
});
