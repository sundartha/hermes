import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_GRUEN, planeAntworten, planungsBericht, teilEintrag } from "./planung-plane-probe.js";
import { BIS_ZUM_ABBRUCH, GRUEN_PRUEFLISTE, MIT_DEM_ERGEBNIS, GRUPPEN, HINTERLEGEN_NUMMERN, HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, bericht, exit, nachrichtenJeAufruf, planOrdner, planeIn } from "./planung-probe.js";

const EXIT_DECKEL = 5;
const TAUSEND = 1000;
const ALT = 10 * TAUSEND;
const ZUWACHS = 10 * TAUSEND;
const NACHRICHTEN = 10;
const STEIGEND = Array.from({ length: NACHRICHTEN }, (_, stelle) => (stelle + 2) * ZUWACHS);
const DECKEL = 135 * TAUSEND;
const DECKEL_IN_DER_PRUEFLISTE = 425 * TAUSEND;
const DECKEL_IM_ZUSCHNITT = 280 * TAUSEND;
const ZUSCHNITT_MIT_DEM_ERGEBNIS = [2 * ZUWACHS, 3 * ZUWACHS, MIT_DEM_ERGEBNIS, 10 * ZUWACHS];
const ZUSCHNITT = ZUSCHNITT_MIT_DEM_ERGEBNIS.filter(Number.isFinite).reduce((summe, groesse) => summe + groesse, 0);
const GLIEDERUNG_UND_ERKUNDUNG = 5 * ALT;
const GLIEDERUNG_UND_ZUSCHNITT = 2;
const DECKEL_IM_ENTWURF = 300 * TAUSEND;
const ENTWURF_HINWEIS = `entwurf|## Entwurf|${HINWEIS}`;
const ENTWURF_ROUTE_MIT_DEM_ERGEBNIS = [{ nachDemEndeVon: ENTWURF_HINWEIS }, ...ZUSCHNITT_MIT_DEM_ERGEBNIS];
const BEIDE_ENTWUERFE = 2;
const ZWEI_NACHRICHTEN = 2;
const GLIEDERUNG_ERKUNDER_S1_WEGPRUEFUNG = ALT + ALT + ALT;
const DREI_NACHRICHTEN = 3;
const DECKEL_OHNE_WIRKUNG = String(1000 * TAUSEND * TAUSEND);
const ALTER_MODUS = { planer: ALT, erkunder: ALT, "pruefer-planung": ALT, entwurf: ALT };
const ERKUNDUNG_S1 = "erkunder|## Erkundung|S1";
const ERKUNDUNG_S4 = "erkunder|## Erkundung|S4";
const NACH_DER_WEGPRUEFUNG = { nachDemEndeVon: "pruefer-planung|## Wegprüfung" };
const MARKE = "Antwort des abgebrochenen Agenten";
const ABBRUCH = /Deckel (\d+) Token: gemessen (\d+), live (\d+), Vorhalt (\d+)/;
const ALLE_NUMMERN = GRUPPEN.flatMap(({ nummern }) => nummern);
const EINE_GRUPPE = { "planer|## Gliederung": [alsJson({ gruppen: [{ ...GRUPPEN[0], nummern: ALLE_NUMMERN }] })], "erkunder|## Erkundung|S1": [bericht(ALLE_NUMMERN)] };
const WEG_BEFUND = "der Weg endet nicht in speichereStatus";
const HALT_ZEILE = `Weg ${ALLE_NUMMERN.join(", ")}: die Wegprüfung blieb unvollständig, weil plane am Kostendeckel anhielt`;
const HINTERLEGEN = { ...GRUPPEN[0], nummern: HINTERLEGEN_NUMMERN, eingang: "POST /api/self-service/private-number" };
const BESTAETIGEN = { ...GRUPPEN[0], nummern: GRUPPEN[0].nummern.filter((nummer) => !HINTERLEGEN_NUMMERN.includes(nummer)), eingang: "POST /api/self-service/private-number/confirm" };
const TEILUNG = alsJson({
  teile: [
    teilEintrag("t1", "eigene-nummer", { nummern: ["S1", "S2", "S3", "S6", "S7"], tWege: ["T1", "T2"], dateien: [ROUTE] }),
    teilEintrag("t2", "hinweis-beim-anruf", { nummern: ["S4", "S5", "B1"], dateien: [HINWEIS], abhaengigVon: ["t1"] }),
  ],
});
const KLEIN = [5 * TAUSEND, 7 * TAUSEND];
const KLEIN_JE_AUFRUF = KLEIN.reduce((summe, groesse) => summe + groesse, 0);
const IN_JEDER_ROLLE_KLEIN = { planer: KLEIN, erkunder: KLEIN, "pruefer-planung": KLEIN, entwurf: KLEIN };
const AUFRUFE_IM_GRUENEN_LAUF = 11;
const PARALLELE_PRUEFER = 3;
const DECKEL_VOR_DER_PLANUNG = 125 * TAUSEND;
const NEUNTES_SZENARIO = "\n### Szenario B2: Hinweis an einen Kunden ohne hinterlegte Nummer\nGegeben ein Kunde ohne hinterlegte Nummer\nWenn sein Agent mit `place_call` eine Nummer anruft\nDann ist der erste Satz der Text aus `LOCALES.de.disclosure`\n";

