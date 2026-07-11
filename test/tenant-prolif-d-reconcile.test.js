// tenant-prolif-d: Executor runReleaseReconcile mit Fake-Store + Fake-Provisioner -
// reine In-Process-Unit, kein Spawn, kein pglite, kein Netz (F.I.R.S.T.). Deckt:
// scharfer Happy-Path, Idempotenz, Twilio-safe, Live-Recheck-Abbruch, 404-Konvergenz,
// harter Provider-Fehler und den Observe-Only-Default (grace=0 -> NIE ein DELETE).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runReleaseReconcile } from "../src/release-reconcile.js";
import { NUMBER_STATUS, TENANT_STATUS, PROVIDER } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

const NOW = Date.parse("2026-07-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const GRACE = 14 * DAY;

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
// Phasen-Store fuer den Live-Recheck-Test (d): der ERSTE load()-Aufruf (Klassifizierung)
// liefert den suspendierten Ausgangszustand, JEDER Folge-Aufruf (Recheck) den reaktivierten.
const phasedStore = (first, rest) => {
  let calls = 0;
  return { load: () => (calls++ === 0 ? first : rest), save: () => {}, withStoreLock: (fn) => fn() };
};
const http = (status) => Object.assign(new Error(`HTTP ${status}`), { providerStatus: status });

const seed = (over = {}) => ({
  tenants: [
    { id: "t1", status: TENANT_STATUS.SUSPENDED, suspendedAt: new Date(NOW - 30 * DAY).toISOString() },
  ],
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

test("(a) scharf, happy: release erfolgt, Store+Assignment+Audit konsistent", async () => {
  const s = seed();
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const result = await runReleaseReconcile({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    nowMs: NOW,
    graceMs: GRACE,
  });
  assert.deepEqual(result, { released: 1, aborted: 0, observed: 0 });
  assert.ok(prov.log.includes("release:ext_1"));
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.notEqual(s.numberAssignments[0].releasedAt, null);
  assert.ok(audit.records.some((r) => r.action === "did_released"));
});

test("(b) idempotent 2. Lauf: bereits released -> kein zweiter Provider-Call", async () => {
  const s = seed({ numbers: [{ ...seed().numbers[0], status: NUMBER_STATUS.RELEASED }] });
  const prov = fakeProvisioner();
  const result = await runReleaseReconcile({
    store: fakeStore(s),
    provisioner: prov,
    audit: fakeAudit(),
    logger: fakeLogger(),
    nowMs: NOW,
    graceMs: GRACE,
  });
  assert.equal(result.released, 0);
  assert.deepEqual(prov.log, []);
});

test("(c) non-telnyx (twilio) bleibt unangetastet", async () => {
  const s = seed({ numbers: [{ ...seed().numbers[0], provider: "twilio" }] });
  const prov = fakeProvisioner();
  const result = await runReleaseReconcile({
    store: fakeStore(s),
    provisioner: prov,
    audit: fakeAudit(),
    logger: fakeLogger(),
    nowMs: NOW,
    graceMs: GRACE,
  });
  assert.equal(result.released, 0);
  assert.deepEqual(prov.log, []);
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE);
});

test("(d) Live-Recheck-Abbruch: Reaktivierung zwischen Klassifizierung und Release", async () => {
  const suspended = seed();
  const reactivated = seed({
    tenants: [{ id: "t1", status: TENANT_STATUS.ACTIVE, suspendedAt: null }],
  });
  const prov = fakeProvisioner();
  const audit = fakeAudit();
  const result = await runReleaseReconcile({
    store: phasedStore(suspended, reactivated),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    nowMs: NOW,
    graceMs: GRACE,
  });
  assert.equal(result.released, 0);
  assert.equal(result.aborted, 1);
  assert.deepEqual(prov.log, []);
  assert.equal(reactivated.numbers[0].status, NUMBER_STATUS.ACTIVE);
  assert.ok(audit.records.some((r) => r.action === "did_release_aborted" && r.detail.includes("grund=recheck")));
});

test("(e) 404 = Konvergenz: bereits bei Telnyx geloescht zaehlt als Erfolg", async () => {
  const s = seed();
  const prov = fakeProvisioner({ releaseNumber: async () => { throw http(404); } });
  const audit = fakeAudit();
  const result = await runReleaseReconcile({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    nowMs: NOW,
    graceMs: GRACE,
  });
  assert.equal(result.released, 1);
  assert.equal(s.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.ok(audit.records.some((r) => r.action === "did_released"));
});

test("(f) harter Provider-Fehler (500): Store bleibt active, kein Divergenz-Orphan", async () => {
  const s = seed();
  const prov = fakeProvisioner({ releaseNumber: async () => { throw http(500); } });
  const audit = fakeAudit();
  const result = await runReleaseReconcile({
    store: fakeStore(s),
    provisioner: prov,
    audit,
    logger: fakeLogger(),
    nowMs: NOW,
    graceMs: GRACE,
  });
  assert.deepEqual(result, { released: 0, aborted: 1, observed: 0 });
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE);
  assert.ok(
    audit.records.some((r) => r.action === "did_release_aborted" && r.detail.includes("grund=provider_error")),
  );
});

test("(g) OBSERVE-ONLY (graceMs=0): NICHTS wird freigegeben, egal wie alt (Pre-Mortem)", async () => {
  const s = seed({
    tenants: [{ id: "t1", status: TENANT_STATUS.SUSPENDED, suspendedAt: new Date(NOW - 999 * DAY).toISOString() }],
  });
  const prov = fakeProvisioner();
  const result = await runReleaseReconcile({
    store: fakeStore(s),
    provisioner: prov,
    audit: fakeAudit(),
    logger: fakeLogger(),
    nowMs: NOW,
    graceMs: 0,
  });
  assert.deepEqual(result, { released: 0, aborted: 0, observed: 1 });
  assert.deepEqual(prov.log, []);
  assert.equal(s.numbers[0].status, NUMBER_STATUS.ACTIVE);
});
