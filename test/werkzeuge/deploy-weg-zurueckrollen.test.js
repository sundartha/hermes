import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEPLOY_TAKTE } from "../../tools/deploy-weg/takt.mjs";
import { zurueckrollen } from "../../tools/deploy-weg/zurueckrollen.mjs";
import {
  anfragenAn,
  attrappeStarten,
  COMMIT_C,
  COMMIT_P,
  DEPLOY_TOKEN,
  einstellungenFuer,
  HTTP_OK,
  KEINE_ANTWORT,
  KURZE_DEPLOY_TAKTE,
  RENDER_SCHLUESSEL,
  RENDER_SERVICE_PFAD,
  ROLLBACK_ID,
  sammler,
  temporaerOrdner,
  testUhr,
  umgebungFuer,
  weltAnlegen,
  werkzeugStarten,
} from "./deploy-weg-attrappe.mjs";
import { withoutGitVariables } from "./git-umgebung.mjs";

const SHA_LAENGE = 40;
const ALT = "e".repeat(SHA_LAENGE);
const ENDE_ALT = "2026-10-08T09:00:00Z";
const ENDE_P = "2026-10-09T09:00:00Z";
const ENDE_C = "2026-10-10T09:00:00Z";
const HTTP_FEHLER = 500;
const HTTP_NICHT_ERREICHBAR = 503;
const ABLEHNUNGEN = [400, 403, 409, 422];
const EXIT_OK = 0;
const EXIT_ROT = 1;
const ZWEI = 2;
const ROLLBACK = /\/rollback$/;
const DIENST = /^\/render\/v1\/services\/srv-probe$/;
const EREIGNISSE = /\/events\?/;
const ANRUFE = /\/intern\/anrufe-laufend$/;
const MASKE = "::add-mask::";
const AUFRUF = /Aufruf: node tools\/deploy-weg\.mjs .*\| zurueckrollen --ziel vorher\|<sha>/;
const AUS = { autoDeploy: "no", autoDeployTrigger: "off" };
const AN = { autoDeploy: "yes", autoDeployTrigger: "commit" };
const LIVE_AUS_VOM_MAC =
  "Vom Mac: zuerst den Workflow live abschalten: gh workflow disable live.yml --repo sundartha/hermes";
const LIVE_WIEDER_AN =
  "Workflow live bleibt abgeschaltet. Erst wieder einschalten, wenn die Korrektur auf master gemergt ist: gh workflow enable live.yml --repo sundartha/hermes (oder in GitHub unter Actions → live → Enable workflow).";
const FREE_GRENZE =
  "Render erlaubt auf Free nur Rollbacks auf die zwei letzten früheren Deploys; jetzt die Anrufpause oder das Render-Dashboard nutzen.";
const OHNE_ANRUFPAUSE =
  "Warnung: Der Ziel-Stand kennt die Anrufpause nicht: eine eingeschaltete Pause wirkt jetzt nicht mehr, nur OUTBOUND_FROZEN mit Neustart sperrt; beim nächsten Deploy ab V6 gilt der gespeicherte Wert wieder.";
const IN_ACTIONS = {
  GITHUB_ACTIONS: "true",
  GITHUB_ACTOR: "Antonio20045",
  GITHUB_TRIGGERING_ACTOR: "Antonio20045",
};

function deploy(id, commit, { status = "deactivated", trigger = "api", finishedAt } = {}) {
  return { id, commit: { id: commit }, status, trigger, createdAt: finishedAt, finishedAt };
}

const DEPLOY_C = deploy("dep-c", COMMIT_C, { status: "live", finishedAt: ENDE_C });
const DEPLOY_P = deploy("dep-p", COMMIT_P, { finishedAt: ENDE_P });
const DEPLOY_ALT = deploy("dep-alt", ALT, { finishedAt: ENDE_ALT });
const LISTE = [DEPLOY_C, DEPLOY_P, DEPLOY_ALT];
const FRUEHERER_ROLLBACK = deploy("dep-r1", COMMIT_P, {
  status: "live",
  trigger: "rollback",
  finishedAt: ENDE_C,
});
const C_ABGELOEST = { ...DEPLOY_C, status: "deactivated" };
const STATUS_ABFRAGEN = /\/deploys\//;

function lageFuer(welt) {
  return weltAnlegen({
    produktion: [COMMIT_C, COMMIT_P],
    deployStatus: ["update_in_progress", "live"],
    deployListe: LISTE,
    ...welt,
  });
}

async function rollbackMit(kontext, optionen = {}) {
  const { welt = {}, mehr = {}, ziel = "vorher", probeExit = EXIT_OK } = optionen;
  const takte = optionen.takte ?? KURZE_DEPLOY_TAKTE;
  const uhr = testUhr();
  const attrappe = await attrappeStarten(kontext, lageFuer(welt), uhr);
  const einstellungen = einstellungenFuer("zurueckrollen", attrappe.basis, mehr);
  const { zeilen, ausgabe } = sammler();
  const probeAufrufe = [];
  const probeAuth = async (rahmen) => {
    probeAufrufe.push(rahmen);
    return probeExit;
  };
  const eigeneProbe = optionen.echteProbe ? undefined : probeAuth;
  const anrufpauseImZiel = optionen.echteProbe ? undefined : async () => true;
  const rahmen = { einstellungen, ziel, ausgabe, uhr, takte, probeAuth: eigeneProbe };
  const ok = await zurueckrollen({ ...rahmen, anrufpauseImZiel });
  return { ok, zeilen, text: zeilen.join("\n"), attrappe, probeAufrufe };
}

