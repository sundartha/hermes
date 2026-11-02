import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const WERKZEUG = join(REPO_ROOT, "tools/approve-inhalt.mjs");
const PR = 7;
const PR_REF = `refs/pull/${PR}/head`;
const ANTONIO = "Antonio20045";
const ZAHL = "src/zahl.js";
const NAME = "src/name.js";
const ZAHL_ALT = "export const ZAHL = 1;\nexport const ANDERE = 1;\n";
const ZAHL_NEU = "export const ZAHL = 2;\nexport const ANDERE = 1;\n";
const ZAHL_MIT_ZEILE = "export const ZAHL = 2;\nexport const ANDERE = 3;\n";
const ZAHL_AUFGELOEST = "export const ZAHL = 4;\nexport const ANDERE = 1;\n";
const UNBEKANNTER_STAND = "0123456789abcdef0123456789abcdef01234567";
const BASIS_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const FALSCHE_EREIGNISSE = [
  ["push", { pull_request: { number: PR, base: { sha: BASIS_SHA } } }],
  ["pull_request", {}],
  ["pull_request", { pull_request: { number: "7", base: { sha: BASIS_SHA } } }],
  ["pull_request", { pull_request: { number: 0, base: { sha: BASIS_SHA } } }],
  ["pull_request", { pull_request: { number: PR, base: {} } }],
  ["merge_group", { merge_group: { base_sha: BASIS_SHA, head_ref: "feature/pr-7-abcdef0" } }],
  ["merge_group", { merge_group: { head_ref: `gh-readonly-queue/master/pr-${PR}-abcdef0` } }],
];
const EXIT_OK = 0;
const EXIT_ROT = 1;
const NEU_NOETIG = /^Neues Approve nötig\.$/m;
const ZWECK = /^Wozu: Ein Approve gilt für genau die Änderung, die Antonio gesehen hat\./m;

function approve(login, stand, state = "APPROVED") {
  return { user: { login }, state, commit_id: stand, submitted_at: "2026-11-02T12:00:00Z" };
}

function freigegeben(context) {
  const repo = wegwerfRepo(context, { [ZAHL]: ZAHL_ALT, [NAME]: "export const NAME = 'a';\n" });
  repo.git(["checkout", "-q", "-b", "zahl"]);
  const stand = repo.committe({ [ZAHL]: ZAHL_NEU }, "Setze ZAHL auf 2");
  repo.git(["push", "-q", "origin", `HEAD:${PR_REF}`]);
  return { repo, stand };
}

function masterWeiter(repo, aenderung) {
  repo.git(["checkout", "-q", "master"]);
  const basis = repo.committe(aenderung, "Anderer PR");
  repo.git(["push", "-q", "origin", "master"]);
  return basis;
}

function neuerKopf(repo, kopf) {
  repo.git(["push", "-q", "--force", "origin", `${kopf}:${PR_REF}`]);
  return kopf;
}

function prEreignis(basis) {
  return ["pull_request", { pull_request: { number: PR, base: { sha: basis } } }];
}

function umgebungFuer(context, url, [name, daten]) {
  const ordner = probeDirectory(context, { "ereignis.json": JSON.stringify(daten) });
  return {
    GITHUB_API_URL: url,
    GITHUB_TOKEN: "probe",
    GITHUB_REPOSITORY: REPO,
    GITHUB_EVENT_NAME: name,
    GITHUB_EVENT_PATH: join(ordner, "ereignis.json"),
  };
}

async function pruefe(context, { repo, basis, kopf, reviews, ereignis = prEreignis(basis) }) {
  const github = await scheinGithub(
    context,
    new Map([
      [`GET ${API_PFAD}/pulls/${PR}`, { number: PR, head: { sha: kopf } }],
      [`GET ${API_PFAD}/pulls/${PR}/reviews`, reviews],
    ]),
  );
  return starteWerkzeug([WERKZEUG], {
    cwd: repo.ordner,
    umgebung: umgebungFuer(context, github.url, ereignis),
  });
}

