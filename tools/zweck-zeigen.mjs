import { parseArgs } from "node:util";

import { kenntZweck, zweckBlock } from "./auftrag/zweck.mjs";

const EXIT_AUFRUF = 2;
const AUFRUF = "Aufruf: node tools/zweck-zeigen.mjs <id> [<id> …]";

function zeigen(ids) {
  if (ids.length === 0) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  const unbekannt = ids.filter((id) => !kenntZweck(id));
  if (unbekannt.length > 0) {
    console.error(`Kein Zweck-Text für ${unbekannt.join(", ")} in tools/auftrag/zweck.json oder tools/zweck/; der Aufruf nennt eine ID, die es nicht gibt.`);
    return EXIT_AUFRUF;
  }
  for (const id of ids) console.error(zweckBlock(id).join("\n"));
  return 0;
}

process.exitCode = zeigen(parseArgs({ allowPositionals: true }).positionals);
