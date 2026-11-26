import { test } from "node:test";
import assert from "node:assert/strict";
import { sendFailSoftAlertSms, resolveBootstrapAlertSender, sendBootstrapAlertSms } from "../../src/telephony/alert-sms.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.ts";
import { mock } from "node:test";
import { platformAlertSender, sendeVorfall } from "../../src/telephony/alert-sms.ts";
import { PLATFORM_NUMBER_PURPOSE } from "../../src/begriffe/nummern-vergabe.js";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";

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

async function meldeUndWarte({ platformAlertSmsTo, numbers, prefix, detail, logTag }) {
  const attrappe = await starteBetterStackAttrappe();
  const { messaging, calls } = makeMessagingStub();
  const config = { billing: { platformAlertSmsTo, betterstackAlertUrl: attrappe.url } };
  try {
    sendBootstrapAlertSms({ messaging, config, store: makeStoreStub(numbers), prefix, detail, logTag, jetzt: () => new Date() });
    const meldungen = await attrappe.aufMeldungen(1);
    return { meldungen, smsCalls: calls };
  } finally {
    await attrappe.close();
  }
}

test("sendBootstrapAlertSms: Body = prefix+detail, Empfaenger aus config, Bootstrap-Nummer als Absender", async () => {
  const { meldungen, smsCalls } = await meldeUndWarte({
    platformAlertSmsTo: TO,
    numbers: [BOOTSTRAP_SENDER],
    prefix: "[Hermes] Warnung: ",
    detail: "zeichen=800/1000",
    logTag: "tts_quota_warning",
  });
  assert.equal(meldungen.length, 1);
  assert.equal(meldungen[0].text, "[Hermes] Warnung: zeichen=800/1000");
  assert.equal(meldungen[0].status, "alert");
  assert.match(meldungen[0].id, /^tts_quota_warning:/);
  assert.equal(smsCalls.length, 0, "keine SMS mehr");
});

test("sendBootstrapAlertSms: ohne konfigurierten Empfaenger KEIN Versand", async () => {
  const { meldungen, smsCalls } = await meldeUndWarte({
    platformAlertSmsTo: "",
    numbers: [BOOTSTRAP_SENDER],
    prefix: "[Hermes] ",
    detail: "x",
    logTag: "cost-truing",
  });
  assert.equal(meldungen.length, 1, "die Meldung geht trotzdem an den Eingang");
  assert.equal(smsCalls.length, 0);
});

test("sendBootstrapAlertSms: ohne aktive Bootstrap-Nummer KEIN Versand", async () => {
  const { meldungen, smsCalls } = await meldeUndWarte({
    platformAlertSmsTo: TO,
    numbers: [],
    prefix: "[Hermes] ",
    detail: "x",
    logTag: "cost-truing",
  });
  assert.equal(meldungen.length, 1, "die Meldung geht trotzdem an den Eingang");
  assert.equal(smsCalls.length, 0);
});

const E164_BEISPIEL = "+49111";

function melde(ereignis, aufruf) {
  const zeilen = [];
  const stumm = mock.method(console, ereignis, (...teile) => zeilen.push(teile.join(" ")));
  return Promise.resolve(aufruf()).then(
    (wert) => {
      stumm.mock.restore();
      return { wert, zeilen };
    },
    (fehler) => {
      stumm.mock.restore();
      throw fehler;
    },
  );
}

function makeStoreStubMitZustand(zustand) {
  return { load: () => zustand };
}

test("alert-sms: Bootstrap-Absender ist die Nummer selbst, ohne Treffer null mit Warnung", async () => {
  const { wert, zeilen } = await melde("warn", () => [
    resolveBootstrapAlertSender(makeStoreStubMitZustand({ numbers: [BOOTSTRAP_SENDER] })),
    resolveBootstrapAlertSender(makeStoreStubMitZustand({ numbers: [] })),
  ]);
  assert.deepEqual(wert[0], BOOTSTRAP_SENDER);
  assert.equal(wert[1], null);
  assert.deepEqual(zeilen, ["[alert-sms] Plattform-Alarm: keine aktive Bootstrap-Nummer, KEINE SMS"]);
});

