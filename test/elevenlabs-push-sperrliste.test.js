// Die SPERRLISTE des schreibenden Kommandos (scripts/push-elevenlabs.mjs):
// retention_days wird nie gepusht, in keine Richtung; record_voice seit
// 2026-09-15 (Owner O2) nur in Richtung false.
//
// WARUM DIESE FAELLE: der Eigentuemer ersetzt den menschlichen Riegel (jeden
// Push von Hand tippen) durch einen maschinellen (eine Berechtigungsregel, die
// das Skript dauerhaft erlaubt). Damit haengt an diesem Code, was vorher an
// einer Person hing. Aufbewahrung und Mitschnitt waren bis dahin nur durch
// ABSICHT geschuetzt - durch die Ausnahme in der Vorlage, die sich durch
// Nennung uebersteuern liess. Absicht ist kein Riegel: reist retention_days
// versehentlich mit, ist das kein falscher Wert, sondern eine ungewollte
// Aussage darueber, was mit den Gespraechen echter Menschen geschieht.
// record_voice hat seit O2 eine ausdrueckliche Push-Absicht (false); die
// Gegenrichtung bleibt trotzdem gesperrt, damit das Wieder-Einschalten mit
// diesem Werkzeug unmoeglich bleibt.
//
// ZWEI RIEGEL, ZWEI ORTE. Der eine sieht die NENNUNG (--felder) und greift, bevor
// irgendetwas geladen oder gerufen wurde. Der andere sieht den FERTIGEN
// PATCH-KOERPER und ist der wichtigere: er faengt den Fall, in dem ein Feld
// MITREIST, ohne genannt worden zu sein - unter einem groberen besessenen Pfad,
// in einer Liste, oder weil ein kuenftiger Umbau den Koerper anders baut.
//
// OHNE DIE POSITIV-KONTROLLE BEWEIST KEINER DER ROTEN FAELLE ETWAS: ein
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

import { setzeAnPfad, vergleicheBesitz } from "../scripts/lib/elevenlabs-besitz.mjs";
import {
  EIN_AUFRUF,
  KEIN_AUFRUF,
  LIVE_MIT_DATENSCHUTZ,
  TEST_SCHLUESSEL,
  laufeMitAttrappe,
  schreibendeAufrufe,
} from "./helpers/elevenlabs-push-attrappe.mjs";

// Der Schluessel muss stehen, bevor das Kommando (und mit ihm src/config.js)
// geladen wird - deshalb dynamischer Import, s. Attrappe.
process.env.ELEVENLABS_API_KEY = TEST_SCHLUESSEL;
const { bauePatchKoerper, koerperVerstoesse, mitSchreibwerten, runCli, teileAbweichungen } = await import(
  "../scripts/push-elevenlabs.mjs"
);
const { ladeVorlage } = await import("../scripts/lib/elevenlabs-agent-lesen.mjs");

