import assert from "node:assert/strict";
import { test } from "node:test";

import { freigabeBefunde, herkunftBefunde } from "../../tools/freigabe.mjs";

const KOPF = "a".repeat(40);
const BAU_AGENT = { login: "sundartha-agent[bot]" };
const MENSCH = { login: "Antonio20045" };
const PRODUKTCODE = [{ status: "M", pfad: "src/server.js" }];

function pull(autor) {
  return { head: { sha: KOPF }, user: autor };
}

test("SG-21 am PR prüft die Freigabe nur die Herkunft, das Urteil verlangt die Merge-Queue", () => {
  assert.deepEqual(herkunftBefunde(pull(BAU_AGENT), PRODUKTCODE), []);
  assert.equal(herkunftBefunde(pull(MENSCH), PRODUKTCODE).length, 1);
  assert.equal(freigabeBefunde(pull(BAU_AGENT), [], PRODUKTCODE).length, 1);
});
