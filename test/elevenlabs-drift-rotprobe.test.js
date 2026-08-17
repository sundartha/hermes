// ROTPROBE fuer den Drift-Waechter (scripts/lib/elevenlabs-besitz.mjs, benutzt
// von npm run elevenlabs:drift): absichtlich kaputt gemachte Live-Agenten
// laufen durch den echten Vergleichs-Kern, und jeder einzelne muss gefangen
// werden.
//
// WARUM DIESE DATEI: der Kern hatte bis hierher keinen einzigen Fall, in dem
// eine absichtliche Abweichung durch ihn hindurchgeschickt wurde. Die einzige
// Rotprobe war Prosa in der Vorlage. Ein Waechter, dem nie etwas vorgelegt
// wurde, ist eine Behauptung - und diese hier deckt die Felder, an denen ein
// stiller Dashboard-Klick teuer wird: den Anrufdauer-Deckel des Anbieters, die
// Adresse und den Vertrag des Rueckfrage-Werkzeugs und die Erlaubnis-Karte, die
// entscheidet, was ein Anrufstart am Agenten ueberhaupt umstellen darf.
//
// SEIT 2026-08-17 STEHT HIER AUCH DIE ZWEITE HAELFTE: nicht nur "wird eine
// Abweichung gefangen", sondern "wurde ueberhaupt etwas angesehen". Der
// Waechter meldete bis dahin OK, ohne dass die Zahl der wirklich verglichenen
// Felder und der wirklich angewandten Verbote in die Entscheidung einging - ein
// Verbot, das auf einen leeren Live-Bereich trifft, galt still als erfuellt.
// Die Faelle bleiben in DIESER Datei und bekommen keine zweite: sie brauchen
// genau denselben synthetischen Live-Agenten wie die Abweichungs-Faelle, und
// eine zweite Datei koennte ihn nur ueber einen Export teilen - womit die
// Fabrik zur oeffentlichen Schnittstelle wuerde, obwohl sie ein Testdetail ist.
//
// KEIN NETZ, KEIN KINDPROZESS: vergleicheBesitz ist reine Rechnung. Verglichen
// wird die ECHTE Vorlagendatei gegen einen synthetischen Live-Agenten. Die
// Blockier-Entscheidung des Kommandos (istBlockierend) ist reine Rechnung ueber
// einen fertigen Befund und wird direkt gerufen - sie ist der einzige Ort, an
// dem "gemeldet" zu "der Lauf faellt durch" wird.
//
// WAS DER SYNTHETISCHE LIVE-AGENT TRAEGT: an jeder Live-Stelle, die die
// Besitz-Erklaerung nennt, den SOLL-Wert der Vorlage - aus der Vorlagendatei
// gelesen, nirgends hier abgeschrieben. Das gilt ausdruecklich auch fuer die
// vier Felder, die heute bewusst vom ECHTEN Live-Stand abweichen; ohne sie
// waere die Positiv-Kontrolle von vornherein rot und damit keine Kontrolle:
//   - conversation_config_override_erlaubnisse traegt zwei PUSH-ABSICHTEN
//     (tts.voice_id SOLL true, conversation.text_only SOLL false) - der echte
//     Agent fuehrt beide bis zum naechsten Push andersherum;
//   - retention_days (SOLL 0) und record_voice (SOLL false) sind in der Vorlage
//     mit Grund und Datum "ausgenommen" - der echte Agent fuehrt -1 bzw. true.
// Der echte Live-Stand gehoert deshalb NICHT in eine Testdatei: er aendert sich
// beim naechsten Push, und ein Test, der ihn abschreibt, misst danach
// Vergangenheit statt den Waechter.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { istBlockierend } from "../scripts/check-elevenlabs-drift.mjs";
import { ladeVorlage } from "../scripts/lib/elevenlabs-agent-lesen.mjs";
import {
  AUSNAHME_HOECHSTALTER_TAGE,
  AUSNAHME_UEBERFAELLIG_MARKE,
  NICHT_PRUEFBAR_MARKE,
  setzeAnPfad,
  vergleicheBesitz,
  wertAnPfad,
} from "../scripts/lib/elevenlabs-besitz.mjs";

