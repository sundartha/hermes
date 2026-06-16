// P6b4: KYC-Level + Gate-Praedikat (state-ops-Unit). Prueft die INVARIANTEN rein
// ueber ops.setKycLevel/kycReached (kein Netz, kein Server, kein pglite; Lehre P6a:
// state-ops-Unit NICHT mit Spawn/pglite mischen). Das HTTP-Gate (numberGateError-
// Sequenz) deckt kyc-gate-outbound.test.js ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, registerTenant, setKycLevel, kycReached } from "../src/store/state-ops.js";
import { KYC_LEVEL, KYC_OUTBOUND_MIN, OWNER_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant_a";

test("INV(3): Owner/Bestand ohne kyc_level -> Gate passiert (kycReached true, byte-identisch)", () => {
  const s = makeDefaultState();
  assert.equal("kycLevel" in s.tenants[0], false, "Owner traegt KEIN kycLevel-Feld (kein Default-Seed)");
  assert.equal(kycReached(s, OWNER_TENANT_ID, KYC_OUTBOUND_MIN), true, "fehlend -> ausreichend");
});

test("INV(1): explizit < card -> Gate sperrt (none + otp)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setKycLevel(s, A, KYC_LEVEL.NONE);
  assert.equal(kycReached(s, A, KYC_OUTBOUND_MIN), false, "none < card -> gesperrt");
  setKycLevel(s, A, KYC_LEVEL.OTP);
  assert.equal(kycReached(s, A, KYC_OUTBOUND_MIN), false, "otp < card -> gesperrt");
});

test("INV(2): >= card -> Gate passiert (card + id_verified)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setKycLevel(s, A, KYC_LEVEL.CARD);
  assert.equal(kycReached(s, A, KYC_OUTBOUND_MIN), true, "card == Schwelle -> erlaubt (>=)");
  setKycLevel(s, A, KYC_LEVEL.ID_VERIFIED);
  assert.equal(kycReached(s, A, KYC_OUTBOUND_MIN), true, "id_verified > card -> erlaubt");
});

test("setKycLevel: unbekannte Stufe wirft (fail-closed, kein Muell-Wert)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  assert.throws(() => setKycLevel(s, A, "platinum"), /unbekannte KYC-Stufe/);
});

test("setKycLevel: fehlender Tenant wirft (kein stilles No-Op)", () => {
  const s = makeDefaultState();
  assert.throws(() => setKycLevel(s, "ghost", KYC_LEVEL.CARD), /nicht gefunden/);
});

test("setKycLevel ist idempotent-set (eine kycLevel-Eigenschaft, kein Duplikat)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setKycLevel(s, A, KYC_LEVEL.OTP);
  setKycLevel(s, A, KYC_LEVEL.CARD);
  assert.equal(s.tenants.find((t) => t.id === A).kycLevel, KYC_LEVEL.CARD);
});
