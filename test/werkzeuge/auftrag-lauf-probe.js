import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const AUSFUEHRBAR = 0o755;
export const EXIT_ROT = 1;
const ISSUE = 54;
const GH_OHNE_WIRKUNG = "true";

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const argumente = process.argv.slice(2);
const sitzung = argumente[argumente.indexOf(argumente.includes("--resume") ? "--resume" : "--session-id") + 1];
const prompt = readFileSync(0, "utf8");
const drehbuch = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"));
const nach = drehbuch.nach !== undefined && prompt.includes(drehbuch.nach) ? "-nach" : "";
const rolle = process.env.HERMES_ROLLE + nach + (prompt.includes("Überlebende Mutanten") ? "-nachrunde" : "");
writeFileSync(join(dirname(process.env.ERSATZ_DREHBUCH), "prompt-" + rolle + ".txt"), prompt);
const antwort = drehbuch[rolle + "-antwort"] ?? "";
const angeboten = typeof antwort === "string" ? antwort : Object.entries(antwort).find(([angebot]) => prompt.includes(angebot))[1];
console.log(JSON.stringify({ type: "result", result: angeboten }));
for (const [pfad, inhalt] of Object.entries(drehbuch[rolle] ?? {})) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
const projekt = join(homedir(), ".claude", "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"));
mkdirSync(projekt, { recursive: true });
const zeile = (id) => JSON.stringify({ message: { id, usage: { input_tokens: 10, output_tokens: 5 } } });
writeFileSync(join(projekt, sitzung + ".jsonl"), [zeile("a"), zeile("a"), zeile("b")].join("\\n"));
`;

export const BASIS = {
  "package.json": JSON.stringify({
    type: "module",
    scripts: { test: "node --test --test-reporter=tap", lint: "node -e 0", "test:betroffen": "node -e 0 --" },
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

export function starte(context, { auftrag, drehbuch, dateien = {}, vorbereiten = () => {}, phase: zusatz = {} }) {
  const repo = probeRepository(context, { ...BASIS, ...dateien });
  vorbereiten(repo);
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const werkzeug = probeDirectory(context, {});
  const phase = { phase: "probe", issue: ISSUE, entwurf: { [auftrag.bereich]: "Entwurf." }, auftraege: [auftrag], ...zusatz };
  writeFileSync(join(werkzeug, "phase.json"), JSON.stringify(phase));
  writeFileSync(join(werkzeug, "drehbuch.json"), JSON.stringify(drehbuch));
  writeFileSync(join(werkzeug, "claude.mjs"), ERSATZ_CLAUDE);
  chmodSync(join(werkzeug, "claude.mjs"), AUSFUEHRBAR);
  const kopf = () => runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const basis = kopf();
  const lauf = spawnSync(process.execPath, [EINSTIEG, "lauf", join(werkzeug, "phase.json")], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...isolatedEnvironment(),
      HOME: werkzeug,
      HERMES_CLAUDE: join(werkzeug, "claude.mjs"),
      HERMES_GH: GH_OHNE_WIRKUNG,
      ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json"),
    },
  });
  const belegDatei = join(repo, ".fortschritt/probe/A1.json");
  const beleg = existsSync(belegDatei) ? JSON.parse(readFileSync(belegDatei, "utf8")) : null;
  return { repo, werkzeug, lauf, beleg, basis, kopf: kopf() };
}
