import assert from "node:assert/strict";
import { test } from "node:test";

import { bestaetige, bestaetigt } from "../../tools/mutationspruefung/bestaetigung.mjs";
import { nacheinander, staerker, ueberlebt, vereine } from "../../tools/mutationspruefung/nacheinander.mjs";

const ABBRUECHE = ["Timeout", "RuntimeError", "CompileError"];
const GRUPPEN_JE_WELLE_BIS_HEUTE = 4;
const DREI_GRUPPEN = 3;
const SECHS_GRUPPEN = 6;

function datei(gruppe) {
  return `test/gruppe-${gruppe + 1}.test.js`;
}

const ZUSTAENDE = {
  bestaetigt: (gruppe) => [
    { status: "Killed", toeter: [datei(gruppe)] },
    { status: "Killed", toeter: [datei(gruppe)] },
  ],
  haenger: (gruppe) => [
    { status: ABBRUECHE[gruppe % ABBRUECHE.length], toeter: [] },
    { status: "Timeout", toeter: [] },
  ],
  ueberlebt: () => [{ status: "Survived", toeter: [] }],
  nichtBestaetigt: (gruppe) => [
    { status: "Killed", toeter: [datei(gruppe)] },
    { status: "Survived", toeter: [] },
  ],
  ohneAbdeckung: () => [{ status: "NoCoverage", toeter: [] }],
};
const ARTEN = Object.keys(ZUSTAENDE);

function mutant(zeile, spalte = 1) {
  return { schluessel: `src/zahl.js:${zeile}:${spalte} ConditionalExpression → true`, zeilen: [zeile, zeile] };
}

function zeilenschluessel([von, bis]) {
  return `${von}-${bis}`;
}

function kombinationen(laenge) {
  let alle = [[]];
  for (let stelle = 0; stelle < laenge; stelle += 1) alle = alle.flatMap((anfang) => ARTEN.map((art) => [...anfang, art]));
  return alle;
}

async function gruppenergebnis(gruppe, belegung) {
  const verlaeufe = new Map(belegung.map(({ mutant: { schluessel }, arten }) => [schluessel, ZUSTAENDE[arten[gruppe]](gruppe)]));
  const lauf = (eintrag, nummer) => {
    const verlauf = verlaeufe.get(eintrag.schluessel);
    return { ...eintrag, art: "ConditionalExpression", ...(verlauf[nummer] ?? verlauf[0]) };
  };
  const nachlauf = async ({ zeilen }) => {
    const gefragt = new Set(zeilen.map(zeilenschluessel));
    return belegung.filter(({ mutant: { zeilen: eigene } }) => gefragt.has(zeilenschluessel(eigene))).map(({ mutant: eintrag }) => lauf(eintrag, 1));
  };
  return bestaetige(
    belegung.map(({ mutant: eintrag }) => lauf(eintrag, 0)),
    nachlauf,
    [datei(gruppe)],
  );
}

async function gruppenlaeufe(belegung, anzahl) {
  return Promise.all(Array.from({ length: anzahl }, (_leer, gruppe) => gruppenergebnis(gruppe, belegung)));
}

function testgruppen(anzahl) {
  return Array.from({ length: anzahl }, (_leer, gruppe) => [datei(gruppe)]);
}

function ersatz(laeufe) {
  const aufrufe = [];
  const gruppenlauf = async (offen, tests) => {
    aufrufe.push({ zeilen: offen, tests });
    const gefragt = new Set(offen.map(zeilenschluessel));
    const gruppe = testgruppen(laeufe.length).findIndex(([erste]) => erste === tests[0]);
    return laeufe[gruppe].filter((eintrag) => gefragt.has(zeilenschluessel(eintrag.zeilen)));
  };
  return { aufrufe, gruppenlauf };
}

function alleZeilen(belegung) {
  const gesehen = new Map(belegung.map(({ mutant: { zeilen } }) => [zeilenschluessel(zeilen), zeilen]));
  return [...gesehen.values()];
}

async function nacheinanderMit(belegung, laeufe) {
  const { aufrufe, gruppenlauf } = ersatz(laeufe);
  const ergebnis = await nacheinander(testgruppen(laeufe.length), alleZeilen(belegung), gruppenlauf);
  return { ergebnis, aufrufe };
}

function einzeln(alle) {
  return alle.map((arten, index) => ({ mutant: mutant(index + 1), arten }));
}

function paarweise(alle) {
  return alle.flatMap((arten, index) => [
    { mutant: mutant(index + 1), arten },
    { mutant: mutant(index + 1, 2), arten: alle[alle.length - 1 - index] },
  ]);
}

