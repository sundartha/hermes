import { setTimeout as warte } from "node:timers/promises";

import { gh } from "./gh.mjs";

const WIEDERHOLUNGEN = 3;
const VERBINDUNG_ODER_SERVER = /HTTP 5\d\d\b|error connecting|dial tcp|i\/o timeout|TLS handshake timeout|connection (?:reset|refused)|\bEOF\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|temporarily unavailable/i;
const NICHT_GEFUNDEN = /HTTP 404\b/;
const FOLGEJOB = "CI";
const GESCHEITERT = "failure";
const UNGEPRUEFT_OK = new Set(["success", "skipped", "neutral"]);
const AUSSERHALB_DER_PRUEFUNG = /^(?:Set up job|Complete job|Post .+|Checkout|Node 22|npm ci|Node 22, npm ci und Install-Skripte|Vorgaben (?:laden|hochladen)|Teilergebnisse laden|Teilergebnis hochladen|Zeit-Log hochladen|Mutationsurteil hochladen)$/;

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

function nurAusserhalbDerPruefung(job) {
  const gescheiterte = (job.steps ?? []).filter((schritt) => schritt.conclusion === GESCHEITERT);
  return gescheiterte.length > 0 && gescheiterte.every((schritt) => AUSSERHALB_DER_PRUEFUNG.test(schritt.name));
}

export function nurInfrastrukturGescheitert(jobs) {
  const gescheitert = jobs.filter((job) => job.conclusion === GESCHEITERT && job.name !== FOLGEJOB);
  const fremd = jobs.some((job) => job.conclusion !== GESCHEITERT && !UNGEPRUEFT_OK.has(job.conclusion));
  return !fremd && gescheitert.length > 0 && gescheitert.every(nurAusserhalbDerPruefung);
}
