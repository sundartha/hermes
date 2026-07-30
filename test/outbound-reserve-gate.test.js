// outbound-p1c (Spec-Test 1): die Vorab-Reservierung schlaegt VOR dem Dial zu. Der
// Worst-Case-Minutenpreis (Ziel-Tarif x RESERVE_LEAD_MINUTES) wird gegen den verbleibenden
// effektiven Tenant-Cap geprueft; uebersteigt er ihn -> 402 (kein Originate). Der Owner
// (Tenant Null) haelt keine tenant_budget-Zeile -> effektiver Cap = MAX_BUDGET_EUR.
//
// Offline-Diskriminator (wie number-gate.test.js): nicht-AC TWILIO_ACCOUNT_SID ("x")
// laesst den Twilio-Client synchron VOR jedem Netzzugriff werfen -> ein durchgelassener
// Call endet als 500 (alle Gates passiert, bis Originate), eine Reserve-Sperre als 402.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, DOMESTIC_TEST_NUMBER } from "./helpers.js";

const DOMESTIC = "+4915112345678"; // DE-Mobil -> Inlandstarif (guenstig)
const INTL = "+12025550123"; // US -> Worst-Case-Default-Tarif (teuer)

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("Reserve-Gate: internationaler Worst-Case -> 402 vor Dial, Inland passiert", async (t) => {
  // Cap = MAX_BUDGET_EUR = 6 EUR = 600 ct (Owner ohne tenant_budget-Zeile -> Pro-Tenant-
  // Fallback, effectiveCapCents Stufe 3). KS-P3 (a): die Reserve ist Satz x
  // RESERVE_LEAD_MINUTES (2), nicht mehr Satz x angefangene Minuten der Maximaldauer -
  // Worst-Case 400 ct/min x 2 = 800 ct = 8 EUR > 6-EUR-Cap -> Fehlbetrag 2.00 EUR
  // (unveraendert). Inland 20 ct/min x 2 = 40 ct < Cap.
  // Absender-DID mit +49: der Inlandssatz greift seit P5 nur bei gleicher Vorwahl an
  // BEIDEN Enden - mit der US-Default-DID waere auch DOMESTIC ein Auslands-Leg.
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: {
      ALLOWED_NUMBERS: `${DOMESTIC},${INTL}`,
      ALLOWED_COUNTRY_CODES: "*",
      MAX_BUDGET_EUR: "6",
      VOICE_TARIFF_DOMESTIC_CENTS: "20",
      VOICE_TARIFF_DEFAULT_CENTS: "400",
      TWILIO_ACCOUNT_SID: "x",
    },
  });
  try {
    await t.test("internationales Ziel: Reserve 12 EUR > 10-EUR-Cap -> 402 grund=reserve_ueber_rest", async () => {
      const res = await postCall(srv.localUrl, INTL);
      assert.equal(res.status, 402, "Worst-Case-Reserve ueberschreitet den Cap -> 402 vor Dial");
      assert.match(
        (await res.json()).error,
        /2\.00 EUR short/,
        "Reserve-Fehlertext (nicht das nachgelagerte Budget-Gate) nennt den Fehlbetrag",
      );
    });

    await t.test("Inlands-Ziel: Reserve 0.60 EUR < Cap -> Gate passiert (bis Originate, 500)", async () => {
      const res = await postCall(srv.localUrl, DOMESTIC);
      assert.equal(res.status, 500, "Inlands-Reserve unter dem Cap -> erreicht den Originate-Pfad");
    });
  } finally {
    await srv.stop();
  }
});
