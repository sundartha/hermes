import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteJsonAttrappe } from "../anrufe/attrappen-server.js";
import { TELNYX_CAP_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const TARGET_A = "+4915112345678";
const TARGET_B = "+4915187654321";

const postCall = (url, to) =>
  abrufMitFrist(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Termin vereinbaren" }),
  });

test("per-Target-Cap: 3x dasselbe Ziel ok, 4. -> 429; anderes Ziel frei", async (t) => {
  const abgelehnt = await starteJsonAttrappe({ detail: "abgelehnt" }, 400);
  const srv = await startServer({
    env: {
      ALLOWED_COUNTRY_CODES: "*",
      PER_TARGET_CALL_CAP: "3",
      ELEVENLABS_API_BASE: abgelehnt.url,
      TELNYX_API_BASE: abgelehnt.url,
      TELNYX_API_KEY: TELNYX_CAP_SCHLUESSEL,
      TELNYX_CONNECTION_ID: "conn_cap",
      TELNYX_ACCOUNT_SID: "acct_cap",
    },
  });
  try {
    for (let i = 1; i <= 3; i++) {
      const res = await postCall(srv.localUrl, TARGET_A);
      assert.equal(res.status, 502, `Call ${i} passiert das Gate (Anbieter lehnt ab -> 502)`);
    }
    await t.test("4. Call aufs selbe Ziel -> 429 grund=ziel_limit", async () => {
      const res = await postCall(srv.localUrl, TARGET_A);
      assert.equal(res.status, 429, "Cap (3) erreicht -> 429 VOR Dial");
      assert.match((await res.json()).error, /Repeat limit/, "per-Target-Fehlertext");
    });
    await t.test("anderes Ziel unberuehrt -> passiert (502)", async () => {
      const res = await postCall(srv.localUrl, TARGET_B);
      assert.equal(res.status, 502, "anderes Ziel hat eigenen Zaehler");
    });
  } finally {
    await srv.stop();
    await abgelehnt.close();
  }
});
