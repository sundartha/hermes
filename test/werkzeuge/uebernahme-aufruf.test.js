import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { festhaltungImProtokoll, pruefsumme } from "../../tools/uebernahme/festhaltung.mjs";
import { starte } from "./ausmisten/hilfen.mjs";
import { writeFiles } from "./probe-repo.js";
import {
  DATEI_A,
  DATEI_B,
  REPOSITORY,
  berichtText,
  erzeugerLauf,
  laufListe,
  schein,
  vereint,
  zweiBaeume,
} from "./uebernahme-hilfen.js";

const BAUM_TOOL = "tools/uebernahme/baum.mjs";
const RUNNER_IMAGE = { ImageOS: "ubuntu24", ImageVersion: "20261020.1" };
const GEMESSENE_KENNUNG = { node: process.version, image: "ubuntu24-20261020.1" };
const SCHATTEN_PFAD = ".pruefung/uebernahme-schatten.json";
const LISTE = "teil-dateien.txt";

function planArgumente(extra = []) {
  return ["planen", "--art", "ci", "--teil", "1", "--teile", "1", "--dateien", LISTE, ...extra];
}

async function aufrufUmgebung(context, { ereignis = "push", routen } = {}) {
  const repo = zweiBaeume(context);
  writeFiles(repo.ordner, { [LISTE]: `${DATEI_A}\n${DATEI_B}\n` });
  const erzeuger = erzeugerLauf({
    id: 11,
    workflow: "ci.yml",
    ereignis: "merge_group",
    kopf: repo.anderer,
    kennung: GEMESSENE_KENNUNG,
    teile: [
      { jobName: "Tests", berichtDatei: "dateien.jsonl", artefakt: "testlaufzeit-teil-1", dateien: [[DATEI_A, true], [DATEI_B, true]] },
    ],
  });
  const tabelle = routen ?? vereint(erzeuger.routen, laufListe("ci.yml", [erzeuger.lauf]));
  const { url } = await schein(context, tabelle);
  const umgebung = {
    ...RUNNER_IMAGE,
    GITHUB_EVENT_NAME: ereignis,
    GITHUB_REF: "refs/heads/master",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_API_URL: url,
    GH_TOKEN: "schein-token",
    GITHUB_STEP_SUMMARY: join(repo.ordner, "zusammenfassung.md"),
  };
  return { repo, umgebung };
}

function gelesenerPlan(repo) {
  return JSON.parse(readFileSync(join(repo.ordner, SCHATTEN_PFAD), "utf8"));
}

test("im Schattenmodus schreibt planen die Vorhersage und meldet sie in der Zusammenfassung", async (context) => {
  const { repo, umgebung } = await aufrufUmgebung(context);
  const lauf = await starte(BAUM_TOOL, { args: planArgumente(), cwd: repo.ordner, umgebung: { ...umgebung, UEBERNAHME: "schatten" } });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  const plan = gelesenerPlan(repo);
  assert.equal(plan.teilUebernehmbar, true);
  assert.equal(plan.baum, repo.anderer.baum);
  assert.match(readFileSync(umgebung.GITHUB_STEP_SUMMARY, "utf8"), /2 von 2 Dateien wären übernehmbar/);
});

test("ohne gesetzten Schalter gilt der Schattenmodus", async (context) => {
  const { repo, umgebung } = await aufrufUmgebung(context);
  const lauf = await starte(BAUM_TOOL, { args: planArgumente(), cwd: repo.ordner, umgebung });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.equal(gelesenerPlan(repo).modus, "schatten");
});

test("mit UEBERNAHME=aus wird nichts vorhergesagt und nichts geschrieben", async (context) => {
  const { repo, umgebung } = await aufrufUmgebung(context);
  const lauf = await starte(BAUM_TOOL, { args: planArgumente(), cwd: repo.ordner, umgebung: { ...umgebung, UEBERNAHME: "aus" } });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.equal(existsSync(join(repo.ordner, SCHATTEN_PFAD)), false);
});

test("UEBERNAHME=an ist noch nicht gebaut und bricht ab, statt stillschweigend zu übernehmen", async (context) => {
  const { repo, umgebung } = await aufrufUmgebung(context);
  const lauf = await starte(BAUM_TOOL, { args: planArgumente(), cwd: repo.ordner, umgebung: { ...umgebung, UEBERNAHME: "an" } });
  assert.equal(lauf.status, 2);
  assert.match(lauf.ausgabe, /nicht gebaut/);
});

test("fällt die GitHub-API aus, endet der Schattenlauf grün und hält den Fehler in der Vorhersage fest", async (context) => {
  const { repo, umgebung } = await aufrufUmgebung(context, { routen: new Map() });
  const lauf = await starte(BAUM_TOOL, { args: planArgumente(), cwd: repo.ordner, umgebung });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  const plan = gelesenerPlan(repo);
  assert.equal(plan.teilUebernehmbar, false);
  assert.match(plan.fehler, /HTTP 404/);
});

test("in einem pull_request-Lauf gibt es nichts zu übernehmen und nichts zu schreiben", async (context) => {
  const { repo, umgebung } = await aufrufUmgebung(context, { ereignis: "pull_request" });
  const lauf = await starte(BAUM_TOOL, { args: planArgumente(), cwd: repo.ordner, umgebung });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.equal(existsSync(join(repo.ordner, SCHATTEN_PFAD)), false);
});

test("festhalten schreibt eine Protokollzeile mit Prüfsumme, geprüftem Baum und Laufumgebung", async (context) => {
  const repo = zweiBaeume(context);
  const bericht = berichtText([[DATEI_A, true]]);
  writeFiles(repo.ordner, { "dateien.jsonl": bericht, ".pruefung/wackelig.json": JSON.stringify({ wackelig: [{ datei: DATEI_A, test: "x" }] }) });
  const lauf = await starte(BAUM_TOOL, {
    args: ["festhalten", "--bericht", "dateien.jsonl", "--name", "testlaufzeit-teil-1"],
    cwd: repo.ordner,
    umgebung: RUNNER_IMAGE,
  });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.deepEqual(festhaltungImProtokoll(lauf.ausgabe, "testlaufzeit-teil-1"), {
    summe: pruefsumme(bericht),
    baum: repo.anderer.baum,
    kennung: GEMESSENE_KENNUNG,
    wackelig: 1,
  });
});

test("festhalten bricht ab, wenn das Runner-Image nicht bekannt ist", async (context) => {
  const repo = zweiBaeume(context);
  writeFiles(repo.ordner, { "dateien.jsonl": berichtText([[DATEI_A, true]]) });
  const lauf = await starte(BAUM_TOOL, {
    args: ["festhalten", "--bericht", "dateien.jsonl", "--name", "testlaufzeit-teil-1"],
    cwd: repo.ordner,
    umgebung: { ImageOS: "", ImageVersion: "" },
  });
  assert.equal(lauf.status, 2);
});
