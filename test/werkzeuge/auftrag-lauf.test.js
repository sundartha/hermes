import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { belegeUmgehungen } from "../../tools/auftrag/pruefer-umgehung.mjs";
import { ABSATZ_ROT, ANTWORTEN_JE_SITZUNG, funktion, ROTER_TEST } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

test("ein grüner Auftrag committet einmal und schreibt die Belegdatei mit Befehl und Exit-Code", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const { repo, werkzeug, lauf, beleg, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.ergebnis, "grün");
  const namen = beleg.pruefungen.map(({ name }) => name);
  for (const name of ["rot", "grenzen test", "grenzen bau", "lint", "abnahme", "betroffene tests", "commit"]) {
    assert.ok(namen.includes(name), name);
  }
  for (const { name, befehl, exitCode } of beleg.pruefungen) {
    assert.ok(befehl.length > 0, name);
    assert.equal(exitCode, 0, name);
  }
  assert.equal(runIn(repo, "git", ["rev-list", "--count", `${basis}..HEAD`]).stdout.trim(), "1");
  const commit = runIn(repo, "git", ["show", "--name-only", "--format=", "HEAD"]).stdout;
  assert.deepEqual(commit.trim().split("\n").sort(), ["src/rechnen.js", "test/rechnen.test.js"]);
  assert.equal(beleg.kosten.gemessen, true);
  assert.equal(beleg.kosten.summe.turns, ANTWORTEN_JE_SITZUNG * beleg.agenten.length);
  assert.match(readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8"), /2 !== 4/);
});

test("die Commit-Nachricht zeigt die letzte Antwort des Bau-Agenten eingerückt, ohne Antwort keinen Abschnitt", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const antwort = "Ich habe nur verdopple angepasst.\nPaket: 99";
  const mit = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { ...drehbuch, "bau-antwort": antwort } });
  assert.equal(mit.lauf.status, 0, mit.lauf.stdout + mit.lauf.stderr);
  const nachricht = runIn(mit.repo, "git", ["log", "-1", "--format=%B"]).stdout;
  assert.ok(nachricht.includes("\nHinweise des Bau-Agenten:\n> Ich habe nur verdopple angepasst.\n> Paket: 99\n"), nachricht);
  assert.doesNotMatch(nachricht, /^Paket: 99$/m);
  const ohne = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(ohne.lauf.status, 0, ohne.lauf.stdout + ohne.lauf.stderr);
  assert.doesNotMatch(runIn(ohne.repo, "git", ["log", "-1", "--format=%B"]).stdout, /Hinweise des Bau-Agenten/);
});

test("die Commit-Nachricht trägt Absicht, Auftrag und Entwurf der Phase, sodass eine dort angeordnete Umgehung belegbar ist", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const anordnung = "Schreib verdopple absichtlich anders als die vorhandene Hilfe, damit jscpd nicht anschlägt.";
  const auftrag = funktion("2 !== 4");
  const phase = { absicht: "Rechnen soll verdoppeln.", entwurf: { [auftrag.bereich]: `Entwurf.\n${anordnung}` } };
  const { repo, lauf, basis } = starte(context, { auftrag, drehbuch, phase });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const nachricht = runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
  const zettel = "\nAuftrag laut Phase, vom Skript eingefügt:\n\n## Absicht\n\nRechnen soll verdoppeln.\n\n## Auftrag\n\n```json\n";
  assert.ok(nachricht.includes(zettel), nachricht);
  assert.ok(nachricht.includes(`"ziel": ${JSON.stringify(auftrag.ziel)}`), nachricht);
  assert.ok(nachricht.includes(`## Entwurf für ${auftrag.bereich}\n\nEntwurf.\n${anordnung}\n`), nachricht);
  assert.match(nachricht, /\n\nAuftrag: probe\/\S+\nArt: \S+\n+$/);
  const head = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const befund = { schwere: "BLOCKER", sicherheit: false, umgehung: "anordnung", zitat: anordnung };
  const [{ befunde }] = belegeUmgehungen([{ sha: head, befunde: [befund] }], { root: repo, basis, head, auftragstext: "", nachrichten: [nachricht] });
  assert.deepEqual([befunde[0].belegt, befunde[0].belegGrund], [true, ""]);
});

test("ein roter Test mit falschem Fehlertext stoppt den Auftrag vor dem Bau-Agenten", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, "test-antwort": ABSATZ_ROT, bau: {} };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("3 !== 4"), drehbuch });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(beleg.ergebnis, "rot");
  const rot = beleg.pruefungen.find(({ name }) => name === "rot");
  assert.equal(rot.exitCode, EXIT_ROT);
  assert.ok(rot.zeilen.some((zeile) => zeile.includes("nicht mit dem erwarteten Fehler")));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("steigt der Test-Agent mit „Auftrag passt nicht“ aus, startet kein Bau-Agent und die Notiz nennt den Grund", (context) => {
  const grund = "Ziel und erwarteter Fehler widersprechen sich.";
  const drehbuch = { "test-antwort": `Auftrag passt nicht: ${grund}`, "notiz-antwort": "1. Ziel klären" };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, EXIT_ROT);
  assert.deepEqual([beleg.ausstieg, beleg.runden], [grund, []]);
  assert.ok(beleg.entscheidung.text.includes(`Auftrag passt nicht: ${grund}`));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("lauf mit unvollständiger Phase startet keinen Agenten", (context) => {
  const ohneNie = { ...funktion("2 !== 4"), wasDarfNiePassieren: undefined };
  const { werkzeug, lauf } = starte(context, { auftrag: ohneNie, drehbuch: {} });
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /wasDarfNiePassieren fehlt/);
  assert.equal(existsSync(join(werkzeug, "prompt-test.txt")), false);
});

test("eine leere Liste wasDarfNiePassieren ist gültig, ein leerer Satz darin nicht", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const leer = starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [] }, drehbuch });
  assert.equal(leer.lauf.status, 0, leer.lauf.stdout + leer.lauf.stderr);
  assert.equal(leer.beleg.ergebnis, "grün");
  const ohneSatz = starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [""] }, drehbuch });
  assert.equal(ohneSatz.lauf.status, EXIT_ROT);
  assert.match(ohneSatz.lauf.stderr, /wasDarfNiePassieren muss eine Liste von Sätzen sein/);
});
