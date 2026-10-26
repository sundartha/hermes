import assert from "node:assert/strict";
import { test } from "node:test";

import { GRUPPEN, HINWEIS, LAUF_FRIST_MS, alsJson, aufrufe, bericht, exit, planOrdner, schnittliste } from "./planung-probe.js";
import { EXIT_DECKEL, EXIT_GRUEN, HALT_VOR_DER_RUECKSENDUNG, OHNE_GRENZE, SCHNITT_SOFORT, mitDeckel, plane } from "./planung-plane-probe.js";

const ANRUF = GRUPPEN[1].nummern;
const NIMM_ANRUF_ZEILE = 1;
const SETZE_HINWEIS = { von: 6, bis: 9 };
const FUND = `Antwort der Erkundung: das Stundenlimit sitzt in setzeHinweis (Fundstelle: ${HINWEIS}:${SETZE_HINWEIS.von})`;
const WIEDERHOLT = `Antwort der Erkundung: der Test ruft nimmAnruf direkt (Fundstelle: ${HINWEIS}:${NIMM_ANRUF_ZEILE})`;
const ZU_S4 = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Welches Gate kann die Anruffolge stoppen?" }] });

function nachfrageNachErkundung(context, erkundung, weitere = {}) {
  return plane(context, {
    "erkunder|## Erkundung|S4": erkundung,
    "planer|## Zuschnitt": [ZU_S4, alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S4": [bericht(["S4"])],
    ...weitere,
  });
}

const OHNE_FUNKTION = { S4: { aenderungen: [{ datei: HINWEIS, funktion: "gibtEsNicht", ...SETZE_HINWEIS, neueZeilen: 3 }] } };

function erkundungMitRuecksendung() {
  return { erkundung: [bericht(ANRUF, OHNE_FUNKTION, [FUND, WIEDERHOLT])], weitere: { "erkunder|## Befunde": [bericht(ANRUF, {}, [WIEDERHOLT])] } };
}

function eingabeVon(lauf, agent, ueberschrift) {
  const [aufruf] = aufrufe(lauf, agent, ueberschrift);
  assert.ok(aufruf, `kein Aufruf ${agent} ${ueberschrift}`);
  return aufruf.eingabe;
}

test("plane: die Nachfrage-Nachricht enthält die Funde der Erkundung zu den gefragten Nummern mit Fundstellen", { timeout: LAUF_FRIST_MS }, (context) => {
  const { erkundung, weitere } = erkundungMitRuecksendung();
  const lauf = nachfrageNachErkundung(context, erkundung, weitere);
  exit(lauf, EXIT_GRUEN);
  assert.ok(eingabeVon(lauf, "erkunder", "## Befunde").includes("Funktion gibtEsNicht fehlt in"));
  const eingabe = eingabeVon(lauf, "erkunder", "## Nachfrage");
  assert.ok(eingabe.includes(FUND), eingabe);
});

test("plane: der Planer sieht die Funde der Erkundung auch nach einer Rücksendung an den Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const { erkundung, weitere } = erkundungMitRuecksendung();
  const lauf = nachfrageNachErkundung(context, erkundung, weitere);
  exit(lauf, EXIT_GRUEN);
  const eingabe = eingabeVon(lauf, "planer", "## Zuschnitt");
  assert.ok(eingabe.includes(FUND), eingabe);
});

function hinweisZeile(eingabe, hinweis) {
  const zeile = eingabe.split("\n").find((kandidat) => kandidat.startsWith("hinweis: ") && kandidat.includes(hinweis));
  assert.ok(zeile, eingabe);
  return zeile;
}

test("plane: Hinweise, die nur der erste Bericht der Erkundung hatte, sind bei Planer und Nachfrage als nicht bestätigt gekennzeichnet", { timeout: LAUF_FRIST_MS }, (context) => {
  const { erkundung, weitere } = erkundungMitRuecksendung();
  const lauf = nachfrageNachErkundung(context, erkundung, weitere);
  exit(lauf, EXIT_GRUEN);
  for (const eingabe of [eingabeVon(lauf, "erkunder", "## Nachfrage"), eingabeVon(lauf, "planer", "## Zuschnitt")]) {
    assert.match(hinweisZeile(eingabe, FUND), /^hinweis: aus dem ersten Bericht vor der Rücksendung, im zweiten nicht wiederholt: /u);
    assert.equal(hinweisZeile(eingabe, WIEDERHOLT), `hinweis: ${WIEDERHOLT}`);
  }
});

test("plane: die Nachfrage-Nachricht erlaubt, Fundstellen aus dem Bericht der Erkundung zu übernehmen, ohne sie neu zu lesen", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = nachfrageNachErkundung(context, [bericht(ANRUF, {}, [FUND])]);
  exit(lauf, EXIT_GRUEN);
  const eingabe = eingabeVon(lauf, "erkunder", "## Nachfrage");
  assert.match(eingabe, /Fundstellen aus diesem Bericht übernimmst du, statt die Stelle neu zu lesen/u, eingabe);
  assert.doesNotMatch(eingabe, /auch wenn sie hier schon steht/u, eingabe);
});

test("plane: ein Nachfrage-Bericht ohne Fundstelle wird weiter zurückgeschickt", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneFundstelle = bericht(["S4"], { S4: { schema: { aenderung: false } } });
  const lauf = nachfrageNachErkundung(context, [bericht(ANRUF, {}, [FUND])], { "erkunder|## Nachfrage|S4": [ohneFundstelle], "erkunder|## Befunde": [bericht(["S4"])] });
  exit(lauf, EXIT_GRUEN);
  const rueckgabe = eingabeVon(lauf, "erkunder", "## Befunde");
  assert.ok(rueckgabe.includes("S4: schema braucht eine Fundstelle"), rueckgabe);
});

test("plane --fortsetzen gibt die Hinweise der am Deckel abgelegten Nachfrage gekennzeichnet an den Planer weiter", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  const nachfrage = { "planer|## Zuschnitt": [ZU_S4], "erkunder|## Nachfrage|S4": [bericht(["S4"], OHNE_FUNKTION, [FUND])] };
  const angehalten = mitDeckel(context, wurzel, { argumente: ["--deckel", String(HALT_VOR_DER_RUECKSENDUNG)], ueberschrieben: nachfrage });
  exit(angehalten, EXIT_DECKEL);
  assert.equal(aufrufe(angehalten, "erkunder", "## Befunde").length, 0);
  const lauf = mitDeckel(context, wurzel, { argumente: ["--fortsetzen", "--deckel", OHNE_GRENZE], ueberschrieben: { ...SCHNITT_SOFORT, "erkunder|## Befunde": [bericht(["S4"])] } });
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 1);
  assert.match(hinweisZeile(eingabeVon(lauf, "planer", "## Zuschnitt"), FUND), /^hinweis: aus dem ersten Bericht vor der Rücksendung, im zweiten nicht wiederholt: /u);
});
