export const ABSENDER_QUELLE = Object.freeze({
  TENANT_DID: "tenant_did",
  RUECKFALL_GLOBAL: "rueckfall_global",
});

export const RUECKFALL_GRUND = Object.freeze({
  KEINE_NUMMER: "keine_aktive_nummer",
  NUMMER_WEICHT_AB: "nummer_weicht_von_from_ab",
  KEINE_REGISTRIERUNG: "keine_eigene_registrierung",
});

export function waehleAbsenderRegistrierung({ numberRecord, fromE164, rueckfallId }) {
  const rueckfall = (grund) => ({
    agentPhoneNumberId: rueckfallId,
    e164: null,
    quelle: ABSENDER_QUELLE.RUECKFALL_GLOBAL,
    grund,
  });
  if (!numberRecord) return rueckfall(RUECKFALL_GRUND.KEINE_NUMMER);
  if (numberRecord.e164 !== fromE164) return rueckfall(RUECKFALL_GRUND.NUMMER_WEICHT_AB);
  if (!numberRecord.providerAgentPhoneNumberId)
    return rueckfall(RUECKFALL_GRUND.KEINE_REGISTRIERUNG);
  return {
    agentPhoneNumberId: numberRecord.providerAgentPhoneNumberId,
    e164: numberRecord.e164,
    quelle: ABSENDER_QUELLE.TENANT_DID,
    grund: null,
  };
}
