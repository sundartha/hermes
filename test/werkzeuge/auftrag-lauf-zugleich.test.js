import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, VERDOPPELT, funktion, namen, pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

const GRENZEN_TEST = "grenzen test";
const PRODUKT_IM_TEST = "grenzen/produkt-im-test";
const GENUTZT = "vorhandenes genutzt";
const SCHUTZTESTS = "schutztests";
const SEMGREP = "semgrep";
const VORIGE_RUNDE = "## Fehlerausgabe der vorigen Runde";
const SATZ = "Eine Zahl wird nie falsch verdoppelt.";
const SCHUTZFALL = 'test("[NIE1] drei wird sechs", () => assert.equal(verdopple(3), 6));';
const absatz = (...ids) => ids.map((id) => `Zweck ${id}: Drehbuchtext des Ersatz-Agenten.`).join("\n");
const LISTEN = { "tools/basis/semgrep.json": `${JSON.stringify({ version: "1.0.0", befunde: [] })}\n` };
const MIT_SCHUTZ = [ROTER_TEST.trimEnd(), SCHUTZFALL, ""].join("\n");
const TEXT_GEAENDERT = { "src/text.js": "export function gross(text) {\n  return String(text).toUpperCase();\n}\n" };
const NUTZT_VERDOPPLE = { ...UMBAU, nutzen: [{ datei: "src/rechnen.js", funktion: "verdopple", fuer: "src/text.js" }] };

function lauf(context, drehbuch, dateien = {}) {
  const auftrag = { ...funktion("2 !== 4"), wasDarfNiePassieren: [SATZ] };
  return starte(context, { auftrag, drehbuch: { bau: { "src/rechnen.js": VERDOPPELT }, ...drehbuch }, dateien });
}

function beideBefundeBehoben() {
  return {
    test: { "test/rechnen.test.js": ROTER_TEST, ...TEXT_GEAENDERT },
    "test-nach": { "test/rechnen.test.js": MIT_SCHUTZ },
    "test-nach-antwort": absatz(PRODUKT_IM_TEST, SCHUTZTESTS),
    "bau-nach": { "src/rechnen.js": VERDOPPELT },
    nach: VORIGE_RUNDE,
  };
}

test("sind grenzen test und schutztests in einer Runde des Test-Agenten rot, bekommt er beide Befunde in einem Prompt", (context) => {
  const { werkzeug, lauf: ergebnis } = lauf(context, beideBefundeBehoben());
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  const prompt = readFileSync(join(werkzeug, "prompt-test-nach.txt"), "utf8");
  for (const teil of ["Runde 1: grenzen test endete mit Exit 1. schutztests endete mit Exit 1.", "Der Test-Agent hat Produktcode geändert: src/text.js", "hat keinen neuen Testfall mit der Kennung [NIE1]", `dem Test-Agenten: ${PRODUKT_IM_TEST}`]) {
    assert.ok(prompt.includes(teil), `${teil}\n${prompt}`);
  }
});

test("behebt der Test-Agent beide Befunde der ersten Runde, wird der Auftrag in der zweiten Runde grün", (context) => {
  const { lauf: ergebnis, beleg } = lauf(context, beideBefundeBehoben());
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.deepEqual([beleg.ergebnis, beleg.runde, pruefung(beleg, GRENZEN_TEST), pruefung(beleg, SCHUTZTESTS)], ["grün", 2, 0, 0]);
});

test("semgrep läuft in der Kette des Test-Agenten nach den schnellen Prüfungen, wenn alle grün sind", (context) => {
  const { beleg } = lauf(context, { test: { "test/rechnen.test.js": MIT_SCHUTZ }, "test-antwort": absatz(SEMGREP) }, LISTEN);
  const liste = namen(beleg);
  assert.ok(liste.includes(SEMGREP), liste.join(", "));
  assert.ok(pruefung(beleg, SCHUTZTESTS) === 0 && liste.indexOf(SCHUTZTESTS) < liste.indexOf(SEMGREP), liste.join(", "));
});

test("semgrep läuft in der Kette des Test-Agenten nicht, solange eine schnelle Prüfung rot ist", (context) => {
  const { beleg, werkzeug } = lauf(context, { test: { "test/rechnen.test.js": ROTER_TEST }, "test-antwort": absatz(SCHUTZTESTS) }, LISTEN);
  assert.deepEqual([beleg.ergebnis, beleg.runde, pruefung(beleg, SCHUTZTESTS)], ["rot", 2, EXIT_ROT]);
  assert.ok(!namen(beleg).includes(SEMGREP), namen(beleg).join(", "));
  assert.ok(!namen(beleg).includes("rot"), namen(beleg).join(", "));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("semgrep und die betroffenen Tests laufen in der Kette des Bau-Agenten nicht, solange eine schnelle Prüfung rot ist", (context) => {
  const drehbuch = { bau: TEXT_GEAENDERT, "bau-antwort": absatz(GENUTZT) };
  const { beleg } = starte(context, { auftrag: NUTZT_VERDOPPLE, drehbuch, dateien: LISTEN });
  assert.equal(pruefung(beleg, GENUTZT), EXIT_ROT, JSON.stringify(beleg.pruefungen));
  assert.ok(namen(beleg).includes("abnahme"), namen(beleg).join(", "));
  assert.ok(!namen(beleg).includes(SEMGREP), namen(beleg).join(", "));
  assert.ok(!namen(beleg).includes("betroffene tests"), namen(beleg).join(", "));
});
