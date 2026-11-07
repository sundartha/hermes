import { test } from "node:test";
import assert from "node:assert/strict";
import {
  waehleAbsenderRegistrierung,
  ABSENDER_QUELLE,
  ABSENDER_GRUND,
} from "../../src/telephony/absender-registrierung.js";

const TENANT_A_DID = "+18643028341";
const TENANT_B_DID = "+15551234567";

test("A1: Datensatz mit providerAgentPhoneNumberId + e164 === from -> tenant_did, byte-genau", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: { e164: TENANT_A_DID, providerAgentPhoneNumberId: "phnum_tenant_a" },
    fromE164: TENANT_A_DID,
  });
  assert.deepEqual(ergebnis, {
    agentPhoneNumberId: "phnum_tenant_a",
    e164: TENANT_A_DID,
    quelle: ABSENDER_QUELLE.TENANT_DID,
    grund: null,
  });
});

test("A3: numberRecord fehlt -> Abbruch, grund=keine_aktive_nummer", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: undefined,
    fromE164: TENANT_A_DID,
  });
  assert.deepEqual(ergebnis, {
    agentPhoneNumberId: null,
    e164: null,
    quelle: ABSENDER_QUELLE.ABGEBROCHEN,
    grund: ABSENDER_GRUND.KEINE_NUMMER,
  });
});

test("A4: numberRecord.e164 !== fromE164 -> Abbruch, grund=nummer_weicht_von_from_ab", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: { e164: TENANT_A_DID, providerAgentPhoneNumberId: "phnum_tenant_a" },
    fromE164: TENANT_B_DID,
  });
  assert.equal(ergebnis.quelle, ABSENDER_QUELLE.ABGEBROCHEN);
  assert.equal(ergebnis.grund, ABSENDER_GRUND.NUMMER_WEICHT_AB);
  assert.equal(ergebnis.agentPhoneNumberId, null);
});

test("A5: numberRecord ohne providerAgentPhoneNumberId -> Abbruch, grund=keine_eigene_registrierung", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: { e164: TENANT_A_DID, providerAgentPhoneNumberId: null },
    fromE164: TENANT_A_DID,
  });
  assert.equal(ergebnis.quelle, ABSENDER_QUELLE.ABGEBROCHEN);
  assert.equal(ergebnis.grund, ABSENDER_GRUND.KEINE_REGISTRIERUNG);
});

test("A6: Tenant-Isolation - fremder Datensatz (andere e164) liefert NIE seine Kennung", () => {
  const fremderDatensatzTenantB = { e164: TENANT_B_DID, providerAgentPhoneNumberId: "phnum_tenant_b" };
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: fremderDatensatzTenantB,
    fromE164: TENANT_A_DID,
  });
  assert.notEqual(ergebnis.agentPhoneNumberId, "phnum_tenant_b");
  assert.equal(ergebnis.quelle, ABSENDER_QUELLE.ABGEBROCHEN);
  assert.equal(ergebnis.grund, ABSENDER_GRUND.NUMMER_WEICHT_AB);
});

test("A7: rein aufrufbar ohne Store/fetch - der Import selbst beweist es bereits", () => {
  assert.equal(typeof waehleAbsenderRegistrierung, "function");
  assert.doesNotThrow(() =>
    waehleAbsenderRegistrierung({ numberRecord: null, fromE164: TENANT_A_DID }),
  );
});
