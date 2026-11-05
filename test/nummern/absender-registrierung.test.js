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

const GLOBALE_KENNUNG = "phnum_global";
const EIGENE_KENNUNG = "phnum_eigen";
const NUMMER_DE = "+4915005559123";
const RUECKFALL = { agentPhoneNumberId: GLOBALE_KENNUNG, quelle: "rueckfall_global", grund: null };
const abbruchMit = (grund) => ({ agentPhoneNumberId: null, quelle: "abgebrochen", grund });
const OHNE_GLOBALE = abbruchMit("keine_globale_registrierung");
const nummerMit = (e164, providerAgentPhoneNumberId) => ({ e164, providerAgentPhoneNumberId });

const WEICHE_FAELLE = [
  { was: "+49 mit eigener Kennung", nummer: nummerMit(NUMMER_DE, EIGENE_KENNUNG), from: NUMMER_DE, rueckfallId: GLOBALE_KENNUNG, erwartet: RUECKFALL },
  { was: "+49 ohne eigene Kennung", nummer: nummerMit(NUMMER_DE, null), from: NUMMER_DE, rueckfallId: GLOBALE_KENNUNG, erwartet: RUECKFALL },
  { was: "+44", nummer: nummerMit("+447700900123", EIGENE_KENNUNG), from: "+447700900123", rueckfallId: GLOBALE_KENNUNG, erwartet: RUECKFALL },
  { was: "+33", nummer: nummerMit("+33700000123", null), from: "+33700000123", rueckfallId: GLOBALE_KENNUNG, erwartet: RUECKFALL },
  { was: "+49, globale fehlt", nummer: nummerMit(NUMMER_DE, EIGENE_KENNUNG), from: NUMMER_DE, rueckfallId: undefined, erwartet: OHNE_GLOBALE },
  { was: "+49, globale null", nummer: nummerMit(NUMMER_DE, null), from: NUMMER_DE, rueckfallId: null, erwartet: OHNE_GLOBALE },
  { was: "+49, globale leer", nummer: nummerMit(NUMMER_DE, null), from: NUMMER_DE, rueckfallId: "", erwartet: OHNE_GLOBALE },
  {
    was: "+1 mit eigener Kennung",
    nummer: nummerMit(TENANT_A_DID, EIGENE_KENNUNG),
    from: TENANT_A_DID,
    rueckfallId: GLOBALE_KENNUNG,
    erwartet: { agentPhoneNumberId: EIGENE_KENNUNG, quelle: "tenant_did", grund: null },
  },
  { was: "+1 ohne eigene Kennung", nummer: nummerMit(TENANT_A_DID, null), from: TENANT_A_DID, rueckfallId: GLOBALE_KENNUNG, erwartet: abbruchMit("keine_eigene_registrierung") },
  { was: "Nummer fehlt", nummer: undefined, from: NUMMER_DE, rueckfallId: GLOBALE_KENNUNG, erwartet: abbruchMit("keine_aktive_nummer") },
  { was: "+49 weicht von from ab", nummer: nummerMit(NUMMER_DE, EIGENE_KENNUNG), from: TENANT_A_DID, rueckfallId: GLOBALE_KENNUNG, erwartet: abbruchMit("nummer_weicht_von_from_ab") },
];

test("A8: Weiche auf +1 zwischen eigener und globaler Registrierung, entfällt mit #2459", () => {
  for (const { was, nummer, from, rueckfallId, erwartet } of WEICHE_FAELLE) {
    const { agentPhoneNumberId, quelle, grund } = waehleAbsenderRegistrierung({
      numberRecord: nummer,
      fromE164: from,
      rueckfallId,
    });
    assert.deepEqual({ agentPhoneNumberId, quelle, grund }, erwartet, was);
  }
});
