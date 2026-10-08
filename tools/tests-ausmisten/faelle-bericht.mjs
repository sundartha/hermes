const ARTEN = new Set(["test:start", "test:pass", "test:fail"]);

export default async function* faelleBericht(quelle) {
  for await (const { type, data } of quelle) {
    if (!ARTEN.has(type)) continue;
    const { name, nesting, file } = data;
    yield `${JSON.stringify({ art: type, name, tiefe: nesting, datei: file })}\n`;
  }
}