function rollbackKoerper(lauf) {
  return anfragenAn(lauf.attrappe, "POST", ROLLBACK).map(({ koerper }) => koerper);
}

function patchKoerper(lauf) {
  return anfragenAn(lauf.attrappe, "PATCH", DIENST).map(({ koerper }) => koerper);
}

function keinRollback(lauf) {
  assert.equal(lauf.ok, false);
  assert.deepEqual(rollbackKoerper(lauf), []);
  assert.deepEqual(patchKoerper(lauf), []);
}

test("zurueckrollen grün: genau ein Rollback auf den letzten guten Deploy, healthz meldet dessen Commit, Proben bestanden", async (kontext) => {
  const lauf = await rollbackMit(kontext);
  assert.equal(lauf.ok, true, lauf.text);
  const posts = anfragenAn(lauf.attrappe, "POST", ROLLBACK);
  assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-p" }]);
  assert.equal(posts[0].pfad, RENDER_SERVICE_PFAD + "/rollback");
  assert.equal(posts[0].kopf, "Bearer " + RENDER_SCHLUESSEL);
  assert.deepEqual(patchKoerper(lauf), []);
  assert.ok(
    anfragenAn(lauf.attrappe, "GET", new RegExp("/deploys/" + ROLLBACK_ID + "$")).length > 0,
  );
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", ANRUFE), []);
  assert.deepEqual(lauf.probeAufrufe, [
    { url: lauf.attrappe.basis + "/prod", commit: COMMIT_P, repoDir: process.cwd() },
  ]);
  const [mcp] = anfragenAn(lauf.attrappe, "POST", /\/prod\/mcp$/);
  assert.equal(mcp.kopf, "");
  assert.equal(mcp.koerper.method, "tools/list");
  assert.deepEqual(lauf.zeilen, [
    LIVE_AUS_VOM_MAC,
    "Automatisches Ausliefern bei Render vor dem Rollback: off",
    "Produktion fährt: " + COMMIT_C,
    "Rollback-Ziel: der frühere Deploy von Commit " + COMMIT_P,
    "Hinweis: Änderungen an Umgebungsvariablen mit „Save only“ sind nicht erkennbar; der Rollback nimmt die Werte des Ziel-Deploys",
    "Rollback angefordert: HTTP 201",
    "Deploy-Status: update_in_progress",
    "Deploy-Status: live",
    "Produktion fährt jetzt " + COMMIT_P,
    "Automatisches Ausliefern bei Render nach dem Rollback: off",
    "Automatisches Ausliefern wie vor dem Rollback: ja",
    "Negativproben ohne Zugangsdaten gegen Produktion: Exit 0",
    "POST /mcp tools/list ohne Anmeldung: HTTP 401, erwartet 401",
    "Jetzt Probeanruf an eine Nummer von Sundartha; er muss gelingen.",
    LIVE_WIEDER_AN,
  ]);
});

test("zurueckrollen in Actions: keine Mac-Zeile, nach dem Rollback die Zeile zum Wiedereinschalten von live", async (kontext) => {
  const lauf = await rollbackMit(kontext, { mehr: IN_ACTIONS });
  assert.equal(lauf.ok, true, lauf.text);
  assert.ok(!lauf.zeilen.includes(LIVE_AUS_VOM_MAC));
  assert.equal(lauf.zeilen[0], "Automatisches Ausliefern bei Render vor dem Rollback: off");
  assert.equal(lauf.zeilen.at(-1), LIVE_WIEDER_AN);
  assert.equal(lauf.zeilen.filter((zeile) => zeile === LIVE_WIEDER_AN).length, 1);
});

test("zurueckrollen nennt live auch, wenn es gar nicht zum Rollback kommt", async (kontext) => {
  for (const mehr of [{}, IN_ACTIONS]) {
    const lauf = await rollbackMit(kontext, { mehr, welt: { deployListe: [DEPLOY_C] } });
    keinRollback(lauf);
    assert.equal(lauf.zeilen.at(-1), LIVE_WIEDER_AN);
    assert.equal(lauf.zeilen.includes(LIVE_AUS_VOM_MAC), mehr.GITHUB_ACTIONS === undefined);
  }
});

test("zurueckrollen fragt die Deploy-Ereignisse seit dem Ende des Ziel-Deploys ab", async (kontext) => {
  const lauf = await rollbackMit(kontext);
  const [anfrage] = anfragenAn(lauf.attrappe, "GET", EREIGNISSE);
  const filter = new URLSearchParams(anfrage.pfad.split("?")[1]);
  assert.equal(filter.get("type"), "deploy_started");
  assert.equal(filter.get("startTime"), ENDE_P);
  assert.equal(filter.get("limit"), "100");
  assert.equal(anfrage.kopf, "Bearer " + RENDER_SCHLUESSEL);
});

