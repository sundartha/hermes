// Der ZUSAMMENFUEHRENDE SCHREIBWEG des Push-Kommandos (schreibweg
// "je_schluessel", erklaert am Besitz-Eintrag der Vorlage).
//
// WARUM ES IHN GIBT: platform_settings.data_collection ist die einzige besessene
// Stelle, an der beide Seiten Verschiedenes besitzen - die Vorlage Schluessel,
// Typ und Beschreibung, der Anbieter zusaetzlich acht eigene Felder je Eintrag.
// Bis heute galt sie deshalb als "nicht schreibbar", und ABNAHME-D1 war gegen die
// Vorlage gruen, beim ANBIETER aber rot: gruener Test, unbewachte Tatsache.
//
// DREI ZUSAGEN, DREI FAELLE. Der Schreibweg (1) laesst die Anbieter-Felder eines
// BESTEHENDEN Schluessels unangetastet, (2) nimmt einen NEUEN Schluessel ganz aus
// der Vorlage und (3) LOESCHT NICHTS: ein Schluessel, den nur der Live-Agent
// fuehrt, bricht den Lauf ab, statt still zu verschwinden. Fall 3 ist die
// Rotprobe - er laeuft zusaetzlich durch das ganze Kommando, damit belegt ist,
// dass der Abbruch VOR dem Netz liegt und nicht erst in der Auswertung.
//
// OHNE DIE POSITIV-KONTROLLE BEWIESE FALL 3 NICHTS: ein Schreibweg, der immer
// abbricht, besteht jede Rotprobe. Deshalb steht daneben derselbe Aufbau ohne
// den fremden Schluessel, der sauber durchlaeuft.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  KEIN_AUFRUF,
  TEST_SCHLUESSEL,
  laufeMitAttrappe,
  schreibendeAufrufe,
} from "./helpers/elevenlabs-push-attrappe.mjs";

process.env.ELEVENLABS_API_KEY = TEST_SCHLUESSEL;
const {
  koerperVerstoesse,
  mitSchreibwerten,
  runCli: RUN_CLI,
} = await import("../scripts/push-elevenlabs.mjs");

const PFAD = "platform_settings.data_collection";
const FELD = "data_collection";
// Ein Schluessel, den beide Seiten fuehren - hier haengt der Anbieter seine
// eigenen Felder an, und genau die duerfen den Schreibvorgang ueberleben.
const BESTAND = "contact_person";
// Ein Schluessel, den nur die Vorlage fuehrt: der Fall, um den es beim Push geht.
const NEU = "amount";
// Ein Schluessel, den nur der Live-Agent fuehrt (z.B. von Hand im Dashboard
// angelegt) - er darf nicht verschwinden.
const FREMD = "von_hand_im_dashboard";

const LIVE_BESCHREIBUNG = "alte, ungenaue Beschreibung";
const SOLL_BESCHREIBUNG = "neue, genauere Beschreibung";

// Die Anbieter-Felder EINES Eintrags, wie sie am Live-Agenten 2026-08-17
// gemessen wurden. Sie stehen in keiner Vorlage - wer sie mitschreibt, erfindet
// sie.
const ANBIETER_FELDER = {
  enum: null,
  is_system_provided: false,
  dynamic_variable: "",
  allowed_values_dynamic_variable: "",
  constant_value: "",
  is_omitted: false,
  llm: null,
  llm_billed: false,
};

function abweichung() {
  return {
    feld: FELD,
    art: "namen",
    livePfade: [PFAD],
    vorlagePfade: [PFAD],
    schreibweg: "je_schluessel",
    schreibwegBesitz: ["description"],
    soll: { vorhanden: true, wert: [BESTAND, NEU] },
    ist: { vorhanden: true, wert: [BESTAND] },
    ausgenommen: null,
  };
}

function vorlageMit(schluessel) {
  return { platform_settings: { data_collection: schluessel } };
}

