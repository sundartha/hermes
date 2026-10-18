import { existsSync, readFileSync } from "node:fs";

export function ausgabenAus(datei) {
  if (!existsSync(datei)) return {};
  const zeilen = readFileSync(datei, "utf8").split("\n").filter(Boolean);
  return Object.fromEntries(
    zeilen.map((zeile) => [
      zeile.slice(0, zeile.indexOf("=")),
      zeile.slice(zeile.indexOf("=") + 1),
    ]),
  );
}
