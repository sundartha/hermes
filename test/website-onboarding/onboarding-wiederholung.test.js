import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, startIdp } from "../helpers.js";

const HTTP_NOT_FOUND = 404;
const KYC_STUFE_KARTE = "card";

const PW = "did-07-retry-secret";

const env = (idp) => ({
  MCP_AUTH: "oauth",
  OAUTH_ISSUER_URL: idp.issuer,
  MULTI_TENANT: "true",
  DASHBOARD_PASSWORD: PW,
  MAX_NUMBERS: "100",
  MAX_NUMBERS_PER_TENANT: "100",
});

function subscriberTenant(id, idpSubject) {
  return { id, status: "active", idpSubject, ownerName: `${id} Tester`, kycLevel: KYC_STUFE_KARTE };
}

test("DID-07 (Mechanismus gruen, Regressions-Pin): proxied ohne Admin-Sitzung -> 404, auch fuer einen zahlenden Subscriber", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: env(idp),
    seed: seedState({ tenants: [subscriberTenant("t_did07", "sub-did07")] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/onboard/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "1.2.3.4" },
      body: JSON.stringify({ tenantId: "t_did07" }),
    });
    assert.equal(res.status, HTTP_NOT_FOUND, "Route ohne operatorAuth nicht gemountet -> 404, auch fuer active+CARD-Subscriber");
  } finally {
    await srv.stop();
    await idp.close();
  }
});