test("zurueckrollen nach einem früheren Rollback geht mit vorher weiter zurück statt wieder vor", async (kontext) => {
  const liste = [FRUEHERER_ROLLBACK, C_ABGELOEST, DEPLOY_P, DEPLOY_ALT];
  const welt = { deployListe: liste, produktion: [COMMIT_P, ALT] };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-alt" }]);
  assert.match(lauf.text, new RegExp("Rollback-Ziel: der frühere Deploy von Commit " + ALT));
});

test("zurueckrollen mit vorher ankert am ältesten Deploy des laufenden Commits, nicht an einem späteren Neu-Deploy", async (kontext) => {
  const liste = [
    deploy("dep-a2", COMMIT_C, { status: "live", trigger: "manual", finishedAt: ENDE_C }),
    deploy("dep-ar", COMMIT_C, { trigger: "rollback", finishedAt: ENDE_C }),
    deploy("dep-b", COMMIT_P, { finishedAt: ENDE_P }),
    deploy("dep-a1", COMMIT_C, { finishedAt: ENDE_P }),
    deploy("dep-z", ALT, { finishedAt: ENDE_ALT }),
  ];
  const lauf = await rollbackMit(kontext, {
    welt: { deployListe: liste, produktion: [COMMIT_C, ALT] },
  });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-z" }]);
  assert.match(lauf.text, new RegExp("Rollback-Ziel: der frühere Deploy von Commit " + ALT));
});

test("zurueckrollen überspringt frühere Deploys ohne Ende und abgelöste Deploys des laufenden Commits", async (kontext) => {
  const ohneEnde = { ...DEPLOY_P, finishedAt: undefined };
  const zweitesC = deploy("dep-c2", COMMIT_C, { finishedAt: ENDE_P });
  const welt = {
    deployListe: [DEPLOY_C, zweitesC, ohneEnde, DEPLOY_ALT],
    produktion: [COMMIT_C, ALT],
  };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-alt" }]);
});

test("zurueckrollen mit --ziel wählt den neuesten abgelösten Deploy genau dieses Commits", async (kontext) => {
  const neuerAlt = deploy("dep-alt2", ALT, { finishedAt: ENDE_P });
  const welt = {
    deployListe: [DEPLOY_C, neuerAlt, DEPLOY_P, DEPLOY_ALT],
    produktion: [COMMIT_C, ALT],
  };
  const lauf = await rollbackMit(kontext, { welt, ziel: ALT });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-alt2" }]);
});

test("zurueckrollen ohne passendes Ziel bricht ohne Rollback ab", async (kontext) => {
  const faelle = [
    { welt: { deployListe: [DEPLOY_C] } },
    { welt: { deployListe: [DEPLOY_P, DEPLOY_C] } },
    { welt: { deployListe: [FRUEHERER_ROLLBACK, C_ABGELOEST] } },
    { ziel: COMMIT_C },
    { ziel: "f".repeat(SHA_LAENGE) },
    { ziel: ALT, welt: { deployListe: [DEPLOY_C, { ...DEPLOY_ALT, status: "build_failed" }] } },
  ];
  for (const fall of faelle) {
    const lauf = await rollbackMit(kontext, fall);
    keinRollback(lauf);
    assert.match(lauf.text, /Rot: Render kennt keinen passenden früheren Deploy für den Rollback/);
    assert.deepEqual(anfragenAn(lauf.attrappe, "GET", EREIGNISSE), []);
  }
});

test("zurueckrollen ohne laufenden Deploy bricht ohne Rollback ab", async (kontext) => {
  const welt = { deployListe: [C_ABGELOEST, DEPLOY_P] };
  const lauf = await rollbackMit(kontext, { welt });
  keinRollback(lauf);
  assert.match(lauf.text, /Rot: Render meldet keinen laufenden Deploy/);
  assert.doesNotMatch(lauf.text, /Produktion fährt:/);
});

test("zurueckrollen bricht ohne Rollback ab, wenn Render die Deploy-Liste verweigert", async (kontext) => {
  const lauf = await rollbackMit(kontext, { welt: { listeStatus: HTTP_FEHLER } });
  keinRollback(lauf);
  assert.match(lauf.text, /Abbruch im Schritt deploy_liste: HTTP 500/);
});

test("zurueckrollen bricht ohne Rollback ab, wenn das automatische Ausliefern vorher nicht lesbar ist", async (kontext) => {
  for (const welt of [
    { dienstStatus: [HTTP_FEHLER] },
    { dienst: [{ autoDeployTrigger: "bald" }] },
  ]) {
    const lauf = await rollbackMit(kontext, { welt });
    keinRollback(lauf);
    assert.match(lauf.text, /Automatisches Ausliefern bei Render nicht lesbar: HTTP (500|200)/);
    assert.deepEqual(anfragenAn(lauf.attrappe, "GET", /\/deploys\?/), []);
  }
});

