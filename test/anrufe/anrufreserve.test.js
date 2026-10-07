import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, DOMESTIC_TEST_NUMBER, waitForLog } from "../helpers.js";

const HTTP_BAD_GATEWAY = 502;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;

const post = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("OUT-05 F2: zwei gleichzeitige place_call gegen engen Cap -> genau 1x200, 1x402(reserve)", async () => {
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
    assert.deepEqual(
      codes,
      [HTTP_OK, HTTP_PAYMENT_REQUIRED],
      "genau EIN Grant (200 dialing), EIN reserve-Deny (402)",
    );
    const denied = r1.status === HTTP_PAYMENT_REQUIRED ? r1 : r2;
    assert.match(
      (await denied.json()).error,
      /\d+\.\d{2} EUR short/,
      "402 kommt vom Reserve-Gate (Fehlbetrag-Text, P5a), nicht vom settled-Budget-Gate",
    );
    const dialed = r1.status === HTTP_OK ? r1 : r2;
    assert.equal((await dialed.json()).status, "dialing");
  } finally {
    await srv.stop();
  }
});

test("OUT-05 F2: catch-Pfad gibt die Reserve frei (zweiter Call erreicht wieder den Originate)", async () => {
  const srv = await startServer({
    env: {
      MAX_BUDGET_EUR: "10",
      VOICE_TARIFF_DOMESTIC_CENTS: "20",
      ALLOWED_COUNTRY_CODES: "*",
    },
  });
  try {
    const r1 = await post(srv.localUrl, "+4915112340001");
    assert.ok(
      [HTTP_INTERNAL_ERROR, HTTP_BAD_GATEWAY].includes(r1.status),
      `#1 Originate wirft -> 5xx, war ${r1.status}`,
    );
    const r2 = await post(srv.localUrl, "+4915112340002");
    assert.ok(
      [HTTP_INTERNAL_ERROR, HTTP_BAD_GATEWAY].includes(r2.status),
      `#2 muss wieder den Originate erreichen (Reserve auf catch freigegeben), NICHT 402 (war ${r2.status})`,
    );
    assert.notEqual(r2.status, HTTP_PAYMENT_REQUIRED, "402 hier hiesse: Reserve NICHT freigegeben");
  } finally {
    await srv.stop();
  }
});

test("OUT-05 F2: Erfolgs-Freigabe ueber finishCall gibt die Reserve frei", async () => {
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
    const r1 = await post(srv.localUrl, "+4915112340001");
    assert.equal(r1.status, HTTP_OK);
    const callId1 = (await r1.json()).callId;

    const r2 = await post(srv.localUrl, "+4915112340002");
    assert.equal(
      r2.status,
      HTTP_PAYMENT_REQUIRED,
      "zweite Reserve reisst den Cap, solange #1 haelt",
    );

    const st = await fetch(`${srv.localUrl}/voice/status?callId=${callId1}`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "completed" }),
    });
    assert.equal(st.status, HTTP_OK);
    await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId1}"`));

    const r2b = await post(srv.localUrl, "+4915112340002");
    assert.equal(
      r2b.status,
      HTTP_OK,
      "nach Freigabe von #1 ist die zweite Reserve wieder moeglich",
    );
  } finally {
    await srv.stop();
  }
});

const DOMESTIC = "+4915112345678";
const INTL = "+12025550123";

test("Reserve-Gate: internationaler Worst-Case -> 402 vor Dial, Inland passiert", async (kontext) => {
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
    await kontext.test(
      "internationales Ziel: Reserve 12 EUR > 10-EUR-Cap -> 402 grund=reserve_ueber_rest",
      async () => {
        const res = await post(srv.localUrl, INTL);
        assert.equal(res.status, HTTP_PAYMENT_REQUIRED, "Worst-Case-Reserve ueberschreitet den Cap -> 402 vor Dial");
        assert.match(
          (await res.json()).error,
          /2\.00 EUR short/,
          "Reserve-Fehlertext (nicht das nachgelagerte Budget-Gate) nennt den Fehlbetrag",
        );
      },
    );

    await kontext.test(
      "Inlands-Ziel: Reserve 0.60 EUR < Cap -> Gate passiert (bis Originate, 500)",
      async () => {
        const res = await post(srv.localUrl, DOMESTIC);
        assert.equal(
          res.status,
          HTTP_INTERNAL_ERROR,
          "Inlands-Reserve unter dem Cap -> erreicht den Originate-Pfad",
        );
      },
    );
  } finally {
    await srv.stop();
  }
});
