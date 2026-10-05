export function einordnen(zahl) {
  if (zahl < 0) return "negativ";
  // Stryker disable next-line all
  if (Number.isNaN(zahl)) return "keine Zahl";
  if (zahl === 0) return "null";
  return "positiv";
}
