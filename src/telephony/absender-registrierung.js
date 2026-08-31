// OUTBOUND-E5 (F3): die EINE Antwort auf "welche ElevenLabs-Registrierung gehoert zu diesem
// Anruf?". REIN: Eingabe = Nummern-Datensatz + gebuchte Absendernummer + globaler Rueckfall,
// Ausgabe = Kennung + Herkunft + Grund. Kein Netz, kein store, kein config, kein Date.now -
// das ANLEGEN einer Registrierung ist strikt davon getrennt (elevenlabs/nummern-registrierung.js).
//
// WARUM DIE PRUEFUNG numberRecord.e164 === fromE164 LOAD-BEARING IST: der Datensatz kommt aus
// einer TENANT-GEFILTERTEN Lesung (views.js#findActiveNumber, dieselbe Quelle wie
// resolve_outbound), und diese Gleichheit pinnt zusaetzlich, dass es GENAU die Nummer ist, die
// am Anruf als from_e164 gebucht wurde. Eine fremde Registrierung ist damit auf zwei
// unabhaengigen Wegen unerreichbar - Tenant-Filter UND E.164-Identitaet. Strikte
// String-Gleichheit, kein Praefix, kein Fuzzy, keine Normalisierung hier (die ist vorgelagert
// und geteilt: normalize_target / normalizePrivateNumber).
export const ABSENDER_QUELLE = Object.freeze({
  TENANT_DID: "tenant_did",
  RUECKFALL_GLOBAL: "rueckfall_global",
});

// Warum der Rueckfall greift - PII-frei (nie eine Rufnummer, nie eine Tenant-Kennung).
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
