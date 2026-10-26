import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { REPO_ROOT, probeRepository, runIn } from "./probe-repo.js";

const FAELLE = pathToFileURL(join(REPO_ROOT, "tools/auftrag/faelle.mjs")).href;
const ABNAHME = "test/rechnen.test.js";
const FALL_AUS_TEXT = "verdoppelt die Zahl aus einem Text";
const BERECHNETER_FALL = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  `const FALL = ${JSON.stringify(FALL_AUS_TEXT)};`,
  "test(FALL, () => assert.equal(2 * 2, 4));",
  "",
].join("\n");

test("die Fälle eines Abnahmetests tragen den Namen aus dem Lauf, auch wenn der Test ihn über eine Konstante berechnet", (context) => {
  const skript = `import { laufe } from ${JSON.stringify(FAELLE)};\nconsole.log(JSON.stringify(laufe(process.cwd(), ${JSON.stringify(ABNAHME)})));\n`;
  const repo = probeRepository(context, { "package.json": '{ "type": "module" }\n', [ABNAHME]: BERECHNETER_FALL, "faelle.mjs": skript });
  const lauf = runIn(repo, process.execPath, ["faelle.mjs"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  const { faelle, dateiRot } = JSON.parse(lauf.stdout);
  assert.equal(dateiRot, false);
  assert.deepEqual(faelle.map(({ name }) => name).filter((name) => name === FALL_AUS_TEXT), [FALL_AUS_TEXT], lauf.stdout);
});