const VORLAGE = vorlageMit({
  [BESTAND]: { type: "string", description: SOLL_BESCHREIBUNG },
  [NEU]: { type: "number", description: "Der Betrag als blosse Zahl." },
});

function fuehreZusammen(live) {
  return mitSchreibwerten({ schreibbar: [abweichung()], vorlage: VORLAGE, live });
}

describe("Zusammenfuehrender Schreibweg: was ueberlebt, was neu kommt", () => {
  it("ein BESTEHENDER Schluessel behaelt die Anbieter-Felder und bekommt nur die besessene Beschreibung", () => {
    const live = vorlageMit({
      [BESTAND]: { type: "string", description: LIVE_BESCHREIBUNG, ...ANBIETER_FELDER },
    });
    const { schreibbar, fehler } = fuehreZusammen(live);
    assert.deepEqual(fehler, []);
    const wert = schreibbar[0].schreibWert;
    assert.equal(
      wert[BESTAND].description,
      SOLL_BESCHREIBUNG,
      "die Beschreibung wurde nicht erneuert",
    );
    for (const [name, inhalt] of Object.entries(ANBIETER_FELDER)) {
      assert.deepEqual(
        wert[BESTAND][name],
        inhalt,
        `Anbieter-Feld ${name} wurde ueberschrieben - der Schreibweg erfindet Werte`,
      );
    }
  });

  it("der Typ eines bestehenden Schluessels bleibt live - er ist nicht besessen", () => {
    const live = vorlageMit({ [BESTAND]: { type: "integer", description: LIVE_BESCHREIBUNG } });
    const { schreibbar } = fuehreZusammen(live);
    const wert = schreibbar[0].schreibWert;
    assert.equal(wert[BESTAND].type, "integer");
  });

  // Fehlt die Sammlung live ganz, ist sie LEER und nicht kaputt - sonst braeche
  // ausgerechnet der Fall ab, fuer den es den Schreibweg gibt: ein Agent, der
  // die Angaben noch gar nicht erhebt.
  it("fehlt die Sammlung live vollstaendig, sind alle Schluessel neu", () => {
    const { schreibbar, fehler } = fuehreZusammen({ platform_settings: {} });
    assert.deepEqual(fehler, []);
    assert.deepEqual(Object.keys(schreibbar[0].schreibWert).sort(), [NEU, BESTAND].sort());
  });

  it("ein NEUER Schluessel kommt vollstaendig aus der Vorlage - dort ist die einzige Quelle", () => {
    const live = vorlageMit({ [BESTAND]: { type: "string", description: LIVE_BESCHREIBUNG } });
    const { schreibbar } = fuehreZusammen(live);
    assert.deepEqual(schreibbar[0].schreibWert[NEU], {
      type: "number",
      description: "Der Betrag als blosse Zahl.",
    });
  });
});

