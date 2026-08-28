// OUTBOUND-E4 Review-Blocker (G5): die "soll"- und Schwellen-Projektion aus config stand
// woertlich zweimal da - einmal in outbound-drift-watch.js (In-Prozess-Waechter), einmal
// in scripts/check-outbound-drift.mjs (externer CLI-Weg). EIN zehntes Pruef-Feld haette
// kuenftig an zwei Stellen ergaenzt werden muessen; vergisst man eine, misst der CLI-Weg
// still etwas anderes als der In-Prozess-Waechter - bei einer Drift-Erkennung ist genau
// das der Fehler, der nicht auffaellt. EINE Quelle statt zwei (G5).
//
// Reine Funktionen (kein Netz, kein store, kein Date.now) - der Store-abhaengige Rest
// (alertSenderE164, verbrauch24hMicroCents, letzteErfolgreicheMessungMs) bleibt beim
// jeweiligen Aufrufer, weil nur outbound-drift-watch.js einen Store hat (Plan D-5).

// Bekannte Praefix->ISO-Zuordnung (Deviation: nur die drei heute betriebenen Laender,
// Plan E-6 Pruefung 7). "*" oder eine nicht gelistete Vorwahl macht die Menge
// UNBESTIMMBAR - leere Liste, der Kern meldet das dann als unbekannt:pruefung7 statt
// eines Fehlalarms auf einer geratenen Menge.
const PREFIX_ISO = Object.freeze({ "+49": "DE", "+33": "FR", "+44": "GB" });

export function bedienteLaenderAus(allowedCountryCodes) {
  const codes = Array.isArray(allowedCountryCodes) ? allowedCountryCodes : [];
  const iso = [];
  for (const praefix of codes) {
    const land = PREFIX_ISO[praefix];
    if (!land) return [];
    iso.push(land);
  }
  return iso;
}

// Die sechs Felder, die BEIDE Wege (In-Prozess + CLI) identisch aus config ableiten -
// der Aufrufer ergaenzt seine eigenen, store-abhaengigen Felder (alertSenderE164,
// verbrauch24hMicroCents, letzteErfolgreicheMessungMs) selbst.
export function sollAusConfig(config) {
  return {
    elAgentId: config.voice.elevenLabsOutbound.agentId,
    elPhoneNumberId: config.voice.elevenLabsOutbound.agentPhoneNumberId,
    platformAniE164: config.provisioning.platformAniE164,
    fqdnConnectionId: config.telephony.telnyxFqdnConnectionId,
    ovpId: config.telephony.telnyxOutboundVoiceProfileId,
    bedienteLaender: bedienteLaenderAus(config.safety.allowedCountryCodes),
  };
}

export function schwellenAusConfig(config) {
  return { staleMs: config.billing.outboundDriftStaleMs, balanceMinHours: config.billing.outboundDriftBalanceMinHours };
}
