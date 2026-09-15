// KV2-4 (tasks/kostenv2/spec-kv2-4.md): der ElevenLabs-Beleg, synchron und vorlaeufig.
// Zwei Ebenen: Ebene 1 in-memory ueber state-ops (Muster test/kv2-3-kosten-buch.test.js),
// kein Netz, kein Spawn; Ebene 2 durch die echte Fabrik (Muster
// test/el-sip-call-id-join.test.js), echter json-Store auf Temp-DATA_DIR,
// globalThis.fetch-Attrappe.
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests) - "KV2-4 (...)" trifft weder
// package.json config.i18nCatalogPattern noch config.abnahmePattern.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  makeDefaultState,
  registerTenant,
  createCall,
  recordCallCostEvidence,
  callCostEvidence,
} from "../src/store/state-ops.js";
import { REIFE } from "../src/store/defaults.js";
import {
  recordElevenLabsKostenBelege,
  elBelegBetrag,
  EL_BELEG_ABLEHNUNG,
  EL_BELEG_QUELLE,
} from "../src/elevenlabs/kosten-beleg.js";
import { KOSTENART } from "../src/billing/kostenarten.js";
import {
  CONVERSATION_DONE_MIT_KOSTEN,
  CONVERSATION_FAILED_INVALID_DESTINATION,
} from "./fixtures/elevenlabs-conversations.js";

// G25: benannte Testbetraege statt nackter Zahlen in den assert-Aufrufen unten.
// Gemessen, node -e mit dem echten Parser: parseDecimalToMicroCents("0.10420301650668388").
const B2_ANRUF_1_MIKRO_CENTS = 10_420_301;
const ZWEI_ZEILEN = 2;
// G25: benannte Testwerte fuer die (b)-Faelle statt nackter Zahlen in den Metadaten.
const DAUER_SEKUNDEN_BELIEBIG = 10;
const DAUER_SEKUNDEN_KURZ = 5;
const NEGATIVER_TESTBETRAG_USD = -0.5;

// ---- Ebene 1: in-memory ueber state-ops, kein Netz, kein Spawn -------------------------

function seedCall() {
  const state = makeDefaultState();
  const tenantId = "t_kv24";
  registerTenant(state, tenantId);
  const call = createCall(state, {
    direction: "outbound",
    from: "+49123",
    to: "+49456",
    tenantId,
  });
  // Store-Naht (Plan Abschnitt 3.1): nur die eine Methode, die kosten-beleg.js braucht.
  const store = { recordCallCostEvidence: (eingabe) => recordCallCostEvidence(state, eingabe) };
  return { state, store, callId: call.id };
}

function mitLautemWarn(fn) {
  const original = console.warn;
  const zeilen = [];
  console.warn = (...args) => zeilen.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return zeilen;
}

function elZeile(state, callId) {
  return callCostEvidence(state, callId).find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
}
function sipZeile(state, callId) {
  return callCostEvidence(state, callId).find((zeile) => zeile.traeger === KOSTENART.TELNYX_SIP);
}

// Baut eine metadata-Attrappe mit genau den zwei Feldern, die elBelegBetrag liest -
// die uebrigen Fixture-Details sind fuer die (b)-Faelle irrelevant.
const metadata = (costFiat, durationSecs) => ({ cost_fiat: costFiat, call_duration_secs: durationSecs });

test("KV2-4 (a): genau eine vorlaeufig-Zeile mit exaktem Mikro-Cent-Integer", () => {
  const { state, store, callId } = seedCall();
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: true,
  });
  const zeile = elZeile(state, callId);
  assert.ok(zeile, "die EL-Zeile muss existieren");
  assert.equal(zeile.betragMikroCents, B2_ANRUF_1_MIKRO_CENTS);
  assert.equal(zeile.waehrung, "USD");
  assert.equal(zeile.reife, REIFE.VORLAEUFIG);
  assert.equal(zeile.quelle, EL_BELEG_QUELLE);
  assert.equal(zeile.belegRef, "conv_6301m0dha17kes9ax95jzx19cvt4");
});

test("KV2-4 (a): die Preisaufschluesselung landet im detail, nicht als eigene Buchungsposten", () => {
  const { state, store, callId } = seedCall();
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: true,
  });
  const zeilen = callCostEvidence(state, callId);
  assert.equal(zeilen.length, ZWEI_ZEILEN, "genau elevenlabs_convai + telnyx_sip, keine dritte");
  assert.deepStrictEqual(elZeile(state, callId).detail, {
    call_duration_secs: 53,
    llm_price: 0.034607,
    platform_price: 0.069596,
    tier: "starter",
    analysis_price: 0,
  });
});

