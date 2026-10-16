import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ORDNER, aufrufe, exit, phaseFuer, plane } from "./planung-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const START = join(REPO_ROOT, "tools/auftrag/planung/neuschnitt-start.mjs");
const DATEI = `${ORDNER}/phase.json`;
const GESCHEITERT = "a2";
const ANLASS = "Der Abnahmetest von a2 wurde nach dem Bau nicht grün.";
const VERLAUF_ZEILEN = ["test: a2 rot wie erwartet", "bau: a2 nach drei Versuchen gescheitert"];
const KOPF = ["", "## Neuschnitt", "", ANLASS, "", "## Verlauf", "", ...VERLAUF_ZEILEN].join("\n");

function neuschnitt(context, { ueberschrieben = {}, eingabe = {} } = {}) {
  const ablage = probeDirectory(context, {});
  const argumente = (wurzel) => {
    writeFileSync(join(wurzel, DATEI), `${JSON.stringify(phaseFuer(wurzel), null, 2)}\n`);
    const daten = { root: wurzel, ordner: ORDNER, datei: DATEI, auftragId: GESCHEITERT, fertig: ["a1"], anlass: ANLASS, kopf: KOPF, verlauf: VERLAUF_ZEILEN, hinweise: [], ...eingabe };
    writeFileSync(join(ablage, "eingabe.json"), JSON.stringify(daten));
    return [ablage];
  };
  const lauf = plane(context, { werkzeug: START, grund: {}, ueberschrieben, argumente });
  const datei = join(ablage, "ergebnis.json");
  return { ...lauf, ablage, ergebnis: existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null };
}

test("Neuschnitt: eine Eingabe ohne Verlauf endet mit Exit 2 und startet keinen Agenten", (context) => {
  const lauf = neuschnitt(context, { eingabe: { kopf: "\n## Neuschnitt\n\nohne Verlauf" } });
  exit(lauf, 2);
  assert.match(lauf.ergebnis.grund, /## Verlauf/);
  assert.deepEqual(lauf.ergebnis.sitzungen, []);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
});

test("Neuschnitt: eine Eingabe ohne ein Pflichtfeld endet mit Exit 2 und nennt das Feld", (context) => {
  const lauf = neuschnitt(context, { eingabe: { verlauf: "keine Liste" } });
  exit(lauf, 2);
  assert.equal(lauf.ergebnis.grund, "in der Eingabe fehlt verlauf");
});

test("Neuschnitt: ein Auftrag, der nicht in der Phasendatei steht, endet mit Exit 2", (context) => {
  const lauf = neuschnitt(context, { eingabe: { auftragId: "a7" } });
  exit(lauf, 2);
  assert.equal(lauf.ergebnis.grund, `a7 steht nicht in ${DATEI}`);
});

test("Neuschnitt: eine fehlende Phasendatei endet mit Exit 2", (context) => {
  const lauf = neuschnitt(context, { eingabe: { datei: `${ORDNER}/fehlt.json` } });
  exit(lauf, 2);
  assert.equal(lauf.ergebnis.grund, `die Phasendatei ${ORDNER}/fehlt.json gibt es nicht`);
});
