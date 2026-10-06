import { test } from "node:test";
import assert from "node:assert/strict";
import { sendFailSoftAlertSms, resolveBootstrapAlertSender, sendBootstrapAlertSms } from "../src/telephony/alert-sms.js";
import { BOOTSTRAP_TENANT_ID, NUMBER_STATUS } from "../src/store/defaults.js";

const SENDER = { provider: "telnyx", e164: "+49111" };
const TO = "+49999";
const BODY = "[hermes] Test";

function makeMessagingStub(sendSms = async () => {}) {
  const calls = [];
  const messaging = (provider) => {
    calls.push({ provider });
    return { sendSms: (args) => { calls[calls.length - 1].args = args; return sendSms(args); } };
  };
  return { messaging, calls };
}

test("alert-sms: versendet ueber den Provider des aufgeloesten Absenders", () => {
  const { messaging, calls } = makeMessagingStub();
  const errors = [];
  sendFailSoftAlertSms({
    messaging,
    to: TO,
    body: BODY,
    resolveSender: () => SENDER,
    onError: (e) => errors.push(e),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, SENDER.provider);
  assert.deepEqual(calls[0].args, { from: SENDER.e164, to: TO, body: BODY });
  assert.deepEqual(errors, []);
});

test("alert-sms: ohne Empfaenger KEIN Versand", () => {
  const { messaging, calls } = makeMessagingStub();
  for (const to of ["", null, undefined]) {
    sendFailSoftAlertSms({ messaging, to, body: BODY, resolveSender: () => SENDER, onError: () => {} });
  }
  assert.equal(calls.length, 0);
});

test("alert-sms: ohne Empfaenger wird resolveSender NICHT aufgerufen", () => {
  const { messaging } = makeMessagingStub();
  let resolved = 0;
  sendFailSoftAlertSms({
    messaging,
    to: "",
    body: BODY,
    resolveSender: () => { resolved++; return SENDER; },
    onError: () => {},
  });
  assert.equal(resolved, 0);
});

test("alert-sms: ohne Absender KEIN Versand", () => {
  const { messaging, calls } = makeMessagingStub();
  sendFailSoftAlertSms({
    messaging,
    to: TO,
    body: BODY,
    resolveSender: () => null,
    onError: () => {},
  });
  assert.equal(calls.length, 0);
});

test("alert-sms: synchroner Wurf von messaging() wirft NICHT hoch", () => {
  const errors = [];
  const messaging = () => { throw new Error("unbekannter Provider"); };
  assert.doesNotThrow(() =>
    sendFailSoftAlertSms({
      messaging,
      to: TO,
      body: BODY,
      resolveSender: () => SENDER,
      onError: (e) => errors.push(e.message),
    }),
  );
  assert.deepEqual(errors, ["unbekannter Provider"]);
});

test("alert-sms: Wurf aus resolveSender wirft NICHT hoch", () => {
  const { messaging, calls } = makeMessagingStub();
  const errors = [];
  assert.doesNotThrow(() =>
    sendFailSoftAlertSms({
      messaging,
      to: TO,
      body: BODY,
      resolveSender: () => { throw new Error("store kaputt"); },
      onError: (e) => errors.push(e.message),
    }),
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(errors, ["store kaputt"]);
});

test("alert-sms: abgelehntes sendSms landet bei onError, kein unhandled rejection", async () => {
  const errors = [];
  const { messaging } = makeMessagingStub(async () => { throw new Error("versand kaputt"); });
  sendFailSoftAlertSms({
    messaging,
    to: TO,
    body: BODY,
    resolveSender: () => SENDER,
    onError: (e) => errors.push(e.message),
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ["versand kaputt"]);
});

test("alert-sms: kehrt vor Aufloesung des sendSms-Promise zurueck", async () => {
  let settled = false;
  const { messaging } = makeMessagingStub(
    () => new Promise((resolve) => setImmediate(() => { settled = true; resolve(); })),
  );
  sendFailSoftAlertSms({
    messaging,
    to: TO,
    body: BODY,
    resolveSender: () => SENDER,
    onError: () => {},
  });
  assert.equal(settled, false);
  await new Promise((r) => setImmediate(r));
});

function makeStoreStub(numbers) {
  return { load: () => ({ numbers }) };
}

test("resolveBootstrapAlertSender: liefert die aktive Nummer des BOOTSTRAP-Tenants", () => {
  const store = makeStoreStub([
    { tenantId: BOOTSTRAP_TENANT_ID, status: NUMBER_STATUS.ACTIVE, provider: "telnyx", e164: "+49111" },
  ]);
  assert.deepEqual(resolveBootstrapAlertSender(store), {
    tenantId: BOOTSTRAP_TENANT_ID,
    status: NUMBER_STATUS.ACTIVE,
    provider: "telnyx",
    e164: "+49111",
  });
});

test("resolveBootstrapAlertSender: keine aktive Bootstrap-Nummer -> null (kein Fremd-Tenant)", () => {
  const store = makeStoreStub([
    { tenantId: "kunde-x", status: NUMBER_STATUS.ACTIVE, provider: "telnyx", e164: "+49222" },
    { tenantId: BOOTSTRAP_TENANT_ID, status: NUMBER_STATUS.PROVISIONING, provider: "telnyx", e164: "+49333" },
  ]);
  assert.equal(resolveBootstrapAlertSender(store), null);
});

test("resolveBootstrapAlertSender: leeres Ergebnis ist null, nicht undefined", () => {
  assert.strictEqual(resolveBootstrapAlertSender(makeStoreStub([])), null);
});

const BOOTSTRAP_SENDER = { tenantId: BOOTSTRAP_TENANT_ID, status: NUMBER_STATUS.ACTIVE, provider: "telnyx", e164: "+49111" };

test("sendBootstrapAlertSms: Body = prefix+detail, Empfaenger aus config, Bootstrap-Nummer als Absender", () => {
  const { messaging, calls } = makeMessagingStub();
  const config = { billing: { platformAlertSmsTo: TO } };
  const store = makeStoreStub([BOOTSTRAP_SENDER]);
  sendBootstrapAlertSms({ messaging, config, store, prefix: "[Hermes] Warnung: ", detail: "zeichen=800/1000", logTag: "tts_quota_warning" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, BOOTSTRAP_SENDER.provider);
  assert.deepEqual(calls[0].args, { from: BOOTSTRAP_SENDER.e164, to: TO, body: "[Hermes] Warnung: zeichen=800/1000" });
});

test("sendBootstrapAlertSms: ohne konfigurierten Empfaenger KEIN Versand", () => {
  const { messaging, calls } = makeMessagingStub();
  const config = { billing: { platformAlertSmsTo: "" } };
  const store = makeStoreStub([BOOTSTRAP_SENDER]);
  sendBootstrapAlertSms({ messaging, config, store, prefix: "[Hermes] ", detail: "x", logTag: "cost-truing" });
  assert.equal(calls.length, 0);
});

test("sendBootstrapAlertSms: ohne aktive Bootstrap-Nummer KEIN Versand", () => {
  const { messaging, calls } = makeMessagingStub();
  const config = { billing: { platformAlertSmsTo: TO } };
  const store = makeStoreStub([]);
  sendBootstrapAlertSms({ messaging, config, store, prefix: "[Hermes] ", detail: "x", logTag: "cost-truing" });
  assert.equal(calls.length, 0);
});
