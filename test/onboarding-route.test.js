// Onboarding-Route POST /api/onboard (Server-Kindprozess): registrieren -> Nummer
// anfragen -> (optional) provisionieren. Default = Dry-Run (kein Geld). Mit
// PROVISIONING_ENABLED + lokalem Telnyx-Mock laeuft der volle Kauf-Flow offline.
// Eigene Datei (Server-Spawn, KEIN pglite -> kein Test-Worker-Stall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startTelnyxMock } from "./helpers.js";

const postJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("Dry-Run (Default): onboard registriert + fragt an, Nummer bleibt 'requested', KEIN Geld", async () => {
  const srv = await startServer(); // PROVISIONING_ENABLED unset -> false
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_user1" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "requested");
    assert.equal(json.provisioning, "disabled");
    const store = srv.readStore();
    assert.ok(store.tenants.find((t) => t.id === "t_user1"), "Tenant registriert");
    const num = store.numbers.find((n) => n.id === json.numberId);
    assert.equal(num.status, "requested");
    assert.equal(num.e164, null, "requested Nummer hat keine e164 (kein Kauf)");
    assert.equal(num.tenantId, "t_user1");
  } finally {
    await srv.stop();
  }
});

test("Fehlende tenantId -> 400", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, {});
    assert.equal(res.status, 400);
  } finally {
    await srv.stop();
  }
});

test("Globaler Cap (Kosten-Notbremse) blockt -> 429", async () => {
  // BASE_ENV seedet die Owner-Twilio-Nummer (1 aktive Nummer). MAX_NUMBERS=1 ->
  // jede weitere Anfrage trifft den globalen Cap.
  const srv = await startServer({ env: { MAX_NUMBERS: "1" } });
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_user1" });
    assert.equal(res.status, 429);
  } finally {
    await srv.stop();
  }
});

test("Per-Tenant-Cap blockt die zweite Nummer desselben Tenants -> 409", async () => {
  const srv = await startServer({ env: { MAX_NUMBERS: "10", MAX_NUMBERS_PER_TENANT: "1" } });
  try {
    assert.equal((await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_user1" })).status, 200);
    const second = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_user1" });
    assert.equal(second.status, 409);
  } finally {
    await srv.stop();
  }
});

test("PROVISIONING_ENABLED + Telnyx-Mock: voller Flow -> Nummer 'active' mit e164", async () => {
  const mock = await startTelnyxMock();
  const srv = await startServer({
    env: {
      PROVISIONING_ENABLED: "true",
      PROVISIONING_COUNTRY: "DE",
      TELNYX_API_KEY: "KEYtest",
      TELNYX_CONNECTION_ID: "conn_1",
      TELNYX_API_BASE: mock.url,
      MAX_NUMBERS: "10",
    },
  });
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_user1" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "active");
    assert.equal(json.e164, "+4915799990001");
    const store = srv.readStore();
    const num = store.numbers.find((n) => n.id === json.numberId);
    assert.equal(num.status, "active");
    assert.equal(num.providerNumberId, "num_ext_1");
    assert.ok(store.numberAssignments.find((a) => a.numberId === json.numberId && !a.releasedAt), "assignment angelegt");
    // Mock hat Suche + Order + Configure gesehen.
    assert.ok(mock.requests.some((r) => r.path.startsWith("/v2/available_phone_numbers")));
    assert.ok(mock.requests.some((r) => r.path === "/v2/number_orders"));
    assert.ok(mock.requests.some((r) => r.method === "PATCH" && r.path === "/v2/phone_numbers/num_ext_1/voice"));
  } finally {
    await srv.stop();
    await mock.close();
  }
});
