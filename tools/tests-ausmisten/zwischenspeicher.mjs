import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { version } from "node:process";

import { entpacke } from "../auftrag/pruefer-gedaechtnis.mjs";
import { BASIS, FORMAT, pruefeArtefakt, pruefsumme } from "./entscheiden.mjs";
import { festgehalteneSumme, jobsDesLaufs } from "./festgehalten.mjs";
import { KONTEXT, MESSUNG } from "./herkunft.mjs";
import { git } from "./pfade.mjs";

const WERKZEUG_PFADE = [
  "tools/tests-ausmisten.mjs",
  "tools/tests-ausmisten",
  "tools/mutationspruefung",
  "tools/testwirkung",
  "test/testbaenke-run.mjs",
  "stryker.config.json",
  "package.json",
  "package-lock.json",
];
const MAX_FRUEHERE_LAEUFE = 10;
const GELESENE_LAEUFE = 30;
const BASIS_NAME = /^basis-(\d+)$/;
const VOLLE_SHA = "[0-9a-f]{40}";
const UEBERNOMMEN = ["mutanten", "gate", "orte", "trockenlauf", "jeDatei", "ausgenommen"];

function inhalte(master, { pfade, verzeichnis }) {
  return pfade.map((pfad) => [pfad, git(["rev-parse", `${master}:${pfad}`], verzeichnis).trim()]);
}

export function basisSchluessel({ master, dateien, alt, teil, verzeichnis }) {
  const werkzeug = git(["ls-tree", "-r", master, "--", ...WERKZEUG_PFADE], verzeichnis);
  return pruefsumme(
    JSON.stringify({
      format: FORMAT,
      master,
      node: version,
      werkzeug: pruefsumme(werkzeug),
      dateien: inhalte(master, { pfade: dateien, verzeichnis }),
      tests: inhalte(master, { pfade: alt, verzeichnis }),
      teil,
    }),
  );
}

function uebernahme(daten, herkunft) {
  const werte = Object.fromEntries(UEBERNOMMEN.map((feld) => [feld, daten[feld]]));
  return { ...werte, schluessel: daten.schluessel, ...herkunft };
}

function kopfDes(text) {
  try {
    return JSON.parse(text)?.kopf;
  } catch {
    return undefined;
  }
}

function gepruefteBasis(text, { name, summe, lauf }) {
  const erwartet = { kopf: kopfDes(text), master: lauf.master, bereich: lauf.bereich };
  return pruefeArtefakt({ name, art: BASIS, text, summe, erwartet }).daten;
}

export function ausSpeicher(ordner, { schluessel, lauf }) {
  const datei = join(ordner, `${schluessel}.json`);
  if (!existsSync(datei)) return undefined;
  const text = readFileSync(datei, "utf8");
  const daten = gepruefteBasis(text, { name: "Zwischenspeicher", summe: pruefsumme(text), lauf });
  if (daten?.schluessel !== schluessel) return undefined;
  return uebernahme(daten, { lauf: "lokal", artefakt: datei });
}

export function inSpeicher(ordner, text) {
  const { schluessel } = JSON.parse(text);
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, `${schluessel}.json`), text);
}

async function fruehereLaeufe(github, { branch, laufId }) {
  const { workflow_runs: laeufe = [] } = await github.hole(
    `/actions/workflows/${MESSUNG.datei}/runs?per_page=${GELESENE_LAEUFE}`,
  );
  const titel = new RegExp(`^${KONTEXT} ${VOLLE_SHA} `);
  return laeufe
    .filter(
      ({ id, display_title: anzeige = "" }) =>
        String(id) !== String(laufId) && titel.test(anzeige) && anzeige.endsWith(` ${branch}`),
    )
    .slice(0, MAX_FRUEHERE_LAEUFE);
}

async function basisArtefakteDes(github, laufId) {
  const liste = await github.alle(
    `/actions/runs/${laufId}/artifacts`,
    (antwort) => antwort.artifacts,
  );
  const namen = liste.map(({ name }) => name);
  return liste.filter(
    ({ name }) => BASIS_NAME.test(name) && namen.indexOf(name) === namen.lastIndexOf(name),
  );
}

async function gefundenIn(github, { frueher, lauf, gesucht }) {
  const jobs = await jobsDesLaufs(github, frueher.id);
  const funde = new Map();
  for (const { id, name } of await basisArtefakteDes(github, frueher.id)) {
    const nummer = Number(BASIS_NAME.exec(name)[1]);
    const { summe } = await festgehalteneSumme(github, { jobs, nummer });
    if (summe === undefined) continue;
    const text = entpacke(await github.roh(`/actions/artifacts/${id}/zip`))
      .get(`${name}.json`)
      ?.toString("utf8");
    const daten = text === undefined ? undefined : gepruefteBasis(text, { name, summe, lauf });
    if (daten !== undefined && gesucht.has(daten.schluessel))
      funde.set(daten.schluessel, uebernahme(daten, { lauf: String(frueher.id), artefakt: name }));
  }
  return funde;
}

export async function ausFrueherenLaeufen(github, { lauf, laufId, schluessel }) {
  const gesucht = new Set(schluessel);
  const gefunden = new Map();
  for (const frueher of await fruehereLaeufe(github, { branch: lauf.branch, laufId })) {
    for (const [wert, eintrag] of await gefundenIn(github, { frueher, lauf, gesucht })) {
      if (!gefunden.has(wert)) gefunden.set(wert, eintrag);
    }
    if (schluessel.every((wert) => gefunden.has(wert))) break;
  }
  return schluessel.map((wert) => gefunden.get(wert) ?? null);
}
