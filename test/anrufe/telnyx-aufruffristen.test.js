import { test } from "node:test";
import assert from "node:assert/strict";

import { antwortetNie, mitKurzerFrist } from "../gemeinsam/kurze-antwortfrist.mjs";
import { withFetch } from "../helpers.js";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-aufruffristen";
process.env.TELNYX_CONNECTION_ID = "conn_aufruffristen";
process.env.TELNYX_ACCOUNT_SID = "acct_aufruffristen";

const { voiceControl, messaging } = await import("../../src/telephony/registry.js");

const CALL_SID = "call_sid_1";
const CALL_CONTROL_ID = "v3:call-control-1";
const ABSENDER = "+15005550006";
const EMPFAENGER = "+4915112345678";
const ANRUF_STEUERN_FRIST_MS = 8_000;
const KOSTENABRUF_FRIST_MS = 15_000;
const SMS_SENDEN_FRIST_MS = 10_000;

function ohneAntwort(run) {
  return mitKurzerFrist(() => withFetch(antwortetNie, run));
}

function unterdrueckeLog(t) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
}

test("Telnyx-Fristen: antwortet Telnyx auf das Auflegen per TeXML nicht, bricht endCall nach 8 Sekunden ab", async () => {
  const fristen = await ohneAntwort(() =>
    assert.rejects(voiceControl("telnyx").endCall(CALL_SID), { name: "TimeoutError" }),
  );
  assert.deepEqual(fristen, [ANRUF_STEUERN_FRIST_MS]);
});

test("Telnyx-Fristen: antwortet Telnyx auf die Umleitung nicht, bricht redirectCall nach 8 Sekunden ab", async () => {
  const fristen = await ohneAntwort(() =>
    assert.rejects(voiceControl("telnyx").redirectCall(CALL_SID, "https://hermes.test/weiter"), {
      name: "TimeoutError",
    }),
  );
  assert.deepEqual(fristen, [ANRUF_STEUERN_FRIST_MS]);
});

test("Telnyx-Fristen: antwortet Telnyx auf das Auflegen per Call Control nicht, bricht endCallViaCallControl nach 8 Sekunden ab", async () => {
  const fristen = await ohneAntwort(() =>
    assert.rejects(voiceControl("telnyx").endCallViaCallControl(CALL_CONTROL_ID), {
      name: "TimeoutError",
    }),
  );
  assert.deepEqual(fristen, [ANRUF_STEUERN_FRIST_MS]);
});

test("Telnyx-Fristen: antwortet Telnyx auf die Kostenabfrage nicht, meldet fetchCostRecordPool nach 15 Sekunden je Seite einen Anbieterfehler", async (t) => {
  unterdrueckeLog(t);
  let ergebnis;
  const fristen = await ohneAntwort(async () => {
    ergebnis = await voiceControl("telnyx").fetchCostRecordPool({});
  });
  assert.equal(ergebnis.ok, false);
  assert.ok(fristen.length > 0);
  assert.deepEqual([...new Set(fristen)], [KOSTENABRUF_FRIST_MS]);
});

test("Telnyx-Fristen: antwortet Telnyx auf die Rechnungsabfrage nicht, meldet fetchMonthlyInvoiceTotal nach 15 Sekunden einen Anbieterfehler", async (t) => {
  unterdrueckeLog(t);
  let ergebnis;
  const fristen = await ohneAntwort(async () => {
    ergebnis = await voiceControl("telnyx").fetchMonthlyInvoiceTotal({ month: "2026-10" });
  });
  assert.deepEqual(ergebnis, { ok: false, reason: "provider_error" });
  assert.deepEqual(fristen, [KOSTENABRUF_FRIST_MS]);
});

test("Telnyx-Fristen: antwortet Telnyx auf eine SMS nicht, bricht sendSms nach 10 Sekunden ab", async () => {
  const fristen = await ohneAntwort(() =>
    assert.rejects(messaging("telnyx").sendSms({ from: ABSENDER, to: EMPFAENGER, body: "Hallo" }), {
      name: "TimeoutError",
    }),
  );
  assert.deepEqual(fristen, [SMS_SENDEN_FRIST_MS]);
});
