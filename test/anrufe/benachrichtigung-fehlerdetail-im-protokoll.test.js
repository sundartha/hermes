import assert from "node:assert/strict";
import { test } from "node:test";

import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { makePgTestStore } from "../pg-helpers.js";

const NUMMER = "+4915112345678";
const DEADLOCK_DETAIL = `Process 11 waits for ShareLock on transaction 501; blocked by process 22. Process 22: UPDATE call SET status = 'cancelled' WHERE to = '${NUMMER}'`;
const DEADLOCK_WHERE = 'while locking tuple (0,3) in relation "call"';

function postgresFehler(felder) {
  return Object.assign(new Error("deadlock detected"), felder);
}

async function beendeMitFehler({ status, fehler }) {
  const { store: pgStore } = await makePgTestStore();
  const store = {
    ...pgStore,
    tenantNewsletterConsent: () => ({ consent: true }),
    addNotification: async () => {
      throw fehler;
    },
  };
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {}, server: { publicUrl: "https://example.test" } },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: async () => ({ summary: "Termin steht", actionItems: [] }),
    audit: () => {},
    mailer: { sendMail: async () => {} },
    accountsRef: { current: { accountByTenant: async () => ({ email: "kunde@example.test" }) } },
    metrics: { logCallCapacity: () => {} },
  });
  const call = store.createCall({ direction: "outbound", from: "+15005550006", to: NUMMER, tenantId: BOOTSTRAP_TENANT_ID });
  Object.assign(call, { language: "de", status, transcript: [], failureReason: "at-capacity:leitungen-voll" });
  const ausgaben = [];
  const original = console.error;
  console.error = (...args) => ausgaben.push(args);
  try {
    await callFinish.finishCall(call);
  } finally {
    console.error = original;
  }
  return ausgaben;
}

for (const status of ["cancelled", "failed"]) {
  test(`Postgres-Fehler beim Schreiben der Meldung (${status}): Protokoll nennt Code, Detail und Ort, Nummern geschwärzt`, async () => {
    const ausgaben = await beendeMitFehler({
      status,
      fehler: postgresFehler({ code: "40P01", detail: DEADLOCK_DETAIL, where: DEADLOCK_WHERE }),
    });
    assert.equal(ausgaben.length, 1);
    const [marke, meldung, einzelheiten] = ausgaben[0];
    assert.equal(marke, "[notification]");
    assert.equal(meldung, "deadlock detected");
    assert.match(einzelheiten, /^code=40P01 detail=Process 11 waits for ShareLock on transaction 501; blocked by process 22\. Process 22: UPDATE call SET status = 'cancelled' WHERE to = '/);
    assert.match(einzelheiten, / where=while locking tuple \(0,3\) in relation "call"$/);
    assert.ok(!einzelheiten.includes(NUMMER), einzelheiten);
    assert.ok(!einzelheiten.includes("15112345678"), einzelheiten);
  });
}

test("Postgres-Fehler nur mit Code: nur der Code steht im Protokoll", async () => {
  const ausgaben = await beendeMitFehler({ status: "cancelled", fehler: postgresFehler({ code: "40P01" }) });
  assert.deepEqual(ausgaben, [["[notification]", "deadlock detected", "code=40P01"]]);
});

test("Fehler ohne Postgres-Felder: das Protokoll bleibt bei der Meldung", async () => {
  const ausgaben = await beendeMitFehler({ status: "cancelled", fehler: postgresFehler({}) });
  assert.deepEqual(ausgaben, [["[notification]", "deadlock detected"]]);
});
