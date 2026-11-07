import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { PRUEFLEITER_TOOL, REPO_ROOT, probeDirectory, probeRepository, repoMitCiLokalListe } from "./probe-repo.js";
import { lokaleUmgebung, starte } from "./schwerlauf-lauf.js";

const EXIT_GESPERRT = 3;
const FRIST_MS = 30_000;
const MARKE = "marke.txt";
const PHASE = pathToFileURL(join(REPO_ROOT, "tools/auftrag/phase.mjs")).href;
const ABLEHNUNG = (anlass) => new RegExp(`^${anlass} läuft nur auf GitHub Actions `, "m");
const PHASENSKRIPT = `import { Phasenlauf } from ${JSON.stringify(PHASE)};
const lauf = new Phasenlauf({ root: "/nirgends", phase: { phase: "probe", auftraege: [] } });
const gerufen = [];
lauf.pruefe = (name) => { gerufen.push(name); return { name, exitCode: 0, ausgabe: "" }; };
const beleg = lauf.pruefeSchwer("prüfleiter", ["npm", "run", "pruefleiter"]);
console.log(JSON.stringify({ gerufen, exitCode: beleg.exitCode, zeilen: beleg.zeilen }));`;

const EINSTIEGE = [
  {
    name: "pruefleiter",
    aufruf: () => ({ args: [PRUEFLEITER_TOOL, "--teile-pruefen", "/nirgends", "--jobs", "{}"], cwd: REPO_ROOT }),
    anlass: "pruefleiter --teile-pruefen /nirgends --jobs \\{\\}",
  },
  {
    name: "test:wirkung",
    aufruf: (context) => ({ args: [join(REPO_ROOT, "tools/testwirkung.mjs"), "--basis", "gibt-es-nicht"], cwd: probeRepository(context, { "a.txt": "a\n" }) }),
    anlass: "test:wirkung --basis gibt-es-nicht",
  },
  {
    name: "ci-lokal",
    aufruf: (context) => {
      const repo = repoMitCiLokalListe(context, [{ name: "marke", befehl: `touch ${MARKE}` }]);
      return { args: [join(REPO_ROOT, "tools/ci-lokal.mjs"), "--basis", "HEAD~1"], cwd: repo, ohneMarke: join(repo, MARKE) };
    },
    anlass: "ci-lokal --basis HEAD~1",
  },
];

async function startLokal(context, { args, cwd, env = {} }) {
  const lauf = starte(args, { env: { ...lokaleUmgebung(), ...env }, cwd });
  context.after(() => lauf.kind.kill("SIGKILL"));
  const [code] = await lauf.ende;
  return { ...lauf, code };
}

for (const { name, aufruf, anlass } of EINSTIEGE) {
  test(`${name} wird lokal ohne GITHUB_ACTIONS und ohne Terminal abgelehnt: Exit 3, bevor etwas läuft`, { timeout: FRIST_MS }, async (context) => {
    const { ohneMarke, ...start } = aufruf(context);
    const lauf = await startLokal(context, start);
    assert.equal(lauf.code, EXIT_GESPERRT, lauf.stdout + lauf.stderr);
    assert.match(lauf.stderr, ABLEHNUNG(anlass));
    if (ohneMarke !== undefined) assert.equal(existsSync(ohneMarke), false, "ein Schritt lief trotz Ablehnung");
  });
}

test("phase überspringt lokal den Prüfleiter und belegt das; in GitHub Actions führt sie ihn aus", { timeout: FRIST_MS }, async (context) => {
  const skript = join(probeDirectory(context, { "phase.mjs": PHASENSKRIPT }), "phase.mjs");
  const lokal = await startLokal(context, { args: [skript], cwd: REPO_ROOT });
  assert.equal(lokal.code, 0, lokal.stdout + lokal.stderr);
  assert.deepEqual(JSON.parse(lokal.stdout), { gerufen: [], exitCode: 0, zeilen: ["prüfleiter läuft lokal nicht, sondern in den Pflicht-Checks des PR auf GitHub Actions."] });
  const ci = await startLokal(context, { args: [skript], cwd: REPO_ROOT, env: { GITHUB_ACTIONS: "true" } });
  assert.equal(ci.code, 0, ci.stdout + ci.stderr);
  assert.deepEqual(JSON.parse(ci.stdout).gerufen, ["prüfleiter"]);
});
