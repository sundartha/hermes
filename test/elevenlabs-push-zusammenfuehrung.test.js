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
//
// SEIT SP2 (2026-09-04) IST data_collection NICHT MEHR DER EINZIGE ANWENDUNGSFALL:
// derselbe Schreibweg traegt jetzt auch die eingebauten Werkzeuge
// (built_in_tools), weil der Anbieter das Werkzeug-Objekt beim PATCH ERSETZT
// statt zu mergen - ein Koerper mit nur dem Blattpfad endete in HTTP 400. Der
// Abschnitt am Dateiende misst genau das an derselben Mechanik.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { setzeAnPfad, vergleicheBesitz, wertAnPfad } from "../scripts/lib/elevenlabs-besitz.mjs";
import {
  KEIN_AUFRUF,
  LIVE_MIT_DATENSCHUTZ,
  TEST_SCHLUESSEL,
  UNKONFIGURIERTES_WERKZEUG,
  VOICEMAIL_LIVE_TEXT,
  laufeMitAttrappe,
  liveWerkzeuge,
  schreibendeAufrufe,
} from "./helpers/elevenlabs-push-attrappe.mjs";

process.env.ELEVENLABS_API_KEY = TEST_SCHLUESSEL;
// Beide DYNAMISCH und erst nach dem Schluessel: sie ziehen src/config.js mit, das den
// Schluessel beim Laden EINMAL liest. Ein statisches import wuerde hochgezogen und jeden Lauf
// fail-closed abbrechen lassen, bevor er den gemessenen Riegel ueberhaupt erreicht.
// (elevenlabs-besitz.mjs oben bleibt statisch - reine Rechnung, keine Konfiguration.)
const { ladeVorlage } = await import("../scripts/lib/elevenlabs-agent-lesen.mjs");
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

// ---- Der gelesene Live-Stand bleibt unveraendert --------------------------------------
// Gefunden beim Selbst-Durchgang, nicht durch einen roten Test: die Zusammenfuehrung
// kopierte den Live-Eintrag FLACH. Bei einem verschachtelten besessenen Blatt (wie
// "overrides.agent.first_message" bei den Sprach-Presets) teilen flache Kopie und Original
// die Zwischenebenen - der Schreibwert haette den gelesenen Stand an Ort und Stelle
// umgeschrieben, und die trockene Vorhersage rechnete danach gegen einen Stand, den sie
// selbst schon veraendert hat.
describe("Die Zusammenfuehrung fasst den gelesenen Live-Stand nicht an", () => {
  const VERSCHACHTELT = ["overrides.agent.first_message"];

  function verschachtelteAbweichung() {
    return {
      ...abweichung(),
      schreibwegBesitz: VERSCHACHTELT,
      livePfade: ["conversation_config.language_presets"],
      vorlagePfade: ["agent.conversation_config.language_presets"],
    };
  }

  it("ein verschachteltes Blatt veraendert das Live-Objekt NICHT", () => {
    const live = {
      conversation_config: {
        language_presets: { de: { overrides: { agent: { first_message: "ALT" } } } },
      },
    };
    const vorlage = {
      agent: {
        conversation_config: {
          language_presets: { de: { overrides: { agent: { first_message: "NEU" } } } },
        },
      },
    };
    const { schreibbar, fehler } = mitSchreibwerten({
      schreibbar: [verschachtelteAbweichung()],
      vorlage,
      live,
    });
    assert.deepEqual(fehler, []);
    const ersterSatz = (presets) => {
      const preset = presets.de;
      return preset.overrides.agent.first_message;
    };
    assert.equal(
      ersterSatz(schreibbar[0].schreibWert),
      "NEU",
      "der Schreibwert traegt den neuen Text nicht",
    );
    assert.equal(
      ersterSatz(live.conversation_config.language_presets),
      "ALT",
      "der GELESENE Live-Stand wurde mitveraendert - dann rechnet die Vorhersage gegen einen Stand, den sie selbst umgeschrieben hat",
    );
  });
});

