import { setTimeout as warte } from "node:timers/promises";

import { gh } from "./gh.mjs";

const WIEDERHOLUNGEN = 3;
const VERBINDUNG_ODER_SERVER = /HTTP 5\d\d\b|error connecting|dial tcp|i\/o timeout|TLS handshake timeout|connection (?:reset|refused)|\bEOF\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|temporarily unavailable/i;
const NICHT_GEFUNDEN = /HTTP 404\b/;

export function stoerungsfilter({ beginn, anfangMs }) {
  return (meldung) => VERBINDUNG_ODER_SERVER.test(meldung) || (NICHT_GEFUNDEN.test(meldung) && Date.now() - beginn < anfangMs);
}

export async function ghMitWiederholung(argumente, { taktMs, laessig, versuch = 0 }) {
  try {
    return gh(argumente);
  } catch (fehler) {
    if (versuch >= WIEDERHOLUNGEN || !laessig(fehler.message)) throw fehler;
    await warte(taktMs);
    return ghMitWiederholung(argumente, { taktMs, laessig, versuch: versuch + 1 });
  }
}
