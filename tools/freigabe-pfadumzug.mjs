import { isDeepStrictEqual } from "node:util";

import {
  FRIST_LISTE,
  abhaengigkeitenUmgezogen,
  fristListeNachUmzug,
  schluesselUmgezogen,
} from "./auftrag/listen-eintraege-umzug.mjs";
import { UNTERDRUECKUNGEN, auslagerungsHerkunft, listeNachAuslagerung } from "./auslagerung-eintraege.mjs";
import { fileAt, git } from "./pruefungen-messen.mjs";

const UMBENANNT = /^R\d*$/;
const ZWEI_PFADE = /^[RC]/;
const KOPF = "HEAD";

function istObjekt(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

const LISTEN = new Map([
  ["eslint-suppressions.json", { passt: istObjekt, umziehen: schluesselUmgezogen }],
  [
    "tools/basis/test-importe.json",
    {
      passt: (liste) => Array.isArray(liste) && liste.every(istObjekt),
      umziehen: abhaengigkeitenUmgezogen,
    },
  ],
]);

function umbenennungen(basis) {
  const felder = git(["diff", "-M", "--name-status", "-z", basis, KOPF])
    .split("\0")
    .filter((feld) => feld !== "");
  const neuFuer = new Map();
  while (felder.length > 0) {
    const status = felder.shift();
    const alt = felder.shift();
    const neu = ZWEI_PFADE.test(status) ? felder.shift() : alt;
    const bestaetigt =
      UMBENANNT.test(status) &&
      fileAt(basis, alt) !== undefined &&
      fileAt(KOPF, alt) === undefined &&
      fileAt(KOPF, neu) !== undefined;
    if (bestaetigt) neuFuer.set(alt, neu);
  }
  return neuFuer;
}

function gelesen(commit, pfad) {
  try {
    return JSON.parse(fileAt(commit, pfad));
  } catch {
    return undefined;
  }
}

function nurUmgezogen(basis, pfad, neuFuer) {
  const { passt, umziehen } = LISTEN.get(pfad);
  const [vorher, nachher] = [basis, KOPF].map((commit) => gelesen(commit, pfad));
  if (!passt(vorher) || !passt(nachher)) return false;
  const umgezogen = umziehen(vorher, { neuFuer });
  return !isDeepStrictEqual(umgezogen, vorher) && isDeepStrictEqual(umgezogen, nachher);
}

export function pfadumzuege(basis, changes) {
  const geaendert = changes.map(({ path }) => path).filter((pfad) => LISTEN.has(pfad));
  if (geaendert.length === 0) return new Set();
  const neuFuer = umbenennungen(basis);
  if (neuFuer.size === 0) return new Set();
  return new Set(geaendert.filter((pfad) => nurUmgezogen(basis, pfad, neuFuer)));
}

async function auslagerungNachgerechnet(basis, root) {
  const [vorher, nachher] = [basis, KOPF].map((commit) => gelesen(commit, UNTERDRUECKUNGEN));
  if (!istObjekt(vorher) || !istObjekt(nachher)) return false;
  const herkunft = await auslagerungsHerkunft({ von: basis, bis: KOPF }, root);
  const liste = await listeNachAuslagerung(vorher, herkunft, root);
  return liste !== undefined && !isDeepStrictEqual(liste, vorher) && isDeepStrictEqual(liste, nachher);
}

export async function auslagerungsumzuege(basis, changes) {
  if (!changes.some(({ path }) => path === UNTERDRUECKUNGEN)) return new Set();
  try {
    return (await auslagerungNachgerechnet(basis, process.cwd())) ? new Set([UNTERDRUECKUNGEN]) : new Set();
  } catch {
    return new Set();
  }
}

async function fristEintraegeNachgerechnet(basis, root) {
  const [vorher, nachher] = [basis, KOPF].map((commit) => gelesen(commit, FRIST_LISTE));
  if (!istObjekt(vorher) || !istObjekt(nachher) || !Array.isArray(vorher.befunde)) return false;
  const umgezogen = await fristListeNachUmzug({ liste: vorher.befunde, basis, root });
  return umgezogen !== undefined && isDeepStrictEqual({ ...vorher, befunde: umgezogen.neu }, nachher);
}

export async function fristumzuege(basis, changes) {
  if (!changes.some(({ path }) => path === FRIST_LISTE)) return new Set();
  try {
    return (await fristEintraegeNachgerechnet(basis, process.cwd())) ? new Set([FRIST_LISTE]) : new Set();
  } catch {
    return new Set();
  }
}
