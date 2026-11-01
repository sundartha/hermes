import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { planeUebernahme } from "../../tools/uebernahme/baum.mjs";
import { festhaltungImProtokoll, werkzeugBaum } from "../../tools/uebernahme/festhaltung.mjs";
import { starte } from "./ausmisten/hilfen.mjs";
import { commitAll, outputLines, PRUEFLEITER_TOOL, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import {
  JETZT,
  KENNUNG,
  REPOSITORY,
  erzeugerLauf,
  laufListe,
  pullRequestRoute,
  schein,
  vereint,
} from "./uebernahme-hilfen.js";

const FREI = "test/werkzeuge/frei.test.js";
const GELISTET = "test/werkzeuge/gelistet.test.js";
const LISTE = "tools/basis/werkzeugtests-mit-produkt.json";
const PRODUKT = "src/basis.js";
const PLAN = "plaene/P-1-probe/phase.json";
const WERKZEUG = "tools/werkzeug.mjs";
const BAUM_TOOL = "tools/uebernahme/baum.mjs";
const WARTESCHLANGEN_REF = "refs/heads/gh-readonly-queue/master/pr-5-abcdef1";
const ERZEUGER_LAUF = 41;
const STUNDE_MS = 3_600_000;
const REST = "rest-werkzeugtests.txt";
const FEHLER_MARKER = "gelisteter Werkzeugtest sieht den Produktfehler";
const PRUEFLEITER_TEIL = { jobName: "Prüfleiter Werkzeugtests", berichtDatei: "werkzeugteil-1.jsonl", artefakt: "werkzeugteil-1" };
const BEIDE_GRUEN = [[FREI, true], [GELISTET, true]];

function gelisteterTest() {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    `test(${JSON.stringify(FEHLER_MARKER)}, () => {`,
    `  assert.doesNotMatch(readFileSync(${JSON.stringify(PRODUKT)}, "utf8"), /kaputt/);`,
    "});",
    "",
  ].join("\n");
}

const DATEIEN = {
  "package.json": JSON.stringify({ name: "werkzeugbaum-probe", private: true, type: "module" }),
  [PRODUKT]: "export const wert = 1;\n",
  [PLAN]: "{}\n",
  "test/basis.test.js": 'import { test } from "node:test";\ntest("produkt", () => {});\n',
  "test/testbaenke-run.mjs": "export const harness = 1;\n",
  [WERKZEUG]: "export const werkzeug = 1;\n",
  "package-lock.json": "{}\n",
  ".github/workflows/pruefleiter.yml": "name: Prüfleiter\n",
  [FREI]: 'import { test } from "node:test";\ntest("frei", () => {});\n',
  [GELISTET]: gelisteterTest(),
  [LISTE]: JSON.stringify({ [GELISTET]: "liest src/basis.js" }),
};

function stand(ordner) {
  const lies = (ausdruck) => runIn(ordner, "git", ["rev-parse", ausdruck]).stdout.trim();
  return { sha: lies("HEAD"), baum: lies("HEAD^{tree}"), werkzeugbaum: werkzeugBaum("HEAD", ordner) };
}

function aendere(ordner, pfad) {
  appendFileSync(join(ordner, pfad), "export const kaputt = 1;\n");
  commitAll(ordner, `Änderung an ${pfad}`);
  return stand(ordner);
}

const GLEICHER_TEILBAUM = [PRODUKT, PLAN, "test/basis.test.js"];
const ANDERER_TEILBAUM = [WERKZEUG, FREI, LISTE, "test/testbaenke-run.mjs", "package-lock.json", ".github/workflows/pruefleiter.yml"];

test("der Werkzeug-Teilbaum bleibt bei Änderungen unter src, plaene und den Produkttests gleich und ändert sich bei allem anderen", (context) => {
  for (const [pfade, gleich] of [[GLEICHER_TEILBAUM, true], [ANDERER_TEILBAUM, false]]) {
    for (const pfad of pfade) {
      const ordner = probeRepository(context, DATEIEN);
      const vorher = stand(ordner);
      const nachher = aendere(ordner, pfad);
      assert.notEqual(nachher.baum, vorher.baum, pfad);
      assert.equal(nachher.werkzeugbaum === vorher.werkzeugbaum, gleich, pfad);
    }
  }
});

