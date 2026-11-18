import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { verstoesseAus } from "../../tools/pruefen.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const REGEL = "anrufe-fachlogik-ohne-aussenwelt";
const FACHLOGIK = "src/telephony/call-dedup.js";
const KEINE_FACHLOGIK = "src/telephony/ausserhalb-der-liste.js";
const GROSSE_AUSGABE = 268_435_456;
const ordner = [];

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

function verstoesse(von, ziel) {
  const wurzel = mkdtempSync(join(tmpdir(), "anrufe-fachlogik-uhr-"));
  ordner.push(wurzel);
  mkdirSync(join(wurzel, "tools"));
  copyFileSync(join(WURZEL, ".dependency-cruiser.cjs"), join(wurzel, ".dependency-cruiser.cjs"));
  copyFileSync(join(WURZEL, "tools/bereiche.json"), join(wurzel, "tools/bereiche.json"));
  symlinkSync(join(WURZEL, "node_modules"), join(wurzel, "node_modules"));
  for (const [pfad, inhalt] of [[von, `import "${relativ(von, ziel)}";\n`], [ziel, "export const x = 1;\n"]]) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
  const lauf = spawnSync(join(WURZEL, "node_modules/.bin/depcruise"), ["src", "--config", ".dependency-cruiser.cjs", "--output-type", "json"], { cwd: wurzel, encoding: "utf8", maxBuffer: GROSSE_AUSGABE });
  return verstoesseAus(JSON.parse(lauf.stdout)).filter((eintrag) => eintrag.startsWith(`${REGEL}: `));
}

function relativ(von, ziel) {
  const teile = dirname(von).split("/").length;
  return `${"../".repeat(teile - 1)}${ziel.replace(/^src\//, "")}`;
}

const UHR = "src/utils/uhr-warten.ts";

test(`Fachlogik des Anrufbereichs importiert ${UHR}: neuer Verstoß gegen ${REGEL}`, () => {
  assert.deepEqual(verstoesse(FACHLOGIK, UHR), [`${REGEL}: ${FACHLOGIK} → ${UHR}`]);
});

test(`Datei außerhalb der Fachlogik-Liste darf ${UHR} importieren`, () => {
  assert.deepEqual(verstoesse(KEINE_FACHLOGIK, UHR), []);
});

test("Fachlogik des Anrufbereichs darf die Konstanten aus src/utils/timer.ts importieren", () => {
  assert.deepEqual(verstoesse(FACHLOGIK, "src/utils/timer.ts"), []);
});
