import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { test } from "node:test";

import { callLocaleFor } from "../../src/elevenlabs/call-locale.ts";
import { assertEroeffnungGeprueft } from "../../src/elevenlabs/convai.ts";
import { LOCALES, disclosurePrefixFor } from "../../src/i18n/locales.ts";
import { elevenLabsVoiceIdFor } from "../../src/telephony/adapters/telnyx/elevenlabs-voice.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

const OBJECTIVE = "Termin vereinbaren (P4a)";
const FR_TARGET = "+33612345678";

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

function seedOwnerDe() {
  return seedState({
    settings: { language: "de" },
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
  });
}

async function withVorspann(run) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV },
    seed: seedOwnerDe(),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    return await run({ srv });
  } finally {
    await srv.stop();
  }
}

function placeCall(srv, { to = TELNYX_TEST_PEER_NUMBER, language } = {}) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: OBJECTIVE, ...(language === undefined ? {} : { language }) }),
  });
}

async function vorspannInit(srv, optionen) {
  const res = await placeCall(srv, optionen);
  const antwort = await res.text();
  assert.equal(res.status, HTTP_OK, antwort);
  return initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
}

const outboundCall = (srv) => srv.readStore().calls.find((call) => call.direction === "outbound");
const wahlen = (srv) => srv.vorspannAttrappe.pfade.filter((pfad) => pfad === "/v2/calls");

describe("P4a-A: der Sprachwunsch ueber die echte HTTP-Route", () => {
  it("P4a-A1: language:'fr' auf ein DE-Ziel -> 200, call.language=fr, agent.language=fr", async () => {
    await withVorspann(async ({ srv }) => {
      const res = await placeCall(srv, { language: "fr" });
      const antwort = await res.text();
      assert.equal(res.status, HTTP_OK, antwort);
      assert.equal(wahlen(srv).length, 1);
      const inhalt = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
      assert.equal(outboundCall(srv).language, "fr");
      assert.equal(inhalt.conversation_config_override.agent.language, "fr");
    });
  });

  it("P4a-A2: derselbe Anruf spricht die Offenlegung DEUTSCH, nicht franzoesisch (Abnahme 2)", async () => {
    await withVorspann(async ({ srv }) => {
      const inhalt = await vorspannInit(srv, { language: "fr" });
      const eroeffnung = inhalt.dynamic_variables.eroeffnung_gesagt;
      assert.equal(inhalt.conversation_config_override.agent.first_message, "");
      assert.equal(typeof eroeffnung, "string");
      assert.ok(
        eroeffnung.startsWith(disclosurePrefixFor("de")),
        `eroeffnung_gesagt beginnt nicht mit dem deutschen Pflichtsatz: ${JSON.stringify(eroeffnung)}`,
      );
      assert.ok(
        !eroeffnung.includes("mandaté par") && !eroeffnung.includes("résumée"),
        "die Eroeffnung darf kein franzoesisches Offenlegungs-Fragment tragen",
      );
    });
  });

  it("P4a-A3: 'zz' und 'pt' werden mit 400 unsupported_language abgelehnt - kein Anruf, kein Datensatz", async () => {
    await withVorspann(async ({ srv }) => {
      const vorAnzahl = srv.readStore().calls.length;
      for (const code of ["zz", "pt"]) {
        const res = await placeCall(srv, { language: code });
        assert.equal(res.status, HTTP_BAD_REQUEST, `code=${code}`);
        const json = await res.json();
        assert.equal(json.code, "unsupported_language");
        assert.ok(json.error.includes("de") && json.error.includes("fr") && json.error.includes("en"));
      }
      assert.equal(srv.readStore().calls.length, vorAnzahl);
      assert.equal(wahlen(srv).length, 0);
    });
  });

  it("P4a-A4: 'DE' wird als 'de' akzeptiert (Gross-/Kleinschreibung), 'de-DE' wird abgelehnt (kein Regions-Kuerzen)", async () => {
    await withVorspann(async ({ srv }) => {
      const gross = await placeCall(srv, { language: "DE" });
      assert.equal(gross.status, HTTP_OK, JSON.stringify(await gross.json()));
      assert.equal(outboundCall(srv).language, "de");

      const region = await placeCall(srv, { to: FR_TARGET, language: "de-DE" });
      assert.equal(region.status, HTTP_BAD_REQUEST);
      assert.equal((await region.json()).code, "unsupported_language");
    });
  });

  it("P4a-A5: ohne language, DE-Ziel, Tenant de -> agent.language=de UND first_message leer, die Eroeffnung steht in eroeffnung_gesagt (I-3/Abnahme 4)", async () => {
    await withVorspann(async ({ srv }) => {
      const inhalt = await vorspannInit(srv);
      assert.equal(inhalt.conversation_config_override.agent.language, "de");
      assert.equal(inhalt.conversation_config_override.agent.first_message, "");
      assert.equal(inhalt.dynamic_variables.eroeffnung, "", "nach dem Vorspann traegt die Eroeffnungsvariable keinen Satz");
    });
  });

  it("P4a-A6: ohne language, FR-Ziel, Tenant de -> Gespraech DEUTSCH (F-2 Punkt 2), Offenlegung FRANZOESISCH (E-2/Abnahme 5)", async () => {
    await withVorspann(async ({ srv }) => {
      const inhalt = await vorspannInit(srv, { to: FR_TARGET });
      assert.equal(inhalt.conversation_config_override.agent.language, "de", "die Gespraechssprache folgt dem Auftraggeber");
      assert.equal(inhalt.conversation_config_override.agent.first_message, "");
      const eroeffnung = inhalt.dynamic_variables.eroeffnung_gesagt;
      assert.ok(
        eroeffnung?.startsWith(disclosurePrefixFor("fr")),
        `eroeffnung_gesagt beginnt nicht mit dem franzoesischen Pflichtsatz: ${JSON.stringify(eroeffnung)}`,
      );
    });
  });
});

