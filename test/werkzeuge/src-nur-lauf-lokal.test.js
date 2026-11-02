import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ANFANGSDATEIEN, EXIT_BEFUND, EXIT_OK, aendereA, gitIn, json, sha } from "./src-nur-lauf-hilfen.js";
import { REPO_ROOT, probeDirectory, probeRepository } from "./probe-repo.js";
import { scheinGithub } from "./pruefer/hilfen.mjs";
import { API_PFAD, REPO, saubereUmgebung } from "./warteschlange/hilfen.mjs";

const AUSFUEHRBAR = 0o755;
const NUMMER = 7;
const ZWEIG = "paket/PRB-probe";
const LISTE = "tools/basis/altbestand-ohne-auftrag.json";
const EINTRAG = { kuerzel: "PRB", grund: "Probe: Kurzauftrag vor SLN, Antonio approvt selbst" };
const WARTET = /Altbestand: wartet auf Antonios Approve am Kopf/;
const OHNE_ZEILE = /keine einzelne Zeile „Auftrag: <Phase>\/<Auftrag>“/;

function echterBefehl() {
  const { schritte } = JSON.parse(readFileSync(join(REPO_ROOT, "tools/ci-lokal.json"), "utf8"));
  const { befehl } = schritte.find(({ name }) => name === "src-nur-lauf");
  return befehl.replace(/node (tools\/\S+)/g, (_, pfad) => `node ${JSON.stringify(join(REPO_ROOT, pfad))}`);
}

function ghMitOffenenPrs(offen) {
  const antwort = JSON.stringify(offen.map((number) => ({ number })));
  return [
    "#!/usr/bin/env node",
    "const argumente = process.argv.slice(2);",
    `const gefragt = argumente[0] === "pr" && argumente[1] === "list" && argumente[argumente.indexOf("--head") + 1] === ${JSON.stringify(ZWEIG)} && argumente.includes("open");`,
    "if (!gefragt) process.exit(1);",
    `console.log(${JSON.stringify(antwort)});`,
    "",
  ].join("\n");
}

function laufe(befehl, { cwd, umgebung }) {
  return new Promise((fertig) => {
    execFile("/bin/sh", ["-c", `exec 2>&1\n${befehl}`], { cwd, env: saubereUmgebung(umgebung) }, (fehler, stdout) => {
      fertig({ status: fehler === null ? 0 : (fehler.code ?? 1), ausgabe: stdout });
    });
  });
}

async function pruefeLokal(context, { offen = [NUMMER], pr = {}, reviews = (kopf) => [{ user: { login: "Antonio20045" }, state: "APPROVED", commit_id: kopf }] } = {}) {
  const repo = probeRepository(context, { ...ANFANGSDATEIEN, [LISTE]: json({ [NUMMER]: EINTRAG }) });
  gitIn(repo, "checkout", "-q", "-b", ZWEIG);
  const basis = sha(repo);
  aendereA(repo, "Ändere a.js von Hand\n");
  const kopf = sha(repo);
  const routen = new Map([
    [`GET ${API_PFAD}/pulls/${NUMMER}`, { head: { sha: kopf } }],
    [`GET ${API_PFAD}/pulls/${NUMMER}/reviews`, reviews(kopf)],
  ]);
  const github = await scheinGithub(context, routen);
  const werkzeug = probeDirectory(context, { "gh.mjs": ghMitOffenenPrs(offen) });
  chmodSync(join(werkzeug, "gh.mjs"), AUSFUEHRBAR);
  const umgebung = { BASIS: basis, HERMES_GH: join(werkzeug, "gh.mjs"), GITHUB_API_URL: github.url, GITHUB_TOKEN: "probe", GITHUB_REPOSITORY: REPO, ...pr };
  return { ...(await laufe(echterBefehl(), { cwd: repo, umgebung })), anfragen: github.anfragen };
}

test("ci-lokal prüft src-nur-lauf mit der PR-Nummer des offenen PR zum Zweig: ein gelisteter Altbestand-PR mit Approve am Kopf ist grün wie in der CI", async (context) => {
  const lauf = await pruefeLokal(context);
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.doesNotMatch(lauf.ausgabe, OHNE_ZEILE);
});

test("ci-lokal nennt bei einem gelisteten Altbestand-PR ohne Approve am Kopf den Grund der CI statt eines Verstoßes je Commit", async (context) => {
  const lauf = await pruefeLokal(context, { reviews: () => [] });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.ausgabe);
  assert.match(lauf.ausgabe, WARTET);
  assert.doesNotMatch(lauf.ausgabe, OHNE_ZEILE);
});

test("ohne offenen PR zum Zweig prüft ci-lokal src-nur-lauf streng und fragt GitHub nicht", async (context) => {
  const lauf = await pruefeLokal(context, { offen: [] });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.ausgabe);
  assert.match(lauf.ausgabe, OHNE_ZEILE);
  assert.deepEqual(lauf.anfragen, []);
});

test("bei mehr als einem offenen PR zum Zweig prüft ci-lokal src-nur-lauf streng", async (context) => {
  const lauf = await pruefeLokal(context, { offen: [NUMMER, NUMMER + 1] });
  assert.equal(lauf.status, EXIT_BEFUND, lauf.ausgabe);
  assert.match(lauf.ausgabe, OHNE_ZEILE);
});

test("mit der PR-Nummer aus --pr prüft ci-lokal src-nur-lauf wie im PR, auch wenn der ausgecheckte Zweig selbst keinen PR hat", async (context) => {
  const lauf = await pruefeLokal(context, { offen: [], pr: { PR: String(NUMMER) } });
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  assert.doesNotMatch(lauf.ausgabe, OHNE_ZEILE);
});
