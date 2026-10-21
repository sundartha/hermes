import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN_PRUEFLISTE, GRUPPEN, HINWEIS, LAUF_FRIST_MS, LOESUNG, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, schnittliste, stelle } from "./planung-probe.js";
import { REPO_ROOT } from "./probe-repo.js";
import { AUFTRAG, EXIT_BEFUNDE, EXIT_GRUEN, EXIT_PASST_NICHT, jePruefer, phaseDatei, plane, planungsBericht, WARTEN_MS, werkzeug } from "./planung-plane-probe.js";

test("plane: feste Antworten aller Rollen ergeben Exit 0 und eine phase.json, die pruefe und die Abdeckungsprüfung grün melden", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);
  exit(lauf, EXIT_GRUEN);
  assert.equal(werkzeug(lauf, AUFTRAG, "pruefe", phaseDatei(lauf)).status, EXIT_GRUEN);
  assert.equal(werkzeug(lauf, join(REPO_ROOT, "tools/abdeckung-pruefen.mjs"), join(lauf.wurzel, ORDNER)).status, EXIT_GRUEN);
  assert.deepEqual(readdirSync(join(lauf.wurzel, ORDNER, "planung")).toSorted(), ["entwuerfe.json", "erkundung-g1.json", "erkundung-g2.json", "erkundung-g3.json", "fingerabdruck.json", "gliederung.json", "pruefliste-aufteilung.json", "pruefliste.json", "schnitt.json", "wegpruefung-S1-1.json", "wegpruefung-S2-1.json", "wegpruefung-S4-1.json"]);
  assert.deepEqual(planungsBericht(lauf).auftraege.map(({ id }) => id), ["a0", "a1", "a2", "a3"]);
});

test("plane: „Zerlegung passt nicht“ mit gültigen Fundstellen endet mit Exit 3 ohne phase.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const zeile = `Zerlegung passt nicht: Dann widerspricht der Lösung (Fundstellen: pitch.md, ## Problem; design.md, ${LOESUNG})`;
  const lauf = plane(context, { "planer|## Gliederung": [zeile] });
  exit(lauf, EXIT_PASST_NICHT);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.equal(planungsBericht(lauf).grund, zeile);
});

