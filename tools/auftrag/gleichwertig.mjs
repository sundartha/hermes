const ZEILE = /^Gleichwertig: (.+?), weil \S.*$/gm;
const KEINE_TESTDATEI = "keine Testdatei erreicht die Datei";
const IGNORIERT = "Ignored";
const VERSTOSS = "Verstoß: ";
export const ABGESCHALTET = new Set([IGNORIERT, "CheckFailed"]);
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

function gemeldet(zeilen, kennung) {
  const anfang = `${kennung}: `;
  return zeilen.filter((zeile) => zeile.startsWith(anfang)).map((zeile) => zeile.slice(anfang.length));
}

function gelesen(schluessel, abgeschaltete) {
  if (abgeschaltete.has(schluessel)) return { schluessel, status: IGNORIERT };
  return schluessel.endsWith(` ${KEINE_TESTDATEI}`) ? { schluessel, art: KEINE_TESTDATEI } : { schluessel };
}

export function nachbewertet(ausgabe, gleichwertige) {
  const zeilen = ausgabe.split("\n");
  const abgeschaltete = gemeldet(zeilen, ABSCHALTUNG_VERSTOSS);
  const abgeschaltet = new Set(abgeschaltete);
  const ueberlebende = gemeldet(zeilen, MUTANT_UEBERLEBT).map((schluessel) => gelesen(schluessel, abgeschaltet));
  const andere = zeilen.filter((zeile) => zeile.startsWith(VERSTOSS) && !zeile.startsWith(`${MUTANT_UEBERLEBT}: `));
  if (ueberlebende.length + andere.length === 0) return null;
  const neu = ueberlebende.filter((eintrag) => angenommen(eintrag, gleichwertige)).map(({ schluessel }) => schluessel);
  const bleiben = ueberlebende.map(({ schluessel }) => schluessel).filter((schluessel) => !neu.includes(schluessel));
  return {
    rot: bleiben.length + andere.length > 0,
    zeilen: [
      ...[...gemeldet(zeilen, GLEICHWERTIG_ANGENOMMEN), ...neu].map((schluessel) => `${GLEICHWERTIG_ANGENOMMEN}: ${schluessel}`),
      ...abgeschaltete.map((schluessel) => `${ABSCHALTUNG_VERSTOSS}: ${schluessel}`),
      ...bleiben.map((schluessel) => `${MUTANT_UEBERLEBT}: ${schluessel}`),
      ...andere,
    ],
  };
}
