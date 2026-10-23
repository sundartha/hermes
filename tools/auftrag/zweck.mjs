import { existsSync, readdirSync, readFileSync } from "node:fs";

import { AUSSERHALB, GESCHUETZT, PHASE_PASST_NICHT, ROLLE, VERSTOSS, ZU_VIELE_ZEILEN, beleg } from "./pruefungen.mjs";

const AUFTRAGSWEG = "tools/auftrag/zweck.json";
const WEITERE = "tools/zweck/";
export const ZWECK_ORTE = `${AUFTRAGSWEG} oder ${WEITERE}`;
const WEITERE_ORDNER = new URL("../zweck/", import.meta.url);
const JSON_ENDUNG = ".json";

function gelesen(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function weitereQuellen() {
  if (!existsSync(WEITERE_ORDNER)) return [];
  const dateien = readdirSync(WEITERE_ORDNER).filter((name) => name.endsWith(JSON_ENDUNG)).toSorted();
  return dateien.map((name) => [`${WEITERE}${name}`, gelesen(new URL(name, WEITERE_ORDNER))]);
}

export function zweckTexteVereinen(quellen) {
  const texte = {};
  const herkunft = new Map();
  for (const [datei, eintraege] of quellen) {
    for (const [id, text] of Object.entries(eintraege)) {
      if (herkunft.has(id)) throw new Error(`Die Zweck-ID ${id} steht doppelt: in ${herkunft.get(id)} und in ${datei}.`);
      herkunft.set(id, datei);
      texte[id] = text;
    }
  }
  return texte;
}

const TEXTE = zweckTexteVereinen([[AUFTRAGSWEG, gelesen(new URL("zweck.json", import.meta.url))], ...weitereQuellen()]);

export const PRUEFUNG = {
  GRENZEN_BAU: "grenzen bau",
  GRENZEN_TEST: "grenzen test",
  IMPORTENDUNGEN: "importendungen",
  LISTENUMZUG: "listenumzug",
  GEAENDERTE_FAELLE: "geänderte fälle",
  TESTUMBAU_FAELLE: "testumbau fälle",
  VORBAU_NUR_ERGAENZT: "vorbau nur ergänzt",
  MUTATION_TESTUMBAU: "mutation testumbau",
  ROT: "rot",
  ABNAHME_VORHER: "abnahme vorher",
  TYPPRUEFUNG: "typprüfung",
  LINT: "lint",
  PIN: "pin-prüfung",
  GENUTZT: "vorhandenes genutzt",
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
  COMMITLINT: "commitlint",
};

export const GRUND = {
  BELEGE: "belege",
  STILLSTAND: "stillstand",
  AGENT_EXIT: "agent exit",
  KEINE_AENDERUNG: "keine änderung",
  MUTATION_ABBRUCH: "mutation abbruch",
  ENTFERNT_OHNE_GRUND: "entfernt ohne grund",
  ZWECK_ABSATZ: "zweck-absatz",
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
  TS_SPERRE: "ts-sperre",
  WERKZEUGABBRUCH: "werkzeugabbruch",
  MIGRATIONEN: "migrationen",
  FESTE_PFADE: "feste-pfade",
  VORBEREITUNG: "vorbereitung",
  JSCPD: "jscpd",
  SEMGREP_FEHLT: "semgrep-fehlt",
  PAKETE_FEHLEN: "pakete-fehlen",
  POSTGRES_FEHLT: "postgres-fehlt",
  CI_LOKAL: "ci-lokal",
};

export const ALTER_TEST = "alter test";

const HINWEIS_SCHRITTE = new Set([ALTER_TEST, "bisect", "entscheidung kommentar", "entscheidung label", "merge-tree", "cherry-pick"]);
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
  [ROLLE.TESTHILFE_IM_VERHALTEN, "grenzen/testhilfe"],
  [PHASE_PASST_NICHT, "grenzen/phasendatei"],
];
const OHNE_AUSWEG = "entfällt";
const EXIT_BEFUND = 1;
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
  if (text === undefined) throw new Error(`Kein Zweck-Text für die Prüfung ${id} in ${ZWECK_ORTE}.`);
  return BLOCK.map(([titel, feld]) => `${titel}: ${text[feld]}`);
}

