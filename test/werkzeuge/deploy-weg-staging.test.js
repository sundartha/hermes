import assert from "node:assert/strict";
import { test } from "node:test";

import { staging } from "../../tools/deploy-weg/staging.mjs";
import {
  anfragenAn,
  attrappeStarten,
  COMMIT_C,
  COMMIT_P,
  einstellungenFuer,
  HTTP_OK,
  KURZE_TAKTE,
  NEUERER,
  sammler,
  testUhr,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const EXIT_ABWEICHUNG = 1;
const ZWEI_WARTEZEITEN = 2;
const MCP_PFAD = "/staging/mcp";

async function stagingMit(kontext, { welt = {}, mehr = {}, probeExit = 0 } = {}) {
  const attrappe = await attrappeStarten(kontext, weltAnlegen(welt));
  const einstellungen = einstellungenFuer("staging", attrappe.basis, mehr);
  const { zeilen, ausgabe } = sammler();
  const uhr = testUhr();
  const probeAufrufe = [];
  const probeAuth = async (rahmen) => {
    probeAufrufe.push(rahmen);
    return probeExit;
  };
  const rahmen = { einstellungen, commit: COMMIT_C, ausgabe, uhr, takte: KURZE_TAKTE, probeAuth };
  const ok = await staging(rahmen);
  return { ok, text: zeilen.join("\n"), attrappe, uhr, probeAufrufe };
}

test("staging grün: wartet, bis /healthz den Commit meldet, dann Negativproben und POST /mcp ohne Anmeldung 401", async (kontext) => {
  const lauf = await stagingMit(kontext, { welt: { staging: [COMMIT_P, COMMIT_P, COMMIT_C] } });
  assert.equal(lauf.ok, true);
  assert.deepEqual(lauf.uhr.wartezeiten, [KURZE_TAKTE.taktMs, KURZE_TAKTE.taktMs]);
  assert.equal(lauf.uhr.wartezeiten.length, ZWEI_WARTEZEITEN);
  assert.deepEqual(lauf.probeAufrufe, [{ url: lauf.attrappe.basis + "/staging", commit: COMMIT_C }]);
  const [mcp] = anfragenAn(lauf.attrappe, "POST", /\/mcp$/);
  assert.equal(mcp.pfad, MCP_PFAD);
  assert.equal(mcp.kopf, "");
  assert.equal(mcp.koerper.method, "tools/list");
  assert.match(lauf.text, new RegExp("Staging fährt den erwarteten Commit " + COMMIT_C));
  assert.match(lauf.text, /Negativproben ohne Zugangsdaten gegen Staging: Exit 0/);
  assert.equal(anfragenAn(lauf.attrappe, "GET", /\/compare\//).length, 1);
});

test("staging rot: Staging meldet schon einen neueren master-Commit (überholt)", async (kontext) => {
  const lauf = await stagingMit(kontext, { welt: { staging: [NEUERER] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Rot: Staging ist überholt/);
  assert.deepEqual(lauf.probeAufrufe, []);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /\/mcp$/), []);
});

test("staging rot: /healthz meldet den Commit nicht innerhalb der Schutzgrenze", async (kontext) => {
  const lauf = await stagingMit(kontext, { welt: { staging: [COMMIT_P] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Schutzgrenze im Schritt staging erreicht/);
  assert.ok(lauf.uhr.jetzt() >= KURZE_TAKTE.schutzgrenzeMs);
  assert.deepEqual(lauf.probeAufrufe, []);
});

test("staging rot: /healthz meldet keinen Commit", async (kontext) => {
  const lauf = await stagingMit(kontext, { welt: { staging: ["unbekannt"] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Staging meldet noch keinen gültigen Commit/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", /\/compare\//), []);
});

test("staging rot: die Negativproben ohne Zugangsdaten finden eine Abweichung", async (kontext) => {
  const lauf = await stagingMit(kontext, { probeExit: EXIT_ABWEICHUNG });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Negativproben ohne Zugangsdaten gegen Staging: Exit 1/);
});

test("staging rot: POST /mcp tools/list ohne Anmeldung antwortet nicht mit 401", async (kontext) => {
  const lauf = await stagingMit(kontext, { welt: { mcpStatus: HTTP_OK } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /POST \/mcp tools\/list ohne Anmeldung: HTTP 200, erwartet 401/);
});

test("staging rot: absichtlich_rot lässt den Prüfschritt ausdrücklich scheitern", async (kontext) => {
  const lauf = await stagingMit(kontext, { mehr: { ABSICHTLICH_ROT: "true" } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Absichtlich rot: dieser Probe-Lauf scheitert wie bestellt/);
});

test("staging: absichtlich_rot false ändert nichts am grünen Lauf", async (kontext) => {
  const lauf = await stagingMit(kontext, { mehr: { ABSICHTLICH_ROT: "false" } });
  assert.equal(lauf.ok, true);
  assert.doesNotMatch(lauf.text, /Absichtlich rot/);
});