test("zurueckrollen stellt ein geändertes automatisches Ausliefern per PATCH wieder her", async (kontext) => {
  const faelle = [
    [AN, AUS, AN],
    [{ autoDeploy: "yes" }, { autoDeploy: "no" }, { autoDeploy: "yes" }],
  ];
  for (const dienst of faelle) {
    const lauf = await rollbackMit(kontext, { welt: { dienst } });
    assert.equal(lauf.ok, true, lauf.text);
    assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
    assert.equal(anfragenAn(lauf.attrappe, "PATCH", DIENST)[0].kopf, "Bearer " + RENDER_SCHLUESSEL);
    assert.match(lauf.text, /Automatisches Ausliefern bei Render vor dem Rollback: commit/);
    assert.match(lauf.text, /Automatisches Ausliefern bei Render nach dem Rollback: off/);
    assert.match(lauf.text, /Automatisches Ausliefern auf commit zurückgesetzt: HTTP 200/);
    assert.match(lauf.text, /Automatisches Ausliefern wie vor dem Rollback: ja/);
  }
});

test("zurueckrollen patcht nicht, wenn das automatische Ausliefern unverändert ist", async (kontext) => {
  const lauf = await rollbackMit(kontext, {
    welt: { dienst: [{ autoDeployTrigger: "checksPass" }] },
  });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(patchKoerper(lauf), []);
  assert.equal(anfragenAn(lauf.attrappe, "GET", DIENST).length, ZWEI);
  assert.doesNotMatch(lauf.text, /zurückgesetzt/);
});

test("zurueckrollen ist rot, wenn das automatische Ausliefern nicht wiederherstellbar ist", async (kontext) => {
  const faelle = [
    { dienst: [AN, AUS], aendernStatus: HTTP_FEHLER },
    { dienst: [AN], dienstStatus: [HTTP_OK, HTTP_FEHLER] },
  ];
  for (const welt of faelle) {
    const lauf = await rollbackMit(kontext, { welt });
    assert.equal(lauf.ok, false);
    assert.match(lauf.text, /Automatisches Ausliefern wie vor dem Rollback: nein/);
    assert.deepEqual(lauf.probeAufrufe, []);
    assert.doesNotMatch(lauf.text, /Probeanruf/);
  }
});

test("zurueckrollen meldet Deploys wegen geänderter Umgebungsvariablen und rollt trotzdem zurück", async (kontext) => {
  const ereignis = (envUpdated) => ({
    cursor: "x",
    event: { type: "deploy_started", details: { trigger: { envUpdated } } },
  });
  const welt = { ereignisse: [ereignis(true), ereignis(false), ereignis(true)] };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, true, lauf.text);
  assert.match(
    lauf.text,
    /Warnung: seit dem Ziel-Deploy liefen 2 Deploys wegen geänderter Umgebungsvariablen; der Rollback nimmt die alten Werte/,
  );
  assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-p" }]);
});

test("zurueckrollen meldet nicht prüfbare Umgebungsvariablen und rollt trotzdem zurück", async (kontext) => {
  const lauf = await rollbackMit(kontext, { welt: { ereignisStatus: HTTP_FEHLER } });
  assert.equal(lauf.ok, true, lauf.text);
  assert.match(lauf.text, /Warnung: geänderte Umgebungsvariablen nicht prüfbar \(HTTP 500\)/);
  assert.match(lauf.text, /„Save only“ sind nicht erkennbar/);
  assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-p" }]);
});

test("zurueckrollen bricht ab, wenn Render den Rollback ablehnt, nennt die Free-Grenze und fasst das Ausliefern nicht an", async (kontext) => {
  for (const http of ABLEHNUNGEN) {
    const lauf = await rollbackMit(kontext, {
      welt: { rollbackStatus: http, rollbackAntwort: {} },
    });
    assert.equal(lauf.ok, false);
    assert.equal(rollbackKoerper(lauf).length, 1);
    assert.ok(lauf.zeilen.includes("Rollback angefordert: HTTP " + http));
    assert.ok(lauf.zeilen.includes("Abbruch im Schritt rollback: HTTP " + http));
    assert.ok(lauf.zeilen.includes(`Render lehnt den Rollback ab (HTTP ${http}). ${FREE_GRENZE}`));
    assert.equal(anfragenAn(lauf.attrappe, "GET", DIENST).length, 1);
    assert.equal(anfragenAn(lauf.attrappe, "GET", /\/deploys\?/).length, 1);
    assert.deepEqual(anfragenAn(lauf.attrappe, "GET", STATUS_ABFRAGEN), []);
  }
});

