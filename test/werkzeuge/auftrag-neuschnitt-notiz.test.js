import assert from "node:assert/strict";
import { test } from "node:test";

import { ersterVersuch, EXIT_ROT, GESTOPPT, ISSUE, lauf, ohne, OHNE_EMPFEHLUNG, OHNE_FIX, ORDNER, phase, PHASENDATEI, prompts, SCHNITT, TEST, umbau } from "./neuschnitt-probe.js";

test("meldet der Planer, dass sich ein Szenario ändern müsste, entsteht eine Entscheidungsnotiz mit genau dieser Frage", (context) => {
  const frage = "Soll S1 auch für negative Zahlen gelten? (pitch.md, Szenario S1)";
  const empfehlung = "Nein, weil das Nicht-Ziel sonst wegfällt.";
  const planer = { antwort: `Pitch ändern: ${frage}\nEmpfehlung: ${empfehlung}` };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planer: [planer] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  const { text } = beleg("a1").entscheidung;
  assert.ok(text.startsWith("## Entscheidung nötig\n\nDer Planer kann den Auftrag a1 der Phase P-001-probe nur neu schneiden, wenn sich der Pitch ändert."), text);
  assert.ok(text.includes(`\nPitch ändern: ${frage}\nEmpfehlung: ${empfehlung}\n`), text);
  const [argumente] = datei("argumente-planer.txt").split("\n").map((zeile) => JSON.parse(zeile || "[]"));
  assert.ok(text.includes(`(Volle Antwort des Planers: Sitzung ${argumente[argumente.indexOf("--session-id") + 1]})`), text);
  assert.ok(datei("gh.log").includes(`Pitch ändern: ${frage}`));
  assert.ok(datei("gh.log").includes(`"edit","${ISSUE}","--add-label","entscheidung"`));
  assert.deepEqual([datei("anzahl-planer"), datei("anzahl-notiz")], ["1", ""]);
});

test("bleibt ein Auftrag aus einem Neuschnitt wieder zweimal rot, startet der Planer nicht noch einmal und es entsteht eine Entscheidungsnotiz", (context) => {
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planer: [SCHNITT], notiz: [{ antwort: "1. Szenario prüfen" }] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual([datei("anzahl-planer"), datei("anzahl-bau"), datei("anzahl-notiz")], ["1", "4", "1"]);
  assert.match(beleg("a1-n1").entscheidung.text, /Der Auftrag stammt schon aus einem Neuschnitt; höchstens 1 Neuschnitt je Auftrag, danach entscheidet der Nutzer\./);
  assert.match(datei("gh.log"), /"comment","54".*stammt schon aus einem Neuschnitt.*Szenario prüfen/);
  assert.equal(git("log", "--format=%s", "-1"), "Schneide den Auftrag a1 neu\n");
});

test("antwortet der Planer „Zerlegung passt nicht“, schreibt der Notiz-Agent die Entscheidungsnotiz mit diesem Grund", (context) => {
  const planer = { antwort: "Zerlegung passt nicht: Design Doc und Code widersprechen sich." };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planer: [planer], notiz: [{ antwort: "1. Design Doc prüfen" }] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual([datei("anzahl-planer"), datei("anzahl-notiz")], ["1", "1"]);
  assert.match(datei("prompt-notiz.txt"), /Neuschnitt 1: Zerlegung passt nicht: Design Doc und Code widersprechen sich\./);
  assert.match(beleg("a1").entscheidung.text, /dass sich der Auftrag mit den freigegebenen Dokumenten nicht neu schneiden lässt/);
});

test("eine Frage an den Nutzer ohne Empfehlung zählt als abgelehnter Neuschnitt", (context) => {
  const planer = { antwort: "Pitch ändern: Soll S1 wegfallen?" };
  const { befunde, datei } = ersterVersuch(context, { planer: [planer] });
  assert.deepEqual(befunde, ["Zu „Pitch ändern: …“ fehlt die Zeile „Empfehlung: …“."]);
  assert.equal(datei("anzahl-planer"), "2");
});

