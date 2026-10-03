const ERGEBNISSE = new Set(["test:pass", "test:fail"]);

export default async function* melder(quelle) {
  for await (const { type, data } of quelle) {
    if (!ERGEBNISSE.has(type)) continue;
    const { name, file, skip, todo, details } = data;
    if (skip || todo || details?.type === "suite") continue;
    const ergebnis = { name, datei: file, bestanden: type === "test:pass" };
    yield `${JSON.stringify(ergebnis)}\n`;
  }
}
