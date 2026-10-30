import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { namen } from "./auftrag-lauf-hilfen.js";
import { ACHT_TEST, NACHRUNDE_NACH_NEUBAU, GRUNDLAGE, GRUND_VERWORFEN, RECHNEN, ZWEI_MUTANTEN, abgebrochen, aufgeraeumt, gesichert, mitPruefsumme, rollen } from "./auftrag-lauf-fortsetzung-hilfen.js";
import { starteNochmal } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const GEAENDERT = {
  basis: { grund: "Basis ist eine andere", vorbereiten: ({ repo }) => runIn(repo, "git", ["commit", "-q", "--allow-empty", "-m", "Anderer Kopf"]) },
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
  bauPatch: { grund: "Patch bau fehlt oder wurde verändert", vorbereiten: ({ repo }) => haengeAn(gesichert(repo, "bau.patch")) },
  konfiguration: {
    grund: "Werkzeug- oder Mutationskonfiguration hat sich geändert",
    vorbereiten: ({ repo }) => {
      appendFileSync(join(repo, ".git/info/exclude"), "stryker.config.json\n");
      writeFileSync(join(repo, "stryker.config.json"), '{"mutate":["src/**/*.js"]}\n');
    },
  },
  einspielen: {
    grund: "A1.fortsetzung.bau.patch lässt sich nicht einspielen",
    vorbereiten: ({ repo }) => {
      writeFileSync(gesichert(repo, "bau.patch"), "kein Patch\n");
      mitPruefsumme(repo, "bau");
    },
  },
};

function haengeAn(datei) {
  writeFileSync(datei, `${readFileSync(datei, "utf8")}\n`);
}

function abgelehnt(context, fall) {
  const { grund, vorbereiten } = GEAENDERT[fall];
  const erster = abgebrochen(context, { dateien: ZWEI_MUTANTEN });
  aufgeraeumt(erster);
  vorbereiten(erster);
  const { lauf, beleg, repo } = starteNochmal(erster, { ...GRUNDLAGE, [NACHRUNDE_NACH_NEUBAU]: { [RECHNEN]: ACHT_TEST } });
  assert.match(lauf.stderr, GRUND_VERWORFEN, lauf.stdout + lauf.stderr);
  assert.ok(GRUND_VERWORFEN.exec(lauf.stderr)[1].startsWith(grund), lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Fortsetzung auf gesichertem Stand/);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(rollen(beleg), ["test", "bau", "bau", "test"]);
  assert.ok(namen(beleg).includes("mutation"));
  assert.ok(!existsSync(gesichert(repo, "json")), "der verworfene Stand bleibt liegen");
}

test("die Fortsetzung wird bei einer anderen Basis abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "basis"));
test("die Fortsetzung wird bei geändertem Auftragstext abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "auftrag"));
test("die Fortsetzung wird bei verändertem Patch des Abnahmetests abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "abnahmePatch"));
test("die Fortsetzung wird bei verändertem Patch des Baus abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "bauPatch"));
test("die Fortsetzung wird bei geänderter Mutationskonfiguration abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "konfiguration"));
test("die Fortsetzung wird bei einem nicht einspielbaren Patch abgelehnt: der Lauf sagt warum, löscht den Stand und baut wie heute neu", (context) => abgelehnt(context, "einspielen"));
