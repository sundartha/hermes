// Zentrale Typen fuer das Hermes Animation Lab.
// Eine einzige Bewegungs-Zustandsform, die GSAP animiert; die Deformation liest
// sie pro Frame deterministisch aus (kein Zufall, kein Akkumulieren).

/**
 * Animierter Bewegungs-Zustand des Fluegels.
 * Alle Felder sind dimensionslos und werden in der Deformation gewichtet
 * (siehe deform.ts). `intensity` und `speed` sind global.
 */
export type HermesMotionState = {
  /**
   * Ganzer-Fluegel-Schlag um die Schulter (Root), typ. -1.5..0.5. Rotiert ALLE
   * Vertices STARR um den Root (ungewichtet) -> klar lesbarer Wing-Beat statt
   * nur Federspitzen-Flattern. Negativ = Fluegel hebt/holt aus (Aufschlag),
   * positiv = sweept runter (Abschlag). Mit intensity skaliert.
   */
  beat: number;
  /** Hauptschlag-Phase, typ. -0.3..1. Treibt die Rotation um den Root (gewichtet). */
  flap: number;
  /** Kruemmung entlang der Fluegellaenge (Biegung wie eine biegende Klinge), typ. 0..1. */
  bend: number;
  /** Stauchung/Verkuerzung entlang der Laengsachse (Foreshortening), typ. 0..1. */
  compression: number;
  /** Verzoegertes elastisches Nachschwingen der Federspitzen, typ. -1..1. */
  tipLag: number;
  /**
   * Vertikaler Auftrieb des GANZEN Fluegels (Schweben), typ. -1..1.
   * Positiv = hebt sich (steigt), negativ = sinkt. Wird NICHT pro Vertex
   * gerechnet, sondern als Gesamt-Versatz des Fluegels appliziert
   * (siehe HermesWing.applyState) -> Flatter erzeugt sichtbaren Auftrieb.
   */
  lift: number;
  /** Kleine Gesamtneigung des ganzen Fluegels um den Root, typ. -1..1. */
  rootRotation: number;
  /** Globaler Amplituden-Multiplikator, typ. 0..2 (Ruhe: 1). */
  intensity: number;
  /** GSAP timeScale (1 = normal). */
  speed: number;
};

/** Oeffentliche Status-API (Vorbereitung; noch nicht an MCP verdrahtet). */
export type HermesStatus =
  | "idle"
  | "connecting"
  | "working"
  | "success"
  | "error";

/** Die Bewegungsvarianten. */
export type PresetId = "classic" | "rapid" | "premium" | "olympian";

/**
 * Authoring-Gains: skalieren die Beitraege der jeweiligen Kanaele in der
 * Deformation. Default 1 = Preset wie entworfen. Reine Regler-Steuerung,
 * getrennt vom animierten Zustand, damit die Animation nicht ueberschrieben wird.
 */
export type DeformGains = {
  bend: number;
  compression: number;
  tipLag: number;
  rootRotation: number;
};

export const DEFAULT_GAINS: DeformGains = {
  bend: 1,
  compression: 1,
  tipLag: 1,
  rootRotation: 1,
};
