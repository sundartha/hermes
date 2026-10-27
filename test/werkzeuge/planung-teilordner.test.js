import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { befundeImOrdner } from "../../tools/auftrag/planung/abdeckung.mjs";
import { nummernImOrdner } from "../../tools/auftrag/planung/nummern.mjs";
import { AUFTRAG, EXIT_AUFRUF, EXIT_BEFUNDE, abgelegt, ersetze, mitIssue, planeAntworten, planungsBericht, vorgaengerGemergt } from "./planung-plane-probe.js";
import { mitKopfzeile } from "./planung-freigabe-probe.js";
import { GRUPPEN, HINWEIS, LAUF_FRIST_MS, LOESUNG, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, mitGeaendertenDateien, planOrdner, planeIn } from "./planung-probe.js";
import { commitPaths, mitUpstreamMaster, runIn, writeFiles } from "./probe-repo.js";

const EXIT_GETEILT = 7;
const ELTERN = "P-001-eigene-nummer";
const HINTERLEGEN = "plaene/P-001-t1-eigene-nummer-hinterlegen";
const HINWEIS_ORDNER = "plaene/P-001-t2-hinweis-beim-anruf";
const UMBAU_ORDNER = "plaene/P-001-t3-umbau-davor";
const TEIL_ORDNER = [HINTERLEGEN, HINWEIS_ORDNER, UMBAU_ORDNER];
const FREIGABE = 2000;
const TEILUNG_TOKEN = 500;
const ANGRIFFSWEG_T3 = /### T3:[\s\S]*?(?=## 3\. Lückenprüfung)/u;
const FEHLERFAELLE = "## Fehlerfälle";
const ZEILENANGABE = ":7";
const UMBAU_DATEI = "src/umbau.js";

const TEILE = alsJson({ teile: [
  { kuerzel: "t1", name: "eigene-nummer-hinterlegen", nummern: ["S1", "S2", "S3", "S6", "S7"], tWege: ["T1", "T2"], dateien: [ROUTE], nurUmbau: false, abhaengigVon: [], grund: "eigener Eingang zum Hinterlegen" },
  { kuerzel: "t2", name: "hinweis-beim-anruf", nummern: ["S4", "S5", "B1", "B2"], tWege: [], dateien: [HINWEIS], nurUmbau: false, abhaengigVon: ["t1"], grund: "der Hinweis braucht die bestätigte Nummer" },
  { kuerzel: "t3", name: "umbau-davor", nummern: [], tWege: [], dateien: ["src/umbau.js"], nurUmbau: true, abhaengigVon: [], grund: "reiner Umbau ohne Nummer" },
] });

function neunSzenarien(wurzel, status) {
  const pitch = join(wurzel, ORDNER, "pitch.md");
  writeFileSync(pitch, readFileSync(pitch, "utf8").replace("Status: fertig", status));
  appendFileSync(pitch, "\n### Szenario B2: Anruf ohne hinterlegte Nummer\nGegeben ein Kunde ohne eigene Nummer\nWenn sein Agent mit `place_call` eine Nummer anruft\nDann beginnt der Anruf mit dem Hinweis für Fremde\n");
}

function geteilt(context, { status = "Status: freigegeben", vorher = () => {} } = {}) {
  const wurzel = planOrdner(context);
  neunSzenarien(wurzel, status);
  vorher(wurzel);
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: { "planer|## Teilung": [TEILE] }, argumente: ["plane", ORDNER], token: { planer: TEILUNG_TOKEN } });
  return lauf;
}

function text(wurzel, ordner, name) {
  return readFileSync(join(wurzel, ordner, name), "utf8");
}


function planeTeil(context, wurzel, ordner) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: {}, ueberschrieben: {}, argumente: ["plane", ordner] });
}

function ohneAgent(lauf) {
  assert.deepEqual(aufrufe(lauf, "planer"), [], lauf.stderr);
  assert.deepEqual(aufrufe(lauf, "erkunder"), [], lauf.stderr);
}