test("zurueckrollen ohne eindeutige Antwort sieht nach, findet den Rollback-Deploy, verfolgt ihn, stellt das Ausliefern wieder her und bleibt rot", async (kontext) => {
  const rollback = deploy(ROLLBACK_ID, COMMIT_P, {
    status: "update_in_progress",
    trigger: "rollback",
  });
  const welt = {
    rollbackStatus: HTTP_NICHT_ERREICHBAR,
    rollbackAntwort: {},
    listeNachRollback: [rollback, ...LISTE],
    deployStatus: ["live"],
    dienst: [AN, AUS, AN],
  };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, false);
  assert.ok(lauf.zeilen.includes("Abbruch im Schritt rollback: HTTP 503"));
  assert.ok(lauf.zeilen.includes("Rollback läuft trotzdem: Deploy " + ROLLBACK_ID));
  assert.doesNotMatch(lauf.text, /Render lehnt den Rollback ab/);
  assert.ok(
    anfragenAn(lauf.attrappe, "GET", new RegExp("/deploys/" + ROLLBACK_ID + "$")).length > 0,
  );
  assert.match(lauf.text, new RegExp("Produktion fährt jetzt " + COMMIT_P));
  assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
  assert.match(lauf.text, /Automatisches Ausliefern wie vor dem Rollback: ja/);
  assert.deepEqual(lauf.probeAufrufe, []);
  assert.doesNotMatch(lauf.text, /Probeanruf/);
});

test("zurueckrollen ohne Antwort (HTTP 0) meldet, dass kein Rollback-Deploy entstanden ist, und stellt das Ausliefern wieder her", async (kontext) => {
  const altesRollback = { ...FRUEHERER_ROLLBACK, status: "deactivated" };
  const welt = {
    rollbackStatus: KEINE_ANTWORT,
    deployListe: [DEPLOY_C, altesRollback, DEPLOY_P, DEPLOY_ALT],
    dienst: [AN, AUS, AN],
  };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, false);
  assert.ok(lauf.zeilen.includes("Rollback angefordert: HTTP 0"));
  assert.ok(lauf.zeilen.includes("Kein Rollback-Deploy gefunden (Deploy-Liste: HTTP 200)"));
  assert.equal(anfragenAn(lauf.attrappe, "GET", /\/deploys\?/).length, ZWEI);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", STATUS_ABFRAGEN), []);
  assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
  assert.match(lauf.text, /Automatisches Ausliefern wie vor dem Rollback: ja/);
});

test("zurueckrollen wertet HTTP 500 nicht als Ablehnung, sieht nach und bleibt rot", async (kontext) => {
  const welt = { rollbackStatus: HTTP_FEHLER, rollbackAntwort: {} };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, false);
  assert.doesNotMatch(lauf.text, /Render lehnt den Rollback ab/);
  assert.ok(lauf.zeilen.includes("Kein Rollback-Deploy gefunden (Deploy-Liste: HTTP 200)"));
  assert.match(lauf.text, /Automatisches Ausliefern wie vor dem Rollback: ja/);
});

test("zurueckrollen ohne gültige Deploy-ID in der Antwort ist rot und stellt das Ausliefern trotzdem wieder her", async (kontext) => {
  const welt = { rollbackAntwort: { id: "kaputt" }, dienst: [AN, AUS, AN] };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Abbruch im Schritt rollback$/m);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", STATUS_ABFRAGEN), []);
  assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
});

test("zurueckrollen stellt das Ausliefern auch wieder her, wenn der Rollback-Deploy rot endet", async (kontext) => {
  const welt = { deployStatus: ["update_failed"], dienst: [AN, AUS, AN] };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Rot: der Deploy endet mit update_failed/);
  assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
  assert.match(lauf.text, /Automatisches Ausliefern wie vor dem Rollback: ja/);
  assert.deepEqual(lauf.probeAufrufe, []);
});

test("zurueckrollen hält an der Schutzgrenze des Deploy-Status an und stellt das Ausliefern wieder her", async (kontext) => {
  const welt = { deployStatus: ["update_in_progress"], dienst: [AN, AUS, AN] };
  const lauf = await rollbackMit(kontext, { welt });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Schutzgrenze im Schritt deploy_status erreicht/);
  assert.equal(
    lauf.zeilen.filter((zeile) => zeile === "Deploy-Status: update_in_progress").length,
    1,
  );
  assert.ok(anfragenAn(lauf.attrappe, "GET", STATUS_ABFRAGEN).length > ZWEI);
  assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /\/cancel$/), []);
});

test("zurueckrollen ist rot, wenn healthz den Ziel-Commit nicht meldet", async (kontext) => {
  const lauf = await rollbackMit(kontext, {
    welt: { produktion: [COMMIT_C, COMMIT_C], dienst: [AN, AUS, AN] },
  });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Schutzgrenze im Schritt healthz erreicht/);
  assert.doesNotMatch(lauf.text, /Produktion fährt jetzt/);
  assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
  assert.deepEqual(lauf.probeAufrufe, []);
});

test("zurueckrollen weckt eine schlafende Produktion vor der healthz-Prüfung", async (kontext) => {
  const takte = { ...KURZE_DEPLOY_TAKTE, healthz: DEPLOY_TAKTE.healthz };
  const lauf = await rollbackMit(kontext, { welt: { wach: [false, true] }, takte });
  assert.equal(lauf.ok, true, lauf.text);
  assert.match(lauf.text, /Produktion hat geschlafen und ist frisch geweckt/);
});

