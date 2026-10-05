import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { passingTest, probeDirectory } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import {
  API_PFAD,
  CI_ROUTE,
  REPO,
  ciEreignis,
  schreibAufrufe,
  warteschlange,
  wegwerfRepo,
} from "./warteschlange/hilfen.mjs";

const DATEI = "test/wackel.test.js";
const TEST = "wackelt manchmal";
const TITEL = `Wackelig: ${DATEI} › ${TEST}`;
const SHA_LAENGE = 40;
const LAUF_SHA = "e".repeat(SHA_LAENGE);
const FREMDE_SHA = "f".repeat(SHA_LAENGE);
const NEUES_ISSUE = 90;
const OFFENES_ISSUE = 91;
const ZU_LANG = 201;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

function beleg(eintraege) {
  return JSON.stringify({ format: 1, commit: FREMDE_SHA, lauf: null, wackelig: eintraege, rot: [] });
}

const GUELTIG = { datei: DATEI, test: TEST };
const UNGUELTIG = [
  { datei: "test/../tools/x.test.js", test: TEST },
  { datei: "test/fehlt.test.js", test: TEST },
  { datei: "src/wackel.js", test: TEST },
  { datei: DATEI, test: "mit\u0007Glocke" },
  { datei: DATEI, test: "x".repeat(ZU_LANG) },
];

async function halteFest(context, { issues = [], ereignis = {}, belege }) {
  const repo = wegwerfRepo(context, { [DATEI]: passingTest(TEST) });
  const ordner = probeDirectory(context, belege);
  const github = await scheinGithub(
    context,
    new Map([
      CI_ROUTE,
      [`GET ${API_PFAD}/issues`, issues],
      [`POST ${API_PFAD}/issues`, { number: NEUES_ISSUE }],
      [`POST ${API_PFAD}/issues/${OFFENES_ISSUE}/comments`, {}],
      [`PATCH ${API_PFAD}/issues/${OFFENES_ISSUE}`, {}],
    ]),
  );
  const lauf = await warteschlange(["wackelig", "--ordner", ordner], {
    cwd: repo.ordner,
    umgebung: {
      GITHUB_API_URL: github.url,
      GH_TOKEN: "probe",
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_PATH: ciEreignis(context, { event: "pull_request", head_sha: LAUF_SHA, ...ereignis }),
    },
  });
  const schreibend = github.anfragen.filter(({ methode }) => methode !== "GET");
  return { ...lauf, schreibend };
}

test("ein wackeliger Test wird genau ein Issue mit Commit und Lauf aus dem auslösenden Lauf", async (context) => {
  const lauf = await halteFest(context, {
    belege: {
      "wackelig-teil-1/wackelig.json": beleg([GUELTIG]),
      "wackelig-teil-2/wackelig.json": beleg([GUELTIG, ...UNGUELTIG]),
    },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.schreibend.length, 1, JSON.stringify(lauf.schreibend));
  const [neu] = lauf.schreibend;
  assert.equal(neu.pfad, `${API_PFAD}/issues`);
  assert.equal(neu.rumpf.title, TITEL);
  assert.deepEqual(neu.rumpf.labels, ["wackelig"]);
  assert.ok(neu.rumpf.body.includes(`Commit: ${LAUF_SHA}`), neu.rumpf.body);
  assert.ok(!neu.rumpf.body.includes(FREMDE_SHA), neu.rumpf.body);
});

test("bei einem offenen Issue mit demselben Titel kommt nur ein Kommentar dazu", async (context) => {
  const lauf = await halteFest(context, {
    issues: [{ number: OFFENES_ISSUE, title: TITEL, state: "open" }],
    belege: { "wackelig-teil-1/wackelig.json": beleg([GUELTIG]) },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(
    schreibAufrufe(lauf.schreibend),
    [`POST ${API_PFAD}/issues/${OFFENES_ISSUE}/comments`],
  );
  const [{ rumpf }] = lauf.schreibend;
  assert.ok(rumpf.body.includes(LAUF_SHA), rumpf.body);
});

test("ein geschlossenes Issue wird wieder geöffnet und bekommt den neuen Beleg", async (context) => {
  const lauf = await halteFest(context, {
    issues: [{ number: OFFENES_ISSUE, title: TITEL, state: "closed" }],
    belege: { "wackelig-teil-1/wackelig.json": beleg([GUELTIG]) },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(
    schreibAufrufe(lauf.schreibend),
    [`PATCH ${API_PFAD}/issues/${OFFENES_ISSUE}`, `POST ${API_PFAD}/issues/${OFFENES_ISSUE}/comments`],
  );
  assert.deepEqual(lauf.schreibend[0].rumpf, { state: "open" });
});

test("ungültige Einträge erzeugen kein Issue", async (context) => {
  const lauf = await halteFest(context, {
    belege: { "wackelig-teil-1/wackelig.json": beleg(UNGUELTIG), "kaputt/wackelig.json": "{" },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(lauf.schreibend, []);
});

test("ein Lauf aus einem anderen Workflow oder aus einem Fork schreibt nichts", async (context) => {
  const faelle = [
    { path: ".github/workflows/rotproben.yml" },
    { head_repository: { full_name: "fremd/hermes" } },
    { event: "workflow_dispatch" },
  ];
  for (const ereignis of faelle) {
    const lauf = await halteFest(context, {
      ereignis,
      belege: { [join("wackelig-teil-1", "wackelig.json")]: beleg([GUELTIG]) },
    });
    assert.equal(lauf.status, EXIT_FEHLER, JSON.stringify(ereignis));
    assert.deepEqual(lauf.schreibend, []);
  }
});