function sortiert(werte) {
  return [...werte].toSorted();
}

test("die Vereinigung der Nummern aller Teil-Ordner ist gleich den Nummern des Eltern-Pitches, jede Nummer steht in genau einem Teil", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context);

  exit(lauf, EXIT_GETEILT);
  const eltern = nummernImOrdner(join(lauf.wurzel, ORDNER));
  const jeTeil = TEIL_ORDNER.map((ordner) => nummernImOrdner(join(lauf.wurzel, ordner)));
  for (const teil of jeTeil) assert.deepEqual(teil.unklar, []);
  const alle = jeTeil.flatMap(({ soll }) => [...soll.keys()]);
  assert.deepEqual(sortiert(alle), sortiert(eltern.soll.keys()));
  assert.equal(new Set(alle).size, alle.length);
  assert.deepEqual(sortiert(jeTeil[0].soll.keys()), ["S1", "S2", "S3", "S6", "S7", "T1", "T2"]);
  assert.deepEqual(sortiert(jeTeil[1].soll.keys()), ["B1", "B2", "S4", "S5"]);
  assert.equal(jeTeil[2].nurUmbau, true);
  for (const teil of jeTeil) for (const [nummer, { text: wortlaut }] of teil.soll) assert.equal(wortlaut, eltern.soll.get(nummer).text, nummer);
  assert.ok(lauf.stderr.includes(HINTERLEGEN), lauf.stderr);
});

test("der Kopf eines Teil-Pitches nennt Status, offenes Issue und Eltern samt Vorgängern, aber keine Token-Menge, und design.md ist eine Kopie", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context, { vorher: (wurzel) => mitKopfzeile(wurzel, ORDNER, `Planung freigegeben: ${FREIGABE} Token`) });

  exit(lauf, EXIT_GETEILT);
  assert.equal(text(lauf.wurzel, ORDNER, "pitch.md").includes(`Planung freigegeben: ${FREIGABE} Token`), true);
  const pitch = text(lauf.wurzel, HINWEIS_ORDNER, "pitch.md");
  for (const zeile of ["Status: freigegeben", "Issue: offen", `Teil von: ${ELTERN}; nach: P-001-t1-eigene-nummer-hinterlegen`]) assert.ok(pitch.split("\n").includes(zeile), `${zeile}\n\n${pitch}`);
  for (const ordner of TEIL_ORDNER) assert.equal(text(lauf.wurzel, ordner, "pitch.md").includes("Planung freigegeben:"), false, ordner);
  assert.ok(text(lauf.wurzel, HINTERLEGEN, "pitch.md").split("\n").includes(`Teil von: ${ELTERN}; nach: –`));
  for (const ordner of TEIL_ORDNER) assert.equal(text(lauf.wurzel, ordner, "design.md"), text(lauf.wurzel, ORDNER, "design.md"));
  const teilung = abgelegt(lauf, "teile.json");
  assert.equal(teilung.topf, undefined);
  assert.equal(teilung.token, TEILUNG_TOKEN);
});

test("die erste Teilung mit Exit 7 schreibt planung.json mit gemessenen Token je Rolle und Exit 7", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context);

  exit(lauf, EXIT_GETEILT);
  const plan = planungsBericht(lauf);
  assert.equal(plan.exit, EXIT_GETEILT);
  assert.deepEqual(plan.beteiligte.map(({ rolle, token }) => ({ rolle, token })), [{ rolle: "planer", token: TEILUNG_TOKEN }]);
  assert.equal(plan.token, abgelegt(lauf, "teile.json").token);
});

test("die Ausgabe der ersten Teilung nennt die gemessenen Vorschnitt-Kosten und die Zahl der Teile, aber keinen Topf", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context);

  exit(lauf, EXIT_GETEILT);
  const bericht = lauf.stdout.split(`Planung ${ELTERN}: Exit ${EXIT_GETEILT}`)[1] ?? "";
  const zeilen = bericht.split("\n");
  assert.ok(zeilen.includes(`Teilung: Vorschnitt gemessen ${TEILUNG_TOKEN} Token, ${TEIL_ORDNER.length} Teile`), lauf.stdout);
  assert.equal(zeilen.some((zeile) => zeile.startsWith("Topf:")), false, lauf.stdout);
});