test("KV2-4 (a): die telnyx_sip-Zeile entsteht als erwartet und ohne Betrag", () => {
  const { state, store, callId } = seedCall();
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: true,
  });
  const zeile = sipZeile(state, callId);
  assert.ok(zeile, "die telnyx_sip-Zeile muss existieren");
  assert.equal(zeile.reife, REIFE.ERWARTET);
  assert.equal(zeile.betragMikroCents, null, "nie 0 - nichts ist gemessen");
});

test("KV2-4 (b): fehlendes cost_fiat erzeugt KEINE EL-Zeile, telnyx_sip bleibt", () => {
  const { state, store, callId } = seedCall();
  const conversation = { conversation_id: "conv_ohne_kosten", metadata: {} };
  const zeilen = mitLautemWarn(() =>
    recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar: true, erwarteTelnyxSip: true }),
  );
  assert.equal(elZeile(state, callId), undefined, "keine EL-Zeile");
  assert.ok(sipZeile(state, callId), "telnyx_sip bleibt bestehen");
  assert.equal(zeilen.length, 1, "genau eine WARN-Zeile");
  assert.ok(zeilen[0].includes(EL_BELEG_ABLEHNUNG.FEHLT));
});

test("KV2-4 (b): nicht-numerisches cost_fiat erzeugt KEINE EL-Zeile", () => {
  const { state, store, callId } = seedCall();
  const conversation = { conversation_id: "conv_nan", metadata: metadata("0.05", DAUER_SEKUNDEN_BELIEBIG) };
  const zeilen = mitLautemWarn(() =>
    recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar: true, erwarteTelnyxSip: true }),
  );
  assert.equal(elZeile(state, callId), undefined);
  assert.ok(sipZeile(state, callId));
  assert.ok(zeilen[0].includes(EL_BELEG_ABLEHNUNG.KEIN_FLOAT));
});

test("KV2-4 (b): negatives cost_fiat erzeugt KEINE EL-Zeile", () => {
  const { state, store, callId } = seedCall();
  const conversation = {
    conversation_id: "conv_neg",
    metadata: metadata(NEGATIVER_TESTBETRAG_USD, DAUER_SEKUNDEN_BELIEBIG),
  };
  const zeilen = mitLautemWarn(() =>
    recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar: true, erwarteTelnyxSip: true }),
  );
  assert.equal(elZeile(state, callId), undefined);
  assert.ok(sipZeile(state, callId));
  assert.ok(zeilen[0].includes(EL_BELEG_ABLEHNUNG.NEGATIV));
});

test("KV2-4 (b): 0 bei call_duration_secs > 0 erzeugt KEINE EL-Zeile", () => {
  const { state, store, callId } = seedCall();
  const conversation = { conversation_id: "conv_null_dauer", metadata: metadata(0, DAUER_SEKUNDEN_KURZ) };
  const zeilen = mitLautemWarn(() =>
    recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar: true, erwarteTelnyxSip: true }),
  );
  assert.equal(elZeile(state, callId), undefined);
  assert.ok(sipZeile(state, callId));
  assert.ok(zeilen[0].includes(EL_BELEG_ABLEHNUNG.NULL_BEI_DAUER));
});

test("KV2-4 (b): 0 bei call_duration_secs === 0 erzeugt eine gueltige Zeile mit Betrag 0", () => {
  const { state, store, callId } = seedCall();
  const conversation = { conversation_id: "conv_beide_null", metadata: metadata(0, 0) };
  const zeilen = mitLautemWarn(() =>
    recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar: true, erwarteTelnyxSip: true }),
  );
  const zeile = elZeile(state, callId);
  assert.ok(zeile, "eine Zeile mit Betrag 0 ist gueltig");
  assert.equal(zeile.betragMikroCents, 0);
  assert.equal(zeile.reife, REIFE.VORLAEUFIG);
  assert.equal(zeilen.length, 0, "keine WARN-Zeile");
});

test("KV2-4 (b): 0 bei unbrauchbarer Dauer ist fail-closed", () => {
  const { state, store, callId } = seedCall();
  const conversation = { conversation_id: "conv_dauer_unklar", metadata: metadata(0, "unbekannt") };
  const zeilen = mitLautemWarn(() =>
    recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar: true, erwarteTelnyxSip: true }),
  );
  assert.equal(elZeile(state, callId), undefined);
  assert.ok(zeilen[0].includes(EL_BELEG_ABLEHNUNG.NULL_DAUER_UNKLAR));
});