describe("Rotprobe: ein nur live vorhandener Schluessel bricht ab, statt zu verschwinden", () => {
  it("die Zusammenfuehrung meldet ihn als Fehler und liefert KEINEN Schreibwert", () => {
    const live = vorlageMit({
      [BESTAND]: { type: "string", description: LIVE_BESCHREIBUNG },
      [FREMD]: { type: "string", description: "von Hand angelegt" },
    });
    const { schreibbar, fehler } = fuehreZusammen(live);
    assert.equal(fehler.length, 1, `genau ein Fehler erwartet, waren: ${fehler}`);
    assert.match(fehler[0], new RegExp(FREMD));
    assert.deepEqual(schreibbar, [], "trotz Fehler blieb ein Schreibwert stehen");
  });

  it("Positiv-Kontrolle: derselbe Aufbau OHNE den fremden Schluessel laeuft sauber durch", () => {
    const live = vorlageMit({ [BESTAND]: { type: "string", description: LIVE_BESCHREIBUNG } });
    const { schreibbar, fehler } = fuehreZusammen(live);
    assert.deepEqual(fehler, []);
    assert.equal(schreibbar.length, 1);
  });

  it("am ganzen Kommando: der Abbruch liegt VOR dem Netz, mit der ECHTEN Vorlage", async () => {
    const live = {
      conversation_config: { language_presets: {} },
      platform_settings: {
        privacy: { retention_days: -1, record_voice: true },
        data_collection: { [FREMD]: { type: "string", description: "von Hand angelegt" } },
      },
    };
    const lauf = await laufeMitAttrappe({ runCli: RUN_CLI, argumente: [`--felder=${FELD}`], live });
    assert.equal(lauf.code, 1, `Exit 1 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.deepEqual(schreibendeAufrufe(lauf.aufrufe), [], "es wurde trotzdem geschrieben");
    assert.match(lauf.ausgabe, /erklaerte Schreibwege tragen nicht/);
    assert.match(lauf.ausgabe, new RegExp(FREMD));
    assert.doesNotMatch(lauf.ausgabe, /PATCH-KOERPER/, "der Koerper wurde trotz Abbruch gebaut");
  });

  it("Positiv-Kontrolle am ganzen Kommando: ohne den fremden Schluessel baut es einen Koerper", async () => {
    const live = {
      conversation_config: { language_presets: {} },
      platform_settings: {
        privacy: { retention_days: -1, record_voice: true },
        data_collection: { [BESTAND]: { type: "string", description: LIVE_BESCHREIBUNG } },
      },
    };
    const lauf = await laufeMitAttrappe({ runCli: RUN_CLI, argumente: [`--felder=${FELD}`], live });
    assert.equal(lauf.code, 0, `Exit 0 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.equal(lauf.aufrufe.length, 1, "genau ein Aufruf, und der liest");
    assert.equal(schreibendeAufrufe(lauf.aufrufe).length, KEIN_AUFRUF);
    assert.match(lauf.ausgabe, /PATCH-KOERPER/);
  });
});

// ---- Riegel 2b: Entwickler-Doku, die mitreisen wuerde --------------------------------
// Diese Vorlage erklaert sich in Schluesseln mit fuehrendem Unterstrich. Der Vergleich
// laesst sie auf der OBERSTEN Ebene einer Sammlung aus - INNERHALB eines Eintrags aber
// nicht, und von dort ginge sie beim Schreiben mit. Der Anbieter kennt solche Schluessel
// nicht. Der Fall ist real: das es-Preset traegt drei Begruendungen in seinem Eintrag;
// waere es je ein NEUER Schluessel (frisch angelegter Agent), kaeme der Eintrag
// vollstaendig aus der Vorlage - samt Doku.
describe("Riegel 2b: ein Doku-Schluessel im Koerper wird abgelehnt, nicht herausgefiltert", () => {
  const ABWEICHUNG_PRESETS = [
    {
      feld: "language_presets",
      art: "namen",
      livePfade: ["conversation_config.language_presets"],
      ausgenommen: null,
    },
  ];
  const befundeFuer = (koerper) =>
    koerperVerstoesse({ koerper, abweichungen: ABWEICHUNG_PRESETS, auswahl: ["language_presets"] });

  it("ein _-Schluessel unter einem gewaehlten Pfad ist ein Befund", () => {
    const koerper = {
      conversation_config: {
        language_presets: { de: { overrides: {}, _begruendung: "steht hier falsch" } },
      },
    };
    const befunde = befundeFuer(koerper);
    assert.equal(befunde.length, 1, `genau ein Befund erwartet, waren: ${befunde}`);
    assert.match(befunde[0], /^ENTWICKLER-DOKU IM KOERPER/);
    assert.match(befunde[0], /_begruendung/);
  });

  it("Positiv-Kontrolle: derselbe Koerper ohne den Doku-Schluessel ist sauber", () => {
    const koerper = {
      conversation_config: { language_presets: { de: { overrides: { agent: {} } } } },
    };
    assert.deepEqual(befundeFuer(koerper), []);
  });
});
