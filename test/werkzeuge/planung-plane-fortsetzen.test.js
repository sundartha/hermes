import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, GRUPPEN, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, planeIn, schnittliste } from "./planung-probe.js";
import { EINGANG, WIRKUNG, mitWeg, wurzelMitKette } from "./planung-kette-probe.js";
import { ABBRUCH_IM_SCHNITT, AUFTRAG, EXIT_AUFRUF, EXIT_GRUEN, EXIT_PASST_NICHT, SCHNITT_SOFORT, abgebrochen, abgelegt, aendereWerkzeug, FORTSETZEN, fortsetzung, phaseDatei, plane, planeAntworten, planungsDatei, werkzeug } from "./planung-plane-probe.js";
import { commitPaths, runIn } from "./probe-repo.js";

const FRAGE = "Wo wird die Nummer gespeichert?";
const MIT_NACHFRAGE = {
  "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S1"], frage: FRAGE }] }), alsJson({ schnitt: schnittliste() })],
  "erkunder|## Nachfrage|S1": [bericht(["S1"])],
};
const NACHFRAGE_FUNDSTELLE = `${ROUTE} Zeile 10`;
const NACHFRAGE_UND_ABBRUCH = {
  "planer|## Zuschnitt": [MIT_NACHFRAGE["planer|## Zuschnitt"][0], ...ABBRUCH_IM_SCHNITT["planer|## Zuschnitt"]],
  "erkunder|## Nachfrage|S1": [bericht(["S1"], { S1: { schema: { aenderung: false, fundstelle: NACHFRAGE_FUNDSTELLE } } })],
};
const LUECKE = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S4"] };
const WEG_OFFEN = { "pruefer-planung|## Wegprüfung|S4": [LUECKE], "pruefer-planung|## Befunde": [LUECKE] };
const ANSAGE = "### Ende der Nachfragen";
const FINGERABDRUCK = "fingerabdruck.json";
const GLIEDERUNG_KOPF = "## Gliederung\n\n";
const ZUSCHNITT_KOPF = "## Zuschnitt\n\n";
const NACHFRAGEN = "nachfragen.json";
const ANTWORT_KOPF = "### Antwort auf deine Nachfrage 1";
const LAGEBILD_KOPF = "### Annahmen der Erkunder";

function weiter(context, vorher, argumente = FORTSETZEN) {
  return fortsetzung(context, vorher, { argumente, ueberschrieben: MIT_NACHFRAGE });
}

function nachfrageWellen(lauf) {
  return abgelegt(lauf, FINGERABDRUCK).zustand.nachfrageWellen;
}

function eingaben(lauf, agent, ueberschrift) {
  return aufrufe(lauf, agent, ueberschrift).map(({ eingabe }) => eingabe);
}

function keinAgent({ ersatz }) {
  return !existsSync(join(ersatz, "protokoll.jsonl"));
}

function abgelehnt(lauf, grund) {
  exit(lauf, EXIT_AUFRUF);
  assert.match(lauf.stderr, grund);
  assert.equal(keinAgent(lauf), true);
  assert.equal(existsSync(phaseDatei(lauf)), false);
}

function antwortTeil(eingabe) {
  const anfang = eingabe.indexOf(ANTWORT_KOPF);
  assert.notEqual(anfang, -1, eingabe);
  const ende = eingabe.indexOf(LAGEBILD_KOPF, anfang);
  assert.notEqual(ende, -1, eingabe);
  return eingabe.slice(anfang, ende);
}

function git({ wurzel }, ...argumente) {
  const lauf = runIn(wurzel, "git", argumente);
  assert.equal(lauf.status, 0, lauf.stderr);
}

test("plane --fortsetzen: nach einem Abbruch im Schnitt plant es ohne Gliederung und Erkunder mit derselben Eingabe wie der Neulauf grün weiter", { timeout: LAUF_FRIST_MS }, (context) => {
  const neulauf = plane(context, { ...MIT_NACHFRAGE, ...WEG_OFFEN });
  exit(neulauf, EXIT_GRUEN);
  const vorher = abgebrochen(context, WEG_OFFEN);
  const ersterWeg = readFileSync(planungsDatei(vorher, "wegpruefung-S1-1.json"), "utf8");
  const lauf = weiter(context, vorher);
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(eingaben(lauf, "planer", "## Gliederung"), []);
  assert.deepEqual(eingaben(lauf, "erkunder", "## Erkundung"), []);
  const [gliederung] = eingaben(neulauf, "planer", "## Gliederung");
  const [erster, zweiter] = eingaben(neulauf, "planer", "## Zuschnitt");
  const [fortErster, fortZweiter] = eingaben(lauf, "planer", "## Zuschnitt");
  assert.ok(fortErster.startsWith(ZUSCHNITT_KOPF));
  assert.ok(fortErster.includes(gliederung.slice(GLIEDERUNG_KOPF.length)));
  assert.ok(fortErster.includes(JSON.stringify({ gruppen: GRUPPEN }, null, 2)));
  assert.ok(fortErster.endsWith(erster.slice(ZUSCHNITT_KOPF.length)));
  assert.equal(fortZweiter, zweiter);
  assert.ok(fortZweiter.includes("Nachfragen zu S1 enden"));
  assert.ok(fortErster.includes("Weg S4, S5, B1:"));
  assert.equal(readFileSync(planungsDatei(lauf, "wegpruefung-S1-1.json"), "utf8"), ersterWeg);
  assert.equal(existsSync(planungsDatei(lauf, "wegpruefung-S1-2.json")), true);
  assert.equal(werkzeug(lauf, AUFTRAG, "pruefe", phaseDatei(lauf)).status, EXIT_GRUEN);
});

