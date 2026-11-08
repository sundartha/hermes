import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

test("Interne Route: Aufruf von aussen antwortet 403 mit error Forbidden, Loopback 200", async () => {
  const srv = await startServer({ env: { MULTI_TENANT: "true" }, seed: seedState({}) });
  try {
    const intern = await abrufMitFrist(`${srv.localUrl}/api/state`);
    assert.equal(intern.status, HTTP_OK);
    const extern = await abrufMitFrist(`${srv.localUrl}/api/state`, {
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    assert.equal(extern.status, HTTP_FORBIDDEN);
    assert.deepEqual(await extern.json(), { error: "Forbidden" });
  } finally {
    await srv.stop();
  }
});
