import gsap from "gsap";
import type { HermesMotionState, HermesStatus, PresetId } from "../types.js";
import { PRESETS } from "./presets.js";

// Verwaltet GENAU EINE aktive Timeline. Jeder Statuswechsel killt die alte
// sauber (kein Overlap) und baut die neue. Transport (play/pause/restart/rate)
// und der speed-Regler wirken auf die jeweils aktive Timeline.

// Nur die ANIMIERTEN Kanaele. rootRotation bleibt als statischer Tilt erhalten.
const REST_CHANNELS = {
  flap: 0,
  bend: 0,
  compression: 0,
  tipLag: 0,
  lift: 0,
} as const;

const SETTLE_DURATION = 0.3;

// idle-Schweben: sehr kleine Amplitude, lange Dauer -> beruhigtes Atmen/Floaten,
// das nie aufdringlich wird. yoyo zwischen Ruhe und diesen Werten.
const IDLE_HOVER_LIFT = 0.22;
const IDLE_HOVER_FLAP = 0.07;
const IDLE_HOVER_BEND = 0.06;
const IDLE_HOVER_DURATION = 1.7;

export class HermesStatusController {
  private tl: gsap.core.Timeline | null = null;
  private status: HermesStatus = "idle";
  private rate = 1;

  constructor(
    private readonly state: HermesMotionState,
    private readonly getPreset: () => PresetId,
    private readonly getGroupPause: () => number,
  ) {}

  get current(): HermesStatus {
    return this.status;
  }

  get timeline(): gsap.core.Timeline | null {
    return this.tl;
  }

  /** Wechselt den Status: alte Timeline killen, neue bauen und starten. */
  set(status: HermesStatus): void {
    this.tl?.kill();
    this.status = status;
    this.tl = this.build(status);
    if (this.tl) {
      this.applyRate();
      this.tl.play(0);
    }
  }

  /** Baut den aktuellen Status neu (z.B. wenn Preset/Pause sich aenderte). */
  rebuild(): void {
    this.set(this.status);
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.applyRate();
  }

  /** Nach Aenderung von state.speed aufrufen. */
  refreshSpeed(): void {
    this.applyRate();
  }

  play(): void {
    this.tl?.play();
  }

  pause(): void {
    this.tl?.pause();
  }

  restart(): void {
    this.tl?.restart();
    this.applyRate();
  }

  destroy(): void {
    this.tl?.kill();
    this.tl = null;
  }

  private applyRate(): void {
    this.tl?.timeScale(Math.max(0.01, this.state.speed * this.rate));
  }

  private build(status: HermesStatus): gsap.core.Timeline | null {
    switch (status) {
      case "working":
        return PRESETS[this.getPreset()](this.state, this.getGroupPause());
      case "idle":
        return this.buildIdle();
      case "connecting":
        return this.buildConnecting();
      case "success":
        return this.buildSuccess();
      case "error":
        return this.buildError();
    }
  }

  // idle: kein toter Stillstand, sondern ein sehr sanftes Dauer-Schweben wie
  // ein in der Luft stehender Fluegel (geflügelte Sandale flattert immer leise).
  // Erst weich aus dem vorigen Status zur Schwebe-Mitte, dann endlos yoyo.
  private buildIdle(): gsap.core.Timeline {
    return gsap
      .timeline({ paused: true })
      .to(this.state, {
        ...REST_CHANNELS,
        duration: SETTLE_DURATION,
        ease: "power2.out",
      })
      .to(
        this.state,
        {
          lift: IDLE_HOVER_LIFT,
          flap: IDLE_HOVER_FLAP,
          bend: IDLE_HOVER_BEND,
          duration: IDLE_HOVER_DURATION,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        },
      );
  }

  // connecting: zwei kurze, vorsichtige Schlaege, dann Ruhe.
  private buildConnecting(): gsap.core.Timeline {
    const tl = gsap.timeline({ paused: true }).set(this.state, { ...REST_CHANNELS });
    for (let i = 0; i < 2; i++) {
      tl.to(this.state, { flap: 0.4, bend: 0.25, compression: 0.16, lift: 0.2, duration: 0.1, ease: "power2.out" })
        .to(this.state, { flap: 0, bend: 0.05, compression: 0.02, lift: 0.05, duration: 0.13, ease: "power2.in" })
        .to(this.state, {}, "+=0.08");
    }
    tl.to(this.state, { ...REST_CHANNELS, duration: 0.15, ease: "power2.out" });
    return tl;
  }

  // success: schneller Aufwaerts-Schnapp mit kraeftigem Auftrieb (springt hoch),
  // kleines Ueberschwingen, dann elastisch zurueck zur Ruhe.
  private buildSuccess(): gsap.core.Timeline {
    return gsap
      .timeline({ paused: true })
      .set(this.state, { ...REST_CHANNELS })
      .to(this.state, { flap: 1, bend: 0.5, compression: 0.4, tipLag: 0.5, lift: 0.85, duration: 0.1, ease: "power4.out" })
      .to(this.state, { ...REST_CHANNELS, duration: 0.5, ease: "elastic.out(1,0.4)" });
  }

  // error: kurze stockende Bewegung, danach leicht abgesenkte Endpose.
  private buildError(): gsap.core.Timeline {
    return gsap
      .timeline({ paused: true })
      .set(this.state, { ...REST_CHANNELS })
      .to(this.state, { flap: 0.2, duration: 0.05, ease: "power1.out" })
      .to(this.state, { flap: -0.1, duration: 0.05, ease: "power1.inOut" })
      .to(this.state, { flap: 0.12, duration: 0.05, ease: "power1.inOut" })
      .to(this.state, { flap: -0.08, duration: 0.05, ease: "power1.inOut" })
      // sinkt leicht ab (Auftrieb verloren) -> abgesenkte, schwere Endpose
      .to(this.state, { flap: -0.16, bend: 0.12, compression: 0.08, lift: -0.18, duration: 0.25, ease: "power2.out" });
  }
}
