import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, outputLines, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const PRUEFER = join(REPO_ROOT, "tools/abdeckung-pruefen.mjs");
const ORDNER = "P-001-probe";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const GRUEN = "grün: 0 Nummern in P-001-probe gehören je genau einem Auftrag.\n";
const AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";

const CODE = ["export function rechne(wert) {", "  return wert + 1;", "}", "", "export function halbiere(wert) {", "  return wert / 2;", "}", ""].join("\n");
const PITCH = ["# P-001 Probe", "", "## Anforderungen", "keine neuen, weil nur umgebaut wird.", "", "## Bleibt unverändert", "keins, weil die bestehenden Tests grün bleiben.", "", "## Nicht-Ziele", ""].join("\n");
const SICHERHEIT = ["# P-001 Probe: Sicherheitsprüfung", "", "## 1. Woran arbeiten wir", "", "## 2. Angriffswege", "keine Angriffswege gefunden, weil nur umgebaut wird.", "", "## 3. Lückenprüfung", "", "## 6. Gegenprüfung", ""].join("\n");
const PHASE = { phase: ORDNER, auftraege: [{ id: "u1", art: "umbau", ziel: "Ziehe die Rechnung heraus", prueft: AUSWEG }] };

function phasenRepo(context) {
  return probeRepository(context, {
    "src/x.js": CODE,
    [`${ORDNER}/pitch.md`]: PITCH,
    [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
    [`${ORDNER}/phase.json`]: JSON.stringify(PHASE),
  });
}

function baumVon(wurzel) {
  return runIn(wurzel, "git", ["rev-parse", "HEAD^{tree}"]).stdout.trim();
}

function geplant(wurzel, annahmen, baum = baumVon(wurzel)) {
  writeFiles(wurzel, {
    [`${ORDNER}/planung/schnitt.json`]: JSON.stringify({ annahmen, auftraege: PHASE.auftraege }),
    [`${ORDNER}/planung/fingerabdruck.json`]: JSON.stringify({ stand: { kopfBaum: baum, arbeitsbaum: baum, dateien: {} } }),
  });
  return wurzel;
}

function pruefe(wurzel) {
  return runIn(wurzel, process.execPath, [PRUEFER, ORDNER]);
}

test("abdeckung-pruefen: ein Zeilenzitat, dessen Zeilen einen Namen der Annahme enthalten, ist grün", (context) => {
  const wurzel = geplant(phasenRepo(context), [
    { auftrag: "u1", text: "`rechne` addiert eins (`src/x.js:1-3`), halbiere teilt durch zwei (src/x.js:5-7, weil `wert / 2` dort steht)." },
  ]);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.equal(lauf.stderr, "");
  assert.equal(lauf.stdout, GRUEN);
});

test("abdeckung-pruefen: eine falsche Zeilennummer in einer Annahme ist rot und nennt Datei, Zeile und den Inhalt der Zeile", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "Die Hilfe `halbiere` teilt durch zwei (`src/x.js:2`), deshalb bleibt sie." }]);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^Zeilenbeleg in planung\/schnitt\.json, annahmen\[0\] \(u1\): src\/x\.js:2: keiner der Namen „halbiere“ steht dort; dort steht Zeile 2 „return wert \+ 1;“\./m);
  assert.match(lauf.stdout, /^rot: 1 Befunde in P-001-probe\.$/m);
});

test("abdeckung-pruefen: ein Zeilenzitat hinter dem Dateiende ist rot", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`rechne` steht in src/x.js:40-41, deshalb bleibt sie." }]);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^Zeilenbeleg in planung\/schnitt\.json, annahmen\[0\] \(u1\): src\/x\.js:40-41: src\/x\.js hat im Stand [0-9a-f]{40} nur 7 Zeilen$/m);
});

