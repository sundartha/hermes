import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { probeDirectory } from "./probe-repo.js";
import { AUSFUEHRBAR, ENTWURF_RECHNEN, ersterVersuch, EXIT_ROT, funktion, neu, neuUmbau, GESTOPPT, lauf, MIT_FIX, MIT_TEXT, ohne, OHNE_FIX, ohneTeam, ORDNER, phase, PHASENDATEI, RECHNEN_BESTAND, REPO, SCHNITT, schneide, TEST, TEXT_BESTAND, umbau, UMBAU_FERTIG, UMBAU_ZWEI } from "./neuschnitt-probe.js";

test("ein Auftrag aus einem Pitch bleibt zweimal rot, der Planer schneidet ihn neu und der Lauf wird ohne Entscheidungsnotiz grün", (context) => {
  const drehbuch = { test: [TEST], bau: [OHNE_FIX, OHNE_FIX, MIT_FIX], planer: [SCHNITT] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.deepEqual([datei("anzahl-planer"), datei("anzahl-notiz"), datei("gh.log")], ["1", "", ""]);
  const prompt = datei("prompt-planer.txt");
  assert.match(prompt, /^\n## Neuschnitt\n\nAuftrag a1 der Phase P-001-probe ist nach 2 roten Runden gestoppt\./);
  for (const teil of ["Runde 1: Der Bau-Agent hat keine Datei geändert.", "Runde 2: Der Bau-Agent hat keine Datei geändert.", "Hinweise des Bau-Agenten:\n> Ich finde keinen Weg im Bereich.", `Freigegebene Dokumente: ${ORDNER}/pitch.md, ${ORDNER}/design.md, ${ORDNER}/sicherheit.md`, `Phasendatei: ${PHASENDATEI}`, '"id": "a1"']) {
    assert.ok(prompt.includes(teil), teil);
  }
  const [argumente] = datei("argumente-planer.txt").split("\n").map((zeile) => JSON.parse(zeile || "[]"));
  for (const schalter of ["--restricted", "--agents", "--settings"]) assert.ok(argumente.includes(schalter), JSON.stringify(argumente));
  assert.ok(argumente[argumente.indexOf("--agents") + 1].includes("planer"), JSON.stringify(argumente));
  assert.ok(argumente[argumente.indexOf("--settings") + 1].endsWith(".claude/rollen/planer.json"), JSON.stringify(argumente));
  const [versuch] = beleg("a1-neuschnitt").versuche;
  assert.ok(versuch.planung.exit !== undefined && versuch.planung.beteiligte.length > 0, JSON.stringify(versuch.planung));
  assert.equal(git("log", "--format=%s", "-2"), "Verdopple Zahlen in rechnen.js\nSchneide den Auftrag a1 neu\n");
  assert.match(git("log", "-1", "--format=%B", "HEAD~1"), /\n\nWarum: Auftrag a1 der Phase P-001-probe ist nach 2 roten Runden gestoppt\.\nDer Planer ersetzt ihn durch a1-n1; pruefe und die Abdeckungsprüfung sind grün\.\n\nAuftrag: P-001-probe\/a1\n/);
  assert.ok(git("log", "-1", "--format=%B", "HEAD~1").endsWith("\n\nAuftrag: P-001-probe/a1\n\n"), git("log", "-1", "--format=%B", "HEAD~1"));
  assert.ok(ergebnis.stdout.includes("Auftrag a1: neu geschnitten, weiter mit den Aufträgen des Neuschnitts.\n"), ergebnis.stdout);
  assert.equal(beleg("a1-n1").ergebnis, "grün");
  assert.equal(beleg("a1-neuschnitt").ergebnis, "grün");
  assert.equal(git("status", "--porcelain"), "");
});

test("nach „Auftrag passt nicht“ bekommt der Planer den Grund wörtlich und der Lauf geht mit dem Neuschnitt weiter", (context) => {
  const grund = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
  const drehbuch = { test: [TEST], bau: [{ antwort: `Ich höre auf.\nAuftrag passt nicht: ${grund}` }, MIT_FIX], planer: [SCHNITT] };
  const { ergebnis, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  const prompt = datei("prompt-planer.txt");
  assert.ok(prompt.includes(`\nAuftrag passt nicht: ${grund}\n`), prompt);
  assert.ok(prompt.includes(`Hinweise des Bau-Agenten:\n> Ich höre auf.\n> Auftrag passt nicht: ${grund}`), prompt);
  assert.deepEqual([datei("anzahl-bau"), datei("anzahl-planer"), datei("gh.log")], ["2", "1", ""]);
});

test("ein Neuschnitt nach zwei fertigen Aufträgen mit zwei Nachfolgern, neuen Vorgängern eines späteren Auftrags und eigenem Entwurf wird mit Paket in der Commit-Nachricht übernommen", (context) => {
  const rahmen = { paket: "V4" };
  const vorher = [ohne(umbau("a0"), "abhaengigVon"), umbau("a0b"), funktion("a1", { abhaengigVon: ["a0"] }), umbau("a2", { abhaengigVon: ["a0", "a1"] })];
  const grund = "a1-n1 braucht den Umbau";
  const zweiNachfolger = schneide([neuUmbau("a1-n2", { abnahme: TEXT_BESTAND, abhaengigVon: [{ id: "a1-n1", grund }] }), neu("a1-n1", { abhaengigVon: [{ id: "a0", grund }] })]);
  const nachher = [
    vorher[0],
    vorher[1],
    ohne(umbau("a1-n2", { abnahme: TEXT_BESTAND, abhaengigVon: ["a1-n1"] }), "vorbild"),
    ohne(funktion("a1-n1", { abhaengigVon: ["a0"] }), "vorbild"),
    umbau("a2", { abhaengigVon: ["a0", "a1-n2", "a1-n1"] }),
  ];
  const entwurf = [ENTWURF_RECHNEN.replace("\nFehlerfälle", "\nAufträge: a1-n1: Verdopple Zahlen\nFehlerfälle"), `Reihenfolge: a1-n1 nach a0: ${grund}`].join("\n");
  const geschnitten = phase(nachher, { ...rahmen, entwurf: { "src/rechnen.js": entwurf, "src/text.js": "Entwurf Text." } });
  const drehbuch = { test: [TEST], bau: [UMBAU_FERTIG, UMBAU_ZWEI, OHNE_FIX], planer: [zweiNachfolger], erkunder: [MIT_TEXT], notiz: [{ antwort: "1. Szenario prüfen" }] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch, { dateien: { [PHASENDATEI]: phase(vorher, rahmen) } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.ok(ergebnis.stdout.includes("Auftrag a1: neu geschnitten, weiter mit den Aufträgen des Neuschnitts.\n"), ergebnis.stdout);
  assert.ok(datei("prompt-planer.txt").includes("\nSchon übernommen: a0, a0b\n"), datei("prompt-planer.txt"));
  assert.deepEqual(beleg("a1-neuschnitt").versuche.map((versuch) => ohne(versuch, "planung")), [{ neu: [{ id: "a1-n2", bereich: "src/text.js" }, { id: "a1-n1", bereich: "src/rechnen.js" }] }]);
  const nachricht = [
    "Schneide den Auftrag a1 neu",
    "",
    `Warum: ${GESTOPPT}`,
    "Der Planer ersetzt ihn durch a1-n2, a1-n1; pruefe und die Abdeckungsprüfung sind grün.",
    "",
    "Auftrag: P-001-probe/a1",
    "Paket: V4",
    "",
  ].join("\n");
  assert.equal(git("log", "-1", "--format=%B"), `${nachricht}\n`);
  assert.deepEqual(JSON.parse(git("show", `HEAD:${PHASENDATEI}`)), JSON.parse(geschnitten));
  assert.equal(datei("anzahl-planer"), "1");
});

test("ein Planer, der im Stillstand abgebrochen wird oder mit einem Fehler endet, liefert genau diesen Grund als Befund", (context) => {
  const lesen = { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Read", input: { file_path: "x" } }] } };
  const antwort = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1", content: "gleich" }] } };
  const { versuche } = ersterVersuch(context, { planer: [{ zeilen: [lesen, antwort, antwort, antwort] }, { exit: 3 }] });
  assert.deepEqual(versuche.map((versuch) => ohne(versuch, "planung")), [
    { befunde: ['planer: Stillstand: Read lief dreimal mit derselben Eingabe und lieferte dasselbe Ergebnis: {"file_path":"x"}'] },
    { befunde: ["planer ist abgestürzt (Exit 3)"] },
  ]);
});

test("endet der Kindlauf mit einem Fehlercode ohne Grund, wird der Neuschnitt mit genau diesem Exit abgelehnt", (context) => {
  const FEHLERCODE = 4;
  ohneTeam(context, [{ kind: { ergebnis: { exitCode: FEHLERCODE, sitzungen: [] } }, erwartet: [`Der Planer endete mit Exit ${FEHLERCODE}.`] }]);
});

test("ein Neuschnitt mit unlesbarer Phasendatei oder roter Abdeckungsprüfung wird mit genau diesen Befunden abgelehnt", (context) => {
  const { versuche } = ersterVersuch(context, { planer: [{ dateien: { [PHASENDATEI]: "{" } }, schneide([neu("a1-n1", { prueft: ["B1"] })])] });
  const [unlesbar, abdeckung] = versuche;
  assert.deepEqual(unlesbar.befunde, [`planer haben ${PHASENDATEI} geändert`]);
  assert.deepEqual(abdeckung.befunde, [["Regel Nummern: a1-n1: B1 ist keine Soll-Nummer", "Regel Nummern: S1 steht bei keiner Funktion und keiner Fehlerbehebung"].join("\n")]);
});

test("scheitert der Commit des Neuschnitts, wird er mit der Fehlerausgabe abgelehnt und zurückgesetzt", (context) => {
  const haken = probeDirectory(context, { "commit-msg": '#!/bin/sh\ncase "$(head -n 1 "$1")" in\n  Schneide*) echo "Neuschnitt abgelehnt" >&2; exit 1 ;;\nesac\n' });
  chmodSync(join(haken, "commit-msg"), AUSFUEHRBAR);
  const umgebung = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: haken };
  const { versuche, git } = ersterVersuch(context, { planer: [SCHNITT] }, { umgebung });
  assert.deepEqual(versuche.map(({ befunde }) => befunde), [["git commit des Neuschnitts endete mit Exit 1: Neuschnitt abgelehnt"], ["git commit des Neuschnitts endete mit Exit 1: Neuschnitt abgelehnt"]]);
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), REPO[PHASENDATEI]);
  assert.equal(git("status", "--porcelain"), "");
});

test("ein Neuschnitt mit einem Bereich, den ein anderer Auftrag nutzt, lässt dessen Entwurf unverändert und startet keinen Entwurf-Schreiber", (context) => {
  const nachbar = umbau("a2", { bereich: "src/rechnen.js", erwarteteDateien: ["src/rechnen.js"], abnahme: RECHNEN_BESTAND, abhaengigVon: ["a1"] });
  const { versuche, git, datei } = ersterVersuch(context, { planer: [SCHNITT] }, { dateien: { [PHASENDATEI]: phase([funktion("a1"), nachbar]) } });
  assert.deepEqual(versuche.map((versuch) => ohne(versuch, "planung")), [{ neu: [{ id: "a1-n1", bereich: "src/rechnen.js" }] }]);
  assert.equal(datei("anzahl-entwurf"), "");
  assert.equal(JSON.parse(git("show", `HEAD:${PHASENDATEI}`)).entwurf["src/rechnen.js"], "Entwurf.");
});

test("stürzt das Kind ohne ergebnis.json ab, ist der Befund ‚Der Neuschnitt des Teams endete ohne Ergebnis (Exit …)‘, auch wenn in der Ablage ein grünes ergebnis.json eines früheren Laufs lag", (context) => {
  const ergebnis = ".git/auftrag-neuschnitt/P-001-probe/a1/versuch-1/ergebnis.json";
  const frueher = { [ergebnis]: JSON.stringify({ exitCode: 0, antwort: "a1-n1: aus einem früheren Lauf", sitzungen: [] }) };
  const absturz = { ...SCHNITT, dateien: { [`${ergebnis}/gesperrt`]: "" } };
  const { befunde } = ersterVersuch(context, { planer: [absturz] }, { dateien: frueher });
  assert.deepEqual(befunde, ["Der Neuschnitt des Teams endete ohne Ergebnis (Exit 1)."]);
});
