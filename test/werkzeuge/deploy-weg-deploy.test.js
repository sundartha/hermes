import assert from "node:assert/strict";
import { test } from "node:test";

import { deploy } from "../../tools/deploy-weg/deploy.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";
import { DEPLOY_TAKTE, STAGING_TAKTE } from "../../tools/deploy-weg/takt.mjs";
import {
  ALTER_DEPLOY,
  anfragenAn,
  attrappeStarten,
  COMMIT_C,
  COMMIT_P,
  DEPLOY_ID,
  DEPLOY_TOKEN,
  DEPLOYS_PFAD,
  einstellungenFuer,
  HTTP_ANGENOMMEN,
  HTTP_KONFLIKT,
  KURZE_DEPLOY_TAKTE,
  KURZE_TAKTE,
  NEUERER,
  RENDER_SCHLUESSEL,
  sammler,
  testUhr,
  umgebungFuer,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const MINUTE_MS = 60000;
const SEKUNDE_MS = 1000;
const ANRUFE_TAKT_S = 60;
const ANRUFE_GRENZE_MIN = 35;
const STATUS_TAKT_S = 30;
const STATUS_GRENZE_MIN = 30;
const HEALTHZ_GRENZE_MIN = 10;
const STAGING_GRENZE_MIN = 20;
const ZWEI_ANRUFE = 2;
const AUSLOESEN = /\/deploys$/;
const ABBRECHEN = /\/cancel$/;
const ANRUFE = /\/intern\/anrufe-laufend$/;
const FALSCHES_TOKEN = "f".repeat(DEPLOY_TOKEN.length);

async function deployMit(kontext, { welt = {}, mehr = {} } = {}) {
  const lage = weltAnlegen({ produktion: [COMMIT_P, COMMIT_C], ...welt });
  const attrappe = await attrappeStarten(kontext, lage);
  const einstellungen = einstellungenFuer("deploy", attrappe.basis, mehr);
  const { zeilen, ausgabe } = sammler();
  const uhr = testUhr();
  const rahmen = { einstellungen, commit: COMMIT_C, produktion: COMMIT_P, ausgabe, uhr };
  const ok = await deploy({ ...rahmen, takte: KURZE_DEPLOY_TAKTE });
  return { ok, text: zeilen.join("\n"), attrappe, uhr };
}

function keinDeployPost(lauf) {
  assert.equal(lauf.ok, false);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", AUSLOESEN), []);
}

test("deploy grün: genau ein Deploy-POST mit commitId des Kandidaten, Status bis live, danach meldet /healthz den Kandidaten", async (kontext) => {
  const lauf = await deployMit(kontext);
  assert.equal(lauf.ok, true);
  const posts = anfragenAn(lauf.attrappe, "POST", AUSLOESEN);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].pfad, DEPLOYS_PFAD);
  assert.deepEqual(posts[0].koerper, { commitId: COMMIT_C });
  assert.equal(posts[0].kopf, "Bearer " + RENDER_SCHLUESSEL);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", ABBRECHEN), []);
  const anrufe = anfragenAn(lauf.attrappe, "GET", ANRUFE);
  assert.equal(anrufe.length, ZWEI_ANRUFE);
  assert.ok(anrufe.every((anfrage) => anfrage.kopf === "Bearer " + DEPLOY_TOKEN));
  const reihenfolge = lauf.attrappe.anfragen.map(({ pfad }) => pfad);
  assert.ok(reihenfolge.findIndex((pfad) => ANRUFE.test(pfad)) < reihenfolge.indexOf(DEPLOYS_PFAD));
  assert.match(lauf.text, /Deploy-Status: update_in_progress/);
  assert.match(lauf.text, new RegExp("Produktion fährt jetzt " + COMMIT_C));
});

test("deploy grün über 202: die Deploy-ID kommt aus der Liste, ein älterer API-Deploy desselben Commits zählt nicht", async (kontext) => {
  const welt = { ausloesenStatus: HTTP_ANGENOMMEN, alteDeploys: [ALTER_DEPLOY] };
  const lauf = await deployMit(kontext, { welt });
  assert.equal(lauf.ok, true);
  assert.equal(anfragenAn(lauf.attrappe, "POST", AUSLOESEN).length, 1);
  assert.ok(anfragenAn(lauf.attrappe, "GET", new RegExp("/deploys/" + DEPLOY_ID + "$")).length > 0);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", new RegExp("/deploys/" + ALTER_DEPLOY)), []);
});

test("deploy wartet, bis kein Anruf mehr läuft, und deployt erst dann", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { laufend: [ZWEI_ANRUFE, 1, 0, 0] } });
  assert.equal(lauf.ok, true);
  assert.equal(anfragenAn(lauf.attrappe, "POST", AUSLOESEN).length, 1);
  assert.deepEqual(lauf.uhr.wartezeiten.slice(0, ZWEI_ANRUFE), [
    KURZE_TAKTE.taktMs,
    KURZE_TAKTE.taktMs,
  ]);
  assert.match(lauf.text, /Laufende Anrufe in Produktion: 2/);
});

