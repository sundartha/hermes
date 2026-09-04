// ---- OC-P2: die Owner-Ausnahme auf dem LIVE-Pfad (ElevenLabs) ------------------------
// Traegt ein Anruf call.calleeIsOwner === true (Praedikat aus OC-P1, src/callee-is-owner.js),
// dann eroeffnet er ohne den langen Offenlegungssatz - aber weiterhin KI-identifizierend -
// und der Prompt bekommt eine Sektion, die den Auftraggeber als Gegenueber setzt.
//
// DER WICHTIGSTE TEIL DIESER DATEI IST TEIL A: fuer jedes ANDERE Ziel muss der
// Anfragekoerper des Anrufstarts BYTE-IDENTISCH zum Bestand bleiben. Die Messlatte dafuer
// ist eine Golden-Datei, die auf UNVERAENDERTEM master abgegriffen wurde
// (test/fixtures/el-anrufstart-fremdziel.json) - sie kann konstruktionsbedingt nicht aus
// dem geaenderten Code stammen.
//
// KEIN KATALOG-ID-PRAEFIX an den Testnamen: "OC" steht nicht im Muster
// package.json#config.i18nCatalogPattern, diese Faelle bleiben also in der
// Regressionsbank (npm test) und wandern nicht in den Gates-Lauf.
//
// REIHENFOLGE BINDEND (wie test/elevenlabs-torzustand.test.js): die Rueckfrage-Schalter
// stehen VOR dem Import - src/config.js liest process.env beim Laden. Ohne sie waere Teil E
// wertlos: das Tor waere ohnehin zu, und "unavailable" bewiese nichts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  pinCall,
  pinStore,
  sendeAnrufstartKoerper,
} from "./helpers/elevenlabs-anrufstart-attrappe.mjs";
import { SPOKEN_TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
const { makeElevenLabsOutbound } = await import("../src/elevenlabs/outbound.js");
const { consultAllowedFor } = await import("../src/consult/gate.js");
const { LOCALES } = await import("../src/i18n/locales.js");
const { OVERRIDE_ALLOWED_LEAF_PATHS, startOutboundCall } =
  await import("../src/elevenlabs/convai.js");
const { GET_CONSULT_TOOL_NAME } = await import("../src/consult/in-call.js");

const OWNER_NAME = "Pin Testowner";
const FIRST_NAME = "Pin";
const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const GOLDEN_PATH = "test/fixtures/el-anrufstart-fremdziel.json";

// Genau die zwei Felder, die vom LAUF abhaengen und deshalb in der Golden-Datei maskiert
// sind: today am Kalendertag (callTimeContext) und consult_available an der Umgebung
// (src/config.js). Den WERT von consult_available pinnt test/elevenlabs-torzustand.test.js
// bereits - eine zweite, schwaechere Zusage waere hier nur Rauschen.
const LAUFABHAENGIG = "<LAUFABHAENGIG>";
const LAUFABHAENGIGE_VARIABLEN = ["today", "consult_available"];

// Das Ziel entscheidet die Sprache des Anrufs (Vorrang des Angerufenen, call-locale.js:
// belegbare Landessprache der Rufnummer schlaegt die Auftraggeber-Kette). Drei Ziele, drei
// Sprachen - ohne den Store-Zustand der geteilten Attrappe anzufassen.
const ZIEL_JE_SPRACHE = Object.freeze({
  de: "+491737250000",
  fr: "+33612345678",
  en: "+447700900123",
});

// Das KI-Wort je Sprache, mit Wortgrenzen - sonst traegt ein zufaelliger Vorname die
// Zusage ("Kim" enthaelt kein KI, "AIda" schon).
const KI_WORT = Object.freeze({ de: /\bKI\b/, fr: /\bIA\b/, en: /\bAI\b/ });

// Ein charakteristischer Teilsatz des Offenlegungssatzes je Sprache: der volle Satz faellt
// auf, ein FRAGMENT davon nicht - und genau ein Fragment ist der offene Bestandsbefund
// (tasks/gq-chain-state.md).
const OFFENLEGUNGS_FRAGMENTE = Object.freeze({
  de: ["im Auftrag von", "zusammengefasst"],
  fr: ["mandaté par", "résumée"],
  en: ["on behalf of", "summarised"],
});

const vorlage = () => JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));

function ownerStore(tenantContext) {
  return pinStore({ profil: { allowConsult: true }, tenantContext });
}

