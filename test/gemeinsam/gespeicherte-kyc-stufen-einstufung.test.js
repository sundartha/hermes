import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let store;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-test-"));
  store = await import("../../src/store.js");
});

function gespeicherterMandant(id, kycLevel) {
  const eintrag = { id, status: "active" };
  if (kycLevel) eintrag.kycLevel = kycLevel;
  store.load().tenants.push(eintrag);
  return id;
}

test("setKycLevel nimmt die gespeicherten Stufen none und otp als Text an und erkennt sie danach wieder", () => {
  const id = gespeicherterMandant("t_kyc_text");
  for (const stufe of ["none", "otp", "card", "id_verified"]) {
    assert.doesNotThrow(() => store.setKycLevel(id, stufe));
    assert.equal(store.kycReached(id, stufe), true);
  }
});

test("Mandant mit gespeichertem kycLevel otp liegt über none und unter card", () => {
  const id = gespeicherterMandant("t_kyc_otp", "otp");
  assert.equal(store.kycReached(id, "none"), true);
  assert.equal(store.kycReached(id, "otp"), true);
  assert.equal(store.kycReached(id, "card"), false);
  assert.equal(store.tenantActiveSubscriber(id, "none"), true);
  assert.equal(store.tenantActiveSubscriber(id, "card"), false);
});

test("Mandant mit gespeichertem kycLevel none erreicht weder otp noch card", () => {
  const id = gespeicherterMandant("t_kyc_none", "none");
  assert.equal(store.kycReached(id, "none"), true);
  assert.equal(store.kycReached(id, "otp"), false);
  assert.equal(store.kycReached(id, "card"), false);
  assert.equal(store.tenantActiveSubscriber(id, "otp"), false);
});

test("Mandant mit gespeichertem kycLevel card erreicht die Schwelle für ausgehende Anrufe", () => {
  const id = gespeicherterMandant("t_kyc_card", "card");
  assert.equal(store.kycReached(id, "otp"), true);
  assert.equal(store.kycReached(id, "card"), true);
  assert.equal(store.kycReached(id, "id_verified"), false);
});
