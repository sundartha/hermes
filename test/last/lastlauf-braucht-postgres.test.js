import assert from "node:assert/strict";
import { test } from "node:test";

test("H2a Lauf: K6_BEFEHL ohne Postgres scheitert statt gruen zu enden", (t) => {
  if (!process.env.K6_BEFEHL) return t.skip("kein k6 (K6_BEFEHL fehlt)");
  assert.ok(process.env.HERMES_TEST_POSTGRES_URL, "HERMES_TEST_POSTGRES_URL fehlt: der Lastlauf hat nicht stattgefunden");
});
