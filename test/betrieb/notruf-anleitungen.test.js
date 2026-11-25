import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "launch-pruefliste.mjs");
const NOTRUFE = ["N1", "N2", "N3", "N4"];
const ABSCHNITTE = ["## Symptom", "## Prüfen", "## Beheben", "## Eskalieren"];

function echterLauf() {
  const r = spawnSync(process.execPath, [SKRIPT], { encoding: "utf8" });
  return { code: r.status, zeilen: (r.stdout + r.stderr).split("\n") };
}

describe("Notruf-Anleitungen N1 bis N4", () => {
  for (const id of NOTRUFE) {
    const datei = path.join(ROOT, "docs", "betrieb", `notruf-${id.toLowerCase()}.md`);

    it(`${id}: das Skript meldet die Anleitungsdatei nicht als fehlend`, () => {
      const zeile = echterLauf().zeilen.find((z) => z.startsWith(`rot ${id} `));
      assert.ok(zeile, `${id} muss rot bleiben`);
      assert.ok(!zeile.includes("Anleitungsdatei fehlt"), zeile);
    });

    it(`${id}: die Anleitung führt durch Symptom, Prüfen, Beheben, Eskalieren`, () => {
      assert.ok(fs.existsSync(datei), `${datei} fehlt`);
      const text = fs.readFileSync(datei, "utf8");
      for (const abschnitt of ABSCHNITTE) assert.ok(text.includes(abschnitt), `${id}: ${abschnitt}`);
    });
  }

  it("die echte Prüfliste bleibt rot und die Tabelle trägt keine Scheinwerte", () => {
    const lauf = echterLauf();
    assert.equal(lauf.code, 1);
    const liste = fs.readFileSync(path.join(ROOT, "docs", "betrieb", "launch-pruefliste.md"), "utf8");
    for (const id of NOTRUFE) {
      const zeile = liste.split("\n").find((z) => z.startsWith(`| ${id} |`));
      const zellen = zeile.split("|").map((z) => z.trim());
      assert.deepEqual(zellen.slice(4, 7), ["", "", ""], `${id}: Wert, Datum, Beleg müssen leer sein`);
      assert.ok(lauf.zeilen.includes(`rot ${id} Datum fehlt oder ist kein ISO-Datum`));
    }
  });
});
