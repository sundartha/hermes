import {
  Container,
  Graphics,
  MeshPlane,
  type ColorMatrixFilter,
  type Texture,
} from "pixi.js";
import {
  DEFAULT_GAINS,
  type DeformGains,
  type HermesMotionState,
} from "../types.js";
import { buildWeights, deform, type DeformContext } from "./deform.js";
import { applyGold, createGoldFilter, HERMES_GOLD } from "./aura.js";

// Sichtbare Fluegel-Bounding-Box in Textur-Pixeln (aus der Alpha-Analyse der
// 500x500-Quelle: x[97..404] y[21..455]). Dient dem passgenauen Zentrieren und
// Skalieren, damit der Fluegel auch bei 48 px formatfuellend bleibt.
const WING_BBOX = { minX: 97, maxX: 404, minY: 21, maxY: 455 } as const;
const WING_CENTER_X = (WING_BBOX.minX + WING_BBOX.maxX) / 2;
const WING_CENTER_Y = (WING_BBOX.minY + WING_BBOX.maxY) / 2;
const WING_FIT =
  Math.max(WING_BBOX.maxX - WING_BBOX.minX, WING_BBOX.maxY - WING_BBOX.minY) /
  0.92; // 8% Rand

/** Default-Root: untere linke Fluegelwurzel (normiert 0..1 in Texturkoordinaten). */
export const DEFAULT_ROOT = { x: 0.23, y: 0.88 } as const;

const SEGMENTS_X = 16;
const SEGMENTS_Y = 24;

const MARKER_RADIUS_PX = 9;
const MARKER_COLOR = 0xe60000;

/**
 * Vertikaler Auftrieb in Textur-Pixeln pro Einheit `lift` (positiv = hebt sich).
 * ~7% der sichtbaren Fluegelhoehe -> deutlich spuerbares Schweben, ohne den
 * Fluegel aus dem Canvas zu schieben. Skaliert mit displaySize (Textur-Raum).
 */
const LIFT_GAIN_PX = 30;

// --- Goettlicher Lichtpuls -------------------------------------------------
/** Helligkeits-Anteil pro Einheit `flap` im Kraftschlag (Gold leuchtet auf). */
const SHIMMER_FLAP = 0.32;
/** Helligkeits-Anteil pro Einheit `lift` (Schweben glaenzt sanft mit). */
const SHIMMER_LIFT = 0.1;

// --- Ambient-Schweben (Dauerleben) -----------------------------------------
// Sehr kleine, IMMER laufende Drift des GANZEN Fluegels (kein Deform, kein
// zweiter Layer): horizontal/vertikal versetzte Sinusse + minimale Neigung
// erzeugen ein hypnotisches Schweben, das die Animation "satisfying" haelt,
// auch zwischen den Schlaegen. Amplituden in Textur-Pixeln bzw. Radiant.
const AMBIENT_X_PX = 5;
const AMBIENT_Y_PX = 9;
const AMBIENT_ROT = 0.022;

/**
 * Kapselt genau EINEN Fluegel: eine Textur auf einem MeshPlane. Keine Klone,
 * Spiegelungen, Trails oder zweiten Ebenen. Verformt deterministisch ueber
 * `applyState` und raeumt sich bei `destroy` vollstaendig ab.
 */
export class HermesWing {
  /** In den Stage-Container einzuhaengen; von aussen zentriert. */
  readonly view: Container;

  private readonly holder: Container;
  private readonly mesh: MeshPlane;
  private readonly marker: Graphics;
  private readonly positionBuffer: ReturnType<MeshPlane["geometry"]["getBuffer"]>;
  private readonly original: Float32Array;
  private readonly live: Float32Array;
  private readonly texW: number;
  private readonly texH: number;

  private ctx!: DeformContext;
  private gains: DeformGains = { ...DEFAULT_GAINS };
  private rootNorm: { x: number; y: number } = { ...DEFAULT_ROOT };

  // Goettlicher Gold-Look + Schweben (Default aus -> exakt originaler Fluegel).
  private readonly goldFilter: ColorMatrixFilter = createGoldFilter();
  private goldStrength = 0;
  private goldColor = HERMES_GOLD;
  private shimmer = 0;
  private ambient = false;
  private readonly clockStart = performance.now();