test("deploy rot: ein Anruf läuft bis zur Schutzgrenze, kein Deploy-POST", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { laufend: [1] } });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Schutzgrenze im Schritt anrufe erreicht/);
  assert.ok(lauf.uhr.jetzt() >= KURZE_TAKTE.schutzgrenzeMs);
});

test("deploy rot: die Anruf-Abfrage lehnt das Token ab, kein Deploy-POST", async (kontext) => {
  const lauf = await deployMit(kontext, { mehr: { HERMES_DEPLOY_TOKEN: FALSCHES_TOKEN } });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Abbruch im Schritt anrufe: HTTP 401/);
});

test("deploy rot: Produktion fährt nicht mehr den Commit aus der Entscheidung, kein Deploy-POST", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { produktion: [NEUERER] } });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Produktion fährt nicht mehr den Commit aus der Entscheidung/);
});

test("deploy rot: beim Umschalten (update_in_progress) läuft ein Anruf, der Deploy wird abgebrochen", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { laufend: [0, 1] } });
  assert.equal(lauf.ok, false);
  const abbrueche = anfragenAn(lauf.attrappe, "POST", ABBRECHEN);
  assert.deepEqual(
    abbrueche.map(({ pfad }) => pfad),
    [DEPLOYS_PFAD + "/" + DEPLOY_ID + "/cancel"],
  );
  assert.match(lauf.text, /beim Umschalten läuft ein Anruf/);
  assert.doesNotMatch(lauf.text, /Produktion fährt jetzt/);
});

test("deploy rot: der Deploy endet mit build_failed, ohne Abbruch-Anfrage", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { deployStatus: ["build_in_progress", "build_failed"] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Rot: der Deploy endet mit build_failed/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", ABBRECHEN), []);
});

test("deploy rot: jeder rote Endzustand beendet die Verfolgung", async (kontext) => {
  for (const endzustand of ["update_failed", "canceled", "pre_deploy_failed", "deactivated"]) {
    const lauf = await deployMit(kontext, { welt: { deployStatus: ["queued", endzustand] } });
    assert.equal(lauf.ok, false);
    assert.match(lauf.text, new RegExp("endet mit " + endzustand));
  }
});

test("deploy rot: der Status wird bis zur Schutzgrenze nicht live, der Deploy wird abgebrochen", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { deployStatus: ["build_in_progress"] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Schutzgrenze im Schritt deploy_status erreicht/);
  assert.equal(anfragenAn(lauf.attrappe, "POST", ABBRECHEN).length, 1);
});

test("deploy rot: Render lehnt den Deploy mit 409 ab, keine Status-Abfrage", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { ausloesenStatus: HTTP_KONFLIKT } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Deploy angefordert: HTTP 409/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", /\/deploys\/dep-/), []);
});

test("deploy rot: nach live meldet /healthz den Kandidaten nicht innerhalb der Schutzgrenze", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { produktion: [COMMIT_P] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Schutzgrenze im Schritt healthz erreicht/);
});

test("deploy maskiert Render-Schlüssel und Deploy-Token und schreibt sie sonst nirgends hin", async (kontext) => {
  const { zeilen, ausgabe } = sammler();
  einstellungenLesen("deploy", umgebungFuer("http://127.0.0.1:9"), ausgabe);
  assert.deepEqual(zeilen, ["::add-mask::" + RENDER_SCHLUESSEL, "::add-mask::" + DEPLOY_TOKEN]);
  const lauf = await deployMit(kontext);
  assert.equal(lauf.ok, true);
  assert.ok(!lauf.text.includes(RENDER_SCHLUESSEL));
  assert.ok(!lauf.text.includes(DEPLOY_TOKEN));
});

test("Schutzgrenzen und Takte des echten Laufs stehen fest", () => {
  assert.equal(DEPLOY_TAKTE.anrufe.taktMs, ANRUFE_TAKT_S * SEKUNDE_MS);
  assert.equal(DEPLOY_TAKTE.anrufe.schutzgrenzeMs, ANRUFE_GRENZE_MIN * MINUTE_MS);
  assert.equal(DEPLOY_TAKTE.status.taktMs, STATUS_TAKT_S * SEKUNDE_MS);
  assert.equal(DEPLOY_TAKTE.status.schutzgrenzeMs, STATUS_GRENZE_MIN * MINUTE_MS);
  assert.equal(DEPLOY_TAKTE.healthz.schutzgrenzeMs, HEALTHZ_GRENZE_MIN * MINUTE_MS);
  assert.equal(STAGING_TAKTE.schutzgrenzeMs, STAGING_GRENZE_MIN * MINUTE_MS);
});