function planeMit(context, wurzel, { deckel, token, ueberschrieben = {}, fortsetzen = false }) {
  const argumente = ["plane", ORDNER, ...(fortsetzen ? ["--fortsetzen"] : []), "--deckel", String(deckel)];
  return planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente, token });
}

function planungsDatei({ wurzel }, name) {
  return JSON.parse(readFileSync(join(wurzel, ORDNER, "planung", name), "utf8"));
}

function abbruchMeldung(lauf, deckel) {
  const { grund } = planungsBericht(lauf);
  const [, genannt, gemessen, live, vorhalt] = ABBRUCH.exec(grund) ?? assert.fail(grund);
  assert.equal(Number(genannt), deckel, grund);
  assert.ok(Number(gemessen) + Number(live) + Number(vorhalt) > deckel, grund);
  return grund;
}

function bisZumAbbruch(anzahl) {
  return [...STEIGEND.slice(0, anzahl), BIS_ZUM_ABBRUCH, ...STEIGEND.slice(anzahl)];
}

function abgebrochenNach(lauf, schluessel, erwartet) {
  const geschrieben = nachrichtenJeAufruf(lauf, schluessel);
  assert.ok(geschrieben.length > 0, `${schluessel} hat nichts ins Transkript geschrieben`);
  for (const anzahl of geschrieben) assert.equal(anzahl, erwartet, `${schluessel}: ${anzahl} von ${NACHRICHTEN} Nachrichten, Abbruch nach ${erwartet} erwartet`);
  return geschrieben;
}

function summeDerErsten(anzahl) {
  return STEIGEND.slice(0, anzahl).reduce((summe, groesse) => summe + groesse, 0);
}

function abbruchInDerErstenWelle(context) {
  const ueberschrieben = { [ERKUNDUNG_S4]: [bericht(GRUPPEN[1].nummern, { S4: { ownerEntscheidung: MARKE } })] };
  const token = { ...ALTER_MODUS, [ERKUNDUNG_S4]: [NACH_DER_WEGPRUEFUNG, ...bisZumAbbruch(DREI_NACHRICHTEN)] };
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL, token, ueberschrieben });
  exit(lauf, EXIT_DECKEL);
  const [geschrieben] = abgebrochenNach(lauf, ERKUNDUNG_S4, DREI_NACHRICHTEN);
  return { lauf, geschrieben };
}

function abbruchInDerKorrektur(context) {
  const mitWegbefund = { ...EINE_GRUPPE, "pruefer-planung|## Wegprüfung|S1": [{ ...GRUEN_PRUEFLISTE, befunde: { "weg:S1": WEG_BEFUND } }], "erkunder|## Befunde": [bericht(ALLE_NUMMERN)] };
  const gestoppt = planeMit(context, planOrdner(context), { deckel: DECKEL, token: { ...ALTER_MODUS, "erkunder|## Befunde": bisZumAbbruch(DREI_NACHRICHTEN) }, ueberschrieben: mitWegbefund });
  exit(gestoppt, EXIT_DECKEL);
  abgebrochenNach(gestoppt, "erkunder|## Befunde", DREI_NACHRICHTEN);
  abbruchMeldung(gestoppt, DECKEL);
  return gestoppt;
}

function inhalteDerAblage({ wurzel }) {
  const ablage = join(wurzel, ORDNER, "planung");
  return readdirSync(ablage).map((name) => readFileSync(join(ablage, name), "utf8"));
}

