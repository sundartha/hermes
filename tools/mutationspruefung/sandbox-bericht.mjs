import { appendFileSync } from "node:fs";
import { env } from "node:process";
import { tap } from "node:test/reporters";

import erstlaufBericht from "./erstlauf-bericht.mjs";
import { SANDBOX_MELDUNGEN } from "./sandbox-meldungen.mjs";

const IM_PROBELAUF = "STRYKER_DRY_RUN";
const WAHR = "true";

function gehoert(zeile) {
  const fall = JSON.parse(zeile);
  return fall.rot && !fall.suite && Boolean(fall.meldung);
}

async function* mitgeschrieben(quelle) {
  const schreibt = env[SANDBOX_MELDUNGEN] !== undefined && env[IM_PROBELAUF] === WAHR;
  for await (const ereignis of quelle) {
    if (schreibt) for await (const zeile of erstlaufBericht([ereignis])) if (gehoert(zeile)) appendFileSync(env[SANDBOX_MELDUNGEN], zeile);
    yield ereignis;
  }
}

export default async function* sandboxBericht(quelle) {
  yield* tap(mitgeschrieben(quelle));
}
