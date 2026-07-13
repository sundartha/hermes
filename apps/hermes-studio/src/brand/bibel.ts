// Studio-Bibel als Code — die EINE Quelle der Wahrheit fuer den Marken-Look.
// Alle Module (Generate, Overlay, Compose) lesen hier ihre Defaults.
// Aenderst du etwas hier, aendert sich das ganze Studio konsistent mit.

/** Hermes-Markenfarben. Gold = Goetterbote, Tiefblau = Olymp/Nacht. */
export const BRAND = {
  gold: "#C9A227",
  goldSoft: "#E6C868",
  deepBlue: "#0B1B2B",
  ink: "#0A0A0A",
  paper: "#FAF7EF",
  white: "#FFFFFF",
} as const;

/** Schrift: ein moderner, klarer Grotesk. Inter ist Default (frei, lesbar). */
export const TYPE = {
  family: "Inter, system-ui, -apple-system, Segoe UI, sans-serif",
  titleWeight: 800,
  bodyWeight: 500,
} as const;

/** Social-Format. Reels/TikTok = vertikal 9:16, 1080x1920. */
export const FORMAT = {
  aspect: "9:16" as const,
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

/** Wie laut/leise der Flügel im Marken-Overlay glaenzt (0 = weiss, 1 = Gold). */
export const WING_LOOK = {
  gold: 0.85,
  shimmer: 0.7,
  preset: "olympian" as const,
} as const;

/** Tonalitaet der Texte: knapp, selbstbewusst, konkret. Kein Hype-Sprech. */
export const VOICE = {
  language: "de" as const,
  tone: "knapp, selbstbewusst, konkret — Founder-Ton, kein Marketing-Sprech",
  signoff: "Hermes — dein Agent ruft an.",
} as const;