// ---- SP2: die eingebauten Werkzeuge als Sammlung --------------------------------------
// Der Anbieter ERSETZT ein Werkzeug-Objekt beim PATCH, statt zu mergen: ein Koerper, der nur
// das Blatt built_in_tools.voicemail_detection.params.voicemail_message trug, endete am
// 2026-09-04 mit HTTP 400 ("Field required, param: ...voicemail_detection.name") - damit war
// KEIN Werkzeug-Feld pushbar. Der Besitz-Eintrag zeigt seither auf die SAMMLUNG
// built_in_tools (art "texte", je_eintrag "params.voicemail_message") und erklaert denselben
// Schreibweg wie die Sprach-Presets. Gemessen wird hier, dass der Koerper das VOLLE Werkzeug
// traegt und trotzdem nur dieses eine Blatt aus der Vorlage kommt.
const WERKZEUGE_LIVE_PFAD = "conversation_config.agent.prompt.built_in_tools";
const WERKZEUGE_VORLAGE_PFAD = "agent.conversation_config.agent.prompt.built_in_tools";
const WERKZEUG_FELD = "voicemail_message";
const BLATT = "params.voicemail_message";
const VOICEMAIL = "voicemail_detection";
const END_CALL = "end_call";
const SPRACHERKENNUNG = "language_detection";
// Der Platzhalter, den die Vorlage seit DE1 fuehrt - nicht der Text, den der Anbieter daraus
// macht (der entsteht pro Anruf in src/elevenlabs/outbound.js).
const SOLL_TEXT = "{{voicemail_line}}";
// Die Marke, die art "texte" fuer ein fehlendes Blatt setzt.
const FEHLT = "(fehlt)";
// Die zwei Stellen der Koerper-Zeile, an denen Fall (5) sie auseinandernimmt.
const KOERPER_MARKE = "PATCH-KOERPER";
const PFAD_LISTE_MARKE = "nichts sonst: ";
const LISTEN_TRENNER = ", ";

const ECHTE_VORLAGE = ladeVorlage();

// Die Werkzeug-Fabrik liegt beim gestellten Live-Agenten (helpers/…-attrappe.mjs) und nicht
// hier: derselbe Aufbau traegt seit SP2 auch LIVE_MIT_DATENSCHUTZ, und zwei Fabriken fuer
// dieselbe Sammlung wuerden gegeneinander driften.
function liveMitWerkzeugen(werkzeuge) {
  const live = structuredClone(LIVE_MIT_DATENSCHUTZ);
  setzeAnPfad(live, WERKZEUGE_LIVE_PFAD, werkzeuge);
  return live;
}

// Die Vorlagen-Seite spiegelt die echte Vorlage: drei Werkzeuge, nur type und name, das
// Anrufbeantworter-Werkzeug zusaetzlich mit dem besessenen Blatt UND einem Doku-Schluessel.
// Der beweist Zusage (2) doppelt - der Koerper darf ihn nicht tragen.
function werkzeugVorlage() {
  const vorlage = {};
  setzeAnPfad(vorlage, WERKZEUGE_VORLAGE_PFAD, {
    [SPRACHERKENNUNG]: { type: "system", name: SPRACHERKENNUNG },
    [END_CALL]: { type: "system", name: END_CALL },
    [VOICEMAIL]: {
      type: "system",
      name: VOICEMAIL,
      params: { voicemail_message: SOLL_TEXT },
      _begruendung: "Doku der Vorlage - sie gehoert nicht in die Konfiguration des Anbieters.",
    },
  });
  return vorlage;
}

// Die Mengen-Form, die art "texte" vergleicht: "<name> = <text>", alphabetisch. Von Hand nur
// an der gestellten Abweichung - im echten Lauf (Fall 5 und 6) baut der Vergleichs-Kern sie
// selbst.
function texteMenge(voicemailText) {
  return [
    `${END_CALL} = ${FEHLT}`,
    `${SPRACHERKENNUNG} = ${FEHLT}`,
    `${VOICEMAIL} = ${voicemailText}`,
  ];
}

function werkzeugAbweichung() {
  return {
    feld: WERKZEUG_FELD,
    art: "texte",
    livePfade: [WERKZEUGE_LIVE_PFAD],
    vorlagePfade: [WERKZEUGE_VORLAGE_PFAD],
    schreibweg: "je_schluessel",
    schreibwegBesitz: [BLATT],
    soll: { vorhanden: true, wert: texteMenge(SOLL_TEXT) },
    ist: { vorhanden: true, wert: texteMenge(VOICEMAIL_LIVE_TEXT) },
    ausgenommen: null,
  };
}

