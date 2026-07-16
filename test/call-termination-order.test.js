// F10 Runde 2 (S1) - terminateAndBillCall: die Reihenfolge der Terminierungsschritte ist
// sicherheitskritisch (Absolute Regel Max-Dauer). Der Fehler in Runde 1 (terminateCappedCall
// buchte VOR dem Hangup) blieb von den Integrationstests unentdeckt, weil FAKE_ORIGINATE
// endCall zu einem sofort aufgeloesten No-op macht und die Verzoegerung dadurch unsichtbar
// bleibt. Dieser Test prueft die Reihenfolge daher direkt an der reinen Orchestrierungs-
// funktion (keine Server-Spawn, kein Netz, kein Store) mit injizierten Thunks, die ihre
// Aufrufe in ein Array protokollieren - deterministisch, offline, F.I.R.S.T.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateAndBillCall, billThunk } from "../src/telephony/call-termination.js";

test("hangUp wird VOLLSTAENDIG abgewartet, BEVOR bill (Buchung/Summary/SMS) angestossen wird", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: async () => {
      order.push("hangUp-start");
      await new Promise((resolve) => setTimeout(resolve, 10)); // simuliert Provider-Latenz
      order.push("hangUp-end");
    },
    bill: () => order.push("bill-start"),
  });
  assert.deepEqual(
    order,
    ["persistEnd", "hangUp-start", "hangUp-end", "bill-start"],
    "bill darf erst NACH dem vollstaendig abgewarteten hangUp starten - nie davor/parallel",
  );
});

test("bill wird NICHT awaited (fire-and-forget): terminateAndBillCall loest auf, ohne auf das Ende von bill zu warten", async () => {
  const order = [];
  let billResolved = false;
  await terminateAndBillCall({
    persistEnd: () => {},
    hangUp: async () => order.push("hangUp"),
    bill: async () => {
      order.push("bill-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      billResolved = true;
      order.push("bill-end");
    },
  });
  // terminateAndBillCall ist bereits fertig (await oben abgeschlossen), aber die
  // 20ms-Verzoegerung in bill kann noch nicht durchgelaufen sein.
  assert.equal(billResolved, false, "bill laeuft nach der Rueckkehr von terminateAndBillCall noch weiter");
  assert.deepEqual(order, ["hangUp", "bill-start"]);
});

// P8 (Review-Blocker S1, Beobachtbarkeit): eine bill-Rejection (z.B. store.markBilled
// schlaegt bei einem PG-IO-Fehler fehl) darf terminateAndBillCall NICHT crashen/rejekten
// lassen (fire-and-forget-Timing bleibt erhalten, persistEnd/hangUp liefen bereits) - UND
// darf NICHT unbeobachtet als generische unhandledRejection verschwinden, sondern wird
// HIER mit stabilem Praefix + callId-Korrelation secret-frei geloggt (nur e.message, nie
// das ganze Error-Objekt). Ohne das interne .catch in terminateAndBillCall wuerde dieser
// Test selbst eine unhandled rejection auf bill() erzeugen (Testabsicherung ohne Fix).
test("bill-Rejection wird abgefangen (kein Crash) und secret-frei mit callId-Kontext geloggt", async () => {
  const order = [];
  const logs = [];
  const origError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    await terminateAndBillCall({
      persistEnd: () => order.push("persistEnd"),
      hangUp: async () => order.push("hangUp"),
      bill: async () => {
        throw new Error("store.markBilled fehlgeschlagen (PG-IO-Fehler)");
      },
      callId: "call-obs-1",
    });
    // terminateAndBillCall darf trotz der bill-Rejection nicht werfen - persistEnd/hangUp
    // sind bereits vollstaendig gelaufen (Reihenfolge unveraendert, Fix betrifft nur bill).
    assert.deepEqual(order, ["persistEnd", "hangUp"]);
    // Der interne .catch laeuft als Microtask NACH der Rueckkehr von terminateAndBillCall
    // (fire-and-forget) - ein Tick Puffer stellt sicher, dass er bereits gefeuert hat.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = origError;
  }
  assert.equal(logs.length, 1, "Settlement-Fehler wird genau einmal geloggt (kein Doppel-Log)");
  assert.match(logs[0], /\[terminateAndBillCall\]/, "stabiles, greifbares Log-Praefix statt nur des generischen Guards");
  assert.match(logs[0], /call-obs-1/, "callId-Korrelation bleibt erhalten");
  assert.match(logs[0], /store\.markBilled fehlgeschlagen \(PG-IO-Fehler\)/, "e.message wird geloggt");
  assert.doesNotMatch(logs[0], /Error:\s*Error/, "kein rohes Error-Objekt/Stack im Log (secret-frei)");
});

test("hangUp-Fehler wird geschluckt (onHangUpError statt Exception) - bill laeuft trotzdem", async () => {
  const order = [];
  const errors = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: async () => {
      throw new Error("provider-timeout");
    },
    bill: () => order.push("bill"),
    onHangUpError: (e) => errors.push(e.message),
  });
  assert.deepEqual(order, ["persistEnd", "bill"], "bill laeuft trotz gescheitertem Hangup (best-effort)");
  assert.deepEqual(errors, ["provider-timeout"]);
});

