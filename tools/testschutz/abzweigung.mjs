import { gitGelingt } from "../tests-ausmisten/pfade.mjs";
import { git } from "./aenderungen.mjs";

const ELTERN_EINES_MERGES = 2;

function ersterElternteil(stand) {
  const [, ...eltern] = git(["rev-list", "--parents", "-n", "1", stand]).trim().split(" ");
  return eltern.length === ELTERN_EINES_MERGES ? eltern[0] : undefined;
}

function gemeinsamerVorfahr(basis) {
  const stelle = git(["merge-base", basis, "HEAD"]).trim();
  if (stelle === "") throw new Error("kein gemeinsamer Vorfahr");
  return stelle;
}

export function abzweigstelle(basis) {
  try {
    const stelle = gemeinsamerVorfahr(basis);
    const elternteil = ersterElternteil("HEAD");
    const mergeAufNeuererBasis =
      elternteil !== undefined && gitGelingt(["merge-base", "--is-ancestor", basis, elternteil]);
    return mergeAufNeuererBasis ? elternteil : stelle;
  } catch (fehler) {
    throw new Error(
      `die Abzweigstelle des PR gegenüber der Basis ${basis} ist nicht bestimmbar (${fehler.message.trim()})`,
      { cause: fehler },
    );
  }
}
