// I12 (call-quality Impl-1): assistantContextEnabled ist jetzt DEFAULT AN (Praezedenz
// mcpUiEnabled) - ohne gesetzte Env-Var ist der Kontext-Kanal aktiv. Der Abschalt-Pfad
// ("false" -> aus, byte-identisch) ist NICHT hier gepinnt, sondern laeuft ueber die
// Spawn-Suite: BASE_ENV (test/helpers.js) pinnt ASSISTANT_CONTEXT_ENABLED="false"
// weiterhin explizit (Lehre test-base-env-drift), und HC6/HC9 in
// assistant-context-http.test.js beweisen das Flag-aus-Verhalten end-to-end.
//
// Eigene Datei: config ist ein Import-Singleton - der Default (unset Env) und ein
// gesetzter Wert lassen sich nicht im selben Prozess beobachten. NODE_ENV=test (npm
// test) verhindert den dotenv-Load, delete raeumt einen etwaigen Shell-Leak weg.
import { test, before } from "node:test";
import assert from "node:assert/strict";

let config;
before(async () => {
  delete process.env.ASSISTANT_CONTEXT_ENABLED;
  ({ config } = await import("../src/config.js"));
});

test("I12: assistantContextEnabled ohne Env-Var -> true (Produkt-Default an)", () => {
  assert.equal(config.assistantContextEnabled, true);
});