test("nacheinander ergibt je Mutant dasselbe wie alle Gruppen gleichzeitig", async () => {
  for (const belegung of [einzeln(kombinationen(DREI_GRUPPEN)), paarweise(kombinationen(DREI_GRUPPEN))]) {
    const laeufe = await gruppenlaeufe(belegung, DREI_GRUPPEN);
    const { ergebnis } = await nacheinanderMit(belegung, laeufe);
    assert.deepEqual(ergebnis, vereine(laeufe[0], laeufe));
  }
});

test("Überlebende, nicht bestätigte und Hänger gehen in die nächste Gruppe, bestätigt getötete nicht", async () => {
  const belegung = [
    ["bestaetigt", "bestaetigt", "ueberlebt"],
    ["ueberlebt", "bestaetigt", "ueberlebt"],
    ["nichtBestaetigt", "bestaetigt", "ueberlebt"],
    ["haenger", "bestaetigt", "ueberlebt"],
    ["ohneAbdeckung", "bestaetigt", "ueberlebt"],
  ].map((arten, index) => ({ mutant: mutant(index + 1), arten }));
  const laeufe = await gruppenlaeufe(belegung, DREI_GRUPPEN);
  const { ergebnis, aufrufe } = await nacheinanderMit(belegung, laeufe);
  assert.deepEqual(aufrufe, [
    { zeilen: alleZeilen(belegung), tests: [datei(0)] },
    { zeilen: alleZeilen(belegung.slice(1)), tests: [datei(1)] },
  ]);
  assert.ok(ergebnis.every(bestaetigt));
});

function ueberlebtHeute(laeufe) {
  return async (zeilen) => {
    let ergebnisse = null;
    for (let start = 0; start < laeufe.length; start += GRUPPEN_JE_WELLE_BIS_HEUTE) {
      const offen = ergebnisse === null ? zeilen : ergebnisse.filter(ueberlebt).map((eintrag) => eintrag.zeilen);
      if (offen.length === 0) break;
      const gefragt = new Set(offen.map(zeilenschluessel));
      const welle = laeufe.slice(start, start + GRUPPEN_JE_WELLE_BIS_HEUTE).map((lauf) => lauf.filter((eintrag) => gefragt.has(zeilenschluessel(eintrag.zeilen))));
      ergebnisse = vereine(ergebnisse ?? welle[0], welle);
    }
    return ergebnisse.map(ueberlebt);
  };
}

test("bei sechs Gruppen bleibt das Urteil wie mit den Wellen von heute", async () => {
  const belegung = einzeln(kombinationen(SECHS_GRUPPEN));
  const laeufe = await gruppenlaeufe(belegung, SECHS_GRUPPEN);
  const { ergebnis } = await nacheinanderMit(belegung, laeufe);
  assert.deepEqual(ergebnis.map(ueberlebt), await ueberlebtHeute(laeufe)(alleZeilen(belegung)));
});

async function eintraege(...arten) {
  const belegung = [{ mutant: mutant(1), arten }];
  return (await gruppenlaeufe(belegung, arten.length)).map(([eintrag]) => eintrag);
}

test("von zwei Ergebnissen desselben Mutanten gewinnt das stärkere, bei Gleichstand das aus der früheren Gruppe", async () => {
  const faelle = [
    [["haenger", "ueberlebt"], 0],
    [["bestaetigt", "bestaetigt"], 0],
    [["ueberlebt", "nichtBestaetigt"], 0],
    [["nichtBestaetigt", "ueberlebt"], 0],
    [["ueberlebt", "haenger"], 1],
    [["ohneAbdeckung", "bestaetigt"], 1],
    [["haenger", "bestaetigt"], 1],
  ];
  for (const [arten, sieger] of faelle) {
    const [erster, zweiter] = await eintraege(...arten);
    assert.deepEqual(staerker(erster, zweiter), [erster, zweiter][sieger], arten.join(" vor "));
  }
});

test("ein Hänger aus Gruppe 1, den Gruppe 2 tötet, ist bestätigt getötet, mit der Datei aus Gruppe 2 als Töter", async () => {
  const belegung = [{ mutant: mutant(1), arten: ["haenger", "bestaetigt"] }];
  const laeufe = await gruppenlaeufe(belegung, 2);
  const { ergebnis } = await nacheinanderMit(belegung, laeufe);
  assert.equal(ergebnis.length, 1);
  assert.equal(bestaetigt(ergebnis[0]), true);
  assert.deepEqual(ergebnis[0].toeter, [datei(1)]);
});
