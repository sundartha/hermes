import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, passingTest, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const ISSUE = 54;
const PROBE = "probe@example.invalid";

const CLAUDE = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const ort = dirname(process.env.ERSATZ_DREHBUCH);
const rolle = process.env.HERMES_ROLLE;
const zaehler = join(ort, "anzahl-" + rolle);
const nummer = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) : 0;
writeFileSync(zaehler, String(nummer + 1));
const liste = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[rolle] ?? [{}];
const einsatz = liste[Math.min(nummer, liste.length - 1)];
appendFileSync(join(ort, "prompt-" + rolle + ".txt"), readFileSync(0, "utf8") + "\\n");
for (const [pfad, inhalt] of Object.entries(einsatz.dateien ?? {})) writeFileSync(pfad, inhalt);
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: einsatz.antwort ?? "fertig" }) + "\\n");
`;

const GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const eingabe = process.argv.includes("-") ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.ERSATZ_GH, JSON.stringify([...process.argv.slice(2), eingabe]) + "\\n");
`;

const ZAHL = "src/zahl.js";
const ZAHL_ZWEI = "test/zahl-zwei.test.js";
const ESLINT = join(REPO_ROOT, "node_modules/eslint/bin/eslint.js");
const REPO = {
  ".gitignore": ".fortschritt/\n",
  "test/zahl.test.js": passingTest("zahl"),
  "eslint.config.js": 'export default [{ files: ["**/*.js"], rules: { "no-unused-vars": "error" } }];\n',
  "eslint-suppressions.json": JSON.stringify({ [ZAHL]: { "no-unused-vars": { count: 1 } } }),
  [ZAHL]: "const alt = 1;\nexport const ZAHL = 1;\n",
  "package.json": JSON.stringify({
    type: "module",
    scripts: { lint: `node ${JSON.stringify(ESLINT)} . --pass-on-unpruned-suppressions`, "test:betroffen": "node -e 0 --", test: "node --test" },
  }),
};
const UMBAU = { id: "A1", art: "umbau", ziel: "Räume zahl auf", bereich: ZAHL, erwarteteDateien: [ZAHL], abnahme: "test/zahl.test.js" };
const FUNKTION = { ...UMBAU, art: "funktion", erwarteteDateien: [ZAHL, ZAHL_ZWEI], abnahme: ZAHL_ZWEI, erwarteterFehler: "1 !== 2", wasDarfNiePassieren: [] };
const ROTER_TEST = [{ dateien: { [ZAHL_ZWEI]: 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { ZAHL } from "../src/zahl.js";\ntest("zwei", () => assert.equal(ZAHL, 2));\n' } }];
const AUFRAEUMEN = { ziel: "Räume die Altfunktion alt auf", bereich: ZAHL, erwarteteDateien: [ZAHL], abnahme: "test/zahl.test.js" };
const ALT_BLEIBT = { dateien: { [ZAHL]: "const alt = 2;\nexport const ZAHL = 1;\n" } };

function lauf(context, { auftrag, ...drehbuch }) {
  const repo = probeRepository(context, REPO);
  const phase = { phase: "probe", issue: ISSUE, entwurf: { [auftrag.bereich]: "Entwurf." }, auftraege: [auftrag] };
  const werkzeug = probeDirectory(context, { "claude.mjs": CLAUDE, "gh.mjs": GH, "drehbuch.json": JSON.stringify(drehbuch), "phase.json": JSON.stringify(phase) });
  for (const name of ["claude.mjs", "gh.mjs"]) chmodSync(join(werkzeug, name), AUSFUEHRBAR);
  const ergebnis = spawnSync(process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "lauf", join(werkzeug, "phase.json")], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...isolatedEnvironment(),
      HOME: werkzeug,
      HERMES_CLAUDE: join(werkzeug, "claude.mjs"),
      HERMES_GH: join(werkzeug, "gh.mjs"),
      ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json"),
      ERSATZ_GH: join(werkzeug, "gh.log"),
      ...Object.fromEntries(["AUTHOR", "COMMITTER"].flatMap((rolle) => [[`GIT_${rolle}_NAME`, "Probe"], [`GIT_${rolle}_EMAIL`, PROBE]])),
    },
  });
  const pfad = (name) => join(repo, ".fortschritt/probe", `${name}.json`);
  const beleg = (name) => (existsSync(pfad(name)) ? JSON.parse(readFileSync(pfad(name), "utf8")) : null);
  const git = (...args) => runIn(repo, "git", args).stdout.trim();
  return { ergebnis, beleg, git };
}

test("ein Aufräum-Umbau, der die Altfunktion stehen lässt, wird nicht als grüner Umbau festgehalten", (context) => {
  const { ergebnis, beleg, git } = lauf(context, {
    auftrag: FUNKTION,
    test: ROTER_TEST,
    plan: [{ antwort: JSON.stringify({ ...AUFRAEUMEN, entwurf: "Die ungenutzte Variable alt fällt weg." }) }],
    bau: [{ antwort: `Voraussetzung fehlt: Altfunktionen aufräumen: ${ZAHL}:alt` }, ALT_BLEIBT],
    notiz: [{ antwort: "1. Umbau wiederholen" }],
  });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.notEqual(beleg("A1-umbau")?.ergebnis, "grün");
  assert.deepEqual(git("log", "--format=%s").split("\n"), ["Basis"]);
  assert.deepEqual(JSON.parse(git("show", "HEAD:eslint-suppressions.json")), JSON.parse(REPO["eslint-suppressions.json"]));
});

test("ein geplanter Umbau, der keine Altfunktion aufräumen soll, bleibt grün, auch wenn eslint-suppressions.json gleich bleibt", (context) => {
  const { ergebnis, beleg, git } = lauf(context, { auftrag: UMBAU, bau: [ALT_BLEIBT] });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.equal(beleg("A1").ergebnis, "grün");
  assert.deepEqual(git("log", "--format=%s").split("\n"), [UMBAU.ziel, "Basis"]);
  assert.deepEqual(JSON.parse(git("show", "HEAD:eslint-suppressions.json")), JSON.parse(REPO["eslint-suppressions.json"]));
});

test("ein Umbau aus einer anderen fehlenden Voraussetzung bleibt grün, auch wenn eslint-suppressions.json gleich bleibt", (context) => {
  const vorbereiten = { ...AUFRAEUMEN, ziel: "Bereite zahl vor" };
  const { ergebnis, beleg, git } = lauf(context, {
    auftrag: FUNKTION,
    test: ROTER_TEST,
    plan: [{ antwort: JSON.stringify({ ...vorbereiten, entwurf: "alt bekommt den Wert 2." }) }],
    bau: [{ antwort: `Voraussetzung fehlt: Erst muss alt in ${ZAHL} den Wert 2 haben.` }, ALT_BLEIBT, { dateien: { [ZAHL]: "const alt = 2;\nexport const ZAHL = 2;\n" } }],
  });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.equal(beleg("A1-umbau").ergebnis, "grün");
  assert.deepEqual(git("log", "--format=%s").split("\n"), [FUNKTION.ziel, vorbereiten.ziel, "Basis"]);
});
