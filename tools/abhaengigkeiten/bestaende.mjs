import { existsSync, readFileSync } from "node:fs";

import { gewachsen, pfadZurueck, unveraendert } from "../bestand-rueckfuehrung.mjs";
import { run } from "./prozess.mjs";

const NUR_KUERZER = [
  "tools/basis/selbstpruefung.json",
  "tools/basis/fester-importpfad.json",
  "tools/basis/keine-speicher-attrappe.json",
  "tools/basis/quelltext-als-text.json",
];

const alsListe = (inhalt) => inhalt;
const befunde = ({ befunde: liste }) => liste;

export function imArbeitsbaum(pfad, eintraege = alsListe) {
  return existsSync(pfad) ? eintraege(JSON.parse(readFileSync(pfad, "utf8"))) : [];
}

export function aufDerBasis(basis, pfad, eintraege = alsListe) {
  const lauf = run("git", ["show", `${basis}:${pfad}`]);
  return lauf.status === 0 ? eintraege(JSON.parse(lauf.stdout)) : undefined;
}

function hinzugekommen(jetzt, vorher, zurueck) {
  const ueber = gewachsen({ jetzt, vorher, zurueck: (eintrag) => pfadZurueck(eintrag, zurueck) });
  return [...new Set(ueber.map(({ schluessel }) => schluessel))];
}

function befundeFuer(basis, pfad, zurueck) {
  const vorher = aufDerBasis(basis, pfad, befunde);
  if (vorher === undefined) return [];
  return hinzugekommen(imArbeitsbaum(pfad, befunde), vorher, zurueck).map(
    (eintrag) =>
      `${pfad} darf nur kürzer werden, neu oder öfter eingefroren ist: ${eintrag}. Behebe den Befund im Test, statt ihn einzufrieren.`,
  );
}

export function bestaendeNurKuerzer(basis, zurueck = unveraendert) {
  return NUR_KUERZER.flatMap((pfad) => befundeFuer(basis, pfad, zurueck));
}