const OWNER_NAME = "Pin B-Testowner";
const PLATFORM_VOICE_ID = "plattform-stimme-p4a";
const DE_NUMMER = TELNYX_TEST_PEER_NUMBER;

describe("P4a-B: callLocaleFor trennt Gespraechs- und Offenlegungssprache rein", () => {
  it("P4a-B1: callLanguage='fr', Ziel DE -> language=fr, disclosureLanguage=de, firstMessage folgt DE, Stimme folgt FR", () => {
    const ergebnis = callLocaleFor(
      { tenants: [{ id: "t1", defaultLanguage: "de" }], settings: {} },
      {
        tenantId: "t1",
        numberRecord: null,
        ownerName: OWNER_NAME,
        defaultVoiceId: PLATFORM_VOICE_ID,
        to: DE_NUMMER,
        callLanguage: "fr",
      },
    );
    assert.equal(ergebnis.language, "fr");
    assert.equal(ergebnis.disclosureLanguage, "de");
    assert.ok(ergebnis.firstMessage.startsWith(LOCALES.de.disclosure(OWNER_NAME)));
    assert.equal(ergebnis.voiceId, "cqPdIo76zSHFDcSZpFov");
  });

  it("P4a-B2: ohne callLanguage, Ziel DE, Tenant fr -> language=fr (Umkehrung, F-2 Punkt 2), disclosureLanguage=de (unveraendert)", () => {
    const ergebnis = callLocaleFor(
      { tenants: [{ id: "t2", defaultLanguage: "fr" }], settings: {} },
      {
        tenantId: "t2",
        numberRecord: null,
        ownerName: OWNER_NAME,
        defaultVoiceId: PLATFORM_VOICE_ID,
        to: DE_NUMMER,
      },
    );
    assert.equal(ergebnis.language, "fr");
    assert.equal(ergebnis.disclosureLanguage, "de");
  });

  it("P4a-B3: Positiv-Kontrolle - die drei Faelle sind in language UND disclosureLanguage paarweise unterscheidbar", () => {
    const state = { tenants: [{ id: "t3", defaultLanguage: "en" }], settings: {} };
    const basis = { tenantId: "t3", numberRecord: null, ownerName: OWNER_NAME, defaultVoiceId: PLATFORM_VOICE_ID };
    const fall1 = callLocaleFor(state, { ...basis, to: DE_NUMMER, callLanguage: "fr" });
    const fall2 = callLocaleFor(state, { ...basis, to: DE_NUMMER });
    const fall3 = callLocaleFor(state, { ...basis, to: undefined });

    assert.notEqual(fall1.language, fall2.language);
    assert.equal(fall2.language, fall3.language, "Voraussetzung: fall2/fall3 unterscheiden sich nur in disclosureLanguage");
    assert.notEqual(fall2.disclosureLanguage, fall3.disclosureLanguage);
    assert.notEqual(fall1.disclosureLanguage, fall1.language, "fall1 ist der Abweichungsfall selbst");
  });
});

const WAECHTER_CALL_ID = "call_p4a_waechter";

async function pruefeStart({ body, callId, calleeIsOwner = false, disclosureLanguage = null }) {
  assertEroeffnungGeprueft(body, callId, { calleeIsOwner, disclosureLanguage });
}

