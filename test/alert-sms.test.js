// Regressionstest fuer den geteilten fail-soft-Alarm-SMS-Baustein
// (src/telephony/alert-sms.js, LCT-P5-Review-Runde 1, Blocker D1/G5). Er ersetzt zwei
// fast identische Rumpf-Duplikate (emitPlatformSpendWarning + Drift-Waechter) - dieser
// Test pinnt genau die Zusagen, die dabei nicht verloren gehen duerfen.
//
// In-process, netzfrei, KEIN Server-Spawn: messaging ist durchgehend gestubbt, es geht
// NIE eine echte (kostenpflichtige) SMS raus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendFailSoftAlertSms } from "../src/telephony/alert-sms.js";

const SENDER = { provider: "telnyx", e164: "+49111" };
const TO = "+49999";
const BODY = "[hermes] Test";

// Sammelt die Aufrufe eines messaging-Stubs. sendSms liefert per Default ein
// aufgeloestes Promise (fire-and-forget-Pfad wie im Bestand).
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

// DER Empfaenger-Riegel: leeres platformAlertSmsTo = Alarmkanal abgeschaltet.
test("alert-sms: ohne Empfaenger KEIN Versand", () => {
  const { messaging, calls } = makeMessagingStub();
  for (const to of ["", null, undefined]) {
    sendFailSoftAlertSms({ messaging, to, body: BODY, resolveSender: () => SENDER, onError: () => {} });
  }
  assert.equal(calls.length, 0);
});

// Vertrags-Reihenfolge (Grund fuer resolveSender als Thunk statt fertigem Wert): ohne
// Empfaenger darf die Absender-Aufloesung gar nicht erst laufen - sonst erzeugt ihr
// eigener Log-Pfad eine WARN-Zeile, die nach einem Defekt aussieht, obwohl nur der
// Alarmkanal aus ist.
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

// fail-closed: kein zulaessiger Absender -> lieber keine SMS als eine mit fremder
// Absendernummer (im Drift-Fall waere das die DID eines Kunden).
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

// Fail-soft-Zusage (1): ein SYNCHRONER Wurf von messaging() (fail-closed pick() bei
// unbekanntem Provider) darf den Aufrufer NIE abbrechen - er darf weder einen Anruf
// kosten noch einen Sweep beenden.
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

// Fail-soft-Zusage (1), zweiter Wurf-Pfad: auch resolveSender selbst darf werfen
// (im Drift-Fall steckt dort ein store.load()).
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

// Fail-soft-Zusage (2): sendSms wird NICHT awaitet und traegt sofort ein .catch - eine
// abgelehnte Zusage landet bei onError und wird NIE zu einem unhandled rejection.
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
  await new Promise((r) => setImmediate(r)); // Microtask-Queue leerlaufen lassen
  assert.deepEqual(errors, ["versand kaputt"]);
});

// Der Versand blockiert den Aufrufer nicht: die Funktion kehrt zurueck, BEVOR das
// sendSms-Promise aufgeloest ist (kein Lock-Halten, keine Verzoegerung des Dials).
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