const VORLAGE = ladeVorlage();
const BESITZ_FELDER = VORLAGE._besitz.felder;
const BESITZ_REGELN = VORLAGE._besitz.regeln;

// Praefix der reinen Entwickler-Doku in dieser JSON-Datei (Konvention der
// Vorlage selbst, s. deren _platzhalter_konvention): solche Schluessel sind kein
// Werkzeug und gehoeren nicht in die Live-Sammlung.
const DOKU_PRAEFIX = "_";
// Ablage der EIGENEN Werkzeuge beim Anbieter - dort eine Liste, in der Vorlage
// eine Karte (s. _art_hinweis in der Vorlage).
const LIVE_WERKZEUGE = "conversation_config.agent.prompt.tools";
const WERKZEUG_NAME = "get_consult";

// Die Live-Pfade der beiden Faelle, die kein Werkzeug betreffen.
const FELD_MAX_DAUER = "max_duration_seconds";
const LIVE_MAX_DAUER = "conversation_config.conversation.max_duration_seconds";
// Die Sammlung, ueber der das einzige Verbot der Vorlage liegt - aus der
// Erklaerung gelesen und nicht danebengeschrieben: zeigt das Verbot eines Tages
// woandershin, soll dieser Fall mitziehen und nicht still am alten Ort messen.
const LIVE_SPRACH_PRESETS = BESITZ_REGELN[0].live;
// Die ausgenommenen Felder der echten Vorlage, als Daten.
const AUSGENOMMENE_FELDER = BESITZ_FELDER.filter((eintrag) => eintrag.ausgenommen);
// Ein Wert, der von jedem Sollwert abweicht und ausdruecklich NICHT der echte
// Live-Wert ist: gebraucht wird nur "es weicht ab", und der echte Live-Stand
// gehoert nicht in eine Testdatei (s. Kopf).
const ABWEICHENDER_WERT = "Wert aus der Rotprobe, nicht der Live-Stand";
const LIVE_ERLAUBNIS_TEXT_ONLY =
  "platform_settings.overrides.conversation_config_override.conversation.text_only";
const VORLAGE_MAX_DAUER = "agent.conversation_config.conversation.max_duration_seconds";

// Die Verbiegungen. Erfunden ist hier nur der ABWEICHENDE Wert - der Sollwert
// kommt in jedem Fall aus der Vorlagendatei.
const ENTGLEISTER_DECKEL_SEKUNDEN = 3600;
const FREMDER_HOST = "https://fremder-host.example/hermes/consult";
const PARAMETER = "question";
const UMBENANNTER_PARAMETER = "frage";
const ZUSAETZLICHER_HEADER = "x-hermes-tool-token";
const ZUSAETZLICHER_HEADER_WERT = { secret_id: "kennung-aus-dem-test" };

// --- Der synthetische Live-Agent ---

// Traegt an jede Live-Stelle den Wert, den die Vorlage an der zugehoerigen
// Vorlagen-Stelle fuehrt. Gebaut AUS der Besitz-Erklaerung, damit ein neues
// besessenes Feld hier keinen Handgriff braucht - und damit die Positiv-
// Kontrolle nicht an einer vergessenen Zeile scheitert statt an einem Defekt.
function kopiereBesessenePfade(live) {
  for (const eintrag of BESITZ_FELDER) {
    assert.equal(
      eintrag.vorlage.length,
      eintrag.live.length,
      `${eintrag.feld}: die Besitz-Erklaerung nennt je Seite verschieden viele Pfade`,
    );
    for (const [platz, vorlagePfad] of eintrag.vorlage.entries()) {
      const treffer = wertAnPfad(VORLAGE, vorlagePfad);
      if (treffer.gefunden) setzeAnPfad(live, eintrag.live[platz], treffer.wert);
    }
  }
}