test("plane --fortsetzen: nach einer Nachfrage und einem Abbruch im Schnitt plant es ohne Erkunder mit der Antwort der Nachfrage weiter", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = plane(context, NACHFRAGE_UND_ABBRUCH);
  exit(vorher, EXIT_PASST_NICHT);
  assert.equal(nachfrageWellen(vorher), 1);
  const lauf = weiter(context, vorher);
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  const [erster, zweiter] = eingaben(lauf, "planer", "## Zuschnitt");
  assert.ok(erster.includes(`aenderung=false (${NACHFRAGE_FUNDSTELLE})`));
  assert.ok(zweiter.includes(ANSAGE), zweiter);
  assert.equal(nachfrageWellen(lauf), 1);
});

test("plane --fortsetzen: nach einem Abbruch nach der Nachfrage-Welle legt es dem Planer dieselben Nachfragen und Antworten vor und startet keinen Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, NACHFRAGE_UND_ABBRUCH);
  const [, nachWelle] = eingaben(vorher, "planer", "## Zuschnitt");
  const antwort = antwortTeil(nachWelle);
  assert.ok(antwort.includes(`Frage: ${FRAGE}`), antwort);
  const lauf = fortsetzung(context, vorher, { ueberschrieben: SCHNITT_SOFORT });
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  const [erster, ...weitere] = eingaben(lauf, "planer", "## Zuschnitt");
  assert.deepEqual(weitere, []);
  assert.ok(erster.includes(antwort), erster);
  assert.ok(erster.indexOf(ANTWORT_KOPF) < erster.indexOf("### Erkundungsberichte (verdichtet)"), erster);
  assert.equal(nachfrageWellen(lauf), 1);
});

test("plane --fortsetzen: eine seit der Nachfrage-Welle geänderte oder fehlende Antwortdatei bricht ab, ohne einen Agenten zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, NACHFRAGE_UND_ABBRUCH);
  const datei = planungsDatei(vorher, NACHFRAGEN);
  const [welle] = JSON.parse(readFileSync(datei, "utf8"));
  assert.equal(welle.antworten[0].frage, FRAGE);
  writeFileSync(datei, JSON.stringify([{ ...welle, antworten: [{ ...welle.antworten[0], frage: "Wo wird die Nummer gelöscht?" }] }]));
  abgelehnt(weiter(context, vorher), /nachfragen\.json ist seit dem Ablegen der Erkundung geändert/u);
  rmSync(datei);
  abgelehnt(weiter(context, vorher), /nachfragen\.json fehlt/u);
});

test("plane --fortsetzen: eine Antwortdatei mit passender Prüfsumme, aber ohne die gezählte Welle oder in fremder Form bricht ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, NACHFRAGE_UND_ABBRUCH);
  const abdruck = abgelegt(vorher, FINGERABDRUCK);
  for (const inhalt of ["[]", "{}", JSON.stringify([{ antworten: [{ frage: FRAGE }], enden: [] }])]) {
    writeFileSync(planungsDatei(vorher, NACHFRAGEN), inhalt);
    const summe = createHash("sha256").update(inhalt).digest("hex");
    writeFileSync(planungsDatei(vorher, FINGERABDRUCK), JSON.stringify({ ...abdruck, ablage: { ...abdruck.ablage, [NACHFRAGEN]: summe } }));
    abgelehnt(weiter(context, vorher), /nachfragen\.json hat nicht die Form der beantworteten Nachfrage-Wellen dieses Fingerabdrucks/u);
  }
});

test("plane --fortsetzen: nach einer Nachfrage-Welle lehnt eine Änderung am Code die Fortsetzung wie ohne Welle ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context, NACHFRAGE_UND_ABBRUCH);
  appendFileSync(join(vorher.wurzel, ROUTE), "\nexport const nachtrag = 1;\n");
  abgelehnt(weiter(context, vorher), /der Arbeitsbaum ohne planung\/ ist ein anderer als beim Ablegen der Erkundung/u);
});