const BINDUNGS_TABELLE = [
  [[], null],
  [[{ purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, releasedAt: "2026-01-01", e164: E164_BEISPIEL, provider: "telnyx" }], null],
  [[{ purpose: "outbound_ani", releasedAt: null, e164: E164_BEISPIEL, provider: "telnyx" }], null],
  [[{ purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, releasedAt: null, e164: "", provider: "telnyx" }], null],
  [[{ purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, releasedAt: null, e164: E164_BEISPIEL, provider: "telnyx", extra: 1 }], { provider: "telnyx", e164: E164_BEISPIEL }],
];

for (const [nutzung, erwartet] of BINDUNGS_TABELLE) {
  test(`alert-sms: platformAlertSender fuer ${nutzung.length} Bindung(en) ergibt ${JSON.stringify(erwartet)}`, async () => {
    const { wert } = await melde("warn", () => platformAlertSender(makeStoreStubMitZustand({ platformNumberUse: nutzung })));
    assert.deepEqual(wert, erwartet);
  });
}

const VORFALL_FEHLER_TABELLE = [
  [{ name: "TimeoutError" }, "TimeoutError"],
  [null, "undefined"],
  [undefined, "undefined"],
  ["Text", "undefined"],
];

for (const [geworfen, name] of VORFALL_FEHLER_TABELLE) {
  test(`alert-sms: sendeVorfall loggt bei geworfen ${JSON.stringify(geworfen)} den Namen ${name}`, async () => {
    const abruf = mock.method(globalThis, "fetch", async () => {
      throw geworfen;
    });
    const { wert, zeilen } = await melde("error", () =>
      sendeVorfall({ adresse: "http://127.0.0.1:9/x", anlass: "t", schluessel: "s1", status: "alert", meldezeile: "m" }),
    );
    abruf.mock.restore();
    assert.equal(wert, false);
    assert.deepEqual(zeilen, [`[t] Better-Stack-Meldung s1 nicht zugestellt: ${name}`]);
  });
}

test("alert-sms: sendeVorfall loggt den HTTP-Status einer Ablehnung", async () => {
  const attrappe = await starteBetterStackAttrappe({ antwortStatus: 500 });
  try {
    const { wert, zeilen } = await melde("error", () =>
      sendeVorfall({ adresse: attrappe.url, anlass: "t", schluessel: "s2", status: "alert", meldezeile: "m" }),
    );
    assert.equal(wert, false);
    assert.deepEqual(zeilen, ["[t] Better-Stack-Meldung s2 nicht zugestellt: HTTP 500"]);
  } finally {
    await attrappe.close();
  }
});

test("alert-sms: sendBootstrapAlertSms meldet an die Adresse der Konfiguration", async () => {
  const attrappe = await starteBetterStackAttrappe();
  try {
    sendBootstrapAlertSms({ config: { billing: { betterstackAlertUrl: attrappe.url } }, prefix: "p ", detail: "d", logTag: "tag", jetzt: () => new Date() });
    const meldungen = await attrappe.aufMeldungen(1);
    assert.equal(meldungen[0].text, "p d");
    assert.match(meldungen[0].id, /^tag:/);
  } finally {
    await attrappe.close();
  }
});

const ADRESSEN_TABELLE = [{ betterstackAlertUrl: "" }, { betterstackAlertUrl: null }, {}];

for (const billing of ADRESSEN_TABELLE) {
  test(`alert-sms: sendBootstrapAlertSms ohne gueltige Adresse ${JSON.stringify(billing)} sendet nichts und wirft nicht`, () => {
    const abruf = mock.method(globalThis, "fetch", async () => {
      throw new Error("darf nicht gerufen werden");
    });
    assert.doesNotThrow(() => sendBootstrapAlertSms({ config: { billing }, prefix: "p", detail: "d", logTag: "t", jetzt: () => new Date() }));
    assert.equal(abruf.mock.callCount(), 0);
    abruf.mock.restore();
  });
}

test("alert-sms: sendBootstrapAlertSms ohne billing in der Konfiguration wirft", () => {
  assert.throws(() => sendBootstrapAlertSms({ config: {}, prefix: "p", detail: "d", logTag: "t", jetzt: () => new Date() }));
});