// Werkzeuge sind die einzige Sammlung, deren beide Seiten auch INNERE Form
// unterscheidet (tool_config-Wrapper hier, flache Lese-Feldnamen dort). WELCHER
// Vorlagen-Unterpfad auf welchen Live-Unterpfad faellt, sagt die
// Besitz-Erklaerung selbst - je_eintrag -> je_eintrag_live; hier wird darueber
// hinaus nichts gewusst.
const UMBENANNTE_UNTERPFADE = BESITZ_FELDER.filter((eintrag) => eintrag.je_eintrag_live);

function liveWerkzeuge() {
  return Object.entries(VORLAGE.tools)
    .filter(([name]) => !name.startsWith(DOKU_PRAEFIX))
    .map(([name, werkzeug]) => {
      const live = { name };
      for (const eintrag of UMBENANNTE_UNTERPFADE) {
        const treffer = wertAnPfad(werkzeug, eintrag.je_eintrag);
        if (treffer.gefunden) setzeAnPfad(live, eintrag.je_eintrag_live, treffer.wert);
      }
      return live;
    });
}

function baueSauberenLiveAgenten() {
  const live = {};
  kopiereBesessenePfade(live);
  setzeAnPfad(live, LIVE_WERKZEUGE, liveWerkzeuge());
  // Losgeloest von der Vorlage: die Faelle unten verbiegen den Live-Agenten an
  // Ort und Stelle, und ohne diese Kopie truege die eingelesene Vorlage die
  // Verbiegung mit - der Vergleich waere dann beidseits verbogen und gruen.
  return structuredClone(live);
}

// --- Der Bezugstag ---

// Die Ausnahme-Daten der echten Vorlage. Dass es ueberhaupt welche gibt, wird
// unten gemessen: verloere die Vorlage ihre Ausnahmen, pruefte jeder Fristen-Fall
// hier nur noch leere Listen gegen leere Listen und saehe trotzdem gruen aus.
const AUSNAHME_TAGE = AUSGENOMMENE_FELDER.map((eintrag) => eintrag.ausgenommen.seit).sort();
const JUENGSTE_AUSNAHME = AUSNAHME_TAGE[AUSNAHME_TAGE.length - 1];

// Ein Tag, gerechnet vom juengsten Ausnahme-Datum der Vorlage aus. Der Bezug
// kommt aus der Vorlage und nicht aus der Uhr: ein Fall, der die echte Uhr
// liest, wuerde genau AUSNAHME_HOECHSTALTER_TAGE nach dem naechsten
// Ausnahme-Datum von selbst rot - ohne dass irgendetwas kaputt waere.
function tagNachAusnahme(abstandTage) {
  const tag = new Date(`${JUENGSTE_AUSNAHME}T00:00:00Z`);
  tag.setUTCDate(tag.getUTCDate() + abstandTage);
  return tag;
}

const EIN_TAG = 1;
// Genau auf der Frist (noch nicht ueberfaellig) und genau einen Tag darueber -
// die beiden Seiten der Grenze, nicht irgendwo daneben.
const HEUTE_FRISCH = tagNachAusnahme(EIN_TAG);
const HEUTE_AUF_DER_FRIST = tagNachAusnahme(AUSNAHME_HOECHSTALTER_TAGE);
const HEUTE_UEBERFAELLIG = tagNachAusnahme(AUSNAHME_HOECHSTALTER_TAGE + EIN_TAG);

// --- Ablauf eines Falls ---

function befundZu(verbiege, heute = HEUTE_FRISCH) {
  const live = baueSauberenLiveAgenten();
  verbiege(live);
  return vergleicheBesitz({ vorlage: VORLAGE, live, heute });
}

