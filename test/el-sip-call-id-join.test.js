import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { publicCall } from "../src/store/views.js";
import { isTelnyxSipCallId } from "../src/telephony/sip-call-id.js";
import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_FAILED_INVALID_DESTINATION,
  JOIN_SCHLUESSEL_ANRUF_2,
} from "./fixtures/elevenlabs-conversations.js";

const OTB_JOINT = JOIN_SCHLUESSEL_ANRUF_2.telnyxDetailRecord.sip_call_id;
const SCL_JOINT_NICHT = JOIN_SCHLUESSEL_ANRUF_2.startAntwort.sip_call_id;

const GESPRAECH_ANRUF_2 = Object.freeze({
  ...CONVERSATION_DONE_WITH_ANALYSIS,
  metadata: Object.freeze({
    ...CONVERSATION_DONE_WITH_ANALYSIS.metadata,
    phone_call: JOIN_SCHLUESSEL_ANRUF_2.phoneCall,
  }),
});
const CONVERSATION_ID = CONVERSATION_DONE_WITH_ANALYSIS.conversation_id;

const START_PATH = "/v1/convai/sip-trunk/outbound-call";

const POLL_MS = 5;
const WARTE_MS = 4000;
const WARTE_TAKT_MS = 10;

const ZAHL_STATT_STRING = 42;

let jsonStore, makePgStore, PGlite, BOOTSTRAP, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-el-sipcallid-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  jsonStore = await import("../src/store/json.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

function testConfig() {
  return {
    voice: {
      elevenLabsOutbound: {
        apiKey: "sipcallid-test-key",
        agentId: "sipcallid-agent",
        agentPhoneNumberId: "sipcallid-phnum",
        apiBase: "https://sipcallid-test.invalid",
        resultPollMs: POLL_MS,
      },
    },
    telnyx: { telnyxElevenLabs: { voiceId: "sipcallid-test-stimme" } },
    safety: { fakeOriginateElevenlabs: false },
  };
}

function outboundFactory(store) {
  return makeElevenLabsOutbound({
    store,
    config: testConfig(),
    terminateAndBillCall: async ({ persistEnd, bill }) => {
      await persistEnd?.();
      await bill?.();
    },
    billThunk: () => async () => {},
    finishCall: async () => {},
  });
}

async function mitAttrappe({ startAntwort, gespraech }, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes(START_PATH) ? startAntwort : gespraech),
  });
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const neuerAnruf = () =>
  jsonStore.createCall({
    direction: "outbound",
    from: "+4915005550001",
    to: "+4915005550002",
    goal: "Join-Schluessel sichern",
    tenantId: BOOTSTRAP,
  });

async function warteBis(pruefung) {
  const grenze = Date.now() + WARTE_MS;
  while (Date.now() < grenze) {
    if (pruefung()) return true;
    await new Promise((weiter) => setTimeout(weiter, WARTE_TAKT_MS));
  }
  return false;
}

const anrufStillegen = (callId) => jsonStore.endCallRecord(callId, "completed");

function mitLautemLog(fn) {
  const original = console.error;
  const zeilen = [];
  console.error = (...args) => zeilen.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return zeilen;
}

test("die sip_call_id der Anrufstart-Antwort wird verworfen, persistiert wird der Wert aus dem Gespraechs-Datensatz", async () => {
  const call = neuerAnruf();
  assert.equal(call.sipCallId, null, "Call-Default: null, nie undefined (json<->pg-Parity)");

  const { originateCall } = outboundFactory(jsonStore);
  const gefunden = await mitAttrappe(
    {
      startAntwort: {
        success: true,
        conversation_id: CONVERSATION_ID,
        sip_call_id: SCL_JOINT_NICHT,
      },
      gespraech: GESPRAECH_ANRUF_2,
    },
    async () => {
      await originateCall(jsonStore.getCall(call.id));
      return warteBis(() => Boolean(jsonStore.getCall(call.id)?.sipCallId));
    },
  );
  anrufStillegen(call.id);

  assert.ok(gefunden, "der Ergebnisabruf hat den Schluessel nicht geschrieben");
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    OTB_JOINT,
    "nur der 'otb_'-Wert steht auf dem Telnyx-Beleg - er kommt aus metadata.phone_call.call_id und wird gelesen, BEVOR der Loeschversuch den Anbieter-Datensatz mitnimmt",
  );
  assert.notEqual(
    jsonStore.getCall(call.id).sipCallId,
    SCL_JOINT_NICHT,
    "die Anrufstart-Antwort liefert unter demselben Feldnamen ElevenLabs' call_sid - dieser Wert findet auf der Telefonie-Rechnung nichts (gemessen, Anruf 2 vom 17.08.2026)",
  );
  assert.equal(
    jsonStore.getCall(call.id).elevenlabsConversationId,
    CONVERSATION_ID,
    "der Anrufstart muss gelaufen sein - sonst misst der Fall darueber nichts",
  );
});

test("ohne Ergebnisabruf bleibt der Schluessel leer statt falsch", async () => {
  const call = neuerAnruf();

  const { originateCall } = outboundFactory(jsonStore);
  await mitAttrappe(
    {
      startAntwort: {
        success: true,
        conversation_id: CONVERSATION_ID,
        sip_call_id: SCL_JOINT_NICHT,
      },
      gespraech: CONVERSATION_FAILED_INVALID_DESTINATION,
    },
    () => originateCall(jsonStore.getCall(call.id)),
  );
  const direktNachDemStart = jsonStore.getCall(call.id).sipCallId;
  anrufStillegen(call.id);

  assert.equal(
    direktNachDemStart,
    null,
    "der Anrufstart darf nichts schreiben - sein Feld traegt den call_sid, nicht den Join-Schluessel",
  );
});

