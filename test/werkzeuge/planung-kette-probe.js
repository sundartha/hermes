import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { GRUPPEN, bericht, planOrdner, stelle } from "./planung-probe.js";
import { commitAll } from "./probe-repo.js";

export const KETTE = "src/kette-probe.js";
const KETTE_QUELLE = `export function nimmAuftrag(nummer) {
  const werkzeug = "place_call";
  return pruefeAuftrag({ werkzeug, nummer });
}

function pruefeAuftrag(auftrag) {
  return speichereAuftrag(auftrag);
}

export function speichereAuftrag(auftrag) {
  return auftrag;
}
`;
export const EINGANG = stelle("eingang", KETTE, { funktion: "nimmAuftrag", von: 1, bis: 4 });
export const MITTE = stelle("logik", KETTE, { funktion: "pruefeAuftrag", von: 6, bis: 8 });
export const WIRKUNG = stelle("wirkung", KETTE, { funktion: "speichereAuftrag", von: 10, bis: 12 });
export const ANRUF_NUMMERN = GRUPPEN[1].nummern;

export function mitWeg(weg) {
  return bericht(ANRUF_NUMMERN, Object.fromEntries(ANRUF_NUMMERN.map((nummer) => [nummer, { weg }])));
}

export function wurzelMitKette(context) {
  const wurzel = planOrdner(context);
  writeFileSync(join(wurzel, KETTE), KETTE_QUELLE);
  commitAll(wurzel, "Kette");
  return wurzel;
}
