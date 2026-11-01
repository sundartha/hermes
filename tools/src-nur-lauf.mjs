import { parseArgs } from "node:util";

import { zweckBlock } from "./auftrag/zweck.mjs";
import { befunde } from "./src-nur-lauf/befunde.mjs";
import { prNummer } from "./src-nur-lauf/nummer.mjs";

const ZWECK = "github/src-nur-lauf";
const WURZEL = ".";
const OPTIONEN = {
  basis: { type: "string" },
  kopf: { type: "string", default: "HEAD" },
  pr: { type: "string" },
  ereignis: { type: "string" },
  "queue-ref": { type: "string" },
};

async function gefunden(optionen) {
  const { nummer, problem } = prNummer(optionen);
  if (problem !== undefined) return [problem];
  return befunde({ ...optionen, pr: nummer }, WURZEL);
}

const { values } = parseArgs({ options: OPTIONEN });
if (values.basis === undefined) {
  throw new Error("Aufruf: node tools/src-nur-lauf.mjs --basis <sha> [--kopf <sha>] [--ereignis pull_request|merge_group] [--pr <nummer>] [--queue-ref <ref>]");
}
const meldungen = await gefunden(values);
for (const meldung of meldungen) console.error(meldung);
if (meldungen.length > 0) {
  console.log(zweckBlock(ZWECK).join("\n"));
  process.exitCode = 1;
}
