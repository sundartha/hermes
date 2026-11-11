import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { geaenderteBereiche } from "../../tools/pruefen.mjs";

const BLOCK = [
  "const erste = berechneErsteSumme(eingabe.werte);",
  "const zweite = berechneZweiteSumme(eingabe.werte);",
  "const dritte = berechneDritteSumme(eingabe.werte);",
];
const REST = ["export function rest() {", "  return 1;", "}"];

function imRepo(vorher, nachher, ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-umzug-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: ordner, stdio: "pipe" });
  const schreibe = (staende) => {
    for (const [name, zeilen] of Object.entries(staende)) writeFileSync(join(ordner, "src", name), `${zeilen.join("\n")}\n`);
  };
  try {
    git("init", "-q");
    mkdirSync(join(ordner, "src"));
    schreibe(vorher);
    git("add", ".");
    git("commit", "-q", "-m", "basis");
    schreibe(nachher);
    git("add", "-A");
    const vorherCwd = process.cwd();
    process.chdir(ordner);
    try {
      return ablauf(geaenderteBereiche("HEAD"));
    } finally {
      process.chdir(vorherCwd);
    }
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Ein reiner Umzug eines Blocks in eine andere Datei erzeugt keine zu mutierenden Zeilen", () => {
  imRepo({ "a.js": [...BLOCK, ...REST], "b.js": ["export const b = 2;"] }, { "a.js": REST, "b.js": ["export const b = 2;", ...BLOCK] }, (bereiche) => {
    assert.deepEqual(bereiche, []);
  });
});

test("Ein Umzug mit einer geänderten Zeile mutiert genau diese Zeile", () => {
  const geaendert = [BLOCK[0], "const zweite = berechneZweiteSumme(eingabe.werte, 2);", BLOCK[2]];
  imRepo({ "a.js": [...BLOCK, ...REST], "b.js": ["export const b = 2;"] }, { "a.js": REST, "b.js": ["export const b = 2;", ...geaendert] }, (bereiche) => {
    assert.deepEqual(bereiche, [{ datei: "src/b.js", von: 3, bis: 3 }]);
  });
});

test("Eine neue Zeile wird mutiert, auch neben einem umgezogenen Block", () => {
  imRepo({ "a.js": [...BLOCK, ...REST], "b.js": ["export const b = 2;"] }, { "a.js": REST, "b.js": ["export const b = 2;", ...BLOCK, "export const neu = 3;"] }, (bereiche) => {
    assert.deepEqual(bereiche, [{ datei: "src/b.js", von: 5, bis: 5 }]);
  });
});

const MIT_B = { "a.js": [...BLOCK, ...REST], "b.js": ["export const b = 2;"] };

test("Ein verschobener und zusätzlich in eine zweite Datei kopierter Block mutiert die Kopie", () => {
  imRepo(MIT_B, { "a.js": REST, "b.js": ["export const b = 2;", ...BLOCK], "c.js": BLOCK }, (bereiche) => {
    assert.deepEqual(bereiche, [{ datei: "src/c.js", von: 1, bis: 3 }]);
  });
});

test("Ein verschobener und zweimal in dieselbe Datei eingefügter Block mutiert die zweite Fundstelle", () => {
  imRepo(MIT_B, { "a.js": REST, "b.js": ["export const b = 2;", ...BLOCK, "tu();", ...BLOCK] }, (bereiche) => {
    assert.deepEqual(bereiche, [{ datei: "src/b.js", von: 5, bis: 8 }]);
  });
});

test("Eine neue Zeile, deren Inhalt mit „++ “ beginnt, setzt die Datei nicht auf null", () => {
  imRepo({ "a.js": REST }, { "a.js": [...REST, "++ i;", "neu();", "neu2();"] }, (bereiche) => {
    assert.deepEqual(bereiche, [{ datei: "src/a.js", von: 4, bis: 6 }]);
  });
});

test("Ein Umzug mit anderer Einrückung gilt als geändert", () => {
  imRepo(MIT_B, { "a.js": REST, "b.js": ["export const b = 2;", ...BLOCK.map((zeile) => `  ${zeile}`)] }, (bereiche) => {
    assert.deepEqual(bereiche, [{ datei: "src/b.js", von: 2, bis: 4 }]);
  });
});

test("Ein Umzug unter der Git-Mindestlänge gilt als geändert", () => {
  imRepo({ "a.js": ["foo(1);", ...REST], "b.js": ["x();"] }, { "a.js": REST, "b.js": ["x();", "foo(1);"] }, (bereiche) => {
    assert.deepEqual(bereiche, [{ datei: "src/b.js", von: 2, bis: 2 }]);
  });
});
