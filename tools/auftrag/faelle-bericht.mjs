const ERGEBNISSE = new Set(["test:pass", "test:fail"]);

export default async function* faelleBericht(quelle) {
  let tiefeDavor = -1;
  for await (const { type: art, data: daten } of quelle) {
    if (!ERGEBNISSE.has(art)) continue;
    const blatt = daten.details?.type !== "suite" && tiefeDavor <= daten.nesting;
    tiefeDavor = daten.nesting;
    if (!blatt) continue;
    const fall = JSON.stringify({ name: daten.name, zeile: daten.line, rot: art === "test:fail", still: Boolean(daten.skip || daten.todo) });
    yield `${fall}\n`;
  }
}
