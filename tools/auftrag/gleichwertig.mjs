const ZEILE = /^Gleichwertig: (.+?), weil \S.*$/gm;

export function gleichwertigZeile(mutant, grund) {
  return `Gleichwertig: ${mutant}, weil ${grund}`;
}

export function gleichwertigGemeldet(text) {
  return [...text.matchAll(ZEILE)].map(([, mutant]) => mutant.trim());
}
