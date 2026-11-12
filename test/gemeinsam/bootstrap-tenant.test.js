import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapTenant, makeDefaultState, findTenant } from "../../src/store/state-ops.js";
import { hasActiveNumber } from "../../src/store/views.js";
import { BOOTSTRAP_TENANT_ID, KYC_LEVEL, NUMBER_STATUS, PROVIDER } from "../../src/store/defaults.js";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { tenantContext } from "../../src/store/state-ops.js";
import { seedBootstrapNumber, seedBootstrapNumberFromConfig, markProvisioningJob } from "../../src/store/state-ops.js";

const E164 = "+15005550006";

test("bootstrapTenant: legt den Bootstrap-Tenant (active) an + aktive Nummer", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  const tenant = findTenant(s, BOOTSTRAP_TENANT_ID);
  assert.ok(tenant, "Tenant angelegt");
  assert.equal(tenant.status, "active");
  assert.ok(hasActiveNumber(s), "aktive Nummer vorhanden");
});

test("bootstrapTenant: idempotent (zweiter Lauf, gleiche e164) - genau 1 Tenant/Nummer", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
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

test("bootstrapTenant(owner): Owner wird auf kyc_level=id_verified geheilt", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(findTenant(s, BOOTSTRAP_TENANT_ID).kycLevel, KYC_LEVEL.ID_VERIFIED);
});

test("bootstrapTenant(fremd): Nicht-Owner-tenantId bleibt UNGESEEDET (KYC-Gate sperrt fail-closed)", () => {
  const s = makeDefaultState();
  s.tenants = [];
  bootstrapTenant(s, E164, "user_fremd", PROVIDER.TELNYX);
  const tenant = findTenant(s, "user_fremd");
  assert.ok(tenant, "Tenant existiert");
  assert.equal(tenant.status, "active");
  assert.ok(s.numbers.some((n) => n.tenantId === "user_fremd"), "aktive Nummer eingetragen");
  assert.equal(tenant.kycLevel, undefined, "kyc_level NICHT geseedet -> kycReached fail-closed false");
});

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

test("Boot-Gate: aktive Nummer eines BELIEBIGEN Tenants (nicht Bootstrap) -> Boot gruen", async () => {
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
      { id: "num_x", e164: E164, tenantId: "t_x", provider: "telnyx", status: "active", providerNumberId: null },
    ],
  };
  const srv = await startServer({ seed, ownerNumber: null });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "beliebiger Tenant mit aktiver Nummer -> Boot gruen");
  } finally {
    await srv.stop();
  }
});

test("Vorname ist das erste Wort des Inhabernamens", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: "t-vorname", status: "active", ...{ ownerName: "Anna Maria Berg" } }];
  assert.equal(tenantContext(s, undefined, "t-vorname").firstName, "Anna");
});

test("Vorname ignoriert führende Leerzeichen und Tabs im Inhabernamen", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: "t-vorname", status: "active", ...{ ownerName: "  \tAnna Berg" } }];
  assert.equal(tenantContext(s, undefined, "t-vorname").firstName, "Anna");
});

test("Vorname bleibt ganz, wenn der Inhabername nur ein Wort hat", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: "t-vorname", status: "active", ...{ ownerName: "Mara" } }];
  assert.equal(tenantContext(s, undefined, "t-vorname").firstName, "Mara");
});

test("Vorname ist leer, wenn der Inhabername nur aus Leerzeichen besteht", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: "t-vorname", status: "active", ...{ ownerName: "   " } }];
  assert.equal(tenantContext(s, undefined, "t-vorname").firstName, "");
});

test("Vorname ist leer, wenn der Inhabername keine Zeichenkette ist", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: "t-vorname", status: "active", ...{ ownerName: 42 } }];
  assert.equal(tenantContext(s, undefined, "t-vorname").firstName, "");
});

test("Vorname ist leer, wenn der Mandant keinen Namen hat", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: "t-vorname", status: "active", ...{} }];
  assert.equal(tenantContext(s, undefined, "t-vorname").firstName, "");
});

test("Vorname des Mandanten gewinnt vor dem Inhabernamen", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: "t-vorname", status: "active", ...{ ownerName: "Anna Berg", firstName: "Annie" } }];
  assert.equal(tenantContext(s, undefined, "t-vorname").firstName, "Annie");
});

test("Bootstrap-Nummer: neue Nummer wird einmal mit Kennung num_ angelegt, eine zweite gleiche nicht", () => {
  const state = makeDefaultState();
  seedBootstrapNumber(state, "+4930111111", "t1");
  seedBootstrapNumber(state, "+4930111111", "t2");
  seedBootstrapNumber(state, "+4930222222", "t2");
  assert.equal(state.numbers.length, 2);
  assert.match(state.numbers[0].id, /^num_/);
  assert.equal(state.numbers[0].tenantId, "t1");
  assert.equal(state.numbers[1].tenantId, "t2");
  seedBootstrapNumber(state, "", "t3");
  assert.equal(state.numbers.length, 2);
});

test("Bootstrap-Nummer aus Konfiguration: unbekannter Anbieter legt nichts an, bekannter schon", () => {
  const state = makeDefaultState();
  seedBootstrapNumberFromConfig(state, "+4930333333", "t1", "unbekannt");
  assert.equal(state.numbers.length, 0);
  seedBootstrapNumberFromConfig(state, "+4930333333", "t1", PROVIDER.TELNYX);
  assert.equal(state.numbers.length, 1);
  assert.equal(state.numbers[0].provider, PROVIDER.TELNYX);
});

test("Provisioning-Markierung: unbekannter Auftrag gibt null zurueck und aendert nichts", () => {
  const state = makeDefaultState();
  state.provisioningJobs.push({ id: "j1", status: "queued", attempts: 0, lastError: null });
  assert.equal(markProvisioningJob(state, "nix", "failed", "x"), null);
  assert.equal(state.provisioningJobs[0].status, "queued");
  assert.equal(state.provisioningJobs[0].attempts, 0);
});

test("Provisioning-Markierung: Fehlertext bleibt ohne neuen Fehler erhalten und wird mit neuem ersetzt", () => {
  const state = makeDefaultState();
  state.provisioningJobs.push({ id: "j1", status: "queued", attempts: 0, lastError: null });
  const first = markProvisioningJob(state, "j1", "failed", "kaputt");
  assert.equal(first.status, "failed");
  assert.equal(first.attempts, 1);
  assert.equal(first.lastError, "kaputt");
  const second = markProvisioningJob(state, "j1", "queued");
  assert.equal(second.attempts, 2);
  assert.equal(second.lastError, "kaputt");
  assert.equal(markProvisioningJob(state, "j1", "failed", "neu").lastError, "neu");
});
