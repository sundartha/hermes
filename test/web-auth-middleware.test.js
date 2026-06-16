import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { webAuth, signValue } from "../src/web-auth.js";

const SECRET = "test-secret-012345678901234567890";
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function fakeDeps(over = {}) {
  return {
    secret: SECRET,
    sessions: { get: async (id) => over.session === undefined
      ? { id, sub: "u1", tenantId: "t_u1", expires_at: FUTURE, invalidated_at: null }
      : over.session },
    accounts: { resolve: async () => over.account === undefined
      ? { tenantId: "t_u1", role: "member", status: "active", email: "u1@x" }
      : over.account },
  };
}

async function mount(deps) {
  const app = express();
  app.get("/probe", webAuth(deps), (req, res) => res.json(req.tenant));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function get(url, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, cookie ? { headers: { Cookie: cookie } } : {}, (res) => {
      let body = ""; res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}
const sessionCookie = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

test("kein Cookie -> 401", async () => {
  const s = await mount(fakeDeps()); try {
    assert.equal((await get(`${s.base}/probe`)).status, 401);
  } finally { await s.close(); }
});
test("gueltige aktive Session -> req.tenant gesetzt", async () => {
  const s = await mount(fakeDeps()); try {
    const r = await get(`${s.base}/probe`, sessionCookie("sess1"));
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).tenantId, "t_u1");
  } finally { await s.close(); }
});
test("invalidierte Session -> 401", async () => {
  const s = await mount(fakeDeps({ session: { id: "x", sub: "u1", tenantId: "t_u1", expires_at: FUTURE, invalidated_at: new Date().toISOString() } }));
  try { assert.equal((await get(`${s.base}/probe`, sessionCookie("x"))).status, 401); } finally { await s.close(); }
});
test("abgelaufene Session -> 401", async () => {
  const s = await mount(fakeDeps({ session: { id: "x", sub: "u1", tenantId: "t_u1", expires_at: PAST, invalidated_at: null } }));
  try { assert.equal((await get(`${s.base}/probe`, sessionCookie("x"))).status, 401); } finally { await s.close(); }
});
test("suspended Tenant -> 403 (fail-closed)", async () => {
  const s = await mount(fakeDeps({ account: { tenantId: "t_u1", role: "member", status: "suspended", email: "u1@x" } }));
  try { assert.equal((await get(`${s.base}/probe`, sessionCookie("sess1"))).status, 403); } finally { await s.close(); }
});
test("unbekannte Session -> 401", async () => {
  const s = await mount(fakeDeps({ session: null }));
  try { assert.equal((await get(`${s.base}/probe`, sessionCookie("ghost"))).status, 401); } finally { await s.close(); }
});