// Entfernt ein Blatt aus dem Live-Agenten. Gegenstueck zu setzeAnPfad, nur hier
// gebraucht: "das Feld steht im Dashboard gar nicht mehr" ist ein anderer
// Sachverhalt als "es steht dort etwas anderes".
function entferneAnPfad(live, pfad) {
  const segmente = pfad.split(".");
  const blatt = segmente.pop();
  const behaelter = wertAnPfad(live, segmente.join("."));
  assert.ok(behaelter.gefunden, `${pfad}: der Behaelter fehlt schon vor dem Entfernen`);
  delete behaelter.wert[blatt];
}

function betroffeneFelder(befund) {
  return befund.abweichungen.map((abweichung) => abweichung.feld);
}

// Das api_schema des Rueckfrage-Werkzeugs im Live-Agenten. Gesucht wird ueber
// den NAMEN und nicht ueber den Listenplatz: ein zusaetzliches Werkzeug in der
// Vorlage wuerde die Faelle unten sonst still auf ein anderes zeigen lassen.
function apiSchemaVon(live) {
  const werkzeuge = wertAnPfad(live, LIVE_WERKZEUGE).wert;
  const werkzeug = werkzeuge.find((eintrag) => eintrag.name === WERKZEUG_NAME);
  assert.ok(werkzeug, `${WERKZEUG_NAME} fehlt im synthetischen Live-Agenten`);
  return werkzeug.api_schema;
}

// Gefangen heisst NICHT "irgendein Fehler": das meldete auch ein Vergleicher,
// der alles rot faerbt. Gefangen heisst - genau das verbogene Feld ist
// gemeldet, kein zweites daneben, die Erklaerung selbst ist heil, und der
// Befund traegt den verbogenen Wert.
function pruefeGefangen({ befund, feld, istWertMuster }) {
  assert.deepEqual(
    befund.fehler,
    [],
    `die Besitz-Erklaerung traegt nicht - dann prueft nichts davon etwas: ${befund.fehler.join(" | ")}`,
  );
  assert.deepEqual(
    betroffeneFelder(befund),
    [feld],
    "der Befund zeigt nicht genau auf das verbogene Feld",
  );
  assert.equal(befund.ok, false, "die Abweichung wurde nicht als solche gewertet");
  const [abweichung] = befund.abweichungen;
  assert.ok(
    abweichung.zeile.startsWith(`ABWEICHUNG ${feld} `),
    `die gedruckte Zeile nennt das Feld nicht zuerst: ${abweichung.zeile}`,
  );
  assert.match(
    JSON.stringify(abweichung.ist.wert),
    istWertMuster,
    "der Befund traegt den verbogenen Live-Wert nicht",
  );
}