test("ein Teil eines nicht freigegebenen Eltern-Pitches übernimmt dessen Status, statt eine Freigabe zu behaupten", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context, { status: "Status: fertig (nicht freigegeben)" });

  exit(lauf, EXIT_GETEILT);
  const zeilen = text(lauf.wurzel, HINTERLEGEN, "pitch.md").split("\n");
  assert.ok(zeilen.includes("Status: fertig (nicht freigegeben)"), zeilen.join("\n"));
  assert.equal(zeilen.includes("Status: freigegeben"), false);
});

test("der Abdeckungs-Check ist für jeden Teil-Ordner grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context);

  exit(lauf, EXIT_GETEILT);
  for (const ordner of TEIL_ORDNER) {
    const { soll, nurUmbau } = nummernImOrdner(join(lauf.wurzel, ordner));
    const szenarien = Object.fromEntries([...soll].map(([nummer, { text: wortlaut }]) => [nummer, wortlaut]));
    const auftrag = nurUmbau ? { id: "a1", art: "umbau", prueft: UMBAU_AUSWEG } : { id: "a1", art: "funktion", prueft: [...soll.keys()], szenarien };
    const { befunde } = befundeImOrdner(join(lauf.wurzel, ordner), { phase: ordner.slice("plaene/".length), auftraege: [auftrag] });
    assert.deepEqual(befunde, [], ordner);
  }
});

test("ein Teil ohne eigenen Angriffsweg sagt in sicherheit.md, dass keine Angriffswege zu ihm gehören, und bleibt bestimmbar", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context, { vorher: (wurzel) => writeFileSync(join(wurzel, ORDNER, "sicherheit.md"), text(wurzel, ORDNER, "sicherheit.md").replace(ANGRIFFSWEG_T3, "")) });

  exit(lauf, EXIT_GETEILT);
  const sicherheit = text(lauf.wurzel, HINWEIS_ORDNER, "sicherheit.md");
  assert.ok(sicherheit.includes("keine Angriffswege gefunden"), sicherheit);
  assert.equal(sicherheit.includes("### T1:"), false, sicherheit);
  assert.deepEqual(nummernImOrdner(join(lauf.wurzel, HINWEIS_ORDNER)).unklar, []);
});

test("ein veränderter Abschnitt ohne Nummer in einem Teil-Pitch ergibt einen Befund, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  mitIssue(wurzel, HINTERLEGEN, 77);
  ersetze(join(wurzel, HINTERLEGEN, "pitch.md"), "sofort den Hinweis für Fremde hören", "nie den Hinweis für Fremde hören");

  const lauf = planeTeil(context, wurzel, HINTERLEGEN);

  exit(lauf, EXIT_BEFUNDE);
  ohneAgent(lauf);
  assert.ok(lauf.stderr.includes("pitch.md weicht im Abschnitt „## Fallen“ von plaene/P-001-eigene-nummer ab"), lauf.stderr);
  assert.equal(existsSync(join(wurzel, HINTERLEGEN, "planung")), false);
});

test("ein Teil, dessen Vorgänger auf upstream/master nicht gemergt ist, ergibt Exit 2, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  mitIssue(wurzel, HINWEIS_ORDNER, 93);
  mitUpstreamMaster(wurzel);

  const lauf = planeTeil(context, wurzel, HINWEIS_ORDNER);

  exit(lauf, EXIT_AUFRUF);
  ohneAgent(lauf);
  assert.ok(lauf.stderr.includes("Vorgänger P-001-t1-eigene-nummer-hinterlegen ist auf upstream/master"), lauf.stderr);
  assert.equal(existsSync(join(wurzel, HINWEIS_ORDNER, "planung")), false);
});

