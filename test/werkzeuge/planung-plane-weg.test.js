import assert from "node:assert/strict";
import { test } from "node:test";

import { FUNDSTELLE, GRUEN_PRUEFLISTE, GRUPPEN, LAUF_FRIST_MS, ROUTE, alsJson, aufrufe, bericht, exit, schnittliste } from "./planung-probe.js";
import { EXIT_GRUEN, offenePunkte, plane, planungsBericht, prueflisteZeilen, WARTEN_MS, WEG_ZEILE, WEGFEHLER, wegfehlerLaufMitKorrektur, wegpruefungen } from "./planung-plane-probe.js";

test("plane: die Wegprüfung schickt einen Wegfehler an den Erkunder, der korrigierte Bericht erreicht den Planer, und weg bleibt in der Endprüfung", { timeout: LAUF_FRIST_MS }, (context) => {
  const hinweis = "S7 endet in speichereStatus";
  const lauf = wegfehlerLaufMitKorrektur(context, hinweis);
  const [rueckgabe, ...weitere] = aufrufe(lauf, "erkunder", "## Befunde");
  assert.equal(weitere.length, 0);
  assert.ok(rueckgabe.eingabe.includes(`weg:S7: der Weg endet nicht in speichereStatus (Fundstelle: ${FUNDSTELLE})`), rueckgabe.eingabe);
  const [erste, zweite] = wegpruefungen(lauf, "S1");
  assert.deepEqual([zweite.resume, zweite.sitzung], [true, erste.sitzung]);
  assert.ok(zweite.eingabe.includes(hinweis), zweite.eingabe);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt.eingabe.includes(`hinweis: ${hinweis}`), zuschnitt.eingabe);
  assert.equal(offenePunkte(zuschnitt).includes("Weg S7"), false);
  const zeilen = aufrufe(lauf, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen);
  for (const nummer of GRUPPEN.flatMap((gruppe) => gruppe.nummern)) assert.ok(zeilen.includes(`weg:${nummer}`), `weg:${nummer} fehlt in der Endprüfung`);
});

test("plane: die erste Wegprüfung bekommt Design Doc und Erkundungsbericht, die nach einer Korrektur nur den korrigierten Bericht", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = wegfehlerLaufMitKorrektur(context, "S7 endet in speichereStatus");
  const [erste, zweite] = wegpruefungen(lauf, "S1").map(({ eingabe }) => eingabe);
  const design = ["### Eingang laut Design Doc", "### Abschnitte des Design Docs"];
  for (const teil of [...design, "### Erkundungsbericht\n", "### Zeilen deiner Prüfliste"]) assert.ok(erste.includes(teil), teil);
  assert.equal(erste.includes("### Korrigierter Erkundungsbericht"), false, erste);
  for (const teil of ["### Korrigierter Erkundungsbericht\n", "### Zeilen deiner Prüfliste"]) assert.ok(zweite.includes(teil), teil);
  for (const teil of [...design, "### Erkundungsbericht\n"]) assert.equal(zweite.includes(teil), false, teil);
});

test("plane: ein Wegfehler, der bleibt, steht unter Offene Punkte und in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, WEGFEHLER], "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)] });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes(`- ${WEG_ZEILE}`), zuschnitt.eingabe);
  const [erste] = wegpruefungen(lauf, "S1");
  const beleg = planungsBericht(lauf);
  assert.deepEqual(beleg.wegpruefungen.find(({ nummern }) => nummern[0] === "S1"), { nummern: GRUPPEN[0].nummern, sitzung: erste.sitzung, runden: 2, offen: [WEG_ZEILE] });
  assert.ok(beleg.schleifen.some(({ art, ende }) => art === "weg" && ende?.startsWith("wiederkehrend")), JSON.stringify(beleg.schleifen));
  assert.ok(lauf.stdout.includes(`Wegprüfungen: ${JSON.stringify(beleg.wegpruefungen)}`), lauf.stdout);
  assert.ok(aufrufe(lauf, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen).includes("weg:S7"));
});

test("plane: fällt die Korrektur nach einem Wegfehler durch die Skriptprüfung, stehen ihre Befunde unter Offene Punkte und in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER], "erkunder|## Befunde": [erfunden, erfunden] });
  exit(lauf, EXIT_GRUEN);
  const verworfen = `Weg ${GRUPPEN[0].nummern.join(", ")}: Korrektur verworfen: `;
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  const zeilen = offenePunkte(zuschnitt).split("\n");
  assert.ok(zeilen.some((zeile) => zeile.startsWith(`- ${verworfen}`) && zeile.includes("gibtEsNicht")), zuschnitt.eingabe);
  assert.ok(zeilen.includes(`- ${WEG_ZEILE}`), zuschnitt.eingabe);
  const { offen } = planungsBericht(lauf).wegpruefungen.find(({ nummern }) => nummern[0] === "S1");
  assert.ok(offen.some((zeile) => zeile.startsWith(verworfen) && zeile.includes("gibtEsNicht")), JSON.stringify(offen));
});