describe("Drift-Waechter: absichtliche Abweichungen durch den echten Vergleich", () => {
  it("Positiv-Kontrolle: ein Live-Agent mit genau den Sollwerten der Vorlage kommt sauber durch", () => {
    const befund = befundZu(() => {});
    assert.deepEqual(befund.fehler, [], `Fehler in der Besitz-/Regel-Erklaerung: ${befund.fehler}`);
    assert.deepEqual(betroffeneFelder(befund), [], "unerwartete Abweichung");
    assert.deepEqual(befund.verletzungen, [], "unerwartete Verbots-Verletzung");
    assert.deepEqual(befund.nichtPruefbar, [], "eine Stelle konnte gar nicht angesehen werden");
    assert.deepEqual(befund.veralteteAusnahmen, [], "unerwartet ueberfaellige Ausnahme");
    assert.equal(befund.ok, true);
    assert.equal(istBlockierend(befund), false, "der saubere Stand wuerde den Lauf blockieren");
    // Ohne diese Zahlen saehe ein Vergleich, der NICHTS anschaut, genau so aus
    // wie einer, der nichts findet - und alle Faelle darunter bewiesen dann
    // nichts. Verlangt ist nicht "> 0", sondern die Soll-Zahl der Erklaerung.
    assert.equal(befund.felderSoll, BESITZ_FELDER.length);
    assert.equal(befund.geprueft, befund.felderSoll, "nicht jedes besessene Feld wurde verglichen");
    assert.equal(befund.regelnSoll, BESITZ_REGELN.length);
    assert.equal(
      befund.regelnAngewandt,
      befund.regelnSoll,
      "nicht jedes Verbot kam an einen Eintrag",
    );
    assert.ok(befund.geprueftRegeln > 0, "kein einziges Verbot wurde gegen einen Eintrag gehalten");
  });

  it("max_duration_seconds: der Notaus-Deckel des Anbieters springt auf das Sechsfache - gefangen", () => {
    const befund = befundZu((live) =>
      setzeAnPfad(live, LIVE_MAX_DAUER, ENTGLEISTER_DECKEL_SEKUNDEN),
    );
    pruefeGefangen({
      befund,
      feld: FELD_MAX_DAUER,
      istWertMuster: new RegExp(`^${ENTGLEISTER_DECKEL_SEKUNDEN}$`),
    });
    const [gemeldet] = befund.abweichungen;
    assert.equal(
      gemeldet.soll.wert,
      wertAnPfad(VORLAGE, VORLAGE_MAX_DAUER).wert,
      "der SOLL-Wert im Befund stammt nicht aus der Vorlage",
    );
  });

  it("werkzeug_api_url: die Adresse des Rueckfrage-Werkzeugs zeigt auf einen fremden Host - gefangen", () => {
    const befund = befundZu((live) => {
      apiSchemaVon(live).url = FREMDER_HOST;
    });
    pruefeGefangen({ befund, feld: "werkzeug_api_url", istWertMuster: /fremder-host\.example/ });
  });

  it("werkzeug_body_params_schema: ein Feld im Rumpf-Schema des Werkzeugs wird umbenannt - gefangen", () => {
    const befund = befundZu((live) => {
      const schema = apiSchemaVon(live).request_body_schema;
      schema.properties[UMBENANNTER_PARAMETER] = schema.properties[PARAMETER];
      delete schema.properties[PARAMETER];
      schema.required = [UMBENANNTER_PARAMETER];
    });
    pruefeGefangen({
      befund,
      feld: "werkzeug_body_params_schema",
      istWertMuster: new RegExp(UMBENANNTER_PARAMETER),
    });
  });

  it("werkzeug_api_header: dem Werkzeug kommt ein Header hinzu - gefangen", () => {
    const befund = befundZu((live) => {
      apiSchemaVon(live).request_headers[ZUSAETZLICHER_HEADER] = ZUSAETZLICHER_HEADER_WERT;
    });
    pruefeGefangen({
      befund,
      feld: "werkzeug_api_header",
      istWertMuster: new RegExp(ZUSAETZLICHER_HEADER),
    });
  });

  it("conversation_config_override_erlaubnisse: text_only springt auf true - gefangen", () => {
    const befund = befundZu((live) => setzeAnPfad(live, LIVE_ERLAUBNIS_TEXT_ONLY, true));
    pruefeGefangen({
      befund,
      feld: "conversation_config_override_erlaubnisse",
      istWertMuster: /"text_only":true/,
    });
  });
});

// --- Was gar nicht erst angesehen wurde ---

// Eine winzige EIGENE Besitz-Erklaerung. Sie ist NICHT die zweite Fabrik fuer
// einen synthetischen Live-Agenten (kein einziger Wert des echten Agenten steht
// hier), sondern der einzige Weg, den Ausfallweg in Reinform zu zeigen: an der
// echten Vorlage liegt das Verbot auf language_presets, und dieselbe Sammlung
// ist zusaetzlich ein besessenes Feld - deren Abweichung verdeckt, dass das
// Verbot selbst nichts geprueft hat. Hier passt beides zusammen, also bleibt
// genau eine Frage uebrig: was meldet der Kern, wenn ein Verbot auf nichts
// trifft?
const NUR_VERBOT = {
  regel: "nichts_heikles_je_eintrag",
  art: "verboten_je_eintrag",
  live: "sammlung",
  verboten: ["heikel"],
  meldung: "Kein Eintrag dieser Sammlung darf 'heikel' setzen.",
};
const NUR_VERBOT_VORLAGE = {
  _besitz: {
    felder: [{ feld: "wert", art: "wert", vorlage: ["soll"], live: ["ist"] }],
    regeln: [NUR_VERBOT],
  },
  soll: "gleich",
};
const GLEICHER_WERT = "gleich";

