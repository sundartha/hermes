// Identitaets-Schreibseite des Onboardings (I3): POST /api/onboard setzt
// tenant.ownerName (set-on-create), und auf der aktiv gewordenen Nummer NENNT der
// Inbound-Greeting diesen Namen (Identitaets-Kreis = DoD). Server-Spawn, json,
// KEIN pglite (kein Test-Worker-Stall).
//
// P6b2: Provisioning ist async (Worker hinter der Queue) -> die Route antwortet
// SOFORT 'queued'; der Identitaets-Kreis-Test wartet auf den fire-and-forget Drain
// (Store-Polling), bevor er die aktiv gewordene Nummer fuer den Inbound nutzt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startTelnyxProvisioningMock } from "./helpers.js";

const postJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const OWNER_NAME = "Maria";

// Wartet auf den async Drain (P6b2): pollt den persistierten Store, bis die Nummer
// 'active' ist, und liefert sie. Deterministisch (der Worker save()t nach dem Job).
async function waitForActiveNumber(srv, numberId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const num = srv.readStore().numbers.find((n) => n.id === numberId);
    if (num && num.status === "active") return num;
    if (Date.now() > deadline) throw new Error(`Nummer ${numberId} nicht 'active' (ist '${num?.status}')`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// (1) onboard MIT firstName (Dry-Run, G1) -> Tenant-Record traegt komponierten ownerName
test("onboard mit firstName -> Tenant-Record traegt ownerName", async () => {
  const srv = await startServer(); // PROVISIONING_ENABLED unset -> Dry-Run
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_maria", firstName: OWNER_NAME });
    assert.equal(res.status, 200);
    const t = srv.readStore().tenants.find((x) => x.id === "t_maria");
    assert.equal(t.ownerName, OWNER_NAME); // firstName-only -> ownerName === firstName
    assert.equal(t.firstName, OWNER_NAME);
  } finally {
    await srv.stop();
  }
});

// (2) onboard OHNE Namen -> Record OHNE ownerName-Feld (Rueckwaerts-Kompat)
test("onboard ohne Namen -> Record ohne ownerName-Feld (Owner-Fallback)", async () => {
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
test("Identitaets-Kreis: onboard firstName + aktive Nummer -> Inbound nennt Maria", async () => {
  const mock = await startTelnyxProvisioningMock();
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
    const onb = await postJson(`${srv.localUrl}/api/onboard`, { tenantId: "t_maria", firstName: OWNER_NAME });
    const j = await onb.json();
    // P6b2: SOFORT 'queued'; auf den async Kauf warten, dann die aktive e164 lesen.
    assert.equal(j.provisioning, "queued");
    const num = await waitForActiveNumber(srv, j.numberId);
    assert.equal(num.e164, "+4915799990001");
    const inbound = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAm", From: "+4915112345678", To: num.e164 }),
    });
    assert.equal(inbound.status, 200);
    assert.match(await inbound.text(), /Maria/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});
