import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, signValue } from "../src/web-auth.js";

const SECRET = "test-secret-012345678901234567890";
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function fakeDeps(over = {}) {
  return {
    secret: SECRET,
    sessions: {
      get: async (id) =>
        over.session === undefined
          ? { id, sub: "u1", tenantId: "t_u1", expires_at: FUTURE, invalidated_at: null }
          : over.session,
    },
    accounts: {
      resolve: async () =>
        over.account === undefined
          ? { tenantId: "t_u1", role: "member", status: "active", email: "u1@x" }
          : over.account,
    },
  };
}

async function mount(deps, factory = webAuth) {
  const app = express();
  app.get("/probe", factory(deps), (req, res) => res.json(req.tenant));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

function get(url, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, cookie ? { headers: { Cookie: cookie } } : {}, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}
const sessionCookie = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;
// SEC-P5: benannter Antwortcode fuer den neuen Fall - der nackte Wert waere ein Magic Number.
const UNAUTHORIZED = 401;

test("kein Cookie -> 401", async () => {
  const s = await mount(fakeDeps());
  try {
    assert.equal((await get(`${s.base}/probe`)).status, 401);
  } finally {
    await s.close();
  }
});
// SEC-P5: der ALTE Name traegt keine Sitzung mehr. Ohne diesen Fall bewiese die Suite
// nur, dass der neue Name funktioniert - nicht, dass nicht beide akzeptiert werden.
test("altes Cookie 'session=' -> 401 (kein Doppel-Lesen)", async () => {
  const server = await mount(fakeDeps());
  try {
    const alterName = `session=${encodeURIComponent(signValue("sess1", SECRET))}`;
    assert.equal((await get(`${server.base}/probe`, alterName)).status, UNAUTHORIZED);
  } finally {
    await server.close();
  }
});
test("gueltige aktive Session -> req.tenant gesetzt", async () => {
  const s = await mount(fakeDeps());
  try {
    const r = await get(`${s.base}/probe`, sessionCookie("sess1"));
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).tenantId, "t_u1");
  } finally {
    await s.close();
  }
});
test("invalidierte Session -> 401", async () => {
  const s = await mount(
    fakeDeps({
      session: {
        id: "x",
        sub: "u1",
        tenantId: "t_u1",
        expires_at: FUTURE,
        invalidated_at: new Date().toISOString(),
      },
    }),
  );
  try {
    assert.equal((await get(`${s.base}/probe`, sessionCookie("x"))).status, 401);
  } finally {
    await s.close();
  }
});
test("abgelaufene Session -> 401", async () => {
  const s = await mount(
    fakeDeps({
      session: { id: "x", sub: "u1", tenantId: "t_u1", expires_at: PAST, invalidated_at: null },
    }),
  );
  try {
    assert.equal((await get(`${s.base}/probe`, sessionCookie("x"))).status, 401);
  } finally {
    await s.close();
  }
});
test("suspended Tenant -> 403 (fail-closed)", async () => {
  const s = await mount(
    fakeDeps({ account: { tenantId: "t_u1", role: "member", status: "suspended", email: "u1@x" } }),
  );
  try {
    assert.equal((await get(`${s.base}/probe`, sessionCookie("sess1"))).status, 403);
  } finally {
    await s.close();
  }
});
test("unbekannte Session -> 401", async () => {
  const s = await mount(fakeDeps({ session: null }));
  try {
    assert.equal((await get(`${s.base}/probe`, sessionCookie("ghost"))).status, 401);
  } finally {
    await s.close();
  }
});

// ---- PA-9: Status-Gate-Matrix (4 Status x 2 Middlewares) --------------
// Sperrt die GEWOLLTE Divergenz mechanisch fest: die zwei Middlewares unterscheiden sich
// AUSSCHLIESSLICH im Status-Praedikat (active-only vs. active|suspended). Alle 8 Zellen als
// Golden-Truth-Table mit {statusCode, req.tenant} - vor und nach der Higher-Order-Dedup
// identisch. Der Pass-Fall (200) prueft den VOLLEN req.tenant-Inhalt, nicht nur den Code.
const accountFor = (status) => ({ tenantId: "t_u1", role: "member", status, email: "u1@x" });

const expectedTenant = (status) => ({
  tenantId: "t_u1",
  sub: "u1",
  role: "member",
  email: "u1@x",
  status,
});

// 4. Status "unexpected" = ausserhalb des TENANT_STATUS-Enums -> beweist Default-Deny.
const STATUS_MATRIX = [
  { status: "active", webAuth: 200, pending: 200 },
  { status: "suspended", webAuth: 403, pending: 200 }, // einzige Zelle, in der die zwei divergieren
  { status: "closed", webAuth: 403, pending: 403 },
  { status: "unexpected", webAuth: 403, pending: 403 },
];

for (const row of STATUS_MATRIX) {
  for (const [label, factory, expected] of [
    ["webAuth", webAuth, row.webAuth],
    ["webAuthAllowPending", webAuthAllowPending, row.pending],
  ]) {
    test(`Status-Gate: ${label} + status=${row.status} -> ${expected}`, async () => {
      const s = await mount(fakeDeps({ account: accountFor(row.status) }), factory);
      try {
        const r = await get(`${s.base}/probe`, sessionCookie("sess1"));
        assert.equal(r.status, expected);
        if (expected === 200) assert.deepEqual(JSON.parse(r.body), expectedTenant(row.status));
      } finally {
        await s.close();
      }
    });
  }
}
