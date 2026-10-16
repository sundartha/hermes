import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeVoiceRoutes } from "../src/routes/voice.js";
import { webhookEvents } from "../src/telephony/registry.js";
import { reattachActiveCall } from "../src/telephony/reattach.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { seedCall, waitUntil } from "./helpers.js";

const MAX_DURATION_S = 180;
const SECONDS_60 = 60;
const SECONDS_400 = 400;
const MS_PER_S = 1000;

const activeCall = (secondsAgo) => ({
  id: "reattach_c1",
  twilioSid: "CA_reattach_c1",
  status: "active",
  answeredAt: new Date(Date.now() - secondsAgo * MS_PER_S).toISOString(),
  startedAt: null,
  maxDurationS: null,
});

function makeDeps(attachResult, { budgetAxis = null } = {}) {
  const calls = { terminate: [], schedule: [], overBudget: [] };
  const deps = {
    attachActiveCall: async () => attachResult,
    maxCallDurationS: MAX_DURATION_S,
    terminateCappedCall: async (callId, twilioSid, status) => {
      calls.terminate.push({ callId, twilioSid, status });
    },
    scheduleMaxDurationEnd: (call, twilioSid, ms) => {
      calls.schedule.push({ callId: call.id, twilioSid, ms });
    },
    budgetAxisFor: () => budgetAxis,
    terminateOverBudgetCall: async (callId, twilioSid) => {
      calls.overBudget.push({ callId, twilioSid });
    },
  };
  return { deps, calls };
}

test("reattachActiveCall: aktiv im Zeitfenster -> Call zurueck, Timer rearmed, KEIN Terminate", async () => {
  const call = activeCall(SECONDS_60);
  const { deps, calls } = makeDeps(call);

  const result = await reattachActiveCall("reattach_c1", deps);

  assert.deepEqual(result, { call }, "aktiver Call im Fenster wird zurueckgegeben");
  assert.equal(calls.terminate.length, 0, "kein Terminate im aktiven Fenster");
  assert.equal(calls.schedule.length, 1, "Timer wird genau einmal rearmed");
  assert.equal(calls.schedule[0].callId, "reattach_c1");
  assert.equal(calls.schedule[0].twilioSid, "CA_reattach_c1");
  assert.ok(
    calls.schedule[0].ms > 0 && calls.schedule[0].ms <= MAX_DURATION_S * MS_PER_S,
    `Rest-ms muss positiv und gekappt sein: ${calls.schedule[0].ms}`,
  );
});

test("reattachActiveCall: Ueberzeit -> terminalisiert (kein Reanimieren), Timer NICHT rearmed", async () => {
  const call = activeCall(SECONDS_400);
  const { deps, calls } = makeDeps(call);

  const result = await reattachActiveCall("reattach_c1", deps);

  assert.deepEqual(
    result,
    { call: null, logUnknown: false },
    "Ueber-Zeit-Leg wird NICHT reanimiert (logUnknown:false unterscheidet vom echten Unbekannt-Fall)",
  );
  assert.equal(calls.terminate.length, 1, "genau ein Terminate-Aufruf");
  assert.deepEqual(calls.terminate[0], {
    callId: "reattach_c1",
    twilioSid: "CA_reattach_c1",
    status: "failed",
  });
  assert.equal(calls.schedule.length, 0, "kein Timer-Rearm fuer ein bereits terminalisiertes Leg");
});

test("reattachActiveCall: wirklich unbekannt (attachActiveCall -> null) -> logUnknown:true, kein Effekt", async () => {
  const { deps, calls } = makeDeps(null);

  const result = await reattachActiveCall("reattach_unknown", deps);

  assert.deepEqual(result, { call: null, logUnknown: true });
  assert.equal(calls.terminate.length, 0);
  assert.equal(calls.schedule.length, 0);
});

test("reattachActiveCall: attachActiveCall liefert nicht-aktiven Call -> logUnknown:true, kein Effekt", async () => {
  const { deps, calls } = makeDeps({ ...activeCall(SECONDS_60), status: "completed" });

  const result = await reattachActiveCall("reattach_c1", deps);

  assert.deepEqual(result, { call: null, logUnknown: true });
  assert.equal(calls.terminate.length, 0);
  assert.equal(calls.schedule.length, 0);
});

