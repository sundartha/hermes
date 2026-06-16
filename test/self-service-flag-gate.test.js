// #3 — Flag-/Wiring-Gate fuer die Self-Service-Routen. Spawn-node:test (json-Backend),
// KEIN pglite in dieser Datei (Lehre p6a-Stall: child-process NIE mit pglite mischen).
//
// Beweist: die Self-Service-Routen sind web-session-only und NUR im Web-Login-Block
// (sessionSecret + STORE_BACKEND=pg) registriert. Ohne diese Infra (json-Default)
// existieren sie nicht -> 404, selbst wenn SELF_SERVICE_ENABLED + MULTI_TENANT an
// sind. Damit kann der frühere X-Internal-Identity-Pfad nicht versehentlich
// wieder erreichbar werden.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";

const asTenant = (sub) => ({ "X-Internal-Identity": sub });
const tenantB = () => ({ id: "B", status: "active", idpSubject: "sub-b" });

test("Flags an, aber json-Backend (kein Web-Login): Self-Service-Routen sind 404", async (t) => {
  // SELF_SERVICE_ENABLED + MULTI_TENANT an, aber STORE_BACKEND=json (BASE_ENV) und
  // kein SESSION_SECRET -> der Web-Login-Block laeuft nicht -> Routen nicht registriert.
  const srv = await startServer({
    env: { MULTI_TENANT: "true", SELF_SERVICE_ENABLED: "true" },
    seed: seedState({ tenants: [tenantB()] }),
  });
  try {
    await t.test("GET /api/self-service/state -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/self-service/state`, { headers: asTenant("sub-b") });
      assert.equal(res.status, 404);
    });
    await t.test("POST /api/self-service/settings -> 404", async () => {
      const res = await fetch(`${srv.localUrl}/api/self-service/settings`, {
        method: "POST", headers: { "Content-Type": "application/json", ...asTenant("sub-b") }, body: JSON.stringify({ agentName: "X" }),
      });
      assert.equal(res.status, 404);
    });
  } finally {
    await srv.stop();
  }
});
