import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dynamischeZiele } from "../../tools/tests-ausmisten/importe.mjs";
import { eigeneSandbox } from "../../tools/tests-ausmisten/messen.mjs";
import { RECHNEN_HILFE, RECHNEN_TEST } from "./ausmisten/hilfen.mjs";
import { EXIT_ROT, messeUndMelde } from "./ausmisten/messung.mjs";
import { probeDirectory } from "./probe-repo.js";

const RECHNEN_TS = "src/fremd/rechnen.ts";

test("ausmisten-typescript: ein Mutant in einer .ts-Quelle, den nur der gelöschte Test tötet, macht den Lauf rot", async (context) => {
  const ergebnis = await messeUndMelde(
    context,
    { weg: [RECHNEN_TEST] },
    {
      dateien: {
        [RECHNEN_TS]: "export function doppelt(zahl: number): number {\n  return zahl * 2;\n}\n",
        [RECHNEN_HILFE]: 'export { doppelt } from "../../src/fremd/rechnen.ts";\n',
      },
    },
  );
  assert.ok(ergebnis.gelesen.dateien.includes(RECHNEN_TS), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(ergebnis.melden.ausgabe, /Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.ts:/);
});

test("ausmisten-typescript: ein dynamischer Import mit .js-Endung findet die .ts-Datei, auch in einer Datei mit Typen", (context) => {
  const ordner = probeDirectory(context, { "src/ziel.ts": "export const wert: number = 1;\n" });
  const lader = join(ordner, "src/lader.ts");
  writeFileSync(lader, 'const pfad: string = "./ziel.js";\nexport const geladen = await import("./ziel.js");\n');
  const vorher = process.cwd();
  process.chdir(ordner);
  context.after(() => process.chdir(vorher));
  assert.deepEqual(dynamischeZiele("src/lader.ts"), ["src/ziel.ts"]);
});

test("ausmisten-typescript: die Fallsuche bricht ab, wenn ihr umgebauter Stand fehlt oder nicht eindeutig ist", () => {
  assert.throws(() => eigeneSandbox([]), /umgebaute Stand für die Fallsuche fehlt/);
  assert.throws(() => eigeneSandbox(["sandbox-a", "sandbox-b"]), /nicht eindeutig: sandbox-a, sandbox-b/);
  assert.equal(eigeneSandbox(["sandbox-a"]), join(".mutationspruefung", "sandbox-a"));
});
