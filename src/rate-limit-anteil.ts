const KEIN_LIMIT = 0;
const MINDESTANTEIL = 1;

export function anteiligesLimit(limit: number, instanzen: number): number {
  if (limit === KEIN_LIMIT) return KEIN_LIMIT;
  return Math.max(MINDESTANTEIL, Math.floor(limit / instanzen));
}
