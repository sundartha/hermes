export const ABSENDER_QUELLE = Object.freeze({
  TENANT_DID: "tenant_did",
  ABGEBROCHEN: "abgebrochen",
});

export const ABSENDER_GRUND = Object.freeze({
  KEINE_NUMMER: "keine_aktive_nummer",
  NUMMER_WEICHT_AB: "nummer_weicht_von_from_ab",
  KEINE_REGISTRIERUNG: "keine_eigene_registrierung",
});

interface Absender {
  agentPhoneNumberId: string | null;
  e164: string | null;
  quelle: string;
  grund: string | null;
}

function abbruch(grund: string): Absender {
  return {
    agentPhoneNumberId: null,
    e164: null,
    quelle: ABSENDER_QUELLE.ABGEBROCHEN,
    grund,
  };
}

export function waehleAbsenderRegistrierung({
  numberRecord,
  fromE164,
}: {
  numberRecord: { e164: string; providerAgentPhoneNumberId?: string | null } | null | undefined;
  fromE164: string;
}): Absender {
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
