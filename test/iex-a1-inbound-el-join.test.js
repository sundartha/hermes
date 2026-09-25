// IEX-A1 (Lead-Entscheidung A4): Join-Schluessel (sipCallId) und die erwartete
// telnyx_sip-Zeile im Kosten-Buch gibt es nur noch fuer Kostenprofile, deren
// Pflicht-Traeger laut Katalog (billing/kostenarten.js) telnyx_sip enthalten.
//
// Anlass ([CP] Befund 1): der Inbound-EL-Weg (Telnyx-Dial an den ElevenLabs-Agenten)
// liefert unter metadata.phone_call.call_id eine UUID, keinen "otb_"-Wert. Bisher schrieb
// persistProviderResult sie trotzdem als Join-Schluessel - der Waechter verwarf sie laut
// ("[join-schluessel] verworfen"), und das Buch bekam eine telnyx_sip-Karteileiche, die
// nie ein Beleg einloesen kann. Der Leg-Schluessel dieses Weges ist twilioSid.
//
// Echter json-Store auf einem Temp-DATA_DIR (Muster el-sip-call-id-join.test.js): nur der
// echte Waechter in state-ops.js#recordSipCallId kann das Log belegen, eine Attrappe nicht.
// Einstieg ist fuer alle Faelle derselbe Ergebnisweg (rearmActiveConversationPolls), damit
// sich die Faelle NUR im Seed unterscheiden.
//
// Anrufe OHNE costProfile behalten das Bestandsverhalten (IEX-A1-4): die Legacy-Zuordnung
// liest selbst sipCallId und ergaebe vor dem Join immer ein Budget-Profil (B6-Falle).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KOSTENART, KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { legRefOfCall } from "../src/billing/call-leg-ref.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { anrufFuehrtTelnyxSip, recordElevenLabsKostenBelege } from "../src/elevenlabs/kosten-beleg.js";
import * as ops from "../src/store/state-ops.js";
import { CONVERSATION_DONE_MIT_KOSTEN } from "./fixtures/elevenlabs-conversations.js";
import { waitUntil, withFetch } from "./helpers.js";

const HTTP_OK = 200;
const POLL_MS = 5;
const WARTE_FRIST_MS = 4000;
const TRAEGER_SID = "v3:iex-a1-traeger";
const JOIN_LOG = "[join-schluessel]";
const ANRUFER_NUMMER = "+491701111111";
const EIGENE_NUMMER = "+491700000000";
const OUTBOUND_ABSENDER = "+4915005550001";
const OUTBOUND_ZIEL = "+4915005550002";
const ENTFERNTES_PROFIL = "entferntes_profil";
const IN_MEMORY_TENANT = "t_iex_a1";
// UUID-Form, wie sie der Inbound-EL-Weg unter phone_call.call_id liefert ([CP] Befund 1).
const DIAL_UUID_CALL_ID = "0b6f3c1e-7d2a-4e5b-9c8d-1a2b3c4d5e6f";
const OTB_CALL_ID = CONVERSATION_DONE_MIT_KOSTEN.metadata.phone_call.call_id;
// Dasselbe Gespraech, NUR die call_id ersetzt: IEX-A1-1 und IEX-A1-3 unterscheiden sich
// damit ausschliesslich im Kostenprofil.
const GESPRAECH_MIT_UUID = Object.freeze({
  ...CONVERSATION_DONE_MIT_KOSTEN,
  metadata: Object.freeze({
    ...CONVERSATION_DONE_MIT_KOSTEN.metadata,
    phone_call: Object.freeze({
      ...CONVERSATION_DONE_MIT_KOSTEN.metadata.phone_call,
      call_id: DIAL_UUID_CALL_ID,
    }),
  }),
});

let jsonStore;
let BOOTSTRAP;
let REIFE;

