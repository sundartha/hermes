// Phase 2.3: das stream_token (Altfeld) darf in keiner API-Antwort auftauchen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

const TOKEN = "a".repeat(32);
const CALL_ID = "call_test1";

test("streamToken erscheint in keiner API-Antwort (Regel 4)", async () => {
  const srv = await startServer({
    seed: seedState({ calls: [seedCall({ id: CALL_ID, streamToken: TOKEN })] }),
  });
  try {
    for (const path of ["/api/state", `/api/calls/${CALL_ID}`]) {
      const res = await fetch(`${srv.localUrl}${path}`);
      assert.equal(res.status, 200);
      const body = JSON.stringify(await res.json());
      assert.ok(!body.includes(TOKEN), `${path} leakt den Token-Wert`);
      assert.ok(!body.includes("streamToken"), `${path} leakt das Feld streamToken`);
    }
  } finally {
    await srv.stop();
  }
});
