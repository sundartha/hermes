import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "launch-pruefliste.mjs");
const NOTRUFE = ["N1", "N2", "N3", "N4"];

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

    it(`${id}: die Anleitungsdatei liegt im Repo`, () => {
      assert.ok(fs.existsSync(datei), `${datei} fehlt`);
    });
  }

  it("die echte Prüfliste bleibt rot, solange kein Datum belegt ist", () => {
    const lauf = echterLauf();
    assert.equal(lauf.code, 1);
    for (const id of NOTRUFE) {
      assert.ok(lauf.zeilen.includes(`rot ${id} Datum fehlt oder ist kein ISO-Datum`));
    }
  });
});
