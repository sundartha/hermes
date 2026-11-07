import assert from "node:assert/strict";
import { test } from "node:test";

import { freigabeBefunde } from "../../tools/freigabe.mjs";

const KOPF = "a".repeat(40);
const ALTER_STAND = "b".repeat(40);
const BAU_AGENT = { login: "sundartha-agent[bot]" };
const MENSCH = { login: "Antonio20045" };
const PRUEFUNGSDATEI = [{ status: "M", pfad: ".github/workflows/ci.yml" }];
const PRODUKTCODE = [{ status: "M", pfad: "src/server.js" }];

function pull(autor) {
  return { head: { sha: KOPF }, user: autor };
}

function approve(stand) {
  return { user: MENSCH, state: "APPROVED", commit_id: stand };
}

test("SG-21 Änderung an einer Prüfung ohne Freigabe wird gestoppt", () => {
  const ohneUrteil = freigabeBefunde(pull(BAU_AGENT), [], PRUEFUNGSDATEI);
  assert.equal(ohneUrteil.length, 1);
  assert.match(ohneUrteil[0], /Es fehlt das KI-Urteil/);
  const veraltet = freigabeBefunde(pull(BAU_AGENT), [approve(ALTER_STAND)], PRUEFUNGSDATEI);
  assert.equal(veraltet.length, 1);
  assert.deepEqual(freigabeBefunde(pull(BAU_AGENT), [approve(KOPF)], PRUEFUNGSDATEI), []);
});

test("SG-21 Code unter src/ von jemand anderem als dem Bau-Agenten wird gestoppt, auch mit Freigabe", () => {
  const vomMenschen = freigabeBefunde(pull(MENSCH), [approve(KOPF)], PRODUKTCODE);
  assert.equal(vomMenschen.length, 1);
  assert.match(vomMenschen[0], /nur vom Bau-Agenten/);
  assert.deepEqual(freigabeBefunde(pull(BAU_AGENT), [approve(KOPF)], PRODUKTCODE), []);
});

test("SG-21 eine spätere Ablehnung hebt eine frühere Freigabe auf", () => {
  const abgelehnt = { user: MENSCH, state: "CHANGES_REQUESTED", commit_id: KOPF };
  assert.equal(freigabeBefunde(pull(BAU_AGENT), [approve(KOPF), abgelehnt], PRUEFUNGSDATEI).length, 1);
});

test("SG-21 am PR hält das fehlende Urteil nichts fest, in der Merge-Queue stoppt es", () => {
  assert.deepEqual(freigabeBefunde(pull(BAU_AGENT), [], PRUEFUNGSDATEI, false), []);
  assert.equal(freigabeBefunde(pull(BAU_AGENT), [], PRUEFUNGSDATEI, true).length, 1);
  assert.equal(freigabeBefunde(pull(MENSCH), [], PRODUKTCODE, false).length, 1);
});
