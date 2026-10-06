import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, DOMESTIC_TEST_NUMBER } from "./helpers.js";

const DOMESTIC = "+4915112345678";
const INTL = "+12025550123";

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("Reserve-Gate: internationaler Worst-Case -> 402 vor Dial, Inland passiert", async (t) => {
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: {
      ALLOWED_NUMBERS: `${DOMESTIC},${INTL}`,
      ALLOWED_COUNTRY_CODES: "*",
      MAX_BUDGET_EUR: "6",
      VOICE_TARIFF_DOMESTIC_CENTS: "20",
      VOICE_TARIFF_DEFAULT_CENTS: "400",
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