test("plane: „Zerlegung passt nicht“ ohne gültige Fundstellen geht einmal an den Planer zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const ungueltig = "Zerlegung passt nicht: passt nicht (Fundstellen: pitch.md, ## Gibt es nicht; src/fehlt.js:3)";
  const lauf = plane(context, { "planer|## Gliederung": [ungueltig], "planer|## Befunde": [alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_GRUEN);
  const [rueckgabe] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(rueckgabe.eingabe.includes("src/fehlt.js ist keine Datei im Repo"));
});

test("plane: eine Gliederung mit doppelter Nummer geht einmal an den Planer zurück, danach wird grün geplant", { timeout: LAUF_FRIST_MS }, (context) => {
  const doppelt = [{ ...GRUPPEN[0], nummern: ["S1", "S7", "T2", "S4"] }, GRUPPEN[1], GRUPPEN[2]];
  const lauf = plane(context, { "planer|## Gliederung": [alsJson({ gruppen: doppelt })], "planer|## Befunde": [alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
  assert.ok(aufrufe(lauf, "planer", "## Befunde")[0].eingabe.includes("S4 steht in 2 Gruppen statt in genau einer"));
});

test("plane: ein Erkunderbericht mit erfundener Funktion geht genau einmal an den Erkunder zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const lauf = plane(context, { "erkunder|## Erkundung|S1": [erfunden], "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)] });
  exit(lauf, EXIT_GRUEN);
  const rueckgaben = aufrufe(lauf, "erkunder", "## Befunde");
  assert.equal(rueckgaben.length, 1);
  assert.ok(rueckgaben[0].eingabe.includes("Funktion gibtEsNicht fehlt in"));
  assert.equal(planungsBericht(lauf).ruecksendungen.erkunder, 1);
});

test("plane: ein Erkunderbericht, der seinen Befund behält, endet mit Exit 4 ohne phase.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const schnitt = alsJson({ schnitt: schnittliste(), antworten: [] });
  const lauf = plane(context, { "erkunder|## Erkundung|S1": [erfunden], "erkunder|## Befunde": [erfunden], "planer|## Befunde": [schnitt] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.ok(aufrufe(lauf, "planer", "## Zuschnitt")[0].eingabe.includes("Funktion gibtEsNicht fehlt in"));
  assert.ok(planungsBericht(lauf).befunde.offen.some((befund) => befund.includes("Regel Erkundung")));
});

test("plane: eine Nachfrage ohne neue Stelle beendet die Nachfragen zu ihren Nummern", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, {
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S4": [bericht(["S4"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [nachfrage] = aufrufe(lauf, "erkunder", "## Nachfrage");
  assert.ok(nachfrage.eingabe.includes("Wo liegt der Hinweis?"));
  assert.equal(nachfrage.resume, false);
  assert.ok(aufrufe(lauf, "planer", "## Zuschnitt")[1].eingabe.includes("Nachfragen zu S4 enden; schneide mit einer Annahme."));
});

test("plane: eine erneute Nachfrage zu ausgeschöpften Nummern bekommt die Ansage, und die nächste endet mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const nachfrage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
  const lauf = plane(context, { "planer|## Zuschnitt": [nachfrage, nachfrage, nachfrage], "erkunder|## Nachfrage|S4": [bericht(["S4"])] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 1);
  assert.equal(planungsBericht(lauf).grund, "Nachfragen nach der ersten Welle: S4");
});

const ZU_S1 = alsJson({ nachfragen: [{ nummern: ["S1"], frage: "Wo wird die Nummer gespeichert?" }] });
const ZU_S4 = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
const ERKUNDER_S1_S4 = { "erkunder|## Nachfrage|S1": [bericht(["S1"])], "erkunder|## Nachfrage|S4": [bericht(["S4"])] };
const ANSAGE = "### Ende der Nachfragen";

function nachgefragt(lauf) {
  return aufrufe(lauf, "erkunder", "## Nachfrage").map(({ eingabe }) => /^#### (\S+) \(/mu.exec(eingabe)[1]);
}

test("plane: eine zweite Nachfrage-Welle startet keinen Erkunder, der Planer bekommt die Ansage mit dem Lagebild und schneidet grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { ...ERKUNDER_S1_S4, "planer|## Zuschnitt": [ZU_S1, ZU_S4, alsJson({ schnitt: schnittliste() })] });
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(nachgefragt(lauf), ["S1"]);
  const { eingabe } = aufrufe(lauf, "planer", "## Zuschnitt")[2];
  for (const teil of [ANSAGE, "Nachfrage-Welle", "### Offene Punkte", "### Funktionsliste", "### Dateikarte"]) assert.ok(eingabe.includes(teil), `${teil} fehlt:\n${eingabe}`);
  assert.equal(eingabe.includes("### Antwort auf deine Nachfrage"), false, eingabe);
});

test("plane: fragt der Planer nach der Ansage noch einmal nach, endet plane mit Exit 4 nach nur einem Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { ...ERKUNDER_S1_S4, "planer|## Zuschnitt": [ZU_S1, ZU_S4, ZU_S4] });
  exit(lauf, EXIT_BEFUNDE);
  assert.deepEqual(nachgefragt(lauf), ["S1"]);
  assert.equal(planungsBericht(lauf).grund, "Nachfragen nach der ersten Welle: S4");
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: eine Nachfrage mit neuer Stelle beendet die Nachfragen nicht", { timeout: LAUF_FRIST_MS }, (context) => {
  const nachfrage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
  const anders = bericht(["S4"], { S4: { weg: [stelle("eingang", HINWEIS, { funktion: "nimmAnruf", von: 1, bis: 4 }), stelle("wirkung", ROUTE, { funktion: "speichereStatus", von: 10, bis: 14 })] } });
  const lauf = plane(context, { "planer|## Zuschnitt": [nachfrage, alsJson({ schnitt: schnittliste() })], "erkunder|## Nachfrage|S4": [anders] });
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "planer", "## Zuschnitt")[1].eingabe.includes("enden; schneide mit einer Annahme"), false);
});

test("plane: zwei Erkunder laufen gleichzeitig", { timeout: LAUF_FRIST_MS }, (context) => {
  const langsam = (nummern) => [{ text: bericht(nummern), warte: WARTEN_MS }];
  const lauf = plane(context, { "erkunder|## Erkundung|S1": langsam(GRUPPEN[0].nummern), "erkunder|## Erkundung|S2": langsam(GRUPPEN[1].nummern) });
  exit(lauf, EXIT_GRUEN);
  const langsame = aufrufe(lauf, "erkunder", "## Erkundung").filter(({ start, ende }) => ende - start >= WARTEN_MS);
  const [erster, zweiter] = langsame.toSorted((links, rechts) => links.start - rechts.start);
  assert.equal(langsame.length, 2);
  assert.ok(zweiter.start < erster.ende, `Startzeiten überlappen nicht: ${erster.start}-${erster.ende}, ${zweiter.start}`);
});

test("plane: der Zuschnitt setzt die Sitzung des Planers mit --resume fort, der Prüfer startet mit --session-id", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);
  exit(lauf, EXIT_GRUEN);
  const [gliederung] = aufrufe(lauf, "planer", "## Gliederung");
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  const [pruefung] = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(gliederung.resume, false);
  assert.equal(zuschnitt.resume, true);
  assert.equal(zuschnitt.sitzung, gliederung.sitzung);
  assert.equal(pruefung.resume, false);
  assert.notEqual(pruefung.sitzung, gliederung.sitzung);
});

test("plane: eine unvollständige Prüfliste geht genau einmal an den Prüfer zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer({ ...GRUEN_PRUEFLISTE, weglassen: ["gegenfrage:alle"] }), "pruefer-planung|## Befunde": [GRUEN_PRUEFLISTE] });
  exit(lauf, EXIT_GRUEN);
  const rueckgaben = aufrufe(lauf, "pruefer-planung", "## Befunde");
  assert.equal(rueckgaben.length, 1);
  assert.ok(rueckgaben[0].eingabe.includes("gegenfrage:alle: fehlt in der Prüfliste"));
});

test("plane: ein Prüferbefund ohne Antwort des Planers endet mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const befund = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a3": "a3 braucht den Status aus a2" } };
  const ohneAntwort = alsJson({ schnitt: schnittliste(), antworten: [] });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(befund), "planer|## Befunde": [ohneAntwort, ohneAntwort] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.ok(planungsBericht(lauf).befunde.offen.includes("allein-gruen:a3: Befund des Prüfers ohne Antwort des Planers"));
});
