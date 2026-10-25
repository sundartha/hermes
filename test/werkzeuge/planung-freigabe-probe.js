import { join } from "node:path";

import { ersetze } from "./planung-plane-probe.js";

export function hebeFreigabe(wurzel, ordner, { von, auf }) {
  ersetze(join(wurzel, ordner, "pitch.md"), `Planung freigegeben: ${von} Token`, `Planung freigegeben: ${auf} Token`);
}

export function mitKopfzeile(wurzel, ordner, zeile) {
  ersetze(join(wurzel, ordner, "pitch.md"), "\nStatus: ", `\n${zeile}\nStatus: `);
}