test("plane: nach einer Nachfrage mit sauberer Wegprüfung steht der alte Wegfehler ihrer Nummer nicht mehr unter Offene Punkte", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, {
    "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, WEGFEHLER],
    "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)],
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S7"], frage: "Wo endet der Weg?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S7": [bericht(["S7"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes(`- ${WEG_ZEILE}`), zuschnitt.eingabe);
  assert.equal(offenePunkte(nachNachfrage).includes("Weg S7"), false, nachNachfrage.eingabe);
  assert.deepEqual(planungsBericht(lauf).wegpruefungen.find(({ nummern }) => nummern[0] === "S1").offen, [WEG_ZEILE]);
});

test("plane: nennen zwei Nachfragen dieselbe Nummer, gehört der offene Wegfehler zum übernommenen Bericht, auch wenn die frühere Wegprüfung zuletzt endet", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, {
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S7"], frage: "Wo endet der Weg?" }, { nummern: ["S1", "S7"], frage: "Wo beginnt der Weg?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S7": [bericht(["S7"])],
    "erkunder|## Nachfrage|S1": [bericht(["S1", "S7"])],
    "erkunder|## Befunde": [bericht(["S7"])],
    "pruefer-planung|## Wegprüfung|S7": [WEGFEHLER, { ...WEGFEHLER, warte: WARTEN_MS }],
    "pruefer-planung|## Wegprüfung|S1": [GRUEN_PRUEFLISTE, GRUEN_PRUEFLISTE],
  });
  exit(lauf, EXIT_GRUEN);
  const erstAbS7 = wegpruefungen(lauf, "S7").filter(({ eingabe }) => !eingabe.includes("#### S1 ("));
  const frueher = erstAbS7.at(-1);
  const spaeter = wegpruefungen(lauf, "S1").at(-1);
  assert.equal(erstAbS7.length, 2);
  assert.ok(frueher.ende > spaeter.ende, `die Wegprüfung der früheren Nachfrage endet nicht zuletzt: ${frueher.ende}, ${spaeter.ende}`);
  const [, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.equal(offenePunkte(nachNachfrage).includes("Weg S7"), false, nachNachfrage.eingabe);
});

test("plane: eine Wegprüfliste, die nach der Rücksendung unvollständig bleibt, steht unter Offene Punkte", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneZeile = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S7"] };
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [ohneZeile], "pruefer-planung|## Befunde": [ohneZeile] });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes("- Weg S1, S7, T2: weg:S7: fehlt in der Prüfliste"), zuschnitt.eingabe);
});

test("plane: eine fehlende Wegzeile bleibt nach einer sauberen Nachfrage zu einer anderen Nummer der Gruppe offen und fällt mit der sauberen Nachfrage zu ihrer Nummer weg", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneZeile = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S7"] };
  const fehlt = "- Weg S1, S7, T2: weg:S7: fehlt in der Prüfliste";
  const lauf = plane(context, {
    "pruefer-planung|## Wegprüfung|S1": [ohneZeile, GRUEN_PRUEFLISTE],
    "pruefer-planung|## Befunde": [ohneZeile],
    "planer|## Zuschnitt": [
      alsJson({ nachfragen: [{ nummern: ["S1"], frage: "Wo beginnt der Weg?" }] }),
      alsJson({ nachfragen: [{ nummern: ["S7"], frage: "Wo endet der Weg?" }] }),
      alsJson({ schnitt: schnittliste() }),
    ],
    "erkunder|## Nachfrage|S1": [bericht(["S1"])],
    "erkunder|## Nachfrage|S7": [bericht(["S7"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachS1, nachS7] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes(fehlt), zuschnitt.eingabe);
  assert.ok(offenePunkte(nachS1).includes(fehlt), nachS1.eingabe);
  assert.equal(offenePunkte(nachS7).includes("weg:S7: fehlt in der Prüfliste"), false, nachS7.eingabe);
});

test("plane: eine verworfene Korrektur der Gruppe fällt mit der sauberen Nachfrage zu einer ihrer Nummern weg, der Wegfehler einer anderen Nummer bleibt", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const lauf = plane(context, {
    "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER],
    "erkunder|## Befunde": [erfunden, erfunden],
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["T2"], frage: "Wo wird die Nummer gespeichert?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|T2": [bericht(["T2"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes("Korrektur verworfen"), zuschnitt.eingabe);
  assert.equal(offenePunkte(nachNachfrage).includes("Korrektur verworfen"), false, nachNachfrage.eingabe);
  assert.ok(offenePunkte(nachNachfrage).includes(`- ${WEG_ZEILE}`), nachNachfrage.eingabe);
});

test("plane: ein Wegbefund in einer unvollständigen Wegprüfliste steht unter Offene Punkte und in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const befundOhneZeile = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S7"], befunde: { "weg:T2": "der Weg endet nicht im Speicher" } };
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [befundOhneZeile], "pruefer-planung|## Befunde": [befundOhneZeile] });
  exit(lauf, EXIT_GRUEN);
  const wegbefund = `Weg T2: der Weg endet nicht im Speicher (Fundstelle: ${FUNDSTELLE})`;
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  for (const zeile of ["Weg S1, S7, T2: weg:S7: fehlt in der Prüfliste", wegbefund]) assert.ok(offenePunkte(zuschnitt).includes(`- ${zeile}`), zuschnitt.eingabe);
  const { offen } = planungsBericht(lauf).wegpruefungen.find(({ nummern }) => nummern[0] === "S1");
  assert.ok(offen.includes(wegbefund), JSON.stringify(offen));
});
