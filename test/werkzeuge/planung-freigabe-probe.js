import { join } from "node:path";

import { ersetze } from "./planung-plane-probe.js";

export function mitKopfzeile(wurzel, ordner, zeile) {
  ersetze(join(wurzel, ordner, "pitch.md"), "\nStatus: ", `\n${zeile}\nStatus: `);
}
