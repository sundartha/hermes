import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let ops, jsonStore, makePgStore, PGlite, BOOTSTRAP, publicCall, KOSTENPROFIL;
let BRIDGE_STATE, bridgeStateOf;
let dataDir;
let jsonSeq = 0;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-iel-b4a-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  ops = await import("../src/store/state-ops.js");
  jsonStore = await import("../src/store/json.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
  ({ publicCall } = await import("../src/store/views.js"));
  ({ KOSTENPROFIL } = await import("../src/billing/kostenarten.js"));
  ({ BRIDGE_STATE, bridgeStateOf } = await import("../src/elevenlabs/inbound-bridge-state.js"));
});

const T0_ISO = "2026-09-14T10:00:00.000Z";
const T1_ISO = "2026-09-14T10:00:05.000Z";
const JETZT_MS = Date.parse("2026-09-14T10:05:00.000Z");
const MARKER_VERGANGEN_ISO = "2026-09-14T10:04:00.000Z";
const MARKER_ZUKUNFT_ISO = "2026-09-14T10:06:00.000Z";
const CONV_A = "conv_iel_b4a_a";
const CONV_B = "conv_iel_b4a_b";
const ANZAHL_BRIDGE_STATES = 4;

function neuerElInboundCall(state) {
  const call = ops.createCall(state, {
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  ops.recordCostProfile(state, call.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  return call.id;
}

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner, db };
}

test("IEL-B4a-0: Positiv-Kontrolle - BRIDGE_STATE hat 4 verschiedene, eingefrorene Werte", () => {
  assert.equal(Object.isFrozen(BRIDGE_STATE), true);
  const werte = Object.values(BRIDGE_STATE);
  assert.equal(werte.length, ANZAHL_BRIDGE_STATES);
  assert.equal(new Set(werte).size, ANZAHL_BRIDGE_STATES);
  assert.equal(typeof KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, "string");
});

const ZUSTANDS_TABELLE = [
  ["---", false, false, false, "WARTET"],
  ["c--", true, false, false, "GEBUNDEN"],
  ["-f-", false, true, false, "RUECKFALL"],
  ["cf-", true, true, false, "RUECKFALL"],
  ["--n", false, false, true, "WARTET"],
  ["c-n", true, false, true, "GEBUNDEN"],
  ["-fn", false, true, true, "RUECKFALL"],
  ["cfn", true, true, true, "RUECKFALL"],
];

for (const [label, conv, fallback, nachlauf, erwartet] of ZUSTANDS_TABELLE) {
  test(`IEL-B4a-1: Zustandstabelle EL-Inbound-Profil (${label})`, () => {
    const call = {
      costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
      elevenlabsConversationId: conv ? CONV_A : null,
      elFallbackAt: fallback ? T0_ISO : null,
      elNachlaufStartedAt: nachlauf ? T0_ISO : null,
    };
    assert.equal(bridgeStateOf(call), BRIDGE_STATE[erwartet]);
  });
}

const ANDERE_PROFILE = [null, "TELNYX_INBOUND_BUDGET", "EL_CONVAI_SIP"];

for (const profilSchluessel of ANDERE_PROFILE) {
  test(`IEL-B4a-2: Profil ${profilSchluessel} ist immer KEIN_EL_INBOUND, auch mit allen Feldern gesetzt`, () => {
    const profil = profilSchluessel === null ? null : KOSTENPROFIL[profilSchluessel];
    assert.equal(bridgeStateOf({ costProfile: profil }), BRIDGE_STATE.KEIN_EL_INBOUND);
    assert.equal(
      bridgeStateOf({
        costProfile: profil,
        elevenlabsConversationId: CONV_A,
        elFallbackAt: T0_ISO,
        elNachlaufStartedAt: T0_ISO,
      }),
      BRIDGE_STATE.KEIN_EL_INBOUND,
    );
  });
}

test("IEL-B4a-3: Altdatensatz ohne die drei Felder (undefined) hydriert wie null", () => {
  assert.equal(
    bridgeStateOf({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI }),
    BRIDGE_STATE.WARTET,
  );
  assert.equal(bridgeStateOf({ costProfile: null }), BRIDGE_STATE.KEIN_EL_INBOUND);
  assert.equal(bridgeStateOf(null), BRIDGE_STATE.KEIN_EL_INBOUND);
});

test("IEL-B4a-4: carrierEndMsOf - kein Marker -> jetzt, Vergangenheit -> Marker, Zukunft -> jetzt", () => {
  assert.equal(ops.carrierEndMsOf({ elNachlaufStartedAt: null }, JETZT_MS), JETZT_MS);
  assert.equal(ops.carrierEndMsOf({}, JETZT_MS), JETZT_MS);
  assert.equal(
    ops.carrierEndMsOf({ elNachlaufStartedAt: MARKER_VERGANGEN_ISO }, JETZT_MS),
    Date.parse(MARKER_VERGANGEN_ISO),
  );
  assert.equal(ops.carrierEndMsOf({ elNachlaufStartedAt: MARKER_ZUKUNFT_ISO }, JETZT_MS), JETZT_MS);
  assert.equal(Number.isNaN(ops.carrierEndMsOf({ elNachlaufStartedAt: "kaputt" }, JETZT_MS)), true);
});

test("IEL-B4a-5: markInboundElNachlaufStarted ist set-once", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  const erster = ops.markInboundElNachlaufStarted(state, callId, T0_ISO);
  assert.equal(erster.changed, true);
  assert.equal(erster.call.elNachlaufStartedAt, T0_ISO);
  const zweiter = ops.markInboundElNachlaufStarted(state, callId, T1_ISO);
  assert.equal(zweiter.changed, false);
  assert.equal(zweiter.call.elNachlaufStartedAt, T0_ISO);
});