test("plane --deckel: bricht laufende Erkunder ab, sobald der laufende Verbrauch mit Vorhalt den Deckel überschreiten würde, und endet mit Exit 5", { timeout: LAUF_FRIST_MS }, (context) => {
  const token = { ...ALTER_MODUS, [ERKUNDUNG_S1]: bisZumAbbruch(ZWEI_NACHRICHTEN), [ERKUNDUNG_S4]: bisZumAbbruch(ZWEI_NACHRICHTEN) };
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL, token });

  exit(lauf, EXIT_DECKEL);
  abgebrochenNach(lauf, ERKUNDUNG_S4, ZWEI_NACHRICHTEN);
  abgebrochenNach(lauf, ERKUNDUNG_S1, ZWEI_NACHRICHTEN);
  const grund = abbruchMeldung(lauf, DECKEL);
  assert.ok(grund.includes("„Erkundung“"), grund);
  assert.ok(planungsBericht(lauf).token <= DECKEL + ZUWACHS, `gemessen ${planungsBericht(lauf).token}`);
  assert.equal(planungsBericht(lauf).token, ALT + ZWEI_NACHRICHTEN * summeDerErsten(ZWEI_NACHRICHTEN));
  assert.equal(planungsBericht(lauf).deckelSchritt, "Erkundung");
});

test("plane --deckel: der Abbruch erreicht alle laufenden Agenten der Welle", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL_IN_DER_PRUEFLISTE, token: { ...ALTER_MODUS, "pruefer-planung|## Prüfung": bisZumAbbruch(DREI_NACHRICHTEN) } });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "pruefer-planung", "## Prüfung").length, PARALLELE_PRUEFER);
  assert.equal(abgebrochenNach(lauf, "pruefer-planung|## Prüfung", DREI_NACHRICHTEN).length, PARALLELE_PRUEFER);
  abbruchMeldung(lauf, DECKEL_IN_DER_PRUEFLISTE);
  assert.deepEqual(aufrufe(lauf, "entwurf"), []);
});

test("plane --deckel: die Antwort eines abgebrochenen Agenten wird nie als Ergebnis gewertet", { timeout: LAUF_FRIST_MS }, (context) => {
  const ueberschrieben = { [ERKUNDUNG_S4]: [bericht(["S4", "S5"])], "erkunder|## Befunde": [bericht(GRUPPEN[1].nummern, { S4: { ownerEntscheidung: MARKE } })] };
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL, token: { ...ALTER_MODUS, "erkunder|## Befunde": bisZumAbbruch(DREI_NACHRICHTEN) }, ueberschrieben });

  exit(lauf, EXIT_DECKEL);
  assert.equal(aufrufe(lauf, "erkunder", "## Befunde").length, 1);
  abgebrochenNach(lauf, "erkunder|## Befunde", DREI_NACHRICHTEN);
  assert.deepEqual(Object.keys(planungsDatei(lauf, "erkundung-g2.json").nummern), ["S4", "S5"]);
  for (const inhalt of inhalteDerAblage(lauf)) assert.ok(!inhalt.includes(MARKE), inhalt);
  assert.ok(!JSON.stringify(planungsBericht(lauf)).includes(MARKE));
});

test("plane --deckel: bricht ein Erkunder der ersten Welle vor seinem ersten Bericht ab, bleiben die Berichte der anderen erhalten und --fortsetzen erkundet nur seine Gruppe neu", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf: gestoppt } = abbruchInDerErstenWelle(context);
  assert.deepEqual(Object.keys(planungsDatei(gestoppt, "erkundung-g1.json").nummern), GRUPPEN[0].nummern);
  assert.deepEqual(planungsDatei(gestoppt, "erkundung-g2.json").nummern, {});
  for (const inhalt of inhalteDerAblage(gestoppt)) assert.ok(!inhalt.includes(MARKE), inhalt);

  const lauf = planeMit(context, gestoppt.wurzel, { deckel: DECKEL_OHNE_WIRKUNG, token: ALTER_MODUS, fortsetzen: true });

  exit(lauf, EXIT_GRUEN);
  const erkunder = aufrufe(lauf, "erkunder");
  assert.deepEqual(erkunder.map(({ ueberschrift }) => ueberschrift), ["## Erkundung"]);
  assert.match(erkunder[0].eingabe, /^#### S4 \(/m);
  assert.doesNotMatch(erkunder[0].eingabe, /^#### S1 \(/m);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "phase.json")), true);
});

test("plane --deckel: nach einem Abbruch in der Korrektur nach der Wegprüfung übernimmt --fortsetzen den bezahlten Stand und startet keinen bezahlten Lauf neu", { timeout: LAUF_FRIST_MS }, (context) => {
  const gestoppt = abbruchInDerKorrektur(context);

  const lauf = planeMit(context, gestoppt.wurzel, { deckel: DECKEL_OHNE_WIRKUNG, token: ALTER_MODUS, ueberschrieben: EINE_GRUPPE, fortsetzen: true });

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung", "## Wegprüfung"), []);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt.eingabe.includes(`Weg S1: ${WEG_BEFUND}`), zuschnitt.eingabe);
  assert.ok(zuschnitt.eingabe.includes(HALT_ZEILE), zuschnitt.eingabe);
});

