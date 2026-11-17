import { block, readInput } from "./lib.mjs";

const QUOTED_TEXT = /"[^"]*"|'[^']*'/g;
const SEGMENT_SEPARATOR = /&&|\|\||[;|\n]/;
const LAUNCHER = String.raw`((env|command|exec|npx|npm\s+exec)(\s+(-\S+|\w+=\S*))*\s+)*`;
const NODE_FLAGS = String.raw`(\s+-\S+(\s+[^-\s]\S*)?)*`;
const DIRECT_NODE_TEST = new RegExp(String.raw`^(\w+=\S*\s+)*${LAUNCHER}(\S*/)?node${NODE_FLAGS}\s+--test(\s|$|-)`);
const SHELL_COMMAND_TEXT = /(?<![\w"'.-])(?:ba|z|da)?sh\s+(?:-\w+\s+)*-\w*c\s+(?:"([^"]*)"|'([^']*)')/;
const COMMAND_SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/;

function innerCommands(command) {
  const inner = [];
  let rest = command;
  for (const pattern of [SHELL_COMMAND_TEXT, COMMAND_SUBSTITUTION]) {
    for (let found = pattern.exec(rest); found; found = pattern.exec(rest)) {
      inner.push(found.slice(1).find((text) => text !== undefined));
      rest = rest.replace(found[0], " ");
    }
  }
  return inner;
}

function allCommands(command) {
  return [command, ...innerCommands(command).flatMap(allCommands)];
}

function runsNodeTestDirectly(command) {
  return allCommands(command).some((text) =>
    text
      .replace(QUOTED_TEXT, "")
      .split(SEGMENT_SEPARATOR)
      .some((segment) => DIRECT_NODE_TEST.test(segment.trim())),
  );
}

function main() {
  const command = readInput().tool_input?.command;
  if (typeof command !== "string" || !runsNodeTestDirectly(command)) return;
  block("hooks/leise-befehle", [
    "`node --test` direkt ist blockiert, weil es die ganze Ausgabe ins Gespräch schreibt.",
    "Nutze `npm test -- <Testdatei>` und leite lange Ausgaben in eine Datei um.",
  ]);
}

main();