test("IEL-B4a-6: markInboundElFallback ist set-once, unbekannter Call wirft nicht", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  ops.markInboundElFallback(state, callId, T0_ISO);
  const zweiter = ops.markInboundElFallback(state, callId, T1_ISO);
  assert.equal(zweiter.call.elFallbackAt, T0_ISO);
  const unbekannt = ops.markInboundElFallback(state, "call_gibt_es_nicht", T0_ISO);
  assert.deepEqual(unbekannt, { call: null, changed: false });
});

const NICHT_KANONISCHE_ZEITEN = ["kaputt", undefined, "2026-09-14"];

for (const wert of NICHT_KANONISCHE_ZEITEN) {
  test(`IEL-B4a-7: Marker verwerfen nicht kanonische Zeit (${String(wert)})`, () => {
    const state = jsonStore.load();
    const callId = neuerElInboundCall(state);
    const nachlauf = ops.markInboundElNachlaufStarted(state, callId, wert);
    assert.equal(nachlauf.changed, false);
    assert.equal(ops.getCall(state, callId).elNachlaufStartedAt, null);
    const rueckfall = ops.markInboundElFallback(state, callId, wert);
    assert.equal(rueckfall.changed, false);
    assert.equal(ops.getCall(state, callId).elFallbackAt, null);
  });
}

test("IEL-B4a-8: Bindung aus WARTET setzt Conversation-ID und elBoundAt", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  const ergebnis = ops.bindInboundElConversation(state, callId, { conversationId: CONV_A, nowIso: T0_ISO });
  assert.equal(ergebnis.changed, true);
  assert.equal(ergebnis.bound, true);
  const call = ops.getCall(state, callId);
  assert.equal(call.elevenlabsConversationId, CONV_A);
  assert.equal(call.elBoundAt, T0_ISO);
  assert.equal(bridgeStateOf(call), BRIDGE_STATE.GEBUNDEN);
});

test("IEL-B4a-9: gleiche Conversation-ID erneut ist idempotent", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  ops.bindInboundElConversation(state, callId, { conversationId: CONV_A, nowIso: T0_ISO });
  const erneut = ops.bindInboundElConversation(state, callId, { conversationId: CONV_A, nowIso: T1_ISO });
  assert.equal(erneut.bound, true);
  assert.equal(erneut.changed, false);
  assert.equal(ops.getCall(state, callId).elBoundAt, T0_ISO);
});

test("IEL-B4a-10: eine zweite, andere Conversation-ID wird verweigert", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  ops.bindInboundElConversation(state, callId, { conversationId: CONV_A, nowIso: T0_ISO });
  const zweite = ops.bindInboundElConversation(state, callId, { conversationId: CONV_B, nowIso: T1_ISO });
  assert.equal(zweite.bound, false);
  assert.equal(zweite.changed, false);
  assert.equal(ops.getCall(state, callId).elevenlabsConversationId, CONV_A);
});