test("zurueckrollen ist rot, wenn die Negativproben oder POST /mcp ohne Anmeldung abweichen", async (kontext) => {
  const faelle = [{ probeExit: EXIT_ROT }, { welt: { mcpStatus: HTTP_OK } }];
  for (const fall of faelle) {
    const lauf = await rollbackMit(kontext, fall);
    assert.equal(lauf.ok, false);
    assert.equal(lauf.probeAufrufe.length, 1);
    assert.equal(anfragenAn(lauf.attrappe, "POST", /\/prod\/mcp$/).length, 1);
    assert.doesNotMatch(lauf.text, /Probeanruf/);
  }
});

test("zurueckrollen in GitHub Actions verlangt, dass alle Akteure freigeben dürfen", async (kontext) => {
  const faelle = [
    { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "fremd", GITHUB_TRIGGERING_ACTOR: "" },
    { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "Antonio20045", GITHUB_TRIGGERING_ACTOR: "fremd" },
    { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "", GITHUB_TRIGGERING_ACTOR: "" },
  ];
  for (const mehr of faelle) {
    const lauf = await rollbackMit(kontext, { mehr });
    assert.equal(lauf.ok, false);
    assert.deepEqual(lauf.zeilen, ["Rot: Hand-Start durch einen Nutzer ohne Freigaberecht"]);
    assert.deepEqual(lauf.attrappe.anfragen, []);
  }
});

test("zurueckrollen: freigebende Akteure in Actions und jeder Start vom Mac dürfen zurückrollen", async (kontext) => {
  const faelle = [
    { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "Antonio20045", GITHUB_TRIGGERING_ACTOR: "jonas986" },
    { GITHUB_ACTIONS: "false", GITHUB_ACTOR: "fremd" },
    { GITHUB_ACTOR: "fremd" },
  ];
  for (const mehr of faelle) {
    const lauf = await rollbackMit(kontext, { mehr });
    assert.equal(lauf.ok, true, lauf.text);
    assert.deepEqual(rollbackKoerper(lauf), [{ deployId: "dep-p" }]);
  }
});

function ohneMasken(text) {
  return text
    .split("\n")
    .filter((zeile) => !zeile.startsWith(MASKE))
    .join("\n");
}

test("CLI zurueckrollen mit ungültigem Ziel meldet den Aufruf und fragt nichts ab", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, lageFuer({}));
  const faelle = [
    ["zurueckrollen"],
    ["zurueckrollen", "--ziel", "master"],
    ["zurueckrollen", "--ziel", "abc"],
  ];
  for (const argumente of faelle) {
    const lauf = await werkzeugStarten(argumente, umgebungFuer(attrappe.basis));
    assert.equal(lauf.status, EXIT_ROT);
    assert.match(lauf.ausgabe, AUFRUF);
    assert.match(lauf.ausgabe, /Ergebnis: nein/);
  }
  assert.deepEqual(attrappe.anfragen, []);
});

test("CLI zurueckrollen ohne Render-Schlüssel nennt nur den Namen der Einstellung", async () => {
  const lauf = await werkzeugStarten(["zurueckrollen", "--ziel", "vorher"], {});
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: RENDER_API_KEY/);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: RENDER_SERVICE_ID/);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: PRODUKTION_URL/);
  assert.doesNotMatch(lauf.ausgabe, /HERMES_DEPLOY_TOKEN/);
});

test("CLI zurueckrollen lehnt einen ungültigen Wert für GITHUB_ACTIONS ab", async () => {
  const umgebung = umgebungFuer("http://127.0.0.1:9", { GITHUB_ACTIONS: "ja" });
  const lauf = await werkzeugStarten(["zurueckrollen", "--ziel", "vorher"], umgebung);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: GITHUB_ACTIONS/);
});

test("CLI zurueckrollen in Actions mit fremdem Akteur: Exit 1 ohne jeden Render-Aufruf", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, lageFuer({}));
  const umgebung = umgebungFuer(attrappe.basis, { GITHUB_ACTIONS: "true", GITHUB_ACTOR: "fremd" });
  const lauf = await werkzeugStarten(["zurueckrollen", "--ziel", "vorher"], umgebung);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Rot: Hand-Start durch einen Nutzer ohne Freigaberecht/);
  assert.deepEqual(attrappe.anfragen, []);
});

const GIT_OHNE_HOOKS = [
  ...["-c", "user.name=Probe", "-c", "user.email=probe@beispiel.invalid"],
  ...["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"],
];

