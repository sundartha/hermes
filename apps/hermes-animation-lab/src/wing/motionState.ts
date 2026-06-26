import type { HermesMotionState } from "../types.js";

/**
 * Ruhe-Zustand: keine Verformung. `idle` == exakt diese Werte == Originalgeometrie.
 * intensity/speed bleiben neutral (1).
 */
export const REST_STATE: Readonly<HermesMotionState> = Object.freeze({
  flap: 0,
  bend: 0,
  compression: 0,
  tipLag: 0,
  rootRotation: 0,
  intensity: 1,
  speed: 1,
});

/** Frische, mutierbare Kopie des Ruhe-Zustands (von GSAP getweent). */
export function createState(): HermesMotionState {
  return { ...REST_STATE };
}

/** Setzt ein Ziel-Objekt feldweise auf den Ruhe-Zustand zurueck (ohne Neu-Allokation). */
export function resetState(target: HermesMotionState): void {
  target.flap = REST_STATE.flap;
  target.bend = REST_STATE.bend;
  target.compression = REST_STATE.compression;
  target.tipLag = REST_STATE.tipLag;
  target.rootRotation = REST_STATE.rootRotation;
  target.intensity = REST_STATE.intensity;
  target.speed = REST_STATE.speed;
}
