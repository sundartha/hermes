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
import { terminateAndBillCall } from "../src/telephony/call-termination.js";

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

// ---- C5: Quelltext-Wiring-Guards (Muster telnyx-p6-cap-callcontrol.test.js T6/T7) ----

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
const ingestSrc = fs.readFileSync(path.join(ROOT, "src", "telnyx-call-control-ingest.js"), "utf8");

function sliceBetween(src, startMarker, endMarker, fromIndex = 0) {
  const start = src.indexOf(startMarker, fromIndex);
  assert.notEqual(start, -1, `Marker nicht gefunden: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `End-Marker nicht gefunden: ${endMarker}`);
  return src.slice(start, end);
}

test("Quelltext: /voice/status nutzt terminateAndBillCall(bill: finishCall) statt dem alten manuellen Paar", () => {
  const block = sliceBetween(
    serverSrc,
    'app.post("/voice/status", async (req, res) => {',
    '\napp.post(',
  );
  assert.match(block, /terminateAndBillCall\(\{/);
  assert.match(block, /hangUp:\s*null/);
  assert.match(block, /bill:\s*\(\)\s*=>\s*finishCall\(store\.getCall\(call\.id\)\)/);
  assert.doesNotMatch(
    block,
    /^\s*finishCall\(store\.getCall\(call\.id\)\);\s*$/m,
    "der alte bare finishCall-Aufruf ausserhalb des Gateways darf nicht mehr da sein",
  );
});

test("Quelltext: place_call-catch nutzt terminateAndBillCall (die geschlossene C5-Luecke)", () => {
  const routeBlock = sliceBetween(
    serverSrc,
    'app.post("/api/calls", async (req, res) => {',
    'app.post("/api/calls/:id/cancel"',
  );
  const catchBlock = sliceBetween(routeBlock, "} catch (err) {", "res.status(providerStatus");
  assert.match(catchBlock, /terminateAndBillCall\(\{/);
  assert.match(catchBlock, /hangUp:\s*null/);
  assert.match(catchBlock, /bill:\s*\(\)\s*=>\s*finishCall\(store\.getCall\(call\.id\)\)/);
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
  assert.match(block, /bill:\s*\(\)\s*=>\s*finishCall\(store\.getCall\(call\.id\)\)/);
  assert.doesNotMatch(
    block,
    /^\s*await finishCall\(store\.getCall\(call\.id\)\);\s*$/m,
    "der alte direkt awaitete finishCall-Aufruf darf nicht mehr da sein",
  );
});