// Ein Befund je Riegel: die Faelle sind so gebaut, dass GENAU einer greift -
// eine Pruefung, die aus Versehen alles meldet, faellt damit auf.
const EIN_BEFUND = 1;
const FELD_AUFBEWAHRUNG = "retention_days";
const FELD_MITSCHNITT = "record_voice";
const MARKE_RICHTUNG = /^RICHTUNG GESPERRT/;
const PFAD_MITSCHNITT = "platform_settings.privacy.record_voice";
// Ein besessenes Feld ohne Datenschutz-Bezug, das am gestellten Live-Agenten
// fehlt und deshalb abweicht - der Trockenlauf baut daraus einen Koerper.
const FELD_ERLAUBT = "prompt";
const PFAD_ERLAUBT = "conversation_config.agent.prompt.prompt";
// Ein zweites besessenes Feld, das der Aufrufer NICHT genannt hat.
const FELD_UNGEFRAGT = "language";
const PFAD_UNGEFRAGT = "conversation_config.agent.language";
// Ein absichtlich GROBER Pfad: ein besessenes Feld, dessen Wert ein ganzes
// Objekt ist. Genau hier koennen Datenschutz-Felder mitreisen, ohne dass sie
// irgendwo genannt waeren.
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

  it("IEX-A5-1: --felder=record_voice mit Vorlage false: Trockenlauf WUERDE SCHREIBEN, Koerper genau dieses eine Blatt, kein Schreibaufruf", async () => {
    const lauf = await laufeMitAttrappe({ runCli, argumente: [`--felder=${FELD_MITSCHNITT}`] });
    assert.equal(lauf.code, 0, `Exit 0 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.equal(lauf.aufrufe.length, EIN_AUFRUF, "genau ein Aufruf, und der liest");
    assert.deepEqual(schreibendeAufrufe(lauf.aufrufe), [], "der Trockenlauf hat geschrieben");
    assert.match(lauf.ausgabe, new RegExp(`WUERDE SCHREIBEN ${FELD_MITSCHNITT} `));
    assert.match(
      lauf.ausgabe,
      new RegExp(`PATCH-KOERPER - \\d+ Zeichen, genau diese Blatt-Pfade und nichts sonst: ${PFAD_MITSCHNITT.replaceAll(".", "\\.")}$`, "m"),
      "der Patch-Koerper traegt nicht genau dieses eine Blatt",
    );
    assert.doesNotMatch(lauf.ausgabe, /Abbruch|GESPERRT/);
  });

  it("IEX-A5-2: --felder=record_voice,retention_days bricht ab, BEVOR irgendetwas rausgeht: die Oeffnung von record_voice oeffnet retention_days nicht", async () => {
    const lauf = await laufeMitAttrappe({
      runCli,
      argumente: [`--felder=${FELD_MITSCHNITT},${FELD_AUFBEWAHRUNG}`],
    });
    assert.equal(lauf.code, 1, `Exit 1 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.ok(
      ohneNetzGelaufen(lauf),
      `es wurde trotzdem gerufen: ${JSON.stringify(lauf.aufrufe)}`,
    );
    assert.match(lauf.ausgabe, new RegExp(`nennt gesperrte Felder: ${FELD_AUFBEWAHRUNG}`));
    assert.doesNotMatch(lauf.ausgabe, new RegExp(`nennt gesperrte Felder: [^\\n]*${FELD_MITSCHNITT}`));
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
    const koerper = { platform_settings: { privacy: [{ [FELD_AUFBEWAHRUNG]: 0 }] } };
    const befunde = befundeFuer({ koerper, auswahl: [FELD_GROB] });
    assert.equal(befunde.length, EIN_BEFUND, `erwartet genau ein Befund, war: ${befunde}`);
    assert.match(befunde[0], /^GESPERRT/);
    assert.match(befunde[0], new RegExp(FELD_AUFBEWAHRUNG));
  });

  it("Gegenprobe: derselbe Koerper mit harmlosem Namen ist sauber - der NAME loest aus, nicht die Form", () => {
    const koerper = { platform_settings: { privacy: { anonymisierung: true } } };
    assert.deepEqual(befundeFuer({ koerper, auswahl: [FELD_GROB] }), []);
  });

  it("IEX-A5-3: record_voice mit jedem Wert ausser false ist genau ein Befund RICHTUNG GESPERRT, als Objekt und in einer Liste", () => {
    const falscheWerte = [true, null, "false", 0];
    for (const wert of falscheWerte) {
      const alsObjekt = { platform_settings: { privacy: { [FELD_MITSCHNITT]: wert } } };
      const alsObjektBefunde = befundeFuer({ koerper: alsObjekt, auswahl: [FELD_GROB] });
      assert.equal(
        alsObjektBefunde.length,
        EIN_BEFUND,
        `Wert ${JSON.stringify(wert)} als Objekt: erwartet genau ein Befund, war: ${alsObjektBefunde}`,
      );
      assert.match(alsObjektBefunde[0], MARKE_RICHTUNG);
      assert.match(alsObjektBefunde[0], new RegExp(FELD_MITSCHNITT));

      const alsListe = { platform_settings: { privacy: [{ [FELD_MITSCHNITT]: wert }] } };
      const alsListeBefunde = befundeFuer({ koerper: alsListe, auswahl: [FELD_GROB] });
      assert.equal(
        alsListeBefunde.length,
        EIN_BEFUND,
        `Wert ${JSON.stringify(wert)} in Liste: erwartet genau ein Befund, war: ${alsListeBefunde}`,
      );
      assert.match(alsListeBefunde[0], MARKE_RICHTUNG);
      assert.match(alsListeBefunde[0], new RegExp(FELD_MITSCHNITT));
    }
  });

  it("IEX-A5-4: Positiv-Kontrolle: record_voice=false im Koerper ist sauber, als Objekt und in einer Liste", () => {
    const alsObjekt = { platform_settings: { privacy: { [FELD_MITSCHNITT]: false } } };
    assert.deepEqual(befundeFuer({ koerper: alsObjekt, auswahl: [FELD_GROB] }), []);

    const alsListe = { platform_settings: { privacy: [{ [FELD_MITSCHNITT]: false }] } };
    assert.deepEqual(befundeFuer({ koerper: alsListe, auswahl: [FELD_GROB] }), []);
  });

  // Findet den Besitz-Eintrag fuer record_voice in einer (ggf. veraenderten)
  // Kopie der Vorlage.
  function mitschnittEintrag(vorlage) {
    return vorlage._besitz.felder.find((eintrag) => eintrag.feld === FELD_MITSCHNITT);
  }

  // Baut den Koerper GENAU wie laufeAgentenPush es tut (lesen, vergleichen,
  // Feldauswahl, Schreibwerte, Koerper, Pruefung) - ohne die Repo-Vorlage
  // umzuschreiben, deshalb ueber die reinen Bausteine statt ueber runCli.
  function koerperAusVorlage({ vorlage, live }) {
    const auswahl = [FELD_MITSCHNITT];
    const { abweichungen } = vergleicheBesitz({ vorlage, live });
    const felder = teileAbweichungen({ abweichungen, auswahl });
    const { schreibbar } = mitSchreibwerten({ schreibbar: felder.schreibbar, vorlage, live });
    const koerper = bauePatchKoerper(schreibbar);
    return { koerper, befunde: koerperVerstoesse({ koerper, abweichungen, auswahl }) };
  }

  it("IEX-A5-5: Vorlage im Speicher auf true gesetzt: der aus der echten Vorlage gebaute Koerper haelt der Pruefung nicht stand - Gegenprobe mit unveraenderter Vorlage sauber", () => {
    const vorlageManipuliert = structuredClone(ladeVorlage());
    const eintragManipuliert = mitschnittEintrag(vorlageManipuliert);
    setzeAnPfad(vorlageManipuliert, eintragManipuliert.vorlage[0], true);
    const liveFuerManipuliert = structuredClone(LIVE_MIT_DATENSCHUTZ);
    setzeAnPfad(liveFuerManipuliert, eintragManipuliert.live[0], false);

    const manipuliert = koerperAusVorlage({ vorlage: vorlageManipuliert, live: liveFuerManipuliert });
    const erwarteterKoerperManipuliert = {};
    setzeAnPfad(erwarteterKoerperManipuliert, eintragManipuliert.live[0], true);
    assert.deepEqual(
      manipuliert.koerper,
      erwarteterKoerperManipuliert,
      "der Koerper misst nicht den manipulierten SOLL-Wert",
    );
    assert.equal(manipuliert.befunde.length, EIN_BEFUND, `erwartet genau ein Befund, war: ${manipuliert.befunde}`);
    assert.match(manipuliert.befunde[0], MARKE_RICHTUNG);

    const vorlageUnveraendert = ladeVorlage();
    const liveUnveraendert = structuredClone(LIVE_MIT_DATENSCHUTZ);
    const sauber = koerperAusVorlage({ vorlage: vorlageUnveraendert, live: liveUnveraendert });
    const eintragUnveraendert = mitschnittEintrag(vorlageUnveraendert);
    const erwarteterKoerperSauber = {};
    setzeAnPfad(erwarteterKoerperSauber, eintragUnveraendert.live[0], false);
    assert.deepEqual(sauber.koerper, erwarteterKoerperSauber);
    assert.deepEqual(sauber.befunde, []);
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

describe("Positiv-Kontrolle am ganzen Ablauf (prompt): ein erlaubtes Feld laeuft durch", () => {
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
