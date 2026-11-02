import { existsSync } from "node:fs";
import { join } from "node:path";

import { bereiche, ordnungsBefunde } from "../abhaengigkeiten/testordnung.mjs";

import { brauchtRotenTest, istTestdatei, jsZwillingDes, reihenfolge } from "./format.mjs";
import { gebauteAuftraege } from "./git.mjs";
import { testVerstoss } from "./pruefungen.mjs";

export const ABHAENGIGKEITSREGELN = ".dependency-cruiser.cjs";
const TEST_ORDNER = "test/";

function vorhanden(root, pfad) {
  return existsSync(join(root, pfad));
}

function gebaut(phase, root) {
  try {
    return gebauteAuftraege(phase, root);
  } catch {
    return new Set();
  }
}

function offeneAuftraege(phase, root) {
  const fertig = gebaut(phase, root);
  return reihenfolge(phase.auftraege).ordnung.filter(({ id }) => !fertig.has(id));
}

function neueTestpfade(auftrag, root) {
  const pfade = new Set([auftrag.abnahme, ...auftrag.erwarteteDateien].filter((pfad) => pfad.startsWith(TEST_ORDNER)));
  return [...pfade].filter((pfad) => {
    const zwilling = jsZwillingDes(pfad);
    return !vorhanden(root, pfad) && (zwilling === undefined || !vorhanden(root, zwilling));
  });
}

function testordnungBefunde(auftraege, root) {
  if (!vorhanden(root, ABHAENGIGKEITSREGELN)) return [];
  const erlaubt = bereiche(root);
  return auftraege.flatMap((auftrag) => ordnungsBefunde(neueTestpfade(auftrag, root), erlaubt).map((befund) => `${auftrag.id}: ${befund}`));
}

function testhilfeBefunde(auftraege, root) {
  const angelegt = new Set();
  return auftraege.flatMap((auftrag) => {
    const bestand = (pfad) => vorhanden(root, pfad) || angelegt.has(pfad);
    const tests = auftrag.erwarteteDateien.filter(istTestdatei);
    const verstoesse = brauchtRotenTest(auftrag) ? tests.map((pfad) => testVerstoss({ auftrag, bestand }, pfad)).filter((verstoss) => verstoss !== null) : [];
    for (const pfad of tests) angelegt.add(pfad);
    return verstoesse.map((verstoss) => `${auftrag.id}: erwarteteDateien lässt lauf nach dem Test-Agenten abbrechen mit „${verstoss}“`);
  });
}

export function vorLaufBefunde(phase, root) {
  const auftraege = offeneAuftraege(phase, root);
  return [...testordnungBefunde(auftraege, root), ...testhilfeBefunde(auftraege, root)];
}
