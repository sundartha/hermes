import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { MIT_SIEBEN, PASST_NICHT, ROTER_TEST, SIEBEN_TEST, funktion, namen, pruefung } from "./auftrag-lauf-hilfen.js";
import { ACHT_TEST, ERSTER_START_NACH_ABBRUCH, ERSTER_START_NACH_ABBRUCH_ANHAENGEN, NACHRUNDE_2_ANHAENGEN, ZWEITER_START_NACH_ABBRUCH, ZWEITER_START_NACH_ABBRUCH_ANHAENGEN, ACHT_ZUSATZ, GRUNDLAGE, RECHNEN, ZWEI_MUTANTEN, abgebrochen, ersteRunde, gesichert, rollen, zeigt, zweiterLauf } from "./auftrag-lauf-fortsetzung-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

test("nach einem abgebrochenen Lauf setzt der nächste auf dem gesicherten Stand fort: kein Bau-Agent, keine erste Mutation, Mutation nach Test voll", (context) => {
  const erster = abgebrochen(context, { drehbuch: { "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST } } });
  const { lauf, beleg, repo } = zweiterLauf(erster, { [ERSTER_START_NACH_ABBRUCH_ANHAENGEN]: { [RECHNEN]: ACHT_ZUSATZ } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /Fortsetzung auf gesichertem Stand/);
  assert.deepEqual(rollen(beleg), ["test"]);
  assert.deepEqual(namen(beleg).filter((name) => name.startsWith("mutation")), ["mutation nach Test"]);
  const voll = beleg.pruefungen.find(({ name }) => name === "mutation nach Test");
  assert.match(voll.befehl, new RegExp(`^npm --silent run test:mutation -- (--in-ci )?--basis ${erster.basis}$`));
  assert.equal(pruefung(beleg, "mutation nach Test"), 0);
  assert.equal(zeigt(repo, "test/rechnen.test.js"), ACHT_TEST);
  assert.equal(zeigt(repo, "src/rechnen.js"), MIT_SIEBEN["src/rechnen.js"]);
  assert.ok(!existsSync(gesichert(repo, "json")), "der Stand bleibt nach dem Commit liegen");
});

test("die Fortsetzung spielt den Abnahmetest ein und prüft ihn wie heute: roter Beleg und Zwischenstand laufen vor dem Bau", (context) => {
  const { beleg, repo } = zweiterLauf(abgebrochen(context), { [ERSTER_START_NACH_ABBRUCH]: { [RECHNEN]: ACHT_TEST } });
  const reihenfolge = namen(beleg);
  assert.equal(pruefung(beleg, "rot"), 0);
  assert.ok(reihenfolge.indexOf("rot") < reihenfolge.indexOf("zwischenstand"), reihenfolge.join(", "));
  assert.ok(reihenfolge.indexOf("zwischenstand") < reihenfolge.indexOf("abnahme"), reihenfolge.join(", "));
  assert.ok(zeigt(repo, "test/rechnen.test.js").startsWith(ROTER_TEST));
});

test("endet die erste Runde rot und die zweite im selben Lauf, setzt die zweite auf dem gesicherten Stand fort und behält die Tests der Nachrunde", (context) => {
  const drehbuch = { ...GRUNDLAGE, "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST }, [NACHRUNDE_2_ANHAENGEN]: { [RECHNEN]: ACHT_ZUSATZ } };
  const { lauf, beleg, repo } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: ZWEI_MUTANTEN });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.runde, 2);
  assert.deepEqual(rollen(ersteRunde(repo)), ["test", "bau", "bau", "test"]);
  assert.deepEqual(rollen(beleg), ["test"]);
  assert.deepEqual(namen(beleg).filter((name) => name.startsWith("mutation")), ["mutation nach Test"]);
  assert.equal(zeigt(repo, "test/rechnen.test.js"), ACHT_TEST);
});

test("senkt die Fortsetzung die Überlebenden, aber nicht auf null, geht der Lauf in die nächste Fortsetzung statt in die Entscheidung", (context) => {
  const erster = abgebrochen(context);
  const { lauf, beleg, repo } = zweiterLauf(erster, { [ERSTER_START_NACH_ABBRUCH]: { [RECHNEN]: SIEBEN_TEST }, [ZWEITER_START_NACH_ABBRUCH_ANHAENGEN]: { [RECHNEN]: ACHT_ZUSATZ } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.runde, 2);
  assert.equal(ersteRunde(repo).ohneFortschritt, null);
  assert.deepEqual([ersteRunde(repo).fortgesetzt, ersteRunde(repo).ergebnis], [true, "rot"]);
  assert.deepEqual(rollen(beleg), ["test"]);
});

test("senkt eine Fortsetzung die Überlebenden nicht, zählt sie wie eine rote Runde: Entscheidung statt neuer Runde, und der Stand ist weg", (context) => {
  const erster = abgebrochen(context);
  const { lauf, beleg, repo } = zweiterLauf(erster, { [ERSTER_START_NACH_ABBRUCH]: {}, [ZWEITER_START_NACH_ABBRUCH]: {} });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.runde, 1);
  assert.deepEqual(beleg.ohneFortschritt, { vorher: 2, jetzt: 2 });
  assert.ok(beleg.entscheidung.text.startsWith("## Entscheidung nötig\n"), beleg.entscheidung.text);
  assert.ok(beleg.entscheidung.text.includes("nicht gesenkt (vorher 2, jetzt 2)"), beleg.entscheidung.text);
  assert.deepEqual(rollen(beleg), ["test"]);
  assert.ok(!existsSync(gesichert(repo, "json")), "der Stand bleibt nach der Entscheidung liegen");
});

test("ohne roten Lauf davor gibt es keinen Stand: der erste Lauf baut wie heute und schreibt nach dem Commit nichts", (context) => {
  const drehbuch = { ...GRUNDLAGE, "test-nachrunde": { "test/rechnen.test.js": ACHT_TEST } };
  const { lauf, beleg, repo } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: ZWEI_MUTANTEN });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Fortsetzung|Gesicherter Stand/);
  assert.deepEqual(rollen(beleg), ["test", "bau", "bau", "test"]);
  assert.ok(!existsSync(gesichert(repo, "json")));
});

test("meldet der Bau-Agent in der Nachrunde, dass die Zeile nicht zu retten ist, bleibt der Ausstieg ohne gesicherten Stand", (context) => {
  const drehbuch = { ...GRUNDLAGE, "bau-nachrunde-antwort": PASST_NICHT };
  const { repo, lauf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: ZWEI_MUTANTEN });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(!existsSync(gesichert(repo, "json")));
});