function pruefleiterLauf(erzeuger, { ereignis = "pull_request", dateien = BEIDE_GRUEN, festhaltung } = {}) {
  return erzeugerLauf({
    id: ERZEUGER_LAUF,
    workflow: "pruefleiter.yml",
    ereignis,
    kopf: erzeuger,
    baum: erzeuger.baum,
    teile: [{ ...PRUEFLEITER_TEIL, dateien, festhaltung: festhaltung ?? { werkzeugbaum: erzeuger.werkzeugbaum } }],
    lauf: ereignis === "pull_request" ? { pull_requests: [{ number: 5 }] } : {},
  });
}

async function planNach(context, geaendert, laufWahl = {}) {
  const ordner = probeRepository(context, DATEIEN);
  const erzeuger = stand(ordner);
  const verbraucher = aendere(ordner, geaendert);
  const lauf = pruefleiterLauf(erzeuger, laufWahl);
  const { github } = await schein(context, vereint(lauf.routen, laufListe("pruefleiter.yml", [lauf.lauf]), pullRequestRoute()));
  return planeUebernahme({
    art: "pruefleiter",
    teil: 1,
    dateien: [FREI, GELISTET],
    baum: verbraucher.baum,
    werkzeugbaum: verbraucher.werkzeugbaum,
    liste: [GELISTET],
    kennung: KENNUNG,
    github,
    repo: REPOSITORY,
    jetzt: JETZT,
    wurzel: ordner,
    ereignis: "merge_group",
    ref: WARTESCHLANGEN_REF,
  });
}

function entscheidungen(plan) {
  return plan.dateien.map(({ datei, uebernehmbar }) => [datei, uebernehmbar]);
}

test("ist nur src geändert, übernimmt der Prüfleiter die Dateien außerhalb der Liste, und die Dateien der Liste laufen", async (context) => {
  const plan = await planNach(context, PRODUKT);

  assert.deepEqual(entscheidungen(plan), [[FREI, true], [GELISTET, false]]);
  assert.equal(plan.dateien[0].quelle, ERZEUGER_LAUF);
  assert.match(plan.dateien[1].grund, /Liste/);
});

test("ist nur eine Plandatei geändert, übernimmt der Prüfleiter die Dateien außerhalb der Liste", async (context) => {
  assert.deepEqual(entscheidungen(await planNach(context, PLAN)), [[FREI, true], [GELISTET, false]]);
});

test("ist Werkzeugcode geändert, übernimmt der Prüfleiter keine Datei", async (context) => {
  for (const pfad of [WERKZEUG, FREI, LISTE]) {
    assert.deepEqual(entscheidungen(await planNach(context, pfad)), [[FREI, false], [GELISTET, false]], pfad);
  }
});

test("eine frühere Merge-Gruppe mit gleichem Werkzeug-Teilbaum liefert die Dateien außerhalb der Liste", async (context) => {
  const plan = await planNach(context, PRODUKT, { ereignis: "merge_group" });

  assert.deepEqual(entscheidungen(plan), [[FREI, true], [GELISTET, false]]);
});

test("ein Erzeuger ohne Werkzeugbaum im Protokoll liefert bei anderem ganzen Baum nichts", async (context) => {
  const plan = await planNach(context, PRODUKT, { festhaltung: {} });

  assert.deepEqual(entscheidungen(plan), [[FREI, false], [GELISTET, false]]);
});

test("eine Datei, die der Erzeuger selbst nur übernommen hat, wird über den Werkzeug-Teilbaum nicht weitergegeben", async (context) => {
  const weitergegeben = { uebernommen: { lauf: 7, workflow: "pruefleiter.yml", zeitpunkt: new Date(JETZT - STUNDE_MS).toISOString() } };
  const plan = await planNach(context, PRODUKT, { dateien: [[FREI, true, weitergegeben], [GELISTET, true]] });

  assert.deepEqual(entscheidungen(plan), [[FREI, false], [GELISTET, false]]);
});

