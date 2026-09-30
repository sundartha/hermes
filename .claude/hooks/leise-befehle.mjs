import { block, readInput } from "./lib.mjs";

const QUOTED_TEXT = /"[^"]*"|'[^']*'/g;
const SEGMENT_SEPARATOR = /&&|\|\||[;|\n]/;
const DIRECT_NODE_TEST = /^(\w+=\S*\s+)*node(\s+--?[\w=.:/-]+)*\s+--test(\s|$|-)/;

function runsNodeTestDirectly(command) {
  return command
    .replace(QUOTED_TEXT, "")
    .split(SEGMENT_SEPARATOR)
    .some((segment) => DIRECT_NODE_TEST.test(segment.trim()));
}

function main() {
  const command = readInput().tool_input?.command;
  if (typeof command !== "string" || !runsNodeTestDirectly(command)) return;
  block([
    "`node --test` direkt ist blockiert, weil es die ganze Ausgabe ins Gespräch schreibt.",
    "Nutze `npm test` oder `npm run pruefleiter` und leite lange Ausgaben in eine Datei um.",
  ]);
}

main();
