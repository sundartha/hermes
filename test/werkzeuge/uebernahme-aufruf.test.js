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
  pullRequestRoute,
  schein,
  vereint,
  zweiBaeume,
} from "./uebernahme-hilfen.js";

const BAUM_TOOL = "tools/uebernahme/baum.mjs";
const RUNNER_IMAGE = { ImageOS: "ubuntu24", ImageVersion: "20261020.1" };
const GEMESSENE_KENNUNG = { node: process.version, image: "ubuntu24-20261020.1" };
const SCHATTEN_PFAD = ".pruefung/uebernahme-schatten.json";
const LISTE = "teil-dateien.txt";
const REST = "rest-dateien.txt";
const AUSGABE = "ausgabe.txt";
const UEBERNOMMEN_PFAD = ".pruefung/uebernommen.jsonl";
const WARTESCHLANGEN_REF = "refs/heads/gh-readonly-queue/master/pr-5-abcdef1";
const STUNDE_MS = 3_600_000;
const FUENFUNDZWANZIG_STUNDEN = 25;
const ERZEUGER_LAUF = 11;
const ERZEUGER_EREIGNIS = { push: "merge_group", pull_request: "merge_group", merge_group: "pull_request" };
const AUFRUF_REF = { push: "refs/heads/master", pull_request: "refs/heads/master", merge_group: WARTESCHLANGEN_REF };
const TEIL_JE_ART = {
  ci: { workflow: "ci.yml", jobName: "Tests", berichtDatei: "dateien.jsonl", artefakt: "testlaufzeit-teil-1" },
  pruefleiter: {
    workflow: "pruefleiter.yml",
    jobName: "Prüfleiter Werkzeugtests",
    berichtDatei: "werkzeugteil-1.jsonl",
    artefakt: "werkzeugteil-1",
  },
};
function planArgumente(extra = [], art = "ci") {
  return ["planen", "--art", art, "--teil", "1", "--teile", "1", "--dateien", LISTE, ...extra];
}

const BEIDE_ERGEBNISSE = [[DATEI_A, true], [DATEI_B, true]];

function vorStunden(stunden) {
  return new Date(Date.now() - stunden * STUNDE_MS).toISOString();
}

function erzeugerRouten(erzeuger, workflow) {
  const andere = Object.values(TEIL_JE_ART).map((teil) => teil.workflow).filter((name) => name !== workflow);
  return vereint(
    erzeuger.routen,
    laufListe(workflow, [erzeuger.lauf]),
    ...andere.map((name) => laufListe(name, [])),
    pullRequestRoute(),
  );
}

const AUFRUF_STANDARD = { ereignis: "push", art: "ci", erzeugt: BEIDE_ERGEBNISSE, liste: [DATEI_A, DATEI_B] };