test("plane --fortsetzen: ohne Nachfrage-Welle vor dem Abbruch darf das Fortsetzen eine Welle erkunden lassen und legt sie im Fingerabdruck ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  assert.equal(nachfrageWellen(vorher), 0);
  const lauf = weiter(context, vorher);
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 1);
  assert.equal(nachfrageWellen(lauf), 1);
});

test("plane --fortsetzen: ein Fingerabdruck ohne nachfrageWellen oder mit einer Zahl, die keine ganze Zahl ab 0 ist, bricht ab, ohne einen Agenten zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  const abdruck = abgelegt(vorher, FINGERABDRUCK);
  for (const wellen of [undefined, -1, 0.5, "0"]) {
    writeFileSync(planungsDatei(vorher, FINGERABDRUCK), JSON.stringify({ ...abdruck, zustand: { ...abdruck.zustand, nachfrageWellen: wellen } }));
    abgelehnt(weiter(context, vorher), /fingerabdruck\.json hat nicht die Form eines Fingerabdrucks/u);
  }
});

test("plane --fortsetzen: ein anderer Repo-Baum (HEAD^{tree}) bricht ab, ohne einen Agenten zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  git(vorher, "rm", "-q", "--cached", "CLAUDE.md");
  git(vorher, "-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-q", "-m", "ohne CLAUDE.md");
  abgelehnt(weiter(context, vorher), /der Repo-Baum \(HEAD\^\{tree\}\) ist [0-9a-f]+, beim Ablegen der Erkundung war er [0-9a-f]+/u);
});

test("plane --fortsetzen: eine nicht committete Änderung am Code seit der Erkundung bricht ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  appendFileSync(join(vorher.wurzel, ROUTE), "\nexport const nachtrag = 1;\n");
  abgelehnt(weiter(context, vorher), /der Arbeitsbaum ohne planung\/ ist ein anderer als beim Ablegen der Erkundung/u);
});

test("plane --fortsetzen: ein seit der Erkundung geändertes Design Doc bricht ab und nennt es", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  appendFileSync(join(vorher.wurzel, ORDNER, "design.md"), "\nNachtrag.\n");
  abgelehnt(weiter(context, vorher), new RegExp(`${ORDNER}/design\\.md ist seit dem Ablegen der Erkundung geändert`, "u"));
});

test("plane --fortsetzen: eine geänderte Modell-Einstellung des Planers bricht ab und nennt sie", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  const datei = join(vorher.wurzel, ".claude/agents/planer.md");
  appendFileSync(datei, "\n");
  abgelehnt(weiter(context, vorher), /\.claude\/agents\/planer\.md ist seit dem Ablegen der Erkundung geändert/u);
});

test("plane --fortsetzen: eine fehlende Erkundungsdatei bricht ab und nennt sie", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  rmSync(planungsDatei(vorher, "erkundung-g2.json"));
  abgelehnt(weiter(context, vorher), /erkundung-g2\.json fehlt/u);
});

test("plane --fortsetzen: ohne Fingerabdruck bricht es ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  rmSync(planungsDatei(vorher, "fingerabdruck.json"));
  abgelehnt(weiter(context, vorher), /fingerabdruck\.json fehlt/u);
});

test("plane ohne --fortsetzen endet bei vorhandenem planung/ wie bisher, und --fortsetzen ohne planung/ oder nach phase.json setzt nicht fort", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  abgelehnt(weiter(context, vorher, [ORDNER]), /planung gibt es schon; plane überschreibt nichts/u);
  const ohne = plane(context, {}, FORTSETZEN);
  abgelehnt(ohne, /planung gibt es nicht; --fortsetzen braucht die abgelegte Erkundung/u);
  const fertig = plane(context);
  exit(fertig, EXIT_GRUEN);
  const nochmal = weiter(context, fertig);
  exit(nochmal, EXIT_AUFRUF);
  assert.match(nochmal.stderr, /phase\.json gibt es schon; plane überschreibt nichts/u);
  assert.equal(keinAgent(nochmal), true);
});

const WERKZEUG_FUNDSTELLE = "tools/bereiche.json Zeile 1";

function ohneErkundung(lauf) {
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "planer", "## Gliederung"), []);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.equal(werkzeug(lauf, AUFTRAG, "pruefe", phaseDatei(lauf)).status, EXIT_GRUEN);
}

test("plane --fortsetzen: eine seit der Erkundung committete Änderung nur unter tools/ setzt fort, ohne einen Erkunder zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  aendereWerkzeug(vorher, { committet: true });
  ohneErkundung(fortsetzung(context, vorher));
});

