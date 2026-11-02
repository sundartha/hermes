import { globSync, readFileSync } from "node:fs";

import { TOOL_TEST_GLOB } from "../../test/testbaenke-run.mjs";
import { waehleTeil, werkzeugMessdatei } from "../testlaufzeit/teilung.mjs";

export function dateienAusListe(datei) {
  return readFileSync(datei, "utf8")
    .split("\n")
    .filter((zeile) => zeile !== "");
}

export function werkzeugtestsDesTeils(teil) {
  const alle = globSync(TOOL_TEST_GLOB);
  if (teil === undefined) return alle;
  return waehleTeil({ dateien: alle, teil: teil.index, anzahl: teil.total, messdatei: werkzeugMessdatei() });
}
