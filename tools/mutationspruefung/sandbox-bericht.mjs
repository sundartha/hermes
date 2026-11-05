import { appendFileSync } from "node:fs";
import { env } from "node:process";

import erstlaufBericht from "./erstlauf-bericht.mjs";
import { SANDBOX_MELDUNGEN } from "./sandbox-meldungen.mjs";

const IM_PROBELAUF = "STRYKER_DRY_RUN";
const WAHR = "true";
const NICHTS = "";

function gehoert(zeile) {
  const fall = JSON.parse(zeile);
  return env[SANDBOX_MELDUNGEN] !== undefined && env[IM_PROBELAUF] === WAHR && fall.rot && !fall.suite && Boolean(fall.meldung);
}

export default async function* sandboxBericht(quelle) {
  for await (const zeile of erstlaufBericht(quelle)) {
    if (gehoert(zeile)) appendFileSync(env[SANDBOX_MELDUNGEN], zeile);
    yield NICHTS;
  }
}