async function aufrufUmgebung(context, gegeben = {}) {
  const { ereignis, art, routen, kopf, lauf, festhaltung, erzeugt, liste } = { ...AUFRUF_STANDARD, ...gegeben };
  const repo = zweiBaeume(context);
  writeFiles(repo.ordner, { [LISTE]: liste.map((datei) => `${datei}\n`).join(""), [DATEI_B]: "export {};\n" });
  const teil = TEIL_JE_ART[art];
  const erzeuger = erzeugerLauf({
    id: ERZEUGER_LAUF,
    workflow: teil.workflow,
    ereignis: ERZEUGER_EREIGNIS[ereignis],
    kopf: kopf?.(repo) ?? repo.anderer,
    kennung: GEMESSENE_KENNUNG,
    teile: [{ jobName: teil.jobName, berichtDatei: teil.berichtDatei, artefakt: teil.artefakt, dateien: erzeugt, festhaltung }],
    lauf: { created_at: vorStunden(1), ...lauf },
  });
  const { url } = await schein(context, routen ?? erzeugerRouten(erzeuger, teil.workflow));
  const umgebung = {
    ...RUNNER_IMAGE,
    GITHUB_EVENT_NAME: ereignis,
    GITHUB_REF: AUFRUF_REF[ereignis],
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_API_URL: url,
    GH_TOKEN: "schein-token",
    GITHUB_STEP_SUMMARY: join(repo.ordner, "zusammenfassung.md"),
    GITHUB_OUTPUT: join(repo.ordner, AUSGABE),
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

test("ein unbekannter Wert von UEBERNAHME bricht ab, statt stillschweigend zu übernehmen", async (context) => {
  const { repo, umgebung } = await aufrufUmgebung(context);
  const lauf = await starte(BAUM_TOOL, { args: planArgumente(), cwd: repo.ordner, umgebung: { ...umgebung, UEBERNAHME: "vielleicht" } });
  assert.equal(lauf.status, 2);
  assert.match(lauf.ausgabe, /unbekannt/);
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

async function planeMit(context, { modus = "an", extra = ["--rest", REST], ...aufruf } = {}) {
  const { repo, umgebung } = await aufrufUmgebung(context, aufruf);
  const lauf = await starte(BAUM_TOOL, {
    args: planArgumente(extra, aufruf.art),
    cwd: repo.ordner,
    umgebung: { ...umgebung, UEBERNAHME: modus },
  });
  return { repo, umgebung, lauf };
}

function zeilenVon(pfad) {
  return existsSync(pfad) ? readFileSync(pfad, "utf8").split("\n").filter((zeile) => zeile !== "") : null;
}

function weiterhinLaufend(repo) {
  return zeilenVon(join(repo.ordner, REST));
}

function gemeldeteZahl(repo) {
  return zeilenVon(join(repo.ordner, AUSGABE))?.at(-1) ?? null;
}

function uebernommeneZeilen(repo) {
  return zeilenVon(join(repo.ordner, UEBERNOMMEN_PFAD))?.map((zeile) => JSON.parse(zeile)) ?? null;
}

function assertAllesLaeuft(ergebnis) {
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.ausgabe);
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), [DATEI_A, DATEI_B]);
  assert.equal(gemeldeteZahl(ergebnis.repo), "uebrig=2");
  assert.equal(uebernommeneZeilen(ergebnis.repo), null);
}

function assertNichtsAusgelassen(ergebnis) {
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.ausgabe);
  assert.equal(weiterhinLaufend(ergebnis.repo), null);
  assert.equal(gemeldeteZahl(ergebnis.repo), null);
  assert.equal(uebernommeneZeilen(ergebnis.repo), null);
}

async function rufeFesthalten(ergebnis) {
  const lauf = await starte(BAUM_TOOL, {
    args: ["festhalten", "--bericht", "dateien.jsonl", "--name", "testlaufzeit-teil-1"],
    cwd: ergebnis.repo.ordner,
    umgebung: RUNNER_IMAGE,
  });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  return lauf;
}

async function festhalten(ergebnis) {
  const lauf = await rufeFesthalten(ergebnis);
  const pfad = join(ergebnis.repo.ordner, "dateien.jsonl");
  return { lauf, inhalt: readFileSync(pfad, "utf8"), zeilen: zeilenVon(pfad).map((zeile) => JSON.parse(zeile)) };
}

test("mit UEBERNAHME=an nimmt planen bei gleichem Baum alle übernommenen Dateien aus der Liste und nennt Lauf und Baum", async (context) => {
  const ergebnis = await planeMit(context);
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.ausgabe);
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), []);
  assert.equal(gemeldeteZahl(ergebnis.repo), "uebrig=0");
  const zusammenfassung = readFileSync(ergebnis.umgebung.GITHUB_STEP_SUMMARY, "utf8");
  assert.match(zusammenfassung, /2 von 2 Dateien übernommen, 0 laufen/);
  for (const datei of [DATEI_A, DATEI_B]) {
    assert.ok(zusammenfassung.includes(`- ${datei}: Lauf ${ERZEUGER_LAUF} (ci.yml), Baum ${ergebnis.repo.anderer.baum}`), zusammenfassung);
  }
});

test("mit UEBERNAHME=an übernimmt die Warteschlange die Dateien aus dem Lauf desselben PR", async (context) => {
  const ergebnis = await planeMit(context, { ereignis: "merge_group" });
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.ausgabe);
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), []);
  assert.equal(gemeldeteZahl(ergebnis.repo), "uebrig=0");
});

