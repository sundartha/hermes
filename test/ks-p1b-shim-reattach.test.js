// KS-P1b: der Assistant-Shim loest einen Call nicht mehr NUR ueber den Prozess-Spiegel auf.
// Ein Deploy-/Instanzwechsel liess bisher jeden laufenden Assistant-Turn mit 403 auflaufen,
// waehrend der Call beim Provider ohne Cap-Timer und ohne Dead-Air-Watchdog weiterlief
// (KS-P1-Befund). Jetzt geht der Miss ueber denselben Re-Attach-Seam wie
// /voice/turn|outbound|status und der Call-Control-Ingest.
//
// Reine Fake-Tests gegen makeTelnyxLlmShim (kein Netz, kein Spawn, kein Store - F.I.R.S.T.).
// Der Re-Attach selbst ist hier ein Spy: sein INHALT (Restzeit-Klassifikation, Geld-Achse,
// Cap-Rearm) ist Gegenstand von test/reattach-active-call.test.js; hier steht die Frage,
// ob der Shim ihn ueberhaupt betritt und wie er auf die drei Antworten reagiert.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";
import { captureConsole, noopWatchdog } from "./helpers.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import {
  fakeRes,
  fakeStore,
  agentTurnSpy,
  makeCall,
  validReq,
  sseContent,
  voiceControlSpy,
} from "./telnyx-shim-harness.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Spiegel-LEERER Store: getCallByControlId trifft NIE (genau der Zustand nach einem
// Instanzwechsel), getCall kennt den Call aber - der Terminierungs-Fresh-Fetch braucht ihn.
// Die Geld-Achse ist frei; Schritt 6 des Shims ist hier nicht der Pruefgegenstand.
function mirrorlessStore(call) {
  const getCallByControlIdCalls = [];
  return {
    getCallByControlIdCalls,
    getCallByControlId(ccid) {
      getCallByControlIdCalls.push(ccid);
      return null;
    },
    getCall: (id) => (call && call.id === id ? call : null),
    activeOutboundCallsFor: () => [],
    liveBudgetExceeded: () => false,
  };
}

// Spy fuer lifecycle.reattachActiveCallByControlId: protokolliert die ccid und liefert eine
// feste Antwort aus dem Re-Attach-Vertrag ({call} | {call:null,logUnknown:bool}).
function reattachSpy(result) {
  const calls = [];
  async function reattachActiveCallByControlId(ccid) {
    calls.push(ccid);
    return result;
  }
  reattachActiveCallByControlId.calls = calls;
  return reattachActiveCallByControlId;
}

// Build-Schritt (P13): Handler mit dem Re-Attach-Spy statt des Harness-Defaults.
function makeHandler({ store, agentTurn, reattachActiveCallByControlId }) {
  return makeTelnyxLlmShim({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn,
    localeFor,
    voiceControl: voiceControlSpy(),
    watchdog: noopWatchdog(),
    reattachActiveCallByControlId,
  });
}

test("KS-P1b-1: Spiegel-Miss + aktive DB-Zeile -> KEIN 403, Turn laeuft gegen den re-attachten Call", async () => {
  const call = makeCall();
  const store = mirrorlessStore(call);
  const agentTurn = agentTurnSpy();
  const reattach = reattachSpy({ call, logUnknown: true });
  const handler = makeHandler({ store, agentTurn, reattachActiveCallByControlId: reattach });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(validReq(call), res));

  assert.equal(res.statusCode, null, "kein 403 mehr fuer einen re-attachbaren Call");
  assert.equal(agentTurn.calls.length, 1, "genau ein agentTurn-Aufruf");
  assert.equal(agentTurn.calls[0].call, call, "der Turn laeuft gegen die re-attachte Call-Referenz");
  assert.equal(sseContent(res), "Hallo Welt", "die Antwort geht als normale Completion raus");
  assert.deepEqual(reattach.calls, [call.callControlId], "Re-Attach genau einmal, mit der ccid");
  assert.ok(
    lines.some((l) => l.includes('[telnyx-shim] reattached {"callId":"call_x"}')),
    `reattached-Zeile fehlt: ${JSON.stringify(lines)}`,
  );
});