test("ein Teil mit Issue: offen ergibt Exit 2, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);

  const lauf = planeTeil(context, wurzel, HINTERLEGEN);

  exit(lauf, EXIT_AUFRUF);
  ohneAgent(lauf);
  assert.ok(lauf.stderr.includes("Issue: offen"), lauf.stderr);
});

test("gibt es einen Teil-Ordner schon, hält plane mit Exit 2 an und schreibt keinen Teil-Ordner", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context, { vorher: (wurzel) => mkdirSync(join(wurzel, HINWEIS_ORDNER), { recursive: true }) });

  exit(lauf, EXIT_AUFRUF);
  assert.ok(lauf.stderr.includes(`${HINWEIS_ORDNER} gibt es schon`), lauf.stderr);
  assert.equal(existsSync(join(lauf.wurzel, HINTERLEGEN)), false);
});

test("eine Zeile „Teil von“, die keinen Ordner neben dem Teil nennt, ergibt Exit 2, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  mitIssue(wurzel, HINTERLEGEN, 80);
  ersetze(join(wurzel, HINTERLEGEN, "pitch.md"), `Teil von: ${ELTERN}; nach: –`, "Teil von: ../plaene/P-001-eigene-nummer; nach: –");

  const lauf = planeTeil(context, wurzel, HINTERLEGEN);

  exit(lauf, EXIT_AUFRUF);
  ohneAgent(lauf);
  assert.ok(lauf.stderr.includes("braucht die Form „Teil von: <Eltern-Ordner>; nach:"), lauf.stderr);
});

function teilMitDesign(context, { genannt, auchInT2 = [], geaendert, erkunder, teil = HINTERLEGEN, gruppe = GRUPPEN[0], nachTeilung = () => {} }) {
  const { wurzel, ...teilung } = geteilt(context, { vorher: (ordner) => {
    if (geaendert !== undefined) mitGeaendertenDateien(ordner, geaendert);
    const design = join(ordner, ORDNER, "design.md");
    ersetze(design, `${LOESUNG}\n`, `${LOESUNG}\n\nDie Stellen dieser Gruppe liegen in ${genannt.map((datei) => `\`${datei}\``).join(" und ")}.\n`);
    ersetze(design, `${FEHLERFAELLE}\n`, `${FEHLERFAELLE}\n\nDer Hinweis beim Anruf liegt in \`${HINWEIS}\`.\n`);
  } });
  exit(teilung, EXIT_GETEILT);
  const teileDatei = join(wurzel, ORDNER, "planung", "teile.json");
  const eltern = JSON.parse(readFileSync(teileDatei, "utf8"));
  const mitGeteilten = eltern.teile.map((teil) => (teil.kuerzel === "t2" ? { ...teil, dateien: [...teil.dateien, ...auchInT2] } : teil));
  writeFileSync(teileDatei, JSON.stringify({ ...eltern, teile: mitGeteilten }));
  mitIssue(wurzel, teil, 97);
  nachTeilung(wurzel);
  const grund = erkunder === undefined ? {} : { ...planeAntworten(), "erkunder|## Erkundung|S1": [erkunder] };
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund, ueberschrieben: { "planer|## Gliederung": [alsJson({ gruppen: [gruppe] })] }, argumente: ["plane", teil] });
}

const HINWEIS_GRUPPE = { ...GRUPPEN[1], nummern: ["S4", "S5", "B1", "B2"], ueberschriften: [LOESUNG] };

function hinweisTeilNachT1(context, { genannt, auchInT2 = [], nachTeilung = (wurzel) => vorgaengerGemergt(wurzel, HINTERLEGEN) }) {
  return teilMitDesign(context, { genannt, auchInT2, teil: HINWEIS_ORDNER, gruppe: HINWEIS_GRUPPE, nachTeilung });
}

function gemergtHinweis(lauf, datei) {
  const sha = runIn(lauf.wurzel, "git", ["rev-parse", "--short=7", "upstream/master"]).stdout.trim();
  return `${datei} gehört ${basename(HINTERLEGEN)}, gemergt ${sha}`;
}

