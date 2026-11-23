import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConsultRaised, CONSULT_RESULT } from "../../src/conversation/consult-raised.js";
import { CONSULT_TIMEOUT_REASON } from "../../src/begriffe/rueckfrage.js";
import * as ops from "../../src/store/state-ops.js";

const STAGES = Object.freeze({ deliveryDeadlineMs: 60, ackDeadlineMs: 120, answerDeadlineMs: 240 });
const TICK_MS = 10;
const CALL_ID = "call_zeit";
const TENANT_ID = "tenant_zeit";
const QUESTION = "Darf ich den Termin bestaetigen?";
const ZUSTELLZEIT = "2026-01-01T00:00:00.000Z";
const LESEFEHLER = "Datenbank antwortet nicht";

function storeMit(zustellzeitGelesen) {
  const state = {
    calls: [
      {
        id: CALL_ID,
        tenantId: TENANT_ID,
        status: "active",
        consults: [],
        context: { key_facts: [] },
        answeredAt: new Date(0).toISOString(),
      },
    ],
  };
  return {
    load: () => state,
    save: () => {},
    getCall: (callId) => ops.getCall(state, callId),
    emitConsult: (callId, questions) => ops.emitConsult(state, callId, questions).call,
    advanceInCallConsult: (callId, input) => ops.advanceInCallConsult(state, callId, input).wait,
    timeOutStagedConsult: (callId, input) => ops.timeOutStagedConsult(state, callId, input),
    zustellzeitGelesen,
  };
}

const frageStellen = (store) =>
  makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS })({ callId: CALL_ID, question: QUESTION });

test("Eine in der Datenbank gelesene Zustellzeit verhindert den Abbruch nach der Zustellfrist", async () => {
  const aufrufe = [];
  const store = storeMit(async (callId, tenantId, eventId) => {
    aufrufe.push({ callId, tenantId });
    return eventId ? ZUSTELLZEIT : null;
  });
  const ergebnis = await frageStellen(store);
  assert.equal(ergebnis.kind, CONSULT_RESULT.TIMEOUT);
  assert.equal(ergebnis.reason, CONSULT_TIMEOUT_REASON.NOT_ACKED);
  assert.deepEqual(aufrufe[0], { callId: CALL_ID, tenantId: TENANT_ID });
});

test("Schlaegt das Lesen der Zustellzeit fehl, gilt die Rueckfrage als nicht zugestellt und der Fehler steht im Log", async (t) => {
  const meldungen = [];
  t.mock.method(console, "error", (...teile) => meldungen.push(teile.join(" ")));
  const ergebnis = await frageStellen(
    storeMit(async () => {
      throw new Error(LESEFEHLER);
    }),
  );
  assert.equal(ergebnis.reason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
  assert.ok(
    meldungen.includes(`[consult-raised] Zustellzeit lesen fehlgeschlagen: ${LESEFEHLER}`),
    meldungen.join("|"),
  );
});

test("Ohne Zustellzeit in der Datenbank gilt die Rueckfrage nach der Zustellfrist als nicht zugestellt", async () => {
  const ergebnis = await frageStellen(storeMit(async () => null));
  assert.equal(ergebnis.reason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
});
