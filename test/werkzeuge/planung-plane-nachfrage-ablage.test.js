import assert from "node:assert/strict";
import { appendFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUPPEN, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, angaben, aufrufe, bericht, exit, planOrdner, planeIn, schnittliste } from "./planung-probe.js";
import { AUFTRAG, EXIT_GRUEN, SCHNITT_SOFORT, plane, planeAntworten, planungsBericht, wegpruefungen } from "./planung-plane-probe.js";

const EXIT_DECKEL = 5;
const NACHGEFRAGT = ["S1", "S2"];
const ROLLEN_TOKEN = { planer: 100_000, erkunder: 1_000_000, "pruefer-planung": 340_000, entwurf: 100_000 };
const ERKUNDER_MIT_WEG = ROLLEN_TOKEN.erkunder + ROLLEN_TOKEN["pruefer-planung"];
const BIS_ZUR_NACHFRAGE = 2 * ROLLEN_TOKEN.planer + GRUPPEN.length * ERKUNDER_MIT_WEG;
const HALT_VOR_DER_RUECKSENDUNG = BIS_ZUR_NACHFRAGE + 1.5 * ROLLEN_TOKEN.erkunder;
const OHNE_GRENZE = String(1_000_000_000);
const MARKE = "Bezahlter Bericht der Nachfrage";
const BEFUND = "Funktion gibtEsNicht fehlt in";
const ANTWORT = "### Antwort auf deine Nachfrage 1";
const ERFUNDEN = { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] };
const MIT_BEFUND = alsJson({ nummern: Object.fromEntries(NACHGEFRAGT.map((nummer) => [nummer, angaben(nummer, ERFUNDEN)])), hinweise: [MARKE] });
const FRAGEN = alsJson({ nachfragen: NACHGEFRAGT.map((nummer) => ({ nummern: [nummer], frage: `Wo endet ${nummer}?` })) });
const ZUSCHNITT = { "planer|## Zuschnitt": [FRAGEN, alsJson({ schnitt: schnittliste() })] };
const ERSTE_NACHFRAGE = { ...ZUSCHNITT, "erkunder|## Nachfrage|S1": [MIT_BEFUND] };

function mitDeckel(context, wurzel, { argumente, ueberschrieben }) {
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER, ...argumente], token: ROLLEN_TOKEN });
}

function vorDerRuecksendungAngehalten(context) {
  const lauf = mitDeckel(context, planOrdner(context), { argumente: ["--deckel", String(HALT_VOR_DER_RUECKSENDUNG)], ueberschrieben: ERSTE_NACHFRAGE });
  exit(lauf, EXIT_DECKEL);
  assert.match(planungsBericht(lauf).deckelSchritt, /^Rücksendung an erkunder \(S1, S2\)$/);
  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 0);
  return lauf;
}

function fortgesetzt(context, { wurzel }, ueberschrieben) {
  const lauf = mitDeckel(context, wurzel, { argumente: ["--fortsetzen", "--deckel", OHNE_GRENZE], ueberschrieben });
  exit(lauf, EXIT_GRUEN);
  return lauf;
}

function abgelegteNachfrage({ wurzel }) {
  const ablage = join(wurzel, ORDNER, "planung");
  const dateien = readdirSync(ablage).map((name) => join(ablage, name)).filter((datei) => readFileSync(datei, "utf8").includes(MARKE));
  assert.equal(dateien.length, 1, `keine einzige Datei in planung/ mit dem bezahlten Bericht: ${readdirSync(ablage).join(", ")}`);
  return dateien[0];
}

function rueckgabeImFortsetzen(lauf) {
  const ruecksendungen = aufrufe(lauf, "erkunder", "## Befunde");
  assert.equal(ruecksendungen.length, 1, "plane --fortsetzen schickt den abgelegten Bericht nicht genau einmal zurück");
  return ruecksendungen[0];
}

function ersterZuschnitt(lauf) {
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt, "der Planer bekommt keinen Zuschnitt");
  return zuschnitt;
}

function eintragMit(wert, passt) {
  if (Array.isArray(wert)) return wert.find((eintrag) => eintragMit(eintrag, passt) !== undefined);
  if (wert === null || typeof wert !== "object") return undefined;
  return passt(wert) ? wert : Object.values(wert).find((eintrag) => eintragMit(eintrag, passt) !== undefined);
}

