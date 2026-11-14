import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  pinCall,
  pinStore,
  sendeAnrufstartKoerper,
} from "../helpers/elevenlabs-anrufstart-attrappe.mjs";
import { SPOKEN_TRANSLITERATION_STEMS } from "../umlaut-stems-helper.js";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
const { makeElevenLabsOutbound } = await import("../../src/elevenlabs/outbound.js");
const { consultAllowedForCall } = await import("../../src/consult/gate.js");
const { LOCALES } = await import("../../src/i18n/locales.js");
const { OVERRIDE_ALLOWED_LEAF_PATHS, startOutboundCall } =
  await import("../../src/elevenlabs/convai.js");
const { GET_CONSULT_TOOL_NAME } = await import("../../src/consult/in-call.js");

const OWNER_NAME = "Pin Testowner";
const FIRST_NAME = "Pin";
const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const GOLDEN_PATH = "test/fixtures/el-anrufstart-fremdziel.json";

const LAUFABHAENGIG = "<LAUFABHAENGIG>";
const LAUFABHAENGIGE_VARIABLEN = ["today", "consult_available"];

const ZIEL_JE_SPRACHE = Object.freeze({
  de: "+491737250000",
  fr: "+33612345678",
  en: "+447700900123",
});

const KI_WORT = Object.freeze({ de: /\bKI\b/, fr: /\bIA\b/, en: /\bAI\b/ });

const OFFENLEGUNGS_FRAGMENTE = Object.freeze({
  de: ["im Auftrag von", "zusammengefasst"],
  fr: ["mandaté par", "résumée"],
  en: ["on behalf of", "summarised"],
});

const vorlage = () => JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));

function ownerStore(tenantContext) {
  return pinStore({ profil: { allowConsult: true }, tenantContext });
}

async function koerperFuer({ call, store = pinStore({ profil: { allowConsult: true } }) }) {
  return sendeAnrufstartKoerper({ makeElevenLabsOutbound, consultAllowedForCall, store, call });
}

const rumpfVon = (koerper) => koerper.conversation_initiation_client_data;
const variablenVon = (koerper) => rumpfVon(koerper).dynamic_variables;
const uebersteuerungVon = (koerper) => rumpfVon(koerper).conversation_config_override;

function fremdZiel(sprache = "de") {
  return { ...pinCall(), to: ZIEL_JE_SPRACHE[sprache] };
}

function ownerZiel(sprache = "de", calleeIsOwner = true) {
  return { ...pinCall(), to: ZIEL_JE_SPRACHE[sprache], calleeIsOwner };
}

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

    assert.ok(variablen.opening_line.length > 0);
  });
});

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