function befundZu(lauf, datei) {
  return lauf.stderr.split("\n").find((zeile) => zeile.startsWith("Gruppe ") && zeile.includes(datei)) ?? "";
}

test("eine Gruppe, deren Design-Abschnitte Code-Dateien eines anderen Teils nennen, endet vor den Erkundern mit Exit 4 und nennt die Dateien und den Teil", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = teilMitDesign(context, { genannt: [`${HINWEIS}${ZEILENANGABE}`, ROUTE], auchInT2: [ROUTE] });

  exit(lauf, EXIT_BEFUNDE);
  assert.deepEqual(aufrufe(lauf, "erkunder"), [], lauf.stderr);
  assert.deepEqual(aufrufe(lauf, "planer", "## Teilung"), [], lauf.stderr);
  for (const datei of [HINWEIS, ROUTE]) assert.ok(befundZu(lauf, datei).includes(basename(HINWEIS_ORDNER)), `${datei}\n\n${lauf.stderr}`);
  assert.equal(planungsBericht(lauf, HINTERLEGEN).exit, EXIT_BEFUNDE);
});

test("eine Gruppe, die nur Dateien des eigenen Teils nennt, plant weiter wie bisher", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = teilMitDesign(context, { genannt: [ROUTE] });

  assert.equal(aufrufe(lauf, "erkunder").length, 1, lauf.stderr);
  assert.equal(lauf.stderr.includes(basename(HINWEIS_ORDNER)), false, lauf.stderr);
});

test("eine Beleg-Datei eines gemeinsamen Abschnitts gilt im Teil nicht als fremde Datei", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = teilMitDesign(context, { genannt: [`${HINWEIS}${ZEILENANGABE}`], geaendert: [ROUTE, UMBAU_DATEI] });

  assert.equal(aufrufe(lauf, "erkunder").length, 1, lauf.stderr);
  assert.equal(befundZu(lauf, HINWEIS), "", lauf.stderr);
});

test("ändert die Erkundung im Teil eine Datei, die der Pitch nur für einen anderen Teil als geändert nennt, hält plane den Teil vor dem Zuschnitt mit Exit 4 an", { timeout: LAUF_FRIST_MS }, (context) => {
  const hinweisAendern = { aenderungen: [{ datei: HINWEIS, funktion: "setzeHinweis", von: 6, bis: 9, neueZeilen: 3 }] };
  const erkunder = bericht(GRUPPEN[0].nummern, Object.fromEntries(GRUPPEN[0].nummern.map((nummer) => [nummer, hinweisAendern])));
  const lauf = teilMitDesign(context, { genannt: [ROUTE], geaendert: [ROUTE, HINWEIS, UMBAU_DATEI], erkunder });

  exit(lauf, EXIT_BEFUNDE);
  assert.equal(aufrufe(lauf, "erkunder", "## Erkundung").length, 1, lauf.stderr);
  assert.deepEqual(aufrufe(lauf, "planer", "## Zuschnitt"), [], lauf.stderr);
  assert.ok(lauf.stderr.split("\n").some((zeile) => zeile.includes(HINWEIS) && zeile.includes("Geänderte Dateien")), lauf.stderr);
});

test("eine im Pitch als geändert genannte Datei eines anderen Teils in einem gemeinsamen Abschnitt hält den Teil weiter mit Exit 4 an", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = teilMitDesign(context, { genannt: [`${HINWEIS}${ZEILENANGABE}`], geaendert: [ROUTE, HINWEIS, UMBAU_DATEI] });

  exit(lauf, EXIT_BEFUNDE);
  assert.deepEqual(aufrufe(lauf, "erkunder"), [], lauf.stderr);
  assert.ok(befundZu(lauf, HINWEIS).includes(basename(HINWEIS_ORDNER)), lauf.stderr);
});

