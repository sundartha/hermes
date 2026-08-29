// OUTBOUND-E5 (F3): die reine Auswahl (telephony/absender-registrierung.js). Kein Netz,
// kein Store, kein config - Eingabe/Ausgabe genuegt.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  waehleAbsenderRegistrierung,
  ABSENDER_QUELLE,
  RUECKFALL_GRUND,
} from "../src/telephony/absender-registrierung.js";

const TENANT_A_DID = "+18643028341";
const TENANT_B_DID = "+15551234567";
const RUECKFALL_ID = "phnum_global";

// A1: Datensatz mit Registrierung, e164 == from -> die eigene Registrierung, BYTE-GENAU.
test("A1: Datensatz mit providerAgentPhoneNumberId + e164 === from -> tenant_did, byte-genau", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: { e164: TENANT_A_DID, providerAgentPhoneNumberId: "phnum_tenant_a" },
    fromE164: TENANT_A_DID,
    rueckfallId: RUECKFALL_ID,
  });
  assert.deepEqual(ergebnis, {
    agentPhoneNumberId: "phnum_tenant_a",
    e164: TENANT_A_DID,
    quelle: ABSENDER_QUELLE.TENANT_DID,
    grund: null,
  });
});

// A2: Positiv-Kontrolle - derselbe gesunde Fall liefert NIE die Rueckfall-Kennung.
test("A2: Positiv-Kontrolle - der gesunde Fall liefert nie die Rueckfall-Kennung", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: { e164: TENANT_A_DID, providerAgentPhoneNumberId: "phnum_tenant_a" },
    fromE164: TENANT_A_DID,
    rueckfallId: RUECKFALL_ID,
  });
  assert.notEqual(ergebnis.agentPhoneNumberId, RUECKFALL_ID);
  assert.equal(ergebnis.quelle, ABSENDER_QUELLE.TENANT_DID);
});

// A3: kein Nummer-Datensatz -> Rueckfall, Grund keine_aktive_nummer.
test("A3: numberRecord fehlt -> Rueckfall, grund=keine_aktive_nummer", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: undefined,
    fromE164: TENANT_A_DID,
    rueckfallId: RUECKFALL_ID,
  });
  assert.deepEqual(ergebnis, {
    agentPhoneNumberId: RUECKFALL_ID,
    e164: null,
    quelle: ABSENDER_QUELLE.RUECKFALL_GLOBAL,
    grund: RUECKFALL_GRUND.KEINE_NUMMER,
  });
});

// A4: record.e164 weicht von from ab -> Rueckfall, grund=nummer_weicht_von_from_ab.
test("A4: numberRecord.e164 !== fromE164 -> Rueckfall, grund=nummer_weicht_von_from_ab", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: { e164: TENANT_A_DID, providerAgentPhoneNumberId: "phnum_tenant_a" },
    fromE164: TENANT_B_DID,
    rueckfallId: RUECKFALL_ID,
  });
  assert.equal(ergebnis.quelle, ABSENDER_QUELLE.RUECKFALL_GLOBAL);
  assert.equal(ergebnis.grund, RUECKFALL_GRUND.NUMMER_WEICHT_AB);
  assert.equal(ergebnis.agentPhoneNumberId, RUECKFALL_ID);
});

// A5: Registrierung fehlt am Datensatz -> Rueckfall, grund=keine_eigene_registrierung.
test("A5: numberRecord ohne providerAgentPhoneNumberId -> Rueckfall, grund=keine_eigene_registrierung", () => {
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: { e164: TENANT_A_DID, providerAgentPhoneNumberId: null },
    fromE164: TENANT_A_DID,
    rueckfallId: RUECKFALL_ID,
  });
  assert.equal(ergebnis.quelle, ABSENDER_QUELLE.RUECKFALL_GLOBAL);
  assert.equal(ergebnis.grund, RUECKFALL_GRUND.KEINE_REGISTRIERUNG);
});

// A6: Tenant-Isolation (rein) - der Datensatz gehoert zu Tenant B (andere e164), der Anruf
// bucht die DID von Tenant A. Die fremde Kennung darf NIE geliefert werden.
test("A6: Tenant-Isolation - fremder Datensatz (andere e164) liefert NIE seine Kennung", () => {
  const fremderDatensatzTenantB = { e164: TENANT_B_DID, providerAgentPhoneNumberId: "phnum_tenant_b" };
  const ergebnis = waehleAbsenderRegistrierung({
    numberRecord: fremderDatensatzTenantB,
    fromE164: TENANT_A_DID,
    rueckfallId: RUECKFALL_ID,
  });
  assert.notEqual(ergebnis.agentPhoneNumberId, "phnum_tenant_b");
  assert.equal(ergebnis.quelle, ABSENDER_QUELLE.RUECKFALL_GLOBAL);
  assert.equal(ergebnis.grund, RUECKFALL_GRUND.NUMMER_WEICHT_AB);
});

// A7: kein Netz, kein Store - die Funktion ist ohne beides aufrufbar (reiner Import genuegt).
test("A7: rein aufrufbar ohne Store/fetch - der Import selbst beweist es bereits", () => {
  assert.equal(typeof waehleAbsenderRegistrierung, "function");
  assert.doesNotThrow(() =>
    waehleAbsenderRegistrierung({ numberRecord: null, fromE164: TENANT_A_DID, rueckfallId: RUECKFALL_ID }),
  );
});
