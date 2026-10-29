import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { matrix } from "./teile.mjs";
import { ERGEBNISDATEI } from "./vorher-verteilt.mjs";

export function teilberichte(ordner, { teile, pruefsumme: summe }, vorergebnis = {}) {
  const berichte = readdirSync(ordner)
    .filter((name) => ERGEBNISDATEI.test(name))
    .map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")));
  const fremd = berichte.filter((bericht) => bericht.pruefsumme !== summe);
  if (fremd.length > 0) throw new Error(`${fremd.length} Teilergebnisse gehören zu einem anderen Plan`);
  const anderes = berichte.filter((bericht) => (bericht.vorergebnis ?? null) !== (vorergebnis.kennung ?? null));
  if (anderes.length > 0) throw new Error(`${anderes.length} Teilergebnisse gehören zu einem anderen Vorergebnis`);
  const gefunden = berichte.map(({ teil }) => teil).sort((links, rechts) => links - rechts);
  if (JSON.stringify(gefunden) !== JSON.stringify(matrix(teile))) {
    throw new Error(`erwartet die Teile ${matrix(teile).join(", ")}, gefunden ${gefunden.join(", ") || "keine"}`);
  }
  return berichte;
}
