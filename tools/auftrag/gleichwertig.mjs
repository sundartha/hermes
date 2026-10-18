const ZEILE = /^Gleichwertig: (.+?), weil \S.*$/gm;
const KEINE_TESTDATEI = "keine Testdatei erreicht die Datei";
export const ABGESCHALTET = new Set(["Ignored", "CheckFailed"]);
export const MUTANT_UEBERLEBT = "Verstoß: Mutant überlebt";
export const GLEICHWERTIG_ANGENOMMEN = "Hinweis: als gleichwertig angenommen";
export const ABSCHALTUNG_VERSTOSS =
  "Hinweis: von Stryker abgeschaltet, Mutant bleibt Verstoß; Abschaltung entfernen, Code vereinfachen oder Test schreiben, sonst Paket anhalten und Betreuung fragen";

export function gleichwertigZeile(mutant, grund) {
  return `Gleichwertig: ${mutant}, weil ${grund}`;
}

export function gleichwertigGemeldet(text) {
  return [...text.matchAll(ZEILE)].map(([, mutant]) => mutant.trim());
}

export function ohneTestdatei(datei, zeile) {
  return { schluessel: `${datei}:${zeile} ${KEINE_TESTDATEI}`, status: "NoCoverage", art: KEINE_TESTDATEI };
}

export function angenommen({ schluessel, status, art }, gleichwertige) {
  return gleichwertige.has(schluessel) && !ABGESCHALTET.has(status) && art !== KEINE_TESTDATEI;
}
