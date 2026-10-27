import { relative } from "node:path";
import { cwd } from "node:process";

const LEERRAUM = /\s+/g;

export function mutantenOrt({ fileName, location, mutatorName, replacement }) {
  const datei = relative(cwd(), fileName);
  const { start, end } = location;
  const ersatz = (replacement ?? "").replace(LEERRAUM, " ");
  return {
    schluessel: `${datei}:${start.line}:${start.column}-${end.line}:${end.column} ${mutatorName} → ${ersatz}`,
    zeilen: [start.line, end.line],
  };
}