test("KV2-4 (d): zweiter Aufruf mit derselben callId legt keine zweite Zeile an", () => {
  const { state, store, callId } = seedCall();
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: true,
  });
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: true,
  });
  const zeilen = callCostEvidence(state, callId);
  assert.equal(zeilen.length, ZWEI_ZEILEN, "weiterhin genau zwei Zeilen");
  assert.equal(elZeile(state, callId).betragMikroCents, B2_ANRUF_1_MIKRO_CENTS, "Betrag unveraendert");
});

test("KV2-4 (c): nachreifbar ist eine Einbahnstrasse", () => {
  const { state, store, callId } = seedCall();
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: false,
    erwarteTelnyxSip: true,
  });
  assert.equal(elZeile(state, callId).nachreifbar, false);
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: true,
  });
  assert.equal(elZeile(state, callId).nachreifbar, false, "false bleibt false");
});

test("KV2-4 (c): true -> false schlaegt durch", () => {
  const { state, store, callId } = seedCall();
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: true,
    erwarteTelnyxSip: true,
  });
  assert.equal(elZeile(state, callId).nachreifbar, true);
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: false,
    erwarteTelnyxSip: true,
  });
  assert.equal(elZeile(state, callId).nachreifbar, false);
});

test("KV2-4 (c): die telnyx_sip-Zeile bleibt auch auf dem Abbruchweg nachreifbar", () => {
  const { state, store, callId } = seedCall();
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation: CONVERSATION_DONE_MIT_KOSTEN,
    belegNachreifbar: false,
    erwarteTelnyxSip: true,
  });
  assert.equal(sipZeile(state, callId).nachreifbar, true, "der Riegel gilt NUR dem EL-Beleg");
});

test("KV2-4 (b/PII): eine abgelehnte Antwort schreibt nichts, was ein Transkript enthaelt", () => {
  const { store, callId } = seedCall();
  const conversation = {
    conversation_id: "conv_pii",
    metadata: metadata(undefined, DAUER_SEKUNDEN_BELIEBIG),
    transcript: [{ role: "user", message: "Jonas Beispiel, +49 151 2345678" }],
  };
  const zeilen = mitLautemWarn(() =>
    recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar: true, erwarteTelnyxSip: true }),
  );
  assert.equal(zeilen.length, 1);
  assert.ok(!zeilen[0].includes("Jonas Beispiel"));
  assert.ok(!zeilen[0].includes("2345678"));
});

test("KV2-4: elBelegBetrag ist rein - kein Wurf bei einer leeren/fehlenden metadata", () => {
  assert.deepStrictEqual(elBelegBetrag(undefined), { ablehnung: EL_BELEG_ABLEHNUNG.FEHLT });
  assert.deepStrictEqual(elBelegBetrag({}), { ablehnung: EL_BELEG_ABLEHNUNG.FEHLT });
});

// ---- Ebene 2: durch die echte Fabrik, echter json-Store, fetch-Attrappe ---------------

