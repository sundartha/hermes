import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { abschnitte } from "../../tools/auftrag/planung/abschnitte.mjs";
import { nummernImOrdner } from "../../tools/auftrag/planung/nummern.mjs";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const SKILL = join(REPO_ROOT, ".claude/skills/pitch");

function beispielOrdner(context) {
  const ordner = probeDirectory(context, {});
  copyFileSync(join(SKILL, "beispiel.md"), join(ordner, "pitch.md"));
  copyFileSync(join(SKILL, "sicherheit-beispiel.md"), join(ordner, "sicherheit.md"));
  return ordner;
}

test("die Nummern aus den Beispieldokumenten kommen mit Text und Quelle", (context) => {
  const { soll, andererAusgang, unklar } = nummernImOrdner(beispielOrdner(context));
  assert.deepEqual([...soll.keys()], ["S1", "S2", "S3", "S6", "S7", "S4", "S5", "B1", "T1", "T2"]);
  assert.deepEqual([...andererAusgang], ["T3"]);
  assert.deepEqual(unklar, []);
  assert.equal(soll.get("S1").quelle, "pitch.md");
  assert.equal(soll.get("T1").quelle, "sicherheit.md");
  const { text } = soll.get("S1");
  assert.equal(text.split("\n").length, 4);
  assert.match(text, /^Gegeben ein angemeldeter Kunde ohne hinterlegte eigene Nummer\n/);
});

test("die Abdeckungsprüfung meldet weiter fehlende Dokumente und Nummern", (context) => {
  const ordner = probeDirectory(context, { "pitch.md": "# Pitch\n", "sicherheit.md": "# Sicherheit\n" });
  const { soll, unklar } = nummernImOrdner(ordner);
  assert.equal(soll.size, 0);
  assert.deepEqual(unklar, [
    "Abdeckung nicht bestimmbar: pitch.md hat kein Szenario „Szenario S<n>:“",
    "Abdeckung nicht bestimmbar: sicherheit.md hat keinen Abschnitt „## 2. Angriffswege“",
  ]);
});

test("Abschnitte werden wörtlich bis zur nächsten Überschrift gleicher oder höherer Stufe geschnitten", () => {
  const text = ["# Doc", "", "## Lösung", "Ablauf:", "1. eins", "", "### Werkzeugvertrag", "Werkzeug `place_call`", "", "## Fehlerfälle", "| a | b |", ""].join("\n");
  const { abschnitte: gefunden, befunde } = abschnitte(text, ["Lösung", "### Werkzeugvertrag", "##  Fehlerfälle ##"]);
  assert.deepEqual(befunde, []);
  assert.equal(gefunden.get("Lösung"), ["## Lösung", "Ablauf:", "1. eins", "", "### Werkzeugvertrag", "Werkzeug `place_call`"].join("\n"));
  assert.equal(gefunden.get("### Werkzeugvertrag"), "### Werkzeugvertrag\nWerkzeug `place_call`");
  assert.equal(gefunden.get("##  Fehlerfälle ##"), "## Fehlerfälle\n| a | b |");
});

test("unbekannte und mehrfache Überschriften sind Befunde, Überschriften in Codeblöcken zählen nicht", () => {
  const text = ["# Doc", "## Lösung", "eins", "```md", "## Lösung", "## Weg", "```", "## Weg", "zwei", "## Weg", "drei", ""].join("\n");
  const { abschnitte: gefunden, befunde } = abschnitte(text, ["Lösung", "Weg", "Gibt es nicht"]);
  assert.deepEqual(befunde, ["Überschrift „Weg“ steht mehrfach im Design Doc", "Überschrift „Gibt es nicht“ steht nicht im Design Doc"]);
  assert.equal(gefunden.get("Lösung"), ["## Lösung", "eins", "```md", "## Lösung", "## Weg", "```"].join("\n"));
  assert.equal(gefunden.size, 1);
});

test("eine Überschrift, deren Text mit # beginnt, wird mit diesem # gefunden und nicht mit der ohne #", () => {
  const text = ["# Doc", "## #1 Ziel", "eins", "## 1 Ziel", "zwei", "### C# ###", "drei", ""].join("\n");
  const { abschnitte: gefunden, befunde } = abschnitte(text, ["## #1 Ziel", "#1 Ziel", " ## 1 Ziel ", "C#"]);
  assert.deepEqual(befunde, []);
  assert.equal(gefunden.get("## #1 Ziel"), "## #1 Ziel\neins");
  assert.equal(gefunden.get("#1 Ziel"), "## #1 Ziel\neins");
  assert.equal(gefunden.get(" ## 1 Ziel "), "## 1 Ziel\nzwei\n### C# ###\ndrei");
  assert.equal(gefunden.get("C#"), "### C# ###\ndrei");
});

test("eine Überschrift aus nur Rauten ist leer und wird auf beiden Seiten gleich behandelt", () => {
  const text = ["# Doc", "## ##", "eins", "## Ziel ####", "zwei", ""].join("\n");
  const { abschnitte: gefunden, befunde } = abschnitte(text, ["## ##", "#", "### Ziel", "Ziel #"]);
  assert.deepEqual(befunde, ["Überschrift „## ##“ ist leer", "Überschrift „#“ ist leer", "Überschrift „### Ziel“ steht nicht im Design Doc"]);
  assert.equal(gefunden.get("Ziel #"), "## Ziel ####\nzwei");
  assert.equal(gefunden.size, 1);
});

test("leere Suche, falsche Stufe und Zaun mit Sprachangabe im Codeblock finden nichts", () => {
  const text = ["## #", "## Lösung", "eins", "```md", "```js", "## Weg", "```", "zwei", "## Ende", ""].join("\n");
  const { abschnitte: gefunden, befunde } = abschnitte(text, ["", "### Lösung", "## Weg", "Lösung"]);
  assert.deepEqual(befunde, [
    "Überschrift „“ ist leer",
    "Überschrift „### Lösung“ steht nicht im Design Doc",
    "Überschrift „## Weg“ steht nicht im Design Doc",
  ]);
  assert.equal(gefunden.get("Lösung"), ["## Lösung", "eins", "```md", "```js", "## Weg", "```", "zwei"].join("\n"));
});