function welleNeu(lauf) {
  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 0);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 1);
  const [vorher, nachher] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.equal(vorher.eingabe.includes(ANTWORT), false, vorher.eingabe);
  assert.ok(nachher.eingabe.includes(ANTWORT), nachher.eingabe);
}

test("plane: hält der Deckel vor der Rücksendung an den Nachfrage-Erkunder, liegen der bezahlte Bericht und seine Befunde in planung/", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = vorDerRuecksendungAngehalten(context);

  const abgelegt = readFileSync(abgelegteNachfrage(lauf), "utf8");
  assert.ok(abgelegt.includes(BEFUND), abgelegt);
  assert.ok(abgelegt.includes("Wo endet S2?"), abgelegt);
  assert.equal(JSON.parse(readFileSync(join(lauf.wurzel, ORDNER, "planung", "nachfragen.json"), "utf8")).length, 0);
});

test("plane: die Befunde, die eine Rücksendung auslösen, stehen im Planbericht und im Log", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { ...ERSTE_NACHFRAGE, "erkunder|## Befunde": [bericht(NACHGEFRAGT)] });
  exit(lauf, EXIT_GRUEN);

  const eintrag = eintragMit(planungsBericht(lauf), (wert) => wert.rolle === "erkunder" && JSON.stringify(wert.nummern) === JSON.stringify(NACHGEFRAGT) && JSON.stringify(wert).includes(BEFUND));
  assert.ok(eintrag, JSON.stringify(planungsBericht(lauf), null, 2));
  assert.ok(`${lauf.stdout}${lauf.stderr}`.includes(BEFUND), `${lauf.stdout}\n${lauf.stderr}`);
});

test("plane --fortsetzen schickt den abgelegten Nachfrage-Bericht mit seinen Befunden an einen Erkunder und fragt den Planer nicht neu", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = fortgesetzt(context, vorDerRuecksendungAngehalten(context), { ...SCHNITT_SOFORT, "erkunder|## Befunde": [bericht(NACHGEFRAGT)] });

  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 0);
  const rueckgabe = rueckgabeImFortsetzen(lauf);
  for (const teil of [BEFUND, MARKE, "Wo endet S1?", "Wo endet S2?"]) assert.ok(rueckgabe.eingabe.includes(teil), `${teil} fehlt:\n${rueckgabe.eingabe}`);
  assert.equal(rueckgabe.resume, false);
  const planer = aufrufe(lauf, "planer");
  assert.equal(planer.length, 1);
  assert.ok(rueckgabe.ende <= planer[0].start, "der Planer läuft vor der Rücksendung");
  assert.ok(planer[0].eingabe.includes(ANTWORT), planer[0].eingabe);
  assert.equal(planer[0].eingabe.includes(BEFUND), false, planer[0].eingabe);
  assert.equal(wegpruefungen(lauf, "S1").length, 1);
});

test("plane --fortsetzen prüft den Bericht nach der Rücksendung wie jeden Nachfrage-Bericht", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = fortgesetzt(context, vorDerRuecksendungAngehalten(context), { ...SCHNITT_SOFORT, "erkunder|## Befunde": [MIT_BEFUND] });

  rueckgabeImFortsetzen(lauf);
  assert.equal(wegpruefungen(lauf, "S1").length, 0);
  const { eingabe } = ersterZuschnitt(lauf);
  assert.ok(eingabe.includes("Nachfragen zu S1, S2 enden; schneide mit einer Annahme."), eingabe);
  assert.ok(eingabe.includes(BEFUND), eingabe);
});

test("plane --fortsetzen macht die Welle neu, wenn der abgelegte Nachfrage-Bericht fehlt", { timeout: LAUF_FRIST_MS }, (context) => {
  const angehalten = vorDerRuecksendungAngehalten(context);
  rmSync(abgelegteNachfrage(angehalten));

  welleNeu(fortgesetzt(context, angehalten, { ...ZUSCHNITT, "erkunder|## Nachfrage|S1": [bericht(NACHGEFRAGT)] }));
});

test("plane --fortsetzen macht die Welle neu, wenn der abgelegte Nachfrage-Bericht nicht zum Fingerabdruck passt", { timeout: LAUF_FRIST_MS }, (context) => {
  const angehalten = vorDerRuecksendungAngehalten(context);
  appendFileSync(abgelegteNachfrage(angehalten), "\n");

  welleNeu(fortgesetzt(context, angehalten, { ...ZUSCHNITT, "erkunder|## Nachfrage|S1": [bericht(NACHGEFRAGT)] }));
});
