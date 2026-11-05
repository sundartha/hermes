export const ABSENDER_QUELLE = Object.freeze({
  TENANT_DID: "tenant_did",
  RUECKFALL_GLOBAL: "rueckfall_global",
  ABGEBROCHEN: "abgebrochen",
});

export const ABSENDER_GRUND = Object.freeze({
  KEINE_NUMMER: "keine_aktive_nummer",
  NUMMER_WEICHT_AB: "nummer_weicht_von_from_ab",
  KEINE_REGISTRIERUNG: "keine_eigene_registrierung",
  KEINE_GLOBALE_REGISTRIERUNG: "keine_globale_registrierung",
});

const US_VORWAHL = "+1";

function abbruch(grund) {
  return {
    agentPhoneNumberId: null,
    e164: null,
    quelle: ABSENDER_QUELLE.ABGEBROCHEN,
    grund,
  };
}

function voruebergehenderRueckfallBisNurUsNummern({ numberRecord, rueckfallId }) {
  if (numberRecord.e164.startsWith(US_VORWAHL)) return null;
  if (!rueckfallId) return abbruch(ABSENDER_GRUND.KEINE_GLOBALE_REGISTRIERUNG);
  return {
    agentPhoneNumberId: rueckfallId,
    e164: null,
    quelle: ABSENDER_QUELLE.RUECKFALL_GLOBAL,
    grund: null,
  };
}

export function waehleAbsenderRegistrierung({ numberRecord, fromE164, rueckfallId }) {
  if (!numberRecord) return abbruch(ABSENDER_GRUND.KEINE_NUMMER);
  if (numberRecord.e164 !== fromE164) return abbruch(ABSENDER_GRUND.NUMMER_WEICHT_AB);
  const rueckfall = voruebergehenderRueckfallBisNurUsNummern({ numberRecord, rueckfallId });
  if (rueckfall) return rueckfall;
  if (!numberRecord.providerAgentPhoneNumberId) return abbruch(ABSENDER_GRUND.KEINE_REGISTRIERUNG);
  return {
    agentPhoneNumberId: numberRecord.providerAgentPhoneNumberId,
    e164: numberRecord.e164,
    quelle: ABSENDER_QUELLE.TENANT_DID,
    grund: null,
  };
}
