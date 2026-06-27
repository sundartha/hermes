import { Container, Graphics, MeshPlane, type Texture } from "pixi.js";
import {
  DEFAULT_GAINS,
  type DeformGains,
  type HermesMotionState,
} from "../types.js";
import { buildWeights, deform, type DeformContext } from "./deform.js";

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

  constructor(texture: Texture) {
    this.texW = texture.width;
    this.texH = texture.height;

    this.mesh = new MeshPlane({
      texture,
      verticesX: SEGMENTS_X + 1,
      verticesY: SEGMENTS_Y + 1,
    });

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
    this.holder.position.set(-WING_CENTER_X, -WING_CENTER_Y - liftPx);

    deform(this.ctx, state, this.gains, this.live);
    this.positionBuffer.update();
  }

  destroy(): void {
    // Textur gehoert dem Aufrufer (geteilt) -> nicht mitzerstoeren.
    this.marker.destroy();
    this.mesh.destroy();
    this.view.destroy({ children: true });
  }
}
