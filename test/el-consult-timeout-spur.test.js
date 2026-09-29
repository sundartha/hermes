// P3: die dauerhafte Spur eines gescheiterten Consult-Halts (audit_log, statt nur der
// fluechtigen Konsolenzeile). Der Anlass ist der Defekt vom 06.09.2026 (PLAN-ANRUFDEFEKTE):
// eine 47 s stille Leitung liess sich nachtraeglich nur ueber eine Zeugenaussage
// aufklaeren, weil der abgebrochene Halt keine durable Spur hinterliess.
//
// WARUM IN-PROCESS UEBER DIE ECHTE ROUTE, KEIN SPAWN: der JSON-Store (helpers.js#startServer)
// hat KEINEN Audit-Sink - auditStoreRef.current bleibt null, nur der pg-gated
// wireWebLogin-Block befuellt ihn (server.js/app.js). Ein Spawn-Test koennte den durablen
// Eintrag also prinzipiell nicht sehen, nur die Konsolenzeile. Deshalb wird hier die ECHTE
// Route (makeElevenLabsWebhookRoutes) an einem echten HTTP-Server auf Port 0 gemountet
// (Muster test/elevenlabs-consult-webhook-guards.test.js: "ein Gate, das nur in der
// Funktion sitzt, aber nicht in der Route haengt, misst sonst gruen") und mit einer
// Attrappe fuer den Sink verdrahtet - der Schreibweg selbst (makeDurableAudit) ist der
// ECHTE (Muster test/kv2-1-kosten-alarm-naht.test.js): die Satzform des Eintrags (inkl.
// tenantId-Feld) ist damit die PRODUKTIVE, keine Nachbildung (G5).
//
// HERUNTERGESETZTE FRISTEN (Muster P2/el-consult-staffelung.test.js, proportional
// uebernommen): kein Testfall dieser Datei wartet laenger als 240 ms auf den gestaffelten
// Abbruch.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";

process.env.CONSULT_ENABLED = "true"; // consult/gate.js liest das config-Singleton beim
process.env.ASSISTANT_CONTEXT_ENABLED = "true"; // Import - Muster callee-is-owner-elevenlabs
// Abweichung vom Wortlaut des Plans (nur die beiden Zeilen oben): consultAllowed()
// (webhooks-elevenlabs.js) prueft zusaetzlich config.tenancy.inCallConsultEnabled - ohne
// dieses Flag lehnt JEDER Fall dieser Datei mit 404 ab (Grund im Log:
// "kanal_nicht_freigegeben"; nach aussen seit SEC-P4 der einheitliche Grund), bevor
// er den zu pruefenden Abbruch je erreicht. Default ist false (Datenschutz-Gate, s.
// config.js); ohne das Flag hier waere der ganze Testkatalog ein Blindgang.
process.env.IN_CALL_CONSULT_ENABLED = "true";

const { makeElevenLabsWebhookRoutes } = await import("../src/routes/webhooks-elevenlabs.js");
const { makeConsultRaised, CONSULT_RESULT } = await import(
  "../src/conversation/consult-raised.js"
);
const { makeDurableAudit } = await import("../src/durable-audit.js");
const ops = await import("../src/store/state-ops.js");
const { CONSULT_TIMEOUT_REASON } = await import("../src/store/defaults.js");
const { config } = await import("../src/config.js");

// G25: benannte Konstanten statt wiederholter Magic Numbers, proportional zu P2
// (el-consult-staffelung.test.js) heruntergezogen.
const STAGES = Object.freeze({ deliveryDeadlineMs: 60, ackDeadlineMs: 120, answerDeadlineMs: 240 });
const TICK_MS = 10;
const FRUEH_MARKIERT_MS = 20; // deutlich vor der jeweils naechsten Stufe
const ANTWORT_NACH_QUITTUNG_MS = 170; // zwischen ackDeadlineMs und answerDeadlineMs

const TENANT_ID = "tenant_spur";
const CALL_ID_PREFIX = "call_spur_";
const CONVERSATION_ID_PREFIX = "conv_spur_";
const CONSULT_ID = "c0"; // erste Rueckfrage der Kette (state-ops.consultIdOf)
const TOOL_TOKEN = "spur-tool-token-testgeheim";
const MARKER = "GEHEIME-MARKER-KETTE-7b2c";
const HTTP_OK = 200; // P3-6: der Sink-Wurf darf die Werkzeug-Antwort nicht auf 500 kippen

config.voice.elevenLabsToolToken = TOOL_TOKEN;

