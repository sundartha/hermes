import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/testwirkung.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

function testdatei(...faelle) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { addiere } from "../src/rechnen.js";',
    ...faelle.flatMap(([name, zeile]) => [`test(${JSON.stringify(name)}, () => {`, `  ${zeile}`, "});"]),
    "",
  ].join("\n");
}

const BASIS = {
  "package.json": '{ "type": "module" }\n',
  "src/rechnen.js": "export function addiere(links, rechts) {\n  return links + rechts;\n}\n",
  "test/rechnen.test.js": testdatei(["addiert", "assert.equal(addiere(1, 2), 3);"]),
};

function pruefeNach(context, dateien) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, dateien);
  commitAll(repo, "Neue Tests");
  return runIn(repo, process.execPath, [WERKZEUG, "--basis", "HEAD~1"]);
}

function zaehlerdatei(context) {
  const verzeichnis = mkdtempSync(join(tmpdir(), "testwirkung-zaehler-"));
  context.after(() => rmSync(verzeichnis, { recursive: true, force: true }));
  return join(verzeichnis, "zaehler");
}

test("ein neuer Test ohne Prüfung macht die Testwirkung rot und wird mit Namen genannt", (context) => {
  const lauf = pruefeNach(context, { "test/leer.test.js": testdatei(["rechnet nur", "addiere(1, 2);"]) });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test bleibt grün, obwohl jede Prüfung scheitert: test\/leer\.test\.js › rechnet nur$/m);
});

test("ein neuer Test, der mal besteht und mal scheitert, wackelt", (context) => {
  const zaehler = zaehlerdatei(context);
  const wechselnd = [
    'import assert from "node:assert/strict";',
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    `const ZAEHLER = ${JSON.stringify(zaehler)};`,
    'test("wechselt", () => {',
    '  const stand = existsSync(ZAEHLER) ? Number(readFileSync(ZAEHLER, "utf8")) : 0;',
    "  writeFileSync(ZAEHLER, String(stand + 1));",
    "  assert.equal(stand % 2, 1);",
    "});",
    "",
  ].join("\n");
  const lauf = pruefeNach(context, { "test/wechselt.test.js": wechselnd });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test wackelt: test\/wechselt\.test\.js › wechselt \(\d von 5 Läufen rot\)$/m);
});

test("ein wirksamer neuer Test neben einer geänderten Zeile in einem bestehenden Test ist grün", (context) => {
  const rechnen = testdatei(
    ["addiert", "assert.equal(addiere(2, 2), 4);"],
    ["addiert null", "assert.equal(addiere(0, 5), 5);"],
  );
  const lauf = pruefeNach(context, { "test/rechnen.test.js": rechnen });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^grün: 1 neue Tests, 0 ohne wirksame Prüfung, 0 wackeln in 5 Läufen, 0 nicht gelaufen\.$/m);
});

test("ein neuer Test in einer Datei, die beim Laden scheitert, gilt als nicht gelaufen", (context) => {
  const kaputt = ['import { test } from "node:test";', 'throw new Error("kaputt");', 'test("lädt nie", () => {});', ""];
  const lauf = pruefeNach(context, { "test/kaputt.test.js": kaputt.join("\n") });
  assert.notEqual(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test nicht gelaufen: test\/kaputt\.test\.js › lädt nie \(Lauf A/m);
});

test("ein neuer Test ohne festen Namen macht die Testwirkung rot", (context) => {
  const schleife = [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "for (const nummer of [1, 2]) {",
    "  test(`fall ${nummer}`, () => {",
    "    assert.ok(nummer > 0);",
    "  });",
    "}",
    "",
  ];
  const lauf = pruefeNach(context, { "test/schleife.test.js": schleife.join("\n") });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test ohne festen Namen: test\/schleife\.test\.js › `fall \$\{nummer\}`$/m);
});