function git(ordner, argumente) {
  const lauf = spawnSync("git", [...GIT_OHNE_HOOKS, ...argumente], {
    cwd: ordner,
    encoding: "utf8",
    env: withoutGitVariables(process.env),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  return lauf.stdout.trim();
}

const ANRUFPAUSE_ROUTE = join("src", "routes", "intern-anrufpause.js");
const OHNE_SCHLUESSEL = '[ -z "${RENDER_API_KEY:-}${HERMES_DEPLOY_TOKEN:-}" ] || exit 1';

function probeSkript(protokoll, exit) {
  return `${OHNE_SCHLUESSEL}\nprintf '%s\\n%s\\n' "$1" "$2" > '${protokoll}'\nexit ${exit}\n`;
}

function repoMitProben(kontext, { zielExit, aktuellExit, zielMitAnrufpause = false }) {
  const ordner = temporaerOrdner(kontext);
  const protokoll = join(ordner, "aufruf.txt");
  git(ordner, ["init", "-q"]);
  mkdirSync(join(ordner, "scripts"));
  mkdirSync(join(ordner, "src", "routes"), { recursive: true });
  if (zielMitAnrufpause) writeFileSync(join(ordner, ANRUFPAUSE_ROUTE), "export {};\n");
  const staende = [];
  for (const exit of [zielExit, aktuellExit]) {
    writeFileSync(join(ordner, "scripts", "probe-auth.sh"), probeSkript(protokoll, exit));
    git(ordner, ["add", "-A"]);
    git(ordner, ["commit", "-q", "-m", "Stand"]);
    staende.push(git(ordner, ["rev-parse", "HEAD"]));
  }
  return { ordner, protokoll, ziel: staende[0] };
}

function probeOrdner() {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("probe-auth-ziel-"));
}

function weltMitZiel(ziel, mehr = {}) {
  const zielDeploy = deploy("dep-z", ziel, { finishedAt: ENDE_P });
  return { deployListe: [DEPLOY_C, zielDeploy, DEPLOY_ALT], produktion: [COMMIT_C, ziel], ...mehr };
}

test("zurueckrollen startet die Negativproben aus dem Ziel-Commit, nicht aus dem aktuellen Stand", async (kontext) => {
  const repo = repoMitProben(kontext, { zielExit: EXIT_OK, aktuellExit: EXIT_ROT });
  const mehr = { GITHUB_WORKSPACE: repo.ordner };
  const welt = weltMitZiel(repo.ziel);
  const vorher = probeOrdner();
  const lauf = await rollbackMit(kontext, { welt, mehr, ziel: repo.ziel, echteProbe: true });
  assert.equal(lauf.ok, true, lauf.text);
  assert.deepEqual(probeOrdner(), vorher);
  assert.match(lauf.text, /Negativproben ohne Zugangsdaten gegen Produktion: Exit 0/);
  const aufruf = readFileSync(repo.protokoll, "utf8").split("\n");
  assert.deepEqual(aufruf, [lauf.attrappe.basis + "/prod", repo.ziel, ""]);
});

async function rollbackAufRepo(kontext, proben) {
  const repo = repoMitProben(kontext, proben);
  const lauf = await rollbackMit(kontext, {
    welt: weltMitZiel(repo.ziel),
    mehr: { GITHUB_WORKSPACE: repo.ordner },
    ziel: repo.ziel,
    echteProbe: true,
  });
  return { repo, lauf };
}

test("zurueckrollen warnt, wenn der Ziel-Stand die Anrufpause nicht kennt, und bleibt grün", async (kontext) => {
  const { repo, lauf } = await rollbackAufRepo(kontext, {
    zielExit: EXIT_OK,
    aktuellExit: EXIT_ROT,
  });
  assert.equal(lauf.ok, true, lauf.text);
  assert.ok(lauf.zeilen.includes(OHNE_ANRUFPAUSE));
  assert.ok(
    lauf.zeilen.indexOf(OHNE_ANRUFPAUSE) >
      lauf.zeilen.indexOf("Produktion fährt jetzt " + repo.ziel),
  );
});

test("zurueckrollen warnt nicht, wenn der Ziel-Stand die Anrufpause kennt", async (kontext) => {
  const { lauf } = await rollbackAufRepo(kontext, {
    zielExit: EXIT_OK,
    aktuellExit: EXIT_ROT,
    zielMitAnrufpause: true,
  });
  assert.equal(lauf.ok, true, lauf.text);
  assert.doesNotMatch(lauf.text, /kennt die Anrufpause nicht/);
});

test("zurueckrollen ist rot, wenn die Negativproben des Ziel-Commits abweichen, auch wenn die aktuellen passen", async (kontext) => {
  const { lauf } = await rollbackAufRepo(kontext, { zielExit: EXIT_ROT, aktuellExit: EXIT_OK });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Negativproben ohne Zugangsdaten gegen Produktion: Exit 1/);
  assert.doesNotMatch(lauf.text, /Probeanruf/);
});

test("zurueckrollen ist rot, wenn der Ziel-Commit im Repo fehlt, und stellt das Ausliefern trotzdem wieder her", async (kontext) => {
  const repo = repoMitProben(kontext, { zielExit: EXIT_OK, aktuellExit: EXIT_ROT });
  const welt = { dienst: [AN, AUS, AN] };
  const mehr = { GITHUB_WORKSPACE: repo.ordner };
  const lauf = await rollbackMit(kontext, { welt, mehr, echteProbe: true });
  assert.equal(lauf.ok, false);
  assert.match(
    lauf.text,
    /Rot: die Negativproben des Ziel-Commits lassen sich nicht aus Git holen/,
  );
  assert.deepEqual(patchKoerper(lauf), [{ autoDeployTrigger: "commit" }]);
  assert.match(lauf.text, /Automatisches Ausliefern wie vor dem Rollback: ja/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /\/prod\/mcp$/), []);
  assert.doesNotMatch(lauf.text, /Probeanruf/);
});

