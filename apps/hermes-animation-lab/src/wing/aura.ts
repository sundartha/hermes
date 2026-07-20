import { ColorMatrixFilter, type ColorMatrix } from "pixi.js";

// Goettlicher Gold-Look fuer den EINEN Fluegel. WICHTIG (Owner-Prinzip, siehe
// README): genau ein Mesh, KEINE Klone/Spiegelungen/Ghosts/Trails/zweiten Ebenen.
// Der Gold-Eindruck entsteht daher NICHT durch eine geblurrte Kopie, sondern
// rein als Post-Processing (ColorMatrixFilter) auf demselben Mesh. Der Filter
// faerbt den weissen Feder-Fluegel zu warmem Hermes-Gold und laesst ihn im
// Kraftschlag kurz heller aufleuchten (goettlicher Lichtpuls). ColorMatrixFilter
// ist Core (WebGL + WebGPU) -> renderer-unabhaengig.

/**
 * Warmes Hermes-Gold. Homer beschreibt Sandalen & Stab als "golden und
 * unsterblich" (Ilias 24,339 / Odyssee 5,28); warm-patiniert statt grell.
 */
export const HERMES_GOLD = 0xe6be5c;

/** Identitaetsmatrix zum deterministischen Zuruecksetzen pro Frame. */
const IDENTITY = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
] as unknown as ColorMatrix;

/** Leichte Saettigungsanhebung, damit das Gold satt statt blass wirkt. */
const GOLD_SATURATE = 0.12;

/**
 * Schreibt den Gold-Zustand deterministisch in den Filter (kein Akkumulieren:
 * jeder Frame startet bei der Identitaet). Bei strength 0 ist der Filter
 * wirkungslos -> exakt der originale weisse Fluegel.
 *
 * @param strength 0..1 — Mischung Original<->Gold (Filter-alpha).
 * @param pulse    0..~0.6 — zusaetzliche Helligkeit (Lichtpuls im Kraftschlag).
 * @param color    Tint-Farbe (Default Hermes-Gold).
 */
export function applyGold(
  filter: ColorMatrixFilter,
  strength: number,
  pulse: number,
  color: number = HERMES_GOLD,
): void {
  filter.matrix = IDENTITY; // reset (ColorMatrixFilter hat kein reset())
  filter.tint(color, true);
  if (pulse > 0) filter.brightness(1 + pulse, true);
  filter.saturate(GOLD_SATURATE, true);
  filter.alpha = strength;
}

/** Frischer, neutral konfigurierter Gold-Filter (strength 0 = aus). */
export function createGoldFilter(): ColorMatrixFilter {
  const filter = new ColorMatrixFilter();
  applyGold(filter, 0, 0);
  return filter;
}
