import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, GRUPPEN, LAUF_FRIST_MS, LOESUNG, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, planeIn, schnittliste } from "./planung-probe.js";
import { AUFTRAG, EXIT_AUFRUF, EXIT_BEFUNDE, EXIT_GRUEN, EXIT_PASST_NICHT, phaseDatei, plane, planeAntworten, werkzeug } from "./planung-plane-probe.js";
import { runIn } from "./probe-repo.js";

const FORTSETZEN = [ORDNER, "--fortsetzen"];
const ABBRUCH_IM_SCHNITT = { "planer|## Zuschnitt": [`Zerlegung passt nicht: Dann widerspricht der Lösung (Fundstellen: pitch.md, ## Problem; design.md, ${LOESUNG})`] };
const MIT_NACHFRAGE = {
  "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S1"], frage: "Wo wird die Nummer gespeichert?" }] }), alsJson({ schnitt: schnittliste() })],
  "erkunder|## Nachfrage|S1": [bericht(["S1"])],
};
const NACHFRAGE_FUNDSTELLE = `${ROUTE} Zeile 10`;
const NACHFRAGE_UND_ABBRUCH = {
  "planer|## Zuschnitt": [MIT_NACHFRAGE["planer|## Zuschnitt"][0], ...ABBRUCH_IM_SCHNITT["planer|## Zuschnitt"]],
  "erkunder|## Nachfrage|S1": [bericht(["S1"], { S1: { schema: { aenderung: false, fundstelle: NACHFRAGE_FUNDSTELLE } } })],
};
const LUECKE = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S4"] };
const WEG_OFFEN = { "pruefer-planung|## Wegprüfung|S4": [LUECKE], "pruefer-planung|## Befunde": [LUECKE] };
const GLIEDERUNG_KOPF = "## Gliederung\n\n";
const ZUSCHNITT_KOPF = "## Zuschnitt\n\n";

function abgebrochen(context, zusatz = {}) {
  const lauf = plane(context, { ...ABBRUCH_IM_SCHNITT, ...zusatz });
  exit(lauf, EXIT_PASST_NICHT);
  return lauf;
}

function weiter(context, { wurzel }, argumente = FORTSETZEN) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: MIT_NACHFRAGE, argumente: ["plane", ...argumente] });
}

function planungsDatei({ wurzel }, name) {
  return join(wurzel, ORDNER, "planung", name);
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
  const lauf = weiter(context, vorher);
  exit(lauf, EXIT_BEFUNDE);
  assert.match(lauf.stderr, /Nachfragen ausgeschöpft: S1/u);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  const [erster] = eingaben(lauf, "planer", "## Zuschnitt");
  assert.ok(erster.includes(`aenderung=false (${NACHFRAGE_FUNDSTELLE})`));
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
