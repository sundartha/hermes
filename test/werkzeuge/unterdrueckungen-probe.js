import assert from "node:assert/strict";

export const TOR = "scripts/check-staged-suppressions.js";
export const VORAB_HAKEN = ".githooks/pre-commit";
export const UNTERDRUECKUNGEN = "eslint-suppressions.json";
export const EXIT_GRUEN = 0;
export const EXIT_ROT = 1;

export function istGruen(ergebnis) {
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
}

export function istRot(ergebnis) {
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
}
