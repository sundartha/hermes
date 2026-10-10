import { notfallErlaubt } from "./herkunft.mjs";
import { hermesZugang } from "./netz.mjs";
import { AUFWACHEN_TAKTE, ECHTE_UHR } from "./takt.mjs";

const HTTP_OK = 200;

async function aufwachen({ hermes, ausgabe }, { uhr, takte }) {
  const wecken = await hermes.aufwecken({ uhr, takte, grenzeMs: takte.schutzgrenzeMs });
  if (wecken.schutzgrenze) {
    ausgabe.melde("rot_aufwachen_zeitgrenze", { schritt: "anrufpause", minuten: wecken.minuten });
    return false;
  }
  if (wecken.frischGeweckt) ausgabe.melde("frisch_geweckt");
  return true;
}

function bestaetigt({ ausgabe, an }, { status, daten }) {
  if (status !== HTTP_OK) {
    ausgabe.melde("abbruch_http", { schritt: "anrufpause", http: status });
    return false;
  }
  if (daten?.an === an) return true;
  ausgabe.melde("rot_anrufpause_abweichend");
  return false;
}

async function pauseSetzen(kontext) {
  const antwort = await kontext.hermes.anrufpauseSetzen(kontext.an);
  kontext.ausgabe.melde("anrufpause_angefordert", { http: antwort.status });
  return bestaetigt(kontext, antwort);
}

async function pauseLesen(kontext) {
  if (!bestaetigt(kontext, await kontext.hermes.anrufpauseLesen())) return false;
  kontext.ausgabe.melde("anrufpause_stand", { an: kontext.an });
  return true;
}

async function anrufeMelden({ hermes, ausgabe }) {
  const { status, laufend } = await hermes.anrufe();
  if (laufend === null) ausgabe.melde("anrufe_nicht_lesbar", { http: status });
  else ausgabe.melde("anrufe_weiter", { anzahl: laufend });
}

export async function anrufpause({
  einstellungen,
  an,
  ausgabe,
  uhr = ECHTE_UHR,
  takte = AUFWACHEN_TAKTE,
}) {
  if (!notfallErlaubt(einstellungen, ausgabe)) return false;
  const hermes = hermesZugang(einstellungen.produktionUrl, einstellungen.deployToken);
  const kontext = { hermes, ausgabe, an };
  if (!(await aufwachen(kontext, { uhr, takte }))) return false;
  if (!(await pauseSetzen(kontext)) || !(await pauseLesen(kontext))) return false;
  await anrufeMelden(kontext);
  if (an) ausgabe.melde("anrufpause_probe");
  return true;
}
