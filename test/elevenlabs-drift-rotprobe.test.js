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
// KEIN NETZ, KEIN KINDPROZESS: vergleicheBesitz ist reine Rechnung. Verglichen
// wird die ECHTE Vorlagendatei gegen einen synthetischen Live-Agenten.
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

import { ladeVorlage } from "../scripts/lib/elevenlabs-agent-lesen.mjs";
import { setzeAnPfad, vergleicheBesitz, wertAnPfad } from "../scripts/lib/elevenlabs-besitz.mjs";

const VORLAGE = ladeVorlage();
const BESITZ_FELDER = VORLAGE._besitz.felder;

// Praefix der reinen Entwickler-Doku in dieser JSON-Datei (Konvention der
// Vorlage selbst, s. deren _platzhalter_konvention): solche Schluessel sind kein
// Werkzeug und gehoeren nicht in die Live-Sammlung.
const DOKU_PRAEFIX = "_";
// Ablage der EIGENEN Werkzeuge beim Anbieter - dort eine Liste, in der Vorlage
// eine Karte (s. _art_hinweis in der Vorlage).
const LIVE_WERKZEUGE = "conversation_config.agent.prompt.tools";
const WERKZEUG_NAME = "get_consult";

// Die Live-Pfade der beiden Faelle, die kein Werkzeug betreffen.
const LIVE_MAX_DAUER = "conversation_config.conversation.max_duration_seconds";
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

// --- Ablauf eines Falls ---

function befundZu(verbiege) {
  const live = baueSauberenLiveAgenten();
  verbiege(live);
  return vergleicheBesitz({ vorlage: VORLAGE, live });
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
    const befund = vergleicheBesitz({ vorlage: VORLAGE, live: baueSauberenLiveAgenten() });
    assert.deepEqual(befund.fehler, [], `Fehler in der Besitz-/Regel-Erklaerung: ${befund.fehler}`);
    assert.deepEqual(betroffeneFelder(befund), [], "unerwartete Abweichung");
    assert.deepEqual(befund.verletzungen, [], "unerwartete Verbots-Verletzung");
    assert.equal(befund.ok, true);
    // Ohne diese beiden Zahlen saehe ein Vergleich, der NICHTS anschaut, genau
    // so aus wie einer, der nichts findet - und alle Faelle darunter bewiesen
    // dann nichts.
    assert.equal(befund.geprueft, BESITZ_FELDER.length);
    assert.ok(befund.geprueftRegeln > 0, "kein einziges Verbot wurde gegen einen Eintrag gehalten");
  });

  it("max_duration_seconds: der Notaus-Deckel des Anbieters springt auf das Sechsfache - gefangen", () => {
    const befund = befundZu((live) =>
      setzeAnPfad(live, LIVE_MAX_DAUER, ENTGLEISTER_DECKEL_SEKUNDEN),
    );
    pruefeGefangen({
      befund,
      feld: "max_duration_seconds",
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
