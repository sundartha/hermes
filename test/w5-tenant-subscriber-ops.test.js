// W5: state-ops-Unit fuer das abo-gekoppelte Outbound-Gate. Prueft die INVARIANTEN von
// tenantActiveSubscriber (Lockerungssignal) + tenantInactive (Defense-in-depth) rein ueber
// ops (kein Netz, kein Server, kein pglite; Lehre P6a: state-ops-Unit NICHT mit Spawn
// mischen). Das HTTP-Gate (allowlistError-Sequenz) deckt w5-abo-allowlist-gate.test.js ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  setKycLevel,
  tenantActiveSubscriber,
  tenantInactive,
} from "../src/store/state-ops.js";
import { KYC_LEVEL, KYC_OUTBOUND_MIN, TENANT_STATUS, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant_a";

test("tenantActiveSubscriber: Owner/Bestand ohne kyc_level -> false (byte-identisch, strenger als kycReached)", () => {
  const s = makeDefaultState();
  // Der Owner-Tenant ist active, traegt aber KEIN kycLevel -> KEIN Abo-Subscriber: das Gate
  // faellt fuer ihn auf die statische ALLOWED_NUMBERS zurueck (kein Regress).
  assert.equal("kycLevel" in s.tenants[0], false, "Owner traegt kein kycLevel");
  assert.equal(tenantActiveSubscriber(s, BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN), false);
});

test("tenantActiveSubscriber: aktiv + explizit >= card -> true (Lockerung greift)", () => {
  const s = makeDefaultState();
  registerTenant(s, A); // status active
  setKycLevel(s, A, KYC_LEVEL.CARD);
  assert.equal(tenantActiveSubscriber(s, A, KYC_OUTBOUND_MIN), true, "card == Schwelle -> Subscriber");
  setKycLevel(s, A, KYC_LEVEL.ID_VERIFIED);
  assert.equal(tenantActiveSubscriber(s, A, KYC_OUTBOUND_MIN), true, "id_verified > card -> Subscriber");
});

test("tenantActiveSubscriber: aktiv + explizit < card (none/otp) -> false (Lockerung greift NICHT)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setKycLevel(s, A, KYC_LEVEL.NONE);
  assert.equal(tenantActiveSubscriber(s, A, KYC_OUTBOUND_MIN), false, "none < card");
  setKycLevel(s, A, KYC_LEVEL.OTP);
  assert.equal(tenantActiveSubscriber(s, A, KYC_OUTBOUND_MIN), false, "otp < card");
});

test("tenantActiveSubscriber: kyc>=card ABER suspended -> false (kein Subscriber wenn nicht active)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setKycLevel(s, A, KYC_LEVEL.CARD);
  s.tenants.find((t) => t.id === A).status = TENANT_STATUS.SUSPENDED;
  assert.equal(tenantActiveSubscriber(s, A, KYC_OUTBOUND_MIN), false, "suspended -> nicht gelockert");
});

test("tenantActiveSubscriber: fehlender Tenant -> false (kein versehentliches Lockern)", () => {
  const s = makeDefaultState();
  assert.equal(tenantActiveSubscriber(s, "ghost", KYC_OUTBOUND_MIN), false);
});

test("tenantInactive: suspended UND closed -> true (Defense-in-depth-Hard-Block)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  s.tenants.find((t) => t.id === A).status = TENANT_STATUS.SUSPENDED;
  assert.equal(tenantInactive(s, A), true, "suspended -> Block");
  s.tenants.find((t) => t.id === A).status = TENANT_STATUS.CLOSED;
  assert.equal(tenantInactive(s, A), true, "closed -> Block");
});

test("tenantInactive: aktiver Tenant -> false", () => {
  const s = makeDefaultState();
  registerTenant(s, A); // status active
  assert.equal(tenantInactive(s, A), false);
  assert.equal(tenantInactive(s, BOOTSTRAP_TENANT_ID), false, "Owner active -> kein Block");
});

test("tenantInactive: fehlender Tenant -> false (kein Hard-Block; TENANT_REJECT deckt Unbekannte)", () => {
  const s = makeDefaultState();
  assert.equal(tenantInactive(s, "ghost"), false);
});
