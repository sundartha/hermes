import assert from "node:assert/strict";
import { test } from "node:test";

import { befundeFuerLauf, freigabeBefunde, herkunftBefunde } from "../../tools/freigabe.mjs";

const KOPF = "a".repeat(40);
const BAU_AGENT = { login: "sundartha-agent[bot]" };
const MENSCH = { login: "Antonio20045" };
const PRODUKTCODE = [{ status: "M", pfad: "src/server.js" }];

function approve(stand) {
  return { user: MENSCH, state: "APPROVED", commit_id: stand, body: "PASS" };
}

function pull(autor) {
  return { head: { sha: KOPF }, user: autor };
}

test("SG-21 am PR und in der Merge-Queue verlangt die Freigabe dasselbe Urteil auf dem Kopf", () => {
  assert.deepEqual(herkunftBefunde(pull(BAU_AGENT), PRODUKTCODE), []);
  assert.equal(herkunftBefunde(pull(MENSCH), PRODUKTCODE).length, 1);
  assert.equal(freigabeBefunde(pull(BAU_AGENT), [], PRODUKTCODE).length, 1);
});

test("SG-21 ohne Queue fehlt ohne Approve auf dem Kopf das KI-Urteil, mit Approve ist der Lauf leer", () => {
  const ohneUrteil = { pull: pull(BAU_AGENT), reviews: [], dateien: PRODUKTCODE, imQueue: false };
  assert.equal(befundeFuerLauf(ohneUrteil).length, 1);
  assert.match(befundeFuerLauf(ohneUrteil)[0], /Es fehlt das KI-Urteil/);
  assert.deepEqual(befundeFuerLauf({ ...ohneUrteil, reviews: [approve(KOPF)] }), []);
  assert.deepEqual(befundeFuerLauf({ ...ohneUrteil, imQueue: true, reviews: [approve(KOPF)] }), []);
});

test("SG-21 ein Approve auf einem früheren Kopf zählt ohne Queue nicht", () => {
  const befunde = befundeFuerLauf({ pull: pull(BAU_AGENT), reviews: [approve("b".repeat(40))], dateien: PRODUKTCODE, imQueue: false });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /Es fehlt das KI-Urteil/);
});

test("SG-21 src/ von einem anderen Autor als dem Bau-Agenten bleibt ohne Queue rot, auch mit Approve", () => {
  const befunde = befundeFuerLauf({ pull: pull(MENSCH), reviews: [approve(KOPF)], dateien: PRODUKTCODE, imQueue: false });
  assert.equal(befunde.length, 1);
  assert.doesNotMatch(befunde[0], /Es fehlt das KI-Urteil/);
});