describe("OC-P2-E: den eigenen Auftraggeber fragt der Agent nicht, waehrend er mit ihm spricht", () => {
  const mitOffenemProfil = (call) =>
    koerperFuer({ call, store: pinStore({ profil: { allowConsult: true } }) });

  it("OC-P2-E1: Owner-Anruf -> consult_available ist available, wenn das Profil es erlaubt (#4395)", async () => {
    const variablen = variablenVon(await mitOffenemProfil(ownerZiel("de")));

    assert.equal(variablen.consult_available, "available");
  });

  it("OC-P2-E3: Owner-Anruf -> callee_relation weist auf get_consult und nennt kein Rueckfrage-Verbot (#4395)", async () => {
    const beziehung = variablenVon(await mitOffenemProfil(ownerZiel("de"))).callee_relation;

    assert.ok(beziehung.includes("call get_consult and put the question to their assistant"));
    assert.ok(beziehung.includes("There is no message to pass on: if something is unclear, ask them directly."));
    assert.ok(!beziehung.includes("nobody else to consult"));
  });

  it("OC-P2-E4: Owner-Anruf ohne allowConsult -> weiterhin unavailable", async () => {
    const koerper = await koerperFuer({
      call: ownerZiel("de"),
      store: pinStore({ profil: { allowConsult: false } }),
    });

    assert.equal(variablenVon(koerper).consult_available, "unavailable");
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

describe("OC-P2-G: die neuen gesprochenen Strings tragen keine Transliteration", () => {
  it("OC-P2-G1: LOCALES.de.ownerOpening traegt keine ASCII-Ersatzschreibung", () => {
    assert.doesNotMatch(LOCALES.de.ownerOpening(FIRST_NAME), SPOKEN_TRANSLITERATION_STEMS);
  });

  it("OC-P2-G2: LOCALES.fr.ownerOpening traegt keine ASCII-Ersatzschreibung", () => {
    assert.doesNotMatch(LOCALES.fr.ownerOpening(FIRST_NAME), SPOKEN_TRANSLITERATION_STEMS);
  });
});

const { eroeffnungFuerAnruf } = await import("../../src/elevenlabs/outbound.js");
const { pinConfig } = await import("../helpers/elevenlabs-anrufstart-attrappe.mjs");

const AUFTRAG_3488 = Object.freeze({
  de: "Ich möchte einen Termin zur Bremsenprüfung vereinbaren",
  en: "I would like to arrange a brake inspection appointment",
  fr: "Je voudrais prendre rendez-vous pour un contrôle des freins",
});
const ERWARTET_3488 = Object.freeze({
  de: `Hallo, ich möchte einen Termin zur Bremsenprüfung vereinbaren – ich bin Hermes, der KI-Assistent von ${OWNER_NAME}, und ich fasse das Gespräch für ${FIRST_NAME} zusammen.`,
  en: `Hello, I would like to arrange a brake inspection appointment – I am Hermes, the AI assistant of ${OWNER_NAME}, and I will summarise this conversation for ${FIRST_NAME}.`,
  fr: `Bonjour, je voudrais prendre rendez-vous pour un contrôle des freins – je suis Hermes, l'assistant IA de ${OWNER_NAME}, et je résume cette conversation pour ${FIRST_NAME}.`,
});
const KI_HINWEIS_3488 = Object.freeze({
  de: `ich bin Hermes, der KI-Assistent von ${OWNER_NAME}`,
  en: `I am Hermes, the AI assistant of ${OWNER_NAME}`,
  fr: `je suis Hermes, l'assistant IA de ${OWNER_NAME}`,
});
const ZUSAMMENFASSUNG_3488 = Object.freeze({
  de: `, und ich fasse das Gespräch für ${FIRST_NAME} zusammen.`,
  en: `, and I will summarise this conversation for ${FIRST_NAME}.`,
  fr: `, et je résume cette conversation pour ${FIRST_NAME}.`,
});
const PLATZHALTER_3488 = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const anrufIn3488 = (sprache, felder = {}) => ({
  ...pinCall(),
  to: ZIEL_JE_SPRACHE[sprache],
  language: sprache,
  goal: AUFTRAG_3488[sprache],
  ...felder,
});
const namensStore3488 = (ownerName) => pinStore({ tenantContext: () => ({ ownerName, firstName: FIRST_NAME }) });
const vorspann3488 = (call, store = pinStore()) => eroeffnungFuerAnruf({ store, config: pinConfig(), call });
const zaehle3488 = (text, teil) => text.split(teil).length - 1;

function karteGesprochen3488(koerper, sprache) {
  const konfig = vorlage().agent.conversation_config;
  const preset = konfig.language_presets[sprache];
  const satz = sprache === "en" ? konfig.agent.first_message : preset.overrides.agent.first_message;
  const variablen = variablenVon(koerper);
  return satz.replace(PLATZHALTER_3488, (_treffer, name) => String(variablen[name] ?? ""));
}

describe("3488-H2: Anlass vor KI-Satz im selben ersten Redebeitrag", () => {
  it("E1 E3 G5: die Karte spricht Gruss, Anlass, KI-Satz, Zusammenfassung - de, en, fr", async () => {
    for (const sprache of Object.keys(ZIEL_JE_SPRACHE)) {
      const koerper = await koerperFuer({ call: anrufIn3488(sprache) });
      const gesprochen = karteGesprochen3488(koerper, sprache);
      assert.equal(gesprochen, ERWARTET_3488[sprache], `Sprache ${sprache}`);
      assert.equal(zaehle3488(gesprochen, KI_HINWEIS_3488[sprache]), 1, `Sprache ${sprache}: KI-Satz genau einmal`);
      assert.ok(!gesprochen.includes("?") && !/[[\]]/.test(gesprochen), `Sprache ${sprache}: keine Frage, keine Klammern`);
      assert.equal(uebersteuerungVon(koerper).agent.first_message, undefined);
    }
  });

  it("E1 E9: das Vorspann-Gegenstueck hat denselben Text, der Pflichtsatz ist sein Anfang und traegt den KI-Satz", () => {
    for (const sprache of Object.keys(ZIEL_JE_SPRACHE)) {
      const { text, pflichtsatz } = vorspann3488(anrufIn3488(sprache));
      assert.equal(text, ERWARTET_3488[sprache], `Sprache ${sprache}`);
      assert.ok(text.startsWith(pflichtsatz), `Sprache ${sprache}: Anfang`);
      assert.ok(pflichtsatz.endsWith(KI_HINWEIS_3488[sprache]), `Sprache ${sprache}: KI-Satz im Pflichtsatz`);
      assert.equal(text.slice(pflichtsatz.length), ZUSAMMENFASSUNG_3488[sprache], `Sprache ${sprache}: Rest`);
    }
  });

  it("E2: leerer Name -> Ersatzname, nie eine leere Stelle", async () => {
    const leer = namensStore3488("   ");
    assert.ok(vorspann3488(anrufIn3488("de"), leer).text.includes("ich bin Hermes, der KI-Assistent von meinem Auftraggeber,"));
    const karte = karteGesprochen3488(await koerperFuer({ call: anrufIn3488("de"), store: leer }), "de");
    assert.ok(karte.includes("ich bin Hermes, der KI-Assistent von meinem Auftraggeber,"), karte);
  });

  it("G6: ein Name mit Satzzeichen steht im KI-Satz, auch ein Fragezeichen im Namen bricht den Waechter nicht", async () => {
    const mitPunkt = vorspann3488(anrufIn3488("de"), namensStore3488("Dr. M. Müller")).text;
    assert.ok(mitPunkt.includes("ich bin Hermes, der KI-Assistent von Dr. M. Müller,"), mitPunkt);
    const mitFrage = vorspann3488(anrufIn3488("de"), namensStore3488("Max Wer?")).text;
    assert.ok(mitFrage.includes("ich bin Hermes, der KI-Assistent von Max Wer?,"), mitFrage);
    await waechterStart3488(mitFrage);
  });

  it("E6 G1: ohne KI-Satz, doppelter KI-Satz, KI-Satz ohne Namen und Frage davor brechen ab", async () => {
    for (const text of [
      `${ANLASS_3488} Das Gespräch wird für meinen Auftraggeber zusammengefasst.`,
      `${ANLASS_3488} ${KI_SATZ_3488} ${KI_SATZ_3488}`,
      `${ANLASS_3488} ich bin Hermes, der KI-Assistent.`,
      `Haben Sie kurz Zeit? ${ANLASS_3488} ${KI_SATZ_3488}`,
      `${ANLASS_3488} ich bin Hermes, der KI-Assistent von `,
    ]) {
      const { fetchImpl, calls } = zaehlendesFetch();
      await assert.rejects(() => waechterStart3488(text, fetchImpl), /agent\.first_message/, text);
      assert.equal(calls.length, 0, text);
    }
  });

  it("E6: KI-Satz nur am Ende, KI-Satz zuerst und der alte Pflichtsatz zuerst gehen durch", async () => {
    for (const text of [
      `${ANLASS_3488} ${KI_SATZ_3488}`,
      `${KI_SATZ_3488} ${ANLASS_3488}`,
      `${LOCALES.de.disclosure("Max")} Ich rufe an, um einen Termin zu vereinbaren.`,
    ]) {
      const { fetchImpl, calls } = zaehlendesFetch();
      await waechterStart3488(text, fetchImpl);
      assert.equal(calls.length, 1, text);
    }
  });

  it("G3: weichen Anlass- und Offenlegungssprache ab, steht der KI-Satz der Offenlegungssprache zuerst, ohne Schlussfrage", () => {
    const call = anrufIn3488("en", { to: ZIEL_JE_SPRACHE.de });
    const { text, pflichtsatz } = vorspann3488(call);
    assert.equal(pflichtsatz, LOCALES.de.disclosure(OWNER_NAME));
    assert.equal(text, `${pflichtsatz} ${AUFTRAG_3488.en}.`);
  });

  it("E7 G4: Anruf an die eigene Nummer bleibt byte-gleich mit Schlussfrage, auch die Voicemail eines Dritt-Anrufs", async () => {
    const eigene = anrufIn3488("de", { calleeIsOwner: true, goal: "Termin vereinbaren" });
    const { text } = vorspann3488(eigene);
    assert.equal(text, "Hey, hier ist Hermes, dein KI-Assistent. Wie kann ich dir helfen?");
    const koerper = await koerperFuer({ call: eigene });
    assert.equal(uebersteuerungVon(koerper).agent.first_message, text);
    const dritt = await koerperFuer({ call: anrufIn3488("de", { goal: "Termin vereinbaren" }) });
    const voicemail = variablenVon(dritt).voicemail_line;
    assert.ok(voicemail.startsWith(LOCALES.de.disclosure(OWNER_NAME)), voicemail);
    assert.ok(voicemail.includes("Es geht um Folgendes: Termin vereinbaren. Wie sieht es damit aus?"), voicemail);
  });
});

const ANLASS_3488 = "Hallo, ich rufe an, um einen Termin zu vereinbaren –";
const KI_SATZ_3488 = "ich bin Hermes, der KI-Assistent von Max, und ich fasse das Gespräch für Max zusammen.";

function waechterStart3488(firstMessage, fetchImpl = zaehlendesFetch().fetchImpl) {
  const body = koerperMitUebersteuerung({ agent: { language: "en", first_message: firstMessage } });
  return startOutboundCall({
    fetchImpl,
    account: WAECHTER_ACCOUNT,
    body,
    callId: WAECHTER_CALL_ID,
    calleeIsOwner: false,
    disclosureLanguage: "de",
  });
}

describe("EROEFFNUNG-3735: Variable eroeffnung am Anrufstart", () => {
  it("Anruf an den Besitzer traegt die Besitzer-Eroeffnung, die auch als erste Nachricht gesprochen wird", async () => {
  const daten = rumpfVon(await koerperFuer({ call: ownerZiel("de") }));
  assert.equal(
    daten.dynamic_variables.eroeffnung,
    "Hey, hier ist Hermes, dein KI-Assistent. Wie kann ich dir helfen?",
  );
  assert.equal(daten.conversation_config_override.agent.first_message, daten.dynamic_variables.eroeffnung);
  });

  it("weicht die Anrufsprache von der Offenlegungssprache ab, ist die Variable die gesprochene erste Nachricht", async () => {
  const daten = rumpfVon(await koerperFuer({ call: fremdZiel("fr") }));
  assert.equal(
    daten.dynamic_variables.eroeffnung,
    "Bonjour, ceci est un assistant IA mandaté par Pin Testowner. Cette conversation sera résumée pour mon mandant. Es geht um Folgendes: Termin vereinbaren.",
  );
  assert.equal(daten.conversation_config_override.agent.first_message, daten.dynamic_variables.eroeffnung);
  });

  it("nur der Schlusspunkt des Anlasses faellt weg, Punkte mitten im Anlass bleiben", async () => {
  const daten = rumpfVon(await koerperFuer({ call: { ...fremdZiel(), goal: "Termin am 3. Mai klären..." } }));
  assert.equal(
    daten.dynamic_variables.eroeffnung,
    "Hallo, es geht um Folgendes: Termin am 3. Mai klären – ich bin Hermes, der KI-Assistent von Pin Testowner, und ich fasse das Gespräch für Pin zusammen.",
  );
  });
});
