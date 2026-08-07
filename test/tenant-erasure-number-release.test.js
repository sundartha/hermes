// tenant-prolif-e: Art.-17-Erase gibt Nummern frei. Reiner Selektor (tenantNumbersForErase)
// + Orchestrator (releaseTenantNumbersOnErase) mit Fake-Store + Fake-Provisioner - reine
// In-Process-Unit, kein Spawn, kein pglite, kein Netz (F.I.R.S.T.). Deckt: Selektor-Filter,
// Happy-Path, non-telnyx-safe, Idempotenz, 404-Konvergenz, harter Provider-Fehler, cross-tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseTenantNumbersOnErase } from "../src/release-reconcile.js";
import { tenantNumbersForErase } from "../src/store/state-ops.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

// Ein Provider-Wert, den die Registry NICHT kennt. Bewusst 'twilio' statt eines
// Phantasienamens: genau dieser String kann als ALTZEILE in einer Bestands-DB stehen
// (`provider TEXT` ohne CHECK-Constraint) - und eine Altzeile darf der Release-Pfad
// NICHT anfassen (kein Provider, bei dem man sie freigeben koennte).
const NON_TELNYX_PROVIDER = "twilio";

const fakeAudit = () => ({
  records: [],
  record(entry) {
    this.records.push(entry);
    return Promise.resolve();
  },
});
const fakeLogger = () => ({ log: () => {}, warn: () => {} });
// Fake-Store ueber der facade-Kontraktflaeche { load, save, withStoreLock } - EINE
// mutable Referenz, so wirken Mutationen ueber alle load()-Aufrufe hinweg.
const fakeStore = (s) => ({ load: () => s, save: () => {}, withStoreLock: (fn) => fn() });
const http = (status) => Object.assign(new Error(`HTTP ${status}`), { providerStatus: status });

const seed = (over = {}) => ({
  tenants: [{ id: "t1" }],
  numbers: [
    {
      id: "n1",
      tenantId: "t1",
      status: NUMBER_STATUS.ACTIVE,
      provider: PROVIDER.TELNYX,
      providerNumberId: "ext_1",
      e164: "+493012345",
    },
  ],
  numberAssignments: [{ id: "a1", numberId: "n1", tenantId: "t1", assignedAt: "x", releasedAt: null }],
  ...over,
});

test("(1) Selektor: active+telnyx des Tenants ja, alles andere nein", () => {
  const s = seed({
    numbers: [
      { id: "n1", tenantId: "t1", status: NUMBER_STATUS.ACTIVE, provider: PROVIDER.TELNYX },
      { id: "n2", tenantId: "t1", status: NUMBER_STATUS.PROVISIONING, provider: PROVIDER.TELNYX },
      { id: "n3", tenantId: "t1", status: NUMBER_STATUS.RELEASED, provider: PROVIDER.TELNYX },
      { id: "n4", tenantId: "t1", status: NUMBER_STATUS.ACTIVE, provider: NON_TELNYX_PROVIDER },
      { id: "n5", tenantId: "t2", status: NUMBER_STATUS.ACTIVE, provider: PROVIDER.TELNYX },
    ],
  });
  const result = tenantNumbersForErase(s, "t1");
  assert.deepEqual(
    result.map((n) => n.id),
    ["n1"],
  );
});

test("(2) Happy: 1 active telnyx -> released, Store+Assignment+Audit konsistent (actor=erase)", async () => {
  const s = seed();
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(result, { released: 1, aborted: 0 });
  assert.ok(prov.log.includes("release:ext_1"));
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.notEqual(s.numberAssignments[0].releasedAt, null);
  const rec = audit.records.find((r) => r.action === "did_released");
  assert.ok(rec);
  assert.equal(rec.actorSub, "system:erase-release");
});

test("(3) non-telnyx bleibt unangetastet", async () => {
  const s = seed({ numbers: [{ ...seed().numbers[0], provider: NON_TELNYX_PROVIDER }] });
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(result, { released: 0, aborted: 0 });
  assert.deepEqual(prov.log, []);
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE);
  assert.ok(!audit.records.some((r) => r.action === "did_released"));
});

test("(4) doppelter Erase idempotent: 2. Lauf findet keine Kandidaten mehr", async () => {
  const s = seed();
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const first = await releaseTenantNumbersOnErase({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.equal(first.released, 1);
  const second = await releaseTenantNumbersOnErase({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(second, { released: 0, aborted: 0 });
  assert.deepEqual(prov.log, ["release:ext_1"]); // kein zweiter Provider-Call im 2. Lauf
});

test("(5) 404 = Konvergenz: bereits bei Telnyx geloescht zaehlt als Erfolg", async () => {
  const s = seed();
  const prov = fakeProvisioner({
    releaseNumber: async () => {
      throw http(404);
    },
  });
  const audit = fakeAudit();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.equal(result.released, 1);
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.ok(audit.records.some((r) => r.action === "did_released"));
});

test("(6) harter Provider-Fehler (500): Store bleibt active, kein Divergenz-Orphan", async () => {
  const s = seed();
  const prov = fakeProvisioner({
    releaseNumber: async () => {
      throw http(500);
    },
  });
  const audit = fakeAudit();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.deepEqual(result, { released: 0, aborted: 1 });
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE);
  assert.ok(
    audit.records.some((r) => r.action === "did_release_aborted" && r.detail.includes("grund=provider_error")),
  );
});

test("(7) cross-tenant-dicht: nur der Ziel-Tenant wird freigegeben", async () => {
  const s = seed({
    tenants: [{ id: "t1" }, { id: "t2" }],
    numbers: [
      { id: "n1", tenantId: "t1", status: NUMBER_STATUS.ACTIVE, provider: PROVIDER.TELNYX, providerNumberId: "ext_1" },
      { id: "n2", tenantId: "t2", status: NUMBER_STATUS.ACTIVE, provider: PROVIDER.TELNYX, providerNumberId: "ext_2" },
    ],
    numberAssignments: [
      { id: "a1", numberId: "n1", tenantId: "t1", assignedAt: "x", releasedAt: null },
      { id: "a2", numberId: "n2", tenantId: "t2", assignedAt: "x", releasedAt: null },
    ],
  });
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.equal(result.released, 1);
  assert.deepEqual(prov.log, ["release:ext_1"]);
  assert.equal(s.numbers.find((n) => n.id === "n1").status, NUMBER_STATUS.RELEASED);
  assert.equal(s.numbers.find((n) => n.id === "n2").status, NUMBER_STATUS.ACTIVE);
});
