import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_PFAD,
  CI_ROUTE,
  REPO,
  ROTER_NAME,
  ROTER_TEST,
  ausgabeDatei,
  ciEreignis,
  ghErsatz,
  githubAttrappe,
  kaputterMerge,
  roteBelege,
  warteschlange,
} from "./warteschlange/hilfen.mjs";

const RUECKNAHME_PR = 8;
const BOT_TOKEN = "bot-probe-token";
const LAUF_TOKEN = "lauf-probe-token";
const ZWEIMAL_ROT = [{ datei: ROTER_TEST, test: ROTER_NAME, grund: "zweimal rot" }];
const STANDARD_RUECKNAHME = /^Revert ".+"\n\nThis reverts commit [0-9a-f]{40}\.$/;
const SHA_LAENGE = 40;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

async function nimmZurueck(context, optionen = {}) {
  const { pullAnpassung = {}, rot = ZWEIMAL_ROT, offen = [], ereignis = {}, ...merge } = optionen;
  const stand = kaputterMerge(context, merge);
  const pull = { ...stand.pull, ...pullAnpassung };
  const github = await githubAttrappe(
    context,
    new Map([
      CI_ROUTE,
      [`GET ${API_PFAD}/commits/${stand.zweiter}/pulls`, [pull]],
      [`GET ${API_PFAD}/commits/${stand.erster}/pulls`, [pull]],
      [`GET ${API_PFAD}/commits/${stand.basis}/pulls`, []],
      [`GET ${API_PFAD}/pulls`, offen],
      [`POST ${API_PFAD}/pulls`, { number: RUECKNAHME_PR, node_id: "PR_8" }],
      ["POST /graphql", { errors: [{ message: "nicht erlaubt" }] }],
    ]),
  );
  const gh = ghErsatz(context);
  const ausgabe = ausgabeDatei(context);
  const lauf = await warteschlange(["zuruecknehmen", "--ordner", roteBelege(context, rot)], {
    cwd: stand.repo.ordner,
    umgebung: {
      ...gh.umgebung,
      GITHUB_API_URL: github.url,
      GITHUB_GRAPHQL_URL: github.graphql,
      GH_TOKEN: LAUF_TOKEN,
      BOT_TOKEN,
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: ausgabe.pfad,
      GITHUB_EVENT_PATH: ciEreignis(context, {
        event: "push",
        head_branch: "master",
        conclusion: "failure",
        head_sha: stand.zweiter,
        ...ereignis,
      }),
    },
  });
  const revertZweig = stand.repo.imOrigin(["for-each-ref", "--format=%(refname)", "refs/heads/revert/"]);
  return {
    ...lauf,
    stand,
    github,
    ghAufrufe: gh.aufrufe(),
    ergebnis: ausgabe.werte().ergebnis,
    revertZweig,
    masterImOrigin: stand.repo.imOrigin(["rev-parse", "master"]),
  };
}

function nachrichtenAuf(repo, zweig) {
  const log = repo.imOrigin(["log", "--format=%B%x00", "-2", zweig]);
  return log
    .split("\0")
    .map((nachricht) => nachricht.trim())
    .filter(Boolean);
}

test("ein kaputter Merge wird als Rücknahme-PR mit zwei Standard-Reverts angelegt und mit --auto eingereiht", async (context) => {
  const lauf = await nimmZurueck(context);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.ergebnis, `zurueckgenommen:${RUECKNAHME_PR}`);
  assert.equal(lauf.revertZweig, "refs/heads/revert/7");
  const nachrichten = nachrichtenAuf(lauf.stand.repo, "revert/7");
  assert.equal(nachrichten.length, lauf.stand.pull.commits);
  for (const nachricht of nachrichten) assert.match(nachricht, STANDARD_RUECKNAHME);
  assert.ok(nachrichten[0].includes(lauf.stand.erster), "die ältere Änderung wird zuletzt zurückgenommen");
  const angelegt = lauf.github.anfragen.find(({ methode, pfad }) => methode === "POST" && pfad === `${API_PFAD}/pulls`);
  assert.equal(angelegt.token, BOT_TOKEN);
  assert.equal(angelegt.rumpf.title, "Rücknahme von #7");
  assert.equal(angelegt.rumpf.head, "revert/7");
  assert.equal(angelegt.rumpf.base, "master");
  assert.equal(lauf.stand.repo.imOrigin(["show", "revert/7:src/zahl.js"]), "export const ZAHL = 2;");
});

