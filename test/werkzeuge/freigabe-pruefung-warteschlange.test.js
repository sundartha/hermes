import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, starteWerkzeug, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const WERKZEUG = join(REPO_ROOT, "tools/freigabe-pruefung.mjs");
const PR = 7;
const OHNE_NETZ = "http://127.0.0.1:9";
const EXIT_OK = 0;
const EXIT_ROT = 1;
const LESEND = "GET";

function manifest(skript, ende = "") {
  return `${JSON.stringify({ name: "probe", scripts: { test: skript } })}${ende}\n`;
}

function warteschlangenStand(context, inDerWarteschlange) {
  const repo = wegwerfRepo(context, { "package.json": manifest("node --test") });
  repo.git(["checkout", "-q", "-b", "skript"]);
  const kopf = repo.committe({ "package.json": manifest("node --test test/") }, "Ändere test");
  repo.git(["push", "-q", "origin", `HEAD:refs/pull/${PR}/head`]);
  repo.git(["checkout", "-q", "master"]);
  const basis = repo.committe({ "src/anders.js": "export const ANDERS = 1;\n" }, "Anderer PR");
  repo.git(["push", "-q", "origin", "master"]);
  repo.committe({ "package.json": inDerWarteschlange }, "Ändere test");
  const ref = `gh-readonly-queue/master/pr-${PR}-${repo.git(["rev-parse", "HEAD"])}`;
  return { repo, kopf, basis, ref };
}

async function pruefeInDerWarteschlange(context, { inDerWarteschlange, ref }) {
  const stand = warteschlangenStand(context, inDerWarteschlange);
  const github = await scheinGithub(
    context,
    new Map([
      [`GET ${API_PFAD}/pulls/${PR}`, { number: PR, head: { sha: stand.kopf }, labels: [] }],
      [
        `GET ${API_PFAD}/pulls/${PR}/reviews`,
        [{ user: { login: "Antonio20045" }, state: "APPROVED", commit_id: stand.kopf }],
      ],
      [`GET ${API_PFAD}/issues/${PR}/comments`, []],
    ]),
  );
  const args = ["--basis", stand.basis, "--warteschlange", ref ?? stand.ref];
  const lauf = await starteWerkzeug(
    [WERKZEUG, ...args, "--registry", OHNE_NETZ, "--downloads", OHNE_NETZ],
    {
      cwd: stand.repo.ordner,
      umgebung: { GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO },
    },
  );
  const schreibend = github.anfragen.filter(({ methode }) => methode !== LESEND);
  return { ...lauf, schreibend, anfragen: github.anfragen };
}

test("in der Warteschlange zählt die Freigabe auf dem PR-Kopf bei gleicher Änderung und nichts wird geschrieben", async (context) => {
  const lauf = await pruefeInDerWarteschlange(context, {
    inDerWarteschlange: manifest("node --test test/"),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Freigegeben von Antonio20045/);
  assert.deepEqual(lauf.schreibend, []);
});

test("weicht die Änderung in der Warteschlange um ein Leerzeichen ab, zählt die Freigabe nicht", async (context) => {
  const lauf = await pruefeInDerWarteschlange(context, {
    inDerWarteschlange: manifest("node --test test/", " "),
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /zählt in der Warteschlange nicht/);
  assert.deepEqual(lauf.schreibend, []);
});

test("ohne PR-Nummer im Ref ist die Freigabe-Prüfung rot und fragt GitHub nicht", async (context) => {
  const lauf = await pruefeInDerWarteschlange(context, {
    inDerWarteschlange: manifest("node --test test/"),
    ref: "gh-readonly-queue/master/ohne-nummer",
  });
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /Keine PR-Nummer/);
  assert.deepEqual(lauf.anfragen, []);
});

test("--pr und --warteschlange zusammen sind ein Aufruffehler", async () => {
  const ref = `gh-readonly-queue/master/pr-${PR}-abcdef0`;
  const lauf = await starteWerkzeug([WERKZEUG, "--basis", "HEAD", "--pr", String(PR), "--warteschlange", ref]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /Aufruf:/);
});
