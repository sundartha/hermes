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
      await new Promise((resolve) => setTimeout(resolve, 10));
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
  assert.equal(billResolved, false, "bill laeuft nach der Rueckkehr von terminateAndBillCall noch weiter");
  assert.deepEqual(order, ["hangUp", "bill-start"]);
});

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
    assert.deepEqual(order, ["persistEnd", "hangUp"]);
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
  await terminateAndBillCall({ persistEnd, hangUp: null, bill });
  await terminateAndBillCall({ persistEnd, hangUp: null, bill });
  assert.equal(billCount, 1, "bill-Wirkung (Buchung) laeuft trotz zweimaligem Gateway-Aufruf nur einmal");
  assert.equal(reserveReleaseCount, 1, "Reserve wird genau einmal freigegeben");
});

test("billThunk liefert einen Thunk, der finishCall mit dem frisch aus dem Store gelesenen Call aufruft", async () => {
  const calls = { "call-1": { id: "call-1", status: "active" } };
  const store = { getCall: (callId) => calls[callId] };
  const finishCallArgs = [];
  const finishCall = (call) => finishCallArgs.push(call);

  const thunk = billThunk(finishCall, store, "call-1");
  thunk();

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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
const lifecycleSrc = fs.readFileSync(path.join(ROOT, "src", "telephony", "call-lifecycle.js"), "utf8");
const apiCallsSrc = fs.readFileSync(path.join(ROOT, "src", "routes", "api-calls.js"), "utf8");
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
    '\n  return router;',
  );
  assert.match(block, /terminateAndBillCall\(\{/);
  assert.match(block, /hangUp:\s*null/);
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
    'router.post("/api/calls", internalOnly, async (req, res) => {',
    'router.post("/api/calls/:id/cancel"',
  );
  const catchBlock = sliceBetween(routeBlock, "} catch (err) {", "res.status(providerStatus");
  assert.match(catchBlock, /terminateAndBillCall\(\{/);
  assert.match(catchBlock, /hangUp:\s*null/);
  assert.match(catchBlock, /bill:\s*billThunk\(finishCall,\s*store,\s*call\.id\)/);
  assert.doesNotMatch(
    catchBlock,
    /await releaseReserve\(call\)/,
    "manuelles releaseReserve darf nicht mehr da sein (Duplikat, S2 - finishCall macht das idempotent selbst)",
  );
});

test("Quelltext: terminateCappedCall und cancel_call nutzen ebenfalls billThunk (alle 4 Pfade EINE Quelle)", () => {
  assert.match(
    serverSrc,
    /import \{ terminateAndBillCall, hangUpAction, billThunk \} from "\.\/telephony\/call-termination\.js";/,
  );
  const cappedBlock = sliceBetween(lifecycleSrc, "async function terminateActiveCall(", "\n  }\n");
  assert.match(cappedBlock, /bill:\s*billThunk\(finishCall,\s*store,\s*callId\)/);
  const cancelBlock = sliceBetween(apiCallsSrc, 'router.post("/api/calls/:id/cancel"', "res.json({ status: \"cancelled\" });");
  assert.match(cancelBlock, /bill:\s*billThunk\(finishCall,\s*store,\s*call\.id\)/);
});
