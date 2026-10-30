export const ABSENDER_QUELLE = Object.freeze({
  TENANT_DID: "tenant_did",
  ABGEBROCHEN: "abgebrochen",
});

export const ABSENDER_GRUND = Object.freeze({
  KEINE_NUMMER: "keine_aktive_nummer",
  NUMMER_WEICHT_AB: "nummer_weicht_von_from_ab",
  KEINE_REGISTRIERUNG: "keine_eigene_registrierung",
});

export function waehleAbsenderRegistrierung({ numberRecord, fromE164 }) {
  const abbruch = (grund) => ({
    agentPhoneNumberId: null,
    e164: null,
    quelle: ABSENDER_QUELLE.ABGEBROCHEN,
    grund,
  });
  if (!numberRecord) return abbruch(ABSENDER_GRUND.KEINE_NUMMER);
  if (numberRecord.e164 !== fromE164) return abbruch(ABSENDER_GRUND.NUMMER_WEICHT_AB);
  if (!numberRecord.providerAgentPhoneNumberId) return abbruch(ABSENDER_GRUND.KEINE_REGISTRIERUNG);
  return {
    agentPhoneNumberId: numberRecord.providerAgentPhoneNumberId,
    e164: numberRecord.e164,
    quelle: ABSENDER_QUELLE.TENANT_DID,
    grund: null,
  };
}