let callSeq = 0;
function nextIds() {
  callSeq += 1;
  return { callId: `${CALL_ID_PREFIX}${callSeq}`, conversationId: `${CONVERSATION_ID_PREFIX}${callSeq}` };
}

// ---- Helfer 1: Store-Double -----------------------------------------------------------
// Wie in test/el-consult-staffelung.test.js, ERWEITERT um genau das, was die ROUTE
// zusaetzlich fragt: resolveProfile (Faehigkeit) und activeCallsFor/liveBudgetExceeded
// (Geld-Gate). Der Anruf traegt tenantId/direction/elevenlabsConversationId, damit
// Bindung, Richtungs-Gate und Kontingent im Gutfall stehen - gemessen wird die SPUR, nicht
// die Gates (die sind in elevenlabs-consult-webhook-guards/-blockers gepinnt).
function storeDouble({ callId, conversationId, zustellenNachMs = null, quittierenNachMs = null, antwortNachMs = null } = {}) {
  const state = { calls: [] };
  state.calls.push({
    id: callId,
    tenantId: TENANT_ID,
    direction: "outbound",
    status: "active",
    elevenlabsConversationId: conversationId,
    consults: [],
    context: { key_facts: [] },
    // answeredAt VOR jeder Rueckfrage: isInCallConsult (state-ops) erkennt eine
    // Rueckfrage nur als IN-CALL, wenn sie nach dem Abnehmen entstand.
    answeredAt: new Date(0).toISOString(),
  });
  const timers = [];

  function consult() {
    const call = ops.getCall(state, callId);
    return call.consults.find((eintrag) => eintrag.id === CONSULT_ID);
  }

  function stufenMarkerStarten() {
    if (zustellenNachMs !== null)
      timers.push(
        setTimeout(() => {
          consult().askDeliveredAt = new Date().toISOString();
        }, zustellenNachMs),
      );
    if (quittierenNachMs !== null)
      timers.push(
        setTimeout(() => {
          const eintrag = consult();
          eintrag.askDeliveredAt ||= new Date().toISOString();
          eintrag.ackedAt = new Date().toISOString();
        }, quittierenNachMs),
      );
    if (antwortNachMs !== null)
      timers.push(
        setTimeout(() => {
          ops.answerConsult(state, callId, {
            eventId: CONSULT_ID,
            facts: ["Donnerstag ab 15 Uhr passt."],
            nowMs: Date.now(),
            openMs: 999_999,
          });
        }, antwortNachMs),
      );
  }

  const store = {
    load: () => state,
    save: () => {},
    getCall: (id) => ops.getCall(state, id),
    emitConsult: (id, questions) => {
      const call = ops.emitConsult(state, id, questions).call;
      stufenMarkerStarten();
      return call;
    },
    timeOutStagedConsult: (id, input) => ops.timeOutStagedConsult(state, id, input),
    resolveProfile: () => ({ allowConsult: true }),
    activeCallsFor: () => [],
    liveBudgetExceeded: () => false,
  };
  return { state, store, cleanup: () => timers.forEach(clearTimeout) };
}

// ---- Helfer 2: Audit-Attrappe -----------------------------------------------------------
// Der PRODUKTIVE Schreibweg (makeDurableAudit) mit einer Attrappe fuer den Sink: so ist
// die Satzform des Eintrags (inkl. tenantId-Feld) die echte, keine Nachbildung (G5).
function auditSpy({ wirft = false } = {}) {
  const eintraege = [];
  const sink = {
    record: (row) => {
      if (wirft) throw new Error("sink-defekt");
      eintraege.push(row);
      return Promise.resolve();
    },
  };
  const auditStoreRef = { current: sink };
  const auditFor = (tenantId) =>
    makeDurableAudit({ audit: () => {}, auditStoreRef, tenantId });
  return { eintraege, auditFor };
}

// ---- Helfer 3: die echte Route an einem echten HTTP-Server -----------------------------
// Ein Gate/Schreibvorgang, der nur in einer Funktion sitzt, aber nicht in der Route haengt,
// wuerde sonst gruen messen (Bestandsmuster elevenlabs-consult-webhook-guards).
async function startRoute({ store, auditFor }) {
  const consultSlots = {
    withOpenSlot: async (callId, tenantId, run) => ({ granted: true, value: await run() }),
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsWebhookRoutes({
      store,
      config,
      consultSlots,
      onConsultRaised: makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS }),
      auditFor,
    }),
  );
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function post(url, body) {
  return fetch(`${url}/webhooks/elevenlabs/consult`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hermes-tool-token": TOOL_TOKEN },
    body: JSON.stringify(body),
  });
}

