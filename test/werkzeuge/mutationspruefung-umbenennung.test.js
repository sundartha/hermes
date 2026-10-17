import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BASIS,
  EXIT_ROT,
  NEGATIV,
  NULL,
  UEBERLEBT,
  pruefe,
  quelle,
  schluessel,
  testdatei,
} from "./mutationspruefung-hilfen.js";
import { commitAll, probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

const TYPISIERT = (text) => text.replace("einordnen(zahl)", "einordnen(zahl: number): string");
const TESTDATEI_TS = testdatei([-1, "negativ"], [1, "positiv"]).replace(
  "../src/zahl.js",
  "../src/zahl.ts",
);

function umbenannt(context, inhalt) {
  const repo = probeRepository(context, BASIS);
  rmSync(join(repo, "src/zahl.js"));
  writeFiles(repo, { "src/zahl.ts": inhalt, "test/zahl.test.js": TESTDATEI_TS });
  commitAll(repo, "Umbenennung");
  return repo;
}

function plan(context, repo) {
  const lauf = pruefe(
    repo,
    "--basis",
    "HEAD~1",
    "--plan",
    join(probeDirectory(context, {}), "plan.json"),
  );
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return lauf.stdout;
}

test("eine Umbenennung .js→.ts, die nur Typen ergänzt, plant keine Mutanten; eine geänderte Zeile plant die neue Datei", (context) => {
  const gleich = plan(context, umbenannt(context, TYPISIERT(quelle(NEGATIV))));
  assert.match(
    gleich,
    /^src\/zahl\.ts: nur Typen ergänzt gegenüber src\/zahl\.js, Laufzeitcode gleich, keine Mutanten nötig\.$/m,
  );
  assert.match(
    gleich,
    /^Plan: keine geänderte Zeile unter src\/ mit Mutanten oder Abschaltung\.$/m,
  );
  const geaendert = plan(context, umbenannt(context, TYPISIERT(quelle(NEGATIV, NULL))));
  assert.match(geaendert, /^Teil 1 von 1: src\/zahl\.ts /m);
  assert.doesNotMatch(geaendert, /nur Typen ergänzt/);
});

test("eine umbenannte .ts-Datei mit einer ungetesteten Zeile wird ganz mutiert und bleibt rot", (context) => {
  const rot = pruefe(umbenannt(context, TYPISIERT(quelle(NEGATIV, NULL))), "--basis", "HEAD~1");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const ueberlebende = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(
    ueberlebende.some((mutant) => mutant.startsWith("src/zahl.ts:3:")),
    rot.stdout,
  );
  assert.ok(
    ueberlebende.every((mutant) => mutant.startsWith("src/zahl.ts:")),
    rot.stdout,
  );
});

test("eine Importzeile, die nur der Umbenennung folgt, braucht keine Mutanten; dasselbe Modul anders geschrieben wird wie bisher geplant", (context) => {
  const aufruf = (quelle) =>
    `import { einordnen } from ${quelle};\n\nexport function zweimal(zahl) {\n  return [einordnen(zahl), einordnen(zahl)];\n}\n`;
  const repo = probeRepository(context, { ...BASIS, "src/aufruf.js": aufruf('"./zahl.js"') });
  rmSync(join(repo, "src/zahl.js"));
  writeFiles(repo, {
    "src/zahl.ts": TYPISIERT(quelle(NEGATIV)),
    "test/zahl.test.js": TESTDATEI_TS,
    "src/aufruf.js": aufruf('"./zahl.ts"'),
  });
  commitAll(repo, "Umbenennung");
  assert.match(
    plan(context, repo),
    /^src\/aufruf\.js: Syntaxbaum unverändert, keine Mutanten nötig\.$/m,
  );
  const anders = probeRepository(context, { ...BASIS, "src/aufruf.js": aufruf('"./zahl.js"') });
  writeFiles(anders, { "src/aufruf.js": aufruf("'../src/zahl.js'") });
  commitAll(anders, "Schreibweise");
  assert.match(plan(context, anders), /^Teil 1 von 1: src\/aufruf\.js /m);
});