function befundZuSammlung(sammlung) {
  return vergleicheBesitz({
    vorlage: NUR_VERBOT_VORLAGE,
    live: { ist: GLEICHER_WERT, sammlung },
    heute: HEUTE_FRISCH,
  });
}

function zeileMit(zeilen, marke, name) {
  return zeilen.find((zeile) => zeile.startsWith(`${marke} ${name} `));
}

describe("Drift-Waechter: eine Stelle, die nie angesehen wurde, ist ein Befund", () => {
  it("Positiv-Kontrolle: ein Verbot, das einen echten Eintrag vorfindet, ist angewandt und gruen", () => {
    const befund = befundZuSammlung({ echter_eintrag: { harmlos: true } });
    assert.equal(befund.ok, true, `unerwartet nicht sauber: ${JSON.stringify(befund)}`);
    assert.equal(befund.regelnAngewandt, befund.regelnSoll);
    assert.equal(befund.geprueftRegeln, 1);
    assert.equal(istBlockierend(befund), false);
  });

  it("ein Verbot ueber einer leeren Live-Sammlung ist nicht erfuellt, sondern nicht pruefbar", () => {
    const befund = befundZuSammlung({});
    assert.equal(befund.geprueftRegeln, 0, "es wurde doch ein Eintrag angesehen");
    assert.equal(befund.regelnAngewandt, 0, "das Verbot gilt als angewandt, ohne es zu sein");
    assert.equal(befund.regelnSoll, 1);
    assert.ok(
      zeileMit(befund.nichtPruefbar, NICHT_PRUEFBAR_MARKE, NUR_VERBOT.regel),
      `keine Zeile zu ${NUR_VERBOT.regel}: ${befund.nichtPruefbar.join(" | ")}`,
    );
    assert.deepEqual(befund.abweichungen, [], "der Fall darf an nichts anderem haengen");
    assert.deepEqual(befund.fehler, [], "nicht pruefbar ist kein Fehler in der Erklaerung");
    assert.equal(befund.ok, false, "ein ungepruefter Waechter meldet sauber");
    assert.equal(istBlockierend(befund), true, "der Lauf laeuft trotzdem durch");
  });

  it("eine Sammlung, die nur Entwickler-Doku fuehrt, hat keinen Eintrag - der _-Schluessel zaehlt nicht", () => {
    const befund = befundZuSammlung({ _hinweis: "kein Eintrag, sondern Prosa fuer Menschen" });
    assert.equal(befund.geprueftRegeln, 0, "ein _-Schluessel wurde als Eintrag mitgezaehlt");
    assert.equal(befund.regelnAngewandt, 0);
    assert.ok(
      zeileMit(befund.nichtPruefbar, NICHT_PRUEFBAR_MARKE, NUR_VERBOT.regel),
      `keine Zeile zu ${NUR_VERBOT.regel}: ${befund.nichtPruefbar.join(" | ")}`,
    );
  });

  it("das echte Verbot der Vorlage ueber leeren language_presets: 0 von 1 angewandt", () => {
    const befund = befundZu((live) => setzeAnPfad(live, LIVE_SPRACH_PRESETS, {}));
    assert.equal(befund.regelnSoll, BESITZ_REGELN.length);
    assert.equal(befund.regelnAngewandt, 0, "das einzige Verbot gilt als angewandt");
    assert.equal(befund.geprueftRegeln, 0);
    assert.ok(
      zeileMit(befund.nichtPruefbar, NICHT_PRUEFBAR_MARKE, BESITZ_REGELN[0].regel),
      `keine Zeile zum echten Verbot: ${befund.nichtPruefbar.join(" | ")}`,
    );
    assert.equal(istBlockierend(befund), true);
  });

  it("ein besessenes Feld, das der Live-Agent gar nicht fuehrt, zaehlt nicht als geprueft", () => {
    const befund = befundZu((live) => entferneAnPfad(live, LIVE_MAX_DAUER));
    assert.equal(befund.felderSoll, BESITZ_FELDER.length);
    assert.equal(
      befund.geprueft,
      BESITZ_FELDER.length - 1,
      "das fehlende Feld wurde als geprueft mitgezaehlt",
    );
    assert.ok(
      zeileMit(befund.nichtPruefbar, NICHT_PRUEFBAR_MARKE, FELD_MAX_DAUER),
      `keine Zeile zu ${FELD_MAX_DAUER}: ${befund.nichtPruefbar.join(" | ")}`,
    );
    // Die Abweichung bleibt zusaetzlich stehen: dass die Vorlage etwas fuehrt,
    // was der Agent nicht hat, ist ein eigener Befund - und der Push soll ihn
    // weiterhin reparieren koennen.
    assert.deepEqual(betroffeneFelder(befund), [FELD_MAX_DAUER]);
    assert.equal(istBlockierend(befund), true);
  });
});