let jsonStore, BOOTSTRAP;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kv2-4-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  jsonStore = await import("../src/store/json.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

async function ladeOutbound() {
  const { makeElevenLabsOutbound } = await import("../src/elevenlabs/outbound.js");
  return makeElevenLabsOutbound;
}

const POLL_MS = 5;
const WARTE_MS = 4000;
const WARTE_TAKT_MS = 10;
const START_PATH = "/v1/convai/sip-trunk/outbound-call";

function testConfig() {
  return {
    voice: {
      elevenLabsOutbound: {
        apiKey: "kv24-test-key",
        agentId: "kv24-agent",
        agentPhoneNumberId: "kv24-phnum",
        apiBase: "https://kv24-test.invalid",
        resultPollMs: POLL_MS,
      },
    },
    telnyx: { telnyxElevenLabs: { voiceId: "kv24-test-stimme" } },
    safety: { fakeOriginateElevenlabs: false },
  };
}

async function outboundFactory(store, terminateAndBillCallOverride) {
  const makeElevenLabsOutbound = await ladeOutbound();
  return makeElevenLabsOutbound({
    store,
    config: testConfig(),
    terminateAndBillCall:
      terminateAndBillCallOverride ||
      (async ({ persistEnd, bill }) => {
        await persistEnd?.();
        await bill?.();
      }),
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
    goal: "KV2-4 Beleg pruefen",
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

const startAntwortFuer = (conversationId) => ({
  success: true,
  conversation_id: conversationId,
  sip_call_id: "SCL_irrelevant",
});

test("KV2-4 (c): das regulaere Ende markiert nachreifbar=true, reife=vorlaeufig", async () => {
  const call = neuerAnruf();
  const { originateCall } = await outboundFactory(jsonStore);
  await mitAttrappe(
    { startAntwort: startAntwortFuer(CONVERSATION_DONE_MIT_KOSTEN.conversation_id), gespraech: CONVERSATION_DONE_MIT_KOSTEN },
    async () => {
      await originateCall(jsonStore.getCall(call.id));
      return warteBis(() =>
        jsonStore
          .callCostEvidence(call.id)
          .some((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI),
      );
    },
  );
  const zeile = jsonStore
    .callCostEvidence(call.id)
    .find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.ok(zeile, "die EL-Zeile muss entstanden sein");
  assert.equal(zeile.nachreifbar, true);
  assert.equal(zeile.reife, REIFE.VORLAEUFIG);
  assert.equal(zeile.betragMikroCents, B2_ANRUF_1_MIKRO_CENTS);
});

test("KV2-4 (c): der Abbruchweg markiert nachreifbar=false, reife bleibt vorlaeufig (nicht beleg_strukturell_unbeschaffbar)", async () => {
  const call = neuerAnruf();
  const { originateCall, endActiveCall } = await outboundFactory(jsonStore);
  await mitAttrappe(
    { startAntwort: startAntwortFuer(CONVERSATION_DONE_MIT_KOSTEN.conversation_id), gespraech: CONVERSATION_DONE_MIT_KOSTEN },
    () => originateCall(jsonStore.getCall(call.id)),
  );
  await warteBis(() => Boolean(jsonStore.getCall(call.id)?.elevenlabsConversationId));
  await mitAttrappe(
    { startAntwort: startAntwortFuer(CONVERSATION_DONE_MIT_KOSTEN.conversation_id), gespraech: CONVERSATION_DONE_MIT_KOSTEN },
    () => endActiveCall(call.id),
  );
  const zeile = jsonStore
    .callCostEvidence(call.id)
    .find((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.ok(zeile, "die EL-Zeile muss auch auf dem Abbruchweg entstehen");
  assert.equal(zeile.nachreifbar, false);
  assert.equal(
    zeile.reife,
    REIFE.VORLAEUFIG,
    "AUSDRUECKLICH nicht beleg_strukturell_unbeschaffbar (Entscheidung Plan-Abschnitt 0)",
  );
  assert.equal(zeile.betragMikroCents, B2_ANRUF_1_MIKRO_CENTS);
});

test("KV2-4 (e): der Belegweg beruehrt weder Gate-Achse noch Erloes-Buch", async () => {
  const call = neuerAnruf();
  const vorherUsage = JSON.parse(JSON.stringify(jsonStore.usageOf(BOOTSTRAP)));
  const { originateCall } = await outboundFactory(jsonStore);
  await mitAttrappe(
    { startAntwort: startAntwortFuer(CONVERSATION_DONE_MIT_KOSTEN.conversation_id), gespraech: CONVERSATION_DONE_MIT_KOSTEN },
    async () => {
      await originateCall(jsonStore.getCall(call.id));
      return warteBis(() =>
        jsonStore
          .callCostEvidence(call.id)
          .some((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI),
      );
    },
  );
  const nachherUsage = JSON.parse(JSON.stringify(jsonStore.usageOf(BOOTSTRAP)));
  assert.deepStrictEqual(nachherUsage, vorherUsage, "der Belegweg bucht auf KEINE Gate-/Erloes-Achse");
});

test("KV2-4: Fail-soft - ein Store-Fehler im Belegweg haelt Terminierung/Abrechnung nicht auf", async () => {
  const call = neuerAnruf();
  let billGerufen = false;
  const werfendeStore = {
    ...jsonStore,
    recordCallCostEvidence: () => {
      throw new Error("kv2-4-test-fehler");
    },
  };
  const { originateCall } = await outboundFactory(werfendeStore, async ({ persistEnd, bill }) => {
    await persistEnd?.();
    billGerufen = true;
    await bill?.();
  });
  const zeilen = [];
  const originalError = console.error;
  console.error = (...args) => zeilen.push(args.join(" "));
  try {
    await mitAttrappe(
      {
        startAntwort: startAntwortFuer(CONVERSATION_FAILED_INVALID_DESTINATION.conversation_id),
        gespraech: CONVERSATION_DONE_MIT_KOSTEN,
      },
      async () => {
        await originateCall(jsonStore.getCall(call.id));
        return warteBis(() => billGerufen);
      },
    );
  } finally {
    console.error = originalError;
  }
  assert.ok(billGerufen, "terminateAndBillCall muss trotz Store-Fehler im Belegweg laufen");
  assert.ok(
    zeilen.some((zeile) => zeile.includes("kv2-4-test-fehler")),
    "der Fehler wird geloggt, nicht verschluckt",
  );
});
