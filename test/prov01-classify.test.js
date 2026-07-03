// PROV-01 (F4): reiner Klassifikator classifyQueuedProvisioningJobs. Triagiert
// QUEUED-Provisioning-Jobs in close/hold/redrive - IO-frei, kein Spawn, kein pglite
// (reine Unit, offline, F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQueuedProvisioningJobs } from "../src/store/state-ops.js";
import {
  NUMBER_STATUS, PROVISIONING_JOB_STATUS, PROVISION_NUMBER_JOB,
  TENANT_STATUS, KYC_LEVEL, KYC_OUTBOUND_MIN, PROVIDER,
} from "../src/store/defaults.js";

const NOW = Date.parse("2026-07-03T12:00:00.000Z");
const HOUR = 3600000;

const tenant = (o = {}) => ({ id: "t1", status: TENANT_STATUS.ACTIVE, kycLevel: KYC_LEVEL.CARD, ...o });
const num = (o = {}) => ({ id: "num1", tenantId: "t1", status: NUMBER_STATUS.REQUESTED, e164: null, provider: PROVIDER.TELNYX, providerNumberId: null, ...o });
const job = (o = {}) => ({ id: "job1", numberId: "num1", tenantId: "t1", kind: PROVISION_NUMBER_JOB, status: PROVISIONING_JOB_STATUS.QUEUED, idempotencyKey: "k1", attempts: 0, lastError: null, createdAt: new Date(NOW - 60000).toISOString(), ...o });
const state = ({ numbers = [num()], jobs = [job()], tenants = [tenant()] } = {}) => ({ tenants, numbers, provisioningJobs: jobs });
const classify = (s, maxAgeMs = HOUR) => classifyQueuedProvisioningJobs(s, { nowMs: NOW, maxAgeMs, kycMinLevel: KYC_OUTBOUND_MIN });

test("(i) requested + queued + aktiver Subscriber + jung -> redrive", () => {
  const b = classify(state());
  assert.deepEqual(b.redrive.map((j) => j.id), ["job1"]);
  assert.equal(b.hold.length, 0);
  assert.equal(b.close.length, 0);
});

test("(ii) requested + zu alt -> hold:too_old", () => {
  const b = classify(state({ jobs: [job({ createdAt: new Date(NOW - 2 * HOUR).toISOString() })] }));
  assert.equal(b.redrive.length, 0);
  assert.equal(b.hold[0].reason, "too_old");
});

test("(iii) requested + createdAt fehlt -> hold:unknown_age (fail-closed)", () => {
  const b = classify(state({ jobs: [job({ createdAt: undefined })] }));
  assert.equal(b.redrive.length, 0);
  assert.equal(b.hold[0].reason, "unknown_age");
});

test("(iv) requested + Tenant suspended -> hold:no_active_subscriber", () => {
  const b = classify(state({ tenants: [tenant({ status: TENANT_STATUS.SUSPENDED })] }));
  assert.equal(b.redrive.length, 0);
  assert.equal(b.hold[0].reason, "no_active_subscriber");
});

test("(v) Nummer provisioning/capturing -> hold:mid_flight_*", () => {
  for (const st of [NUMBER_STATUS.PROVISIONING, NUMBER_STATUS.CAPTURING]) {
    const b = classify(state({ numbers: [num({ status: st })] }));
    assert.equal(b.redrive.length, 0);
    assert.equal(b.hold[0].reason, `mid_flight_${st}`);
  }
});

test("(vi) Nummer active/failed/fehlt -> close", () => {
  for (const st of [NUMBER_STATUS.ACTIVE, NUMBER_STATUS.FAILED]) {
    const b = classify(state({ numbers: [num({ status: st })] }));
    assert.deepEqual(b.close.map((j) => j.id), ["job1"]);
    assert.equal(b.hold.length, 0);
    assert.equal(b.redrive.length, 0);
  }
  const missing = classify(state({ numbers: [] }));
  assert.deepEqual(missing.close.map((j) => j.id), ["job1"]);
});

test("(vii) done/failed-Job wird ignoriert (nicht QUEUED)", () => {
  for (const st of [PROVISIONING_JOB_STATUS.DONE, PROVISIONING_JOB_STATUS.FAILED]) {
    const b = classify(state({ jobs: [job({ status: st })] }));
    assert.equal(b.close.length + b.hold.length + b.redrive.length, 0);
  }
});

test("(viii) maxAgeMs=0 -> jeder requested-Job faellt in hold (Observe-Only)", () => {
  const b = classify(state(), 0);
  assert.equal(b.redrive.length, 0);
  assert.equal(b.hold[0].reason, "too_old");
});
