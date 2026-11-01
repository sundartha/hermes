import { join, posix } from "node:path";

import { einstellungenFuer, gelesen } from "./syntaxbaum.mjs";

const ERSTE_SPALTE = 1;

export function waechstNurUm(alt, neu, datei) {
  return (
    neu.length === alt.length + 1 &&
    neu.includes(datei) &&
    !alt.includes(datei) &&
    alt.every((pfad) => neu.includes(pfad))
  );
}

function istWeiterleitung({ type, source }) {
  return type === "ExportNamedDeclaration" && source !== null;
}

function weiterleitungen(baum, { quelle, ziel }) {
  const ordner = posix.dirname(quelle);
  const weitergeleitet = baum.body.filter(istWeiterleitung);
  const aufZiel = weitergeleitet.filter(({ source }) => posix.join(ordner, source.value) === ziel);
  return aufZiel.map(({ loc }) => loc);
}

function nichtNach(links, rechts) {
  return links.line < rechts.line || (links.line === rechts.line && links.column <= rechts.column);
}

function liegtIn(stelle, { start, end }) {
  return nichtNach(start, stelle) && nichtNach(stelle, end);
}

export async function nurWeiterleitungenAuf({ root, eslint, text, meldungen, quelle, ziel }) {
  const einstellungen = await einstellungenFuer(join(root, quelle), eslint);
  const baum = gelesen(text, { ...einstellungen, loc: true });
  if (baum === undefined || !baum.body.every(istWeiterleitung)) return false;
  const bereiche = weiterleitungen(baum, { quelle, ziel });
  const inWeiterleitung = ({ line, column }) =>
    bereiche.some((bereich) => liegtIn({ line, column: column - ERSTE_SPALTE }, bereich));
  return meldungen.length > 0 && meldungen.every(inWeiterleitung);
}