  constructor(texture: Texture) {
    this.texW = texture.width;
    this.texH = texture.height;

    this.mesh = new MeshPlane({
      texture,
      verticesX: SEGMENTS_X + 1,
      verticesY: SEGMENTS_Y + 1,
    });

    // Gold als Post-Processing auf demselben Mesh (kein zweiter Layer).
    this.mesh.filters = [this.goldFilter];

    this.positionBuffer = this.mesh.geometry.getBuffer("aPosition");
    this.live = this.positionBuffer.data as Float32Array;
    this.original = this.live.slice();

    this.marker = new Graphics()
      .circle(0, 0, MARKER_RADIUS_PX)
      .fill({ color: MARKER_COLOR, alpha: 0.9 });
    this.marker.visible = false;

    // holder traegt Mesh + Marker und schiebt das Fluegel-Zentrum in den Ursprung.
    this.holder = new Container();
    this.holder.position.set(-WING_CENTER_X, -WING_CENTER_Y);
    this.holder.addChild(this.mesh, this.marker);

    this.view = new Container();
    this.view.addChild(this.holder);

    this.setRoot(this.rootNorm.x, this.rootNorm.y);
    this.setDisplaySize(WING_FIT);
  }

  /** Setzt den Root (normiert 0..1), rechnet Gewichte + Marker neu. */
  setRoot(nx: number, ny: number): void {
    this.rootNorm = { x: nx, y: ny };
    const rootX = nx * this.texW;
    const rootY = ny * this.texH;
    const { weights, weightsTip } = buildWeights(this.original, rootX, rootY);
    this.ctx = { original: this.original, weights, weightsTip, rootX, rootY };
    this.marker.position.set(rootX, rootY);
  }

  setGains(patch: Partial<DeformGains>): void {
    this.gains = { ...this.gains, ...patch };
  }

  setRootMarkerVisible(visible: boolean): void {
    this.marker.visible = visible;
  }

  /**
   * Gold-Staerke 0..1 (0 = originaler weisser Fluegel, 1 = volles Hermes-Gold).
   * Optionale Tint-Farbe ueberschreibt das Default-Gold.
   */
  setGold(strength: number, color?: number): void {
    this.goldStrength = strength;
    if (color !== undefined) this.goldColor = color;
  }

  /** Staerke des bewegungsgetriebenen Lichtpulses 0..~1.5 (0 = aus). */
  setShimmer(amount: number): void {
    this.shimmer = amount;
  }

  /** Schaltet das permanente, sehr sanfte Ambient-Schweben an/aus. */
  setAmbient(on: boolean): void {
    this.ambient = on;
  }

  /** Skaliert den Fluegel uniform auf eine Zielkante (in CSS-Pixeln). */
  setDisplaySize(px: number): void {
    this.view.scale.set(px / WING_FIT);
  }

  /** Verformt das Mesh deterministisch aus dem aktuellen Zustand. */
  applyState(state: HermesMotionState): void {
    // Auftrieb als Gesamt-Versatz: hebt/senkt den ganzen Fluegel relativ zum
    // Zentrum. Positiv = nach oben (kleinere y). Skaliert mit intensity, damit
    // der Regler das Schweben mitnimmt. Bei lift=0 byte-gleich zur Ruhepose.
    const liftPx = state.lift * LIFT_GAIN_PX * state.intensity;

    // Ambient-Schweben: minimaler, immer laufender Versatz des ganzen Fluegels
    // (kein Deform). Aus, wenn ambient=false -> byte-gleiche Ruhepose moeglich.
    let ax = 0;
    let ay = 0;
    let sway = 0;
    if (this.ambient) {
      const t = (performance.now() - this.clockStart) / 1000;
      ax = Math.sin(t * 0.9) * AMBIENT_X_PX;
      ay = Math.sin(t * 1.7 + 1.3) * AMBIENT_Y_PX;
      sway = Math.sin(t * 0.6) * AMBIENT_ROT;
    }
    this.holder.position.set(
      -WING_CENTER_X + ax,
      -WING_CENTER_Y - liftPx + ay,
    );
    this.view.rotation = sway;

    // Goettlicher Lichtpuls: der Kraftschlag (flap) laesst das Gold kurz heller
    // aufleuchten, das Schweben (lift) glaenzt sanft mit. Deterministisch aus
    // dem State -> kein Akkumulieren.
    const pulse =
      this.shimmer *
      (Math.max(0, state.flap) * SHIMMER_FLAP +
        Math.max(0, state.lift) * SHIMMER_LIFT) *
      state.intensity;
    applyGold(this.goldFilter, this.goldStrength, pulse, this.goldColor);

    deform(this.ctx, state, this.gains, this.live);
    this.positionBuffer.update();
  }

  destroy(): void {
    // Textur gehoert dem Aufrufer (geteilt) -> nicht mitzerstoeren.
    this.marker.destroy();
    this.mesh.destroy();
    this.goldFilter.destroy();
    this.view.destroy({ children: true });
  }
}
