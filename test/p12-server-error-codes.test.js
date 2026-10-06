import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requirePublicUrl, ERROR_SERVER_UNCONFIGURED } from "../src/billing/payment-gate.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

async function startBillingApp(publicUrl) {
  let tenantResolverCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled: true, publicUrl }),
      store: {},
      audit: () => {},
      billing: {},
      tenant: {
        requireTenant: (req, res) => {
          tenantResolverCalls += 1;
          res.status(403).json({ error: "TENANT_REJECT" });
          return null;
        },
      },
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
    tenantResolverCalls: () => tenantResolverCalls,
  };
}

test("requirePublicUrl: publicUrl gesetzt -> true, res unberuehrt", () => {
  const res = fakeRes();
  assert.equal(requirePublicUrl(res, withConfigNamespaces({ publicUrl: "https://agent.test" })), true);
  assert.equal(res.statusCode, null);
});

test("requirePublicUrl: publicUrl leer -> 500 + Code server_unconfigured, kein Klartext", () => {
  const res = fakeRes();
  assert.equal(requirePublicUrl(res, withConfigNamespaces({ publicUrl: "" })), false);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: ERROR_SERVER_UNCONFIGURED });
});

test("setup-checkout ohne oeffentliche Basis-URL -> 500 mit sprachneutralem Code, kein Env-Name (api-billing)", async () => {
  const app = await startBillingApp("");
  try {
    const res = await fetch(`${app.base}/api/billing/setup-checkout`, { method: "POST" });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.equal(json.error, ERROR_SERVER_UNCONFIGURED);
    assert.doesNotMatch(json.error, /\s/);
    assert.doesNotMatch(json.error, /PUBLIC_URL/i);
    assert.equal(app.tenantResolverCalls(), 0);
  } finally {
    await app.close();
  }
});

test("setup-checkout mit gesetzter Basis-URL -> Guard laesst durch (glueckliche Pfad)", async () => {
  const app = await startBillingApp("https://agent.test");
  try {
    const res = await fetch(`${app.base}/api/billing/setup-checkout`, { method: "POST" });
    assert.equal(res.status, 403);
    assert.equal(app.tenantResolverCalls(), 1);
  } finally {
    await app.close();
  }
});
