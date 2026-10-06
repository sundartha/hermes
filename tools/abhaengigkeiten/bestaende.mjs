import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const NUR_KUERZER = ["tools/basis/selbstpruefung.json", "tools/basis/fester-importpfad.json"];
const MAX_GIT_AUSGABE = 268_435_456;

function befunde(text) {
  return JSON.parse(text).befunde;
}

function imArbeitsbaum(pfad) {
  return existsSync(pfad) ? befunde(readFileSync(pfad, "utf8")) : [];
}

function aufDerBasis(basis, pfad) {
  const lauf = spawnSync("git", ["show", `${basis}:${pfad}`], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_AUSGABE,
  });
  return lauf.status === 0 ? befunde(lauf.stdout) : undefined;
}

function gezaehlt(eintraege) {
  const anzahl = new Map();
  for (const eintrag of eintraege) anzahl.set(eintrag, (anzahl.get(eintrag) ?? 0) + 1);
  return anzahl;
}

function hinzugekommen(jetzt, vorher) {
  const erlaubt = gezaehlt(vorher);
  return [...gezaehlt(jetzt)]
    .filter(([eintrag, anzahl]) => anzahl > (erlaubt.get(eintrag) ?? 0))
    .map(([eintrag]) => eintrag);
}

function befundeFuer(basis, pfad) {
  const vorher = aufDerBasis(basis, pfad);
  if (vorher === undefined) return [];
  return hinzugekommen(imArbeitsbaum(pfad), vorher).map(
    (eintrag) =>
      `${pfad} darf nur kürzer werden, neu oder öfter eingefroren ist: ${eintrag}. Behebe den Befund im Test, statt ihn einzufrieren.`,
  );
}

export function bestaendeNurKuerzer(basis) {
  return NUR_KUERZER.flatMap((pfad) => befundeFuer(basis, pfad));
}
