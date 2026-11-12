import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { PFLICHT } from "../../scripts/launch-pruefliste.mjs";
import { ROOT } from "../helpers.js";

const SKRIPT = path.join(ROOT, "scripts", "launch-pruefliste.mjs");
const KOPF = "| Kennung | Punkt | Schwelle | Wert | Belegt am | Beleg | Anleitung |\n| --- | --- | --- | --- | --- | --- | --- |\n";
const SOLL = {
  Q1: ["≤ 0,5", "0,4", "—"],
  Q2: ["≤ 0", "0", "—"],
  Q3: ["≤ 120", "120", "—"],
  Q4: ["≤ 0", "0", "—"],
  Q5: ["≥ 20", "20", "—"],
  Q6: ["≤ 2000", "2000", "—"],
  Q7: ["≤ 2000", "10", "—"],
  Q8: ["≤ 30", "30", "—"],
  Q9: ["≥ 1", "1", "—"],
  Q10: ["≤ 8000", "8000", "—"],
  Q11: ["≥ 1", "1", "—"],
  N1: ["—", "", "docs/betrieb/notruf-n1.md"],
  N2: ["—", "", "docs/betrieb/notruf-n2.md"],
  N3: ["—", "", "docs/betrieb/notruf-n3.md"],
  N4: ["—", "", "docs/betrieb/notruf-n4.md"],
  R1: ["—", "", "docs/RUNBOOK-RESTORE.md"],
  K1: ["≥ 20", "20", "docs/betrieb/kontingente.md"],
  K2: ["≥ 20", "25", "docs/betrieb/kontingente.md"],
  K3: ["≥ 20", "20", "docs/betrieb/kontingente.md"],
  B1: ["≥ 1", "1", "docs/betrieb/bereitschaft.md"],
  G1: ["—", "", "docs/betrieb/geheimnis-tausch.md"],
};

function zeile(id, ueberschreibe = {}) {
  const [schwelle, wert, anleitung] = SOLL[id];
  const f = { schwelle, wert, datum: "2026-05-01", beleg: "Lauf 1", anleitung, ...ueberschreibe };
  return `| ${id} | Punkt | ${f.schwelle} | ${f.wert} | ${f.datum} | ${f.beleg} | ${f.anleitung} |`;
}

function bauen(aenderungen = {}, ohne = [], mitAnleitungen = true) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), "pruefliste-"));
  fs.mkdirSync(path.join(wurzel, "docs", "betrieb"), { recursive: true });
  if (mitAnleitungen) {
    for (const [, , a] of Object.values(SOLL)) {
      if (a !== "—") fs.writeFileSync(path.join(wurzel, a), "x");
    }
  }
  const ids = Object.keys(SOLL).filter((i) => !ohne.includes(i));
  const text = KOPF + ids.map((i) => zeile(i, aenderungen[i])).join("\n") + "\n";
  const liste = path.join(wurzel, "docs", "betrieb", "liste.md");
  fs.writeFileSync(liste, text);
  return { wurzel, liste };
}

function lauf(liste, extra = []) {
  const r = spawnSync(process.execPath, [SKRIPT, liste, ...extra], { encoding: "utf8" });
  return { code: r.status, aus: r.stdout + r.stderr };
}

function rotMit(aenderungen, kennung, wort) {
  const { liste } = bauen(aenderungen);
  const r = lauf(liste);
  assert.equal(r.code, 1);
  assert.match(r.aus, new RegExp(`rot ${kennung} .*${wort}`));
}

