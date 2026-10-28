import { fileURLToPath } from "node:url";

import { format, check, resolveConfig } from "prettier";

import { EXIT_AUFRUF, EXIT_KARTE_FORMAT, NeuFehler } from "./fehler.mjs";

const EIGENE_DATEI = fileURLToPath(import.meta.url);
const NICHT_GEFUNDEN = -1;
const SCHRITT = 1;
const ANFUEHRUNG = '"';
const ESCAPE = "\\";
const LISTE_AUF = "[";
const LISTE_ZU = "]";

function listenEnde(text, start) {
  let imText = false;
  for (let stelle = start; stelle < text.length; stelle += SCHRITT) {
    const zeichen = text[stelle];
    if (imText && zeichen === ESCAPE) stelle += SCHRITT;
    else if (zeichen === ANFUEHRUNG) imText = !imText;
    else if (!imText && zeichen === LISTE_ZU) return stelle;
  }
  return NICHT_GEFUNDEN;
}

function naechsterEintrag(text, kennzeichen, nach) {
  const stelle = text.indexOf(kennzeichen, nach);
  return stelle === NICHT_GEFUNDEN ? text.length : stelle;
}

function listeIn(text, { schluessel, kennung, liste }) {
  const kennzeichen = `"${schluessel}": ${JSON.stringify(kennung)}`;
  const beginn = text.indexOf(kennzeichen);
  const ende = naechsterEintrag(text, `"${schluessel}": "`, beginn + SCHRITT);
  const listenschluessel = text.indexOf(`"${liste}": ${LISTE_AUF}`, beginn);
  if (beginn === NICHT_GEFUNDEN || listenschluessel === NICHT_GEFUNDEN || listenschluessel > ende) {
    throw new NeuFehler(EXIT_AUFRUF, `${schluessel} ${kennung} hat keine Liste ${liste}.`);
  }
  const auf = text.indexOf(LISTE_AUF, listenschluessel);
  return { auf, zu: listenEnde(text, auf + SCHRITT) };
}

export async function ergaenzeListe({ pfad, text, stelle, eintrag }) {
  const optionen = { ...(await resolveConfig(EIGENE_DATEI)), parser: "json" };
  if (!(await check(text, optionen))) {
    throw new NeuFehler(
      EXIT_KARTE_FORMAT,
      `${pfad} ist nicht im Prettier-Format; formatiere die Datei zuerst, sonst enthielte der Diff mehr als die neue Zeile.`,
    );
  }
  const { auf, zu } = listeIn(text, stelle);
  const eintraege = JSON.parse(text.slice(auf, zu + SCHRITT));
  if (eintraege.includes(eintrag)) return text;
  const neu = `${text.slice(0, auf)}${JSON.stringify([...eintraege, eintrag])}${text.slice(zu + SCHRITT)}`;
  return format(neu, optionen);
}
