import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_ROT, MIT_FIX, ORDNER, PITCH, REPO, SCHNITT, TEST, lauf } from "./neuschnitt-probe.js";

const LINT_ROT = JSON.stringify({ ...JSON.parse(REPO["package.json"]), scripts: { ...JSON.parse(REPO["package.json"]).scripts, lint: "exit 1" } });
const AUSSERHALB = { dateien: { "src/text.js": "export function gross(text) {\n  return text.toLowerCase();\n}\n" }, antwort: "Fertig." };
const AUSSTIEG = { antwort: "Ich höre auf.\nAuftrag passt nicht: Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt." };
const NOTIZ = { antwort: "1. Agenten-Form prüfen" };
const KLEINER_DECKEL = 1;
const EXIT_SCHNITT_ABGELEHNT = 4;
const FREIGEGEBEN = 5;
const ZWEI_VERSUCHE = 2;
const ABGELEHNT = "die Skriptprüfung hat den neuen Schnitt abgelehnt";

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

test("der Neuschnitt schneidet auch dann fertig, wenn er mehr Token verbraucht, als der Pitch unter Planung freigegeben nennt", (context) => {
  const pitch = PITCH.replace("\n\n## Anforderungen", `\n\nPlanung freigegeben: ${KLEINER_DECKEL} Token\n\n## Anforderungen`);
  const drehbuch = { test: [TEST], bau: [AUSSERHALB, AUSSTIEG, MIT_FIX], planer: [{ ...SCHNITT, nachrichten: [2 * KLEINER_DECKEL] }] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch, { dateien: { [`${ORDNER}/pitch.md`]: pitch } });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.equal(datei("anzahl-planer"), "1");
  assert.equal(beleg("a1-n1").ergebnis, "grün");
  assert.doesNotMatch(datei("gh.log"), /Deckel/);
});

test("eine Zeile Planung freigegeben ohne Zahl im Pitch hält den Neuschnitt nicht mehr an, seine Versuche starten", (context) => {
  const pitch = PITCH.replace("\n\n## Anforderungen", "\n\nPlanung freigegeben: viele Token\n\n## Anforderungen");
  const drehbuch = { test: [TEST], kind: [{}], notiz: [NOTIZ] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch, { dateien: { [`${ORDNER}/pitch.md`]: pitch } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.equal(datei("anzahl-kind"), String(ZWEI_VERSUCHE));
  assert.equal(beleg("a1-neuschnitt").versuche.length, ZWEI_VERSUCHE);
  assert.doesNotMatch(datei("gh.log"), /Planung freigegeben: viele Token/);
});

test("lehnt die Skriptprüfung den ersten Versuch des Neuschnitts ab, startet ein zweiter, auch wenn der erste die unter Planung freigegeben genannten Token verbraucht hat", (context) => {
  const pitch = PITCH.replace("\n\n## Anforderungen", `\n\nPlanung freigegeben: ${FREIGEGEBEN} Token\n\n## Anforderungen`);
  const abgelehnt = { ergebnis: { exitCode: EXIT_SCHNITT_ABGELEHNT, grund: ABGELEHNT, sitzungen: [{ rolle: "planer", sitzung: "verbraucht-1" }] }, verbrauch: FREIGEGEBEN };
  const drehbuch = { test: [TEST], kind: [abgelehnt], notiz: [NOTIZ] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch, { dateien: { [`${ORDNER}/pitch.md`]: pitch } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  const { versuche, kosten } = beleg("a1-neuschnitt");
  assert.equal(kosten.summe.gesamt, FREIGEGEBEN);
  assert.equal(datei("anzahl-kind"), String(ZWEI_VERSUCHE));
  assert.deepEqual(versuche.map(({ befunde }) => befunde), [[ABGELEHNT], [ABGELEHNT]]);
  assert.doesNotMatch(datei("gh.log"), /Deckel/);
});
