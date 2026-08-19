// Die Feldauswahl des schreibenden Kommandos (scripts/push-elevenlabs.mjs) und
// der Riegel, den die Vorlage selbst setzen kann: ein Besitz-Eintrag mit
// "ausgenommen" (Grund + Datum).
//
// WARUM DIESE FAELLE: das Werkzeug ist die einzige Stelle im Repo, die den
// Live-Agenten bei ElevenLabs veraendert. Seine Zusagen ("ohne ausdrueckliche
// Nennung wird ein ausgenommenes Feld nie geschrieben", "ein unbekannter
// Feldname bricht ab, bevor irgendetwas das Netz beruehrt", "der Trockenlauf
// schreibt nie") standen bisher nur als Kommentar da. Ein Riegel, den niemand
// misst, ist eine Behauptung - und dieser hier haelt eine
// Eigentuemer-Entscheidung fest, die genau ein unbedachter Lauf umdrehen wuerde
// (Aufbewahrung und Mitschnitt stehen live bewusst anders als in der Vorlage).
//
// KEIN NETZ, KEINE ECHTE API: der Vergleichs-Kern ist ohnehin reine Rechnung,
// und die Faelle am ganzen Ablauf laufen gegen die gestellte fetch-Attrappe aus
// helpers/elevenlabs-push-attrappe.mjs, die jeden Aufruf mitschreibt. "Es wurde
// nicht geschrieben" ist damit gemessen (kein einziger PATCH in der
// Aufrufliste) und nicht geglaubt.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { AUSNAHME_MARKE, vergleicheBesitz } from "../scripts/lib/elevenlabs-besitz.mjs";

import {
  EIN_AUFRUF,
  KEIN_AUFRUF,
  LIVE_MIT_DATENSCHUTZ,
  TEST_SCHLUESSEL,
  laufeMitAttrappe as laufeMitRunCli,
  schreibendeAufrufe,
} from "./helpers/elevenlabs-push-attrappe.mjs";

// Der Schluessel wird gesetzt, BEVOR das Kommando (und mit ihm src/config.js)
// geladen wird - deshalb dynamischer Import: statische Importe laufen vor jeder
// Anweisung der Datei, und ohne Schluessel bricht das Kommando fail-closed ab,
// bevor es zur Feldauswahl kaeme.
process.env.ELEVENLABS_API_KEY = TEST_SCHLUESSEL;
const { runCli, teileAbweichungen } = await import("../scripts/push-elevenlabs.mjs");
const { ladeVorlage } = await import("../scripts/lib/elevenlabs-agent-lesen.mjs");

const FELD_FREI = "frei";
const FELD_BEWACHT = "bewacht";
const ART_WERT = "wert";
const DATUM_MUSTER = /^\d{4}-\d{2}-\d{2}$/;
const AUSNAHME_GUELTIG = {
  grund: "Wird gerade gemessen, vor dem ersten Fremdkunden zurueckgedreht.",
  seit: "2026-08-15",
};

// Ein Verbot muss in der Erklaerung stehen (fail-closed), sonst meldet der Kern
// einen Fehler und die Faelle hier prueften nur noch diesen Fehler.
const REGEL = {
  regel: "nichts_heikles_je_eintrag",
  art: "verboten_je_eintrag",
  live: "sammlung",
  verboten: ["heikel"],
  meldung: "Kein Eintrag dieser Sammlung darf 'heikel' setzen.",
};

const LIVE_ATTRAPPE = {
  ist: { frei: "Live-Wert frei", bewacht: "Live-Wert bewacht" },
  sammlung: {},
};

const AUFBEWAHRUNGS_FELDER = ["record_voice", "retention_days"];

// Beide Felder weichen ab; der einzige Unterschied zwischen ihnen ist die
// Ausnahme. Ohne diese Gleichheit koennte ein gruener Fall auch an etwas
// anderem liegen als am Riegel.
function baueVorlage(ausnahme) {
  const bewacht = {
    feld: FELD_BEWACHT,
    art: ART_WERT,
    vorlage: ["soll.bewacht"],
    live: ["ist.bewacht"],
  };
  return {
    _besitz: {
      felder: [
        { feld: FELD_FREI, art: ART_WERT, vorlage: ["soll.frei"], live: ["ist.frei"] },
        ausnahme === null ? bewacht : { ...bewacht, ausgenommen: ausnahme },
      ],
      regeln: [REGEL],
    },
    soll: { frei: "Vorlagen-Wert frei", bewacht: "Vorlagen-Wert bewacht" },
  };
}

