import assert from "node:assert/strict";
import { test } from "node:test";

import { scheinGithub } from "./pruefer/hilfen.mjs";
import {
  API_PFAD,
  CI_ROUTE,
  REPO,
  ciEreignis,
  warteschlange,
  wegwerfRepo,
} from "./warteschlange/hilfen.mjs";

const PR = 7;
const KURZ = 7;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const NEU = { "src/zahl.js": "export const ZAHL = 2;\n" };
const PRUEFER_ERFOLG = { context: "Prüfer", state: "success", creator: { login: "github-actions[bot]" } };

function stand(context, { inDerWarteschlange = NEU, gemergt = false }) {
  const repo = wegwerfRepo(context, {
    "src/zahl.js": "export const ZAHL = 1;\n",
    "src/name.js": "export const NAME = 'a';\n",
  });
  repo.git(["checkout", "-q", "-b", "zahl"]);
  const kopf = repo.committe(NEU, "Setze ZAHL auf 2");
  repo.git(["push", "-q", "origin", `HEAD:refs/pull/${PR}/head`]);
  repo.git(["checkout", "-q", "master"]);
  repo.committe({ "src/name.js": "export const NAME = 'b';\n" }, "Anderer PR");
  repo.git(["push", "-q", "origin", "master"]);
  repo.git(["checkout", "-q", "-b", "warteschlange"]);
  const queue = repo.committe(inDerWarteschlange, "Setze ZAHL auf 2");
  const zweig = `gh-readonly-queue/master/pr-${PR}-${queue}`;
  repo.git(["push", "-q", "origin", `HEAD:refs/heads/${zweig}`]);
  if (gemergt) repo.git(["push", "-q", "origin", "HEAD:refs/heads/master"]);
  repo.git(["checkout", "-q", "master"]);
  return { repo, kopf, queue, zweig };
}

async function uebertrage(context, { statusse = [PRUEFER_ERFOLG], ereignis = {}, ...optionen }) {
  const { repo, kopf, queue, zweig } = stand(context, optionen);
  const github = await scheinGithub(
    context,
    new Map([
      CI_ROUTE,
      [`GET ${API_PFAD}/pulls/${PR}`, { number: PR, head: { sha: kopf }, commits: 1 }],
      [`GET ${API_PFAD}/commits/${kopf}/statuses`, statusse],
      [`POST ${API_PFAD}/statuses/${queue}`, {}],
    ]),
  );
  const lauf = await warteschlange(["pruefer-status"], {
    cwd: repo.ordner,
    umgebung: {
      GITHUB_API_URL: github.url,
      GH_TOKEN: "probe",
      GITHUB_REPOSITORY: REPO,
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: "88",
      GITHUB_EVENT_PATH: ciEreignis(context, {
        event: "merge_group",
        conclusion: "success",
        head_sha: queue,
        head_branch: zweig,
        ...ereignis,
      }),
    },
  });
  const gesetzt = github.anfragen.filter(({ methode }) => methode === "POST").map(({ rumpf }) => rumpf);
  return { ...lauf, gesetzt, kopf };
}

test("Prüfer success am PR-Kopf und gleiche Änderung ergeben success auf dem Warteschlangen-Commit", async (context) => {
  const lauf = await uebertrage(context, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(lauf.gesetzt, [
    {
      state: "success",
      context: "Prüfer",
      description: `übernommen vom PR-Kopf ${lauf.kopf.slice(0, KURZ)}, gleiche Änderung`,
      target_url: "https://github.com/sundartha/hermes/actions/runs/88",
    },
  ]);
});

test("eine andere Änderung in der Warteschlange ergibt failure", async (context) => {
  const lauf = await uebertrage(context, {
    inDerWarteschlange: { "src/zahl.js": "export const ZAHL = 2; \n" },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(
    lauf.gesetzt.map(({ state }) => state),
    ["failure"],
  );
});

test("fehlt der Prüfer-Status am PR-Kopf, ist er rot oder von einem anderen Ersteller, ergibt das failure", async (context) => {
  const varianten = [
    [],
    [{ ...PRUEFER_ERFOLG, state: "failure" }],
    [{ ...PRUEFER_ERFOLG, creator: { login: "sundartha-agent[bot]" } }],
  ];
  for (const statusse of varianten) {
    const lauf = await uebertrage(context, { statusse });
    assert.equal(lauf.status, EXIT_OK, lauf.stderr);
    assert.deepEqual(
      lauf.gesetzt.map(({ state }) => state),
      ["failure"],
      JSON.stringify(statusse),
    );
  }
});

test("ein Lauf, der nicht aus ci.yml in der Warteschlange stammt, setzt keinen Status", async (context) => {
  const faelle = [{ event: "pull_request" }, { path: ".github/workflows/rotproben.yml" }];
  for (const ereignis of faelle) {
    const lauf = await uebertrage(context, { ereignis });
    assert.equal(lauf.status, EXIT_FEHLER, JSON.stringify(ereignis));
    assert.deepEqual(lauf.gesetzt, []);
  }
});

test("ein schon gemergter Warteschlangen-Commit bekommt keinen Status, aber eine Belegzeile", async (context) => {
  const lauf = await uebertrage(context, { gemergt: true });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(lauf.gesetzt, []);
  assert.match(lauf.stdout, /liegt schon auf master; würde success setzen \(übernommen vom PR-Kopf/);
});