before(async () => {
  // DATA_DIR VOR den store-Imports binden: json.js bindet seinen Dateipfad beim Import.
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-iex-a1-"));
  await import("../src/config.js");
  jsonStore = await import("../src/store/json.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP, REIFE } = await import("../src/store/defaults.js"));
});

function ergebnisweg() {
  return makeElevenLabsOutbound({
    store: jsonStore,
    config: {
      voice: {
        elevenLabsOutbound: {
          apiKey: "iex-a1-key",
          agentId: "iex-a1-agent",
          apiBase: "https://iex-a1.invalid",
          resultPollMs: POLL_MS,
        },
      },
      safety: { fakeOriginateElevenlabs: false },
    },
    terminateAndBillCall: async ({ persistEnd, bill }) => {
      await persistEnd?.();
      await bill?.();
    },
    billThunk: () => async () => {},
    finishCall: async () => {},
  });
}

function seedInboundEl() {
  const call = jsonStore.createCall({
    direction: "inbound",
    from: ANRUFER_NUMMER,
    to: EIGENE_NUMMER,
    twilioSid: TRAEGER_SID,
    tenantId: BOOTSTRAP,
  });
  jsonStore.recordCostProfile(call.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  jsonStore.markAnswered(call.id);
  jsonStore.bindInboundElConversation(call.id, {
    conversationId: "conv_iex_a1_inbound",
    nowIso: new Date().toISOString(),
  });
  jsonStore.markInboundElNachlaufStarted(call.id, new Date().toISOString());
  return call.id;
}

function seedOutboundEl({ costProfile, conversationId }) {
  const call = jsonStore.createCall({
    direction: "outbound",
    from: OUTBOUND_ABSENDER,
    to: OUTBOUND_ZIEL,
    goal: "IEX-A1",
    tenantId: BOOTSTRAP,
  });
  if (costProfile) jsonStore.recordCostProfile(call.id, costProfile);
  jsonStore.recordElevenlabsConversationId(call.id, conversationId);
  return call.id;
}

function traegerZeile(callId, traeger) {
  return jsonStore.callCostEvidence(callId).find((zeile) => zeile.traeger === traeger);
}

// Die elevenlabs_convai-Zeile schreibt persistProviderResult als LETZTEN Schritt - zusammen
// mit "nicht mehr active" ist das Ende des Ergebniswegs damit deterministisch erreicht.
function ergebniswegFertig(callId) {
  const elZeileDa = Boolean(traegerZeile(callId, KOSTENART.ELEVENLABS_CONVAI));
  return elZeileDa && jsonStore.getCall(callId).status !== "active";
}

async function holeErgebnis(callId, conversation) {
  const fehlerZeilen = [];
  const originalError = console.error;
  console.error = (...args) => fehlerZeilen.push(args.join(" "));
  try {
    const antwort = async () => ({ ok: true, status: HTTP_OK, json: async () => conversation });
    await withFetch(antwort, async () => {
      ergebnisweg().rearmActiveConversationPolls();
      await waitUntil(() => ergebniswegFertig(callId), { timeoutMs: WARTE_FRIST_MS });
    });
  } finally {
    console.error = originalError;
    // Jeden Anruf beenden, damit ein spaeterer rearm ihn nicht erneut aufgreift (F.I.R.S.T.: I).
    jsonStore.endCallRecord(callId, "completed");
  }
  const joinZeilen = fehlerZeilen.filter((zeile) => zeile.includes(JOIN_LOG));
  return { call: jsonStore.getCall(callId), joinZeilen };
}

test("IEX-A1-1: Inbound-EL mit UUID-call_id -> kein Join-Log, kein sipCallId, keine telnyx_sip-Zeile, Leg-Referenz = Traeger", async () => {
  const callId = seedInboundEl();
  const { call, joinZeilen } = await holeErgebnis(callId, GESPRAECH_MIT_UUID);
  assert.deepEqual(joinZeilen, []);
  assert.equal(call.sipCallId, null);
  assert.equal(traegerZeile(callId, KOSTENART.TELNYX_SIP), undefined);
  assert.ok(traegerZeile(callId, KOSTENART.ELEVENLABS_CONVAI), "der EL-Beleg entsteht weiterhin");
  assert.equal(legRefOfCall(call), TRAEGER_SID);
});

test("IEX-A1-2: Outbound-EL mit otb_-Kennung -> Join und telnyx_sip erwartet wie bisher", async () => {
  const callId = seedOutboundEl({ costProfile: KOSTENPROFIL.EL_CONVAI_SIP, conversationId: "conv_iex_a1_otb" });
  const { call, joinZeilen } = await holeErgebnis(callId, CONVERSATION_DONE_MIT_KOSTEN);
  assert.deepEqual(joinZeilen, []);
  assert.equal(call.sipCallId, OTB_CALL_ID);
  assert.equal(traegerZeile(callId, KOSTENART.TELNYX_SIP)?.reife, REIFE.ERWARTET);
});

test("IEX-A1-3: Outbound-EL mit UUID-call_id -> Waechter meldet weiter genau einmal (Positiv-Kontrolle zu IEX-A1-1)", async () => {
  const callId = seedOutboundEl({ costProfile: KOSTENPROFIL.EL_CONVAI_SIP, conversationId: "conv_iex_a1_fremd" });
  const { call, joinZeilen } = await holeErgebnis(callId, GESPRAECH_MIT_UUID);
  assert.equal(joinZeilen.length, 1, "dieselbe Log-Erfassung sieht die Waechter-Zeile");
  assert.equal(call.sipCallId, null);
  assert.equal(traegerZeile(callId, KOSTENART.TELNYX_SIP)?.reife, REIFE.ERWARTET);
});

test("IEX-A1-4: Anruf ohne costProfile -> Join wie bisher (Legacy-Zuordnung liest sipCallId selbst)", async () => {
  const callId = seedOutboundEl({ costProfile: null, conversationId: "conv_iex_a1_alt" });
  const { call } = await holeErgebnis(callId, CONVERSATION_DONE_MIT_KOSTEN);
  assert.equal(call.sipCallId, OTB_CALL_ID);
});

test("IEX-A1-5: anrufFuehrtTelnyxSip je Kostenprofil", () => {
  const faelle = [
    [{ costProfile: KOSTENPROFIL.EL_CONVAI_SIP }, true],
    [{ costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI }, false],
    [{ costProfile: KOSTENPROFIL.TELNYX_BUDGET }, false],
    [{ costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }, false],
    [{ costProfile: ENTFERNTES_PROFIL }, false],
    [{ costProfile: null }, true],
    [undefined, true],
  ];
  for (const [call, erwartet] of faelle) {
    assert.equal(anrufFuehrtTelnyxSip(call), erwartet, JSON.stringify(call));
  }
});

test("IEX-A1-6: recordElevenLabsKostenBelege mit erwarteTelnyxSip false schreibt nur die EL-Zeile", () => {
  const state = ops.makeDefaultState();
  ops.registerTenant(state, IN_MEMORY_TENANT);
  const call = ops.createCall(state, {
    direction: "inbound",
    from: ANRUFER_NUMMER,
    to: EIGENE_NUMMER,
    tenantId: IN_MEMORY_TENANT,
  });
  const store = { recordCallCostEvidence: (eingabe) => ops.recordCallCostEvidence(state, eingabe) };
  recordElevenLabsKostenBelege({
    store,
    callId: call.id,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: false,
  });
  const traeger = ops.callCostEvidence(state, call.id).map((zeile) => zeile.traeger);
  assert.deepEqual(traeger, [KOSTENART.ELEVENLABS_CONVAI]);
});
