import { test } from "node:test";
import assert from "node:assert/strict";
import { oeffneSpeicher, rolleVorhanden } from "../../src/store.js";

test("Ohne Postgres gibt es keine Leserolle", async () => {
  await oeffneSpeicher();
  assert.equal(await rolleVorhanden("kennzahlen_leser"), false);
});
