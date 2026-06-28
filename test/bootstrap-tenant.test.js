// Owner-Removal P2b: Erst-Setup ohne Owner-env. Drei Achsen, alle offline:
//   1) state-ops bootstrapTenant: legt den Tenant an + traegt seine aktive Nummer ein
//      (idempotent), in EINER Mutation. Ersetzt den config-derived Boot-Seed.
//   2) views hasActiveNumber: tenant-agnostisches Boot-Gate-Praedikat (Grenzfaelle).
//   3) Boot-Gate (Spawn): ein BELIEBIGER Tenant mit aktiver Nummer macht den Dienst
//      telefonbar (kein OWNER/BOOTSTRAP-Pin) - beweist die Tenant-Agnostik (Kern P2b).
// KEIN pglite + Server-Spawn in EINER Datei (P3/P6a-Lehre) - hier nur state-ops + Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapTenant, makeDefaultState, findTenant } from "../src/store/state-ops.js";
import { hasActiveNumber } from "../src/store/views.js";
import { BOOTSTRAP_TENANT_ID, KYC_LEVEL, NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { startServer } from "./helpers.js";

const E164 = "+15005550006";

// ---- (1) state-ops bootstrapTenant ----
test("bootstrapTenant: legt den Bootstrap-Tenant (active) an + aktive Nummer", () => {
  const s = makeDefaultState();
  s.tenants = []; // leerer Store: kein vorbelegter Tenant
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TWILIO);
  const tenant = findTenant(s, BOOTSTRAP_TENANT_ID);
  assert.ok(tenant, "Tenant angelegt");
  assert.equal(tenant.status, "active");
  assert.ok(hasActiveNumber(s), "aktive Nummer vorhanden");
});

test("bootstrapTenant: idempotent (zweiter Lauf, gleiche e164) - genau 1 Tenant/Nummer", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TWILIO);
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TWILIO);
  assert.equal(s.tenants.filter((t) => t.id === BOOTSTRAP_TENANT_ID).length, 1);
  assert.equal(s.numbers.filter((n) => n.e164 === E164).length, 1);
});

test("bootstrapTenant: optionale tenantId -> Tenant unter diesem Key", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, "custom-id", PROVIDER.TELNYX);
  const tenant = findTenant(s, "custom-id");
  assert.ok(tenant, "Tenant unter custom-id");
  const num = s.numbers.find((n) => n.e164 === E164);
  assert.equal(num.tenantId, "custom-id");
  assert.equal(num.provider, PROVIDER.TELNYX);
});

// ---- (1b) outbound-p1fix #3: KYC-Heal NUR fuer den Bootstrap/Owner ----
test("bootstrapTenant(owner): Owner wird auf kyc_level=id_verified geheilt", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TWILIO);
  assert.equal(findTenant(s, BOOTSTRAP_TENANT_ID).kycLevel, KYC_LEVEL.ID_VERIFIED);
});

test("bootstrapTenant(fremd): Nicht-Owner-tenantId bleibt UNGESEEDET (KYC-Gate sperrt fail-closed)", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, "user_fremd", PROVIDER.TWILIO);
  const tenant = findTenant(s, "user_fremd");
  assert.ok(tenant, "Tenant existiert");
  assert.equal(tenant.status, "active");
  assert.ok(s.numbers.some((n) => n.tenantId === "user_fremd"), "aktive Nummer eingetragen");
  assert.equal(tenant.kycLevel, undefined, "kyc_level NICHT geseedet -> kycReached fail-closed false");
});

// ---- (2) views hasActiveNumber (Grenzfaelle T5) ----
test("hasActiveNumber: leerer Store -> false", () => {
  assert.equal(hasActiveNumber({ numbers: [] }), false);
});

test("hasActiveNumber: aktive Nummer eines NICHT-Bootstrap-Tenants -> true (agnostisch)", () => {
  const s = { numbers: [{ e164: E164, tenantId: "t_x", status: NUMBER_STATUS.ACTIVE }] };
  assert.equal(hasActiveNumber(s), true);
});

test("hasActiveNumber: nur 'requested' Nummern -> false (kein aktiver Eintrag)", () => {
  const s = { numbers: [{ e164: null, tenantId: "t_x", status: NUMBER_STATUS.REQUESTED }] };
  assert.equal(hasActiveNumber(s), false);
});

// ---- (3) Boot-Gate ist tenant-agnostisch (Spawn) ----
test("Boot-Gate: aktive Nummer eines BELIEBIGEN Tenants (nicht Bootstrap) -> Boot gruen", async () => {
  // ownerNumber:null -> KEIN Auto-Owner-Seed der Helper; die einzige aktive Nummer
  // gehoert Tenant t_x. Booted der Dienst trotzdem (healthz 200), ist der Boot-Gate
  // beweisbar tenant-agnostisch (kein BOOTSTRAP-Pin).
  const seed = {
    settings: { [BOOTSTRAP_TENANT_ID]: {} },
    calls: [],
    actionItems: [],
    calendar: { [BOOTSTRAP_TENANT_ID]: [] },
    usage: { [BOOTSTRAP_TENANT_ID]: { inputTokens: 0, outputTokens: 0, costEur: 0, calls: 0 } },
    notifications: [],
    profiles: {},
    tenants: [{ id: "t_x", status: "active" }],
    numbers: [
      { id: "num_x", e164: E164, tenantId: "t_x", provider: "twilio", status: "active", providerNumberId: null },
    ],
  };
  const srv = await startServer({ seed, ownerNumber: null });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "beliebiger Tenant mit aktiver Nummer -> Boot gruen");
  } finally {
    await srv.stop();
  }
});
