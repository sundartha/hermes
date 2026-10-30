import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { REPO_ROOT, isolatedEnvironment, mitUpstreamMaster, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const AUSFUEHRBAR = 0o755;
export const EXIT_ROT = 1;
const ISSUE = 54;
const GH_OHNE_WIRKUNG = "true";

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const argumente = process.argv.slice(2);
const sitzung = argumente[argumente.indexOf(argumente.includes("--resume") ? "--resume" : "--session-id") + 1];
const prompt = readFileSync(0, "utf8");
const drehbuch = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"));
const startProtokoll = join(dirname(process.env.ERSATZ_DREHBUCH), "starts.jsonl");
const fruehereStarts = existsSync(startProtokoll) ? readFileSync(startProtokoll, "utf8").split("\\n").filter(Boolean).map((zeile) => JSON.parse(zeile)) : [];
const nummer = fruehereStarts.filter((start) => start.rolle === process.env.HERMES_ROLLE).length;
const ausfall = (drehbuch[process.env.HERMES_ROLLE + "-ausfall"] ?? [])[nummer];
const stelle = (schluessel) => drehbuch[schluessel + "#" + nummer] ?? drehbuch[schluessel];
const sperreBis = ausfall?.sperreMs ? Date.now() + ausfall.sperreMs : undefined;
appendFileSync(startProtokoll, JSON.stringify({ rolle: process.env.HERMES_ROLLE, sitzung, fortsetzung: argumente.includes("--resume"), zeit: Date.now(), sperreBis }) + "\\n");
if (ausfall) {
  if (sperreBis) {
    const sperre = join(execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim(), "auftrag-limit", "probe");
    mkdirSync(dirname(sperre), { recursive: true });
    writeFileSync(sperre, String(sperreBis));
  }
  for (const [pfad, inhalt] of Object.entries(ausfall.dateien ?? {})) {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, inhalt);
  }
  if (ausfall.festhalten) {
    execFileSync("git", ["add", "--", ...Object.keys(ausfall.dateien)]);
    execFileSync("git", ["commit", "-q", "-m", "Agent-Commit"]);
  }
  const zeilen = [...(ausfall.zeilen ?? []), { type: "result", is_error: true, result: ausfall.text }];
  await new Promise((fertig) => process.stdout.write(zeilen.map((zeile) => JSON.stringify(zeile) + "\\n").join(""), fertig));
  process.exit(1);
}
const nach = drehbuch.nach !== undefined && prompt.includes(drehbuch.nach) ? "-nach" : "";
const rolle = process.env.HERMES_ROLLE + nach + (prompt.includes("Überlebende Mutanten") ? "-nachrunde" : "");
writeFileSync(join(dirname(process.env.ERSATZ_DREHBUCH), "prompt-" + rolle + ".txt"), prompt);
if (drehbuch[rolle + "#" + nummer + "-beendet-lauf"]) {
  const lauf = execFileSync("ps", ["-o", "ppid=", "-p", String(process.ppid)], { encoding: "utf8" }).trim();
  process.kill(Number(lauf), "SIGKILL");
  process.exit(1);
}
const antwort = stelle(rolle + "-antwort") ?? "";
const angeboten = typeof antwort === "string" ? antwort : Object.entries(antwort).find(([angebot]) => prompt.includes(angebot))[1];
console.log(JSON.stringify({ type: "result", result: angeboten }));
for (const [alt, neu] of drehbuch[rolle + "-umbenennen"] ?? []) execFileSync("git", ["mv", alt, neu]);
for (const pfad of drehbuch[rolle + "-loeschen"] ?? []) execFileSync("git", ["rm", "-q", pfad]);
for (const [pfad, inhalt] of Object.entries(stelle(rolle) ?? {})) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
for (const [pfad, inhalt] of Object.entries(stelle(rolle + "-anhaengen") ?? {})) appendFileSync(pfad, inhalt);
const projekt = join(homedir(), ".claude", "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(projekt, { recursive: true });
const zeile = (id) => JSON.stringify({ message: { id, usage: { input_tokens: 10, output_tokens: 5 } } });
writeFileSync(join(projekt, sitzung + ".jsonl"), [zeile("a"), zeile("a"), zeile("b")].join("\\n"));
`;

export const BASIS = {
  "package.json": JSON.stringify({
    type: "module",
    scripts: { test: "node --test --test-reporter=tap", lint: "node -e 0", "test:betroffen": "node -e 0 --", "ci:lokal": "node -e 0 --" },
  }),
  ".gitignore": ".fortschritt/\n",
  ".github/CODEOWNERS": "/src/geschuetzt.js @probe\n",
  "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl;\n}\n",
  "src/text.js": "export function gross(text) {\n  return text.toUpperCase();\n}\n",
  "src/geschuetzt.js": "export const WERT = 1;\n",
  "test/text.test.js": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { gross } from "../src/text.js";',
    'test("gross", () => assert.equal(gross("a"), "A"));',
    "",
  ].join("\n"),
};

export const UMBAU = {
  id: "A1",
  art: "umbau",
  ziel: "Räume src auf",
  bereich: "src/",
  erwarteteDateien: ["src/text.js"],
  vorbild: "src/text.js",
  abnahme: "test/text.test.js",
};

export function ghSkript(ordner, skript) {
  const programm = join(ordner, "gh.mjs");
  writeFileSync(programm, `#!/usr/bin/env node\n${skript}\n`);
  chmodSync(programm, AUSFUEHRBAR);
  return { HERMES_GH: programm };
}

