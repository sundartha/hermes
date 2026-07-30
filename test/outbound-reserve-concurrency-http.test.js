// OUT-05 (F2): server.js-Verdrahtung der atomaren Reserve. Diskriminiert gegen den Vor-F2-
// Code (reine reserveExceedsBudget-Query ohne Reserve-Effekt): dort wuerden zwei gleichzeitige
// place_call gegen einen engen Cap BEIDE 200 liefern (keiner der beiden Requests sieht den
// anderen). Mit atomarem Check+Reserve unter store.withStoreLock passiert genau EINER.
// FAKE_ORIGINATE haelt den Test netzfrei (kein echter Twilio-Client).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, DOMESTIC_TEST_NUMBER } from "./helpers.js";

const post = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("OUT-05 F2: zwei gleichzeitige place_call gegen engen Cap -> genau 1x200, 1x402(reserve)", async () => {
  // Cap = MAX_BUDGET_EUR = 10 EUR = 1000 ct (Pro-Tenant-Fallback, effectiveCapCents Stufe 3 -
  // der Owner hat keine tenant_budget-Zeile).
  // KS-P3 (a): die Reserve ist Satz x RESERVE_LEAD_MINUTES (2), nicht mehr Satz x
  // angefangene Minuten der Maximaldauer. Inlandstarif 300 ct/min x 2 = 600 ct je Reserve
  // (Zahl unveraendert, Herleitung neu); zwei Reserven
  // zusammen (1200 ct) reissen den Cap, eine einzelne (600 ct) nicht. Absender-DID mit +49,
  // damit der Inlandstarif die +49-Ziele ueberhaupt tarifiert (P5: gleiche Vorwahl an
  // beiden Enden).
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: {
      MAX_BUDGET_EUR: "10",
      VOICE_TARIFF_DOMESTIC_CENTS: "300",
      ALLOWED_COUNTRY_CODES: "*",
      FAKE_ORIGINATE: "true",
    },
  });
  try {
    const [r1, r2] = await Promise.all([
      post(srv.localUrl, "+4915112340001"),
      post(srv.localUrl, "+4915112340002"),
    ]);
    const codes = [r1.status, r2.status].sort();
    assert.deepEqual(codes, [200, 402], "genau EIN Grant (200 dialing), EIN reserve-Deny (402)");
    const denied = r1.status === 402 ? r1 : r2;
    assert.match(
      (await denied.json()).error,
      /\d+\.\d{2} EUR short/,
      "402 kommt vom Reserve-Gate (Fehlbetrag-Text, P5a), nicht vom settled-Budget-Gate",
    );
    const dialed = r1.status === 200 ? r1 : r2;
    assert.equal((await dialed.json()).status, "dialing");
  } finally {
    await srv.stop();
  }
});
