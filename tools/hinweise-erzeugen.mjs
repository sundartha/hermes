import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expectedBlocks, FOLDER_INSTRUCTIONS, withBlock } from "./anweisungen-karte.mjs";

const root = process.cwd();
const blocks = expectedBlocks(root);
let changed = 0;

for (const [folder, expected] of blocks) {
  const path = join(root, folder, FOLDER_INSTRUCTIONS);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = withBlock(before, expected);
  if (after === before) continue;
  writeFileSync(path, after);
  changed += 1;
  console.log(`${folder}${FOLDER_INSTRUCTIONS}: Kartenteil geschrieben`);
}

console.log(`${blocks.size} Ordner in der Karte, ${changed} Dateien geändert.`);
