// ---- P4a: Sprachparameter an place_call --------------------------------------------
// Drei Baenke (tasks/p4a-spec.md, PLAN-ANRUFDEFEKTE.md Abschnitt 4/6):
//   A. Route (Spawn-Server + EL-Attrappe): der Sprachwunsch ueber die echte HTTP-Route,
//      Katalog-Ablehnung, Byte-Identitaet ohne Wunsch.
//   B. Naht (rein, kein Netz): callLocaleFor trennt Gespraechs- und Offenlegungssprache.
//   C. Waechter (Rotprobe gegen startOutboundCall): agent.first_message ist nur bei
//      nachgewiesener Sprachabweichung erlaubt UND muss den Pflichtsatz tragen.
//
// KEIN KATALOG-ID-PRAEFIX am Dateinamen/Testnamen -> Regressionsbank (npm test).
import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import { callLocaleFor } from "../src/elevenlabs/call-locale.js";
import { startOutboundCall } from "../src/elevenlabs/convai.js";
import { LOCALES, disclosurePrefixFor } from "../src/i18n/locales.js";
import { elevenLabsVoiceIdFor } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "./helpers.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

// ---- A. Route --------------------------------------------------------------------

const START_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";
const AGENT_ID = "agent_p4a_test_1";
const AGENT_PHONE_NUMBER_ID = "phnum_p4a_test_1";
const API_KEY = "el-p4a-test-geheim";
const OBJECTIVE = "Termin vereinbaren (P4a)";
const CONVERSATION_ID = "conv_p4a_test_1";
const FR_TARGET = "+33612345678"; // +33 - Fremd-Ziel, +49 steht in TELNYX_TEST_PEER_NUMBER

// Attrappe des Anbieters: nur die zwei Endpunkte, die der Anrufstart braucht (Muster
// test/elevenlabs-anrufstart.test.js#startElevenLabsMock, hier ohne Ausfall-Zweige - die
// misst diese Datei nicht).
async function startElevenLabsMock() {
  const startRequests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const endJson = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url.startsWith(START_PATH)) {
        startRequests.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
        return endJson(HTTP_OK, { success: true, conversation_id: CONVERSATION_ID });
      }
      if (req.url.startsWith(CONVERSATION_PATH)) {
        return endJson(HTTP_OK, { status: "processing" });
      }
      return endJson(HTTP_NOT_FOUND, { error: "not_found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    startRequests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const EL_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: AGENT_ID,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: AGENT_PHONE_NUMBER_ID,
  ELEVENLABS_API_KEY: API_KEY,
  ELEVENLABS_RESULT_POLL_MS: "150",
});

// Owner-Tenant (BOOTSTRAP_TENANT_ID) mit GESETZTER Auftraggeber-Sprache "de" - der feste
// Bezugspunkt aller A-Faelle: der Sprachwunsch bzw. sein Fehlen ist der EINZIGE Unterschied
// zwischen den Faellen, nicht ein driftender Tenant-Default.
function seedOwnerDe() {
  return seedState({
    settings: { language: "de" },
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
  });
}

async function withElevenLabs(run) {
  const mock = await startElevenLabsMock();
  const srv = await startServer({
    env: { ...EL_ENV, ELEVENLABS_API_BASE: mock.url },
    seed: seedOwnerDe(),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    return await run({ srv, mock });
  } finally {
    await srv.stop();
    await mock.close();
  }
}

function placeCall(srv, { to = TELNYX_TEST_PEER_NUMBER, language } = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: OBJECTIVE, ...(language === undefined ? {} : { language }) }),
  });
}

const outboundCall = (srv) => srv.readStore().calls.find((call) => call.direction === "outbound");
// Zwei flache Schritte statt einer tiefen Kette (G36/Gesetz von Demeter): erst der erste
// Anfragekoerper der Attrappe, dann darin gesucht.
const firstBody = (mock) => mock.startRequests[0]?.body;
const overrideOf = (mock) =>
  firstBody(mock)?.conversation_initiation_client_data?.conversation_config_override;

