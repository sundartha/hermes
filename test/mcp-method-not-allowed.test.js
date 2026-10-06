import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

for (const method of ["GET", "DELETE"]) {
  test(`${method} /mcp -> 405 (stateless: POST only)`, async () => {
    const srv = await startServer();
    try {
      const res = await fetch(`${srv.localUrl}/mcp`, { method });
      assert.equal(res.status, 405);
      assert.deepEqual(await res.json(), { error: "POST only (stateless transport)" });
    } finally {
      await srv.stop();
    }
  });
}
