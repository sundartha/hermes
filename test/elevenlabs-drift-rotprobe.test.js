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

const DOKU_PRAEFIX = "_";
const LIVE_WERKZEUGE = "conversation_config.agent.prompt.tools";
const WERKZEUG_NAME = "get_consult";

const FELD_MAX_DAUER = "max_duration_seconds";
const LIVE_MAX_DAUER = "conversation_config.conversation.max_duration_seconds";
const LIVE_SPRACH_PRESETS = BESITZ_REGELN[0].live;
const AUSGENOMMENE_FELDER = BESITZ_FELDER.filter((eintrag) => eintrag.ausgenommen);
const ABWEICHENDER_WERT = "Wert aus der Rotprobe, nicht der Live-Stand";
const LIVE_ERLAUBNIS_TEXT_ONLY =
  "platform_settings.overrides.conversation_config_override.conversation.text_only";
const VORLAGE_MAX_DAUER = "agent.conversation_config.conversation.max_duration_seconds";
const FELD_VOICEMAIL = "voicemail_message";
const LIVE_VOICEMAIL_BLATT =
  "conversation_config.agent.prompt.built_in_tools.voicemail_detection.params.voicemail_message";
const VOICEMAIL_PLATZHALTER = "{{voicemail_line}}";
const ZURUECKGESCHRIEBENER_TEXT = `${ABWEICHENDER_WERT} ${VOICEMAIL_PLATZHALTER}`;

const ENTGLEISTER_DECKEL_SEKUNDEN = 3600;
const FREMDER_HOST = "https://fremder-host.example/hermes/consult";
const PARAMETER = "question";
const UMBENANNTER_PARAMETER = "frage";
const ZUSAETZLICHER_HEADER = "x-hermes-tool-token";
const ZUSAETZLICHER_HEADER_WERT = { secret_id: "kennung-aus-dem-test" };

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
  return structuredClone(live);
}

const AUSNAHME_TAGE = AUSGENOMMENE_FELDER.map((eintrag) => eintrag.ausgenommen.seit).sort();
const JUENGSTE_AUSNAHME = AUSNAHME_TAGE[AUSNAHME_TAGE.length - 1];

function tagNachAusnahme(abstandTage) {
  const tag = new Date(`${JUENGSTE_AUSNAHME}T00:00:00Z`);
  tag.setUTCDate(tag.getUTCDate() + abstandTage);
  return tag;
}

const EIN_TAG = 1;
const HEUTE_FRISCH = tagNachAusnahme(EIN_TAG);
const HEUTE_AUF_DER_FRIST = tagNachAusnahme(AUSNAHME_HOECHSTALTER_TAGE);
const HEUTE_UEBERFAELLIG = tagNachAusnahme(AUSNAHME_HOECHSTALTER_TAGE + EIN_TAG);

function befundZu(verbiege, heute = HEUTE_FRISCH) {
  const live = baueSauberenLiveAgenten();
  verbiege(live);
  return vergleicheBesitz({ vorlage: VORLAGE, live, heute });
}

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

function apiSchemaVon(live) {
  const werkzeuge = wertAnPfad(live, LIVE_WERKZEUGE).wert;
  const werkzeug = werkzeuge.find((eintrag) => eintrag.name === WERKZEUG_NAME);
  assert.ok(werkzeug, `${WERKZEUG_NAME} fehlt im synthetischen Live-Agenten`);
  return werkzeug.api_schema;
}

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

  it("voicemail_message: im Dashboard steht wieder gesprochener Text im Anrufbeantworter-Werkzeug - gefangen", () => {
    const befund = befundZu((live) =>
      setzeAnPfad(live, LIVE_VOICEMAIL_BLATT, ZURUECKGESCHRIEBENER_TEXT),
    );
    pruefeGefangen({ befund, feld: FELD_VOICEMAIL, istWertMuster: new RegExp(ABWEICHENDER_WERT) });
  });

  it("voicemail_message: das Blatt verschwindet ganz - gefangen, und zwar zweimal", () => {
    const befund = befundZu((live) => entferneAnPfad(live, LIVE_VOICEMAIL_BLATT));
    assert.deepEqual(befund.fehler, [], `die Besitz-Erklaerung traegt nicht: ${befund.fehler}`);
    assert.deepEqual(betroffeneFelder(befund).sort(), ["dynamic_variables", FELD_VOICEMAIL]);
    assert.equal(befund.ok, false, "das geloeschte Blatt wurde nicht als Abweichung gewertet");
  });
});

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
