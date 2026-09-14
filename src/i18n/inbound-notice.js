// Inbound-Pflichthinweis (GAP-14/O7): KI-Hinweis + Transkriptionshinweis als EIN
// gerenderter Teilsatz vor der Begruessung - analog zum Outbound-Offenlegungssatz
// (CLAUDE.md Regel 2) fest verdrahtet, durch kein Setting abschaltbar.
//
// BLATT-MODUL OHNE IMPORTE (bewusst): store/defaults.js baut DEFAULT_GREETING hiermit,
// und i18n/locales.js importiert defaults.js - jeder Rueckimport waere ein Zyklus.
// Die Sprach-Zuordnung (language -> Satz) macht deshalb NICHT dieses Modul, sondern
// das Locale-Bundle (locales.js: inboundNotice), damit der Sprach-Fallback genau EINMAL
// lebt (localeFor) und dem spaeteren Weltdefault-Flip (P10) automatisch folgt.

export const INBOUND_NOTICES = Object.freeze({
  de: "Hinweis: Sie sprechen mit einer KI, das Gespräch wird transkribiert und zusammengefasst.",
  en: "Please note: you are speaking to an AI, and this call is transcribed and summarised.",
  fr: "Information : vous parlez à une IA, cet appel est transcrit et résumé.",
});

// Erkennungs-Staemme statt Voll-Text-Vergleich: ein spaeterer Wortlaut-Wechsel darf ein
// Bestandsgreeting nicht schlagartig "markerlos" machen (sonst stuende der neue Satz VOR
// dem alten - der Doppelsatz aus Pre-Mortem 1). Sprach-Union in EINEM Praedikat, weil ein
// Patch Sprache und Greeting gleichzeitig umstellen darf.
const AI_MARKERS = /\b(ki|ai|ia)\b|assistent|assistant/i;
const TRANSCRIPT_MARKERS = /transkri|transcri|aufgezeichnet|aufzeichnung|mitgeschnitt|enregistr|recorded|recording/i;

// Traegt der Text bereits BEIDE Haelften des Pflichthinweises (KI + Transkription)?
export function hasInboundNotice(text) {
  return typeof text === "string" && AI_MARKERS.test(text) && TRANSCRIPT_MARKERS.test(text);
}

// Stellt den Pflichtsatz voran - NUR wenn er fehlt (idempotent, kein Doppelsatz).
// notice = der sprachrichtige Satz, i.d.R. localeFor(language).inboundNotice.
export function withInboundNotice(text, notice) {
  return hasInboundNotice(text) ? text : `${notice} ${text}`;
}

// IEL-B6 (E1): die Begruessung OHNE fuehrenden Pflichtsatz - der Pflichtsatz ist dann
// bereits gesprochen. Nur ein woertliches Praefix "notice " wird entfernt; Freitext, ein
// Satz ohne Rest oder nur Leerraum dahinter ergeben die GANZE Begruessung (nie leer, eine
// Wiederholung ist akzeptiert).
export function begruessungOhnePflichtsatz({ greeting, notice }) {
  const praefix = `${notice} `;
  const rest = greeting.startsWith(praefix) ? greeting.slice(praefix.length).trim() : "";
  return rest || greeting;
}
