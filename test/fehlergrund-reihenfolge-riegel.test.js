import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { terminateAndBillCall, persistEndWithReason } from "../src/telephony/call-termination.js";
import { endFailedCallWithReason } from "../src/routes/api-calls.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER_STATUS_403 = 403;

const ORDER_CRITICAL_FILES = Object.freeze([
  "src/routes/api-calls.js",
  "src/routes/voice.js",
  "src/elevenlabs/outbound.js",
  "src/telephony/call-lifecycle.js",
]);

function readSrc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

test("R1 Mechanismus-Pin (Positiv-Kontrolle): persistEnd laeuft vor bill", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persist"),
    hangUp: null,
    bill: () => order.push("bill"),
  });
  assert.deepEqual(order, ["persist", "bill"]);
});

test("R2 Produktions-Thunk: endFailedCallWithReason schreibt den Grund VOR dem Endstatus", () => {
  const seen = [];
  const store = {
    recordFailureReason: (id, reason) => seen.push(`reason:${reason}`),
    endCallRecord: (id, status) => seen.push(`end:${status}`),
  };
  endFailedCallWithReason(store, "call_x", PROVIDER_STATUS_403)();
  assert.deepEqual(seen, ["reason:not-placed:start-403", "end:failed"]);
});

test("R3 Laufzeit je Naht: persistEndWithReason ruft recordFailureReason VOR endCall", () => {
  const seen = [];
  const store = { recordFailureReason: (id, reason) => seen.push(`reason:${reason}`) };
  const thunk = persistEndWithReason({
    store,
    callId: "call_y",
    reason: "not-placed:invite-403-D51",
    endCall: () => seen.push("end"),
  });
  thunk();
  assert.deepEqual(seen, ["reason:not-placed:invite-403-D51", "end"]);
});

test("R4(a) Positiv-Kontrolle: alle vier Naht-Dateien nennen persistEndWithReason mindestens einmal", () => {
  for (const relPath of ORDER_CRITICAL_FILES) {
    const src = readSrc(relPath);
    assert.match(src, /persistEndWithReason\(/, `${relPath} nennt persistEndWithReason nicht`);
  }
});

test("R4(b) SABOTAGE-FANG: in KEINER der vier Naht-Dateien steht store.recordFailureReason( als freie Anweisung", () => {
  for (const relPath of ORDER_CRITICAL_FILES) {
    const src = readSrc(relPath);
    const freieAufrufe = src.match(/store\.recordFailureReason\(/g) || [];
    assert.equal(
      freieAufrufe.length,
      0,
      `${relPath} traegt eine freie store.recordFailureReason(-Zeile - Befund C-A waere nicht behoben`,
    );
  }
});

test("R5 Verdrahtungs-Pin je Naht: die persistEnd-Aufrufstellen sind mit dem Riegel verdrahtet", () => {
  const apiCallsSrc = readSrc("src/routes/api-calls.js");
  assert.match(apiCallsSrc, /function endFailedCallWithReason\(/);
  assert.match(apiCallsSrc, /persistEnd: endFailedCallWithReason\(store, call\.id, providerStatus\)/);
  assert.match(apiCallsSrc, /return persistEndWithReason\(/, "endFailedCallWithReason delegiert an den Riegel");

  const voiceSrc = readSrc("src/routes/voice.js");
  assert.match(voiceSrc, /persistEnd: persistEndWithReason\(\{/);

  const outboundSrc = readSrc("src/elevenlabs/outbound.js");
  const outboundTreffer = outboundSrc.match(/persistEnd: persistEndWithReason\(\{/g) || [];
  const ERWARTETE_NAEHTE_OUTBOUND = 2;
  assert.equal(outboundTreffer.length, ERWARTETE_NAEHTE_OUTBOUND, "beide EL-Naehte sind verdrahtet");

  const lifecycleSrc = readSrc("src/telephony/call-lifecycle.js");
  assert.match(lifecycleSrc, /persistEnd: persistEndWithReason\(\{/);
});
