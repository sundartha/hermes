// Die SPERRLISTE des schreibenden Kommandos (scripts/push-elevenlabs.mjs):
// retention_days und record_voice werden nie gepusht, in keine Richtung.
//
// WARUM DIESE FAELLE: der Eigentuemer ersetzt den menschlichen Riegel (jeden
// Push von Hand tippen) durch einen maschinellen (eine Berechtigungsregel, die
// das Skript dauerhaft erlaubt). Damit haengt an diesem Code, was vorher an
// einer Person hing. Aufbewahrung und Mitschnitt waren bis dahin nur durch
// ABSICHT geschuetzt - durch die Ausnahme in der Vorlage, die sich durch
// Nennung uebersteuern liess. Absicht ist kein Riegel: reist eines der beiden
// Felder versehentlich mit, ist das kein falscher Wert, sondern eine
// ungewollte Aussage darueber, was mit den Gespraechen echter Menschen
// geschieht.
//
// ZWEI RIEGEL, ZWEI ORTE. Der eine sieht die NENNUNG (--felder) und greift, bevor
// irgendetwas geladen oder gerufen wurde. Der andere sieht den FERTIGEN
// PATCH-KOERPER und ist der wichtigere: er faengt den Fall, in dem das Feld
// MITREIST, ohne genannt worden zu sein - unter einem groberen besessenen Pfad,
// in einer Liste, oder weil ein kuenftiger Umbau den Koerper anders baut.
//
// OHNE DIE POSITIV-KONTROLLE BEWEIST KEINER DER DREI ROTEN FAELLE ETWAS: ein
// Riegel, der alles abweist, besteht jeden Negativ-Test. Deshalb laeuft ein
// erlaubtes Feld hier im Trockenlauf sauber durch, und die Koerper-Pruefung
// bekommt einen sauberen Koerper vorgelegt, an dem sie schweigen muss.
//
// KEIN NETZ. Alles laeuft gegen die geteilte Attrappe (helpers/
// elevenlabs-push-attrappe.mjs), die jeden Aufruf mitschreibt. Geprueft wird
// nicht nur der Exit-Code, sondern die Aufrufliste: ein Abbruch NACH dem Senden
// waere wertlos und am Exit-Code nicht von einem davor zu unterscheiden.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  EIN_AUFRUF,
  KEIN_AUFRUF,
  TEST_SCHLUESSEL,
  laufeMitAttrappe,
  schreibendeAufrufe,
} from "./helpers/elevenlabs-push-attrappe.mjs";

// Der Schluessel muss stehen, bevor das Kommando (und mit ihm src/config.js)
// geladen wird - deshalb dynamischer Import, s. Attrappe.
process.env.ELEVENLABS_API_KEY = TEST_SCHLUESSEL;
const { koerperVerstoesse, runCli } = await import("../scripts/push-elevenlabs.mjs");

// Ein Befund je Riegel: die Faelle sind so gebaut, dass GENAU einer greift -
// eine Pruefung, die aus Versehen alles meldet, faellt damit auf.
const EIN_BEFUND = 1;
const FELD_AUFBEWAHRUNG = "retention_days";
const FELD_MITSCHNITT = "record_voice";
// Ein besessenes Feld ohne Datenschutz-Bezug, das am gestellten Live-Agenten
// fehlt und deshalb abweicht - der Trockenlauf baut daraus einen Koerper.
const FELD_ERLAUBT = "prompt";
const PFAD_ERLAUBT = "conversation_config.agent.prompt.prompt";
// Ein zweites besessenes Feld, das der Aufrufer NICHT genannt hat.
const FELD_UNGEFRAGT = "language";
const PFAD_UNGEFRAGT = "conversation_config.agent.language";
// Ein absichtlich GROBER Pfad: ein besessenes Feld, dessen Wert ein ganzes
// Objekt ist. Genau hier koennen die zwei Datenschutz-Felder mitreisen, ohne
// dass sie irgendwo genannt waeren.
const FELD_GROB = "privatsphaere_block";
const PFAD_GROB = "platform_settings.privacy";

function abweichung(feld, pfad) {
  return { feld, art: "wert", livePfade: [pfad], ausgenommen: null };
}

const ABWEICHUNGEN = [
  abweichung(FELD_ERLAUBT, PFAD_ERLAUBT),
  abweichung(FELD_UNGEFRAGT, PFAD_UNGEFRAGT),
  abweichung(FELD_GROB, PFAD_GROB),
];

function befundeFuer({ koerper, auswahl }) {
  return koerperVerstoesse({ koerper, abweichungen: ABWEICHUNGEN, auswahl });
}

function ohneNetzGelaufen(lauf) {
  return lauf.aufrufe.length === KEIN_AUFRUF;
}

