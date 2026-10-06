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
const { consultAllowedForCall } = await import("../src/consult/gate.js");
const { LOCALES } = await import("../src/i18n/locales.js");
const { OVERRIDE_ALLOWED_LEAF_PATHS, startOutboundCall } =
  await import("../src/elevenlabs/convai.js");
const { GET_CONSULT_TOOL_NAME } = await import("../src/consult/in-call.js");

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