test("plane --deckel: bricht der Deckel nur den Wegprüfer einer Stelle ab, zählt der fertige Erkunder dieser Stelle im Mittel je Lauf mit", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL, token: { ...ALTER_MODUS, "pruefer-planung|## Wegprüfung": bisZumAbbruch(DREI_NACHRICHTEN) }, ueberschrieben: EINE_GRUPPE });

  exit(lauf, EXIT_DECKEL);
  abgebrochenNach(lauf, "pruefer-planung|## Wegprüfung", DREI_NACHRICHTEN);
  abbruchMeldung(lauf, DECKEL);
  const { kostenJeLauf } = planungsBericht(lauf);
  assert.equal(kostenJeLauf.erkunder?.laeufe, 1, JSON.stringify(kostenJeLauf));
  assert.equal(kostenJeLauf.wegpruefer, undefined, JSON.stringify(kostenJeLauf));
});

test("plane --deckel: bricht der Deckel die Korrektur eines Erkunders nach der Wegprüfung ab, zählt dieser Erkunder nicht in das Mittel je Lauf", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = abbruchInDerKorrektur(context);

  const { kostenJeLauf, token } = planungsBericht(lauf);
  assert.equal(token, GLIEDERUNG_ERKUNDER_S1_WEGPRUEFUNG + summeDerErsten(DREI_NACHRICHTEN));
  assert.equal(kostenJeLauf.erkunder, undefined, JSON.stringify(kostenJeLauf));
  assert.equal(kostenJeLauf.wegpruefer?.laeufe, 1, JSON.stringify(kostenJeLauf));
});

test("plane --deckel: ein abgebrochener Lauf zählt nicht in das Mittel je Lauf in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const { lauf, geschrieben } = abbruchInDerErstenWelle(context);

  const { kostenJeLauf, token } = planungsBericht(lauf);
  const abgebrochen = summeDerErsten(geschrieben);
  assert.equal(token, GLIEDERUNG_ERKUNDER_S1_WEGPRUEFUNG + abgebrochen);
  assert.equal(kostenJeLauf.erkunder.laeufe, 1);
  assert.equal(kostenJeLauf.erkunder.token, ALT + abgebrochen);
  assert.equal(kostenJeLauf.wegpruefer.laeufe, 1);
});

test("plane --deckel: auch in der Teilung nach der Gliederung bricht der laufende Verbrauch den Planer ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const ueberschrieben = { "planer|## Gliederung": [alsJson({ gruppen: [HINTERLEGEN, BESTAETIGEN, GRUPPEN[1]] })], "planer|## Teilung": [TEILUNG] };
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL, token: { ...ALTER_MODUS, "planer|## Teilung": bisZumAbbruch(DREI_NACHRICHTEN) }, ueberschrieben });

  exit(lauf, EXIT_DECKEL);
  abgebrochenNach(lauf, "planer|## Teilung", DREI_NACHRICHTEN);
  const grund = abbruchMeldung(lauf, DECKEL);
  assert.ok(grund.includes("„Teilung nach der Gliederung“"), grund);
  assert.equal(planungsBericht(lauf).deckelSchritt, "Teilung nach der Gliederung");
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", "teile.json")), false);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
});

test("plane --deckel: der Planer der Teilung vor der Planung wird am Deckel abgebrochen", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  appendFileSync(join(wurzel, ORDNER, "pitch.md"), NEUNTES_SZENARIO);
  const lauf = planeMit(context, wurzel, { deckel: DECKEL_VOR_DER_PLANUNG, token: { ...ALTER_MODUS, "planer|## Teilung": bisZumAbbruch(DREI_NACHRICHTEN) }, ueberschrieben: { "planer|## Teilung": [TEILUNG] } });

  exit(lauf, EXIT_DECKEL);
  abgebrochenNach(lauf, "planer|## Teilung", DREI_NACHRICHTEN);
  const grund = abbruchMeldung(lauf, DECKEL_VOR_DER_PLANUNG);
  assert.ok(grund.includes("„Teilung vor der Planung“"), grund);
  assert.equal(planungsBericht(lauf).deckelSchritt, "Teilung vor der Planung");
  assert.equal(planungsBericht(lauf).token, summeDerErsten(DREI_NACHRICHTEN));
  assert.ok(planungsBericht(lauf).token <= DECKEL_VOR_DER_PLANUNG + ZUWACHS, `gemessen ${planungsBericht(lauf).token}`);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", "teile.json")), false);
  assert.deepEqual(aufrufe(lauf, "planer", "## Gliederung"), []);
  assert.deepEqual(aufrufe(lauf, "erkunder"), []);
});

