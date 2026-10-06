import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp, assertGateAbsent } from "./helpers.js";

const EXTERNAL_IP = externalIp();

const OPERATOR_ROUTES = [
  { method: "POST", path: "/api/billing/flush-meters" },
  { method: "POST", path: "/api/billing/cost-truing/sweep" },
  { method: "GET", path: "/api/billing/cost-drift" },
  { method: "GET", path: "/api/billing/platform-costs" },
  { method: "POST", path: "/api/onboard" },
  { method: "POST", path: "/api/onboard/retry" },
];

async function fetchRoute(baseUrl, route, extraHeaders = {}) {
  return fetch(`${baseUrl}${route.path}`, {
    method: route.method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    ...(route.method === "GET" ? {} : { body: JSON.stringify({}) }),
  });
}

test("AUTH-P6-5: ohne Admin-Sitzungs-Infra (json/kein SESSION_SECRET) sind die sechs Betreiber-Routen NICHT gemountet (404, kein Gate)", async () => {
  const srv = await startServer();
  try {
    for (const route of OPERATOR_ROUTES) {
      const res = await fetchRoute(srv.localUrl, route);
      assert.equal(res.status, 404, `${route.method} ${route.path}: Route existiert nicht (W6)`);
      assertGateAbsent(res);
    }
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P6-5b: SESSION_SECRET ALLEIN (weiter json) mountet die sechs Routen NICHT - die Bedingung ist ein UND", async () => {
  const srv = await startServer({ env: { SESSION_SECRET: "x-nur-fuer-diesen-test" } });
  try {
    for (const route of OPERATOR_ROUTES) {
      const res = await fetchRoute(srv.localUrl, route);
      assert.equal(res.status, 404, `${route.method} ${route.path}: SESSION_SECRET allein reicht nicht (json-Backend)`);
      assertGateAbsent(res);
    }
  } finally {
    await srv.stop();
  }
});

test(
  "AUTH-P6-6 (AUTH-P7): einem anonymen externen Aufrufer antwortet KEINE Schicht mehr mit einer Basic-Challenge - 404 ohne WWW-Authenticate (W6-Negativkontrolle, die scripts/probe-auth.sh live prueft)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      for (const route of OPERATOR_ROUTES) {
        const res = await fetchRoute(`${srv.externalUrl}`, route);
        assert.equal(
          res.status,
          404,
          `${route.method} ${route.path}: ohne Admin-Sitzungs-Infra nicht gemountet - kein Gate mehr, das antworten koennte`,
        );
        assertGateAbsent(res);
      }
    } finally {
      await srv.stop();
    }
  },
);
