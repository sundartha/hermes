import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const PHASE = "P-9-probe";
const ORDNER = `plaene/${PHASE}`;
const ANNAHMEN = [
  "| Aussage | Beleg | Wenn sie nicht stimmt |",
  "|---|---|---|",
  "| Stripe liefert das Abo-Ende als Unix-Zeit in Sekunden (`current_period_end`), kein ISO-Text | `src/billing/stripe.js` | – |",
  "| `verdopple` gibt heute die Zahl unverändert zurück | `src/rechnen.js` | – |",
].join("\n");
const ANDERER_ABSCHNITT = "Nur für das Zusammensetzen gedacht.";
const AUS_DER_SICHERHEIT = "Angriffsweg B7 über die hinterlegte Nummer.";
const DESIGN = [
  "# P-9 Probe: Design Doc",
  "",
  "## Zur Freigabe",
  ANDERER_ABSCHNITT,
  "",
  "## Ausgangslage und Annahmen",
  ANNAHMEN,
  "",
  "## Lösung",
  ANDERER_ABSCHNITT,
  "",
].join("\n");
const AUFTRAG = { ...funktion("2 !== 4"), prueft: ["S1"], szenarien: { S1: "Gegeben 2, dann 4." } };
const DREHBUCH = {
  test: { "test/rechnen.test.js": ROTER_TEST },
  bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
};

function laufMit(context, plan, phase = PHASE) {
  const dateien = Object.fromEntries(Object.entries(plan).map(([name, text]) => [`${ORDNER}/${name}`, text]));
  return starte(context, { auftrag: AUFTRAG, drehbuch: DREHBUCH, dateien, phase: { phase } });
}

function prompt(werkzeug, rolle) {
  const datei = join(werkzeug, `prompt-${rolle}.txt`);
  return existsSync(datei) ? readFileSync(datei, "utf8") : null;
}

test("Annahmen: Test- und Bau-Agent einer Phase aus einem Pitch bekommen den Abschnitt „Ausgangslage und Annahmen“ aus design.md wörtlich, sonst nichts aus Design oder Sicherheitsprüfung", (context) => {
  const { werkzeug, lauf } = laufMit(context, { "pitch.md": "# P-9\n", "design.md": DESIGN, "sicherheit.md": `# Sicherheit\n\n${AUS_DER_SICHERHEIT}\n` });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  for (const rolle of ["test", "bau"]) {
    const text = prompt(werkzeug, rolle);
    assert.ok(text.includes(`\n${ANNAHMEN}\n`), `${rolle}: ${text}`);
    assert.ok(text.includes(`${ORDNER}/design.md`), rolle);
    assert.equal(text.includes(ANDERER_ABSCHNITT), false, rolle);
    assert.equal(text.includes(AUS_DER_SICHERHEIT), false, rolle);
  }
});

test("Annahmen: fehlt einer Phase aus einem Pitch die Design-Datei oder ihr Abschnitt, startet lauf keinen Agenten und nennt Zweck, Behebung und Ausweg", (context) => {
  const ohneAbschnitt = DESIGN.replace("## Ausgangslage und Annahmen", "## Ausgangslage");
  const leer = DESIGN.replace(ANNAHMEN, "");
  for (const plan of [{ "pitch.md": "# P-9\n" }, { "design.md": ohneAbschnitt }, { "design.md": leer }]) {
    const { werkzeug, lauf } = laufMit(context, plan);
    assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
    assert.match(lauf.stderr, new RegExp(`${ORDNER}/design\\.md`));
    assert.match(lauf.stderr, /Ausgangslage und Annahmen/);
    assert.match(lauf.stderr, /Entscheidungsnotiz/);
    assert.equal(prompt(werkzeug, "test"), null, Object.keys(plan).join());
  }
});

test("Annahmen: eine Phase ohne Pitch läuft wie bisher, ohne Design-Datei und ohne Abschnitt im Prompt", (context) => {
  const { werkzeug, lauf } = laufMit(context, {}, "probe");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(prompt(werkzeug, "test").includes("Annahmen"), false);
});