test("festhalten nennt mit --mit-werkzeugbaum den Werkzeug-Teilbaum des geprüften Stands", async (context) => {
  const ordner = probeRepository(context, DATEIEN);
  writeFiles(ordner, { "bericht.jsonl": `${JSON.stringify({ datei: FREI, bestanden: true })}\n` });
  const umgebung = { ImageOS: "ubuntu24", ImageVersion: "20261020.1" };
  const args = ["festhalten", "--bericht", "bericht.jsonl", "--name", "werkzeugteil-1", "--mit-werkzeugbaum"];

  const lauf = await starte(BAUM_TOOL, { args, cwd: ordner, umgebung });

  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.equal(festhaltungImProtokoll(lauf.ausgabe, "werkzeugteil-1").werkzeugbaum, stand(ordner).werkzeugbaum);
});

async function warteschlangeNachWerkzeugPr(context) {
  const ordner = probeRepository(context, DATEIEN);
  const basis = stand(ordner);
  const erzeuger = aendere(ordner, WERKZEUG);
  aendere(ordner, PRODUKT);
  const lauf = erzeugerLauf({
    id: ERZEUGER_LAUF,
    workflow: "pruefleiter.yml",
    ereignis: "pull_request",
    kopf: erzeuger,
    baum: erzeuger.baum,
    kennung: { node: process.version, image: "ubuntu24-20261020.1" },
    teile: [{ ...PRUEFLEITER_TEIL, dateien: BEIDE_GRUEN, festhaltung: { werkzeugbaum: erzeuger.werkzeugbaum } }],
    lauf: { pull_requests: [{ number: 5 }], created_at: new Date(Date.now() - STUNDE_MS).toISOString() },
  });
  const { url } = await schein(context, vereint(lauf.routen, laufListe("pruefleiter.yml", [lauf.lauf]), pullRequestRoute()));
  return { ordner, basis, erzeuger, url };
}

test("ein gelisteter Werkzeugtest mit eingebautem Produktfehler wird trotz Übernahme rot", async (context) => {
  const { ordner, basis, erzeuger, url } = await warteschlangeNachWerkzeugPr(context);
  const umgebung = {
    ImageOS: "ubuntu24",
    ImageVersion: "20261020.1",
    UEBERNAHME: "an",
    GITHUB_EVENT_NAME: "merge_group",
    GITHUB_REF: WARTESCHLANGEN_REF,
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_API_URL: url,
    GH_TOKEN: "schein-token",
    GITHUB_STEP_SUMMARY: join(ordner, "zusammenfassung.md"),
    GITHUB_OUTPUT: join(ordner, "ausgabe.txt"),
  };
  const args = ["planen", "--art", "pruefleiter", "--teil", "1", "--teile", "1", "--rest", REST, "--gewollt", "ja"];

  const planung = await starte(BAUM_TOOL, { args, cwd: ordner, umgebung });
  const teil = runIn(ordner, process.execPath, [PRUEFLEITER_TOOL, "--basis", basis.sha, "--werkzeugteil", "1/1", "--werkzeugdateien", REST]);

  assert.equal(planung.status, 0, planung.ausgabe);
  assert.deepEqual(outputLines(readFileSync(join(ordner, REST), "utf8")), [GELISTET]);
  assert.ok(readFileSync(umgebung.GITHUB_STEP_SUMMARY, "utf8").includes(`- ${FREI}: Lauf ${ERZEUGER_LAUF} (pruefleiter.yml), Werkzeugbaum ${erzeuger.werkzeugbaum}`));
  assert.notEqual(teil.status, 0);
  assert.match(teil.stdout + teil.stderr, new RegExp(FEHLER_MARKER));
  const gelaufen = outputLines(readFileSync(join(ordner, ".pruefung/werkzeugteil-1.jsonl"), "utf8")).map((zeile) => JSON.parse(zeile).datei);
  assert.deepEqual(gelaufen, [GELISTET]);
});
