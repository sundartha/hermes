import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { nachCommitPruefen, repoMitBasis } from "./pr-probe.js";
import { REPO_ROOT } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/vorbereitung-pruefen.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const NUMMERN = "src/store/nummern.js";
const BEFUND = /^src\/store\/nummern\.js:\d+: Änderung, die keine Umformung aus tools\/vorbereitung\/katalog\.json ist$/m;

const VORHER = [
  'const VORWAHLEN = ["+49", "+43"];',
  "",
  "export function erlaubt(e164, codes = VORWAHLEN) {",
  '  if (typeof e164 !== "string") return false;',
  "  const n = e164.trim();",
  "  return codes.some((c) => n.startsWith(c));",
  "}",
  "",
].join("\n");

function geprueft(context, nachher) {
  return nachCommitPruefen(repoMitBasis(context, { [NUMMERN]: VORHER }), WERKZEUG, { [NUMMERN]: nachher });
}

function ersetzt(...paare) {
  return paare.reduce((stand, [alt, neu]) => {
    if (!stand.includes(alt)) throw new Error(`nicht im Ausgangstext: ${alt}`);
    return stand.replaceAll(alt, neu);
  }, VORHER);
}

const UMBENANNT = ersetzt(["const n = ", "const nummer = "], ["(c) => n.startsWith(c)", "(vorwahl) => nummer.startsWith(vorwahl)"]);

test("vorbereitung-lokale-umbenennung: zwei kurze lokale Namen heißen danach lang, sonst bleibt die Datei gleich; die Vorbereitung ist gleichwertig", (context) => {
  const lauf = geprueft(context, UMBENANNT);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.output);
  assert.match(lauf.output, /^src\/store\/nummern\.js: gleichwertig \(lokale-umbenennung: 2 Namen\)$/m);
});

test("vorbereitung-lokale-umbenennung: neben der Umbenennung ändert sich eine Bedingung derselben Datei; die Vorbereitung ist rot", (context) => {
  const lauf = geprueft(context, UMBENANNT.replace('typeof e164 !== "string"', "!e164"));
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, BEFUND);
  assert.doesNotMatch(lauf.output, /lokale-umbenennung/);
});

test("vorbereitung-lokale-umbenennung: der neue Name des Rückrufparameters verdeckt die äußere const; die Vorbereitung ist rot", (context) => {
  const lauf = geprueft(context, ersetzt(["(c) => n.startsWith(c)", "(n) => n.startsWith(n)"]));
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, BEFUND);
});

test("vorbereitung-lokale-umbenennung: die Konstante auf oberster Ebene heißt danach anders; die Vorbereitung ist rot", (context) => {
  const lauf = geprueft(context, ersetzt(["VORWAHLEN", "ERLAUBTE_VORWAHLEN"]));
  assert.equal(lauf.status, EXIT_ROT, lauf.output);
  assert.match(lauf.output, BEFUND);
});
