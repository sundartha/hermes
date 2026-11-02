import { dateiAm } from "./git.mjs";

const ALTBESTAND_DATEI = "tools/basis/altbestand-ohne-auftrag.json";
const NUMMER = /^[1-9]\d*$/;

function gelesen(text, stand) {
  if (text === null) return { eintraege: new Map() };
  try {
    const roh = JSON.parse(text);
    if (typeof roh !== "object" || roh === null || Array.isArray(roh)) throw new Error("keine Zuordnung PR-Nummer → Eintrag");
    const schlecht = Object.entries(roh).find(([nummer, eintrag]) => !NUMMER.test(nummer) || typeof eintrag?.kuerzel !== "string" || typeof eintrag?.grund !== "string");
    if (schlecht !== undefined) throw new Error(`Eintrag „${schlecht[0]}“ hat keine PR-Nummer, kein Kürzel oder keinen Grund`);
    return { eintraege: new Map(Object.entries(roh)) };
  } catch (fehler) {
    return { eintraege: new Map(), problem: `${ALTBESTAND_DATEI} am Stand ${stand} nicht lesbar: ${fehler.message}` };
  }
}

export function altbestandListe(basis, kopf, root) {
  const basisText = dateiAm(basis, ALTBESTAND_DATEI, root);
  const alt = gelesen(basisText, "Basis");
  const neu = gelesen(dateiAm(kopf, ALTBESTAND_DATEI, root), "Kopf");
  const pruefbar = basisText !== null && alt.problem === undefined;
  const hinzu = pruefbar ? [...neu.eintraege.keys()].filter((nummer) => !alt.eintraege.has(nummer)) : [];
  const wirksam = new Map([...neu.eintraege].filter(([nummer]) => alt.eintraege.has(nummer)));
  const probleme = [
    ...[alt.problem, neu.problem].filter((problem) => problem !== undefined),
    ...hinzu.map((nummer) => `Altbestand: neuer Eintrag PR ${nummer} in ${ALTBESTAND_DATEI}; die Liste darf nur kürzer werden`),
  ];
  return { wirksam, probleme };
}