test("die Rücknahme pusht nie auf master und reiht nur mit --auto ein", async (context) => {
  const lauf = await nimmZurueck(context);
  assert.equal(lauf.masterImOrigin, lauf.stand.zweiter);
  assert.deepEqual(lauf.ghAufrufe, [
    { args: ["pr", "merge", String(RUECKNAHME_PR), "--repo", REPO, "--auto"], token: BOT_TOKEN },
  ]);
  const gesendet = lauf.github.anfragen.filter(({ methode }) => methode !== "GET");
  assert.ok(gesendet.every(({ token }) => token === BOT_TOKEN), JSON.stringify(gesendet));
});

test("ist master auch nach einer Rücknahme rot, gibt es keine zweite Rücknahme", async (context) => {
  const lauf = await nimmZurueck(context, { zweig: "revert/5" });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.ergebnis, /^master-rot:master ist auch nach der Rücknahme #7 rot$/);
  assert.equal(lauf.revertZweig, "");
  assert.deepEqual(lauf.ghAufrufe, []);
});

test("ändert der PR eine Workflow-Datei, gibt es keinen Revert-Versuch und keinen Push", async (context) => {
  const lauf = await nimmZurueck(context, {
    zweiterCommit: { ".github/workflows/probe.yml": "name: Probe\n" },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.match(lauf.ergebnis, /^master-rot:#7 ändert Workflow-Dateien/);
  assert.equal(lauf.revertZweig, "");
  assert.equal(lauf.stand.repo.git(["rev-parse", "HEAD"]), lauf.stand.zweiter);
});

test("ohne zweimal roten Test gibt es keine Rücknahme, sondern master-rot", async (context) => {
  const faelle = [[], [{ datei: null, test: null, grund: "rot ohne erkennbaren Test" }]];
  for (const rot of faelle) {
    const lauf = await nimmZurueck(context, { rot });
    assert.equal(lauf.status, EXIT_OK, lauf.stderr);
    assert.match(lauf.ergebnis, /^master-rot:kein Test ist zweimal rot/);
    assert.equal(lauf.revertZweig, "");
  }
});

test("liegt der rote Lauf nicht auf dem gemergten Stand, gibt es keine Rücknahme", async (context) => {
  const fremd = "a".repeat(SHA_LAENGE);
  const lauf = await nimmZurueck(context, { pullAnpassung: { merge_commit_sha: fremd } });
  assert.match(lauf.ergebnis, /^master-rot:der rote Lauf liegt nicht auf dem gemergten Stand von #7$/);
  assert.equal(lauf.revertZweig, "");
});

test("läuft schon ein Rücknahme-PR, entsteht kein zweiter", async (context) => {
  const lauf = await nimmZurueck(context, { offen: [{ number: 12 }] });
  assert.equal(lauf.ergebnis, "laeuft:12");
  assert.equal(lauf.revertZweig, "");
});

test("gehört ein Commit des Bereichs zu einem anderen PR, ist der Bereich unklar", async (context) => {
  const lauf = await nimmZurueck(context, { pullAnpassung: { commits: 3 } });
  assert.equal(lauf.ergebnis, "master-rot:Bereich unklar");
  assert.equal(lauf.revertZweig, "");
});

test("ein Lauf, der kein roter Push-Lauf von ci.yml auf master ist, nimmt nichts zurück", async (context) => {
  const faelle = [{ conclusion: "success" }, { event: "pull_request" }, { head_branch: "andere" }];
  for (const ereignis of faelle) {
    const lauf = await nimmZurueck(context, { ereignis });
    assert.equal(lauf.status, EXIT_FEHLER, JSON.stringify(ereignis));
    assert.equal(lauf.revertZweig, "");
    assert.equal(lauf.ergebnis, undefined);
  }
});
