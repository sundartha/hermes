import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { WHOLE_FILE_DELETED, assertPassedWithoutGitHub, assertStopped, check } from "./testschutz-probe.js";

const TESTDATEI = "test/rechnen.test.js";
const TESTDATEI_TS = "test/rechnen.test.ts";
const GATE_DATEI = "test/gate.test.js";
const RECHNER = "src/rechner.js";
const RECHNER_TS = "src/rechner.ts";
const WEITERE = [
  "export const differenz = (links, rechts) => links - rechts;",
  "export const produkt = (links, rechts) => links * rechts;",
  "export const quotient = (links, rechts) => links / rechts;",
  "export const rest = (links, rechts) => links % rechts;",
];
const RECHNER_TEXT = ["export const summe = (links, rechts) => links + rechts;", ...WEITERE];
const RECHNER_NUR_TYPEN = ["export const summe = (links: number, rechts: number): number => links + rechts;", ...WEITERE];
const RECHNER_GEAENDERT = ["export const summe = (links, rechts) => links - rechts;", ...WEITERE];

function text(zeilen) {
  return `${zeilen.join("\n")}\n`;
}

function testdatei({ quelle = "js", typ = "", erwartet = 2 } = {}) {
  return text([
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { summe } from "../src/rechner.${quelle}";`,
    `const EINS${typ} = 1;`,
    'test("rechnet eins plus eins", () => {',
    `  assert.equal(summe(EINS, EINS), ${erwartet});`,
    "});",
  ]);
}

function erwartungszeile(datei) {
  return datei.split("\n").findIndex((zeile) => zeile.includes("assert.equal")) + 1;
}

function probe(context, dateien) {
  const directory = probeRepository(context, {
    [RECHNER]: text(RECHNER_TEXT),
    "tools/gate-tests.json": JSON.stringify({ Denylist: { module: [], tests: [GATE_DATEI] } }),
    ...dateien,
  });
  const basis = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  return { directory, basis };
}

function ersetze(directory, { entfernt, neu }) {
  for (const datei of entfernt) rmSync(join(directory, datei));
  writeFiles(directory, neu);
  commitAll(directory, "Wechsel nach .ts");
}

test("Testschutz: eine Testdatei, die beim Wechsel nach .ts nur Typen bekommt, ist keine gelöschte Testdatei", async (context) => {
  const repo = probe(context, { [TESTDATEI]: testdatei() });
  ersetze(repo.directory, { entfernt: [TESTDATEI], neu: { [TESTDATEI_TS]: testdatei({ typ: ": number" }) } });
  const ergebnis = await check(repo);
  assertPassedWithoutGitHub(ergebnis);
  assert.match(ergebnis.output, /Testschutz: test\/rechnen\.test\.js: umbenannt, nur Typen ergänzt, Laufzeitcode gleich, nach test\/rechnen\.test\.ts/);
});

test("Testschutz: eine Testdatei, die nach .ts wechselt und ihre Erwartung ändert, bleibt eine gelöschte Testdatei", async (context) => {
  const repo = probe(context, { [TESTDATEI]: testdatei() });
  ersetze(repo.directory, { entfernt: [TESTDATEI], neu: { [TESTDATEI_TS]: testdatei({ typ: ": number", erwartet: 3 }) } });
  const ergebnis = await check(repo);
  assertStopped(ergebnis);
  assert.ok(ergebnis.output.includes(`${TESTDATEI}: ${WHOLE_FILE_DELETED}`), ergebnis.output);
});

test("Testschutz: eine Gate-Testdatei bleibt auch beim Wechsel mit nur Typen gesperrt", async (context) => {
  const repo = probe(context, { [GATE_DATEI]: testdatei() });
  ersetze(repo.directory, { entfernt: [GATE_DATEI], neu: { "test/gate.test.ts": testdatei({ typ: ": number" }) } });
  const ergebnis = await check(repo);
  assertStopped(ergebnis);
  assert.ok(ergebnis.output.includes(`${GATE_DATEI}: ${WHOLE_FILE_DELETED}`), ergebnis.output);
});

test("Testschutz: ein Importpfad, der einer nur-Typen-Umbenennung folgt, geht ohne GitHub durch", async (context) => {
  const repo = probe(context, { [TESTDATEI]: testdatei() });
  ersetze(repo.directory, {
    entfernt: [RECHNER],
    neu: { [RECHNER_TS]: text(RECHNER_NUR_TYPEN), [TESTDATEI]: testdatei({ quelle: "ts" }) },
  });
  const ergebnis = await check(repo);
  assertPassedWithoutGitHub(ergebnis);
  assert.match(ergebnis.output, /test\/rechnen\.test\.js: Importpfad folgt der Umbenennung von src\/rechner\.js nach src\/rechner\.ts\./);
});

test("Testschutz: ein Importpfad, der einer Umbenennung mit geändertem Laufzeitcode folgt, braucht die Freigabe", async (context) => {
  const repo = probe(context, { [TESTDATEI]: testdatei() });
  ersetze(repo.directory, {
    entfernt: [RECHNER],
    neu: { [RECHNER_TS]: text(RECHNER_GEAENDERT), [TESTDATEI]: testdatei({ quelle: "ts" }) },
  });
  assertStopped(await check(repo));
});

test("Testschutz: dieser Importpfad braucht die Freigabe auch, wenn die Testdatei mit nach .ts wechselt", async (context) => {
  const repo = probe(context, { [TESTDATEI]: testdatei() });
  ersetze(repo.directory, {
    entfernt: [RECHNER, TESTDATEI],
    neu: { [RECHNER_TS]: text(RECHNER_GEAENDERT), [TESTDATEI_TS]: testdatei({ quelle: "ts", typ: ": number" }) },
  });
  const ergebnis = await check(repo);
  assertStopped(ergebnis);
  assert.ok(ergebnis.output.includes(`${TESTDATEI}: ${WHOLE_FILE_DELETED}`), ergebnis.output);
});

test("Testschutz: eine geänderte .test.ts-Datei nennt den geänderten Testfall", async (context) => {
  const repo = probe(context, { [TESTDATEI_TS]: testdatei({ typ: ": number" }) });
  const geaendert = testdatei({ typ: ": number", erwartet: 3 });
  writeFiles(repo.directory, { [TESTDATEI_TS]: geaendert });
  commitAll(repo.directory, "Erwartung");
  const ergebnis = await check(repo);
  assertStopped(ergebnis);
  const meldung = `${TESTDATEI_TS}, Testfall „rechnet eins plus eins“, Zeilen ${erwartungszeile(geaendert)}: geändert oder gelöscht`;
  assert.ok(ergebnis.output.includes(meldung), ergebnis.output);
});