test("IEL-B4a-11: Bindung nach Rueckfall wird verweigert", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  ops.markInboundElFallback(state, callId, T0_ISO);
  const ergebnis = ops.bindInboundElConversation(state, callId, { conversationId: CONV_A, nowIso: T1_ISO });
  assert.equal(ergebnis.bound, false);
  const call = ops.getCall(state, callId);
  assert.equal(call.elevenlabsConversationId, null);
  assert.equal(bridgeStateOf(call), BRIDGE_STATE.RUECKFALL);
});

test("IEL-B4a-12: Rueckfall nach Bindung wird gesetzt", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  ops.bindInboundElConversation(state, callId, { conversationId: CONV_A, nowIso: T0_ISO });
  const rueckfall = ops.markInboundElFallback(state, callId, T1_ISO);
  assert.equal(rueckfall.changed, true);
  assert.equal(bridgeStateOf(ops.getCall(state, callId)), BRIDGE_STATE.RUECKFALL);
});

test("IEL-B4a-13: Bindung eines Nicht-EL-Inbound-Calls (Budget) wird verweigert", () => {
  const state = jsonStore.load();
  const call = ops.createCall(state, {
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  ops.recordCostProfile(state, call.id, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
  const ergebnis = ops.bindInboundElConversation(state, call.id, { conversationId: CONV_A, nowIso: T0_ISO });
  assert.equal(ergebnis.bound, false);
  assert.equal(ops.getCall(state, call.id).elevenlabsConversationId, null);
});

const UNGUELTIGE_BINDUNGEN = [
  { conversationId: "", nowIso: T0_ISO },
  { conversationId: {}, nowIso: T0_ISO },
  { conversationId: undefined, nowIso: T0_ISO },
  { conversationId: CONV_A, nowIso: "kaputt" },
];

for (const eingabe of UNGUELTIGE_BINDUNGEN) {
  test(`IEL-B4a-14: Bindung verwirft ungueltige Eingabe (${JSON.stringify(eingabe)})`, () => {
    const state = jsonStore.load();
    const callId = neuerElInboundCall(state);
    const ergebnis = ops.bindInboundElConversation(state, callId, eingabe);
    assert.equal(ergebnis.bound, false);
    assert.equal(ergebnis.changed, false);
    assert.equal(ops.getCall(state, callId).elevenlabsConversationId, null);
  });
}

test("IEL-B4a-15: createCall initialisiert die drei Bruecken-Felder mit null", () => {
  const state = jsonStore.load();
  const call = ops.createCall(state, {
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  assert.equal(call.elBoundAt, null);
  assert.equal(call.elFallbackAt, null);
  assert.equal(call.elNachlaufStartedAt, null);
});

test("IEL-B4a-16: publicCall streift die drei Bruecken-Felder, status/id bleiben", () => {
  const projiziert = publicCall({
    id: "call_x",
    status: "active",
    elBoundAt: T0_ISO,
    elFallbackAt: T0_ISO,
    elNachlaufStartedAt: T0_ISO,
  });
  assert.equal(projiziert.id, "call_x");
  assert.equal(projiziert.status, "active");
  assert.equal("elBoundAt" in projiziert, false);
  assert.equal("elFallbackAt" in projiziert, false);
  assert.equal("elNachlaufStartedAt" in projiziert, false);
});

test("IEL-B4a-17: json-Wrapper speichert und liefert das volle Op-Ergebnis", () => {
  const state = jsonStore.load();
  const callId = neuerElInboundCall(state);
  jsonStore.save();
  const ergebnis = jsonStore.bindInboundElConversation(callId, { conversationId: CONV_A, nowIso: T0_ISO });
  assert.equal(ergebnis.bound, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  assert.equal(onDisk.calls.find((eintrag) => eintrag.id === callId).elBoundAt, T0_ISO);
});

test("IEL-B4a-18: Neustart JSON - Zustaende ueberleben einen frischen Import", async () => {
  const wartetId = neuerElInboundCall(jsonStore.load());
  jsonStore.save();

  const gebundenId = neuerElInboundCall(jsonStore.load());
  jsonStore.bindInboundElConversation(gebundenId, { conversationId: CONV_A, nowIso: T0_ISO });

  const rueckfallId = neuerElInboundCall(jsonStore.load());
  jsonStore.markInboundElFallback(rueckfallId, T0_ISO);

  const reopened = await import(`../src/store/json.js?iel-b4a-neustart=${jsonSeq++}`);
  assert.equal(bridgeStateOf(reopened.getCall(wartetId)), BRIDGE_STATE.WARTET);
  const gebunden = reopened.getCall(gebundenId);
  assert.equal(bridgeStateOf(gebunden), BRIDGE_STATE.GEBUNDEN);
  assert.equal(gebunden.elBoundAt, T0_ISO);
  assert.equal(bridgeStateOf(reopened.getCall(rueckfallId)), BRIDGE_STATE.RUECKFALL);
});

test("IEL-B4a-19: JSON-Altdatensatz ohne die drei Felder hydriert auf null", async () => {
  const callId = neuerElInboundCall(jsonStore.load());
  jsonStore.save();
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const eintrag = raw.calls.find((eintrag) => eintrag.id === callId);
  delete eintrag.elBoundAt;
  delete eintrag.elFallbackAt;
  delete eintrag.elNachlaufStartedAt;
  fs.writeFileSync(path.join(dataDir, "store.json"), JSON.stringify(raw));

  const reopened = await import(`../src/store/json.js?iel-b4a-altdatensatz=${jsonSeq++}`);
  const call = reopened.getCall(callId);
  assert.equal(call.elBoundAt, null);
  assert.equal(call.elFallbackAt, null);
  assert.equal(call.elNachlaufStartedAt, null);
});

test("IEL-B4a-20: Neustart pg - Zustaende + Nachlauf-Marker ueberleben einen Reopen, Form gleich json", async () => {
  const { store, runner } = await makePgTestStore();

  const wartetCall = store.createCall({
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  store.recordCostProfile(wartetCall.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);

  const gebundenCall = store.createCall({
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  store.recordCostProfile(gebundenCall.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  store.bindInboundElConversation(gebundenCall.id, { conversationId: CONV_A, nowIso: T0_ISO });
  store.markInboundElNachlaufStarted(gebundenCall.id, T1_ISO);

  const rueckfallCall = store.createCall({
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  store.recordCostProfile(rueckfallCall.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  store.markInboundElFallback(rueckfallCall.id, T0_ISO);

  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();

  assert.equal(bridgeStateOf(reopened.getCall(wartetCall.id)), BRIDGE_STATE.WARTET);
  const gebunden = reopened.getCall(gebundenCall.id);
  assert.equal(bridgeStateOf(gebunden), BRIDGE_STATE.GEBUNDEN);
  assert.equal(typeof gebunden.elBoundAt, "string");
  assert.equal(gebunden.elBoundAt, T0_ISO);
  assert.equal(typeof gebunden.elNachlaufStartedAt, "string");
  assert.equal(gebunden.elNachlaufStartedAt, T1_ISO);
  assert.equal(bridgeStateOf(reopened.getCall(rueckfallCall.id)), BRIDGE_STATE.RUECKFALL);
});

test("IEL-B4a-21: pg - ein Folge-Flush setzt gebundene Marker nicht auf NULL zurueck", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall({
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  store.recordCostProfile(call.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  store.bindInboundElConversation(call.id, { conversationId: CONV_A, nowIso: T0_ISO });
  await store.save();

  store.markAnswered(call.id);
  await store.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(call.id).elBoundAt, T0_ISO);
});

test("IEL-B4a-22: pg - eine Bestandstabelle ohne die drei Spalten bekommt sie per init() nachgezogen", async () => {
  const { runner, db } = await makePgTestStore();
  await db.exec(
    "ALTER TABLE call DROP COLUMN el_bound_at, DROP COLUMN el_fallback_at, DROP COLUMN el_nachlauf_started_at",
  );

  const nachgezogen = makePgStore(runner);
  await nachgezogen.init();

  const call = nachgezogen.createCall({
    direction: "inbound",
    from: "+491700000001",
    to: "+491700000002",
    tenantId: BOOTSTRAP,
  });
  nachgezogen.recordCostProfile(call.id, KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  const ergebnis = nachgezogen.bindInboundElConversation(call.id, { conversationId: CONV_A, nowIso: T0_ISO });
  assert.equal(ergebnis.bound, true);
  await nachgezogen.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(call.id).elBoundAt, T0_ISO);
});

test("IEL-B4a-23: store.js (Fassade, json-Default) reicht die drei Operationen durch", async () => {
  const facade = await import("../src/store.js");
  assert.equal(typeof facade.bindInboundElConversation, "function");
  assert.equal(typeof facade.markInboundElFallback, "function");
  assert.equal(typeof facade.markInboundElNachlaufStarted, "function");
});
