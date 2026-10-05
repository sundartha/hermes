import { inflateRawSync } from "node:zlib";

import { PRO_SEITE, mitSeite } from "./pruefer-github.mjs";
import { ERGEBNIS_DATEI, GEPRUEFT, ergebnisAus } from "./pruefer-schema.mjs";

export const WORKFLOW = "pruefer-pruefen.yml";
export const ARTEFAKT = "pruefer-ergebnis";
const WORKFLOW_PFAD = `.github/workflows/${WORKFLOW}`;
const AUSLOESER = "workflow_run";
const ERFOLG = "success";
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

function vomPrueferWorkflow(laufId) {
  return (lauf) =>
    lauf.id !== laufId &&
    lauf.event === AUSLOESER &&
    lauf.conclusion === ERFOLG &&
    String(lauf.path ?? "").split("@")[0] === WORKFLOW_PFAD;
}

async function ergebnisDesLaufs(github, laufId) {
  const { artifacts: artefakte = [] } = await github.hole(
    `/actions/runs/${laufId}/artifacts?name=${ARTEFAKT}`,
  );
  const artefakt = artefakte.find(({ name, expired }) => name === ARTEFAKT && expired !== true);
  if (!artefakt) return null;
  try {
    const inhalt = entpacke(await github.roh(`/actions/artifacts/${artefakt.id}/zip`)).get(
      ERGEBNIS_DATEI,
    );
    return inhalt ? ergebnisAus(inhalt.toString("utf8")) : null;
  } catch {
    return null;
  }
}

function uebernehmbare(ergebnis) {
  const gepruefte = ergebnis.commits.filter(
    ({ zustand, patchId }) => zustand === GEPRUEFT && patchId !== "",
  );
  return new Map(gepruefte.map((commit) => [commit.patchId, commit]));
}

export async function fruehereErgebnisse({ github, branch, laufId }) {
  const pfad = `/actions/workflows/${WORKFLOW}/runs?event=${AUSLOESER}&status=${ERFOLG}`;
  for (let seite = 1; ; seite += 1) {
    const { workflow_runs: laeufe = [] } = await github.hole(mitSeite(pfad, seite));
    for (const lauf of laeufe.filter(vomPrueferWorkflow(laufId))) {
      const ergebnis = await ergebnisDesLaufs(github, lauf.id);
      if (ergebnis?.branch === branch) return uebernehmbare(ergebnis);
    }
    if (laeufe.length < PRO_SEITE) return new Map();
  }
}
