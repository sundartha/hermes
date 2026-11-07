import assert from "node:assert/strict";
import { test } from "node:test";

import { befundeFuerLauf, freigabeBefunde, herkunftBefunde } from "../../tools/freigabe.mjs";

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

test("SG-21 in der Merge-Queue kommt ohne Approve auf dem Kopf nichts durch, am PR wartet nur das Urteil", () => {
  const ohneUrteil = { pull: pull(BAU_AGENT), reviews: [], dateien: PRODUKTCODE };
  assert.equal(befundeFuerLauf({ ...ohneUrteil, imQueue: true }).length, 1);
  assert.match(befundeFuerLauf({ ...ohneUrteil, imQueue: true })[0], /Es fehlt das KI-Urteil/);
  assert.deepEqual(befundeFuerLauf({ ...ohneUrteil, imQueue: false }), []);
  assert.equal(befundeFuerLauf({ pull: pull(MENSCH), reviews: [], dateien: PRODUKTCODE, imQueue: false }).length, 1);
});
