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
// und die zwei Faelle am ganzen Ablauf laufen gegen eine gestellte fetch-
// Attrappe, die jeden Aufruf mitschreibt. "Es wurde nicht geschrieben" ist damit
// gemessen (kein einziger PATCH in der Aufrufliste) und nicht geglaubt.
//
// Die Attrappe des Live-Agenten ist bewusst winzig: sie fuehrt genau die beiden
// Datenschutz-Felder mit ihren heutigen Live-Werten und die Sammlung, ohne die
// das Verbot nichts pruefen koennte. Alles andere fehlt und weicht deshalb ab -
// fuer die Aussagen hier ohne Belang, und der einzige Weg, den echten
// Live-Stand nicht ins Repo kopieren zu muessen.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { AUSNAHME_MARKE, vergleicheBesitz } from "../scripts/lib/elevenlabs-besitz.mjs";

// Der Schluessel wird gesetzt, BEVOR das Kommando (und mit ihm src/config.js)
// geladen wird - deshalb dynamischer Import: statische Importe laufen vor jeder
// Anweisung der Datei, und ohne Schluessel bricht das Kommando fail-closed ab,
// bevor es zur Feldauswahl kaeme. Ein Platzhalter, kein echter Schluessel: die
// fetch-Attrappe unten laesst ihn nie an ein Netz.
const TEST_SCHLUESSEL = "test-schluessel-ohne-netz";
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

// Die heutigen LIVE-Werte der beiden Datenschutz-Felder (Aufbewahrung an,
// Mitschnitt an) - genau die bewusste Abweichung von der Vorlage (0 / false).
const LIVE_MIT_DATENSCHUTZ = {
  conversation_config: { language_presets: {} },
  platform_settings: { privacy: { retention_days: -1, record_voice: true } },
};

const METHODE_GET = "GET";
const AUFBEWAHRUNGS_FELDER = ["record_voice", "retention_days"];
const KEIN_AUFRUF = 0;
const EIN_AUFRUF = 1;

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

// --- Ablauf-Attrappe: fetch und Konsole gestellt, danach zurueckgedreht ---

// Antwortet auf JEDEN Aufruf mit dem gestellten Live-Agenten und schreibt die
// Methode mit. Nur ok und text() werden vom Kommando gelesen; mehr vorzugaukeln
// wuerde nur verdecken, was wirklich gebraucht wird.
function fetchAttrappe(koerper) {
  const aufrufe = [];
  const stellvertreter = async (adresse, optionen = {}) => {
    aufrufe.push({ adresse: String(adresse), methode: optionen.method || METHODE_GET });
    return { ok: true, text: async () => JSON.stringify(koerper) };
  };
  return { aufrufe, stellvertreter };
}

async function laufeMitAttrappe(argumente) {
  const { aufrufe, stellvertreter } = fetchAttrappe(LIVE_MIT_DATENSCHUTZ);
  const echtesFetch = globalThis.fetch;
  const echtesLog = console.log;
  const echtesError = console.error;
  const zeilen = [];
  globalThis.fetch = stellvertreter;
  console.log = (zeile) => zeilen.push(zeile);
  console.error = (zeile) => zeilen.push(zeile);
  try {
    const code = await runCli(["node", "push-elevenlabs.mjs", ...argumente]);
    return { code, aufrufe, ausgabe: zeilen.join("\n") };
  } finally {
    globalThis.fetch = echtesFetch;
    console.log = echtesLog;
    console.error = echtesError;
  }
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
      lauf.aufrufe.filter((aufruf) => aufruf.methode !== METHODE_GET),
      [],
      "der Trockenlauf hat geschrieben",
    );
    assert.match(lauf.ausgabe, /AUSGENOMMEN retention_days/);
    assert.match(lauf.ausgabe, /AUSGENOMMEN record_voice/);
    assert.match(lauf.ausgabe, /ausgenommen seit \d{4}-\d{2}-\d{2}:/);
    assert.doesNotMatch(lauf.ausgabe, /WUERDE SCHREIBEN retention_days/);
    assert.doesNotMatch(lauf.ausgabe, /WUERDE SCHREIBEN record_voice/);
  });

  it("Trockenlauf MIT ausdruecklicher Nennung schreibt trotzdem nicht, meldet die Ausnahme aber als uebersteuert", async () => {
    const lauf = await laufeMitAttrappe(["--felder=retention_days"]);
    assert.equal(lauf.code, 0);
    assert.deepEqual(
      lauf.aufrufe.filter((aufruf) => aufruf.methode !== METHODE_GET),
      [],
      "der Trockenlauf hat geschrieben",
    );
    assert.match(lauf.ausgabe, /AUSNAHME UEBERSTIMMT - retention_days/);
    assert.match(lauf.ausgabe, /WUERDE SCHREIBEN retention_days/);
    assert.match(lauf.ausgabe, /TROCKENLAUF/);
  });
});