function koerperMit(agentUeberschreibung) {
  return {
    agent_id: "agent_x",
    agent_phone_number_id: "phnum_x",
    to_number: "+491737250000",
    conversation_initiation_client_data: {
      dynamic_variables: {},
      conversation_config_override: { agent: agentUeberschreibung },
    },
  };
}

describe("P4a-C: der Waechter erlaubt agent.first_message NUR bei nachgewiesener Sprachabweichung MIT korrektem Pflichtsatz", () => {
  it("P4a-C1: Sprachabweichung fr/de OHNE first_message -> Wurf", async () => {
    await assert.rejects(() =>
      pruefeStart({
        body: koerperMit({ language: "fr" }),
        callId: WAECHTER_CALL_ID,
        disclosureLanguage: "de",
      }),
    );
  });

  it("P4a-C2: Sprachabweichung fr/de MIT first_message, die NICHT mit dem de-Pflichtsatz beginnt -> Wurf", async () => {
    await assert.rejects(() =>
      pruefeStart({
        body: koerperMit({ language: "fr", first_message: "Hallo, das ist der falsche Anfang." }),
        callId: WAECHTER_CALL_ID,
        disclosureLanguage: "de",
      }),
    );
  });

  it("P4a-C3: Sprachabweichung fr/de MIT korrektem Praefix -> kein Wurf (Positiv-Kontrolle)", async () => {
    const eroeffnung = `${disclosurePrefixFor("de")} Pin Testowner ruft im Auftrag an.`;
    await assert.doesNotReject(() =>
      pruefeStart({
        body: koerperMit({ language: "fr", first_message: eroeffnung }),
        callId: WAECHTER_CALL_ID,
        disclosureLanguage: "de",
      }),
    );
  });

  it("P4a-C4: calleeIsOwner=true + Sprachabweichung + Owner-Begruessung (ohne Pflichtsatz) -> kein Wurf (OC-P2 unveraendert, I-2)", async () => {
    await assert.doesNotReject(() =>
      pruefeStart({
        body: koerperMit({ language: "fr", first_message: "Hallo Pin, hier ist dein KI-Assistent." }),
        callId: WAECHTER_CALL_ID,
        calleeIsOwner: true,
        disclosureLanguage: "de",
      }),
    );
  });

  it("P4a-C5: ohne disclosureLanguage (Bestandsaufruf) -> Verhalten byte-identisch zum Bestand (first_message ohne Owner -> Wurf)", async () => {
    await assert.rejects(() =>
      pruefeStart({
        body: koerperMit({ language: "fr", first_message: "Hallo." }),
        callId: WAECHTER_CALL_ID,
      }),
      /agent\.first_message/,
    );
  });
});


const KI_ERSTSATZ =
  "Hallo, es geht um einen Termin – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.";
const GATE_MELDUNG = /dynamic_variables\.eroeffnung oder opening_line fehlt oder traegt nicht den KI-Satz vor der ersten Frage/;

function gateStart(inhalt, extra = {}) {
  const body = { conversation_initiation_client_data: inhalt };
  return { lauf: pruefeStart({ body, callId: "c2", disclosureLanguage: "de", ...extra }) };
}

describe("Eroeffnung-Gate: Abbruchmeldung und Randfaelle", () => {
  it("ohne dynamic_variables bricht der Anrufstart mit der Gate-Meldung ab, nicht mit einem Programmfehler", async () => {
    const { lauf } = gateStart({ conversation_config_override: { agent: { language: "de" } } });
    await assert.rejects(lauf, GATE_MELDUNG);
  });

  it("eine fehlende Eroeffnung nennt die Gate-Meldung mit der Anruf-Kennung", async () => {
    const { lauf } = gateStart({ dynamic_variables: { opening_line: "es geht um einen Termin." }, conversation_config_override: { agent: { language: "de" } } });
    await assert.rejects(lauf, /Anrufstart abgebrochen \(call=c2\): dynamic_variables\.eroeffnung/);
  });

  it("opening_line allein genuegt nicht, die Eroeffnung allein auch nicht", async () => {
    for (const variablen of [{ eroeffnung: KI_ERSTSATZ }, { opening_line: "es geht um einen Termin." }]) {
      const { lauf } = gateStart({ dynamic_variables: variablen, conversation_config_override: { agent: { language: "de" } } });
      await assert.rejects(lauf, GATE_MELDUNG);
    }
  });
});

const GATE_MELDUNG_C3 = /Anrufstart abgebrochen \(call=c3\): dynamic_variables\.eroeffnung oder opening_line fehlt/;
const KI_ERSTSATZ_C3 = "Hallo, es geht um einen Termin – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.";