test("abdeckung-pruefen: eine Annahme ohne Zeilenangabe bleibt unverändert grün", (context) => {
  const ohne = pruefe(phasenRepo(context));
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`halbiere` bleibt unverändert, weil der Pitch nur `rechne` nennt (pitch.md, ## Anforderungen)." }, { text: "Zeile 2 von src/x.js ändert sich nicht, weil der Pitch es so will." }]);
  const lauf = pruefe(wurzel);
  assert.equal(ohne.stdout, GRUEN);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.equal(lauf.stderr, "");
  assert.equal(lauf.stdout, ohne.stdout);
});

test("abdeckung-pruefen: ein Zeilenzitat in einer Annahme ohne Namen ist rot", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ text: "Die Funktion addiert eins (src/x.js:2), deshalb bleibt sie." }]);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^Zeilenbeleg in planung\/schnitt\.json, annahmen\[0\]: src\/x\.js:2: die Annahme nennt keinen Namen; dort steht Zeile 2 „return wert \+ 1;“\./m);
});

test("abdeckung-pruefen: ein Zeilenzitat wird am Stand der Planung gemessen, nicht am späteren Arbeitsbaum", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`halbiere` teilt durch zwei (`src/x.js:5-7`)." }]);
  writeFiles(wurzel, { "src/x.js": `// später eingefügt\n\n\n${CODE}` });
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.equal(lauf.stdout, GRUEN);
  rmSync(join(wurzel, "src/x.js"));
  assert.equal(pruefe(wurzel).status, EXIT_GRUEN);
});

test("abdeckung-pruefen: fehlt der Stand der Planung im Repo, sind die Zeilenzitate rot statt ungeprüft grün", (context) => {
  const fehlt = "0".repeat(40);
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`rechne` addiert eins (`src/x.js:1-3`)." }], fehlt);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^Stand der Planung 0{40} \(stand\.kopfBaum in planung\/fingerabdruck\.json\) fehlt im Repo; die Zeilenangaben der Annahmen sind nicht prüfbar$/m);
});

test("abdeckung-pruefen: ohne Fingerabdruck misst sie die Zeilenzitate am Arbeitsbaum", (context) => {
  const wurzel = phasenRepo(context);
  writeFiles(wurzel, { [`${ORDNER}/planung/schnitt.json`]: JSON.stringify({ annahmen: [{ text: "`rechne` steht in src/x.js:1, `halbiere` in src/x.js:9." }] }) });
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "Zeilenbeleg in planung/schnitt.json, annahmen[0]: src/x.js:9: src/x.js hat im Arbeitsbaum nur 7 Zeilen\n");
});

test("abdeckung-pruefen: ein Zeilenzitat einer Datei, die es im Stand der Planung nicht gibt, ist rot", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`rechne` steht in `src/y.js:1`." }]);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^Zeilenbeleg in planung\/schnitt\.json, annahmen\[0\] \(u1\): src\/y\.js:1: src\/y\.js gibt es im Stand [0-9a-f]{40} nicht$/m);
});

test("abdeckung-pruefen: eine Folgezeile nach einer Zeilenangabe wird für sich geprüft", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`rechne` und `halbiere` stehen in `src/x.js:1`, `:5` und `:3`." }]);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(outputLines(lauf.stderr).length, 1, lauf.stderr);
  assert.match(lauf.stderr, /^Zeilenbeleg in planung\/schnitt\.json, annahmen\[0\] \(u1\): src\/x\.js:3: keiner der Namen „rechne“, „halbiere“ steht dort; dort steht Zeile 3 „}“\./m);
});

