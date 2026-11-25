import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "launch-pruefliste.mjs");

const BELEGTE_PROBEZEILEN = [
  "| Kennung | Punkt | Schwelle | Wert | Belegt am | Beleg | Anleitung |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| K1 | Probe | ≥ 20 | 20 | 2026-05-01 | Probelauf | docs/betrieb/kontingente.md |",
  "| K2 | Probe | ≥ 20 | 20 | 2026-05-01 | Probelauf | docs/betrieb/kontingente.md |",
  "| K3 | Probe | ≥ 20 | 20 | 2026-05-01 | Probelauf | docs/betrieb/kontingente.md |",
  "| B1 | Probe | ≥ 1 | 1 | 2026-05-01 | Probelauf | docs/betrieb/bereitschaft.md |",
  "| G1 | Probe | — |  | 2026-05-01 | Probelauf | docs/betrieb/geheimnis-tausch.md |",
];

let ordner;
let probe;
let echt;

function pruefe(...argumente) {
  const lauf = spawnSync(process.execPath, [SKRIPT, ...argumente], { encoding: "utf8" });
  return { code: lauf.status, zeilen: lauf.stdout.split("\n") };
}

before(() => {
  ordner = fs.mkdtempSync(path.join(os.tmpdir(), "betriebs-anleitungen-"));
  const liste = path.join(ordner, "liste.md");
  fs.writeFileSync(liste, `${BELEGTE_PROBEZEILEN.join("\n")}\n`);
  probe = pruefe(liste, "--wurzel", ROOT);
  echt = pruefe();
});

after(() => {
  fs.rmSync(ordner, { recursive: true, force: true });
});

function erwarteGruen(kennung) {
  assert.deepEqual(
    probe.zeilen.filter((zeile) => zeile.split(" ")[1] === kennung),
    [`gruen ${kennung}`],
  );
}

function erwarteEchtRot(kennung, grund) {
  assert.equal(echt.code, 1);
  assert.deepEqual(
    echt.zeilen.filter((zeile) => zeile.split(" ")[1] === kennung),
    [`rot ${kennung} ${grund}`],
  );
}

test("K1: eine belegte Zeile findet die Kontingent-Anleitung und ist grün", () => {
  erwarteGruen("K1");
});

test("K2: eine belegte Zeile findet die Kontingent-Anleitung und ist grün", () => {
  erwarteGruen("K2");
});

test("K3: eine belegte Zeile findet die Kontingent-Anleitung und ist grün", () => {
  erwarteGruen("K3");
});

test("B1: eine belegte Zeile findet die Bereitschafts-Anleitung und ist grün", () => {
  erwarteGruen("B1");
});

test("G1: eine belegte Zeile findet die Anleitung zum Geheimnis-Tausch und ist grün", () => {
  erwarteGruen("G1");
});

test("die echte Prüfliste bleibt für K1 bis K3 und B1 ohne eingetragenen Wert rot", () => {
  for (const kennung of ["K1", "K2", "K3", "B1"]) erwarteEchtRot(kennung, "Wert nicht lesbar");
});

test("die echte Prüfliste bleibt für G1 ohne eingetragenes Datum rot", () => {
  erwarteEchtRot("G1", "Datum fehlt oder ist kein ISO-Datum");
});