function detailFieldsOf(entry) {
  return Object.fromEntries(
    entry.detail.split(" ").map((feld) => {
      const [key, ...rest] = feld.split("=");
      return [key, rest.join("=")];
    }),
  );
}

test("P3-1: Stufe 0 (nicht zugestellt) - genau ein Eintrag mit tenantId, grund=not_delivered, kein zugestellt_nach_ms", async () => {
  const { callId, conversationId } = nextIds();
  const { store, cleanup } = storeDouble({ callId, conversationId });
  const { eintraege, auditFor } = auditSpy();
  const route = await startRoute({ store, auditFor });
  try {
    const res = await post(route.url, { conversation_id: conversationId, question: "Frage?" });
    assert.ok(res.ok);
    cleanup();

    assert.equal(eintraege.length, 1, "genau ein durabler Eintrag");
    const [entry] = eintraege;
    assert.equal(entry.action, "consult_timeout");
    assert.equal(entry.tenantId, TENANT_ID);
    const felder = detailFieldsOf(entry);
    assert.equal(felder.call, callId);
    assert.equal(felder.consult, CONSULT_ID);
    assert.equal(felder.grund, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
    assert.ok(Number.isFinite(Number(felder.halt_ms)), "halt_ms ist eine Zahl");
    assert.equal(felder.zugestellt_nach_ms, undefined, "Stufe 0 nie erreicht -> Schluessel fehlt");
    assert.equal(felder.quittiert_nach_ms, undefined);
  } finally {
    await route.close();
  }
});

test("P3-2: Stufe 1 (zugestellt, nicht quittiert) - grund=not_acked, zugestellt_nach_ms vorhanden, quittiert_nach_ms fehlt", async () => {
  const { callId, conversationId } = nextIds();
  const { store, cleanup } = storeDouble({ callId, conversationId, zustellenNachMs: FRUEH_MARKIERT_MS });
  const { eintraege, auditFor } = auditSpy();
  const route = await startRoute({ store, auditFor });
  try {
    const res = await post(route.url, { conversation_id: conversationId, question: "Frage?" });
    assert.ok(res.ok);
    cleanup();

    assert.equal(eintraege.length, 1);
    const felder = detailFieldsOf(eintraege[0]);
    assert.equal(felder.grund, CONSULT_TIMEOUT_REASON.NOT_ACKED);
    assert.ok(Number.isFinite(Number(felder.zugestellt_nach_ms)));
    assert.equal(felder.quittiert_nach_ms, undefined);
  } finally {
    await route.close();
  }
});

test("P3-3: Stufe 2 (quittiert, keine Antwort) - grund=timeout, beide Spannen numerisch vorhanden", async () => {
  const { callId, conversationId } = nextIds();
  const { store, cleanup } = storeDouble({ callId, conversationId, quittierenNachMs: FRUEH_MARKIERT_MS });
  const { eintraege, auditFor } = auditSpy();
  const route = await startRoute({ store, auditFor });
  try {
    const res = await post(route.url, { conversation_id: conversationId, question: "Frage?" });
    assert.ok(res.ok);
    cleanup();

    assert.equal(eintraege.length, 1);
    const felder = detailFieldsOf(eintraege[0]);
    assert.equal(felder.grund, CONSULT_TIMEOUT_REASON.TIMEOUT);
    assert.ok(Number.isFinite(Number(felder.zugestellt_nach_ms)));
    assert.ok(Number.isFinite(Number(felder.quittiert_nach_ms)));
  } finally {
    await route.close();
  }
});

test("P3-4: beantwortete Rueckfrage - kein Eintrag (E-2)", async () => {
  const { callId, conversationId } = nextIds();
  const { store, cleanup } = storeDouble({
    callId,
    conversationId,
    quittierenNachMs: FRUEH_MARKIERT_MS,
    antwortNachMs: ANTWORT_NACH_QUITTUNG_MS,
  });
  const { eintraege, auditFor } = auditSpy();
  const route = await startRoute({ store, auditFor });
  try {
    const res = await post(route.url, { conversation_id: conversationId, question: "Frage?" });
    const body = await res.json();
    cleanup();

    assert.equal(body.status, CONSULT_RESULT.ANSWERED);
    assert.equal(eintraege.length, 0, "eine beantwortete Rueckfrage hinterlaesst keine Spur");
  } finally {
    await route.close();
  }
});

test("P3-5: die Spur ist inhaltsfrei - der Fragetext steht in keinem Detail und in keiner Konsolenzeile (I-2)", async () => {
  const { callId, conversationId } = nextIds();
  const { store, cleanup } = storeDouble({ callId, conversationId });
  const { eintraege, auditFor } = auditSpy();
  const route = await startRoute({ store, auditFor });

  const originalLog = console.log;
  const originalError = console.error;
  const konsole = [];
  console.log = (...args) => konsole.push(args.join(" "));
  console.error = (...args) => konsole.push(args.join(" "));
  try {
    const res = await post(route.url, {
      conversation_id: conversationId,
      question: `Soll ich zurueckrufen? ${MARKER}`,
    });
    assert.ok(res.ok);
    cleanup();

    // Positiv-Kontrolle ZUERST (Lehre pruefkommando-ohne-positiv-kontrolle): steht der
    // Marker nicht einmal am Consult-Datensatz, misst der Rest dieses Falls nichts.
    const persistedCall = store.getCall(callId);
    const persistedConsult = persistedCall.consults.find((eintrag) => eintrag.id === CONSULT_ID);
    assert.ok(
      persistedConsult && persistedConsult.questions.some((frage) => frage.includes(MARKER)),
      "Positiv-Kontrolle: der Marker muss am Consult-Datensatz stehen",
    );

    assert.equal(eintraege.length, 1);
    assert.ok(
      !eintraege[0].detail.includes(MARKER),
      `Marker im durablen Detail: ${eintraege[0].detail}`,
    );
    const konsolenText = konsole.join("\n");
    assert.ok(!konsolenText.includes(MARKER), `Marker in der Konsole:\n${konsolenText}`);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await route.close();
  }
});

test("P3-6: Sink wirft synchron - HTTP bleibt der Timeout-Antwort, kein 500, genau eine Fehlerzeile (I-3)", async () => {
  const { callId, conversationId } = nextIds();
  const { store, cleanup } = storeDouble({ callId, conversationId });
  const { auditFor } = auditSpy({ wirft: true });
  const route = await startRoute({ store, auditFor });

  const originalError = console.error;
  const fehlerzeilen = [];
  console.error = (...args) => fehlerzeilen.push(args.join(" "));
  try {
    const res = await post(route.url, { conversation_id: conversationId, question: "Frage?" });
    cleanup();

    assert.equal(res.status, HTTP_OK, "kein 500 durch einen Sink-Wurf");
    const body = await res.json();
    assert.equal(body.status, CONSULT_RESULT.TIMEOUT);
    assert.equal(body.reason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
    assert.ok(typeof body.answer === "string" && body.answer.length > 0);

    const treffer = fehlerzeilen.filter((zeile) =>
      zeile.includes("[audit] durabler Eintrag fehlgeschlagen"),
    );
    assert.equal(treffer.length, 1, `genau eine Fehlerzeile erwartet, war:\n${fehlerzeilen.join("\n")}`);
  } finally {
    console.error = originalError;
    await route.close();
  }
});

test("P3-7: Verdrahtung - server.js baut durableAuditFor ueber makeDurableAudit, app.js reicht es als auditFor an die Route", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

  const serverSrc = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
  assert.match(
    serverSrc,
    /const durableAuditFor = \(tenantId\) => makeDurableAudit\(\{ audit, auditStoreRef, tenantId \}\);/,
    "server.js muss durableAuditFor ueber makeDurableAudit bauen",
  );
  assert.match(serverSrc, /\bdurableAuditFor,/, "durableAuditFor muss in deps stehen");

  const appSrc = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  assert.match(
    appSrc,
    /auditFor: durableAuditFor,/,
    "app.js muss durableAuditFor als auditFor an makeElevenLabsWebhookRoutes reichen",
  );
});

test("P3-8: die Anbieter-Antwort traegt exakt status/reason/answer - die Spur verlaesst den Server nicht", async () => {
  const { callId, conversationId } = nextIds();
  const { store, cleanup } = storeDouble({ callId, conversationId });
  const { auditFor } = auditSpy();
  const route = await startRoute({ store, auditFor });
  try {
    const res = await post(route.url, { conversation_id: conversationId, question: "Frage?" });
    const body = await res.json();
    cleanup();

    assert.deepEqual(Object.keys(body).sort(), ["answer", "reason", "status"]);
  } finally {
    await route.close();
  }
});
