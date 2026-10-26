import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ROT, NEGATIV, NULL, pruefe, quelle, schluessel } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

const ZWEITE_STUFE_OHNE = /^Zweite Stufe ohne (.+): im Erstlauf rot$/gm;
const ROT = "rot im Erstlauf";

function roterTest(...kopf) {
  return ['import assert from "node:assert/strict";', 'import { test } from "node:test";', ...kopf, `test("${ROT}", () => assert.fail("rot"));`, ""].join("\n");
}

const WEITERE_STARTS = {
  fork: 'fork("src/zahl.js", { stdio: "ignore" });',
  exec: 'exec("node src/zahl.js");',
  execFile: 'execFile(process.execPath, ["src/zahl.js"]);',
  execFileSync: 'execFileSync(process.execPath, ["src/zahl.js"]);',
  execSync: 'execSync("node src/zahl.js");',
};

function weitereStarts() {
  return Object.fromEntries(
    Object.entries(WEITERE_STARTS).map(([start, aufruf]) => [`test/${start}.test.js`, roterTest(`import { ${start} } from "node:child_process";`, aufruf)]),
  );
}

function ausgewaehlt(context, proben) {
  const repo = probeRepository(context, { ...BASIS, ...proben });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  return schluessel(lauf.stdout, ZWEITE_STUFE_OHNE);
}

test("eine Testdatei zählt für die zweite Stufe nur, wenn sie die geänderte Datei importiert, startet oder lädt, nicht wenn eine Hilfe ihren Pfad nur als Text nennt", (context) => {
  const proben = {
    "test/probe-quellen.js": 'export const ROUTE = "src/zahl.js";\nexport const QUELLEN = { [ROUTE]: "export const nachbau = 1;\\n" };\n',
    "test/text.test.js": roterTest('import { QUELLEN } from "./probe-quellen.js";', "Object.keys(QUELLEN);"),
    "test/lesen.test.js": roterTest('import { readFileSync } from "node:fs";', 'readFileSync("src/zahl.js", "utf8");'),
    "test/start.test.js": roterTest('import { spawn } from "node:child_process";', 'spawn(process.execPath, ["src/zahl.js"], { stdio: "ignore" });'),
    "test/konstante.test.js": roterTest('import { spawnSync } from "node:child_process";', 'const START = "src/zahl.js";', "spawnSync(process.execPath, [START]);"),
    "test/umbruch.test.js": roterTest('import { spawnSync } from "node:child_process";', "const START =", '  "src/zahl.js";', "spawnSync(process.execPath, [START]);"),
    "test/laden.test.js": roterTest('import { pathToFileURL } from "node:url";', 'const PFAD = "src/zahl.js";', "await import(pathToFileURL(PFAD));"),
    "test/import-hilfe.js": 'export { einordnen } from "../src/zahl.js";\n',
    "test/import.test.js": roterTest('import { einordnen } from "./import-hilfe.js";', "einordnen(0);"),
    ...weitereStarts(),
  };
  assert.deepEqual(ausgewaehlt(context, proben), [
    `test/exec.test.js › ${ROT}`,
    `test/execFile.test.js › ${ROT}`,
    `test/execFileSync.test.js › ${ROT}`,
    `test/execSync.test.js › ${ROT}`,
    `test/fork.test.js › ${ROT}`,
    `test/import.test.js › ${ROT}`,
    `test/konstante.test.js › ${ROT}`,
    `test/laden.test.js › ${ROT}`,
    `test/start.test.js › ${ROT}`,
    `test/umbruch.test.js › ${ROT}`,
  ]);
});

test("ein über REPO_ROOT oder import.meta.url am echten Ort verankerter Pfad zählt, auch wenn ihn erst erzeugter Code im Kindprozess lädt", (context) => {
  const proben = {
    "test/meta-url.test.js": roterTest(
      'import { spawnSync } from "node:child_process";',
      'const ZAHL = new URL("../src/zahl.js", import.meta.url).href;',
      "const CODE = `import ${JSON.stringify(ZAHL)};`;",
      'spawnSync(process.execPath, ["--input-type=module", "-e", CODE]);',
    ),
    "test/repo-root.test.js": roterTest(
      'import { spawnSync } from "node:child_process";',
      'import { join } from "node:path";',
      'import { pathToFileURL } from "node:url";',
      "const REPO_ROOT = process.cwd();",
      'const ZAHL = pathToFileURL(join(REPO_ROOT, "src/zahl.js")).href;',
      "const CODE = `import ${JSON.stringify(ZAHL)};`;",
      'spawnSync(process.execPath, ["--input-type=module", "-e", CODE]);',
    ),
  };
  assert.deepEqual(ausgewaehlt(context, proben), [`test/meta-url.test.js › ${ROT}`, `test/repo-root.test.js › ${ROT}`]);
});