test("plane --deckel: liefert ein Agent sein Ergebnis mit der Nachricht, die den Deckel erreicht, startet plane keine weitere Welle, endet mit Exit 5 und zählt den Lauf ins Mittel", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL_IM_ZUSCHNITT, token: { ...ALTER_MODUS, "planer|## Zuschnitt": ZUSCHNITT_MIT_DEM_ERGEBNIS } });

  exit(lauf, EXIT_DECKEL);
  const grund = abbruchMeldung(lauf, DECKEL_IM_ZUSCHNITT);
  assert.ok(grund.includes("„Antwort des Planers (zuschnitt)“"), grund);
  assert.deepEqual(nachrichtenJeAufruf(lauf, "planer|## Zuschnitt"), [ZUSCHNITT_MIT_DEM_ERGEBNIS.length - 1]);
  assert.deepEqual(aufrufe(lauf, "pruefer-planung", "## Prüfung"), []);
  assert.deepEqual(aufrufe(lauf, "entwurf"), []);
  const { kostenJeLauf, token } = planungsBericht(lauf);
  assert.equal(token, GLIEDERUNG_UND_ERKUNDUNG + ZUSCHNITT);
  assert.equal(kostenJeLauf.planer.laeufe, GLIEDERUNG_UND_ZUSCHNITT);
  assert.equal(kostenJeLauf.planer.token, ALT + ZUSCHNITT);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "phase.json")), false);
});

test("plane --deckel: liefert in der letzten Welle ein Agent sein Ergebnis mit der Nachricht, die den Deckel erreicht, endet plane trotzdem mit Exit 5", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL_IM_ENTWURF, token: { ...ALTER_MODUS, [`entwurf|## Entwurf|${ROUTE}`]: ENTWURF_ROUTE_MIT_DEM_ERGEBNIS } });

  exit(lauf, EXIT_DECKEL);
  const grund = abbruchMeldung(lauf, DECKEL_IM_ENTWURF);
  assert.ok(grund.includes("„Entwurfs-Welle“"), grund);
  assert.deepEqual(nachrichtenJeAufruf(lauf, `entwurf|## Entwurf|${ROUTE}`), [ZUSCHNITT_MIT_DEM_ERGEBNIS.length - 1]);
  assert.equal(planungsBericht(lauf).kostenJeLauf.entwurf.laeufe, BEIDE_ENTWUERFE);
});

test("plane --deckel: planung.json nennt je Welle den live gezählten und den gemessenen Verbrauch", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = planeMit(context, planOrdner(context), { deckel: DECKEL_OHNE_WIRKUNG, token: IN_JEDER_ROLLE_KLEIN });

  exit(lauf, EXIT_GRUEN);
  const { wellen, token } = planungsBericht(lauf);
  assert.deepEqual(wellen.map(({ schritt }) => schritt), ["Antwort des Planers (gliederung)", "Erkundung", "Antwort des Planers (zuschnitt)", "Prüfliste", "Entwurfs-Welle"]);
  for (const welle of wellen) assert.ok(welle.gemessen > 0 && welle.live === welle.gemessen, JSON.stringify(welle));
  assert.equal(wellen.reduce((summe, { gemessen }) => summe + gemessen, 0), token);
});

test("plane --deckel: bleibt der laufende Verbrauch mit Vorhalt unter dem Deckel, bricht plane keinen Agenten ab und plant grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const gesamt = AUFRUFE_IM_GRUENEN_LAUF * KLEIN_JE_AUFRUF;
  const deckel = gesamt + PARALLELE_PRUEFER * Math.max(...KLEIN);
  const lauf = planeMit(context, planOrdner(context), { deckel, token: IN_JEDER_ROLLE_KLEIN });

  exit(lauf, EXIT_GRUEN);
  assert.equal(planungsBericht(lauf).token, gesamt);
  assert.equal(planungsBericht(lauf).deckelSchritt, undefined);
  const geschrieben = Object.keys(planeAntworten()).flatMap((schluessel) => nachrichtenJeAufruf(lauf, schluessel));
  assert.deepEqual(geschrieben, Array.from({ length: AUFRUFE_IM_GRUENEN_LAUF }, () => KLEIN.length));
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "phase.json")), true);
});
