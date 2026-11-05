import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { ROTER_TEST, VERDOPPELT, funktion, namen, pruefung } from "./auftrag-lauf-hilfen.js";
import { GRUNDLAGE, abgebrochen, gesichert, rollen, zeigt, zweiterLauf } from "./auftrag-lauf-fortsetzung-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const PASST_NICHT = "Auftrag passt nicht: Der Entwurf passt nicht zum Abnahmetest.";

test("nach einem abgebrochenen Lauf setzt der nächste auf dem gesicherten Stand fort: kein Test-Agent, der Bau-Agent baut neu", (context) => {
  const { lauf, beleg, repo } = zweiterLauf(abgebrochen(context));
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /Fortsetzung auf gesichertem Stand/);
  assert.deepEqual(rollen(beleg), ["bau"]);
  assert.equal(zeigt(repo, "test/rechnen.test.js"), ROTER_TEST);
  assert.equal(zeigt(repo, "src/rechnen.js"), VERDOPPELT);
  assert.ok(!existsSync(gesichert(repo, "json")), "der Stand bleibt nach dem Commit liegen");
});

test("die Fortsetzung spielt den Abnahmetest ein und prüft ihn wie heute: roter Beleg und Zwischenstand laufen vor dem Bau", (context) => {
  const { beleg } = zweiterLauf(abgebrochen(context));
  const reihenfolge = namen(beleg);
  assert.equal(pruefung(beleg, "rot"), 0);
  assert.ok(reihenfolge.indexOf("rot") < reihenfolge.indexOf("zwischenstand"), reihenfolge.join(", "));
  assert.ok(reihenfolge.indexOf("zwischenstand") < reihenfolge.indexOf("abnahme"), reihenfolge.join(", "));
});

test("ohne roten Lauf davor gibt es keinen Stand: der erste Lauf baut wie heute und schreibt nach dem Commit nichts", (context) => {
  const { lauf, beleg, repo } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: GRUNDLAGE });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Fortsetzung|Gesicherter Stand/);
  assert.deepEqual(rollen(beleg), ["test", "bau"]);
  assert.ok(!existsSync(gesichert(repo, "json")));
});

test("steigt der Bau-Agent mit „Auftrag passt nicht“ aus, bleibt kein gesicherter Stand", (context) => {
  const { repo, lauf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { ...GRUNDLAGE, "bau-antwort": PASST_NICHT } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(!existsSync(gesichert(repo, "json")));
});
