import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, seedState, seedCall } from "../helpers.js";

const TOKEN_LAENGE = 32;

const HTTP_OK = 200;

const TOKEN = "a".repeat(TOKEN_LAENGE);
const CALL_ID = "call_test1";

test("streamToken erscheint in keiner API-Antwort (Regel 4)", async () => {
  const srv = await startServer({
    seed: seedState({ calls: [seedCall({ id: CALL_ID, streamToken: TOKEN })] }),
  });
  try {
    for (const path of ["/api/state", `/api/calls/${CALL_ID}`]) {
      const res = await fetch(`${srv.localUrl}${path}`);
      assert.equal(res.status, HTTP_OK);
      const body = JSON.stringify(await res.json());
      assert.ok(!body.includes(TOKEN), `${path} leakt den Token-Wert`);
      assert.ok(!body.includes("streamToken"), `${path} leakt das Feld streamToken`);
    }
  } finally {
    await srv.stop();
  }
});
