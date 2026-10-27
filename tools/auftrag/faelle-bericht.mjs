import { inspect } from "node:util";

const ERGEBNISSE = new Set(["test:pass", "test:fail"]);
const FEHLER_TIEFE = 4;

export default async function* faelleBericht(quelle) {
  let tiefeDavor = -1;
  for await (const { type: art, data: daten } of quelle) {
    if (!ERGEBNISSE.has(art)) continue;
    const blatt = daten.details?.type !== "suite" && tiefeDavor <= daten.nesting;
    tiefeDavor = daten.nesting;
    if (!blatt) continue;
    const fehler = daten.details?.error === undefined ? "" : inspect(daten.details.error, { depth: FEHLER_TIEFE });
    const fall = JSON.stringify({ name: daten.name, zeile: daten.line, rot: art === "test:fail", still: Boolean(daten.skip || daten.todo), fehler });
    yield `${fall}\n`;
  }
}
