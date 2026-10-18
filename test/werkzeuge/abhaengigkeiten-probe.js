import assert from "node:assert/strict";

import { DEPENDENCY_TOOL, runIn } from "./probe-repo.js";

export const KONFIGURATION = ".dependency-cruiser.cjs";
export const BEREICHE_DATEI = "tools/bereiche.json";
export const TESTIMPORTE = "tools/basis/test-importe.json";
export const ALTVERSTOESSE = ".dependency-cruiser-known-violations.json";
export const EINGANGSREGEL = "tests-nur-ueber-eingaenge";
export const EXIT_OK = 0;
export const EXIT_FINDING = 1;

export function liste(eintraege) {
  return `${JSON.stringify(eintraege)}\n`;
}

export function pruefe(verzeichnis) {
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD"]);
}

export function istGruen(ergebnis) {
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
}

export function istRot(ergebnis, muster) {
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, muster);
}
