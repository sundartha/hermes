import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const TARGET_A = "+4915112345678";
const TARGET_B = "+4915187654321";

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Termin vereinbaren" }),
  });

test("per-Target-Cap: 3x dasselbe Ziel ok, 4. -> 429; anderes Ziel frei", async (t) => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "*", PER_TARGET_CALL_CAP: "3" },
  });
  try {
    for (let i = 1; i <= 3; i++) {
      const res = await postCall(srv.localUrl, TARGET_A);
      assert.equal(res.status, 500, `Call ${i} passiert das Gate (Originate-Offline -> 500)`);
    }
    await t.test("4. Call aufs selbe Ziel -> 429 grund=ziel_limit", async () => {
      const res = await postCall(srv.localUrl, TARGET_A);
      assert.equal(res.status, 429, "Cap (3) erreicht -> 429 VOR Dial");
      assert.match((await res.json()).error, /Repeat limit/, "per-Target-Fehlertext");
    });
    await t.test("anderes Ziel unberuehrt -> passiert (500)", async () => {
      const res = await postCall(srv.localUrl, TARGET_B);
      assert.equal(res.status, 500, "anderes Ziel hat eigenen Zaehler");
    });
  } finally {
    await srv.stop();
  }
});