test("der Form-Waechter trennt den Telnyx-Schluessel vom call_sid desselben Anrufs", () => {
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.telnyxDetailRecord.sip_call_id),
    true,
    "der Wert vom Telnyx-Beleg MUSS durchkommen",
  );
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.phoneCall.call_id),
    true,
    "derselbe Wert aus dem Gespraechs-Datensatz - unsere einzige Quelle",
  );
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.phoneCall.call_sid),
    false,
    "der call_sid desselben Anrufs - genau der Wert, der am 17.08.2026 faelschlich als Join-Schluessel persistiert wurde",
  );
  assert.equal(
    isTelnyxSipCallId(JOIN_SCHLUESSEL_ANRUF_2.startAntwort.sip_call_id),
    false,
    "unter dem Namen sip_call_id geliefert - und trotzdem derselbe untaugliche Wert",
  );
  for (const gemessen of [
    CONVERSATION_DONE_WITH_ANALYSIS.metadata.phone_call.call_id,
    CONVERSATION_FAILED_INVALID_DESTINATION.metadata.phone_call.call_id,
  ])
    assert.equal(isTelnyxSipCallId(gemessen), true, `gemessener Wert abgewiesen: ${gemessen}`);
});

test("der Waechter ist locker genug fuer eine harmlose Formaenderung des Anbieters", () => {
  for (const kuenftig of [
    "otb_9901M08D8GNCE3XS4XPKA1H3773A",
    "OTB_4801m08d8gnce3xs4xpka1h3773a",
    "otb_4801-m08d-8gnc-e3xs",
    "otb_4801m08d8gnce3xs4xpka1h3773a0000000000000000",
  ])
    assert.equal(isTelnyxSipCallId(kuenftig), true, `harmlose Form abgewiesen: ${kuenftig}`);

  for (const untauglich of ["otb_", "otb_1234", "", null, undefined, ZAHL_STATT_STRING, {}])
    assert.equal(isTelnyxSipCallId(untauglich), false, `untaugliche Form angenommen: ${untauglich}`);
});

test("ein Wert in fremder Form belegt den set-once-Platz nicht und wird laut gemeldet", () => {
  const call = jsonStore.createCall({
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP,
  });

  const zeilen = mitLautemLog(() => jsonStore.recordSipCallId(call.id, SCL_JOINT_NICHT));
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    null,
    "ein Wert, der den Telnyx-Beleg nicht finden kann, darf nicht als Join-Schluessel durchgehen",
  );
  assert.equal(zeilen.length, 1, "die Abweisung muss LAUT sein, nicht still");
  assert.ok(
    zeilen[0].includes(SCL_JOINT_NICHT),
    `die Meldung muss den abgewiesenen Wert nennen, sonst ist sie nicht diagnostizierbar: ${zeilen[0]}`,
  );

  jsonStore.recordSipCallId(call.id, OTB_JOINT);
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    OTB_JOINT,
    "haette der fremde Wert den Platz belegt, waere der richtige Schluessel fuer immer ausgesperrt (set-once) - genau der Defekt vom 17.08.2026",
  );
});

test("der Schluessel ueberlebt das json-Backend und ist set-once", () => {
  const call = jsonStore.createCall({
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP,
  });

  jsonStore.recordSipCallId(call.id, OTB_JOINT);
  jsonStore.recordSipCallId(call.id, "otb_zweiterversuch0000000000000");
  assert.equal(
    jsonStore.getCall(call.id).sipCallId,
    OTB_JOINT,
    "ein zweiter Schreiber darf den ersten nicht ueberschreiben (set-once) - ein wiederholter Ergebnisabruf traegt denselben Wert, und der frueheste zaehlt",
  );

  const aufPlatte = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const gefunden = aufPlatte.calls.find((eintrag) => eintrag.sipCallId === OTB_JOINT);
  assert.equal(gefunden?.id, call.id, "der Schluessel ueberlebt JSON.stringify/parse");
});

test("der Schluessel ueberlebt das pg-Backend (Spalte + Flush + rowToCall)", async () => {
  const db = new PGlite();
  const runner = {
    withClient: (fn) =>
      fn({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();

  const call = store.createCall({
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP,
  });
  assert.equal(call.sipCallId, null, "pg-Call-Default: null, nie undefined");

  store.recordSipCallId(call.id, OTB_JOINT);
  await store.save();

  const wiedergeoeffnet = makePgStore(runner);
  await wiedergeoeffnet.init();
  assert.equal(
    wiedergeoeffnet.getCall(call.id).sipCallId,
    OTB_JOINT,
    "ohne Spalte + ON CONFLICT DO UPDATE SET + rowToCall ginge der Schluessel beim Restart verloren UND der naechste Flush schriebe NULL zurueck",
  );
});

test("publicCall zeigt den Join-Schluessel und streicht weiterhin die Kosten-Felder", () => {
  const sicht = publicCall({
    id: "call_sichtbarkeit",
    sipCallId: OTB_JOINT,
    streamToken: "geheim",
    estimatedCostCents: 42,
    actualCostMicroCents: 4200,
    telnyxConversationId: "conv-telnyx",
  });

  assert.equal(sicht.sipCallId, OTB_JOINT);
  assert.equal(sicht.streamToken, undefined, "das Zugangsgeheimnis darf die API nie verlassen");
  assert.equal(sicht.estimatedCostCents, undefined, "Kostenwerte bleiben gestrichen");
  assert.equal(sicht.actualCostMicroCents, undefined, "Kostenwerte bleiben gestrichen");
  assert.equal(sicht.telnyxConversationId, undefined, "Bestandsverhalten unveraendert");
});
