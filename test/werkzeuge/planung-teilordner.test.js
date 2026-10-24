import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { befundeImOrdner } from "../../tools/auftrag/planung/abdeckung.mjs";
import { nummernImOrdner } from "../../tools/auftrag/planung/nummern.mjs";
import { AUFTRAG, EXIT_ABBRUCH, EXIT_AUFRUF, EXIT_BEFUNDE, abgelegt, planeAntworten } from "./planung-plane-probe.js";
import { HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, exit, planOrdner, planeIn } from "./planung-probe.js";

const EXIT_DECKEL = 5;
const EXIT_GETEILT = 7;
const ELTERN = "P-001-eigene-nummer";
const HINTERLEGEN = "plaene/P-001-t1-eigene-nummer-hinterlegen";
const HINWEIS_ORDNER = "plaene/P-001-t2-hinweis-beim-anruf";
const UMBAU_ORDNER = "plaene/P-001-t3-umbau-davor";
const TEIL_ORDNER = [HINTERLEGEN, HINWEIS_ORDNER, UMBAU_ORDNER];
const FREIGABE = 2000;
const TEILUNG_TOKEN = 500;
const TEIL_DECKEL = FREIGABE - TEILUNG_TOKEN;
const ANGRIFFSWEG_T3 = /### T3:[\s\S]*?(?=## 3\. Lückenprüfung)/u;

const TEILE = alsJson({ teile: [
  { kuerzel: "t1", name: "eigene-nummer-hinterlegen", nummern: ["S1", "S2", "S3", "S6", "S7"], tWege: ["T1", "T2"], dateien: [ROUTE], nurUmbau: false, abhaengigVon: [], grund: "eigener Eingang zum Hinterlegen" },
  { kuerzel: "t2", name: "hinweis-beim-anruf", nummern: ["S4", "S5", "B1", "B2"], tWege: [], dateien: [HINWEIS], nurUmbau: false, abhaengigVon: ["t1"], grund: "der Hinweis braucht die bestätigte Nummer" },
  { kuerzel: "t3", name: "umbau-davor", nummern: [], tWege: [], dateien: ["src/umbau.js"], nurUmbau: true, abhaengigVon: [], grund: "reiner Umbau ohne Nummer" },
] });

function neunSzenarien(wurzel, freigabe) {
  const pitch = join(wurzel, ORDNER, "pitch.md");
  writeFileSync(pitch, readFileSync(pitch, "utf8").replace("Planung freigegeben: 15000000 Token", `Planung freigegeben: ${freigabe} Token`));
  appendFileSync(pitch, "\n### Szenario B2: Anruf ohne hinterlegte Nummer\nGegeben ein Kunde ohne eigene Nummer\nWenn sein Agent mit `place_call` eine Nummer anruft\nDann beginnt der Anruf mit dem Hinweis für Fremde\n");
}

function geteilt(context, { freigabe = FREIGABE, vorher = () => {} } = {}) {
  const wurzel = planOrdner(context);
  neunSzenarien(wurzel, freigabe);
  vorher(wurzel);
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: { "planer|## Teilung": [TEILE] }, argumente: ["plane", ORDNER], token: { planer: TEILUNG_TOKEN } });
  return lauf;
}

function text(wurzel, ordner, name) {
  return readFileSync(join(wurzel, ordner, name), "utf8");
}

function ersetze(datei, alt, neu) {
  const vorher = readFileSync(datei, "utf8");
  assert.ok(vorher.includes(alt), vorher);
  writeFileSync(datei, vorher.replace(alt, neu));
}

function mitIssue(wurzel, ordner, issue) {
  ersetze(join(wurzel, ordner, "pitch.md"), "Issue: offen", `Issue: ${issue}`);
}

function verbraucht(wurzel, ordner, token) {
  const ziel = join(wurzel, ".fortschritt", ordner.slice("plaene/".length));
  mkdirSync(ziel, { recursive: true });
  writeFileSync(join(ziel, "planung.json"), JSON.stringify({ beteiligte: [{ rolle: "planer", sitzung: "frueher", token }], token }));
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

test("der Kopf eines Teil-Pitches nennt Status, offenes Issue, den Teil-Deckel aus dem Rest-Topf und Eltern samt Vorgängern, und design.md ist eine Kopie", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context);

  exit(lauf, EXIT_GETEILT);
  const pitch = text(lauf.wurzel, HINWEIS_ORDNER, "pitch.md");
  for (const zeile of ["Status: freigegeben", "Issue: offen", `Planung freigegeben: ${TEIL_DECKEL} Token`, `Teil von: ${ELTERN}; nach: P-001-t1-eigene-nummer-hinterlegen`]) assert.ok(pitch.split("\n").includes(zeile), `${zeile}\n\n${pitch}`);
  assert.ok(text(lauf.wurzel, HINTERLEGEN, "pitch.md").split("\n").includes(`Teil von: ${ELTERN}; nach: –`));
  for (const ordner of TEIL_ORDNER) assert.equal(text(lauf.wurzel, ordner, "design.md"), text(lauf.wurzel, ORDNER, "design.md"));
  const topf = abgelegt(lauf, "teile.json").topf;
  assert.deepEqual(topf, { freigabe: FREIGABE, vorschnitt: TEILUNG_TOKEN, teile: 0, rest: TEIL_DECKEL, teilDeckel: TEIL_DECKEL });
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

test("ein leerer Topf ergibt Exit 5, bevor ein Agent startet", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  verbraucht(wurzel, HINTERLEGEN, 1600);
  mitIssue(wurzel, HINWEIS_ORDNER, 78);

  const lauf = planeTeil(context, wurzel, HINWEIS_ORDNER);

  exit(lauf, EXIT_DECKEL);
  ohneAgent(lauf);
  assert.ok(lauf.stderr.includes(`Freigabe ${FREIGABE} − Vorschnitt ${TEILUNG_TOKEN} − Teile 1600 = -100`), lauf.stderr);
  assert.equal(existsSync(join(wurzel, HINWEIS_ORDNER, "planung")), false);
});

test("ist schon die Teilung so teuer, dass der Topf leer ist, endet plane mit Exit 5 und schreibt keinen Teil-Ordner", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = geteilt(context, { freigabe: TEILUNG_TOKEN });

  exit(lauf, EXIT_DECKEL);
  assert.ok(lauf.stderr.includes(`Freigabe ${TEILUNG_TOKEN} − Vorschnitt ${TEILUNG_TOKEN} − Teile 0 = 0`), lauf.stderr);
  for (const ordner of TEIL_ORDNER) assert.equal(existsSync(join(lauf.wurzel, ordner)), false, ordner);
});

test("ein Teil plant mit dem kleineren Deckel aus Rest-Topf und Teil-Pitch", { timeout: LAUF_FRIST_MS }, (context) => {
  const { wurzel, ...teilung } = geteilt(context);
  exit(teilung, EXIT_GETEILT);
  verbraucht(wurzel, HINTERLEGEN, 300);
  mitIssue(wurzel, HINWEIS_ORDNER, 79);

  const lauf = planeTeil(context, wurzel, HINWEIS_ORDNER);

  exit(lauf, EXIT_ABBRUCH);
  assert.equal(aufrufe(lauf, "planer").length, 1, lauf.stderr);
  const bericht = JSON.parse(readFileSync(join(wurzel, ".fortschritt", "P-001-t2-hinweis-beim-anruf", "planung.json"), "utf8"));
  assert.equal(bericht.deckel.deckel, FREIGABE - TEILUNG_TOKEN - 300);
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
