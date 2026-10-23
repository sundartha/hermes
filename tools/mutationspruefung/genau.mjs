export const GENAU = "genau";
export const NICHT_GEFRAGT = "nicht gefragt: der Knoten enthält keinen Mutanten, nach dem dieser Lauf fragt";

const IGNORER = "Ignore";
const OPTIONEN = "options";
const SPALTENBEREICH = /:(\d+):(\d+)-(\d+):(\d+)$/;
const NICHTS_AUSLASSEN = Object.freeze({ shouldIgnore: () => undefined });

export function spaltenbereich(datei, { start, end }) {
  return `${datei}:${start.line}:${start.column - 1}-${end.line}:${end.column - 1}`;
}

function vorOderGleich(links, rechts) {
  return links.line < rechts.line || (links.line === rechts.line && links.column <= rechts.column);
}

function enthaelt(aussen, innen) {
  return vorOderGleich(aussen.start, innen.start) && vorOderGleich(innen.end, aussen.end);
}

function genauerIgnorer({ mutate }) {
  const treffer = mutate.map((muster) => SPALTENBEREICH.exec(muster));
  if (treffer.some((bereich) => bereich === null)) return NICHTS_AUSLASSEN;
  const orte = treffer.map(([, zeile, spalte, endzeile, endspalte]) => ({
    start: { line: Number(zeile), column: Number(spalte) },
    end: { line: Number(endzeile), column: Number(endspalte) },
  }));
  return { shouldIgnore: ({ node: { loc } }) => (loc && !orte.some((ort) => enthaelt(loc, ort)) ? NICHT_GEFRAGT : undefined) };
}
genauerIgnorer.inject = [OPTIONEN];

export const strykerPlugins = [{ kind: IGNORER, name: GENAU, factory: genauerIgnorer }];