test("Pitch- und Zerlegungszeilen zählen nur am Zeilenanfang und ein Umbau ohne Verbote und Vorgänger bekommt die Befunde wörtlich im nächsten Prompt und in der Notiz", (context) => {
  const mittendrin = { antwort: "Vorschlag: Pitch ändern: Soll S1 wegfallen?\nNotiz: Zerlegung passt nicht: Der Entwurf fehlt.\nEmpfehlung: Nein." };
  const mitJson = { antwort: `${mittendrin.antwort}\n\n\`\`\`json\n{"aenderung": "keine"}\n\`\`\`` };
  const halb = { antwort: "Pitch ändern: Soll S1 wegfallen?\nMeine Empfehlung: Nein." };
  const dateien = { [PHASENDATEI]: phase([ohne(umbau("a1"), "wasDarfNiePassieren", "abhaengigVon")]) };
  const { versuche, datei } = ersterVersuch(context, { planer: [mitJson, halb] }, { dateien });
  const ohneAbdeckung = ["schnitt fehlt: die Antwort enthält kein JSON in der verlangten Form"];
  assert.deepEqual(versuche.map((versuch) => ohne(versuch, "planung")), [{ befunde: ohneAbdeckung }, { befunde: [OHNE_EMPFEHLUNG] }]);
  const [erster, zweiter] = prompts(datei("prompt-planer.txt"));
  const kopf = [GESTOPPT, "", `Phasendatei: ${PHASENDATEI}`, `Freigegebene Dokumente: ${ORDNER}/pitch.md, ${ORDNER}/design.md, ${ORDNER}/sicherheit.md`, "Schon übernommen: keiner", "Die neuen Aufträge heißen a1-n1, a1-n2 und so weiter.", "Die Abnahmedatei und die Änderungsdateien der Szenarien bleiben, wie sie sind; die neuen Aufträge übernehmen sie, statt sie umzubenennen.", "", "## Auftrag", ""].join("\n");
  assert.ok(erster.startsWith(kopf), erster);
  assert.ok(erster.includes("\n## Verlauf\n\n```\nRunde 1: "), erster);
  assert.ok(erster.endsWith("> Ich finde keinen Weg im Bereich.\n```\n"), erster);
  const befunde = ["```", "", "", "## Befunde zu deinem vorigen Neuschnitt", "", "```", ...ohneAbdeckung, "```", "", "Die Phasendatei steht wieder wie vor diesem Neuschnitt.", "", ""].join("\n");
  assert.ok(zweiter.endsWith(`> Ich finde keinen Weg im Bereich.\n${befunde}`), zweiter);
  assert.ok(datei("prompt-notiz.txt").includes(["Neuschnitt 1: abgelehnt", ...ohneAbdeckung, "Neuschnitt 2: abgelehnt", OHNE_EMPFEHLUNG, "```"].join("\n")), datei("prompt-notiz.txt"));
});

test("eine Frage an den Nutzer ohne Leerzeichen nach den Doppelpunkten wird trotzdem zur Entscheidungsnotiz", (context) => {
  const planer = { antwort: "Pitch ändern:Soll S1 wegfallen?\nEmpfehlung:Nein." };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planer: [planer] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.ok(beleg("a1").entscheidung.text.includes("\nPitch ändern: Soll S1 wegfallen?\nEmpfehlung: Nein.\n"), beleg("a1").entscheidung.text);
  assert.deepEqual([datei("anzahl-planer"), datei("anzahl-notiz")], ["1", ""]);
});

test("steigt der Bau-Agent nach einer roten Runde aus, sehen Planer und Notiz-Agent beide Runden und der Notiz-Agent den Anlass", (context) => {
  const grund = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
  const ausstieg = `Auftrag passt nicht: ${grund}`;
  const planer = { antwort: "Zerlegung passt nicht:Der Entwurf widerspricht dem Test." };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX, { antwort: ausstieg }], planer: [planer], notiz: [{ antwort: "1. Entwurf prüfen" }] };
  const { ergebnis, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual([datei("anzahl-planer"), datei("anzahl-notiz")], ["1", "1"]);
  assert.ok(datei("prompt-planer.txt").includes("\n## Verlauf\n\n```\nRunde 1: Der Bau-Agent hat keine Datei geändert."), datei("prompt-planer.txt"));
  const notiz = datei("prompt-notiz.txt");
  assert.ok(notiz.includes(`\nDer Agent ist ausgestiegen: ${ausstieg} Schreib eine Entscheidungsnotiz`), notiz);
  assert.ok(notiz.includes("\n## Verlauf\n\n```\nRunde 1: Der Bau-Agent hat keine Datei geändert."), notiz);
  assert.ok(notiz.includes(`\n${ausstieg}\nNeuschnitt 1: Zerlegung passt nicht: Der Entwurf widerspricht dem Test.\n\`\`\`\n`), notiz);
});