function befundFuer(ausnahme) {
  return vergleicheBesitz({ vorlage: baueVorlage(ausnahme), live: LIVE_ATTRAPPE });
}

function toepfe({ ausnahme, auswahl }) {
  return teileAbweichungen({ abweichungen: befundFuer(ausnahme).abweichungen, auswahl });
}

function namen(abweichungen) {
  return abweichungen.map((abweichung) => abweichung.feld).sort();
}

function zeileZu(befund, feld) {
  const treffer = befund.abweichungen.find((abweichung) => abweichung.feld === feld);
  return treffer ? treffer.zeile : "";
}

function laufeMitAttrappe(argumente) {
  return laufeMitRunCli({ runCli, argumente });
}

describe("Besitz-Erklaerung: die Ausnahme als geprueftes Datenfeld", () => {
  it("die echte Vorlage nimmt genau die zwei Aufbewahrungs-Felder aus, jeweils mit Grund und Datum", () => {
    const befund = vergleicheBesitz({ vorlage: ladeVorlage(), live: LIVE_MIT_DATENSCHUTZ });
    assert.deepEqual(
      befund.fehler,
      [],
      "die Besitz-Erklaerung der echten Vorlage traegt nicht - dann prueft nichts davon etwas",
    );
    const ausgenommen = befund.abweichungen.filter((abweichung) => abweichung.ausgenommen);
    assert.deepEqual(namen(ausgenommen), AUFBEWAHRUNGS_FELDER);
    for (const abweichung of ausgenommen) {
      const { grund, seit } = abweichung.ausgenommen;
      assert.ok(grund.length > 0, `${abweichung.feld}: Ausnahme ohne Grund`);
      assert.match(seit, DATUM_MUSTER, `${abweichung.feld}: Ausnahme ohne brauchbares Datum`);
    }
  });

  it("Ausnahme ohne Grund ist ein Fehler, keine stille Sonderbehandlung", () => {
    const befund = befundFuer({ seit: "2026-08-15" });
    assert.equal(befund.ok, false);
    assert.ok(
      befund.fehler.some((zeile) => zeile.includes(FELD_BEWACHT)),
      `Fehler zu ${FELD_BEWACHT} fehlt: ${befund.fehler.join(" | ")}`,
    );
  });

  it("Ausnahme ohne Datum ist ein Fehler - ohne Datum ist 'vorerst' nicht nachpruefbar", () => {
    const befund = befundFuer({ grund: "kommt spaeter", seit: "demnaechst" });
    assert.equal(befund.ok, false);
    assert.ok(
      befund.fehler.some((zeile) => zeile.includes(FELD_BEWACHT)),
      `Fehler zu ${FELD_BEWACHT} fehlt: ${befund.fehler.join(" | ")}`,
    );
  });

  it("das lesende Gate meldet die Abweichung weiter, nur gekennzeichnet - stumm geschaltet wird nichts", () => {
    const mitAusnahme = befundFuer(AUSNAHME_GUELTIG);
    const ohneAusnahme = befundFuer(null);
    assert.deepEqual(
      namen(mitAusnahme.abweichungen),
      namen(ohneAusnahme.abweichungen),
      "die Ausnahme darf die Menge der gemeldeten Abweichungen nicht veraendern",
    );
    assert.equal(mitAusnahme.ok, false, "ausgenommen heisst nicht gruen");
    assert.ok(zeileZu(mitAusnahme, FELD_BEWACHT).includes(AUSNAHME_MARKE));
    assert.ok(!zeileZu(ohneAusnahme, FELD_BEWACHT).includes(AUSNAHME_MARKE));
  });
});

