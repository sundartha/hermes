// StudioStage — die Veredelungs-Ebene. Legt den echten Hermes-Fluegel (WingApp
// aus dem Nachbarpaket) als Marken-Overlay ueber einen Higgsfield-Clip und
// faehrt waehrend der Wiedergabe den Status-Bogen (= Anruf-Lebenszyklus) ab.
// Genau EINE Mesh-Instanz, voller Teardown — wie im Lab.

import { Assets, type Texture } from "pixi.js";
import { WingApp } from "../../../hermes-animation-lab/src/wing/WingApp.js";
import { BRAND, WING_LOOK } from "../brand/bibel.js";
import type { StatusBeat } from "../generate/formats.js";

const WING_URL = `${import.meta.env.BASE_URL}hermes-wing.png`;

export type StudioStageOptions = {
  host: HTMLElement;
  /** Canvas-Kante des Overlays (logisch, quadratisch). */
  size: number;
};

export class StudioStage {
  private wing: WingApp | null = null;
  private timers: number[] = [];
  private readonly host: HTMLElement;
  private readonly size: number;

  private constructor(opts: StudioStageOptions) {
    this.host = opts.host;
    this.size = opts.size;
  }

  static async create(opts: StudioStageOptions): Promise<StudioStage> {
    const stage = new StudioStage(opts);
    const texture: Texture = await Assets.load(WING_URL);
    stage.wing = await WingApp.create({
      host: opts.host,
      texture,
      canvasSize: opts.size,
      displaySize: Math.round(opts.size * 0.42),
      preset: WING_LOOK.preset,
      animate: true,
    });
    stage.wing.setGold(WING_LOOK.gold);
    stage.wing.setShimmer(WING_LOOK.shimmer);
    stage.wing.setStatus("idle");
    return stage;
  }

  /** Setzt den Fluegel auf einen Status (idle/connecting/working/success/error). */
  setStatus(status: StatusBeat["status"]): void {
    this.wing?.setStatus(status);
  }

  /**
   * Faehrt einen Status-Bogen zeitgesteuert ab (Sekunden -> Status). So erzaehlt
   * der Fluegel die Anruf-Story synchron zum Clip: verbinden -> sprechen -> fertig.
   */
  runArc(arc: StatusBeat[]): void {
    this.clearTimers();
    for (const beat of arc) {
      const id = window.setTimeout(() => this.setStatus(beat.status), beat.at * 1000);
      this.timers.push(id);
    }
  }

  /** Markenfarbe fuer den Overlay-Hintergrund (Tiefblau/Olymp). */
  get backdrop(): string {
    return BRAND.deepBlue;
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
  }

  destroy(): void {
    this.clearTimers();
    this.wing?.destroy();
    this.wing = null;
  }
}
