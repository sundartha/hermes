import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "launch-pruefliste.mjs");
const NOTRUFE = ["N1", "N2", "N3", "N4"];

function echterLauf() {
  const r = spawnSync(process.execPath, [SKRIPT], { encoding: "utf8" });
  return { code: r.status, zeilen: (r.stdout + r.stderr).split("\n") };
}

const KOPF = "| Kennung | Punkt | Schwelle | Wert | Belegt am | Beleg | Anleitung |\n| --- | --- | --- | --- | --- | --- | --- |\n";

function belegterLauf() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notruf-"));
  const liste = path.join(dir, "liste.md");
  const reihen = NOTRUFE.map(
    (id) => `| ${id} | Punkt | — |  | 2026-05-01 | Lauf 1 | docs/betrieb/notruf-${id.toLowerCase()}.md |`,
  );
  fs.writeFileSync(liste, KOPF + reihen.join("\n") + "\n");
  const r = spawnSync(process.execPath, [SKRIPT, liste, "--wurzel", ROOT], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true });
  return r.stdout.split("\n");
}

describe("Notruf-Anleitungen N1 bis N4", () => {
  for (const id of NOTRUFE) {
    const datei = path.join(ROOT, "docs", "betrieb", `notruf-${id.toLowerCase()}.md`);

    it(`${id}: das Skript wertet eine belegte Zeile mit der Anleitung als grün`, () => {
      assert.ok(belegterLauf().includes(`gruen ${id}`));
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
