import { readFileSync } from "node:fs";

import { AUSSERHALB, GESCHUETZT, PHASE_PASST_NICHT, ROLLE, VERSTOSS, ZU_VIELE_ZEILEN, beleg } from "./pruefungen.mjs";

const TEXTE = JSON.parse(readFileSync(new URL("zweck.json", import.meta.url), "utf8"));

export const PRUEFUNG = {
  GRENZEN_BAU: "grenzen bau",
  GRENZEN_TEST: "grenzen test",
  ROT: "rot",
  ABNAHME_VORHER: "abnahme vorher",
  TYPPRUEFUNG: "typprüfung",
  LINT: "lint",
  PIN: "pin-prüfung",
  ABNAHME: "abnahme",
  BETROFFENE_TESTS: "betroffene tests",
  MUTATION: "mutation",
  MUTATION_NACH_BAU: "mutation nach Bau",
  MUTATION_NACH_TEST: "mutation nach Test",
  MUTATION_ALTER_STAND: "mutation alter Stand",
  UMBAU_EINSPIELEN: "umbau einspielen",
  UNTERDRUECKUNGEN_KUERZEN: "unterdrückungen kürzen",
  ZWISCHENSTAND: "zwischenstand",
  TESTS_ALTER_STAND: "tests alter Stand",
  COMMIT: "commit",
};

export const GRUND = {
  BELEGE: "belege",
  STILLSTAND: "stillstand",
  AGENT_EXIT: "agent exit",
  KEINE_AENDERUNG: "keine änderung",
  MUTATION_ABBRUCH: "mutation abbruch",
};

export const MELDUNG = {
  STOPP: "stopp",
  UMBAU_PLAN: "umbau-plan",
  UEBERNAHME: "übernahme",
  SPERRE: "sperre",
  REPARATUR: "reparatur",
  PRUEFLEITER: "prüfleiter",
  UEBERGABE: "uebergabe",
  PHASENDATEI: "phasendatei",
  NEUSCHNITT: "neuschnitt",
  ABDECKUNG: "abdeckung",
  SCHNITT: "schnitt",
};

const HINWEIS_SCHRITTE = new Set(["bisect", "entscheidung kommentar", "entscheidung label", "merge-tree", "cherry-pick"]);
const GRENZEN = new Set([PRUEFUNG.GRENZEN_BAU, PRUEFUNG.GRENZEN_TEST]);
const ZUSAMMENGEFASST = new Map([
  [PRUEFUNG.MUTATION_NACH_BAU, PRUEFUNG.MUTATION],
  [PRUEFUNG.MUTATION_NACH_TEST, PRUEFUNG.MUTATION],
  [PRUEFUNG.ZWISCHENSTAND, PRUEFUNG.COMMIT],
  [PRUEFUNG.TESTS_ALTER_STAND, PRUEFUNG.COMMIT],
]);
const GRENZEN_ALLGEMEIN = "grenzen";
const GRENZ_ARTEN = [
  [GESCHUETZT, "grenzen/geschützt"],
  [AUSSERHALB, "grenzen/bereich"],
  [ROLLE.TEST_IM_BAU, "grenzen/test-im-bau"],
  [ROLLE.PRODUKT_IM_TEST, "grenzen/produkt-im-test"],
  [ROLLE.FREMDER_TEST, "grenzen/fremder-test"],
  [PHASE_PASST_NICHT, "grenzen/phasendatei"],
];
const OHNE_AUSWEG = "entfällt";
const BLOCK = [
  ["Wozu", "wozu"],
  ["Echte Behebung", "behebung"],
  ["Nicht angenommen", "nichtAngenommen"],
  ["Ausweg", "ausweg"],
];

function grenzId(verstoss) {
  const art = GRENZ_ARTEN.find(([anfang]) => verstoss.startsWith(anfang));
  if (art) return art[1];
  return verstoss.includes(ZU_VIELE_ZEILEN) ? "grenzen/zeilen" : GRENZEN_ALLGEMEIN;
}

function grenzIds(zeilen) {
  const verstoesse = zeilen.filter((zeile) => zeile.startsWith(VERSTOSS)).map((zeile) => zeile.slice(VERSTOSS.length));
  const ids = [...new Set(verstoesse.map(grenzId))];
  return ids.length > 0 ? ids : [GRENZEN_ALLGEMEIN];
}

export function zweckIds({ name, zeilen = [] }) {
  if (HINWEIS_SCHRITTE.has(name)) return [];
  if (GRENZEN.has(name)) return grenzIds(zeilen);
  return [ZUSAMMENGEFASST.get(name) ?? name];
}

export function zweckBlock(id) {
  const text = TEXTE[id];
  if (text === undefined) throw new Error(`Kein Zweck-Text für die Prüfung ${id} in tools/auftrag/zweck.json.`);
  return BLOCK.map(([titel, feld]) => `${titel}: ${text[feld]}`);
}

export function hatAusweg(id) {
  return !TEXTE[id].ausweg.startsWith(OHNE_AUSWEG);
}

export function zweckBeleg(ergebnis) {
  const belegt = beleg(ergebnis);
  if (ergebnis.exitCode === 0) return belegt;
  return { ...belegt, zweck: zweckIds({ name: ergebnis.name, zeilen: ergebnis.ausgabe.split("\n") }) };
}

const BLOCKZEILEN = new Set(Object.keys(TEXTE).flatMap(zweckBlock));

export function ohneZweck(zeilen) {
  return zeilen.filter((zeile) => !BLOCKZEILEN.has(zeile));
}
