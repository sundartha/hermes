import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { commitAll, probeRepository, runIn, writeFiles } from "../gemeinsam/umgebung.mjs";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const ROT = 1;
const ALT = "export function wahl(a, b) {\n  return a || b;\n}\n";

function umbenennung(context, { vorher, nachher }) {
  const repo = probeRepository(context, vorher);
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  for (const alt of Object.keys(vorher)) if (!(alt in nachher)) rmSync(join(repo, alt));
  writeFiles(repo, nachher);
  commitAll(repo, "Stand");
  const lauf = runIn(repo, process.execPath, [join(WURZEL, "tools/pruefen.mjs"), "umbenennung", "--basis", basis]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

function tausch(alt, neu) {
  return { vorher: { "src/x.js": alt }, nachher: { "src/x.ts": neu } };
}

test("a || b zu a ?? b bei der Umbenennung ist rot und nennt das Paar", (context) => {
  const ergebnis = umbenennung(context, tausch(ALT, "export function wahl(a, b) {\n  return a ?? b;\n}\n"));
  assert.equal(ergebnis.status, ROT);
  assert.match(ergebnis.ausgabe, /src\/x\.js → src\/x\.ts: geändert \(Laufzeitcode nach Entfernen der Typen anders als vorher\)/);
});

test("Ergänzte Typen, interface und import type sind grün", (context) => {
  const neu = [
    'import type { Foo } from "./foo.js";',
    "interface Optionen { a: string }",
    "export function wahl(a: string | undefined, b: string): string {",
    "  return a || b;",
    "}",
    "",
  ].join("\n");
  const ergebnis = umbenennung(context, tausch(ALT, neu));
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /src\/x\.js → src\/x\.ts: nur Typen ergänzt, Laufzeitcode gleich/);
});

test("Kommentare und Leerzeilen sind kein Unterschied", (context) => {
  const ergebnis = umbenennung(context, tausch(ALT, "// Wahl\n\nexport function wahl(a, b) {\n  /* a */ return a || b;\n}\n"));
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
});

test("enum ist rot", (context) => {
  const ergebnis = umbenennung(context, tausch("export const A = 1;\n", "export enum A { Eins }\n"));
  assert.equal(ergebnis.status, ROT);
  assert.match(ergebnis.ausgabe, /src\/x\.js → src\/x\.ts: geändert \(TypeScript-Syntax mit Laufzeitwirkung/);
});

test("Parameter-Property ist rot", (context) => {
  const alt = "export class K {\n  constructor(a) {\n    this.a = a;\n  }\n}\n";
  const ergebnis = umbenennung(context, tausch(alt, "export class K {\n  constructor(readonly a: string) {}\n}\n"));
  assert.equal(ergebnis.status, ROT);
});

test("import.meta in einer umbenannten Datei ist rot", (context) => {
  const alt = "export const url = import.meta.url;\n";
  const ergebnis = umbenennung(context, tausch(alt, alt));
  assert.equal(ergebnis.status, ROT);
  assert.match(ergebnis.ausgabe, /import\.meta/);
});

test("__filename in einer umbenannten Datei ist rot", (context) => {
  const alt = "export const datei = __filename;\n";
  const ergebnis = umbenennung(context, tausch(alt, alt));
  assert.equal(ergebnis.status, ROT);
});

test("Unlesbarer Laufzeitcode ist rot", (context) => {
  const ergebnis = umbenennung(context, tausch("export const a = 1;\n", "export const a = ;\n"));
  assert.equal(ergebnis.status, ROT);
});

test("./a.ts gilt als ./a.js, wenn a mitumbenannt wurde", (context) => {
  const ergebnis = umbenennung(context, {
    vorher: { "src/a.js": "export const a = 1;\n", "src/b.js": 'import { a } from "./a.js";\nexport const b = a;\n' },
    nachher: { "src/a.ts": "export const a = 1;\n", "src/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n' },
  });
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /src\/b\.js → src\/b\.ts: nur Typen ergänzt/);
});

test("./a.ts gegen ./a.js ist rot, wenn a nicht umbenannt wurde", (context) => {
  const ergebnis = umbenennung(context, {
    vorher: { "src/a.js": "export const a = 1;\n", "src/b.js": 'import { a } from "./a.js";\nexport const b = a;\n' },
    nachher: { "src/a.js": "export const a = 1;\n", "src/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n' },
  });
  assert.equal(ergebnis.status, ROT);
});

test("Ohne Umbenennung: grün und Hinweis", (context) => {
  const ergebnis = umbenennung(context, { vorher: { "src/x.js": ALT }, nachher: { "src/x.js": "export const y = 1;\n" } });
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /Keine Umbenennung \.js→\.ts\./);
});

test(".mjs zu .mts mit ergänzten Typen ist grün", (context) => {
  const ergebnis = umbenennung(context, {
    vorher: { "tools/x.mjs": "export const a = (b) => b;\n" },
    nachher: { "tools/x.mts": "export const a = (b: string): string => b;\n" },
  });
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /tools\/x\.mjs → tools\/x\.mts: nur Typen/);
});
