import assert from "node:assert/strict";
import { test } from "node:test";

import { fuehreAus } from "../../tools/auftrag/pruefungen.mjs";
import { fehlerNachRichtigemStand, funktion, ROTER_TEST, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
import { starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const SEKUNDE_MS = 1000;
const LAUFZEILE = /^lauf: /;

function sekunden(dauer) {
  return Math.round(dauer / SEKUNDE_MS);
}

function erwarteteLaufzeilen({ auftrag, pruefungen }) {
  return pruefungen.flatMap(({ name, exitCode, dauer_ms: dauer }) => [
    `lauf: ${name} läuft (Auftrag ${auftrag})`,
    `lauf: ${name} ${exitCode === 0 ? "grün" : "rot"} nach ${sekunden(dauer)} s`,
  ]);
}

const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };

function gebaut(context) {
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH });
}

function laufzeilen(stderr) {
  return stderr.split("\n").filter((zeile) => LAUFZEILE.test(zeile));
}

test("der Beleg eines Auftrags enthält je Prüfschritt die Dauer in Millisekunden, auch für die Commits", (context) => {
  const { lauf, beleg: gelesen } = gebaut(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const ohneDauer = gelesen.pruefungen
    .filter(({ dauer_ms: dauer }) => !Number.isInteger(dauer))
    .map(({ name }) => name);
  assert.deepEqual(ohneDauer, [], JSON.stringify(gelesen.pruefungen));
  const abnahme = gelesen.pruefungen.find(({ name }) => name === "abnahme");
  assert.ok(abnahme.dauer_ms > 0, JSON.stringify(abnahme));
});

test("lauf meldet jede Prüfung beim Start und beim Ende mit der Dauer aus dem Beleg auf stderr, auch ci-lokal am Phasenende", (context) => {
  const { lauf, beleg: gelesen } = gebaut(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(laufzeilen(lauf.stderr), erwarteteLaufzeilen(gelesen), lauf.stderr);
});

test("bei einer Fehlerbehebung meldet lauf auch git bisect beim Start und beim Ende mit der Dauer aus dem Beleg", (context) => {
  const auftrag = { ...funktion("2 !== 4"), art: "fehlerbehebung" };
  const { lauf, beleg: gelesen } = starte(context, { auftrag, drehbuch: DREHBUCH, vorbereiten: fehlerNachRichtigemStand });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const bisect = gelesen.pruefungen.find(({ name }) => name === "bisect");
  assert.ok(Number.isInteger(bisect?.dauer_ms), JSON.stringify(gelesen.pruefungen));
  assert.deepEqual(laufzeilen(lauf.stderr), erwarteteLaufzeilen(gelesen), lauf.stderr);
});

test("die Zusammenfassung am Ende des Auftrags nennt je Prüfung die Dauer in Sekunden", (context) => {
  const { lauf, beleg: gelesen } = gebaut(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  for (const { name, exitCode, dauer_ms: dauer } of gelesen.pruefungen) {
    assert.ok(lauf.stdout.includes(`${name}: Exit ${exitCode} nach ${sekunden(dauer)} s`), `${name}\n${lauf.stdout}`);
  }
});

test("fuehreAus wirft, wenn der Start des Befehls selbst scheitert, statt einen roten Schritt zu melden", (context) => {
  const ordner = probeDirectory(context, {});
  assert.throws(() =>
    fuehreAus("kaputt", [process.execPath, "a\0b"], { cwd: ordner, env: process.env }),
  );
});
