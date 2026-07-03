// F12 Runde 2 (Review-Blocker S1-1/S1-2): reattachActiveCall() ist nach telephony/reattach.js
// ausgelagert (Muster call-termination.js/max-duration-pure.test.js: reine Orchestrierung mit
// injizierten Thunks, OHNE Server-Spawn/Store/Netz testbar - Praezedenzfall F1). Dieser Test
// pinnt die beiden sicherheitskritischen Restzeit-Zweige, die der Bestand vorher NICHT
// abdeckte:
//   a) aktiv im Zeitfenster  -> Call zurueck, Timer rearmed (scheduleMaxDurationEnd),
//                               terminateCappedCall NICHT aufgerufen.
//   b) Ueberzeit             -> terminalisiert (terminateCappedCall), Call NICHT reanimiert
//                               (logUnknown:false), scheduleMaxDurationEnd NICHT aufgerufen.
//   c) wirklich unbekannt / nicht-aktiv -> logUnknown:true, weder terminate noch rearm.
// Zusaetzlich ein Quelltext-Check (Muster test/mcp-server-icon.test.js T-T3-AC2): /voice/status
// nutzt denselben reattachActiveCall()-Wrapper wie /voice/turn/outbound - NICHT mehr
// store.attachActiveCall direkt (die urspruengliche Asymmetrie/der Bug aus F12-S1-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reattachActiveCall } from "../src/telephony/reattach.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_DURATION_S = 180;
const SECONDS_60 = 60;
const SECONDS_400 = 400;
const MS_PER_S = 1000;

// Minimaler Call-Ausschnitt (Muster max-duration-pure.test.js: keine volle createCall-
// Fixture noetig, reattachActiveCall liest nur status/twilioSid/answeredAt/startedAt/
// maxDurationS).
const activeCall = (secondsAgo) => ({
  id: "reattach_c1",
  twilioSid: "CA_reattach_c1",
  status: "active",
  answeredAt: new Date(Date.now() - secondsAgo * MS_PER_S).toISOString(),
  startedAt: null,
  maxDurationS: null,
});

// Baut Spy-Thunks + eine feste attachActiveCall-Antwort - Build-Schritt (P13).
function makeDeps(attachResult) {
  const calls = { terminate: [], schedule: [] };
  const deps = {
    attachActiveCall: async () => attachResult,
    maxCallDurationS: MAX_DURATION_S,
    terminateCappedCall: async (callId, twilioSid, status) => {
      calls.terminate.push({ callId, twilioSid, status });
    },
    scheduleMaxDurationEnd: (call, twilioSid, ms) => {
      calls.schedule.push({ callId: call.id, twilioSid, ms });
    },
  };
  return { deps, calls };
}

test("reattachActiveCall: aktiv im Zeitfenster -> Call zurueck, Timer rearmed, KEIN Terminate", async () => {
  const call = activeCall(SECONDS_60); // 60s von 180s verbraucht -> 120s Rest
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
  const call = activeCall(SECONDS_400); // 400s > 180s Limit -> laengst ueberzogen
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

// ---- Asymmetrie-Regressionsguard (F12-S1-1): /voice/status vs. /voice/turn/outbound ----
// Quelltext-Check (Muster test/mcp-server-icon.test.js T-T3-AC2): server.js ist nicht
// import-sicher (Top-Level app.listen) - der Wiring-Beweis, dass /voice/status denselben
// reattachActiveCall()-Wrapper nutzt wie /voice/turn/outbound (statt store.attachActiveCall
// direkt, der urspruengliche Bug), ist damit nur ueber den Quelltext fassbar.
test("server.js: /voice/status nutzt denselben reattachActiveCall()-Wrapper wie /voice/turn (keine direkte store.attachActiveCall-Umgehung)", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");

  const statusHandler = src.slice(src.indexOf('app.post("/voice/status"'), src.indexOf('app.post("/voice/status"') + 1500);
  assert.match(
    statusHandler,
    /await reattachActiveCall\(/,
    "/voice/status muss ueber reattachActiveCall() re-attachen (Restzeit-Klassifikation+Timer-Rearm)",
  );
  assert.doesNotMatch(
    statusHandler,
    /store\.attachActiveCall\(/,
    "/voice/status darf store.attachActiveCall NICHT mehr direkt umgehen (F12-S1-1)",
  );

  const turnHandler = src.slice(src.indexOf('app.post("/voice/turn"'), src.indexOf('app.post("/voice/turn"') + 1500);
  assert.match(turnHandler, /await reattachActiveCall\(/, "/voice/turn bleibt auf reattachActiveCall()");
});
