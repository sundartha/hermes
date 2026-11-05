import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUNDLAGE, GRUND_VERWORFEN, abgebrochen, aufgeraeumt, gesichert, mitPruefsumme, rollen } from "./auftrag-lauf-fortsetzung-hilfen.js";
import { starteNochmal } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const GEAENDERT = {
  basis: {
    grund: "Basis ist eine andere und ändert den Bereich oder den Abnahmetest: src/rechnen.js",
    vorbereiten: ({ repo }) => {
      appendFileSync(join(repo, "src/rechnen.js"), "// anders\n");
      runIn(repo, "git", ["commit", "-q", "-am", "Anderer Kopf im Bereich"]);
    },
  },
  auftrag: {
    grund: "Auftrag oder Phase haben sich geändert",
    vorbereiten: ({ werkzeug }) => {
      const datei = join(werkzeug, "phase.json");
      const phase = JSON.parse(readFileSync(datei, "utf8"));
      phase.auftraege[0].ziel = "Verdopple Zahlen und Brüche";
      writeFileSync(datei, JSON.stringify(phase));
    },
  },
  abnahmePatch: { grund: "Patch abnahme fehlt oder wurde verändert", vorbereiten: ({ repo }) => haengeAn(gesichert(repo, "abnahme.patch")) },
  einspielen: {
    grund: "A1.fortsetzung.abnahme.patch lässt sich nicht einspielen",
    vorbereiten: ({ repo }) => {
      writeFileSync(gesichert(repo, "abnahme.patch"), "kein Patch\n");
      mitPruefsumme(repo, "abnahme");
    },
  },
};

function haengeAn(datei) {
  writeFileSync(datei, `${readFileSync(datei, "utf8")}\n`);
}

function abgelehnt(context, fall) {
  const { grund, vorbereiten } = GEAENDERT[fall];
  const erster = abgebrochen(context);
  aufgeraeumt(erster);
  vorbereiten(erster);
  const { lauf, beleg, repo } = starteNochmal(erster, GRUNDLAGE);
  assert.match(lauf.stderr, GRUND_VERWORFEN, lauf.stdout + lauf.stderr);
  assert.ok(GRUND_VERWORFEN.exec(lauf.stderr)[1].startsWith(grund), lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Fortsetzung auf gesichertem Stand/);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(rollen(beleg), ["test", "bau"]);
  assert.ok(!existsSync(gesichert(repo, "json")), "der verworfene Stand bleibt liegen");
}

test("die Fortsetzung wird bei einer anderen Basis, die den Bereich ändert, abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "basis"));
test("die Fortsetzung wird bei geändertem Auftragstext abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "auftrag"));
test("die Fortsetzung wird bei verändertem Patch des Abnahmetests abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "abnahmePatch"));
test("die Fortsetzung wird bei einem nicht einspielbaren Patch abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "einspielen"));
