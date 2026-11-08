import { existsSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

import { block, isInside, readInput, realPath, repositoryRoot, startDirectory } from "./lib.mjs";

const GEPRUEFTE_ORDNER = ["src", "test"];
const ENDUNGEN = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const FEHLER_STUFE = 2;
const LEERZEICHEN = /\s+/g;

function zuPruefendeDatei(input) {
  const pfad = input.tool_input?.file_path;
  if (typeof pfad !== "string" || !ENDUNGEN.has(extname(pfad))) return undefined;
  const verzeichnis = startDirectory(input);
  const wurzel = realPath(repositoryRoot(verzeichnis));
  const datei = realPath(isAbsolute(pfad) ? pfad : resolve(verzeichnis, pfad));
  const imPruefbereich = GEPRUEFTE_ORDNER.some((ordner) => isInside(datei, resolve(wurzel, ordner)));
  return imPruefbereich && existsSync(datei) ? { wurzel, datei } : undefined;
}

async function verstoesse({ wurzel, datei }) {
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd: wurzel, applySuppressions: true });
  const [ergebnis] = await eslint.lintFiles([datei]);
  return ergebnis.messages
    .filter(({ severity }) => severity === FEHLER_STUFE)
    .map(({ line, ruleId, message }) => `${relative(wurzel, datei)}:${line}  ${ruleId ?? "parser"}  ${message.replace(LEERZEICHEN, " ")}`);
}

async function main() {
  const ziel = zuPruefendeDatei(readInput());
  if (ziel === undefined) return;
  const gefunden = await verstoesse(ziel);
  if (gefunden.length > 0) block("hooks/sofort-pruefen", gefunden);
}

main().catch((fehler) => {
  console.error(`sofort-pruefen: Prüfung übersprungen (${String(fehler.message).split("\n")[0]})`);
});
