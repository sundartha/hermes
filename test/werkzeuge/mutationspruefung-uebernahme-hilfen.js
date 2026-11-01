import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";

import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { HILFE, NEGATIV, NULLTEST, TESTBANK, ZAHLTEST, abgewandelt, ghAttrappe, holeVorergebnis, nachrundeRepo, quelle, temporaer, vorlaufRepo, werkzeugLauf } from "./mutationspruefung-nachrunde-hilfen.js";

const GEAENDERT = '  if (zahl <= -1) return "negativ";';
const AUSFUEHRBAR = 0o755;
const ANDERE = "export const ANDERE = 1;\n";
const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/hilfe.js": HILFE,
  "test/testbaenke-run.mjs": TESTBANK,
  "test/zahl.test.js": ZAHLTEST,
};

function rev(repo, ref) {
  const lauf = runIn(repo, "git", ["rev-parse", ref]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout.trim();
}

function messeAlteSeite(repo, basis, { datei, zusatz = [] }) {
  const lauf = werkzeugLauf(repo, ["--basis", basis, "--alter-stand", "--teil", "1", "--teile", "1", "--ergebnis", datei, ...zusatz]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return lauf.stdout;
}

function lesePruefung(datei) {
  return JSON.parse(readFileSync(datei, "utf8"));
}

export function zahlGemessen(teil) {
  return teil.messungen.flatMap(({ ergebnisse }) => ergebnisse).length;
}

export function vorlaufAlteSeite(aufraeumer) {
  const repo = probeRepository({ after: (aufgabe) => aufraeumer.push(aufgabe) }, BASIS);
  const ursprung = rev(repo, "HEAD");
  writeFiles(repo, { "src/andere.js": ANDERE });
  commitAll(repo, "Basis des Vorlaufs");
  const basis = rev(repo, "HEAD");
  writeFiles(repo, { "src/zahl.js": quelle(GEAENDERT) });
  commitAll(repo, "Runde 1");
  const ordner = temporaer(aufraeumer, "uebernahme-vorlauf-");
  messeAlteSeite(repo, basis, { datei: join(ordner, "mutation-teil-1.json") });
  const artefakte = temporaer(aufraeumer, "uebernahme-artefakte-");
  mkdirSync(join(artefakte, "mutation-teil-1"));
  cpSync(join(ordner, "mutation-teil-1.json"), join(artefakte, "mutation-teil-1", "mutation-teil-1.json"));
  return { repo, basis, ursprung, kopf: rev(repo, "HEAD"), artefakte, ordner };
}

export function folgerundeAlteSeite(vorlauf, aufraeumer, { dateien, basis = vorlauf.basis }) {
  const repo = nachrundeRepo(vorlauf, aufraeumer, { dateien });
  const attrappe = ghAttrappe(vorlauf, aufraeumer);
  const vorergebnis = join(temporaer(aufraeumer, "uebernahme-vorergebnis-"), "vorergebnis.json");
  const geholt = holeVorergebnis(repo, attrappe, { ziel: vorergebnis, basis });
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  const ordner = temporaer(aufraeumer, "uebernahme-folgerunde-");
  const ausgabe = messeAlteSeite(repo, basis, { datei: join(ordner, "mutation-teil-1.json"), zusatz: ["--vorergebnis", vorergebnis] });
  return { ausgabe, ordner, teil: lesePruefung(join(ordner, "mutation-teil-1.json")) };
}

const REPO = "probe/repo";
const PR_ZWEIG = "paket/probe";
const PR_NUMMER = 77;
const AUFRUF_GRENZE = "5000";
const PR_UMGEBUNG = {
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REF: `refs/pull/${PR_NUMMER}/merge`,
  GITHUB_REF_NAME: `${PR_NUMMER}/merge`,
  GITHUB_HEAD_REF: PR_ZWEIG,
  GITHUB_RUN_ID: AUFRUF_GRENZE,
  MUTATION_UEBERNAHME_PR: "schatten",
};
const WEITERLEITUNG = [
  "#!/usr/bin/env node",
  'const { spawnSync } = require("node:child_process");',
  'const { readFileSync } = require("node:fs");',
  'const { dirname, join } = require("node:path");',
  "const hier = dirname(process.argv[1]);",
  "const argumente = process.argv.slice(2);",
  'const einstellung = JSON.parse(readFileSync(join(hier, "listung.json"), "utf8"));',
  'if (argumente[0] === "api" && argumente[1].includes("/workflows/")) { process.stdout.write(JSON.stringify({ workflow_runs: einstellung.laeufe })); process.exit(0); }',
  'const weiter = spawnSync(join(einstellung.original, "gh"), argumente, { stdio: "inherit" });',
  "process.exit(weiter.status ?? 1);",
  "",
].join("\n");

export function prLauf(vorlauf, aenderungen = {}) {
  return {
    id: 4711,
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/ci.yml",
    event: "pull_request",
    head_branch: PR_ZWEIG,
    head_sha: vorlauf.kopf,
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
    pull_requests: [{ number: PR_NUMMER }],
    ...aenderungen,
  };
}

function prAttrappe(vorlauf, aufraeumer, { laeufe, lauf }) {
  const original = ghAttrappe(vorlauf, aufraeumer, { lauf: prLauf(vorlauf, lauf) });
  const ordner = temporaer(aufraeumer, "uebernahme-pr-gh-");
  writeFiles(ordner, { gh: WEITERLEITUNG, "listung.json": JSON.stringify({ laeufe, original }) });
  chmodSync(join(ordner, "gh"), AUSFUEHRBAR);
  return ordner;
}

export function mergeVorlauf(vorlauf, aufraeumer, umbau = (teil) => teil) {
  const baum = rev(vorlauf.repo, `${vorlauf.basis}^{tree}`);
  const identitaet = ["-c", "user.name=Probe", "-c", "user.email=probe@example.com"];
  const gemacht = runIn(vorlauf.repo, "git", [...identitaet, "commit-tree", baum, "-p", vorlauf.basis, "-p", vorlauf.kopf, "-m", "Merge des Pull Requests"]);
  assert.equal(gemacht.status, 0, gemacht.stderr);
  const merge = gemacht.stdout.trim();
  const gehalten = runIn(vorlauf.repo, "git", ["update-ref", `refs/heads/merge-${merge.slice(0, 7)}`, merge]);
  assert.equal(gehalten.status, 0, gehalten.stderr);
  const eigener = abgewandelt(vorlauf, aufraeumer, (teile) => teile.map((teil) => umbau({ ...teil, kopf: merge, baum })));
  return { ...eigener, kopfPr: vorlauf.kopf, kopfBasis: vorlauf.basis, merge, baum };
}

export function holeImPullRequest(vorlauf, aufraeumer, { dateien = {}, laeufe = [prLauf(vorlauf)], lauf = {}, umgebung = {} }) {
  const repo = nachrundeRepo(vorlauf, aufraeumer, { dateien: { "test/null.test.js": NULLTEST, ...dateien } });
  const ziel = join(temporaer(aufraeumer, "uebernahme-pr-vorergebnis-"), "vorergebnis.json");
  const geholt = holeVorergebnis(repo, prAttrappe(vorlauf, aufraeumer, { laeufe, lauf }), { ziel, basis: vorlauf.basis, aenderungen: { ...PR_UMGEBUNG, ...umgebung } });
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  return { repo, ziel, geholt };
}

export function teilberichte(ordner) {
  return readdirSync(ordner).map((name) => lesePruefung(join(ordner, name)));
}

export function schattenUebernehmbar(ordner) {
  return teilberichte(ordner).flatMap((teil) => teil.schatten?.uebernehmbar ?? []);
}

export function vorlaufJeDatei(frist) {
  const zustand = { aufraeumer: [], vorlauf: null };
  before(() => {
    zustand.vorlauf = vorlaufRepo(zustand.aufraeumer);
  }, frist);
  after(() => zustand.aufraeumer.forEach((aufgabe) => aufgabe()));
  return zustand;
}
