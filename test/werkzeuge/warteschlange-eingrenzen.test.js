import assert from "node:assert/strict";
import { test } from "node:test";

import { phasenBefunde } from "../../tools/auftrag/format.mjs";
import {
  API_PFAD,
  CI_ROUTE,
  REPO,
  ROTER_NAME,
  ROTER_TEST,
  ciEreignis,
  githubAttrappe,
  kaputterMerge,
  roteBelege,
  warteschlange,
} from "./warteschlange/hilfen.mjs";

const REPARATUR_ISSUE = 95;
const OFFENES_ISSUE = 60;
const LAUF_TOKEN = "lauf-probe-token";
const BESITZER = ["Antonio20045", "jonas986"];
const KURZ = 7;
const EXIT_OK = 0;
const VORLAGE = /```json\n([\s\S]*?)\n```/;

async function starte(context, { args, ereignis, offen = [], stand = kaputterMerge(context) }) {
  const github = await githubAttrappe(
    context,
    new Map([
      CI_ROUTE,
      [`GET ${API_PFAD}/commits/${stand.zweiter}/pulls`, [stand.pull]],
      [`GET ${API_PFAD}/commits/${stand.erster}/pulls`, [stand.pull]],
      [`GET ${API_PFAD}/issues`, offen],
      [`POST ${API_PFAD}/issues`, { number: REPARATUR_ISSUE }],
      [`PATCH ${API_PFAD}/issues/${REPARATUR_ISSUE}`, {}],
      [`POST ${API_PFAD}/issues/${OFFENES_ISSUE}/comments`, {}],
    ]),
  );
  const lauf = await warteschlange(args, {
    cwd: stand.repo.ordner,
    umgebung: {
      GITHUB_API_URL: github.url,
      GH_TOKEN: LAUF_TOKEN,
      GITHUB_REPOSITORY: REPO,
      HERMES_BISEKT_BEFEHL: process.execPath,
      GITHUB_EVENT_PATH: ciEreignis(context, { head_sha: stand.zweiter, ...ereignis }),
    },
  });
  const schreibend = github.anfragen.filter(({ methode }) => methode !== "GET");
  return { ...lauf, stand, schreibend };
}

function eingrenzen(context, ergebnis, weitere = {}) {
  const rot = [{ datei: ROTER_TEST, test: ROTER_NAME, grund: "zweimal rot" }];
  return starte(context, {
    args: ["eingrenzen", "--ergebnis", ergebnis, "--ordner", roteBelege(context, rot)],
    ereignis: { event: "push", head_branch: "master", conclusion: "failure" },
    ...weitere,
  });
}

test("nach einer Rücknahme nennt die Eingrenzung den auslösenden Commit und legt ein Reparatur-Issue mit Vorlage an", async (context) => {
  const lauf = await eingrenzen(context, "zurueckgenommen:8");
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const [angelegt, ergaenzt] = lauf.schreibend;
  assert.equal(angelegt.pfad, `${API_PFAD}/issues`);
  assert.equal(angelegt.rumpf.title, `Reparatur: ${ROTER_TEST} nach Rücknahme von #7`);
  assert.deepEqual(angelegt.rumpf.labels, ["reparatur"]);
  assert.equal(angelegt.token, LAUF_TOKEN);
  assert.ok(
    angelegt.rumpf.body.includes(`Eingeführt mit: ${lauf.stand.zweiter} Setze ZAHL auf 3`),
    angelegt.rumpf.body,
  );
  assert.ok(angelegt.rumpf.body.includes("Auftrag: phase-zahl/a1"), angelegt.rumpf.body);
  assert.equal(ergaenzt.pfad, `${API_PFAD}/issues/${REPARATUR_ISSUE}`);
  const phase = JSON.parse(VORLAGE.exec(ergaenzt.rumpf.body)[1]);
  assert.equal(phase.issue, REPARATUR_ISSUE);
  assert.equal(phase.auftraege[0].art, "fehlerbehebung");
  assert.equal(phase.auftraege[0].abnahme, ROTER_TEST);
  assert.deepEqual(phasenBefunde(phase, lauf.stand.repo.ordner), []);
});

test("ist master auch nach der Rücknahme rot, entsteht ein Issue master-rot für beide Besitzer", async (context) => {
  const lauf = await eingrenzen(context, "master-rot:master ist auch nach der Rücknahme #7 rot");
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.schreibend.length, 1);
  const [{ rumpf }] = lauf.schreibend;
  assert.equal(rumpf.title, `master rot: ${lauf.stand.zweiter.slice(0, KURZ)}`);
  assert.deepEqual(rumpf.labels, ["master-rot"]);
  assert.deepEqual(rumpf.assignees, BESITZER);
  assert.ok(rumpf.body.includes("auch nach der Rücknahme"), rumpf.body);
});

test("ist schon ein Issue master-rot offen, kommt ein Kommentar statt eines neuen Issues", async (context) => {
  const lauf = await eingrenzen(context, "master-rot:Bereich unklar", {
    offen: [{ number: OFFENES_ISSUE, title: "master rot: 1234567", labels: [{ name: "master-rot" }] }],
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(
    lauf.schreibend.map(({ methode, pfad }) => `${methode} ${pfad}`),
    [`POST ${API_PFAD}/issues/${OFFENES_ISSUE}/comments`],
  );
});

test("meldet die Rücknahme kein Ergebnis, entsteht ein Issue master-rot", async (context) => {
  const lauf = await eingrenzen(context, "");
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const [{ rumpf }] = lauf.schreibend;
  assert.deepEqual(rumpf.labels, ["master-rot"]);
  assert.ok(rumpf.body.includes("kein Ergebnis"), rumpf.body);
});

test("läuft schon eine Rücknahme, schreibt die Eingrenzung nichts", async (context) => {
  const lauf = await eingrenzen(context, "laeuft:12");
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(lauf.schreibend, []);
});

test("ein roter Rücknahme-PR wird als master-rot gemeldet", async (context) => {
  const lauf = await starte(context, {
    args: ["melden"],
    ereignis: { event: "pull_request", head_branch: "revert/7", conclusion: "failure" },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const [{ rumpf }] = lauf.schreibend;
  assert.deepEqual(rumpf.labels, ["master-rot"]);
  assert.ok(rumpf.body.includes("revert/7"), rumpf.body);
});

test("ein aus der Warteschlange gefallener PR wird als Issue gemeldet", async (context) => {
  const lauf = await starte(context, {
    args: ["melden"],
    ereignis: {
      event: "merge_group",
      head_branch: "gh-readonly-queue/master/pr-12-abcdef0",
      conclusion: "failure",
    },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const [{ rumpf }] = lauf.schreibend;
  assert.equal(rumpf.title, "Aus der Warteschlange gefallen: #12");
  assert.deepEqual(rumpf.assignees, BESITZER);
});

test("grüne Läufe und rote Läufe anderer PRs werden nicht gemeldet", async (context) => {
  const faelle = [
    { event: "merge_group", head_branch: "gh-readonly-queue/master/pr-12-abcdef0", conclusion: "success" },
    { event: "pull_request", head_branch: "zahl", conclusion: "failure" },
  ];
  for (const ereignis of faelle) {
    const lauf = await starte(context, { args: ["melden"], ereignis });
    assert.equal(lauf.status, EXIT_OK, lauf.stderr);
    assert.deepEqual(lauf.schreibend, [], JSON.stringify(ereignis));
  }
});
