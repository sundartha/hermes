import assert from "node:assert/strict";
import { test } from "node:test";

import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, ausgabeDatei, warteschlange, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const PR = 7;
const LAUF_ADRESSE = "https://github.com/sundartha/hermes/actions/runs/41";
const NEU = { "src/zahl.js": "export const ZAHL = 2;\n" };
const MIT_LEERZEICHEN = { "src/zahl.js": "export const ZAHL = 2; \n" };
const SHA_HAELFTE = 20;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

function committeOderLeer(repo, aenderung, nachricht) {
  if (aenderung !== null) return repo.committe(aenderung, nachricht);
  repo.git(["commit", "-q", "--allow-empty", "-m", nachricht]);
  return repo.git(["rev-parse", "HEAD"]);
}

function stand(context, { pr, inDerWarteschlange }) {
  const repo = wegwerfRepo(context, {
    "src/zahl.js": "export const ZAHL = 1;\n",
    "src/name.js": "export const NAME = 'a';\n",
  });
  repo.git(["checkout", "-q", "-b", "zahl"]);
  const kopf = committeOderLeer(repo, pr, "Setze ZAHL auf 2");
  repo.git(["push", "-q", "origin", `HEAD:refs/pull/${PR}/head`]);
  repo.git(["checkout", "-q", "master"]);
  const basis = repo.committe({ "src/name.js": "export const NAME = 'b';\n" }, "Anderer PR");
  repo.git(["push", "-q", "origin", "master"]);
  committeOderLeer(repo, inDerWarteschlange, "Setze ZAHL auf 2");
  const ref = `refs/heads/gh-readonly-queue/master/pr-${PR}-${repo.git(["rev-parse", "HEAD"])}`;
  return { repo, basis, kopf, ref };
}

async function vergleiche(context, { pr = NEU, inDerWarteschlange = NEU, schluss = "success" }) {
  const { repo, basis, kopf, ref } = stand(context, { pr, inDerWarteschlange });
  const github = await scheinGithub(
    context,
    new Map([
      [`GET ${API_PFAD}/pulls/${PR}`, { number: PR, head: { sha: kopf } }],
      [
        `GET ${API_PFAD}/actions/workflows/ci.yml/runs`,
        { workflow_runs: [{ conclusion: schluss, html_url: LAUF_ADRESSE }] },
      ],
    ]),
  );
  const ausgabe = ausgabeDatei(context);
  const lauf = await warteschlange(["gleicher-stand", "--ref", ref, "--basis", basis], {
    cwd: repo.ordner,
    umgebung: {
      GITHUB_API_URL: github.url,
      GH_TOKEN: "probe",
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: ausgabe.pfad,
    },
  });
  return { ...lauf, kopf, ausgabe: ausgabe.werte(), anfragen: github.anfragen };
}

test("pr-nummer liest die Nummer aus dem Ref der Warteschlange und schreibt sie als Ausgabe", async (context) => {
  const refs = [
    ["gh-readonly-queue/master/pr-12-abcdef0", "12"],
    [`refs/heads/gh-readonly-queue/master/pr-345-${"a1".repeat(SHA_HAELFTE)}`, "345"],
  ];
  for (const [ref, nummer] of refs) {
    const ausgabe = ausgabeDatei(context);
    const lauf = await warteschlange(["pr-nummer", "--ref", ref], {
      umgebung: { GITHUB_OUTPUT: ausgabe.pfad },
    });
    assert.equal(lauf.status, EXIT_OK, lauf.stderr);
    assert.equal(lauf.stdout.trim(), nummer);
    assert.deepEqual(ausgabe.werte(), { pr: nummer });
  }
});

test("pr-nummer ist ohne pr-<Zahl>- im Ref rot und schreibt keine Ausgabe", async (context) => {
  const refs = [
    "gh-readonly-queue/master/pr-x-abcdef0",
    "feature/pr-12-abcdef0",
    "gh-readonly-queue/master/pr-12-abcde",
    "",
  ];
  for (const ref of refs) {
    const ausgabe = ausgabeDatei(context);
    const lauf = await warteschlange(["pr-nummer", "--ref", ref], {
      umgebung: { GITHUB_OUTPUT: ausgabe.pfad },
    });
    assert.equal(lauf.status, EXIT_FEHLER, ref);
    assert.deepEqual(ausgabe.werte(), {});
  }
});

test("gleiche Patch-ID und erfolgreicher CI-Lauf am PR-Kopf ergeben gleich=true mit Beleg", async (context) => {
  const lauf = await vergleiche(context, {});
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.deepEqual(lauf.ausgabe, { pr: String(PR), kopf: lauf.kopf, gleich: "true" });
  const [beleg] = lauf.stdout.split("\n");
  const [vorne, hinten] = beleg.split(", Patch-ID ");
  assert.equal(vorne, `Gleicher Stand: ja, PR #${PR}, Kopf ${lauf.kopf}`);
  assert.match(hinten, /^[0-9a-f]{40}, CI-Lauf /);
  assert.ok(hinten.endsWith(`CI-Lauf ${LAUF_ADRESSE}`), beleg);
});

test("ein roter CI-Lauf am PR-Kopf ergibt gleich=false trotz gleicher Patch-ID", async (context) => {
  const lauf = await vergleiche(context, { schluss: "failure" });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.ausgabe.gleich, "false");
  assert.match(lauf.stdout, /^Gleicher Stand: nein \(/m);
});

test("ein Leerzeichen Unterschied in der Warteschlange ergibt gleich=false", async (context) => {
  const lauf = await vergleiche(context, { inDerWarteschlange: MIT_LEERZEICHEN });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.ausgabe.gleich, "false");
});

test("zwei leere Änderungen sind nie gleich", async (context) => {
  const lauf = await vergleiche(context, { pr: null, inDerWarteschlange: null });
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.ausgabe.gleich, "false");
});

test("gleicher-stand ist ohne PR-Nummer im Ref rot und fragt GitHub nicht", async (context) => {
  const github = await scheinGithub(context, new Map());
  const lauf = await warteschlange(
    ["gleicher-stand", "--ref", "gh-readonly-queue/master/ohne-nummer", "--basis", "HEAD"],
    { umgebung: { GITHUB_API_URL: github.url, GH_TOKEN: "probe" } },
  );
  assert.equal(lauf.status, EXIT_FEHLER);
  assert.deepEqual(github.anfragen, []);
});

test("ein Fehler der GitHub-API ist rot statt still gleich", async (context) => {
  const { repo, basis, ref } = stand(context, { pr: NEU, inDerWarteschlange: NEU });
  const github = await scheinGithub(context, new Map());
  const lauf = await warteschlange(["gleicher-stand", "--ref", ref, "--basis", basis], {
    cwd: repo.ordner,
    umgebung: { GITHUB_API_URL: github.url, GH_TOKEN: "probe", GITHUB_REPOSITORY: REPO },
  });
  assert.equal(lauf.status, EXIT_FEHLER);
  assert.match(lauf.stderr, /HTTP 404/);
});