test("CLI zurueckrollen grün in Actions: genau ein Rollback, Proben des Ziel-Commits, Exit 0, Schlüssel nur in add-mask-Zeilen", async (kontext) => {
  const repo = repoMitProben(kontext, { zielExit: EXIT_OK, aktuellExit: EXIT_ROT });
  const welt = weltMitZiel(repo.ziel, { deployStatus: ["live"] });
  const attrappe = await attrappeStarten(kontext, lageFuer(welt));
  const umgebung = umgebungFuer(attrappe.basis, { GITHUB_WORKSPACE: repo.ordner, ...IN_ACTIONS });
  const lauf = await werkzeugStarten(["zurueckrollen", "--ziel", repo.ziel], umgebung);
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.deepEqual(
    anfragenAn(attrappe, "POST", ROLLBACK).map(({ koerper }) => koerper),
    [{ deployId: "dep-z" }],
  );
  assert.ok(
    lauf.ausgabe.includes(
      "Jetzt Probeanruf an eine Nummer von Sundartha; er muss gelingen.\n" +
        LIVE_WIEDER_AN +
        "\nErgebnis: ja",
    ),
  );
  assert.doesNotMatch(lauf.ausgabe, /Vom Mac/);
  assert.ok(lauf.ausgabe.includes(MASKE + RENDER_SCHLUESSEL));
  assert.ok(!ohneMasken(lauf.ausgabe).includes(RENDER_SCHLUESSEL));
  assert.ok(!ohneMasken(lauf.ausgabe).includes("127.0.0.1"));
});

test("CLI zurueckrollen vom Mac: weder Render-Schlüssel noch Deploy-Token stehen in der Ausgabe, live-Zeilen vor und nach dem Rollback", async (kontext) => {
  const repo = repoMitProben(kontext, { zielExit: EXIT_OK, aktuellExit: EXIT_ROT });
  const welt = weltMitZiel(repo.ziel, { deployStatus: ["live"] });
  const attrappe = await attrappeStarten(kontext, lageFuer(welt));
  const umgebung = umgebungFuer(attrappe.basis, { GITHUB_WORKSPACE: repo.ordner });
  const lauf = await werkzeugStarten(["zurueckrollen", "--ziel", repo.ziel], umgebung);
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.ok(!lauf.ausgabe.includes(RENDER_SCHLUESSEL));
  assert.ok(!lauf.ausgabe.includes(DEPLOY_TOKEN));
  assert.ok(!lauf.ausgabe.includes(MASKE));
  const zeilen = lauf.ausgabe.split("\n");
  assert.equal(zeilen[0], LIVE_AUS_VOM_MAC);
  assert.ok(zeilen.indexOf(LIVE_WIEDER_AN) > zeilen.indexOf("Rollback angefordert: HTTP 201"));
});

test("CLI zurueckrollen: die Proben des Ziels sehen weder die Schlüssel noch die Git-Umgebung des Aufrufs", async (kontext) => {
  const repo = repoMitProben(kontext, { zielExit: EXIT_OK, aktuellExit: EXIT_ROT });
  const welt = weltMitZiel(repo.ziel, { deployStatus: ["live"] });
  const attrappe = await attrappeStarten(kontext, lageFuer(welt));
  const umgebung = umgebungFuer(attrappe.basis, {
    GITHUB_WORKSPACE: repo.ordner,
    GIT_DIR: join(repo.ordner, "kein-repo"),
  });
  assert.ok(umgebung.RENDER_API_KEY !== "" && umgebung.HERMES_DEPLOY_TOKEN !== "");
  const lauf = await werkzeugStarten(["zurueckrollen", "--ziel", repo.ziel], umgebung);
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.match(lauf.ausgabe, /Negativproben ohne Zugangsdaten gegen Produktion: Exit 0/);
});

test("CLI zurueckrollen ohne den Ziel-Commit im Repo: Rollback läuft, Exit 1", async (kontext) => {
  const repo = repoMitProben(kontext, { zielExit: EXIT_OK, aktuellExit: EXIT_ROT });
  const attrappe = await attrappeStarten(kontext, lageFuer({ deployStatus: ["live"] }));
  const umgebung = umgebungFuer(attrappe.basis, { GITHUB_WORKSPACE: repo.ordner });
  const lauf = await werkzeugStarten(["zurueckrollen", "--ziel", COMMIT_P], umgebung);
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(anfragenAn(attrappe, "POST", ROLLBACK).length, 1);
  assert.match(lauf.ausgabe, new RegExp("Produktion fährt jetzt " + COMMIT_P));
  assert.match(
    lauf.ausgabe,
    /Rot: die Negativproben des Ziel-Commits lassen sich nicht aus Git holen/,
  );
});
