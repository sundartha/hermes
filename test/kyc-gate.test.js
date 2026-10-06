import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  setKycLevel,
  kycReached,
  seedBootstrapKyc,
  tenantActiveSubscriber,
} from "../src/store/state-ops.js";
import { KYC_LEVEL, KYC_OUTBOUND_MIN, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant_a";

test("INV(3): Owner/Bestand ohne kyc_level -> Gate sperrt fail-closed (kycReached false)", () => {
  const s = makeDefaultState();
  assert.equal(
    "kycLevel" in s.tenants[0],
    false,
    "Owner traegt KEIN kycLevel-Feld (kein Default-Seed)",
  );
  assert.equal(
    kycReached(s, BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN),
    false,
    "fehlend -> unzureichend (fail-closed)",
  );
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

test("seedBootstrapKyc: frischer Owner -> id_verified, zweiter Lauf No-Op (idempotent)", () => {
  const s = makeDefaultState();
  assert.equal(seedBootstrapKyc(s, BOOTSTRAP_TENANT_ID), true, "erste Heilung mutiert");
  assert.equal(s.tenants[0].kycLevel, KYC_LEVEL.ID_VERIFIED, "auf id_verified geseedet");
  assert.equal(seedBootstrapKyc(s, BOOTSTRAP_TENANT_ID), false, "zweiter Lauf = No-Op");
  assert.equal(s.tenants[0].kycLevel, KYC_LEVEL.ID_VERIFIED, "Wert unveraendert");
});

test("seedBootstrapKyc: gesetzter Wert gewinnt (kein Override)", () => {
  const s = makeDefaultState();
  setKycLevel(s, BOOTSTRAP_TENANT_ID, KYC_LEVEL.CARD);
  assert.equal(seedBootstrapKyc(s, BOOTSTRAP_TENANT_ID), false, "schon gesetzt -> kein Seed");
  assert.equal(s.tenants[0].kycLevel, KYC_LEVEL.CARD, "card bleibt (nicht ueberschrieben)");
});

test("seedBootstrapKyc: fehlender Tenant -> false (kein Throw)", () => {
  const s = { tenants: [] };
  assert.equal(seedBootstrapKyc(s, BOOTSTRAP_TENANT_ID), false, "kein Tenant -> No-Op statt Throw");
});

test("seedBootstrapKyc: heilt BEIDE Praedikate (kycReached + tenantActiveSubscriber)", () => {
  const s = makeDefaultState();
  assert.equal(kycReached(s, BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN), false, "vorher: fail-closed");
  assert.equal(tenantActiveSubscriber(s, BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN), false, "vorher kein Sub");
  seedBootstrapKyc(s, BOOTSTRAP_TENANT_ID);
  assert.equal(kycReached(s, BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN), true, "nachher: passiert KYC-Gate");
  assert.equal(
    tenantActiveSubscriber(s, BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN),
    true,
    "nachher: gilt als Subscriber (Allowlist-Pfad-2)",
  );
});
