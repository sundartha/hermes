import assert from "node:assert/strict";
import { test } from "node:test";

import { fuehreAus } from "../../tools/auftrag/pruefungen.mjs";
import { fehlerNachRichtigemStand, funktion, ROTER_TEST, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
import { starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const SEKUNDE_MS = 1000;
const LAUFZEILE = /^lauf: /;
const CI_LOKAL_START = "lauf: ci-lokal läuft (Phase probe)";
const CI_LOKAL_ENDE = /^lauf: ci-lokal grün nach \d+ s$/;

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

function laufzeilenOhneCiLokal({ stderr }) {
  return stderr.split("\n").filter((zeile) => LAUFZEILE.test(zeile)).slice(0, -2);
}

test("der Beleg eines Auftrags enthält je Prüfschritt die Dauer in Millisekunden, auch für die Commits", (context) => {
  const { lauf, beleg: gelesen } = gebaut(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const ohneDauer = gelesen.pruefungen
    .filter(({ dauer_ms: dauer }) => !Number.isInteger(dauer))
    .map(({ name }) => name);
  assert.deepEqual(ohneDauer, [], JSON.stringify(gelesen.pruefungen));
  const lint = gelesen.pruefungen.find(({ name }) => name === "lint");
  assert.ok(lint.dauer_ms > 0, JSON.stringify(lint));
});

test("lauf meldet jede Prüfung beim Start und beim Ende mit der Dauer aus dem Beleg auf stderr, auch ci-lokal am Phasenende", (context) => {
  const { lauf, beleg: gelesen } = gebaut(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const zeilen = lauf.stderr.split("\n").filter((zeile) => LAUFZEILE.test(zeile));
  const [ciStart, ciEnde] = zeilen.slice(-2);
  assert.deepEqual(zeilen.slice(0, -2), erwarteteLaufzeilen(gelesen), lauf.stderr);
  assert.equal(ciStart, CI_LOKAL_START, lauf.stderr);
  assert.match(ciEnde, CI_LOKAL_ENDE, lauf.stderr);
});

test("bei einer Fehlerbehebung meldet lauf auch git bisect beim Start und beim Ende mit der Dauer aus dem Beleg", (context) => {
  const auftrag = { ...funktion("2 !== 4"), art: "fehlerbehebung" };
  const { lauf, beleg: gelesen } = starte(context, { auftrag, drehbuch: DREHBUCH, vorbereiten: fehlerNachRichtigemStand });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const bisect = gelesen.pruefungen.find(({ name }) => name === "bisect");
  assert.ok(Number.isInteger(bisect?.dauer_ms), JSON.stringify(gelesen.pruefungen));
  assert.deepEqual(laufzeilenOhneCiLokal(lauf), erwarteteLaufzeilen(gelesen), lauf.stderr);
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