test("ohne hangUp-Thunk (z.B. fehlender providerCallSid) wird nur persistiert+gebucht, kein Crash", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persistEnd"),
    hangUp: null,
    bill: () => order.push("bill"),
  });
  assert.deepEqual(order, ["persistEnd", "bill"]);
});

// ---- C5 (Struct-4): bill (Settlement) ist strukturell Pflicht ----

test("terminateAndBillCall wirft TypeError VOR jedem Seiteneffekt, wenn bill fehlt oder kein Function ist", async () => {
  for (const badBill of [undefined, null, "not-a-function", 42]) {
    const order = [];
    await assert.rejects(
      () =>
        terminateAndBillCall({
          persistEnd: () => order.push("persistEnd"),
          hangUp: null,
          bill: badBill,
        }),
      TypeError,
    );
    assert.deepEqual(order, [], "persistEnd darf VOR dem Guard-Throw nicht laufen (fail-fast)");
  }
});

test("doppelte Terminierung ueber terminateAndBillCall ist idempotent (kein Doppel-Billing, Reserve genau einmal frei)", async () => {
  // Fake-Call spiegelt die realen Idempotenz-Schloesser (state-ops.js): setCallEndedAt nur aus
  // "active", finishCall/markBilled nur ohne billedAt, releaseOutboundReserve nur ohne
  // reserveReleased. Die Guards leben in bill/persistEnd SELBST (F9/OUT-05) - der Gateway ruft
  // beide immer, unbedingt.
  const call = { status: "active", billedAt: null, reserveReleased: false };
  let billCount = 0;
  let reserveReleaseCount = 0;
  const persistEnd = () => {
    if (call.status === "active") call.status = "completed";
  };
  const bill = () => {
    if (!call.billedAt) {
      billCount += 1;
      call.billedAt = new Date().toISOString();
    }
    if (!call.reserveReleased) {
      reserveReleaseCount += 1;
      call.reserveReleased = true;
    }
  };
  await terminateAndBillCall({ persistEnd, hangUp: null, bill }); // z.B. /voice/status
  await terminateAndBillCall({ persistEnd, hangUp: null, bill }); // Race mit Max-Dauer-Cap auf denselben Call
  assert.equal(billCount, 1, "bill-Wirkung (Buchung) laeuft trotz zweimaligem Gateway-Aufruf nur einmal");
  assert.equal(reserveReleaseCount, 1, "Reserve wird genau einmal freigegeben");
});

// ---- G5 (Review-Blocker Runde 2): billThunk - EINE Quelle statt fuenffacher Wiederholung ----

test("billThunk liefert einen Thunk, der finishCall mit dem frisch aus dem Store gelesenen Call aufruft", async () => {
  // Build: Spy-store liefert bei jedem getCall(callId) den AKTUELLEN Eintrag (frischer Stand,
  // nicht ein evtl. veraltetes Call-Objekt des Aufrufers).
  const calls = { "call-1": { id: "call-1", status: "active" } };
  const store = { getCall: (callId) => calls[callId] };
  const finishCallArgs = [];
  const finishCall = (call) => finishCallArgs.push(call);

  // Operate
  const thunk = billThunk(finishCall, store, "call-1");
  thunk();

  // Check
  assert.equal(finishCallArgs.length, 1, "finishCall laeuft genau einmal");
  assert.equal(finishCallArgs[0], calls["call-1"], "finishCall bekommt den frisch aus dem Store gelesenen Call");
});

test("billThunk liest den Call bei JEDEM Aufruf des Thunks frisch (nicht einmalig beim Erzeugen)", () => {
  const calls = { "call-1": { id: "call-1", status: "active" } };
  const store = { getCall: (callId) => calls[callId] };
  const finishCallArgs = [];
  const thunk = billThunk((call) => finishCallArgs.push(call), store, "call-1");
  calls["call-1"] = { id: "call-1", status: "completed", billedAt: "2026-07-15T00:00:00.000Z" };
  thunk();
  assert.equal(
    finishCallArgs[0],
    calls["call-1"],
    "der Thunk kapselt store.getCall(callId), nicht einen bereits gelesenen Call-Snapshot",
  );
});

// ---- C5: Quelltext-Wiring-Guards (Muster telnyx-p6-cap-callcontrol.test.js T6/T7) ----

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
const ingestSrc = fs.readFileSync(path.join(ROOT, "src", "telnyx-call-control-ingest.js"), "utf8");
// P5 (Server-Slim): terminateCappedCall wanderte nach telephony/call-lifecycle.js.
const lifecycleSrc = fs.readFileSync(path.join(ROOT, "src", "telephony", "call-lifecycle.js"), "utf8");
// P9 (Server-Slim): die /api/calls-Route-Gruppe wanderte nach routes/api-calls.js.
const apiCallsSrc = fs.readFileSync(path.join(ROOT, "src", "routes", "api-calls.js"), "utf8");
// P11 (Server-Slim): die /voice-Handler wanderten nach routes/voice.js (makeVoiceRoutes).
const voiceSrc = fs.readFileSync(path.join(ROOT, "src", "routes", "voice.js"), "utf8");

