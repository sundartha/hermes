// tenant-prolif-d: reiner Klassifikator classifyNumbersForRelease/numberReleaseVerdict.
// Triagiert active Nummern von suspendierten Tenants in release/hold/skip - IO-frei,
// kein Spawn, kein pglite (reine Unit, offline, F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyNumbersForRelease, numberReleaseVerdict } from "../src/store/state-ops.js";
import { NUMBER_STATUS, TENANT_STATUS, PROVIDER } from "../src/store/defaults.js";

const NOW = Date.parse("2026-07-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const GRACE = 14 * DAY;

const tenant = (o = {}) => ({
  id: "t1",
  status: TENANT_STATUS.SUSPENDED,
  suspendedAt: new Date(NOW - 30 * DAY).toISOString(),
  ...o,
});
const num = (o = {}) => ({
  id: "n1",
  tenantId: "t1",
  status: NUMBER_STATUS.ACTIVE,
  provider: PROVIDER.TELNYX,
  providerNumberId: "ext_1",
  e164: "+493012345",
  ...o,
});
// calls/platformNumberUse: [] (OUTBOUND-E1: numberReleaseVerdict ruft jetzt zusaetzlich
// numberBusyReason -> platformNumberBindings/den Anruf-Check; ohne diese beiden Felder
// wuerfe der Zugriff bei gesetzter e164, weil das synthetische State-Objekt hier keinen
// vollen makeDefaultState()-Shape traegt).
const state = ({ numbers = [num()], tenants = [tenant()], calls = [], platformNumberUse = [] } = {}) => ({
  tenants,
  numbers,
  calls,
  platformNumberUse,
});
const classify = (s, graceMs = GRACE) => classifyNumbersForRelease(s, { nowMs: NOW, graceMs });

test("(i) active + telnyx + suspended 30d, grace 14d -> release", () => {
  const b = classify(state());
  assert.deepEqual(b.release.map((n) => n.id), ["n1"]);
  assert.equal(b.hold.length, 0);
  assert.equal(b.skip.length, 0);
});

test("(ii) non-telnyx (twilio) -> hold:non_telnyx_manual (Twilio-safe)", () => {
  const b = classify(state({ numbers: [num({ provider: "twilio" })] }));
  assert.equal(b.release.length, 0);
  assert.equal(b.hold[0].reason, "non_telnyx_manual");
});

test("(iii) Nummer bereits released -> skip:not_active_released", () => {
  const b = classify(state({ numbers: [num({ status: NUMBER_STATUS.RELEASED })] }));
  assert.equal(b.release.length, 0);
  assert.equal(b.skip[0].reason, "not_active_released");
});

test("(iv) Tenant nicht suspendiert (suspendedAt:null) -> skip:tenant_not_suspended", () => {
  const b = classify(state({ tenants: [tenant({ suspendedAt: null })] }));
  assert.equal(b.release.length, 0);
  assert.equal(b.skip[0].reason, "tenant_not_suspended");
});

test("(v) Grace noch nicht erreicht (3d < 14d) -> skip:grace_not_reached", () => {
  const b = classify(state({ tenants: [tenant({ suspendedAt: new Date(NOW - 3 * DAY).toISOString() })] }));
  assert.equal(b.release.length, 0);
  assert.equal(b.skip[0].reason, "grace_not_reached");
});

test("(vi) suspended_at unparsebar -> skip:suspended_at_unparsebar (fail-closed)", () => {
  const b = classify(state({ tenants: [tenant({ suspendedAt: "kaputt" })] }));
  assert.equal(b.release.length, 0);
  assert.equal(b.skip[0].reason, "suspended_at_unparsebar");
});

test("(vii) Klassifizierer-Kontrakt bei graceMs=0: naiv, liefert trotzdem release (das Observe-Only-Gate sitzt im Executor, nicht hier)", () => {
  const uralt = tenant({ suspendedAt: new Date(NOW - 999 * DAY).toISOString() });
  const verdict = numberReleaseVerdict(state({ tenants: [uralt] }), num(), { nowMs: NOW, graceMs: 0 });
  assert.equal(verdict.action, "release");
});