// EIN Abgriff fuer alle Faelle - die geteilte Attrappe, keine zweite.
async function koerperFuer({ call, store = pinStore({ profil: { allowConsult: true } }) }) {
  return sendeAnrufstartKoerper({ makeElevenLabsOutbound, consultAllowedFor, store, call });
}

const rumpfVon = (koerper) => koerper.conversation_initiation_client_data;
const variablenVon = (koerper) => rumpfVon(koerper).dynamic_variables;
const uebersteuerungVon = (koerper) => rumpfVon(koerper).conversation_config_override;

// Ein Anruf an ein FREMDES Ziel: das Praedikat hat nicht bejaht, das Feld fehlt am
// Datensatz - genau wie bei jedem Bestands-Anruf vor OC-P1.
function fremdZiel(sprache = "de") {
  return { ...pinCall(), to: ZIEL_JE_SPRACHE[sprache] };
}

// Ein Anruf an die eigene hinterlegte Nummer: das Praedikat hat bejaht und den Wert am
// Datensatz festgeschrieben. Diese Datei entscheidet die Frage NICHT noch einmal - sie
// liest nur das Ergebnis (Invariante 5).
function ownerZiel(sprache = "de", calleeIsOwner = true) {
  return { ...pinCall(), to: ZIEL_JE_SPRACHE[sprache], calleeIsOwner };
}

// ---- A. Fremd-Ziel bleibt unberuehrt --------------------------------------------------

describe("OC-P2-A: ein Fremd-Ziel sieht exakt den Bestands-Anfragekoerper", () => {
  it("OC-P2-A1: Fremd-Ziel - der Koerper traegt keinen Blatt-Pfad agent.first_message", async () => {
    const koerper = await koerperFuer({ call: fremdZiel() });

    assert.ok(
      !JSON.stringify(koerper).includes("first_message"),
      "der Anfragekoerper eines Fremd-Ziels darf das Wort first_message nirgends fuehren - der Offenlegungssatz bleibt statischer Anbieter-Text",
    );
    assert.deepEqual(Object.keys(uebersteuerungVon(koerper).agent), ["language"]);
  });

  it("OC-P2-A2: Fremd-Ziel - callee_relation ist der leere String", async () => {
    const koerper = await koerperFuer({ call: fremdZiel() });

    assert.equal(variablenVon(koerper).callee_relation, "");
  });

  it("OC-P2-A3: Fremd-Ziel - der Rest des Koerpers ist byte-identisch zum Bestand (Golden aus master)", async () => {
    const koerper = await koerperFuer({ call: fremdZiel() });
    const variablen = variablenVon(koerper);

    assert.equal(variablen.callee_relation, "", "Voraussetzung dieses Vergleichs (s. A2)");
    delete variablen.callee_relation;
    for (const name of LAUFABHAENGIGE_VARIABLEN) variablen[name] = LAUFABHAENGIG;

    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    assert.deepEqual(koerper, golden);
    // deepEqual sieht die Schluessel-REIHENFOLGE nicht - JSON.stringify schon, und der
    // Anbieter bekommt genau diese Bytes.
    assert.equal(JSON.stringify(koerper), JSON.stringify(golden));
  });

  it("OC-P2-A4: Fremd-Ziel - das Uebersteuerungs-Objekt fuehrt nur Sprache und Stimme", async () => {
    const koerper = await koerperFuer({ call: fremdZiel() });
    const uebersteuerung = uebersteuerungVon(koerper);

    assert.deepEqual(Object.keys(uebersteuerung), ["agent", "tts"]);
    assert.deepEqual(Object.keys(uebersteuerung.agent), ["language"]);
    assert.deepEqual(Object.keys(uebersteuerung.tts), ["voice_id"]);
  });
});

// ---- B. Owner-Ziel --------------------------------------------------------------------

