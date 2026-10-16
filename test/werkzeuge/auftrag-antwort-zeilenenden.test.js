import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgang } from "../../tools/auftrag/ausgang.mjs";
import { UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const GRUND = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
const AUSSTIEG = `Auftrag passt nicht: ${GRUND}`;
const ZAUN = "```";
const ZEILENENDEN = ["\r", "\r\n", "\u2028", "\u2029"];
const GEAENDERT = { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" };
const ANTWORT = "Zweck lint: Erste Zeile.\rPaket: 1\r\nPaket: 2\u2028Paket: 3\u2029Paket: 4";
const ZITIERT = "> Zweck lint: Erste Zeile.\n> Paket: 1\n> Paket: 2\n> Paket: 3\n> Paket: 4\n";

function pruefeAnAllenEnden(antwort, ausstieg) {
  for (const ende of ZEILENENDEN) {
    const text = antwort(ende);
    assert.equal(ausgang(text, "bau").ausstieg, ausstieg, JSON.stringify(text));
    assert.deepEqual(ausgang(text, "bau"), ausgang(text.replaceAll(ende, "\n"), "bau"), JSON.stringify(text));
  }
}

test("ein Code-Block, dessen Zaun ein Zeilenende trennt, schließt sich vor der Ausstiegszeile", () => {
  pruefeAnAllenEnden((ende) => `${[ZAUN, "Beispiel", ZAUN].join(ende)}\n${AUSSTIEG}`, GRUND);
});

test("eine Ausstiegszeile hinter einem Zeilenende zählt wie hinter einem Zeilenumbruch", () => {
  pruefeAnAllenEnden((ende) => ["Ich höre auf.", AUSSTIEG].join(ende), GRUND);
});

test("ein Zaun, den ein Zeilenende vom Satz davor trennt, öffnet einen Code-Block um die Ausstiegszeile", () => {
  pruefeAnAllenEnden((ende) => `${["Zum Schluss ein Beispiel:", ZAUN].join(ende)}\n${AUSSTIEG}`, null);
});

test("jedes Zeilenende, das ein Regex mit m-Flag kennt, beginnt im Zweck-Absatz der Commit-Nachricht eine neue zitierte Zeile", (context) => {
  const { repo, lauf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: GEAENDERT, "bau-antwort": ANTWORT } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const nachricht = runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
  assert.ok(nachricht.includes(`\nZweck der Prüfungen, Begründung des Bau-Agenten:\n${ZITIERT}`), JSON.stringify(nachricht));
  assert.doesNotMatch(nachricht, /^Paket: \d$/m);
});