describe("Feldauswahl: wer ist Schreib-Kandidat", () => {
  it("ohne Feldauswahl ist ein ausgenommenes Feld KEIN Kandidat", () => {
    const { schreibbar, ausgenommen } = toepfe({ ausnahme: AUSNAHME_GUELTIG, auswahl: null });
    assert.deepEqual(namen(schreibbar), [FELD_FREI]);
    assert.deepEqual(namen(ausgenommen), [FELD_BEWACHT]);
  });

  it("Gegenprobe: ohne die Ausnahme waere dasselbe Feld Kandidat - der Riegel ist die Ursache", () => {
    const { schreibbar, ausgenommen } = toepfe({ ausnahme: null, auswahl: null });
    assert.deepEqual(namen(schreibbar), [FELD_BEWACHT, FELD_FREI]);
    assert.deepEqual(namen(ausgenommen), []);
  });

  it("ausdrueckliche Nennung macht ein ausgenommenes Feld schreibbar - Riegel, kein Verbot", () => {
    const { schreibbar, ausgenommen, ausgelassen } = toepfe({
      ausnahme: AUSNAHME_GUELTIG,
      auswahl: [FELD_BEWACHT],
    });
    assert.deepEqual(namen(schreibbar), [FELD_BEWACHT]);
    assert.deepEqual(namen(ausgenommen), []);
    assert.deepEqual(namen(ausgelassen), [FELD_FREI], "das ungenannte Feld bleibt unberuehrt");
  });

  it("eine Feldauswahl, die das ausgenommene Feld nicht nennt, laesst es ausgenommen", () => {
    const { schreibbar, ausgenommen } = toepfe({
      ausnahme: AUSNAHME_GUELTIG,
      auswahl: [FELD_FREI],
    });
    assert.deepEqual(namen(schreibbar), [FELD_FREI]);
    assert.deepEqual(namen(ausgenommen), [FELD_BEWACHT]);
  });
});

describe("Push-Kommando: fail-closed vor dem Netz, Trockenlauf schreibt nie", () => {
  it("unbekannter Feldname bricht ab, BEVOR irgendetwas das Netz beruehrt", async () => {
    const lauf = await laufeMitAttrappe(["--felder=gibtesnichtimbesitz"]);
    assert.equal(lauf.code, 1);
    assert.equal(
      lauf.aufrufe.length,
      KEIN_AUFRUF,
      `es wurde trotzdem gerufen: ${JSON.stringify(lauf.aufrufe)}`,
    );
    assert.match(lauf.ausgabe, /gibtesnichtimbesitz/);
  });

  it("Trockenlauf ohne Feldauswahl: nur gelesen, und die zwei Aufbewahrungs-Felder als AUSGENOMMEN gemeldet", async () => {
    const lauf = await laufeMitAttrappe([]);
    assert.equal(lauf.code, 0);
    assert.equal(lauf.aufrufe.length, EIN_AUFRUF, "genau ein Aufruf, und der liest");
    assert.deepEqual(
      schreibendeAufrufe(lauf.aufrufe),
      [],
      "der Trockenlauf hat geschrieben",
    );
    assert.match(lauf.ausgabe, /AUSGENOMMEN retention_days/);
    assert.match(lauf.ausgabe, /AUSGENOMMEN record_voice/);
    assert.match(lauf.ausgabe, /ausgenommen seit \d{4}-\d{2}-\d{2}:/);
    assert.doesNotMatch(lauf.ausgabe, /WUERDE SCHREIBEN retention_days/);
    assert.doesNotMatch(lauf.ausgabe, /WUERDE SCHREIBEN record_voice/);
  });

  // Die Uebersteuerung durch Nennung gilt weiter fuer ausgenommene Felder im
  // Allgemeinen - fuer die beiden Aufbewahrungs-Felder aber NICHT MEHR: sie
  // stehen seit dem 2026-08-17 auf der Sperrliste des Kommandos und sind gar
  // nicht mehr nennbar. Der Fall steht hier, weil er frueher das Gegenteil
  // behauptete; gemessen wird die Sperrliste in
  // test/elevenlabs-push-sperrliste.test.js.
  it("ein gesperrtes Feld laesst sich auch durch Nennung nicht mehr uebersteuern", async () => {
    const lauf = await laufeMitAttrappe(["--felder=retention_days"]);
    assert.equal(lauf.code, 1);
    assert.equal(
      lauf.aufrufe.length,
      KEIN_AUFRUF,
      `es wurde trotzdem gerufen: ${JSON.stringify(lauf.aufrufe)}`,
    );
    assert.match(lauf.ausgabe, /nennt gesperrte Felder: retention_days/);
    assert.doesNotMatch(lauf.ausgabe, /WUERDE SCHREIBEN retention_days/);
  });
});