function gateStartOhneDaten(body, extra = {}) {
  return { lauf: pruefeStart({ body, callId: "c3", disclosureLanguage: "de", ...extra }) };
}

describe("Eroeffnung-Gate: Grenzen des Koerpers", () => {
  it("Eroeffnung-Gate: ohne uebergebene Variablen bricht der Anruf mit der Gate-Meldung ab", async () => {
    const { lauf } = gateStartOhneDaten({
      conversation_initiation_client_data: { conversation_config_override: { agent: { language: "de" } } },
    });
    await assert.rejects(lauf, GATE_MELDUNG_C3);
  });

  it("Eroeffnung-Gate: mit Variablen und gleicher Sprache geht der Anruf raus", async () => {
    const { lauf } = gateStartOhneDaten({
      conversation_initiation_client_data: {
        dynamic_variables: { eroeffnung: KI_ERSTSATZ_C3, opening_line: "es geht um einen Termin." },
        conversation_config_override: { agent: { language: "de" } },
      },
    });
    await assert.doesNotReject(lauf);
  });

  it("Eroeffnung-Gate: ohne Angabe zum Besitzer gilt der Angerufene als Dritter, auch bei Sprachabweichung", async () => {
    const { lauf } = gateStartOhneDaten(
      { conversation_initiation_client_data: { conversation_config_override: { agent: { language: "fr", first_message: "Bonjour." } } } },
      { calleeIsOwner: undefined },
    );
    await assert.rejects(lauf, /agent\.first_message enthaelt nicht den Offenlegungssatz/);
  });
});

describe("Eroeffnung-Gate: KI-Hinweis in der Eroeffnung", () => {
  const faelle = [
    ["ohne KI-Hinweis", "Hallo, es geht um einen Termin."],
    ["KI-Hinweis erst nach einer Frage", "Hallo, passt es gerade? Ich rufe an, ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen."],
  ];
  for (const [name, eroeffnung] of faelle) {
    it(`bricht ab: ${name}, auch mit gesetztem opening_line, ohne Netzaufruf`, async () => {
      const { lauf } = gateStart({
        dynamic_variables: { eroeffnung, opening_line: "es geht um einen Termin." },
        conversation_config_override: { agent: { language: "de" } },
      });
      await assert.rejects(lauf, GATE_MELDUNG);
    });
  }
});

describe("Nullish-Vorbereitung: Offenlegungs- und Gespraechssprache", () => {
  const TENANT = "tenant-nullish";
  const STATE_FR = Object.freeze({
    tenants: [{ id: TENANT, country: "FR", language: "fr" }],
    settings: { [TENANT]: { language: "fr" } },
  });
  const OPTIONEN = { tenantId: TENANT, numberRecord: null, ownerName: "Owen Barrett", defaultVoiceId: "v" };
  const FAELLE = [
    { name: "Angerufener in Deutschland", to: "+4915123456789", erwartet: "de" },
    { name: "Angerufener in Frankreich", to: FR_TARGET, erwartet: "fr" },
    { name: "Angerufener in Grossbritannien", to: "+447911123456", erwartet: "en" },
    { name: "Land ohne Sprachtabelle faellt auf den Auftraggeber", to: "+819012345678", erwartet: "fr" },
    { name: "+1 faellt auf den Auftraggeber", to: "+15125550143", erwartet: "fr" },
    { name: "keine Nummer faellt auf den Auftraggeber", to: null, erwartet: "fr" },
    { name: "unbrauchbare Nummer faellt auf den Auftraggeber", to: "keine", erwartet: "fr" },
  ];

  it("Offenlegungssprache: Sprache des Angerufenen, sonst die des Auftraggebers", () => {
    for (const fall of FAELLE)
      assert.equal(
        callLocaleFor(STATE_FR, { ...OPTIONEN, to: fall.to }).disclosureLanguage,
        fall.erwartet,
        fall.name,
      );
  });

  it("Gespraechssprache: angegebene Sprache vor Auftraggeber, leere Angabe zaehlt als fehlend", () => {
    assert.equal(callLocaleFor(STATE_FR, { ...OPTIONEN, to: null, callLanguage: "de" }).language, "de");
    assert.equal(callLocaleFor(STATE_FR, { ...OPTIONEN, to: null, callLanguage: "" }).language, "fr");
    assert.equal(callLocaleFor(STATE_FR, { ...OPTIONEN, to: null, callLanguage: null }).language, "fr");
  });
});

