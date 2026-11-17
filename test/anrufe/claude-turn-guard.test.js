import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

let shouldSuppressEndCall, claudeExports;

before(async () => {
  process.env.MAX_EMPTY_TURNS = "2";
  process.env.CALLER_SUBSTANCE_MIN_LEN = "2";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [],
    }),
  );
  await import("../../src/config.js");
  claudeExports = await import("../../src/claude.js");
  ({ shouldSuppressEndCall } = claudeExports);
});

test("P3.3: inbound OHNE Anrufer-Zeile unter der Leer-Turn-Schwelle -> true (Symmetrisierung)", () => {
  const call = { direction: "inbound", transcript: [{ role: "agent", text: "Guten Tag." }] };
  assert.equal(shouldSuppressEndCall(call), true);
});

test("P3.3: inbound bei maxEmptyTurns unbeantworteten Agent-Turns -> false (Deadlock-Freigabe)", () => {
  const call = {
    direction: "inbound",
    transcript: [
      { role: "agent", text: "Guten Tag." },
      { role: "agent", text: "Sind Sie noch dran?" },
    ],
  };
  assert.equal(shouldSuppressEndCall(call), false);
});

test("P3.3: inbound MIT (auch nicht-substanzieller) Anrufer-Zeile -> false (TG-REC-1 bleibt)", () => {
  const call = { direction: "inbound", transcript: [{ role: "caller", text: "." }] };
  assert.equal(shouldSuppressEndCall(call), false);
});

test("shouldSuppressEndCall: outbound ohne substanzielle Antwort, unter der Leer-Turn-Schwelle -> true", () => {
  const call = {
    direction: "outbound",
    transcript: [{ role: "agent", text: "Guten Tag." }],
  };
  assert.equal(shouldSuppressEndCall(call), true);
});

test("shouldSuppressEndCall: outbound MIT substanzieller Anrufer-Antwort -> false", () => {
  const call = {
    direction: "outbound",
    transcript: [{ role: "caller", text: "Ja bitte" }],
  };
  assert.equal(shouldSuppressEndCall(call), false);
});

test("shouldSuppressEndCall: outbound bei maxEmptyTurns unbeantworteten Agent-Turns -> false (Deadlock-Freigabe)", () => {
  const call = {
    direction: "outbound",
    transcript: [
      { role: "agent", text: "Hallo?" },
      { role: "agent", text: "Sind Sie noch dran?" },
    ],
  };
  assert.equal(shouldSuppressEndCall(call), false);
});

test("H4c-1a: claude.js bietet keinen Gespraechsrunden-Eingang agentTurn mehr", () => {
  assert.equal(claudeExports.agentTurn, undefined);
  assert.equal(typeof claudeExports.summarizeCall, "function");
  assert.equal(typeof claudeExports.systemPrompt, "function");
});