describe("launch-pruefliste", () => {
  it("vollständige Liste: Exit 0 und alle grün", () => {
    const { liste } = bauen();
    const r = lauf(liste);
    assert.equal(r.code, 0);
    assert.equal((r.aus.match(/^gruen /gm) ?? []).length, Object.keys(SOLL).length);
    assert.doesNotMatch(r.aus, /rot /);
  });

  it("Wurzel per Argument", () => {
    const { wurzel, liste } = bauen();
    const woanders = fs.mkdtempSync(path.join(os.tmpdir(), "liste-"));
    const kopie = path.join(woanders, "l.md");
    fs.copyFileSync(liste, kopie);
    assert.equal(lauf(kopie).code, 1);
    assert.equal(lauf(kopie, ["--wurzel", wurzel]).code, 0);
  });

  it("leere Liste und fehlende Pflicht-Kennung sind rot", () => {
    const leer = bauen({}, Object.keys(SOLL));
    const a = lauf(leer.liste);
    assert.equal(a.code, 1);
    assert.match(a.aus, /rot Q1 Punkt fehlt/);
    assert.match(a.aus, /rot G1 Punkt fehlt/);
    const eine = lauf(bauen({}, ["Q7"]).liste);
    assert.equal(eine.code, 1);
    assert.match(eine.aus, /rot Q7 Punkt fehlt/);
    assert.doesNotMatch(eine.aus, /rot Q6/);
  });

  it("Beleg und Datum", () => {
    rotMit({ Q1: { datum: "" } }, "Q1", "ISO");
    rotMit({ Q1: { datum: "01.05.2026" } }, "Q1", "ISO");
    rotMit({ Q1: { datum: "2026-02-30" } }, "Q1", "echtes Datum");
    rotMit({ Q1: { datum: "2999-01-01" } }, "Q1", "Zukunft");
    rotMit({ N1: { beleg: "" } }, "N1", "Beleg fehlt");
    rotMit({ N1: { beleg: "—" } }, "N1", "Beleg fehlt");
  });

  it("Schwellen: beide Seiten der Grenze, unlesbar, abgeändert", () => {
    rotMit({ Q1: { wert: "0,6" } }, "Q1", "verfehlt");
    rotMit({ Q5: { wert: "19" } }, "Q5", "verfehlt");
    rotMit({ Q1: { wert: "viel" } }, "Q1", "nicht lesbar");
    rotMit({ Q1: { wert: "" } }, "Q1", "nicht lesbar");
    rotMit({ Q5: { schwelle: "≥ 1" } }, "Q5", "Schwelle weicht");
    rotMit({ Q5: { schwelle: "ab 20" } }, "Q5", "Schwelle weicht");
    rotMit({ N1: { schwelle: "≥ 1" } }, "N1", "Schwelle nicht vorgesehen");
  });

  it("Anleitung fehlt oder weicht ab", () => {
    const { liste } = bauen({}, [], false);
    const r = lauf(liste);
    assert.equal(r.code, 1);
    assert.match(r.aus, /rot N1 Anleitungsdatei fehlt/);
    assert.match(r.aus, /rot R1 Anleitungsdatei fehlt/);
    assert.match(r.aus, /rot G1 Anleitungsdatei fehlt/);
    assert.match(r.aus, /gruen Q1/);
    rotMit({ B1: { anleitung: "—" } }, "B1", "Anleitung muss");
  });

  it("unbekannte oder doppelte Kennung, kaputte Tabelle", () => {
    const { liste } = bauen();
    fs.appendFileSync(liste, zeile("Q1") + "\n" + "| X9 | a | — | | 2026-05-01 | b | — |\n");
    const r = lauf(liste);
    assert.equal(r.code, 1);
    assert.match(r.aus, /rot Q1 doppelte Kennung/);
    assert.match(r.aus, /rot X9 unbekannte Kennung/);

    const spalte = bauen();
    fs.writeFileSync(spalte.liste, fs.readFileSync(spalte.liste, "utf8").replace("Beleg |", "Quelle |"));
    assert.equal(lauf(spalte.liste).code, 1);
    assert.match(lauf(spalte.liste).aus, /Spalten stimmen nicht/);

    const kaputt = bauen();
    fs.appendFileSync(kaputt.liste, "| Q1 | zu kurz |\n");
    assert.match(lauf(kaputt.liste).aus, /kaputte Zeile/);

    const text = bauen();
    fs.writeFileSync(text.liste, "nur Text\n");
    assert.match(lauf(text.liste).aus, /keine Tabelle/);

    const trenner = bauen();
    fs.writeFileSync(trenner.liste, KOPF.split("\n")[0] + "\n" + zeile("Q1") + "\n");
    assert.match(lauf(trenner.liste).aus, /Trennzeile fehlt/);
  });

  it("Prüflistendatei fehlt: Exit 2", () => {
    const r = lauf(path.join(os.tmpdir(), "gibt-es-nicht-pruefliste.md"));
    assert.equal(r.code, 2);
    assert.match(r.aus, /Prüfliste fehlt/);
  });
});

describe("mitgelieferte Prüfliste", () => {
  it("ist lesbar und nennt alle Pflicht-Kennungen", () => {
    const r = spawnSync(process.execPath, [SKRIPT], { encoding: "utf8" });
    assert.ok(r.status === 0 || r.status === 1);
    for (const id of Object.keys(PFLICHT)) assert.match(r.stdout, new RegExp(`^(rot|gruen) ${id}\\b`, "m"));
    assert.doesNotMatch(r.stdout + r.stderr, /Punkt fehlt|unbekannte Kennung|Spalten stimmen nicht/);
  });
});