const PRUEF_CALL_ID = "call_convai_vorbereitung";
const PRUEF_ERSTSATZ = `${disclosurePrefixFor("de")} Anlass.`;
const FEHLENDE_ERROEFFNUNG = /dynamic_variables\.eroeffnung oder opening_line fehlt/;
const KONTEXT_DE = { calleeIsOwner: false, disclosureLanguage: "de" };

function koerperMitVariablen(variablen, agent = { language: "de" }) {
  return {
    conversation_initiation_client_data: {
      ...(variablen === undefined ? {} : { dynamic_variables: variablen }),
      conversation_config_override: { agent },
    },
  };
}

const VARIABLEN_TABELLE = [
  [{ eroeffnung: PRUEF_ERSTSATZ, opening_line: "Zeile" }, undefined],
  [{ eroeffnung: "", opening_line: "Zeile" }, FEHLENDE_ERROEFFNUNG],
  [{ eroeffnung: 5, opening_line: "Zeile" }, FEHLENDE_ERROEFFNUNG],
  [{ opening_line: "Zeile" }, FEHLENDE_ERROEFFNUNG],
  [{ eroeffnung: PRUEF_ERSTSATZ, opening_line: "" }, FEHLENDE_ERROEFFNUNG],
  [{ eroeffnung: PRUEF_ERSTSATZ, opening_line: 5 }, FEHLENDE_ERROEFFNUNG],
  [{ eroeffnung: PRUEF_ERSTSATZ }, FEHLENDE_ERROEFFNUNG],
  [{ eroeffnung: "Hallo Welt", opening_line: "Zeile" }, FEHLENDE_ERROEFFNUNG],
  [undefined, FEHLENDE_ERROEFFNUNG],
];

for (const [variablen, erwartet] of VARIABLEN_TABELLE) {
  test(`convai: Eroeffnungspruefung mit dynamic_variables ${JSON.stringify(variablen)} ${erwartet ? "wirft" : "geht durch"}`, () => {
    const aufruf = () => assertEroeffnungGeprueft(koerperMitVariablen(variablen), PRUEF_CALL_ID, KONTEXT_DE);
    if (erwartet) assert.throws(aufruf, erwartet);
    else assert.doesNotThrow(aufruf);
  });
}

test("convai: eine eigene agent.first_message ersetzt die Eroeffnungsvariable, auch ohne dynamic_variables", () => {
  const body = koerperMitVariablen(undefined, { language: "de", first_message: PRUEF_ERSTSATZ });
  assert.doesNotThrow(() => assertEroeffnungGeprueft(body, PRUEF_CALL_ID, { calleeIsOwner: true, disclosureLanguage: "de" }));
});

test("convai: ohne Override bei gesetzter Offenlegungssprache nennt der Fehler agent.language=undefined", () => {
  assert.throws(
    () => assertEroeffnungGeprueft({ conversation_initiation_client_data: {} }, PRUEF_CALL_ID, KONTEXT_DE),
    { message: /agent\.language=undefined weicht von der Offenlegungssprache de ab, aber der Anruf bringt keine eigene/ },
  );
});

test("convai: ein leeres Override bei gesetzter Offenlegungssprache nennt agent.language=undefined", () => {
  const body = { conversation_initiation_client_data: { conversation_config_override: {} } };
  assert.throws(() => assertEroeffnungGeprueft(body, PRUEF_CALL_ID, KONTEXT_DE), {
    message: /agent\.language=undefined weicht von der Offenlegungssprache de ab/,
  });
});

const ANDERE_SPRACHE_TABELLE = [
  [{ language: "fr", first_message: PRUEF_ERSTSATZ }, undefined],
  [{ language: "fr", first_message: "" }, /agent\.language=fr weicht von der Offenlegungssprache de ab/],
  [{ language: "fr", first_message: 5 }, /agent\.language=fr weicht von der Offenlegungssprache de ab/],
  [{ language: "fr" }, /agent\.language=fr weicht von der Offenlegungssprache de ab/],
  [{ language: "fr", first_message: "Hallo, falscher Anfang." }, /enthaelt nicht den Offenlegungssatz der Sprache de/],
];

for (const [agent, erwartet] of ANDERE_SPRACHE_TABELLE) {
  test(`convai: abweichende Sprache mit agent ${JSON.stringify(agent)} ${erwartet ? "wirft" : "geht durch"}`, () => {
    const aufruf = () => assertEroeffnungGeprueft(koerperMitVariablen({}, agent), PRUEF_CALL_ID, KONTEXT_DE);
    if (erwartet) assert.throws(aufruf, erwartet);
    else assert.doesNotThrow(aufruf);
  });
}

