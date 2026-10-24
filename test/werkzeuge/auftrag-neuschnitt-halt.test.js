import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_ROT, MIT_FIX, ORDNER, PITCH, REPO, SCHNITT, TEST, lauf } from "./neuschnitt-probe.js";

const LINT_ROT = JSON.stringify({ ...JSON.parse(REPO["package.json"]), scripts: { ...JSON.parse(REPO["package.json"]).scripts, lint: "exit 1" } });
const AUSSERHALB = { dateien: { "src/text.js": "export function gross(text) {\n  return text.toLowerCase();\n}\n" }, antwort: "Fertig." };
const AUSSTIEG = { antwort: "Ich höre auf.\nAuftrag passt nicht: Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt." };
const NOTIZ = { antwort: "1. Agenten-Form prüfen" };
const EXIT_SCHNITT_ABGELEHNT = 4;
const KLEINER_DECKEL = 1;
const FRUEHERER_LAUF_UEBER_DEM_DECKEL = { laeufe: 1, token: 1000 * KLEINER_DECKEL };
const VORIGE_KOSTEN = JSON.stringify({ kostenJeLauf: { erkunder: FRUEHERER_LAUF_UEBER_DEM_DECKEL, planer: FRUEHERER_LAUF_UEBER_DEM_DECKEL, "pruefer-planung": FRUEHERER_LAUF_UEBER_DEM_DECKEL, entwurf: FRUEHERER_LAUF_UEBER_DEM_DECKEL } });

test("zwei an Formprüfungen rote Runden führen zur Entscheidungsnotiz ohne Neuschnitt", (context) => {
  const drehbuch = { test: [TEST], bau: [MIT_FIX], planer: [SCHNITT], notiz: [NOTIZ] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch, { dateien: { "package.json": LINT_ROT } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.deepEqual(["erkunder", "planer"].map((rolle) => datei(`anzahl-${rolle}`)), ["", ""]);
  assert.equal(beleg("a1-neuschnitt"), null);
  const notiz = datei("gh.log");
  assert.match(notiz, /"issue","comment"/);
  assert.match(notiz, /\blint\b/);
  assert.match(notiz, /kein Neuschnitt/);
});

test("eine rote Runde mit Auftrag passt nicht führt weiter zum Neuschnitt", (context) => {
  const drehbuch = { test: [TEST], bau: [AUSSERHALB, AUSSTIEG, MIT_FIX], planer: [SCHNITT] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.match(datei("prompt-planer.txt"), /\nRunde 1: grenzen bau endete mit Exit 1\./);
  assert.deepEqual([datei("anzahl-planer"), datei("gh.log")], ["1", ""]);
  assert.equal(beleg("a1-neuschnitt").ergebnis, "grün");
  assert.equal(beleg("a1-n1").ergebnis, "grün");
});

test("der Neuschnitt hält an, wenn sein Kostendeckel erreicht ist", (context) => {
  const pitch = PITCH.replace("\n\n## Anforderungen", `\n\nPlanung freigegeben: ${KLEINER_DECKEL} Token\n\n## Anforderungen`);
  const dateien = { [`${ORDNER}/pitch.md`]: pitch, ".fortschritt/P-001-probe/planung.json": VORIGE_KOSTEN };
  const drehbuch = { test: [TEST], planer: [SCHNITT], notiz: [NOTIZ] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch, { dateien });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.deepEqual(["erkunder", "planer", "pruefer-planung", "entwurf"].map((rolle) => datei(`anzahl-${rolle}`)), ["", "", "", ""]);
  const { versuche } = beleg("a1-neuschnitt");
  assert.equal(versuche.length, 1, JSON.stringify(versuche));
  const notiz = datei("gh.log");
  assert.match(notiz, /"issue","comment"/);
  assert.match(notiz, new RegExp(`Deckel ${KLEINER_DECKEL} Token`));
});

test("hat der erste Versuch des Neuschnitts die freigegebenen Token verbraucht, startet kein zweiter Versuch", (context) => {
  const pitch = PITCH.replace("\n\n## Anforderungen", "\n\nPlanung freigegeben: 5 Token\n\n## Anforderungen");
  const abgelehnt = { ergebnis: { exitCode: EXIT_SCHNITT_ABGELEHNT, grund: "die Skriptprüfung hat den neuen Schnitt abgelehnt", sitzungen: [{ rolle: "planer", sitzung: "verbraucht-1" }] }, verbrauch: 5 };
  const drehbuch = { test: [TEST], kind: [abgelehnt], notiz: [NOTIZ] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch, { dateien: { [`${ORDNER}/pitch.md`]: pitch } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.equal(datei("anzahl-kind"), "1");
  assert.equal(beleg("a1-neuschnitt").versuche.length, 1);
  assert.match(datei("gh.log"), /Deckel 5 Token/);
});

test("eine fehlerhafte Zeile Planung freigegeben im Pitch hält den Neuschnitt vor dem ersten Versuch an", (context) => {
  const pitch = PITCH.replace("\n\n## Anforderungen", "\n\nPlanung freigegeben: viele Token\n\n## Anforderungen");
  const drehbuch = { test: [TEST], kind: [{}], notiz: [NOTIZ] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch, { dateien: { [`${ORDNER}/pitch.md`]: pitch } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.equal(datei("anzahl-kind"), "");
  assert.equal(beleg("a1-neuschnitt"), null);
  assert.match(datei("gh.log"), /Planung freigegeben: viele Token/);
});
