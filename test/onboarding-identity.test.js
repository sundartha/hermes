// Identitaets-Schreibseite des Onboardings (I3): POST /api/onboard setzt
// tenant.ownerName (set-on-create), und auf der aktiv gewordenen Nummer NENNT der
// Inbound-Greeting diesen Namen (Identitaets-Kreis = DoD). Server-Spawn, json,
// KEIN pglite (kein Test-Worker-Stall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startTelnyxMock } from "./helpers.js";

const postJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const OWNER_NAME = "Maria";

// (1) onboard MIT ownerName (Dry-Run) -> Tenant-Record traegt ownerName
test("onboard mit ownerName -> Tenant-Record traegt ownerName", async () => {
  const srv = await startServer(); // PROVISIONING_ENABLED unset -> Dry-Run
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_maria", ownerName: OWNER_NAME });
    assert.equal(res.status, 200);
    const t = srv.readStore().tenants.find((x) => x.id === "t_maria");
    assert.equal(t.ownerName, OWNER_NAME);
  } finally {
    await srv.stop();
  }
});

// (2) onboard OHNE ownerName -> Record OHNE ownerName-Feld (Rueckwaerts-Kompat)
test("onboard ohne ownerName -> Record ohne ownerName-Feld (Owner-Fallback)", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_plain" });
    assert.equal(res.status, 200);
    const t = srv.readStore().tenants.find((x) => x.id === "t_plain");
    assert.ok(!("ownerName" in t), "kein leeres/gesetztes ownerName-Feld am Record");
  } finally {
    await srv.stop();
  }
});

// (3) IDENTITAETS-KREIS (DoD): onboard SETZT -> Inbound auf die aktiv gewordene
// Nummer NENNT den Namen
test("Identitaets-Kreis: onboard ownerName + aktive Nummer -> Inbound nennt Maria", async () => {
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
    const onb = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_maria", ownerName: OWNER_NAME });
    const j = await onb.json();
    assert.equal(j.status, "active");
    assert.equal(j.e164, "+4915799990001");
    const inbound = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAm", From: "+4915112345678", To: j.e164 }),
    });
    assert.equal(inbound.status, 200);
    assert.match(await inbound.text(), /Maria/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});