test("KS-P1b-7: aktiv im Zeitfenster, aber Geld-Achse sperrt -> terminalisiert statt reanimiert, KEIN Timer-Rearm", async () => {
  const call = activeCall(SECONDS_60);
  const { deps, calls } = makeDeps(call, { budgetAxis: "budget_tenant" });

  const result = await reattachActiveCall("reattach_c1", deps);

  assert.deepEqual(
    result,
    { call: null, logUnknown: false },
    "erschoepftes Guthaben ist KEIN Unbekannt-Fall: bereits terminalisiert+gebucht",
  );
  assert.equal(calls.overBudget.length, 1, "genau eine Geld-Terminalisierung");
  assert.deepEqual(calls.overBudget[0], { callId: "reattach_c1", twilioSid: "CA_reattach_c1" });
  assert.equal(calls.schedule.length, 0, "kein Rearm fuer ein Leg, das nicht mehr bezahlt ist");
  assert.equal(calls.terminate.length, 0, "die Zeit-Achse hat NICHT gegriffen (falscher Grund waere eine Luege am Record)");
});

test("KS-P1b-8: Ueberzeit UND erschoepftes Guthaben -> die Zeit-Achse gewinnt (genauerer Cap-Grund)", async () => {
  const call = activeCall(SECONDS_400);
  const { deps, calls } = makeDeps(call, { budgetAxis: "budget_tenant" });

  const result = await reattachActiveCall("reattach_c1", deps);

  assert.deepEqual(result, { call: null, logUnknown: false });
  assert.equal(calls.terminate.length, 1, "Zeit-Cap terminalisiert");
  assert.equal(calls.terminate[0].status, "failed");
  assert.equal(calls.overBudget.length, 0, "genau EINE Terminalisierung - kein zweiter Pfad");
  assert.equal(calls.schedule.length, 0);
});

function makeRaceDeps(attachResult) {
  const calls = { attach: 0, terminate: [], schedule: [] };
  const deps = {
    attachActiveCall: async () => {
      calls.attach++;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return attachResult;
    },
    maxCallDurationS: MAX_DURATION_S,
    terminateCappedCall: async (callId, twilioSid, status) => {
      calls.terminate.push({ callId, twilioSid, status });
    },
    scheduleMaxDurationEnd: (call, twilioSid, ms) => {
      calls.schedule.push({ callId: call.id, twilioSid, ms });
    },
    budgetAxisFor: () => null,
    terminateOverBudgetCall: async () => {},
  };
  return { deps, calls };
}

test("reattachActiveCall RACE-1: zwei fast gleichzeitige Aufrufe fuer dieselbe callId teilen sich EINEN Lauf - genau EIN attachActiveCall, genau EIN Timer-Rearm", async () => {
  const call = activeCall(SECONDS_60);
  const { deps, calls } = makeRaceDeps(call);

  const [r1, r2] = await Promise.all([
    reattachActiveCall("reattach_c1", deps),
    reattachActiveCall("reattach_c1", deps),
  ]);

  assert.equal(calls.attach, 1, "attachActiveCall darf fuer den ueberlappenden Aufruf nur EINMAL laufen");
  assert.equal(calls.schedule.length, 1, "der Max-Dauer-Timer darf nur EINMAL armiert werden (kein Timer-Leak)");
  assert.equal(calls.terminate.length, 0);
  assert.deepEqual(r1, { call }, "beide Aufrufer bekommen dasselbe Ergebnis");
  assert.deepEqual(r2, { call });
});

test("reattachActiveCall RACE-1: unterschiedliche callIds laufen unabhaengig (kein Cross-Call-Merge)", async () => {
  const callA = { ...activeCall(SECONDS_60), id: "reattach_a", twilioSid: "CA_reattach_a" };
  const callB = { ...activeCall(SECONDS_60), id: "reattach_b", twilioSid: "CA_reattach_b" };
  const attachSpy = { calls: 0 };
  const scheduleCalls = [];
  const deps = {
    attachActiveCall: async (callId) => {
      attachSpy.calls++;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return callId === "reattach_a" ? callA : callB;
    },
    maxCallDurationS: MAX_DURATION_S,
    terminateCappedCall: async () => {},
    scheduleMaxDurationEnd: (call, twilioSid, ms) => {
      scheduleCalls.push({ callId: call.id, twilioSid, ms });
    },
    budgetAxisFor: () => null,
    terminateOverBudgetCall: async () => {},
  };

  const [rA, rB] = await Promise.all([
    reattachActiveCall("reattach_a", deps),
    reattachActiveCall("reattach_b", deps),
  ]);

  assert.equal(attachSpy.calls, 2, "unterschiedliche callIds laufen je EIGENSTAENDIG (kein falsches Teilen)");
  assert.equal(scheduleCalls.length, 2);
  assert.deepEqual(rA, { call: callA });
  assert.deepEqual(rB, { call: callB });
});

