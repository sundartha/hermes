import { gitAusgabe } from "./pruefer-auswahl.mjs";
import { DATEI_MODI, dateienImBaum } from "./pruefer-importe.mjs";

const NUL = "\0";
const RAW_KOPF = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/;
const MIT_ZWEI_PFADEN = new Set(["R", "C"]);
const UMBENANNT = "R";
const PFADE_BEI_PAAR = 2;
const PFADE_EINZELN = 1;
const VOLLE_AEHNLICHKEIT = "100";
const RAW_OPTIONEN = ["diff-tree", "-r", "-z", "--no-commit-id", "--no-abbrev", "--find-renames=100%"];

function rohEintraege(ausgabe) {
  const felder = ausgabe.split(NUL);
  const eintraege = [];
  let stelle = 0;
  while (stelle < felder.length - 1) {
    const kopf = RAW_KOPF.exec(felder[stelle]);
    if (kopf === null) return null;
    const [, altModus, neuModus, altBlob, neuBlob, status, aehnlichkeit] = kopf;
    const anzahl = MIT_ZWEI_PFADEN.has(status) ? PFADE_BEI_PAAR : PFADE_EINZELN;
    const pfade = felder.slice(stelle + 1, stelle + 1 + anzahl);
    eintraege.push({ altModus, neuModus, altBlob, neuBlob, status, aehnlichkeit, pfade });
    stelle += 1 + pfade.length;
  }
  return eintraege;
}

function istByteGleich({ altModus, neuModus, altBlob, neuBlob, status, aehnlichkeit }) {
  const gleicherModus = altModus === neuModus && DATEI_MODI.has(altModus);
  return status === UMBENANNT && aehnlichkeit === VOLLE_AEHNLICHKEIT && gleicherModus && altBlob === neuBlob;
}

function blobsIm(stand, root) {
  return new Map(dateienImBaum(stand, root).map(({ pfad, objekt }) => [pfad, objekt]));
}

function imBaumBelegt(paare, { vorher, nachher, root }) {
  if (paare.length === 0) return [];
  const [davor, danach] = [blobsIm(vorher, root), blobsIm(nachher, root)];
  return paare.filter(
    ({ alt, neu, blob }) => davor.get(alt) === blob && danach.get(neu) === blob && !danach.has(alt) && !davor.has(neu),
  );
}

export function reineUmbenennungen({ vorher, nachher }, root) {
  const staende = vorher === undefined ? [nachher] : [vorher, nachher];
  const roh = gitAusgabe([...RAW_OPTIONEN, ...staende], root, { kodierung: "buffer" });
  const text = roh.toString("utf8");
  const eintraege = Buffer.from(text).equals(roh) ? rohEintraege(text) : null;
  if (eintraege === null) return { paare: [], uebrige: null };
  const kandidaten = eintraege
    .filter(istByteGleich)
    .map(({ pfade: [alt, neu], neuBlob, neuModus }) => ({ alt, neu, blob: neuBlob, modus: neuModus }));
  const paare = imBaumBelegt(kandidaten, { vorher: vorher ?? `${nachher}^`, nachher, root });
  const verkuerzt = new Set(paare.flatMap(({ alt, neu }) => [alt, neu]));
  const uebrige = eintraege.flatMap(({ pfade }) => pfade).filter((pfad) => !verkuerzt.has(pfad));
  return { paare, uebrige };
}

export function umbenennungsZeile({ alt, neu, blob, modus }) {
  return `umbenannt, Inhalt gleich: ${JSON.stringify(alt)} → ${JSON.stringify(neu)} (Blob ${blob}, Modus ${modus})\n`;
}
