// PROV-01 (F7): Retry-Lever-Entscheidung resolveProvisionRetry. Junger stuck-requested+
// queued -> redrive (dieselbe numberId/Job, KEIN Doppelkauf); alt/alters-unbekannt ->
// needs_manual_reconcile (kein Auto-Kauf); aktiv -> already_provisioned; terminal failed
// -> frische requested-Nummer. Reine Unit (kein Spawn/pglite), config-frei ueber opts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProvisionRetry } from "../src/billing/provision-trigger.js";
import {
  NUMBER_STATUS, PROVISIONING_JOB_STATUS, PROVISION_NUMBER_JOB,
  TENANT_STATUS, KYC_LEVEL,
} from "../src/store/defaults.js";

const NOW = Date.parse("2026-07-03T12:00:00.000Z");
const HOUR = 3600000;
const TENANT = "t1";

const tenant = (o = {}) => ({ id: TENANT, status: TENANT_STATUS.ACTIVE, kycLevel: KYC_LEVEL.CARD, country: "DE", ...o });
const num = (o = {}) => ({ id: "num1", tenantId: TENANT, status: NUMBER_STATUS.REQUESTED, e164: null, provider: "telnyx", providerNumberId: null, ...o });
const job = (o = {}) => ({ id: "job1", numberId: "num1", tenantId: TENANT, kind: PROVISION_NUMBER_JOB, status: PROVISIONING_JOB_STATUS.QUEUED, idempotencyKey: "provision_num1", attempts: 0, lastError: null, createdAt: new Date(NOW - 60000).toISOString(), ...o });
const state = ({ numbers = [num()], jobs = [job()], tenants = [tenant()] } = {}) => ({ tenants, numbers, provisioningJobs: jobs });
// caps hoch, damit der fresh-Pfad nicht am Cap scheitert; nowMs/maxAgeMs config-frei injiziert.
const opts = (maxAgeMs = HOUR) => ({ tenantId: TENANT, nowMs: NOW, maxAgeMs, fallbackCountry: "DE", forceNumberCountry: "", maxNumbers: 100, maxNumbersPerTenant: 100 });

test("junger stuck-requested+queued -> redrive + numberId + jobId + job (kein fresh request)", () => {
  const s = state();
  const r = resolveProvisionRetry(s, opts());
  assert.equal(r.ok, true);
  assert.equal(r.reason, "redrive");
  assert.equal(r.numberId, "num1");
  assert.equal(r.jobId, "job1");
  assert.equal(r.job?.idempotencyKey, "provision_num1"); // fuer redriveProvisioningJobs-Wiring
  assert.equal(s.numbers.length, 1, "KEINE neue Nummer angefragt");
});

test("Grenzfall Alter == maxAgeMs -> noch redrive (> ist der Block, nicht >=)", () => {
  const r = resolveProvisionRetry(state({ jobs: [job({ createdAt: new Date(NOW - HOUR).toISOString() })] }), opts(HOUR));
  assert.equal(r.reason, "redrive");
});

test("alter stuck (> maxAgeMs) -> needs_manual_reconcile, KEIN Kauf", () => {
  const r = resolveProvisionRetry(state({ jobs: [job({ createdAt: new Date(NOW - 2 * HOUR).toISOString() })] }), opts(HOUR));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "needs_manual_reconcile");
});

test("alters-unbekannter stuck (createdAt fehlt) -> needs_manual_reconcile (fail-closed)", () => {
  const r = resolveProvisionRetry(state({ jobs: [job({ createdAt: undefined })] }), opts(HOUR));
  assert.equal(r.reason, "needs_manual_reconcile");
});

test("Observe-Only (maxAge=0): junger stuck -> needs_manual_reconcile", () => {
  const r = resolveProvisionRetry(state(), opts(0));
  assert.equal(r.reason, "needs_manual_reconcile");
});

test("requested OHNE queued-Job -> already_provisioned (Dry-Run-Onboard, kein stuck)", () => {
  const r = resolveProvisionRetry(state({ jobs: [] }), opts());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "already_provisioned");
});

test("aktive Nummer -> already_provisioned (Idempotenz, kein Doppelkauf)", () => {
  const r = resolveProvisionRetry(state({ numbers: [num({ status: NUMBER_STATUS.ACTIVE })], jobs: [] }), opts());
  assert.equal(r.reason, "already_provisioned");
});

test("terminal failed -> frische requested-Nummer (Bestandsschutz)", () => {
  const s = state({ numbers: [num({ id: "num_old", status: NUMBER_STATUS.FAILED })], jobs: [] });
  const r = resolveProvisionRetry(s, opts());
  assert.equal(r.ok, true);
  assert.equal(r.number?.status, "requested");
  assert.equal(s.numbers.length, 2, "eine NEUE requested-Nummer angefragt");
});