test("mit UEBERNAHME=an läuft nur die Datei weiter, deren Ergebnis im Erzeuger fehlt", async (context) => {
  const ergebnis = await planeMit(context, { liste: [DATEI_A, DATEI_B, "test/neu.test.js"] });
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.ausgabe);
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), ["test/neu.test.js"]);
  assert.equal(gemeldeteZahl(ergebnis.repo), "uebrig=1");
});

test("mit UEBERNAHME=an läuft alles, wenn der Baum des Erzeugers ein anderer ist", async (context) => {
  assertAllesLaeuft(await planeMit(context, { kopf: (repo) => repo.kopf }));
});

test("mit UEBERNAHME=an läuft alles, wenn der Erzeuger wackelige Tests hatte", async (context) => {
  assertAllesLaeuft(await planeMit(context, { festhaltung: { wackelig: 1 } }));
});

test("mit UEBERNAHME=an läuft alles, wenn das Ergebnis älter als 24 Stunden ist", async (context) => {
  assertAllesLaeuft(await planeMit(context, { lauf: { created_at: vorStunden(FUENFUNDZWANZIG_STUNDEN) } }));
});

test("mit UEBERNAHME=an läuft alles, wenn der Erzeuger aus einem fremden Repo stammt", async (context) => {
  assertAllesLaeuft(await planeMit(context, { lauf: { head_repository: { full_name: "fremd/hermes" } } }));
});

test("mit UEBERNAHME=an läuft alles, wenn der Erzeuger zu einem anderen PR gehört", async (context) => {
  assertAllesLaeuft(await planeMit(context, { ereignis: "merge_group", lauf: { pull_requests: [{ number: 9 }] } }));
});

test("mit UEBERNAHME=an läuft alles weiter und der Ausfall steht in der Zusammenfassung, wenn die GitHub-API ausfällt", async (context) => {
  const ergebnis = await planeMit(context, { routen: new Map() });
  assertAllesLaeuft(ergebnis);
  assert.match(readFileSync(ergebnis.umgebung.GITHUB_STEP_SUMMARY, "utf8"), /Übernahme ausgefallen/);
});

test("mit UEBERNAHME=an und ohne --rest bricht planen ab, weil sonst nichts die laufenden Dateien erfährt", async (context) => {
  const ergebnis = await planeMit(context, { extra: [] });
  assert.equal(ergebnis.lauf.status, 2);
  assert.equal(existsSync(join(ergebnis.repo.ordner, SCHATTEN_PFAD)), false);
});

test("mit UEBERNAHME=schatten lässt planen keine Datei aus", async (context) => {
  assertNichtsAusgelassen(await planeMit(context, { modus: "schatten" }));
});

test("mit UEBERNAHME=aus lässt planen keine Datei aus", async (context) => {
  assertNichtsAusgelassen(await planeMit(context, { modus: "aus" }));
});

test("mit UEBERNAHME=an lässt der Prüfleiter keine Werkzeugtests aus, wenn er sie in diesem Commit nicht fährt", async (context) => {
  const ergebnis = await planeMit(context, { ereignis: "merge_group", art: "pruefleiter", erzeugt: [[DATEI_B, true]], extra: ["--rest", REST, "--gewollt", "nein"] });
  assertNichtsAusgelassen(ergebnis);
});

test("mit UEBERNAHME=an lässt der Prüfleiter die übernommenen Werkzeugtests aus, wenn er sie in diesem Commit fährt", async (context) => {
  const ergebnis = await planeMit(context, { ereignis: "merge_group", art: "pruefleiter", erzeugt: [[DATEI_B, true]], extra: ["--rest", REST, "--gewollt", "ja"] });
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.ausgabe);
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), []);
  assert.deepEqual(uebernommeneZeilen(ergebnis.repo).map(({ datei, uebernommen }) => [datei, uebernommen.workflow]), [[DATEI_B, "pruefleiter.yml"]]);
});

const MESSUNG = { dauer_ms: 1234.5, ausklingen_ms: 5, tests_ms: 6, kind_ms: 7 };