describe("OC-P2-B: das Owner-Ziel bekommt die KI-Eroeffnung und die Prompt-Sektion", () => {
  for (const sprache of Object.keys(ZIEL_JE_SPRACHE)) {
    const bundle = () => LOCALES[sprache];

    it(`OC-P2-B1-${sprache}: die uebersteuerte first_message beginnt mit der Owner-Begruessung`, async () => {
      const koerper = await koerperFuer({ call: ownerZiel(sprache) });
      const wert = uebersteuerungVon(koerper).agent.first_message;

      assert.equal(typeof wert, "string");
      assert.ok(
        wert.startsWith(bundle().ownerOpening(FIRST_NAME)),
        `first_message beginnt nicht mit der Owner-Begruessung: ${JSON.stringify(wert)}`,
      );
    });

    it(`OC-P2-B2-${sprache}: die Eroeffnung traegt den Offenlegungssatz NICHT, auch nicht als Fragment`, async () => {
      const koerper = await koerperFuer({ call: ownerZiel(sprache) });
      const wert = uebersteuerungVon(koerper).agent.first_message;

      assert.ok(!wert.includes(bundle().disclosure(OWNER_NAME)));
      for (const fragment of OFFENLEGUNGS_FRAGMENTE[sprache]) {
        assert.ok(!wert.includes(fragment), `Offenlegungs-Fragment in der Eroeffnung: ${fragment}`);
      }
    });

    it(`OC-P2-B3-${sprache}: die Eroeffnung traegt keinen unaufgeloesten Platzhalter`, async () => {
      const koerper = await koerperFuer({ call: ownerZiel(sprache) });

      assert.ok(!uebersteuerungVon(koerper).agent.first_message.includes("{{"));
    });

    it(`OC-P2-B4-${sprache}: die Eroeffnung nennt die Maschine beim Namen (KI/IA/AI)`, async () => {
      const koerper = await koerperFuer({ call: ownerZiel(sprache) });
      const wert = uebersteuerungVon(koerper).agent.first_message;

      assert.match(wert, KI_WORT[sprache]);
    });

    it(`OC-P2-B5-${sprache}: callee_relation nennt den Auftraggeber und traegt keinen Platzhalter`, async () => {
      const variablen = variablenVon(await koerperFuer({ call: ownerZiel(sprache) }));

      assert.ok(variablen.callee_relation.includes(OWNER_NAME));
      assert.ok(!variablen.callee_relation.includes("{{"));
    });

    it(`OC-P2-B6-${sprache}: callee_relation traegt den VOLLSTAENDIGEN Offenlegungssatz als Rueckfall`, async () => {
      const variablen = variablenVon(await koerperFuer({ call: ownerZiel(sprache) }));

      assert.ok(
        variablen.callee_relation.includes(bundle().disclosure(OWNER_NAME)),
        "ohne den vollen Satz ist die Pflicht-Rueckfallzeile nicht gebaut (Spec 2.2 / Invariante 4c)",
      );
    });
  }

  it("OC-P2-B7: opening_line reist im Owner-Fall weiterhin mit", async () => {
    const variablen = variablenVon(await koerperFuer({ call: ownerZiel("de") }));

    // first_message referenziert {{opening_line}}, und seit DE1 geht dieselbe Zeile als
    // WERT in {{voicemail_line}} ein - ein Weglassen waere der 1008-Abbruch, obwohl die
    // Zeile in der Eroeffnung bereits steckt.
    assert.ok(variablen.opening_line.length > 0);
  });
});

// ---- C. Fail-closed-Treppe ------------------------------------------------------------

describe("OC-P2-C: jede unvollstaendige Lage faellt auf den Offenlegungs-Rahmen zurueck", () => {
  const ohneUebersteuerung = (koerper) => {
    assert.ok(!JSON.stringify(koerper).includes("first_message"));
    assert.deepEqual(Object.keys(uebersteuerungVon(koerper).agent), ["language"]);
  };

  it("OC-P2-C1: calleeIsOwner fehlt (Bestands-Datensatz) -> keine Uebersteuerung, callee_relation leer", async () => {
    const koerper = await koerperFuer({ call: { ...pinCall(), to: ZIEL_JE_SPRACHE.de } });

    ohneUebersteuerung(koerper);
    assert.equal(variablenVon(koerper).callee_relation, "");
  });

  it("OC-P2-C2: calleeIsOwner === false -> keine Uebersteuerung, callee_relation leer", async () => {
    const koerper = await koerperFuer({ call: ownerZiel("de", false) });

    ohneUebersteuerung(koerper);
    assert.equal(variablenVon(koerper).callee_relation, "");
  });

  it('OC-P2-C3: calleeIsOwner === "true" (String) -> keine Uebersteuerung, callee_relation leer', async () => {
    const koerper = await koerperFuer({ call: ownerZiel("de", "true") });

    ohneUebersteuerung(koerper);
    assert.equal(variablenVon(koerper).callee_relation, "");
  });

  it("OC-P2-C4: Owner-Ziel ohne Vornamen -> keine Uebersteuerung (es gibt keinen Namens-Rueckfall)", async () => {
    const koerper = await koerperFuer({
      call: ownerZiel("de"),
      store: ownerStore(() => ({ ownerName: OWNER_NAME, firstName: "  " })),
    });

    ohneUebersteuerung(koerper);
    // BEFUND, hier ausdruecklich festgehalten statt stillschweigend: callee_relation haengt
    // laut Spec 2.3 AUSSCHLIESSLICH am Praedikat, nicht am Vornamen - der Block reist also
    // weiter. Das ist ungefaehrlich: ohne Uebersteuerung spricht der statische Rahmen den
    // VOLLEN Offenlegungssatz, der Prompt-Block traegt zusaetzlich die Rueckfallzeile.
    assert.ok(variablenVon(koerper).callee_relation.includes(OWNER_NAME));
  });

  it("OC-P2-C5: ein Vorname mit {{ -> keine Uebersteuerung (der einzige erreichbare Platzhalter-Weg)", async () => {
    const koerper = await koerperFuer({
      call: ownerZiel("de"),
      store: ownerStore(() => ({ ownerName: OWNER_NAME, firstName: "{{owner_name}}" })),
    });

    ohneUebersteuerung(koerper);
    assert.ok(variablenVon(koerper).callee_relation.includes(OWNER_NAME));
  });
});