describe("P4a-A: der Sprachwunsch ueber die echte HTTP-Route", () => {
  it("P4a-A1: language:'fr' auf ein DE-Ziel -> 200, call.language=fr, agent.language=fr", async () => {
    await withElevenLabs(async ({ srv, mock }) => {
      const res = await placeCall(srv, { language: "fr" });
      assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
      assert.equal(outboundCall(srv).language, "fr");
      assert.equal(mock.startRequests.length, 1);
      assert.equal(overrideOf(mock).agent.language, "fr");
    });
  });

  it("P4a-A2: derselbe Anruf spricht die Offenlegung DEUTSCH, nicht franzoesisch (Abnahme 2)", async () => {
    await withElevenLabs(async ({ srv, mock }) => {
      await placeCall(srv, { language: "fr" });
      const eroeffnung = overrideOf(mock).agent.first_message;
      assert.equal(typeof eroeffnung, "string");
      assert.ok(
        eroeffnung.startsWith(disclosurePrefixFor("de")),
        `first_message beginnt nicht mit dem deutschen Pflichtsatz: ${JSON.stringify(eroeffnung)}`,
      );
      assert.ok(
        !eroeffnung.includes("mandaté par") && !eroeffnung.includes("résumée"),
        "die Eroeffnung darf kein franzoesisches Offenlegungs-Fragment tragen",
      );
    });
  });

  it("P4a-A3: 'zz' und 'pt' werden mit 400 unsupported_language abgelehnt - kein Anruf, kein Datensatz", async () => {
    await withElevenLabs(async ({ srv, mock }) => {
      const vorAnzahl = srv.readStore().calls.length;
      for (const code of ["zz", "pt"]) {
        const res = await placeCall(srv, { language: code });
        assert.equal(res.status, HTTP_BAD_REQUEST, `code=${code}`);
        const json = await res.json();
        assert.equal(json.code, "unsupported_language");
        assert.ok(json.error.includes("de") && json.error.includes("fr") && json.error.includes("en"));
      }
      assert.equal(srv.readStore().calls.length, vorAnzahl);
      assert.equal(mock.startRequests.length, 0);
    });
  });

  it("P4a-A4: 'DE' wird als 'de' akzeptiert (Gross-/Kleinschreibung), 'de-DE' wird abgelehnt (kein Regions-Kuerzen)", async () => {
    await withElevenLabs(async ({ srv }) => {
      const gross = await placeCall(srv, { language: "DE" });
      assert.equal(gross.status, HTTP_OK, JSON.stringify(await gross.json()));
      assert.equal(outboundCall(srv).language, "de");

      const region = await placeCall(srv, { to: FR_TARGET, language: "de-DE" });
      assert.equal(region.status, HTTP_BAD_REQUEST);
      assert.equal((await region.json()).code, "unsupported_language");
    });
  });

  it("P4a-A5: ohne language, DE-Ziel, Tenant de -> agent.language=de UND der Koerper traegt nirgends 'first_message' (I-3/Abnahme 4)", async () => {
    await withElevenLabs(async ({ srv, mock }) => {
      const res = await placeCall(srv);
      assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
      assert.equal(overrideOf(mock).agent.language, "de");
      const koerperText = JSON.stringify(firstBody(mock));
      assert.equal(
        koerperText.includes("first_message"),
        false,
        "ohne Sprachabweichung bleibt der Koerper byte-identisch zum Bestand",
      );
    });
  });

  it("P4a-A6: ohne language, FR-Ziel, Tenant de -> Gespraech DEUTSCH (F-2 Punkt 2), Offenlegung FRANZOESISCH (E-2/Abnahme 5)", async () => {
    await withElevenLabs(async ({ srv, mock }) => {
      const res = await placeCall(srv, { to: FR_TARGET });
      assert.equal(res.status, HTTP_OK, JSON.stringify(await res.json()));
      assert.equal(overrideOf(mock).agent.language, "de", "die Gespraechssprache folgt dem Auftraggeber");
      const eroeffnung = overrideOf(mock).agent.first_message;
      assert.ok(
        eroeffnung?.startsWith(disclosurePrefixFor("fr")),
        `first_message beginnt nicht mit dem franzoesischen Pflichtsatz: ${JSON.stringify(eroeffnung)}`,
      );
    });
  });
});

