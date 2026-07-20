import type { DeformGains, HermesMotionState } from "../types.js";

// --- Verformungs-Gains (benannte Konstanten, keine Magic Numbers) ---------
// Alle Winkel in Radiant. Die Werte definieren den Charakter der Bewegung bei
// state-Wert 1 und Gewicht 1; die Presets bleiben damit klein und lesbar.

/**
 * Schlagwinkel des GANZEN Fluegels pro Einheit `beat` (starre Rotation um den
 * Root, ungewichtet). ~0.33 rad (~19 Grad) bei beat 1 -> deutlich sichtbarer
 * Wing-Beat, der die Silhouette traegt, statt nur die Spitzen zu zucken.
 */
const BEAT_GAIN = 0.33;
/** Max. Schlagwinkel der aussersten Federn pro Einheit `flap`. */
const FLAP_GAIN = 0.26;
/** Zusaetzliche Kruemmung an den Spitzen pro Einheit `bend` (gewichtet mit w^2). */
const BEND_GAIN = 0.24;
/** Verzoegertes Nachschwingen der Spitzen pro Einheit `tipLag`. */
const TIPLAG_GAIN = 0.22;
/** Gesamtneigung um den Root pro Einheit `rootRotation`. */
const ROOT_ROT_GAIN = 0.22;
/** Radiale Stauchung (Anteil) pro Einheit `compression` an der Spitze. */
const COMPRESS_GAIN = 0.28;
/** Untergrenze des Stauchungsfaktors, damit der Fluegel nie kollabiert. */
const MIN_COMPRESS_FACTOR = 0.55;
/**
 * Kopffreiheit bei der Gewichts-Normierung: die sichtbaren Federspitzen sollen
 * w ~ 1 erreichen, obwohl die (unsichtbaren) Quad-Ecken etwas weiter weg liegen.
 */
const NORMALIZE_HEADROOM = 0.85;
/**
 * Exponent der Gewichtskurve (>1 verschiebt Bewegung zu den Spitzen). Haelt den
 * inneren Fluegel/Koerper ruhig und laesst nur die langen Aussenfedern flicken
 * -> kompakter Cartoon-Flatter statt grossem Vogelschlag.
 */
const WEIGHT_EXPONENT = 1.7;
/** Untergrenze, ab der Spitzen-Lag greift (isoliert die langen Aussenfedern). */
const TIP_BAND_START = 0.45;

/**
 * Vorberechnete, root-relative Geometrie. `original` bleibt unveraendert; jeder
 * Frame wird von hier aus neu gerechnet (kein schleichendes Verformen).
 */
export type DeformContext = {
  /** Originale Vertex-Positionen [x0,y0,x1,y1,...] in lokalen Textur-Pixeln. */
  readonly original: Float32Array;
  /** Gewicht je Vertex (Root ~ 0, Spitzen ~ 1). */
  readonly weights: Float32Array;
  /** Spitzen-Gewicht je Vertex (nur die langen Aussenfedern > 0). */
  readonly weightsTip: Float32Array;
  /** Root-Punkt in lokalen Textur-Pixeln. */
  readonly rootX: number;
  readonly rootY: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Berechnet Gewichte fuer eine gegebene Geometrie + Root. Muss neu aufgerufen
 * werden, wenn sich der Root verschiebt.
 */
export function buildWeights(
  original: Float32Array,
  rootX: number,
  rootY: number,
): { weights: Float32Array; weightsTip: Float32Array } {
  const count = original.length / 2;
  const weights = new Float32Array(count);
  const weightsTip = new Float32Array(count);

  let maxDist = 0;
  for (let i = 0; i < count; i++) {
    const dx = original[i * 2]! - rootX;
    const dy = original[i * 2 + 1]! - rootY;
    const d = Math.hypot(dx, dy);
    if (d > maxDist) maxDist = d;
  }
  const norm = maxDist * NORMALIZE_HEADROOM || 1;

  for (let i = 0; i < count; i++) {
    const dx = original[i * 2]! - rootX;
    const dy = original[i * 2 + 1]! - rootY;
    const raw = Math.min(1, Math.hypot(dx, dy) / norm);
    const w = Math.pow(raw, WEIGHT_EXPONENT);
    weights[i] = w;
    weightsTip[i] = smoothstep(TIP_BAND_START, 1, raw);
  }
  return { weights, weightsTip };
}

/**
 * Schreibt die verformten Positionen deterministisch nach `out`.
 * Modell: jeder Vertex rotiert um den gemeinsamen Root um einen gewichteten
 * Winkel (kontinuierliches Gewicht -> zusammenhaengende, gekruemmte Flaeche)
 * und wird radial gestaucht. Bei Ruhe (alle Werte 0, intensity 1) ist out
 * byte-gleich zur Originalgeometrie.
 */
export function deform(
  ctx: DeformContext,
  state: HermesMotionState,
  gains: DeformGains,
  out: Float32Array,
): void {
  const { original, weights, weightsTip, rootX, rootY } = ctx;
  const count = original.length / 2;
  const amp = state.intensity;

  // rootRotation wirkt uniform (bewusste Gesamtneigung, von intensity unabhaengig).
  const baseAngle = state.rootRotation * ROOT_ROT_GAIN * gains.rootRotation;

  for (let i = 0; i < count; i++) {
    const w = weights[i]!;
    const wTip = weightsTip[i]!;

    const angle =
      baseAngle +
      amp *
        (state.beat * BEAT_GAIN +
          state.flap * FLAP_GAIN * w +
          state.bend * BEND_GAIN * gains.bend * w * w +
          state.tipLag * TIPLAG_GAIN * gains.tipLag * wTip);

    const compressFactor = Math.max(
      MIN_COMPRESS_FACTOR,
      1 - state.compression * COMPRESS_GAIN * gains.compression * amp * w,
    );

    const dx = (original[i * 2]! - rootX) * compressFactor;
    const dy = (original[i * 2 + 1]! - rootY) * compressFactor;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    out[i * 2] = rootX + (dx * cos - dy * sin);
    out[i * 2 + 1] = rootY + (dx * sin + dy * cos);
  }
}
