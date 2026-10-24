import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { echterRepoPfad } from "../../ziele/funktionen.mjs";
import { pfadIstSauber } from "../format.mjs";
import { belegteKette, modulGraph } from "./kette.mjs";

const EXIT_GRUEN = 0;
const EXIT_KEIN_PFAD = 1;
const EXIT_AUFRUF = 2;
const KEIN_PFAD = "kein Pfad belegt";
const STELLE = /^(src\/[^:]+\.[cm]?js):([A-Za-z_$][\w$]*)$/;

function echterPfad(root, datei) {
  try {
    return echterRepoPfad(realpathSync(root), resolve(root, datei));
  } catch {
    return undefined;
  }
}

function stelleAus(root, angabe) {
  const treffer = STELLE.exec(angabe);
  if (treffer === null) return null;
  const [, datei, funktion] = treffer;
  return pfadIstSauber(datei) && echterPfad(root, datei) === datei ? { datei, funktion } : null;
}

export async function kette(angaben, root) {
  const [von, nach] = angaben.map((angabe) => stelleAus(root, angabe));
  const ungueltig = angaben.filter((angabe, stelle) => [von, nach][stelle] === null);
  if (ungueltig.length > 0) {
    console.error(`Abbruch: kette nimmt nur <datei:funktion> mit einer vorhandenen JavaScript-Datei unter src/, ohne . und .. und ohne Link nach draußen: ${ungueltig.join(", ")}`);
    return EXIT_AUFRUF;
  }
  const glieder = belegteKette(root, await modulGraph(root), { von, nach });
  if (glieder === null) {
    console.log(KEIN_PFAD);
    return EXIT_KEIN_PFAD;
  }
  console.log(["Aufrufkette, Aufrufer zuerst:", ...glieder.map(({ datei, funktion, von: anfang, bis }) => `${datei}:${anfang}-${bis} ${funktion}`)].join("\n"));
  return EXIT_GRUEN;
}
