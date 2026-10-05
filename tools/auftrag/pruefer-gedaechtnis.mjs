import { inflateRawSync } from "node:zlib";

import { PRUEFER_LAUF, passtZu, workflowNummer } from "./pruefer-herkunft.mjs";
import { ERGEBNIS_DATEI, GEPRUEFT, ergebnisAus } from "./pruefer-schema.mjs";

const ARTEFAKT_PRAEFIX = "pruefer-ergebnis-pr";
const EOCD_SIGNATUR = 0x06054b50;
const ZENTRAL_SIGNATUR = 0x02014b50;
const LOKAL_SIGNATUR = 0x04034b50;
const EOCD_LAENGE = 22;
const MAX_KOMMENTAR = 65_535;
const MAX_ENTPACKT = 16_777_216;
const GESPEICHERT = 0;
const DEFLATE = 8;
const EOCD = { anzahl: 10, start: 16 };
const ZENTRAL = {
  methode: 10,
  gepackt: 20,
  entpackt: 24,
  name: 28,
  extra: 30,
  kommentar: 32,
  lokal: 42,
  kopf: 46,
};
const LOKAL = { name: 26, extra: 28, kopf: 30 };

function eocdStelle(puffer) {
  const ende = Math.max(0, puffer.length - EOCD_LAENGE - MAX_KOMMENTAR);
  for (let i = puffer.length - EOCD_LAENGE; i >= ende; i -= 1) {
    if (puffer.readUInt32LE(i) === EOCD_SIGNATUR) return i;
  }
  throw new Error("kein Zip-Archiv");
}

function zentralEintrag(puffer, stelle) {
  if (puffer.readUInt32LE(stelle) !== ZENTRAL_SIGNATUR)
    throw new Error("Zip-Verzeichnis beschädigt");
  const laengen = [ZENTRAL.name, ZENTRAL.extra, ZENTRAL.kommentar].map((feld) =>
    puffer.readUInt16LE(stelle + feld),
  );
  const nameStart = stelle + ZENTRAL.kopf;
  return {
    name: puffer.toString("utf8", nameStart, nameStart + laengen[0]),
    methode: puffer.readUInt16LE(stelle + ZENTRAL.methode),
    gepackt: puffer.readUInt32LE(stelle + ZENTRAL.gepackt),
    entpackt: puffer.readUInt32LE(stelle + ZENTRAL.entpackt),
    lokal: puffer.readUInt32LE(stelle + ZENTRAL.lokal),
    naechster: nameStart + laengen.reduce((summe, laenge) => summe + laenge, 0),
  };
}

function inhaltVon(puffer, eintrag) {
  if (puffer.readUInt32LE(eintrag.lokal) !== LOKAL_SIGNATUR)
    throw new Error("Zip-Eintrag beschädigt");
  if (eintrag.entpackt > MAX_ENTPACKT) throw new Error("Zip-Eintrag zu groß");
  const start =
    eintrag.lokal +
    LOKAL.kopf +
    puffer.readUInt16LE(eintrag.lokal + LOKAL.name) +
    puffer.readUInt16LE(eintrag.lokal + LOKAL.extra);
  const daten = puffer.subarray(start, start + eintrag.gepackt);
  if (eintrag.methode === GESPEICHERT) return daten;
  if (eintrag.methode === DEFLATE) return inflateRawSync(daten, { maxOutputLength: MAX_ENTPACKT });
  throw new Error(`Zip-Methode ${eintrag.methode} unbekannt`);
}

export function entpacke(puffer) {
  const eocd = eocdStelle(puffer);
  const dateien = new Map();
  let stelle = puffer.readUInt32LE(eocd + EOCD.start);
  for (let i = 0; i < puffer.readUInt16LE(eocd + EOCD.anzahl); i += 1) {
    const eintrag = zentralEintrag(puffer, stelle);
    dateien.set(eintrag.name, inhaltVon(puffer, eintrag));
    stelle = eintrag.naechster;
  }
  return dateien;
}

export function artefaktName(pr) {
  return `${ARTEFAKT_PRAEFIX}${pr}`;
}

async function inhaltDes(github, artefakt) {
  try {
    const inhalt = entpacke(await github.roh(`/actions/artifacts/${artefakt.id}/zip`)).get(
      ERGEBNIS_DATEI,
    );
    return inhalt ? ergebnisAus(inhalt.toString("utf8")) : null;
  } catch {
    return null;
  }
}

function vertrauteLaeufe(github, nummer) {
  const bekannt = new Map();
  return async (laufId) => {
    if (!bekannt.has(laufId)) {
      const lauf = await github.hole(`/actions/runs/${laufId}`);
      bekannt.set(laufId, passtZu(lauf, PRUEFER_LAUF, nummer));
    }
    return bekannt.get(laufId);
  };
}

function uebernimm(gesammelt, ergebnis) {
  for (const commit of ergebnis.commits) {
    const tauglich = commit.zustand === GEPRUEFT && commit.patchId !== "";
    if (tauglich && !gesammelt.has(commit.patchId)) gesammelt.set(commit.patchId, commit);
  }
}

export async function fruehereErgebnisse({ github, pr }) {
  const name = artefaktName(pr);
  const artefakte = await github.alle(
    `/actions/artifacts?name=${name}`,
    (antwort) => antwort.artifacts,
  );
  const passend = artefakte.filter(
    (artefakt) => artefakt.name === name && artefakt.expired !== true,
  );
  const gesammelt = new Map();
  if (passend.length === 0) return gesammelt;
  const vertraut = vertrauteLaeufe(github, await workflowNummer(github, PRUEFER_LAUF));
  for (const artefakt of passend) {
    if (!(await vertraut(artefakt.workflow_run?.id))) continue;
    const ergebnis = await inhaltDes(github, artefakt);
    if (ergebnis?.pr === pr) uebernimm(gesammelt, ergebnis);
  }
  return gesammelt;
}