// ---- D. Der Waechter (Rotprobe direkt gegen startOutboundCall) -------------------------

const WAECHTER_ACCOUNT = Object.freeze({ apiKey: "pin-key", apiBase: "https://pin.invalid" });
const WAECHTER_CALL_ID = "call-pin-waechter";

function zaehlendesFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ conversation_id: "conv_pin_waechter" }) };
  };
  return { fetchImpl, calls };
}

const koerperMitUebersteuerung = (override) => ({
  agent_id: "pin-agent",
  to_number: "+491737250000",
  conversation_initiation_client_data: { conversation_config_override: override },
});

const MIT_EROEFFNUNG = () =>
  koerperMitUebersteuerung({ agent: { language: "de", first_message: "Hallo Pin." } });

describe("OC-P2-D: agent.first_message ist ohne Owner-Kontext ein Abbruch, kein stiller Filter", () => {
  it("OC-P2-D1: calleeIsOwner weggelassen -> Wurf, kein Netzzugriff", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();

    await assert.rejects(
      () =>
        startOutboundCall({
          fetchImpl,
          account: WAECHTER_ACCOUNT,
          body: MIT_EROEFFNUNG(),
          callId: WAECHTER_CALL_ID,
        }),
      /agent\.first_message/,
    );
    assert.equal(
      calls.length,
      0,
      "fail-closed per Default: ein vergessener Wert ist die strenge Menge",
    );
  });

  it("OC-P2-D2: calleeIsOwner === false -> Wurf, kein Netzzugriff", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();

    await assert.rejects(
      () =>
        startOutboundCall({
          fetchImpl,
          account: WAECHTER_ACCOUNT,
          body: MIT_EROEFFNUNG(),
          callId: WAECHTER_CALL_ID,
          calleeIsOwner: false,
        }),
      /agent\.first_message/,
    );
    assert.equal(calls.length, 0);
  });

  it("OC-P2-D3: calleeIsOwner === true -> kein Wurf, genau EIN Netzzugriff (Positiv-Kontrolle)", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();

    const { conversationId } = await startOutboundCall({
      fetchImpl,
      account: WAECHTER_ACCOUNT,
      body: MIT_EROEFFNUNG(),
      callId: WAECHTER_CALL_ID,
      calleeIsOwner: true,
    });

    assert.equal(conversationId, "conv_pin_waechter");
    assert.equal(
      calls.length,
      1,
      "ohne diesen Fall belegt D1/D2 nur, dass der Waechter alles ablehnt",
    );
  });

  it("OC-P2-D4: ein VIERTER Pfad bricht auch im Owner-Kontext ab", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();
    const body = koerperMitUebersteuerung({ agent: { language: "de" }, tts: { speed: 1.2 } });

    await assert.rejects(
      () =>
        startOutboundCall({
          fetchImpl,
          account: WAECHTER_ACCOUNT,
          body,
          callId: WAECHTER_CALL_ID,
          calleeIsOwner: true,
        }),
      /tts\.speed/,
    );
    assert.equal(calls.length, 0);
    assert.ok(!OVERRIDE_ALLOWED_LEAF_PATHS.includes("tts.speed"));
  });
});

// ---- E. Rueckfrage-Tor ----------------------------------------------------------------

