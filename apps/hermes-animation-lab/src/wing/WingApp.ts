import { Application, type Texture } from "pixi.js";
import type {
  DeformGains,
  HermesMotionState,
  HermesStatus,
  PresetId,
} from "../types.js";
import { createState } from "./motionState.js";
import { HermesWing } from "./HermesWing.js";
import { HermesStatusController } from "./status.js";

const MAX_DPR = 2;
const DEFAULT_GROUP_PAUSE = 0.45;

export type WingAppOptions = {
  host: HTMLElement;
  texture: Texture;
  /** Quadratische Canvas-Kante (logisch). Bleibt konstant -> kein Layout-Shift. */
  canvasSize: number;
  /** Anfangs-Anzeigegroesse des Fluegels (skaliert innerhalb des Canvas). */
  displaySize: number;
  preset: PresetId;
  /** false bei prefers-reduced-motion: statischer Fluegel, kein Loop. */
  animate: boolean;
};

/**
 * Ein Pixi-Renderer + ein Fluegel + ein Status. Kapselt Ticker, Sichtbarkeit
 * (IntersectionObserver) und vollstaendiges Teardown. Genau eine Mesh-Instanz.
 */
export class WingApp {
  readonly state: HermesMotionState;

  private app: Application | null = null;
  private wing: HermesWing | null = null;
  private status: HermesStatusController;

  private preset: PresetId;
  private groupPause = DEFAULT_GROUP_PAUSE;
  private intendedPlaying: boolean;
  private inView = true;
  private pageVisible = true;
  private observer: IntersectionObserver | null = null;

  private readonly host: HTMLElement;
  private readonly canvasSize: number;
  private readonly displaySize: number;
  private readonly texture: Texture;
  private readonly tick = (): void => {
    this.wing?.applyState(this.state);
  };

  private constructor(opts: WingAppOptions) {
    this.host = opts.host;
    this.texture = opts.texture;
    this.canvasSize = opts.canvasSize;
    this.displaySize = opts.displaySize;
    this.preset = opts.preset;
    this.intendedPlaying = opts.animate;

    this.state = createState();
    this.status = new HermesStatusController(
      this.state,
      () => this.preset,
      () => this.groupPause,
    );
  }

  static async create(opts: WingAppOptions): Promise<WingApp> {
    const instance = new WingApp(opts);
    await instance.init(opts.animate);
    return instance;
  }

  private async init(animate: boolean): Promise<void> {
    const app = new Application();
    await app.init({
      width: this.canvasSize,
      height: this.canvasSize,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_DPR),
      autoDensity: true,
    });
    this.app = app;
    this.host.appendChild(app.canvas);

    this.wing = new HermesWing(this.texture);
    this.wing.setDisplaySize(this.displaySize);
    this.wing.view.position.set(app.screen.width / 2, app.screen.height / 2);
    app.stage.addChild(this.wing.view);

    app.ticker.add(this.tick);

    // Startzustand: animiert -> working-Loop; sonst statischer Fluegel (idle).
    this.status.set(animate ? "working" : "idle");
    if (!animate) this.intendedPlaying = false;

    this.observeVisibility();
    this.syncRunning();
  }

  private observeVisibility(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.inView = entry.isIntersecting;
        this.syncRunning();
      },
      { threshold: 0.05 },
    );
    this.observer.observe(this.host);
  }

  /** Wird global bei document visibilitychange aufgerufen. */
  setPageVisible(visible: boolean): void {
    this.pageVisible = visible;
    this.syncRunning();
  }

  /** Startet/stoppt Ticker + Timeline nach Sichtbarkeit und Spielabsicht. */
  private syncRunning(): void {
    if (!this.app) return;
    const active = this.inView && this.pageVisible;
    if (active) {
      if (!this.app.ticker.started) this.app.ticker.start();
      if (this.intendedPlaying) this.status.play();
    } else {
      this.status.pause();
      this.app.ticker.stop();
    }
  }

  // --- Steuerung -----------------------------------------------------------

  setStatus(status: HermesStatus): void {
    this.intendedPlaying = status !== "idle";
    this.status.set(status);
    this.syncRunning();
  }

  setPreset(preset: PresetId): void {
    this.preset = preset;
    this.status.rebuild();
    this.syncRunning();
  }

  setGains(patch: Partial<DeformGains>): void {
    this.wing?.setGains(patch);
  }

  setRoot(nx: number, ny: number): void {
    this.wing?.setRoot(nx, ny);
  }

  setRootMarkerVisible(visible: boolean): void {
    this.wing?.setRootMarkerVisible(visible);
  }

  setDisplaySize(px: number): void {
    this.wing?.setDisplaySize(px);
  }

  setGroupPause(seconds: number): void {
    this.groupPause = seconds;
    if (this.status.current === "working") {
      this.status.rebuild();
      this.syncRunning();
    }
  }

  setSpeed(speed: number): void {
    this.state.speed = speed;
    this.status.refreshSpeed();
  }

  setIntensity(intensity: number): void {
    this.state.intensity = intensity;
  }

  setRootRotation(value: number): void {
    this.state.rootRotation = value;
  }

  setRate(rate: number): void {
    this.status.setRate(rate);
  }

  play(): void {
    this.intendedPlaying = true;
    this.syncRunning();
  }

  pause(): void {
    this.intendedPlaying = false;
    this.status.pause();
  }

  restart(): void {
    this.intendedPlaying = true;
    this.status.restart();
    this.syncRunning();
  }

  get currentStatus(): HermesStatus {
    return this.status.current;
  }

  /** Seekt die aktive Timeline auf eine absolute Zeit (fuer Keypose-Capture). */
  seek(time: number): void {
    this.status.timeline?.pause().seek(time, false);
    this.tick();
    this.app?.render();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.status.destroy();
    if (this.app) {
      this.app.ticker.remove(this.tick);
      if (this.wing) this.app.stage.removeChild(this.wing.view);
    }
    this.wing?.destroy();
    this.wing = null;
    // Textur ist geteilt -> nicht mitzerstoeren (texture: false ist Default).
    this.app?.destroy(true);
    this.app = null;
  }
}