test("teilordner: eine eigene Datei, die auch ein gemergter Vorgänger aus nach ändert, ist keine Datei eines anderen Teils", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = hinweisTeilNachT1(context, { genannt: [ROUTE], auchInT2: [ROUTE] });

  assert.equal(aufrufe(lauf, "erkunder").length, 1, lauf.stderr);
  assert.equal(befundZu(lauf, ROUTE), "", lauf.stderr);
});

test("teilordner: Dateien eines gemergten Vorgängers aus nach sind keine fremden Dateien und stehen als Hinweis im Protokoll", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = hinweisTeilNachT1(context, { genannt: [`${ROUTE}${ZEILENANGABE}`] });

  assert.equal(aufrufe(lauf, "erkunder").length, 1, lauf.stderr);
  assert.equal(befundZu(lauf, ROUTE), "", lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(gemergtHinweis(lauf, ROUTE)), lauf.stdout);
});

test("teilordner: Dateien eines anderen offenen Teils bleiben fremde Dateien, auch neben einem gemergten Vorgänger", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = hinweisTeilNachT1(context, { genannt: [ROUTE, UMBAU_DATEI] });

  exit(lauf, EXIT_BEFUNDE);
  assert.deepEqual(aufrufe(lauf, "erkunder"), [], lauf.stderr);
  assert.ok(befundZu(lauf, UMBAU_DATEI).includes(basename(UMBAU_ORDNER)), lauf.stderr);
  assert.equal(befundZu(lauf, ROUTE), "", lauf.stderr);
});

test("teilordner: ein Vorgänger, der nur auf dem eigenen Branch steht, gibt keine Dateien frei und plane hält vor den Erkundern", { timeout: LAUF_FRIST_MS }, (context) => {
  const nurImBranch = (wurzel) => {
    vorgaengerGemergt(wurzel, HINTERLEGEN);
    assert.equal(runIn(wurzel, "git", ["update-ref", "refs/remotes/upstream/master", "HEAD~1"]).status, 0);
  };
  const lauf = hinweisTeilNachT1(context, { genannt: [ROUTE], nachTeilung: nurImBranch });

  exit(lauf, EXIT_AUFRUF);
  assert.deepEqual(aufrufe(lauf, "erkunder"), [], lauf.stderr);
  assert.equal(lauf.stdout.includes(`${ROUTE} gehört`), false, lauf.stdout);
});

const HINTERLEGEN_UNTERTEILE = ["plaene/P-001-t1-t1-nummer-anlegen", "plaene/P-001-t1-t2-nummer-pruefen"];

function hinterlegenGeteilt(wurzel, gemergt) {
  const datei = `${HINTERLEGEN}/planung/teile.json`;
  writeFiles(wurzel, { [datei]: `${JSON.stringify({ teile: [{ kuerzel: "t1", name: "nummer-anlegen" }, { kuerzel: "t2", name: "nummer-pruefen" }] })}\n` });
  commitPaths(wurzel, [datei], "Plane P-001 t1: Teile");
  mitUpstreamMaster(wurzel);
  for (const ordner of gemergt) vorgaengerGemergt(wurzel, ordner);
}

test("teilordner: fehlt einem geteilten Vorgänger aus nach ein gemergter Unter-Teil, hält plane vor den Erkundern und nennt den Unter-Teil", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = hinweisTeilNachT1(context, { genannt: [ROUTE], nachTeilung: (wurzel) => hinterlegenGeteilt(wurzel, HINTERLEGEN_UNTERTEILE.slice(0, 1)) });

  exit(lauf, EXIT_AUFRUF);
  assert.deepEqual(aufrufe(lauf, "erkunder"), [], lauf.stderr);
  assert.ok(lauf.stderr.includes(`Vorgänger ${basename(HINTERLEGEN_UNTERTEILE[1])} (Unter-Teil des geteilten Vorgängers ${basename(HINTERLEGEN)}`), lauf.stderr);
  assert.equal(lauf.stdout.includes(`${ROUTE} gehört`), false, lauf.stdout);
});
