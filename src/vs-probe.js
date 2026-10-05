export const ANTWORT = 42;

export function einordnen(zahl) {
  if (zahl === ANTWORT) return "antwort";
  if (zahl < 0) return "negativ";
  return "positiv";
}
