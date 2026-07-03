// OUT-05 (F2): Freigabe auf dem catch-Pfad (werfender Originate). OHNE FAKE_ORIGINATE: ein
// nicht-AC TWILIO_ACCOUNT_SID laesst den echten Twilio-Client synchron VOR jedem Netzzugriff
// werfen (Muster wie outbound-reserve-gate.test.js). Zwei identische place_call (je eigenes
// Ziel, damit KEIN anderes Gate als die Reserve interferiert) muessen BEIDE den Originate-
// Pfad erreichen (5xx) - waere die Reserve aus #1 nicht im catch freigegeben worden, wuerde
// #2 am Reserve-Gate 402 statt am Originate 5xx scheitern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const post = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("OUT-05 F2: catch-Pfad gibt die Reserve frei (zweiter Call erreicht wieder den Originate)", async () => {
  const srv = await startServer({
    env: {
      TWILIO_ACCOUNT_SID: "x",
      MAX_BUDGET_EUR: "1",
      VOICE_TARIFF_DOMESTIC_CENTS: "20",
      ALLOWED_COUNTRY_CODES: "*",
    },
  });
  try {
    const r1 = await post(srv.localUrl, "+4915112340001");
    assert.ok([500, 502].includes(r1.status), `#1 Originate wirft -> 5xx, war ${r1.status}`);
    const r2 = await post(srv.localUrl, "+4915112340002");
    assert.ok(
      [500, 502].includes(r2.status),
      `#2 muss wieder den Originate erreichen (Reserve auf catch freigegeben), NICHT 402 (war ${r2.status})`,
    );
    assert.notEqual(r2.status, 402, "402 hier hiesse: Reserve NICHT freigegeben");
  } finally {
    await srv.stop();
  }
});