test("abdeckung-pruefen: eine unlesbare Planungsdatei oder ein Stand ohne Objekt-ID ist ein Befund statt eines Abbruchs", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`rechne` addiert eins (`src/x.js:1-3`)." }], "--all");
  const ohneId = pruefe(wurzel);
  assert.equal(ohneId.status, EXIT_ROT);
  assert.match(ohneId.stderr, /^Stand der Planung --all \(stand\.kopfBaum in planung\/fingerabdruck\.json\) fehlt im Repo; /m);
  writeFiles(wurzel, { [`${ORDNER}/planung/fingerabdruck.json`]: "{ kein json" });
  const kaputterAbdruck = pruefe(wurzel);
  assert.equal(kaputterAbdruck.status, EXIT_ROT);
  assert.match(kaputterAbdruck.stderr, /^planung\/fingerabdruck\.json ist nicht lesbar: /m);
  writeFiles(wurzel, { [`${ORDNER}/planung/schnitt.json`]: "{ kein json" });
  const kaputterSchnitt = pruefe(wurzel);
  assert.equal(kaputterSchnitt.status, EXIT_ROT);
  assert.match(kaputterSchnitt.stderr, /^planung\/schnitt\.json ist nicht lesbar: /m);
});

test("abdeckung-pruefen: ein Zeilenzitat ab Zeile 0 ist rot und sagt, dass es die Zeile nicht gibt", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`rechne` steht in `src/x.js:0-3`." }]);
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "Zeilenbeleg in planung/schnitt.json, annahmen[0] (u1): src/x.js:0-3: Zeilen zählen ab 1, Zeile 0 gibt es nicht\n");
});

function mitAntwortDatei(context, annahmen) {
  const wurzel = phasenRepo(context);
  writeFiles(wurzel, { "src/z.js": "export const antwort = { structuredContent: mergedFacts, merged_facts: 1 };\n" });
  commitAll(wurzel, "z");
  return pruefe(geplant(wurzel, annahmen));
}

test("abdeckung-pruefen: ein Teilname aus einem Ausdruck in Backticks belegt ein Zeilenzitat nicht", (context) => {
  const lauf = mitAntwortDatei(context, [{ auftrag: "u1", text: "Der Text entsteht aus `loc.mcp.consultAnswerAccepted(mergedFacts)` (`src/z.js:1`)." }]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /^Zeilenbeleg in planung\/schnitt\.json, annahmen\[0\] \(u1\): src\/z\.js:1: keiner der Namen „loc\.mcp\.consultAnswerAccepted\(mergedFacts\)“ steht dort; /m);
});

test("abdeckung-pruefen: ein Fingerabdruck ohne Stand der Planung ist ein Befund statt einer Messung am Arbeitsbaum", (context) => {
  const wurzel = geplant(phasenRepo(context), [{ auftrag: "u1", text: "`rechne` addiert eins (`src/x.js:1-3`)." }]);
  writeFiles(wurzel, { [`${ORDNER}/planung/fingerabdruck.json`]: "{}" });
  const lauf = pruefe(wurzel);
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(lauf.stderr, "planung/fingerabdruck.json nennt kein stand.kopfBaum; die Zeilenangaben der Annahmen sind nicht prüfbar\n");
});

test("abdeckung-pruefen: ein Bezeichner in camelCase oder mit Unterstrich belegt ein Zeilenzitat auch ohne Backticks", (context) => {
  assert.equal(mitAntwortDatei(context, [{ text: "Die Antwort trägt structuredContent (src/z.js:1)." }]).status, EXIT_GRUEN);
  assert.equal(mitAntwortDatei(context, [{ text: "Die Antwort trägt merged_facts (src/z.js:1)." }]).status, EXIT_GRUEN);
  const wort = mitAntwortDatei(context, [{ text: "Die antwort steht in src/z.js:1." }]);
  assert.equal(wort.status, EXIT_ROT);
  assert.match(wort.stderr, /src\/z\.js:1: die Annahme nennt keinen Namen; /);
});

test("abdeckung-pruefen: ein Name unter drei Zeichen oder ohne Buchstaben belegt ein Zeilenzitat nicht", (context) => {
  const lauf = mitAntwortDatei(context, [{ text: "Dort steht `=`, `{` und `as` (`src/z.js:1`)." }]);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /src\/z\.js:1: die Annahme nennt keinen Namen; /);
});