describe("Drift-Waechter: eine Ausnahme ohne Verfallsdatum ist keine Ausnahme", () => {
  it("die echte Vorlage fuehrt ueberhaupt Ausnahmen - sonst misst kein Fristen-Fall etwas", () => {
    assert.ok(AUSNAHME_TAGE.length > 0, "keine ausgenommenen Felder in der Vorlage");
    assert.match(JUENGSTE_AUSNAHME, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("frisch und genau auf der Frist wird nichts gemeldet", () => {
    for (const heute of [HEUTE_FRISCH, HEUTE_AUF_DER_FRIST]) {
      const befund = befundZu(() => {}, heute);
      assert.deepEqual(
        befund.veralteteAusnahmen,
        [],
        `am ${heute.toISOString()} wurde eine Ausnahme als ueberfaellig gemeldet`,
      );
      assert.equal(istBlockierend(befund), false);
    }
  });

  it("einen Tag ueber der Frist wird jede Ausnahme laut gemeldet und blockiert", () => {
    const befund = befundZu(() => {}, HEUTE_UEBERFAELLIG);
    for (const eintrag of AUSGENOMMENE_FELDER) {
      assert.ok(
        zeileMit(befund.veralteteAusnahmen, AUSNAHME_UEBERFAELLIG_MARKE, eintrag.feld),
        `keine Zeile zu ${eintrag.feld}: ${befund.veralteteAusnahmen.join(" | ")}`,
      );
    }
    assert.equal(befund.veralteteAusnahmen.length, AUSGENOMMENE_FELDER.length);
    // Ohne Abweichung an diesen Feldern: die Frist haengt an der festgehaltenen
    // Entscheidung, nicht am Unterschied - der synthetische Agent traegt hier
    // ueberall den Sollwert.
    assert.deepEqual(betroffeneFelder(befund), []);
    assert.equal(istBlockierend(befund), true, "eine ueberfaellige Ausnahme blockiert nicht");
  });

  it("Gegenprobe zur Unterscheidung: eine GUELTIGE Ausnahme blockiert weiterhin nicht", () => {
    const befund = befundZu((live) => {
      for (const eintrag of AUSGENOMMENE_FELDER) {
        for (const pfad of eintrag.live) setzeAnPfad(live, pfad, ABWEICHENDER_WERT);
      }
    });
    const ausgenommen = befund.abweichungen.filter((abweichung) => abweichung.ausgenommen);
    assert.equal(
      ausgenommen.length,
      befund.abweichungen.length,
      "es weicht mehr ab als die ausgenommenen Felder",
    );
    assert.ok(ausgenommen.length > 0, "es weicht gar nichts ab - der Fall misst nichts");
    assert.equal(befund.ok, false, "ausgenommen heisst nicht gruen");
    assert.equal(istBlockierend(befund), false, "eine gueltige Ausnahme blockiert den Lauf");
  });
});