function sliceBetween(src, startMarker, endMarker, fromIndex = 0) {
  const start = src.indexOf(startMarker, fromIndex);
  assert.notEqual(start, -1, `Marker nicht gefunden: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `End-Marker nicht gefunden: ${endMarker}`);
  return src.slice(start, end);
}

test("Quelltext: /voice/status nutzt terminateAndBillCall(bill: billThunk(...)) statt dem alten manuellen Paar", () => {
  const block = sliceBetween(
    voiceSrc,
    'router.post("/voice/status", async (req, res) => {',
    '\n  router.post(',
  );
  assert.match(block, /terminateAndBillCall\(\{/);
  assert.match(block, /hangUp:\s*null/);
  // P11 (Server-Slim): finishCall kommt jetzt als injizierter Dep in makeVoiceRoutes herein
  // (== callFinish.finishCall bei der Verdrahtung in server.js) - der Modul-Quelltext
  // referenziert den bare Dep-Namen, wie terminateCappedCall in call-lifecycle.js (P5) und
  // die Aufrufstellen in api-calls.js (P9).
  assert.match(block, /bill:\s*billThunk\(finishCall,\s*store,\s*call\.id\)/);
  assert.doesNotMatch(
    block,
    /^\s*finishCall\(store\.getCall\(call\.id\)\);\s*$/m,
    "der alte bare finishCall-Aufruf ausserhalb des Gateways darf nicht mehr da sein",
  );
});

test("Quelltext: place_call-catch nutzt terminateAndBillCall (die geschlossene C5-Luecke)", () => {
  const routeBlock = sliceBetween(
    apiCallsSrc,
    'router.post("/api/calls", async (req, res) => {',
    'router.post("/api/calls/:id/cancel"',
  );
  const catchBlock = sliceBetween(routeBlock, "} catch (err) {", "res.status(providerStatus");
  assert.match(catchBlock, /terminateAndBillCall\(\{/);
  assert.match(catchBlock, /hangUp:\s*null/);
  // P9 (Server-Slim): finishCall kommt jetzt als injizierter Dep herein (== callFinish.finishCall
  // bei der Verdrahtung in server.js) - der Modul-Quelltext referenziert den bare Dep-Namen,
  // wie terminateCappedCall in call-lifecycle.js.
  assert.match(catchBlock, /bill:\s*billThunk\(finishCall,\s*store,\s*call\.id\)/);
  assert.doesNotMatch(
    catchBlock,
    /await releaseReserve\(call\)/,
    "manuelles releaseReserve darf nicht mehr da sein (Duplikat, S2 - finishCall macht das idempotent selbst)",
  );
});

test("Quelltext: Telnyx onHangup nutzt terminateAndBillCall statt dem alten awaited finishCall-Aufruf", () => {
  const block = sliceBetween(
    ingestSrc,
    "async function onHangup(call) {",
    "async function resolveActiveCall(callId) {",
  );
  assert.match(ingestSrc, /from "\.\/telephony\/call-termination\.js"/, "terminateAndBillCall-Import fehlt");
  assert.match(block, /terminateAndBillCall\(\{/);
  assert.match(block, /hangUp:\s*null/);
  assert.match(block, /bill:\s*billThunk\(finishCall,\s*store,\s*call\.id\)/);
  assert.doesNotMatch(
    block,
    /^\s*await finishCall\(store\.getCall\(call\.id\)\);\s*$/m,
    "der alte direkt awaitete finishCall-Aufruf darf nicht mehr da sein",
  );
});

// G5 (Review-Blocker Runde 2): jetzt alle 5 Terminierungspfade (nicht nur die 3 aus dem
// urspruenglichen Befund) - haelt fest, dass terminateCappedCall/cancel_call NACH dem
// Refactor denselben billThunk-Helper nutzen wie die 3 anderen Pfade (EINE Quelle, G5).
test("Quelltext: terminateCappedCall und cancel_call nutzen ebenfalls billThunk (alle 5 Pfade EINE Quelle)", () => {
  assert.match(
    serverSrc,
    /import \{ terminateAndBillCall, hangUpAction, billThunk \} from "\.\/telephony\/call-termination\.js";/,
  );
  // P5 (Server-Slim): terminateCappedCall lebt jetzt in call-lifecycle.js; finishCall kommt
  // dort als injizierter Dep herein (== callFinish.finishCall bei der Verdrahtung), daher
  // referenziert der Modul-Quelltext den bare Dep-Namen, nicht callFinish.finishCall.
  const cappedBlock = sliceBetween(lifecycleSrc, "async function terminateCappedCall(", "\n}\n");
  assert.match(cappedBlock, /bill:\s*billThunk\(finishCall,\s*store,\s*callId\)/);
  const cancelBlock = sliceBetween(apiCallsSrc, 'router.post("/api/calls/:id/cancel"', "res.json({ status: \"cancelled\" });");
  assert.match(cancelBlock, /bill:\s*billThunk\(finishCall,\s*store,\s*call\.id\)/);
});