test("plane --fortsetzen: eine nicht committete Änderung nur unter tools/ setzt ebenso fort", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  aendereWerkzeug(vorher, { committet: false });
  ohneErkundung(fortsetzung(context, vorher));
});

test("plane --fortsetzen: eine Änderung unter tools/ zusammen mit einer Änderung am Produktcode bricht ab, ohne einen Agenten zu starten", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  aendereWerkzeug(vorher, { committet: true });
  appendFileSync(join(vorher.wurzel, ROUTE), "\nexport const nachtrag = 1;\n");
  abgelehnt(fortsetzung(context, vorher), /der Arbeitsbaum ohne planung\/ ist ein anderer als beim Ablegen der Erkundung/u);
  commitPaths(vorher.wurzel, [ROUTE], "Produktcode");
  abgelehnt(fortsetzung(context, vorher), /der Repo-Baum \(HEAD\^\{tree\}\) ist [0-9a-f]+, beim Ablegen der Erkundung war er [0-9a-f]+/u);
});

test("plane --fortsetzen: eine Änderung unter tools/ bricht ab, wenn ein Erkundungsbericht eine Datei unter tools/ als Fundstelle nennt", { timeout: LAUF_FRIST_MS }, (context) => {
  const amWerkzeug = { "erkunder|## Erkundung|S1": [bericht(GRUPPEN[0].nummern, { S1: { schema: { aenderung: false, fundstelle: WERKZEUG_FUNDSTELLE } } })] };
  const vorher = abgebrochen(context, amWerkzeug);
  ohneErkundung(fortsetzung(context, vorher));
  const zweiter = abgebrochen(context, amWerkzeug);
  aendereWerkzeug(zweiter, { committet: true });
  abgelehnt(fortsetzung(context, zweiter), /erkundung-g1\.json nennt tools\/bereiche\.json/u);
});

test("plane --fortsetzen: eine Änderung an einer Rollen-Datei oder am Format des Fingerabdrucks bricht weiter ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  aendereWerkzeug(vorher, { committet: true });
  const abdruck = abgelegt(vorher, FINGERABDRUCK);
  const { wegZaehler, ...zustand } = abdruck.zustand;
  assert.ok(Array.isArray(wegZaehler));
  writeFileSync(planungsDatei(vorher, FINGERABDRUCK), JSON.stringify({ ...abdruck, zustand }));
  abgelehnt(fortsetzung(context, vorher), /fingerabdruck\.json hat nicht die Form eines Fingerabdrucks/u);
  writeFileSync(planungsDatei(vorher, FINGERABDRUCK), JSON.stringify(abdruck));
  appendFileSync(join(vorher.wurzel, ".claude/agents/erkunder.md"), "\n");
  abgelehnt(fortsetzung(context, vorher), /\.claude\/agents\/erkunder\.md ist seit dem Ablegen der Erkundung geändert/u);
});

test("plane --fortsetzen: ein Fingerabdruck ohne die neuen Felder vergleicht die ganzen Bäume wie bisher", { timeout: LAUF_FRIST_MS }, (context) => {
  const vorher = abgebrochen(context);
  const abdruck = abgelegt(vorher, FINGERABDRUCK);
  const { kopfBaum, arbeitsbaum, dateien } = abdruck.stand;
  writeFileSync(planungsDatei(vorher, FINGERABDRUCK), JSON.stringify({ ...abdruck, stand: { kopfBaum, arbeitsbaum, dateien } }));
  aendereWerkzeug(vorher, { committet: false });
  abgelehnt(fortsetzung(context, vorher), /der Arbeitsbaum ohne planung\/ ist ein anderer als beim Ablegen der Erkundung/u);
  assert.equal(abgelegt(vorher, FINGERABDRUCK).stand.kopfBaum, kopfBaum);
});

test("plane --fortsetzen: ein Befund der Kettenprüfung über den gespeicherten Bericht bricht die Fortsetzung ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const luecke = mitWeg([EINGANG, WIRKUNG]);
  const ueberschrieben = { ...ABBRUCH_IM_SCHNITT, "erkunder|## Erkundung|S4": [luecke], "erkunder|## Befunde": [luecke] };
  const vorher = planeIn(context, wurzelMitKette(context), { werkzeug: AUFTRAG, grund: planeAntworten(), argumente: ["plane", ORDNER], ueberschrieben });
  exit(vorher, EXIT_PASST_NICHT);
  assert.equal(aufrufe(vorher, "erkunder", "## Befunde").length, 1);
  aendereWerkzeug(vorher, { committet: true });
  const lauf = fortsetzung(context, vorher);
  abgelehnt(lauf, /S4: zwischen nimmAuftrag \(src\/kette-probe\.js\) und speichereAuftrag \(src\/kette-probe\.js\) liegen ungemeldet pruefeAuftrag/u);
});
