// Phase 2.2 (Body-Size-Limits), 2.4 (Settings-Whitelist), 2.6 (Eingabe-Validierung).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const postJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("Body-Size-Limit 100kb", async (t) => {
  const srv = await startServer();
  try {
    await t.test("POST mit 200kb-Body -> 413", async () => {
      const res = await postJson(`${srv.localUrl}/api/settings`, { greeting: "x".repeat(200 * 1024) });
      assert.equal(res.status, 413);
    });

    await t.test("kleiner Body unveraendert 2xx", async () => {
      const res = await postJson(`${srv.localUrl}/api/settings`, { greeting: "Hallo Test" });
      assert.equal(res.status, 200);
    });

    await t.test("urlencoded mit 200kb-Body -> 413", async () => {
      const res = await fetch(`${srv.localUrl}/voice/turn?callId=missing`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: "x".repeat(200 * 1024) }),
      });
      assert.equal(res.status, 413);
    });
  } finally {
    await srv.stop();
  }
});
