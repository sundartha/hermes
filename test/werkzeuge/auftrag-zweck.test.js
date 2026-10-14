import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PHASE_PASST_NICHT, VERSTOSS, grenzBefunde } from "../../tools/auftrag/pruefungen.mjs";
import { GRUND, MELDUNG, PRUEFUNG, zweckBlock, zweckIds } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT, probeRepository, runIn } from "./probe-repo.js";

const ZWECK = JSON.parse(readFileSync(join(REPO_ROOT, "tools/auftrag/zweck.json"), "utf8"));
const FELDER = ["liste", "wozu", "behebung", "nichtAngenommen", "ausweg"];
const BLOCKFELDER = FELDER.filter((feld) => feld !== "liste");
const AUSSTIEGE = [
  "Auftrag passt nicht:",
  "Voraussetzung fehlt:",
  "Gleichwertig:",
  "Nötig:",
  "Alter Test hält altes Verhalten fest:",
  "Zerlegung passt nicht:",
  "Pitch ändern:",
  "Empfehlung:",
];
const ZU_VIELE_ZEILEN = 401;

function alleGrenzVerstoesse() {
  const auftrag = { bereich: "src/bereich.js", abnahme: "test/a.test.js", erwarteteDateien: [] };
  const muster = ["/src/geschuetzt.js"];
  const bau = grenzBefunde({ auftrag, rolle: "bau", muster }, [
    { pfad: "src/geschuetzt.js", zeilen: 1 },
    { pfad: "src/fremd.js", zeilen: ZU_VIELE_ZEILEN },
    { pfad: "test/b.test.js", zeilen: 1 },
  ]);
  const test = grenzBefunde({ auftrag, rolle: "test", muster }, [
    { pfad: "src/bereich.js", zeilen: 1 },
    { pfad: "test/fremd.test.js", zeilen: 1 },
  ]);
  return [...bau.verstoesse, ...test.verstoesse];
}

function erreichbareIds() {
  const zeilen = [...alleGrenzVerstoesse(), `${VERSTOSS}${PHASE_PASST_NICHT}`];
  const ausSchritten = Object.values(PRUEFUNG).flatMap((name) => zweckIds({ name, zeilen }));
  const allgemein = zweckIds({ name: PRUEFUNG.GRENZEN_BAU, zeilen: [] });
  return new Set([...ausSchritten, ...allgemein, ...Object.values(GRUND), ...Object.values(MELDUNG)]);
}

test("zweck.json hat für jede Prüfung des Auftragswegs alle Felder und keine ID, die der Code nicht kennt", () => {
  const ids = erreichbareIds();
  for (const id of ids) {
    const eintrag = ZWECK[id];
    assert.ok(eintrag, `zweck.json hat keinen Eintrag ${id}`);
    for (const feld of FELDER) assert.ok(typeof eintrag[feld] === "string" && eintrag[feld].trim() !== "", `${id}.${feld} ist leer`);
    assert.equal(zweckBlock(id).length, BLOCKFELDER.length, id);
  }
  assert.deepEqual(Object.keys(ZWECK).toSorted(), [...ids].toSorted());
  assert.throws(() => zweckBlock("gibt es nicht"), /gibt es nicht/);
});

test("kein Zweck-Text beginnt eine Zeile mit einer Ausstiegszeile, die das Skript als Antwort liest", () => {
  for (const [id, eintrag] of Object.entries(ZWECK)) {
    const zeilen = FELDER.flatMap((feld) => eintrag[feld].split("\n"));
    for (const zeile of [...zeilen, ...zweckBlock(id)]) {
      const treffer = AUSSTIEGE.find((praefix) => zeile.trimStart().startsWith(praefix));
      assert.equal(treffer, undefined, `${id}: ${zeile}`);
    }
  }
});

test("eine rote Grenzprüfung ohne erkannten Verstoß bekommt den allgemeinen Block der Grenzprüfung", () => {
  const zeilen = ["rot: 0 Dateien geändert, 0 neue Zeilen Produktcode, Rolle bau.", `${VERSTOSS}eine Art, die es noch nicht gibt`];
  assert.deepEqual(zweckIds({ name: PRUEFUNG.GRENZEN_BAU, zeilen }), ["grenzen"]);
  assert.deepEqual(zweckIds({ name: PRUEFUNG.GRENZEN_TEST, zeilen: [] }), ["grenzen"]);
});

test("jede Verstoßart der Grenzprüfung, auch eine nicht mehr passende Phasendatei, bekommt eine eigene ID mit Text", (context) => {
  const repo = probeRepository(context, { "phase.json": JSON.stringify({ phase: "probe", entwurf: {}, auftraege: [] }) });
  const lauf = runIn(repo, process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "grenzen", "phase.json", "A1", "--rolle", "bau", "--basis", "HEAD"]);
  assert.notEqual(lauf.status, 0);
  const meldungen = [...alleGrenzVerstoesse(), ...lauf.stdout.split("\n").filter((zeile) => zeile.startsWith(VERSTOSS))];
  const ids = meldungen.map((zeile) => zweckIds({ name: PRUEFUNG.GRENZEN_BAU, zeilen: [zeile] }));
  assert.ok(ids.every((liste) => liste.length === 1 && liste[0] !== "grenzen" && zweckBlock(liste[0]).length > 0), JSON.stringify({ meldungen, ids }));
  assert.equal(new Set(ids.flat()).size, meldungen.length, JSON.stringify(ids));
  assert.deepEqual(ids.at(-1), ["grenzen/phasendatei"]);
});