function nachRebase(context) {
  const { repo, stand } = freigegeben(context);
  const basis = masterWeiter(repo, { [NAME]: "export const NAME = 'b';\n" });
  repo.git(["checkout", "-q", "zahl"]);
  repo.git(["rebase", "-q", "master"]);
  const kopf = neuerKopf(repo, repo.git(["rev-parse", "HEAD"]));
  return { repo, stand, basis, kopf };
}

function istRot(lauf) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, NEU_NOETIG);
  assert.match(lauf.stdout, ZWECK);
}

test("ein Approve bleibt nach einem Rebase ohne Inhaltsänderung gültig", async (context) => {
  const { repo, stand, basis, kopf } = nachRebase(context);
  assert.notEqual(kopf, stand);
  const lauf = await pruefe(context, { repo, basis, kopf, reviews: [approve(ANTONIO, stand)] });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(
    lauf.stdout,
    new RegExp(
      `^Approve gleicher Inhalt: ja, Approve von ${ANTONIO} auf dem Stand ${stand.slice(0, 7)}, `,
      "m",
    ),
  );
  assert.doesNotMatch(lauf.stdout, NEU_NOETIG);
});

test("eine nach dem Approve geänderte Zeile braucht ein neues Approve", async (context) => {
  const { repo, stand } = freigegeben(context);
  const basis = repo.git(["rev-parse", "master"]);
  const kopf = neuerKopf(repo, repo.committe({ [ZAHL]: ZAHL_MIT_ZEILE }, "Ändere ANDERE"));
  const lauf = await pruefe(context, { repo, basis, kopf, reviews: [approve(ANTONIO, stand)] });
  istRot(lauf);
  assert.match(
    lauf.stdout,
    new RegExp(`weicht vom Stand ${stand.slice(0, 7)} ab, den ${ANTONIO} freigegeben hat`),
  );
});

test("eine Konfliktauflösung beim Rebase, die den Inhalt ändert, braucht ein neues Approve", async (context) => {
  const { repo, stand } = freigegeben(context);
  const basis = masterWeiter(repo, {
    [ZAHL]: "export const ZAHL = 3;\nexport const ANDERE = 1;\n",
  });
  repo.git(["checkout", "-q", "-b", "zahl-neu", "master"]);
  const kopf = neuerKopf(repo, repo.committe({ [ZAHL]: ZAHL_AUFGELOEST }, "Setze ZAHL auf 2"));
  const lauf = await pruefe(context, { repo, basis, kopf, reviews: [approve(ANTONIO, stand)] });
  istRot(lauf);
});

test("ohne gültiges Approve eines Freigebers ist der Check rot", async (context) => {
  const { repo, stand, basis, kopf } = nachRebase(context);
  const faelle = [
    [],
    [approve("jemand-anderes", kopf)],
    [approve(ANTONIO, stand), approve(ANTONIO, stand, "CHANGES_REQUESTED")],
    [approve(ANTONIO, stand), approve(ANTONIO, stand, "DISMISSED")],
  ];
  for (const reviews of faelle) {
    const lauf = await pruefe(context, { repo, basis, kopf, reviews });
    istRot(lauf);
    assert.match(
      lauf.stdout,
      /^Es gibt kein gültiges Approve von Antonio20045 oder jonas986 im PR #7\.$/m,
    );
  }
});

test("ein Kommentar nach dem Approve hebt es nicht auf", async (context) => {
  const { repo, stand, basis, kopf } = nachRebase(context);
  const reviews = [approve(ANTONIO, stand), approve(ANTONIO, kopf, "COMMENTED")];
  const lauf = await pruefe(context, { repo, basis, kopf, reviews });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Approve gleicher Inhalt: ja, /m);
});

test("ein Approve auf einem nicht lesbaren Stand ist rot statt still gleich", async (context) => {
  const { repo, basis, kopf } = nachRebase(context);
  const lauf = await pruefe(context, {
    repo,
    basis,
    kopf,
    reviews: [approve(ANTONIO, UNBEKANNTER_STAND)],
  });
  istRot(lauf);
  assert.match(
    lauf.stdout,
    /^Der Stand 0123456 aus dem Approve von Antonio20045 ist nicht lesbar: /m,
  );
});

