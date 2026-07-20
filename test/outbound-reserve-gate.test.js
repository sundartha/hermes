// outbound-p1c (Spec-Test 1): die Vorab-Reservierung schlaegt VOR dem Dial zu. Der
// Worst-Case-Minutenpreis (Ziel-Tarif x ceil(maxDur/60)) wird gegen den verbleibenden
// effektiven Tenant-Cap geprueft; uebersteigt er ihn -> 402 (kein Originate). Der Owner
// (Tenant Null) haelt keine tenant_budget-Zeile -> effektiver Cap = MAX_BUDGET_EUR.
//
// Offline-Diskriminator (wie number-gate.test.js): nicht-AC TWILIO_ACCOUNT_SID ("x")
// laesst den Twilio-Client synchron VOR jedem Netzzugriff werfen -> ein durchgelassener
// Call endet als 500 (alle Gates passiert, bis Originate), eine Reserve-Sperre als 402.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const DOMESTIC = "+4915112345678"; // DE-Mobil -> Inlandstarif (guenstig)
const INTL = "+12025550123"; // US -> Worst-Case-Default-Tarif (teuer)

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("Reserve-Gate: internationaler Worst-Case -> 402 vor Dial, Inland passiert", async (t) => {
  // Cap = MAX_BUDGET_EUR = 10 EUR = 1000 ct (Owner ohne tenant_budget-Zeile; LCT P6: muss
  // echt ueber der abgeleiteten Business-Plan-Decke von 900 ct liegen, sonst verweigert der
  // Boot-Guard, plan_cap_inert). Worst-Case-Tarif 400 ct/min x 3 min (maxDur 180 s) =
  // 1200 ct = 12 EUR > 10-EUR-Cap -> Fehlbetrag 2.00 EUR. Inland 20 ct/min x 3 = 60 ct < Cap.
  const srv = await startServer({
    env: {
      ALLOWED_NUMBERS: `${DOMESTIC},${INTL}`,
      ALLOWED_COUNTRY_CODES: "*",
      MAX_BUDGET_EUR: "10",
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
        /es fehlen 2\.00 EUR/,
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
