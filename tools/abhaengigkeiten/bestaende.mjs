import { existsSync, readFileSync } from "node:fs";

import { gewachsen, pfadZurueck, unveraendert } from "../bestand-rueckfuehrung.mjs";
import { run } from "./prozess.mjs";

const NUR_KUERZER = [
  "tools/basis/selbstpruefung.json",
  "tools/basis/fester-importpfad.json",
  "tools/basis/quelltext-als-text.json",
];

function befunde(text) {
  return JSON.parse(text).befunde;
}

function imArbeitsbaum(pfad) {
  return existsSync(pfad) ? befunde(readFileSync(pfad, "utf8")) : [];
}

function aufDerBasis(basis, pfad) {
  const lauf = run("git", ["show", `${basis}:${pfad}`]);
  return lauf.status === 0 ? befunde(lauf.stdout) : undefined;
}

function hinzugekommen(jetzt, vorher, zurueck) {
  const ueber = gewachsen({ jetzt, vorher, zurueck: (eintrag) => pfadZurueck(eintrag, zurueck) });
  return [...new Set(ueber.map(({ schluessel }) => schluessel))];
}

function befundeFuer(basis, pfad, zurueck) {
  const vorher = aufDerBasis(basis, pfad);
  if (vorher === undefined) return [];
  return hinzugekommen(imArbeitsbaum(pfad), vorher, zurueck).map(
    (eintrag) =>
      `${pfad} darf nur kürzer werden, neu oder öfter eingefroren ist: ${eintrag}. Behebe den Befund im Test, statt ihn einzufrieren.`,
  );
}

export function bestaendeNurKuerzer(basis, zurueck = unveraendert) {
  return NUR_KUERZER.flatMap((pfad) => befundeFuer(basis, pfad, zurueck));
}