test("festhalten schreibt die übernommenen Dateien mit Herkunft und ohne Laufzeit in den Bericht und hält ihn samt Prüfsumme fest", async (context) => {
  const ergebnis = await planeMit(context, { erzeugt: [[DATEI_A, true, MESSUNG], [DATEI_B, true, MESSUNG]] });
  const { lauf, inhalt, zeilen } = await festhalten(ergebnis);
  assert.deepEqual(
    zeilen.map(({ datei, bestanden }) => [datei, bestanden]),
    [
      [DATEI_A, true],
      [DATEI_B, true],
    ],
  );
  assert.deepEqual(
    zeilen.map((zeile) => Object.keys(zeile).filter((feld) => Object.keys(MESSUNG).includes(feld))),
    [[], []],
  );
  assert.equal(zeilen[0].uebernommen.lauf, ERZEUGER_LAUF);
  assert.equal(zeilen[0].uebernommen.workflow, "ci.yml");
  assert.equal(zeilen[0].uebernommen.baum, ergebnis.repo.anderer.baum);
  assert.equal(festhaltungImProtokoll(lauf.ausgabe, "testlaufzeit-teil-1").summe, pruefsumme(inhalt));
});

const WEITERGEGEBEN = { lauf: 7, workflow: "ci.yml" };

test("eine weitergegebene Datei behält Lauf und Zeitpunkt des ursprünglichen Erzeugers und trägt keine Laufzeit", async (context) => {
  const zeitpunkt = vorStunden(3);
  const ergebnis = await planeMit(context, { erzeugt: [[DATEI_A, true, { ...MESSUNG, uebernommen: { ...WEITERGEGEBEN, zeitpunkt } }], [DATEI_B, true]] });
  const { zeilen } = await festhalten(ergebnis);
  const weitergegeben = zeilen.find(({ datei }) => datei === DATEI_A);
  assert.deepEqual(weitergegeben.uebernommen, { ...WEITERGEGEBEN, zeitpunkt, baum: ergebnis.repo.anderer.baum });
  assert.equal(weitergegeben.dauer_ms, undefined);
});

test("eine weitergegebene Datei läuft, wenn ihr ursprüngliches Ergebnis älter als 24 Stunden ist", async (context) => {
  const alt = { ...WEITERGEGEBEN, zeitpunkt: vorStunden(FUENFUNDZWANZIG_STUNDEN) };
  const ergebnis = await planeMit(context, { erzeugt: [[DATEI_A, true, { uebernommen: alt }], [DATEI_B, true]] });
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), [DATEI_A]);
});

test("eine weitergegebene Datei läuft, wenn der Zeitpunkt des ursprünglichen Erzeugers fehlt", async (context) => {
  const ergebnis = await planeMit(context, { erzeugt: [[DATEI_A, true, { uebernommen: WEITERGEGEBEN }], [DATEI_B, true]] });
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), [DATEI_A]);
});

test("mit UEBERNAHME=an läuft alles und die Zusammenfassung nennt den Ausfall, wenn der Plan nicht berechenbar ist", async (context) => {
  const ergebnis = await planeMit(context, { extra: ["--rest", REST, "--dateien", "gibt-es-nicht.txt"] });
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.ausgabe);
  assert.equal(weiterhinLaufend(ergebnis.repo), null);
  assert.equal(gemeldeteZahl(ergebnis.repo), null);
  assert.match(readFileSync(ergebnis.umgebung.GITHUB_STEP_SUMMARY, "utf8"), /Übernahme ausgefallen.*alle Dateien laufen/);
});

test("festhalten hängt die übernommenen Dateien an den Bericht der gelaufenen Dateien an", async (context) => {
  const ergebnis = await planeMit(context, { erzeugt: [[DATEI_A, true]] });
  assert.deepEqual(weiterhinLaufend(ergebnis.repo), [DATEI_B]);
  writeFiles(ergebnis.repo.ordner, { "dateien.jsonl": berichtText([[DATEI_B, true]]) });
  const { zeilen } = await festhalten(ergebnis);
  assert.deepEqual(zeilen.map(({ datei }) => datei), [DATEI_B, DATEI_A]);
});

test("festhalten hält ohne Bericht und ohne übernommene Dateien nichts fest", async (context) => {
  const lauf = await rufeFesthalten(await planeMit(context, { modus: "aus" }));
  assert.equal(festhaltungImProtokoll(lauf.ausgabe, "testlaufzeit-teil-1"), undefined);
});
