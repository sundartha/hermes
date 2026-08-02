// AUTH-P6-5/-6: die sechs Betreiber-Routen sind ohne die Admin-Sitzungs-Infrastruktur
// (webAuthMw+adminMw, s. src/wiring/operator-routes.js) gar nicht gemountet (404) -
// niemals ungeschuetzt. AUTH-P6-6 pinnt zusaetzlich, dass ein anonymer externer
// Aufrufer seit AUTH-P7 KEINE Basic-Challenge mehr sieht (das Gate ist gefallen) -
// die W6-Negativkontrolle, die scripts/probe-auth.sh live nachvollzieht.
//
// Testpraefix bewusst "AUTH-P6-N" (NICHT DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|
// PROMPT|UI|VOICE|WEB|WORLD-<Ziffer>): sonst landet die Datei still im test:gates-Lauf,
// wo Rot erlaubt ist und nichts meldet (Lehre catalog-id-prefix-misroutes-tests).
//
// Spawn (node:test), KEIN pglite in dieser Datei (Lehre: pglite nie mit Kindprozess
// mischen - s. test/auth-p6-operator-routes.test.js fuer den pglite-Teil).
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
  // (a) BASE_ENV: STORE_BACKEND=json, kein SESSION_SECRET, DASHBOARD_PASSWORD="" (Gate
  // abwesend, s. assertGateAbsent) - der Zustand JEDES Spawn-Tests in dieser Suite.
  const srv = await startServer();
  try {
    for (const route of OPERATOR_ROUTES) {
      const res = await fetchRoute(srv.localUrl, route);
      assert.equal(res.status, 404, `${route.method} ${route.path}: Route existiert nicht (W6)`);
      assertGateAbsent(res);
    }
    // Gegenprobe (W6): der Rest des Dienstes lebt - der fail-open-Zustand ist NICHT
    // "der Server ist kaputt", sondern "diese sechs Routen existieren nicht".
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