export function issueMitAbsicht(absicht) {
  return `console.log(${JSON.stringify(`## Absicht\n\n${absicht}\n\n## Ziel\n`)});`;
}

function ghMitAbsichtDerPhase(werkzeug, phase) {
  return Object.hasOwn(phase, "absicht") ? ghSkript(werkzeug, issueMitAbsicht(phase.absicht)) : {};
}

export function starte(context, { auftrag, drehbuch, dateien = {}, vorbereiten = () => {}, phase: zusatz = {}, umgebung = {}, mitUpstream = true, befehl = "lauf" }) {
  const repo = probeRepository(context, { ...BASIS, ...dateien });
  vorbereiten(repo);
  if (mitUpstream) mitUpstreamMaster(repo);
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const werkzeug = probeDirectory(context, {});
  const phase = { phase: "probe", issue: ISSUE, entwurf: { [auftrag.bereich]: "Entwurf." }, auftraege: [auftrag], ...zusatz };
  writeFileSync(join(werkzeug, "phase.json"), JSON.stringify(phase));
  writeFileSync(join(werkzeug, "drehbuch.json"), JSON.stringify(drehbuch));
  writeFileSync(join(werkzeug, "claude.mjs"), ERSATZ_CLAUDE);
  chmodSync(join(werkzeug, "claude.mjs"), AUSFUEHRBAR);
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const umgebungDesLaufs = {
    ...isolatedEnvironment(),
    HOME: werkzeug,
    HERMES_CLAUDE: join(werkzeug, "claude.mjs"),
    HERMES_GH: GH_OHNE_WIRKUNG,
    ...ghMitAbsichtDerPhase(werkzeug, phase),
    ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json"),
    ...mitErsatzWerkzeugen(werkzeug),
    ...umgebung,
  };
  return { ...fuehreLauf({ repo, werkzeug, befehl, umgebung: umgebungDesLaufs }), repo, werkzeug, basis, umgebung: umgebungDesLaufs };
}

function fuehreLauf({ repo, werkzeug, befehl, umgebung }) {
  const lauf = spawnSync(process.execPath, [EINSTIEG, befehl, join(werkzeug, "phase.json")], { cwd: repo, encoding: "utf8", env: umgebung });
  const belegDatei = join(repo, ".fortschritt/probe/A1.json");
  const beleg = existsSync(belegDatei) ? JSON.parse(readFileSync(belegDatei, "utf8")) : null;
  return { lauf, beleg, kopf: runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim() };
}

export function starteNochmal({ repo, werkzeug, umgebung }, drehbuch, befehl = "lauf") {
  writeFileSync(join(werkzeug, "drehbuch.json"), JSON.stringify(drehbuch));
  return { ...fuehreLauf({ repo, werkzeug, befehl, umgebung }), repo, werkzeug };
}