describe("OC-P2-E: den eigenen Auftraggeber fragt der Agent nicht, waehrend er mit ihm spricht", () => {
  const mitOffenemProfil = (call) =>
    koerperFuer({ call, store: pinStore({ profil: { allowConsult: true } }) });

  it("OC-P2-E1: Owner-Anruf -> consult_available ist unavailable, obwohl das Profil es erlaubt", async () => {
    const variablen = variablenVon(await mitOffenemProfil(ownerZiel("de")));

    assert.equal(variablen.consult_available, "unavailable");
  });

  it("OC-P2-E2: Fremd-Anruf mit identischem Aufbau -> unveraendert available (Gegenprobe)", async () => {
    const variablen = variablenVon(await mitOffenemProfil(fremdZiel()));

    assert.equal(
      variablen.consult_available,
      "available",
      "ohne diese Gegenprobe belegt E1 nur, dass irgendetwas unavailable ist",
    );
  });
});

// ---- F. Die Anbieter-Vorlage ----------------------------------------------------------

describe("OC-P2-F: die Vorlage traegt die Erlaubnis und den Platzhalter an der richtigen Stelle", () => {
  it("OC-P2-F1: die Erlaubnis-Karte fuehrt agent.first_message === true", () => {
    const karte = vorlage().platform_settings.overrides.conversation_config_override;

    assert.equal(karte.agent.first_message, true);
  });

  it("OC-P2-F2: die Erlaubnis-Karte enthaelt keinen _-Doku-Schluessel (der reiste beim Push mit)", () => {
    const karte = vorlage().platform_settings.overrides.conversation_config_override;

    assert.ok(
      !JSON.stringify(karte).includes('"_'),
      'der Push ERSETZT Dict-Felder - ein "_"-Schluessel in dieser Karte ginge an den Anbieter',
    );
  });

  it("OC-P2-F3: {{callee_relation}} steht im Prompt und in keinem get_consult-Abschnitt", () => {
    // In Stufen gelesen statt in einer Kette (G36/Demeter) - dasselbe Muster wie
    // src/conversation/elevenlabs-agent-config.js.
    const agent = vorlage().agent.conversation_config.agent;
    const prompt = agent.prompt.prompt;

    assert.ok(
      prompt.includes("{{callee_relation}}"),
      "der Platzhalter fehlt im Prompt der Vorlage",
    );
    const consultAbschnitte = prompt
      .split("\n\n")
      .filter((abschnitt) => abschnitt.includes(GET_CONSULT_TOOL_NAME));
    assert.ok(
      consultAbschnitte.length > 0,
      "Positiv-Kontrolle: der Prompt nennt get_consult ueberhaupt",
    );
    for (const abschnitt of consultAbschnitte) {
      assert.ok(
        !abschnitt.includes("{{callee_relation}}"),
        "in einem get_consult-Abschnitt wuerde der Platzhalter mit dem Abschnitt wegfallen (elevenlabs-agent-config.js wirft dann beim Laden)",
      );
    }
  });
});

// ---- G. Orthografie der neuen gesprochenen Strings -------------------------------------
//
// Der vorgeschriebene DE-Wortlaut traegt KEINEN Umlaut, der FR-Wortlaut KEINEN Akzent. Eine
// Umlaut-/Akzent-GEGENPROBE entfaellt hier deshalb bewusst - und ownerOpening wird aus
// demselben Grund NICHT in SPOKEN_DE_FIELDS von test/de-umlaut-orthography.test.js
// aufgenommen: dort verlangt P1-U2 /[aeoeue]/ in JEDEM gelisteten Feld, der Test wuerde rot,
// und die naheliegende "Reparatur" waere, einen Umlaut in einen Rechtssatz hineinzuschreiben.
// Was bleibt, ist die Haelfte, die hier greift: keine ASCII-Ersatzschreibung - gemessen
// gegen DIESELBE eine Stammliste wie der Bestands-Test, nicht gegen eine Kopie.

describe("OC-P2-G: die neuen gesprochenen Strings tragen keine Transliteration", () => {
  it("OC-P2-G1: LOCALES.de.ownerOpening traegt keine ASCII-Ersatzschreibung", () => {
    assert.doesNotMatch(LOCALES.de.ownerOpening(FIRST_NAME), SPOKEN_TRANSLITERATION_STEMS);
  });

  it("OC-P2-G2: LOCALES.fr.ownerOpening traegt keine ASCII-Ersatzschreibung", () => {
    assert.doesNotMatch(LOCALES.fr.ownerOpening(FIRST_NAME), SPOKEN_TRANSLITERATION_STEMS);
  });
});