function fuehreWerkzeugeZusammen(werkzeuge) {
  return mitSchreibwerten({
    schreibbar: [werkzeugAbweichung()],
    vorlage: werkzeugVorlage(),
    live: liveMitWerkzeugen(werkzeuge),
  });
}

// Der Koerper, wie ihn das Kommando aus einem Schreibwert baut - gebraucht fuer die Riegel,
// die den FERTIGEN Koerper ansehen.
function koerperMit(schreibWert) {
  const koerper = {};
  setzeAnPfad(koerper, WERKZEUGE_LIVE_PFAD, schreibWert);
  return koerper;
}

// Gestufter Leser statt einer Punktkette ueber fuenf Ebenen (G36).
function voicemailTextVon(schreibWert) {
  return wertAnPfad(schreibWert, `${VOICEMAIL}.${BLATT}`).wert;
}

describe("SP2: der Patch-Koerper traegt das ganze Werkzeug, geaendert wird ein Blatt", () => {
  it("(1) der Koerper fuehrt ALLE eingebauten Werkzeuge der Live-Sammlung", () => {
    const { schreibbar, fehler } = fuehreWerkzeugeZusammen(liveWerkzeuge());
    assert.deepEqual(fehler, []);
    assert.deepEqual(Object.keys(schreibbar[0].schreibWert).sort(), [
      END_CALL,
      SPRACHERKENNUNG,
      VOICEMAIL,
    ]);
  });

  it("(2) name, type und die nicht besessenen params bleiben byte-identisch, Doku reist nicht mit", () => {
    const werkzeuge = liveWerkzeuge();
    const { schreibbar } = fuehreWerkzeugeZusammen(werkzeuge);
    const wert = schreibbar[0].schreibWert;
    for (const name of [END_CALL, SPRACHERKENNUNG]) {
      assert.deepEqual(
        wert[name],
        werkzeuge[name],
        `${name} wurde veraendert - die Vorlage fuehrt an diesem Werkzeug kein besessenes Blatt`,
      );
    }
    const gemeint = werkzeuge[VOICEMAIL];
    assert.equal(wert[VOICEMAIL].name, gemeint.name);
    assert.equal(wert[VOICEMAIL].type, gemeint.type);
    assert.equal(wert[VOICEMAIL].params.system_tool_type, gemeint.params.system_tool_type);
    // Riegel 2b am fertigen Koerper: der _-Schluessel der Vorlage waere hier ein Befund.
    assert.deepEqual(
      koerperVerstoesse({
        koerper: koerperMit(wert),
        abweichungen: [werkzeugAbweichung()],
        auswahl: [WERKZEUG_FELD],
      }),
      [],
    );
  });

  it("(3) nur voicemail_message traegt den Vorlagenwert", () => {
    const { schreibbar } = fuehreWerkzeugeZusammen(liveWerkzeuge());
    assert.equal(voicemailTextVon(schreibbar[0].schreibWert), SOLL_TEXT);
  });

  it("(3) Positiv-Kontrolle: stimmt der Live-Text schon, ist es derselbe Wert - keine Zufallsuebereinstimmung", () => {
    const { schreibbar } = fuehreWerkzeugeZusammen(liveWerkzeuge(SOLL_TEXT));
    assert.equal(voicemailTextVon(schreibbar[0].schreibWert), SOLL_TEXT);
  });

  it("(3b) ein live auf null stehendes Systemwerkzeug reist NICHT mit - es traegt keine Konfiguration", () => {
    const { schreibbar } = fuehreWerkzeugeZusammen(liveWerkzeuge());
    assert.ok(
      !(UNKONFIGURIERTES_WERKZEUG in schreibbar[0].schreibWert),
      `${UNKONFIGURIERTES_WERKZEUG} steht live auf null und gehoert damit nicht in den Koerper`,
    );
  });
});

