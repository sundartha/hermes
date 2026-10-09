import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { EXIT_GRUEN, EXIT_ROT, pruefeZwischen } from "./testwirkung-probe.js";

const RECHNEN = { "src/rechnen.js": "export function addiere(links, rechts) {\n  return links + rechts;\n}\n" };

function testdatei(kopf, ...faelle) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    ...kopf,
    ...faelle.flatMap(([name, ...zeilen]) => [`test(${JSON.stringify(name)}, () => {`, ...zeilen.map((zeile) => `  ${zeile}`), "});"]),
    "",
  ].join("\n");
}

function zaehlerdatei(context) {
  const verzeichnis = mkdtempSync(join(tmpdir(), "testwirkung-alle-"));
  context.after(() => rmSync(verzeichnis, { recursive: true, force: true }));
  return join(verzeichnis, "zaehler");
}

const WIRKSAM = ["addiert", "assert.equal(addiere(1, 2), 3);"];

test("ein unveränderter Test, der wackelt, macht die Testwirkung rot, wenn seine Datei geändert wird", (context) => {
  const kopf = [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { addiere } from "../src/rechnen.js";',
    `const ZAEHLER = ${JSON.stringify(zaehlerdatei(context))};`,
  ];
  const wechselt = [
    "wechselt",
    'const stand = existsSync(ZAEHLER) ? Number(readFileSync(ZAEHLER, "utf8")) : 0;',
    "writeFileSync(ZAEHLER, String(stand + 1));",
    "assert.equal(stand % 2, 1);",
  ];
  const vorher = { ...RECHNEN, "test/rechnen.test.js": testdatei(kopf, wechselt) };
  const lauf = pruefeZwischen(context, vorher, { "test/rechnen.test.js": testdatei(kopf, wechselt, WIRKSAM) });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test wackelt: test\/rechnen\.test\.js › wechselt \(\d von 5 Läufen rot\)$/m);
});

test("ein unveränderter Test, der eine geänderte Hilfszeile nicht mehr erreicht, macht die Testwirkung rot", (context) => {
  const kopf = ['import { addiere } from "../src/rechnen.js";', 'import { pruefeDrei } from "./helfer.js";'];
  const alt = ["prüft über den Helfer", "pruefeDrei(addiere(1, 2));"];
  const helfer = (...zeilen) =>
    ['import assert from "node:assert/strict";', "export function pruefeDrei(wert) {", ...zeilen, "  assert.equal(wert, 3);", "}", ""].join("\n");
  const vorher = { ...RECHNEN, "test/helfer.js": helfer(), "test/rechnen.test.js": testdatei(kopf, alt) };
  const nachher = {
    "test/helfer.js": helfer("  if (wert !== undefined) return;"),
    "test/rechnen.test.js": testdatei(kopf, alt, WIRKSAM),
  };
  const lauf = pruefeZwischen(context, vorher, nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: test\/helfer\.js \(Zeile 4\)$/m);
});

test("ein neuer wirksamer Test neben unveränderten wirksamen Tests derselben Datei bleibt grün", (context) => {
  const kopf = ['import { addiere } from "../src/rechnen.js";'];
  const alt = ["addiert null", "assert.equal(addiere(0, 5), 5);"];
  const vorher = { ...RECHNEN, "test/rechnen.test.js": testdatei(kopf, alt) };
  const lauf = pruefeZwischen(context, vorher, { "test/rechnen.test.js": testdatei(kopf, alt, WIRKSAM) });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Tests geänderter Testdateien: 2 in 5 Läufen wiederholt, 0 wackeln, 0 nicht gelaufen\.$/m);
});