test("KS-P1b-2: Spiegel-Miss + Restzeit abgelaufen (bereits terminalisiert) -> 403, kein Turn, Grund reattach_terminalized", async () => {
  const call = makeCall();
  const store = mirrorlessStore(call);
  const agentTurn = agentTurnSpy();
  const reattach = reattachSpy({ call: null, logUnknown: false });
  const handler = makeHandler({ store, agentTurn, reattachActiveCallByControlId: reattach });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(validReq(call), res));

  assert.equal(res.statusCode, 403, "ein bereits terminalisiertes Leg wird nicht reanimiert");
  assert.equal(agentTurn.calls.length, 0, "kein Token-Burn auf einem terminalisierten Leg");
  assert.ok(
    lines.some((l) => l.includes('"reason":"reattach_terminalized"')),
    `Gate-Log reattach_terminalized fehlt: ${JSON.stringify(lines)}`,
  );
  assert.ok(
    !lines.some((l) => l.includes('"reason":"call_unresolved"')),
    "ein terminalisierter Call ist NICHT 'unresolved' - eigener Grund-Token (G2)",
  );
});

test("KS-P1b-3: Spiegel-Miss + inzwischen erschoepftes Guthaben (bereits terminalisiert) -> 403, kein Turn", async () => {
  const call = makeCall();
  const store = mirrorlessStore(call);
  const agentTurn = agentTurnSpy();
  // Aus Sicht des Shims ununterscheidbar von KS-P1b-2: der Re-Attach-Vertrag traegt nur
  // "bereits terminalisiert". WELCHE Achse gegriffen hat, steht als failureReason am Record
  // (Pruefgegenstand von test/reattach-active-call.test.js + cap-failure-reason.test.js).
  const reattach = reattachSpy({ call: null, logUnknown: false });
  const handler = makeHandler({ store, agentTurn, reattachActiveCallByControlId: reattach });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(validReq(call), res));

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
  assert.ok(lines.some((l) => l.includes('"reason":"reattach_terminalized"')));
});

test("KS-P1b-4: Spiegel-Miss + wirklich unbekannter Call -> 403 mit UNVERAENDERTER call_unresolved-Zeile", async () => {
  const call = makeCall();
  const store = mirrorlessStore(call);
  const agentTurn = agentTurnSpy();
  const reattach = reattachSpy({ call: null, logUnknown: true });
  const handler = makeHandler({ store, agentTurn, reattachActiveCallByControlId: reattach });
  const res = fakeRes();

  const lines = await captureConsole(() => handler(validReq(call), res));

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
  // Wortlaut-Regression: der AL-P8-Bench-Parser haengt an genau dieser Zeile.
  assert.ok(
    lines.some((l) => l.includes('{"reason":"call_unresolved","found":false,"status":null}')),
    `unveraenderte call_unresolved-Zeile fehlt: ${JSON.stringify(lines)}`,
  );
});

test("KS-P1b-5: Spiegel-TREFFER -> Re-Attach wird NIE gerufen (Normalfall bleibt ohne DB-Roundtrip)", async () => {
  const call = makeCall();
  const store = fakeStore({ call }); // getCallByControlId trifft
  const agentTurn = agentTurnSpy();
  const reattach = reattachSpy({ call: null, logUnknown: true });
  const handler = makeHandler({ store, agentTurn, reattachActiveCallByControlId: reattach });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.equal(agentTurn.calls.length, 1, "der Normalfall laeuft unveraendert durch");
  assert.equal(reattach.calls.length, 0, "kein Re-Attach, wenn der Spiegel den aktiven Call kennt");
});

// ---- Verdrahtungs-Regression (Quelltext-Check, Muster reattach-active-call.test.js) ----
// src/app.js ist nicht ohne Boot-Kette importierbar; dass der Shim-Mount die EINE
// lifecycle-Naht durchreicht, ist damit nur ueber den Quelltext fassbar. Ohne diesen Test
// bliebe eine vergessene Verdrahtung bis zum naechsten echten Instanzwechsel unentdeckt.
test("KS-P1b-6: app.js reicht lifecycle.reattachActiveCallByControlId an den Shim-Mount durch", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");
  const mountLine = src.split("\n").find((l) => l.includes("app.post") && l.includes("makeTelnyxLlmShim"));

  assert.ok(mountLine, "Shim-Mount in src/app.js nicht gefunden");
  assert.match(
    mountLine,
    /reattachActiveCallByControlId:\s*lifecycle\.reattachActiveCallByControlId/,
    "der Shim-Mount muss die EINE lifecycle-Instanz durchreichen (INV-7)",
  );
});
