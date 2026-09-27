/* =============================================================================
 * mobile-pager.js - Entscheidungen des Blaetterns auf der Handy-Startseite
 *
 * Reine Funktionen ohne DOM (von scripts/hermes-mobile.js genutzt, per
 * node:test geprueft). Grundregel: eine Geste bewegt hoechstens EINEN Screen,
 * egal wie hart oder weit gewischt wurde; das Ziel ist immer ein ganzer
 * Screen (buendig), nie eine Zwischenposition.
 *
 * Richtung: +1 = naechster Screen (Finger nach oben), -1 = vorheriger.
 * ========================================================================== */

/* Ab diesem Anteil der Screenhoehe gilt ein langsamer Zug als "weiter". */
export const PAGE_COMMIT_RATIO = 0.1;
/* Ein kurzer, zuegiger Wisch reicht auch: ab dieser Geschwindigkeit (px/ms,
 * bewusst niedrig - auch ein leichter Wisch soll blaettern) und mindestens
 * dieser Strecke (px). Darunter ist es ein Antippen. */
export const PAGE_FLICK_SPEED = 0.2;
export const PAGE_FLICK_MIN_PX = 16;
/* Dauer der Fahrt zum Ziel: kurz fuer den Rest einer halben Geste, laenger fuer
 * einen ganzen Screen (ms). */
export const PAGE_MS_MIN = 280;
export const PAGE_MS_MAX = 620;
/* Mausrad/Trackpad: ab dieser Summe (px) blaettert es, und erst nach dieser
 * Ruhepause (ms) darf die naechste Geste wieder blaettern - der Nachlauf eines
 * Trackpads zaehlt so nicht als neue Geste. */
export const WHEEL_STEP_PX = 40;
export const WHEEL_QUIET_MS = 180;
/* deltaMode 1 (Zeilen) und 2 (Seiten) in Pixel umrechnen. */
const WHEEL_LINE_PX = 16;
const WHEEL_MODE_LINES = 1;
const WHEEL_MODE_PAGES = 2;

/**
 * Richtung nach dem Loslassen.
 * @param {{ moved: number, velocity: number, height: number }} gesture
 *   moved: Strecke seit Gestenbeginn in px (+ = Richtung naechster Screen),
 *   velocity: Tempo am Ende in px/ms (+ = Richtung naechster Screen),
 *   height: Screenhoehe in px.
 * @returns {-1|0|1}
 */
export function pageStep({ moved, velocity, height }) {
  if (Math.abs(moved) < PAGE_FLICK_MIN_PX || !(height > 0)) return 0;
  const direction = Math.sign(moved);
  // Ein schneller Wisch entscheidet: in Zugrichtung = weiter, dagegen = zurueck auf den Start.
  if (Math.abs(velocity) >= PAGE_FLICK_SPEED)
    return Math.sign(velocity) === direction ? direction : 0;
  return Math.abs(moved) >= height * PAGE_COMMIT_RATIO ? direction : 0;
}

/** Ziel-Index: Start +/- hoechstens 1, innerhalb von 0 ... count - 1. */
export function pageTarget(base, step, count) {
  return Math.min(count - 1, Math.max(0, base + Math.sign(step)));
}

/** Fahrtdauer (ms) fuer eine Strecke in px bei gegebener Screenhoehe. */
export function pageDuration(distance, height) {
  const share = height > 0 ? Math.min(1, Math.abs(distance) / height) : 1;
  return Math.round(PAGE_MS_MIN + (PAGE_MS_MAX - PAGE_MS_MIN) * share);
}

/** Rad-Delta eines WheelEvent in px. */
export function wheelPixels(deltaY, deltaMode, height) {
  if (deltaMode === WHEEL_MODE_LINES) return deltaY * WHEEL_LINE_PX;
  if (deltaMode === WHEEL_MODE_PAGES) return deltaY * height;
  return deltaY;
}