describe("SP2: ein nur live vorhandenes Werkzeug bricht ab, statt zu verschwinden", () => {
  it("(4) die Zusammenfuehrung meldet es mit der BESTEHENDEN Meldung und liefert keinen Schreibwert", () => {
    const werkzeuge = liveWerkzeuge();
    werkzeuge[FREMD] = { name: FREMD, type: "system", params: {} };
    const { schreibbar, fehler } = fuehreWerkzeugeZusammen(werkzeuge);
    assert.equal(fehler.length, 1, `genau ein Fehler erwartet, waren: ${fehler}`);
    assert.match(fehler[0], /fuehrt Schluessel, die die Vorlage nicht kennt/);
    assert.match(fehler[0], new RegExp(FREMD));
    assert.deepEqual(schreibbar, [], "trotz Fehler blieb ein Schreibwert stehen");
  });

  it("(4) Positiv-Kontrolle: derselbe Aufbau ohne das fremde Werkzeug laeuft sauber durch", () => {
    const { schreibbar, fehler } = fuehreWerkzeugeZusammen(liveWerkzeuge());
    assert.deepEqual(fehler, []);
    assert.equal(schreibbar.length, 1);
  });
});

describe("SP2: am ganzen Kommando, gegen die ECHTE Vorlage", () => {
  it("(5) der Trockenlauf baut einen Koerper, dessen Blatt-Pfade AUSSCHLIESSLICH unter built_in_tools liegen", async () => {
    const lauf = await laufeMitAttrappe({
      runCli: RUN_CLI,
      argumente: [`--felder=${WERKZEUG_FELD}`],
      live: liveMitWerkzeugen(liveWerkzeuge()),
    });
    assert.equal(lauf.code, 0, `Exit 0 erwartet, Ausgabe war: ${lauf.ausgabe}`);
    assert.deepEqual(schreibendeAufrufe(lauf.aufrufe), [], "es wurde geschrieben");
    const zeile = lauf.ausgabe.split("\n").find((eine) => eine.includes(KOERPER_MARKE));
    assert.ok(zeile, `keine ${KOERPER_MARKE}-Zeile, Ausgabe war: ${lauf.ausgabe}`);
    const pfade = zeile.split(PFAD_LISTE_MARKE)[1].split(LISTEN_TRENNER);
    // Ohne diese Zeile bestuende die Schleife darunter auch ueber einer leeren Liste - ein
    // Riegel, der nichts ansieht, sieht aus wie einer, der nichts findet.
    assert.ok(
      pfade.includes(`${WERKZEUGE_LIVE_PFAD}.${VOICEMAIL}.${BLATT}`),
      `das gemeinte Blatt steht gar nicht im Koerper: ${pfade.join(LISTEN_TRENNER)}`,
    );
    for (const pfad of pfade) {
      assert.ok(
        pfad.startsWith(`${WERKZEUGE_LIVE_PFAD}.`),
        `der Koerper traegt einen Pfad ausserhalb der Werkzeug-Sammlung: ${pfad}`,
      );
    }
  });

  it("(6) Vorhersage: voicemail_message wird gruen, nichts sonst wird neu rot", () => {
    const live = liveMitWerkzeugen(liveWerkzeuge());
    const vorher = vergleicheBesitz({ vorlage: ECHTE_VORLAGE, live });
    assert.deepEqual(vorher.fehler, [], `die Besitz-Erklaerung traegt nicht: ${vorher.fehler}`);
    const abweichung = vorher.abweichungen.find((eine) => eine.feld === WERKZEUG_FELD);
    assert.ok(abweichung, `${WERKZEUG_FELD} weicht gar nicht ab - der Fall misst nichts`);
    const { schreibbar, fehler } = mitSchreibwerten({
      schreibbar: [abweichung],
      vorlage: ECHTE_VORLAGE,
      live,
    });
    assert.deepEqual(fehler, []);
    const klon = structuredClone(live);
    setzeAnPfad(klon, WERKZEUGE_LIVE_PFAD, schreibbar[0].schreibWert);
    const nachher = vergleicheBesitz({ vorlage: ECHTE_VORLAGE, live: klon });
    assert.deepEqual(nachher.fehler, []);
    const felderVon = (befund) => befund.abweichungen.map((eine) => eine.feld);
    const ohne = (links, rechts) => links.filter((feld) => !rechts.includes(feld));
    assert.deepEqual(ohne(felderVon(vorher), felderVon(nachher)), [WERKZEUG_FELD]);
    assert.deepEqual(ohne(felderVon(nachher), felderVon(vorher)), []);
  });
});