test("in der Warteschlange zählt das Approve nur bei gleichem Inhalt wie der freigegebene Stand", async (context) => {
  const { repo, stand, basis, kopf } = nachRebase(context);
  const ref = `refs/heads/gh-readonly-queue/master/pr-${PR}-${basis}`;
  const ereignis = ["merge_group", { merge_group: { base_sha: basis, head_ref: ref } }];
  repo.git(["checkout", "-q", "--detach", kopf]);
  const gleich = await pruefe(context, {
    repo,
    basis,
    kopf,
    reviews: [approve(ANTONIO, stand)],
    ereignis,
  });
  assert.equal(gleich.status, EXIT_OK, gleich.stdout + gleich.stderr);
  assert.match(gleich.stdout, /Patch-ID [0-9a-f]{40} gleich dem Inhalt in der Warteschlange\.$/m);
  repo.committe({ [ZAHL]: ZAHL_MIT_ZEILE }, "Nur in der Warteschlange");
  const anders = await pruefe(context, {
    repo,
    basis,
    kopf,
    reviews: [approve(ANTONIO, stand)],
    ereignis,
  });
  istRot(anders);
});

test("ein Fehler der GitHub-API ist rot und nennt den Abbruch", async (context) => {
  const { repo, basis } = nachRebase(context);
  const github = await scheinGithub(context, new Map());
  const lauf = await starteWerkzeug([WERKZEUG], {
    cwd: repo.ordner,
    umgebung: umgebungFuer(context, github.url, prEreignis(basis)),
  });
  istRot(lauf);
  assert.match(lauf.stdout, /^Approve gleicher Inhalt: Abbruch: .*HTTP 404/m);
});

test("ein freigegebener Stand, der nur noch auf GitHub liegt, wird für den Vergleich geholt", async (context) => {
  const { repo, stand, basis, kopf } = nachRebase(context);
  const klon = probeDirectory(context, {});
  assert.equal(runIn(klon, "git", ["clone", "-q", "--no-local", repo.origin, "."]).status, EXIT_OK);
  assert.notEqual(runIn(klon, "git", ["cat-file", "-e", `${stand}^{commit}`]).status, EXIT_OK);
  const lauf = await pruefe(context, {
    repo: { ordner: klon },
    basis,
    kopf,
    reviews: [approve(ANTONIO, stand)],
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Approve gleicher Inhalt: ja, /m);
});

test("ein PR ohne Inhalt gegen master ist auch mit Approve rot", async (context) => {
  const repo = wegwerfRepo(context, { [ZAHL]: ZAHL_ALT });
  const kopf = repo.git(["rev-parse", "HEAD"]);
  neuerKopf(repo, kopf);
  const lauf = await pruefe(context, {
    repo,
    basis: kopf,
    kopf,
    reviews: [approve(ANTONIO, kopf)],
  });
  istRot(lauf);
  assert.match(lauf.stdout, /^Der PR #7 hat am Kopf [0-9a-f]{7} keinen Inhalt\.$/m);
});

test("ein unbrauchbares Ereignis ist rot und fragt GitHub nicht", async (context) => {
  const github = await scheinGithub(context, new Map());
  for (const ereignis of FALSCHE_EREIGNISSE) {
    const lauf = await starteWerkzeug([WERKZEUG], {
      umgebung: umgebungFuer(context, github.url, ereignis),
    });
    istRot(lauf);
    assert.match(
      lauf.stdout,
      /^Approve gleicher Inhalt: Abbruch: (Das Ereignis|Keine PR-Nummer|Keine Basis)/m,
      JSON.stringify(ereignis),
    );
  }
  const ohneDatei = await starteWerkzeug([WERKZEUG], {
    umgebung: {
      GITHUB_API_URL: github.url,
      GITHUB_TOKEN: "probe",
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_NAME: "pull_request",
    },
  });
  istRot(ohneDatei);
  assert.match(
    ohneDatei.stdout,
    /^Approve gleicher Inhalt: Abbruch: Das Ereignis aus GITHUB_EVENT_PATH ist nicht lesbar: /m,
  );
  assert.deepEqual(github.anfragen, []);
});
