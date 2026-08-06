// Neutrale Wahl der Spracherkennungs-Engine - EIN Enum, pro Adapter uebersetzt.
// Muster: VOICE_PROFILE (directives.js) + voice-locale.js. Rein: kein IO, kein
// config-Import (config.js importiert dieses Modul, nicht umgekehrt).
//
// Das Profil benennt die ABSICHT - nicht den Hersteller, nicht die Generation und
// ausdruecklich NICHT die Sprache. Die Sprachwahl bleibt, wo sie ist: der TeXML-Gather
// sendet volles BCP-47 ("de-DE", aus dem Locale-Buendel), der Call-Control-Assistant den
// blanken Code ("de", STT_LANGUAGE_HINTS im Telnyx-Voice-Adapter). Beide Formen sind
// einzeln an echten Provider-Belegen gemessen und BEWUSST verschieden - dieses Modul
// nimmt deshalb kein Sprach-Argument entgegen und exportiert nichts Sprach-Foermiges.
// Braucht es eines, ist die Naht falsch gezogen.
//
// Heute genau EIN Mitglied, und das ist Absicht: deepgram/flux als zweites Mitglied waere
// ein Enum-Eintrag fuer einen empirisch disqualifizierten Wert (95,7 % / 97,0 % Wortfehler-
// rate auf deutschem Telefon-Audio, Befund B-7). Den Nutzen traegt die Uebersetzungstabelle
// je Adapter, nicht die Laenge der Aufzaehlung.
export const STT_PROFILE = Object.freeze({
  ACCURATE: "accurate", // hoechste verfuegbare mehrsprachige Erkennungsgenauigkeit
});

// EINE Quelle des Defaults: der Env-Fallback in config.js, der arg-lose Renderer-Aufruf
// und der Boot-Guard lesen ihn hier - nicht je eine eigene Kopie des Wertes.
export const DEFAULT_STT_PROFILE = STT_PROFILE.ACCURATE;

export function isSttProfile(value) {
  return Object.values(STT_PROFILE).includes(value);
}
