import { test } from "node:test";
import assert from "node:assert/strict";
import { callMaxDurationMs } from "../src/call-duration.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";

test("MS_PER_SECOND ist die benannte Sekunden-Konstante (G25, kein Magic-1000)", () => {
  assert.equal(MS_PER_SECOND, 1000);
});

test("callMaxDurationMs: call-eigenes maxDurationS schlaegt den Default", () => {
  assert.equal(callMaxDurationMs({ maxDurationS: 60 }, 300), 60 * 1000);
});

test("callMaxDurationMs: falsy maxDurationS (0/null/undefined) faellt auf den Default (||-Semantik erhalten)", () => {
  assert.equal(callMaxDurationMs({ maxDurationS: 0 }, 300), 300 * 1000);
  assert.equal(callMaxDurationMs({ maxDurationS: null }, 300), 300 * 1000);
  assert.equal(callMaxDurationMs({}, 300), 300 * 1000);
});

test("armierte Deadline = now + Formel (voller Cap, NICHT Restzeit)", () => {
  // Der Helfer liefert den vollen Cap-Delay ab Arm-Zeitpunkt; call-lifecycle.js
  // (armMaxDurationTimer/Reserve-Backstop) armiert damit die absolute Deadline. Bewusst
  // gegen now+Formel geprueft, nicht gegen ein
  // Restzeit-Delta (classifyCallTime lebt separat in state-ops.js).
  const now = 1_000_000;
  const deadline = now + callMaxDurationMs({ maxDurationS: 90 }, 300);
  assert.equal(deadline, now + 90 * 1000);
});
