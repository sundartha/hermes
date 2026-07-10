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
import { startServer, startTelnyxProvisioningMock, seedState } from "./helpers.js";
import { tenantIdForSubject } from "../src/store/defaults.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const OWNER_NAME = "Maria";

// Wartet auf den async Drain (P6b2): pollt den persistierten Store, bis die Nummer
// 'active' ist, und liefert sie. Deterministisch (der Worker save()t nach dem Job).
async function waitForActiveNumber(srv, numberId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const num = srv.readStore().numbers.find((n) => n.id === numberId);
    if (num && num.status === "active") return num;
    if (Date.now() > deadline)
      throw new Error(`Nummer ${numberId} nicht 'active' (ist '${num?.status}')`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// (1) onboard MIT firstName (Dry-Run, G1) -> Tenant-Record traegt komponierten ownerName
test("onboard mit firstName -> Tenant-Record traegt ownerName", async () => {
  const srv = await startServer(); // PROVISIONING_ENABLED unset -> Dry-Run
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, {
      tenantId: "t_maria",
      firstName: OWNER_NAME,
    });
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

// (2b) P0: onboard MIT idpSubject -> kanonische tenantId (t_<sub>), idp-gebunden.
// Genau EIN Record, kein zweiter (email-artiger) Record. resolveTenant (MCP/REST)
// findet danach denselben Tenant wie der Web-Login (t_<sub>).
test("onboard mit idpSubject -> genau ein idp-gebundener Tenant t_<sub>", async () => {
  const srv = await startServer(); // Dry-Run
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, {
      idpSubject: "sub-maria",
      firstName: OWNER_NAME,
    });
    assert.equal(res.status, 200);
    const tenants = srv.readStore().tenants.filter((t) => t.idpSubject === "sub-maria");
    assert.equal(tenants.length, 1); // 1:1, kein Zweit-Record
    assert.equal(tenants[0].id, "t_sub-maria"); // kanonische ID aus tenantIdForSubject
    assert.equal(tenants[0].ownerName, OWNER_NAME);
  } finally {
    await srv.stop();
  }
});

// (2c) P0: leeres/Whitespace-idpSubject -> 400 (fail-closed, kein stiller Owner-Pfad).
test("onboard mit Whitespace-idpSubject -> 400", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/onboard`, { idpSubject: "  " });
    assert.equal(res.status, 400);
  } finally {
    await srv.stop();
  }
});

// (2d) tenant-prolif-b: onboard MIT einem BEREITS (per Email-Merge, Phase A) gemergten
// idpSubject -> 409, KEIN Zweit-Tenant, KEIN Nummer-Request (die Wurzel dieser Kette,
// end-to-end gegen die echte Route statt nur die Vorbedingung). Der Merge-Zustand wird
// hier direkt geseedet (tenant.idpSubject auf einem FREMDEN Tenant-Record) - derselbe
// resolveTenant-Fallback-Pfad (1:1-idpSubject-Scan), den auch der subIndex-Merge-Fall
// (test/tenant-prolif-b.test.js) ueber den anderen Pfad (subIndex) trifft; beide muenden
// im selben Guard (checkSubAlreadyMerged, src/onboard-guard.js).
const MERGED_SUB = "sub-merged-owner";
const CANONICAL_TENANT_ID = "t_canonical_owner"; // != tenantIdForSubject(MERGED_SUB)
const mergedSubSeed = seedState({
  tenants: [{ id: CANONICAL_TENANT_ID, status: "active", idpSubject: MERGED_SUB }],
});

test("onboard mit gemergtem idpSubject -> 409, kein Zweit-Tenant, keine Zweit-Nummer", async () => {
  const srv = await startServer({ seed: mergedSubSeed });
  try {
    const before = srv.readStore().tenants.length;
    const res = await postJson(`${srv.localUrl}/api/onboard`, {
      idpSubject: MERGED_SUB,
      firstName: "Zweit",
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /bereits einem Tenant zugeordnet/);
    const after = srv.readStore();
    assert.equal(after.tenants.length, before, "kein Zweit-Tenant angelegt");
    assert.ok(
      !after.tenants.some((t) => t.id === tenantIdForSubject(MERGED_SUB)),
      "t_sub-merged-owner (Zweit-Tenant) wurde NICHT erzeugt",
    );
    assert.equal(
      after.numbers.filter((n) => n.tenantId === tenantIdForSubject(MERGED_SUB)).length,
      0,
      "kein Nummer-Request fuer den verhinderten Zweit-Tenant (kein Telnyx-DID-Kauf)",
    );
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
    const onb = await postJson(`${srv.localUrl}/api/onboard`, {
      tenantId: "t_maria",
      firstName: OWNER_NAME,
    });
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
