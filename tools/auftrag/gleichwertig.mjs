const ZEILE = /^Gleichwertig: (.+?), weil \S.*$/gm;
const KEINE_TESTDATEI = "keine Testdatei erreicht die Datei";
const IGNORIERT = "Ignored";
export const ABGESCHALTET = new Set([IGNORIERT, "CheckFailed"]);
export const MUTANT_UEBERLEBT = "Verstoß: Mutant überlebt";
export const GLEICHWERTIG_ANGENOMMEN = "Hinweis: als gleichwertig angenommen";
export const ABSCHALTUNG_VERSTOSS =
  "Hinweis: von Stryker abgeschaltet, Mutant bleibt Verstoß; Abschaltung entfernen, Code vereinfachen oder Test schreiben, sonst Paket anhalten und Betreuung fragen";

export function meldungsZeile({ art, mutant, grund }) {
  return `${art}: ${mutant}, weil ${grund}`;
}

export function gleichwertigZeile(mutant, grund) {
  return meldungsZeile({ art: "Gleichwertig", mutant, grund });
}

export function gleichwertigGemeldet(text) {
  return [...text.matchAll(ZEILE)].map(([, mutant]) => mutant.trim());
}

export function gemeint(gemeldet, schluessel) {
  return schluessel === gemeldet || schluessel.startsWith(`${gemeldet} `);
}

export function ohneTestdatei(datei, zeile) {
  return { schluessel: `${datei}:${zeile} ${KEINE_TESTDATEI}`, status: "NoCoverage", art: KEINE_TESTDATEI };
}

export function angenommen({ schluessel, status, art }, gleichwertige) {
  return gleichwertige.has(schluessel) && !ABGESCHALTET.has(status) && art !== KEINE_TESTDATEI;
}