describe("Sperrliste: die zwei Datenschutz-Felder sind nicht nennbar", () => {
  it("retention_days in --felder bricht ab, BEVOR irgendetwas rausgeht", async () => {
    const lauf = await laufeMitAttrappe({ runCli, argumente: [`--felder=${FELD_AUFBEWAHRUNG}`] });
    assert.equal(lauf.code, 1, `Exit 1 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.ok(
      ohneNetzGelaufen(lauf),
      `es wurde trotzdem gerufen: ${JSON.stringify(lauf.aufrufe)}`,
    );
    assert.match(lauf.ausgabe, /Abbruch \(fail-closed\): --felder nennt gesperrte Felder/);
    assert.match(lauf.ausgabe, new RegExp(`nennt gesperrte Felder: ${FELD_AUFBEWAHRUNG}`));
    assert.doesNotMatch(lauf.ausgabe, /WUERDE SCHREIBEN/);
  });

  it("record_voice in --felder bricht ab, BEVOR irgendetwas rausgeht", async () => {
    const lauf = await laufeMitAttrappe({ runCli, argumente: [`--felder=${FELD_MITSCHNITT}`] });
    assert.equal(lauf.code, 1, `Exit 1 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.ok(
      ohneNetzGelaufen(lauf),
      `es wurde trotzdem gerufen: ${JSON.stringify(lauf.aufrufe)}`,
    );
    assert.match(lauf.ausgabe, new RegExp(`nennt gesperrte Felder: ${FELD_MITSCHNITT}`));
    assert.doesNotMatch(lauf.ausgabe, /WUERDE SCHREIBEN/);
  });
});

describe("Sperrliste am fertigen Koerper: der blinde Passagier, der nie genannt wurde", () => {
  // Der wichtigere der beiden Riegel. Der Koerper haelt sich hier vollstaendig
  // an die Feldauswahl - der grobe Pfad IST gewaehlt, das Datenschutz-Feld
  // liegt darunter und waere von der Auswahl-Pruefung gedeckt. Nur die
  // Sperrliste sieht es.
  it("ein gesperrter Name unter einem gewaehlten Pfad ist ein Befund", () => {
    const koerper = { platform_settings: { privacy: { [FELD_AUFBEWAHRUNG]: 0 } } };
    const befunde = befundeFuer({ koerper, auswahl: [FELD_GROB] });
    assert.equal(befunde.length, EIN_BEFUND, `erwartet genau ein Befund, war: ${befunde}`);
    assert.match(befunde[0], /^GESPERRT/);
    assert.match(befunde[0], new RegExp(`${PFAD_GROB}\\.${FELD_AUFBEWAHRUNG}`));
  });

  it("auch in einer Liste, in die die Pfad-Sicht nicht hineinsieht", () => {
    const koerper = { platform_settings: { privacy: [{ [FELD_MITSCHNITT]: true }] } };
    const befunde = befundeFuer({ koerper, auswahl: [FELD_GROB] });
    assert.equal(befunde.length, EIN_BEFUND, `erwartet genau ein Befund, war: ${befunde}`);
    assert.match(befunde[0], /^GESPERRT/);
    assert.match(befunde[0], new RegExp(FELD_MITSCHNITT));
  });

  it("Gegenprobe: derselbe Koerper mit harmlosem Namen ist sauber - der NAME loest aus, nicht die Form", () => {
    const koerper = { platform_settings: { privacy: { anonymisierung: true } } };
    assert.deepEqual(befundeFuer({ koerper, auswahl: [FELD_GROB] }), []);
  });
});

describe("Kein blinder Passagier: im Koerper steht nur, was verlangt wurde", () => {
  it("ein Pfad, den die Feldauswahl nicht nennt, ist ein Befund", () => {
    const koerper = {
      conversation_config: { agent: { prompt: { prompt: "Vorlagen-Prompt" }, language: "de-DE" } },
    };
    const befunde = befundeFuer({ koerper, auswahl: [FELD_ERLAUBT] });
    assert.equal(befunde.length, EIN_BEFUND, `erwartet genau ein Befund, war: ${befunde}`);
    assert.match(befunde[0], /^BLINDER PASSAGIER/);
    assert.match(befunde[0], new RegExp(PFAD_UNGEFRAGT.replaceAll(".", "\\.")));
  });

  it("Positiv-Kontrolle: derselbe Koerper ohne den ungefragten Pfad ist sauber", () => {
    const koerper = { conversation_config: { agent: { prompt: { prompt: "Vorlagen-Prompt" } } } };
    assert.deepEqual(befundeFuer({ koerper, auswahl: [FELD_ERLAUBT] }), []);
  });
});

describe("Positiv-Kontrolle am ganzen Ablauf: ein erlaubtes Feld laeuft durch", () => {
  it("Trockenlauf mit --felder=prompt baut den Koerper und bricht NICHT ab", async () => {
    const lauf = await laufeMitAttrappe({ runCli, argumente: [`--felder=${FELD_ERLAUBT}`] });
    assert.equal(lauf.code, 0, `Exit 0 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.equal(lauf.aufrufe.length, EIN_AUFRUF, "genau ein Aufruf, und der liest");
    assert.deepEqual(schreibendeAufrufe(lauf.aufrufe), [], "der Trockenlauf hat geschrieben");
    assert.match(lauf.ausgabe, new RegExp(`WUERDE SCHREIBEN ${FELD_ERLAUBT} `));
    assert.match(
      lauf.ausgabe,
      new RegExp(`PATCH-KOERPER - .*${PFAD_ERLAUBT.replaceAll(".", "\\.")}`),
      "der Patch-Koerper wurde nicht gebaut oder nicht gemeldet",
    );
    assert.doesNotMatch(lauf.ausgabe, /Abbruch/);
  });
});