export function befundeMeldenUndScheitern(befunde, id) {
  for (const befund of befunde) console.error(befund);
  if (befunde.length === 0) return;
  console.error(zweckBlock(id).join("\n"));
  process.exitCode = EXIT_BEFUND;
}

export function hatAusweg(id) {
  return !TEXTE[id].ausweg.startsWith(OHNE_AUSWEG);
}

export function zweckBeleg(ergebnis) {
  const belegt = beleg(ergebnis);
  if (ergebnis.exitCode === 0) return belegt;
  return { ...belegt, zweck: zweckIds({ name: ergebnis.name, zeilen: ergebnis.ausgabe.split("\n") }) };
}

const BAU = "bau";
const TEST = "test";
const LETZTER_AGENT = "letzter agent";
const ZUSTAENDIG = new Map([
  [PRUEFUNG.GRENZEN_BAU, BAU],
  [PRUEFUNG.TYPPRUEFUNG, BAU],
  [PRUEFUNG.LINT, BAU],
  [PRUEFUNG.PIN, BAU],
  [PRUEFUNG.ABNAHME, BAU],
  [PRUEFUNG.BETROFFENE_TESTS, BAU],
  [MELDUNG.MIGRATIONEN, BAU],
  [MELDUNG.FESTE_PFADE, BAU],
  [MELDUNG.VORBEREITUNG, BAU],
  [PRUEFUNG.MUTATION, BAU],
  [PRUEFUNG.MUTATION_NACH_BAU, BAU],
  [PRUEFUNG.COMMIT, BAU],
  [GRUND.KEINE_AENDERUNG, BAU],
  [PRUEFUNG.GRENZEN_TEST, TEST],
  [PRUEFUNG.GEAENDERTE_FAELLE, TEST],
  [PRUEFUNG.ROT, TEST],
  [PRUEFUNG.MUTATION_NACH_TEST, TEST],
  [PRUEFUNG.MUTATION_ALTER_STAND, TEST],
  [PRUEFUNG.ZWISCHENSTAND, TEST],
  [PRUEFUNG.TESTS_ALTER_STAND, TEST],
  [GRUND.BELEGE, LETZTER_AGENT],
  [GRUND.STILLSTAND, LETZTER_AGENT],
]);
const AGENT_NAMEN = new Map([
  [BAU, "dem Bau-Agenten"],
  [TEST, "dem Test-Agenten"],
]);

export function zustaendig(schritt, letzteRolle) {
  const rolle = ZUSTAENDIG.get(schritt) ?? null;
  return rolle === LETZTER_AGENT ? (letzteRolle ?? null) : rolle;
}

const ABSATZ =
  "Begründung: Änderst du daraufhin Dateien, beginnt in deiner letzten Antwort je Prüfung, die dir hier zugeordnet ist, ein Absatz mit der eigenen Zeile „Zweck <ID>:“, wie in deinen Anweisungen beschrieben.";

export function absatzVerlangt(ids) {
  return `${ABSATZ} Dir zugeordnet: ${ids.join(", ")}.`;
}

export function absatzZuordnung(pflicht) {
  const teile = [...AGENT_NAMEN].flatMap(([rolle, name]) => {
    const ids = [...new Set(pflicht.filter((eintrag) => eintrag.rolle === rolle).map(({ id }) => id))];
    return ids.length > 0 ? [`${name}: ${ids.join(", ")}`] : [];
  });
  return teile.length > 0 ? [`${ABSATZ} Zugeordnet sind ${teile.join("; ")}.`] : [];
}

export function kenntZweck(id) {
  return Object.hasOwn(TEXTE, id);
}

const BLOCKZEILEN = new Set(Object.keys(TEXTE).flatMap(zweckBlock));

export function ohneZweck(zeilen) {
  return zeilen.filter((zeile) => !BLOCKZEILEN.has(zeile));
}