test("reattachActiveCall RACE-1: nach Abschluss wird der In-Flight-Eintrag geraeumt - ein spaeterer, NICHT-ueberlappender Aufruf laedt frisch neu (kein Memory-Leak/keine Stale-Cache)", async () => {
  const call = activeCall(SECONDS_60);
  const { deps, calls } = makeRaceDeps(call);

  await reattachActiveCall("reattach_c1", deps);
  await reattachActiveCall("reattach_c1", deps);

  assert.equal(
    calls.attach,
    2,
    "zwei NACHEINANDER abgeschlossene Aufrufe laden je frisch - der Eintrag bleibt nicht dauerhaft gecacht",
  );
});

const ZURUECKGEHOLT = "zurueckgeholt";

function zurueckgeholterCall(callId) {
  return seedCall({
    id: callId,
    provider: "telnyx",
    transcript: [{ role: "caller", text: "Ja, guten Tag, hier ist die Praxis am Markt." }],
  });
}

async function webhookRoutenMitSpion(spion) {
  const leererStore = {
    getCall: () => null,
    attachActiveCall: async (callId) => {
      spion.direktAngehaengt.push(callId);
      return null;
    },
    recordWebhookAnchors: () => {},
    countNoSpeechTurn: () => 1,
  };
  const merkeCall = (call) => {
    if (call?.id) spion.weitergearbeitet.push(call.id);
    return [];
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store: leererStore,
      config: withConfigNamespaces({ skipTwilioSignatureCheck: true }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: merkeCall, sayInCallVoice: merkeCall, followupTurnDirectives: merkeCall },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: {
        reattachActiveCall: async (callId) => {
          spion.wiederaufnahmen.push(callId);
          return { call: callId.startsWith(ZURUECKGEHOLT) ? zurueckgeholterCall(callId) : null, logUnknown: false };
        },
      },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async ({ callId }) => {
        spion.beendet.push(callId);
      },
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  return {
    post: (pfad, felder = {}) =>
      abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(felder).toString(),
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

test("Webhooks fuer einen Call, den dieser Prozess nicht kennt, holen ihn ueber lifecycle.reattachActiveCall zurueck und arbeiten mit ihm weiter, nie direkt ueber store.attachActiveCall", async () => {
  const spion = { wiederaufnahmen: [], direktAngehaengt: [], weitergearbeitet: [], beendet: [] };
  const routen = await webhookRoutenMitSpion(spion);
  const aufrufe = [
    ["/voice/status", `${ZURUECKGEHOLT}_status`, { CallStatus: "completed" }],
    ["/voice/turn", `${ZURUECKGEHOLT}_turn`, {}],
    ["/voice/outbound", "unbekannt_outbound", {}],
  ];
  try {
    for (const [pfad, callId, felder] of aufrufe) {
      const antwort = await routen.post(`${pfad}?callId=${callId}`, felder);
      assert.equal(antwort.status, 200, `${pfad} antwortet dem Carrier`);
      await antwort.text();
    }
    await waitUntil(() => spion.beendet.length > 0);
    assert.deepEqual(spion.wiederaufnahmen, aufrufe.map(([, callId]) => callId), "jede Route nimmt genau einmal wieder auf");
    assert.deepEqual(spion.beendet, [`${ZURUECKGEHOLT}_status`], "/voice/status beendet den zurueckgeholten Call");
    assert.deepEqual(spion.weitergearbeitet, [`${ZURUECKGEHOLT}_turn`], "/voice/turn spricht mit dem zurueckgeholten Call weiter, statt aufzulegen");
    assert.deepEqual(spion.direktAngehaengt, [], "keine Route umgeht die Restzeit-Pruefung ueber store.attachActiveCall");
  } finally {
    await routen.close();
  }
});