// ---- B. Naht: callLocaleFor trennt Gespraechs- und Offenlegungssprache ----------------

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
    assert.equal(ergebnis.voiceId, elevenLabsVoiceIdFor(PLATFORM_VOICE_ID, LOCALES.fr.voiceProfile));
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
    const fall1 = callLocaleFor(state, { ...basis, to: DE_NUMMER, callLanguage: "fr" }); // fr/de
    const fall2 = callLocaleFor(state, { ...basis, to: DE_NUMMER }); // en/de
    const fall3 = callLocaleFor(state, { ...basis, to: undefined }); // en/en

    assert.notEqual(fall1.language, fall2.language);
    assert.equal(fall2.language, fall3.language, "Voraussetzung: fall2/fall3 unterscheiden sich nur in disclosureLanguage");
    assert.notEqual(fall2.disclosureLanguage, fall3.disclosureLanguage);
    assert.notEqual(fall1.disclosureLanguage, fall1.language, "fall1 ist der Abweichungsfall selbst");
  });
});

// ---- C. Waechter: startOutboundCall gegen ein zaehlendes fetchImpl -------------------

const WAECHTER_ACCOUNT = Object.freeze({ apiKey: "waechter-key", apiBase: "http://127.0.0.1:1" });
const WAECHTER_CALL_ID = "call_p4a_waechter";

function zaehlendesFetch() {
  const calls = [];
  const fetchImpl = async () => {
    calls.push(true);
    return { ok: true, status: 200, json: async () => ({ conversation_id: "conv_waechter" }) };
  };
  return { fetchImpl, calls };
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
  it("P4a-C1: Sprachabweichung fr/de OHNE first_message -> Wurf, 0 Netzzugriffe", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();
    await assert.rejects(() =>
      startOutboundCall({
        fetchImpl,
        account: WAECHTER_ACCOUNT,
        body: koerperMit({ language: "fr" }),
        callId: WAECHTER_CALL_ID,
        disclosureLanguage: "de",
      }),
    );
    assert.equal(calls.length, 0);
  });

  it("P4a-C2: Sprachabweichung fr/de MIT first_message, die NICHT mit dem de-Pflichtsatz beginnt -> Wurf, 0 Netzzugriffe", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();
    await assert.rejects(() =>
      startOutboundCall({
        fetchImpl,
        account: WAECHTER_ACCOUNT,
        body: koerperMit({ language: "fr", first_message: "Hallo, das ist der falsche Anfang." }),
        callId: WAECHTER_CALL_ID,
        disclosureLanguage: "de",
      }),
    );
    assert.equal(calls.length, 0);
  });

  it("P4a-C3: Sprachabweichung fr/de MIT korrektem Praefix -> kein Wurf, GENAU EIN Netzzugriff (Positiv-Kontrolle)", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();
    const eroeffnung = `${disclosurePrefixFor("de")} Pin Testowner ruft im Auftrag an.`;
    const { conversationId } = await startOutboundCall({
      fetchImpl,
      account: WAECHTER_ACCOUNT,
      body: koerperMit({ language: "fr", first_message: eroeffnung }),
      callId: WAECHTER_CALL_ID,
      disclosureLanguage: "de",
    });
    assert.equal(conversationId, "conv_waechter");
    assert.equal(calls.length, 1, "ohne diesen Fall belegen C1/C2 nur, dass der Waechter alles ablehnt");
  });

  it("P4a-C4: calleeIsOwner=true + Sprachabweichung + Owner-Begruessung (ohne Pflichtsatz) -> kein Wurf (OC-P2 unveraendert, I-2)", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();
    const { conversationId } = await startOutboundCall({
      fetchImpl,
      account: WAECHTER_ACCOUNT,
      body: koerperMit({ language: "fr", first_message: "Hallo Pin, hier ist dein KI-Assistent." }),
      callId: WAECHTER_CALL_ID,
      calleeIsOwner: true,
      disclosureLanguage: "de",
    });
    assert.equal(conversationId, "conv_waechter");
    assert.equal(calls.length, 1);
  });

  it("P4a-C5: ohne disclosureLanguage (Bestandsaufruf) -> Verhalten byte-identisch zum Bestand (first_message ohne Owner -> Wurf)", async () => {
    const { fetchImpl, calls } = zaehlendesFetch();
    await assert.rejects(() =>
      startOutboundCall({
        fetchImpl,
        account: WAECHTER_ACCOUNT,
        body: koerperMit({ language: "fr", first_message: "Hallo." }),
        callId: WAECHTER_CALL_ID,
      }),
      /agent\.first_message/,
    );
    assert.equal(calls.length, 0);
  });
});

