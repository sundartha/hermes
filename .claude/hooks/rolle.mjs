import { isAbsolute, relative, resolve, sep } from "node:path";
import { env } from "node:process";

import { block, readInput, realPath, repositoryRoot, startDirectory } from "./lib.mjs";

export const TESTDATEI = /(^|\/)test\/|\.test\.[cm]?js$/;
const ROLLEN = new Set(["bau", "test"]);

export function schreibziel() {
  const input = readInput();
  const pfad = input.tool_input?.file_path;
  if (typeof pfad !== "string") return null;
  const directory = startDirectory(input);
  const root = realPath(repositoryRoot(directory));
  const absolut = realPath(isAbsolute(pfad) ? pfad : resolve(directory, pfad));
  return { input, absolut, relativ: relative(root, absolut).split(sep).join("/") };
}

export function rolle() {
  const name = env.HERMES_ROLLE;
  if (ROLLEN.has(name)) return name;
  return block([
    `HERMES_ROLLE ist ${JSON.stringify(name ?? null)}; ohne bekannte Rolle ist Schreiben gesperrt.`,
    "Die Rolle setzt tools/auftrag.mjs beim Start des Agenten.",
  ]);
}
