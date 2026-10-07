import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "../helpers.js";

const HTTP_NOT_FOUND = 404;

const asTenant = (sub) => ({ "X-Internal-Identity": sub });
const tenantB = () => ({ id: "B", status: "active", idpSubject: "sub-b" });

test("Flags an, aber json-Backend (kein Web-Login): Self-Service-Routen sind 404", async (testlauf) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true", SELF_SERVICE_ENABLED: "true" },
    seed: seedState({ tenants: [tenantB()] }),
  });
  try {
    await testlauf.test("GET /api/self-service/state -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/self-service/state`, {
        headers: asTenant("sub-b"),
      });
      assert.equal(res.status, HTTP_NOT_FOUND);
    });
    await testlauf.test("POST /api/self-service/settings -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/self-service/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...asTenant("sub-b") },
        body: JSON.stringify({ agentName: "X" }),
      });
      assert.equal(res.status, HTTP_NOT_FOUND);
    });
    await testlauf.test("POST /api/self-service/settings {agentStyle} -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/self-service/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...asTenant("sub-b") },
        body: JSON.stringify({ agentStyle: "warm-persoenlich" }),
      });
      assert.equal(res.status, HTTP_NOT_FOUND);
    });
    await testlauf.test("POST /api/self-service/billing/setup-checkout -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/self-service/billing/setup-checkout`, {
        method: "POST",
        headers: asTenant("sub-b"),
      });
      assert.equal(res.status, HTTP_NOT_FOUND);
    });
  } finally {
    await srv.stop();
  }
});
