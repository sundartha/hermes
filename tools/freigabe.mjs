import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPROVERS, alleSeiten, api, ereignis, geaenderteDateien, inhaltAn } from "./github.mjs";

const BAU_AGENT = "sundartha-agent[bot]";
const PRODUKTCODE = "src/";
const FREIGEGEBEN = "APPROVED";
const KURZ = 7;
const SYSTEM_BRANCH = /^(?:system|dependabot)\//;
const PRUEFREGELN = [
  /^tools\/(?:bereiche|bausteine)\.json$/,
  /^tools\/(?:basis|eslint-rules)\//,
  /^tools\/(?:freigabe|github)\.mjs$/,
  /^eslint\.config\./,
  /^eslint-suppressions[^/]*\.json$/,
  /^\.dependency-cruiser\.cjs$/,
  /^gitleaks\.toml$/,
  /^(?:\.github|\.claude)\//,
  /^CLAUDE\.md$/,
];
const SCHRANKE_AUSWEG = "Prüfregeln ändert nur Engineering, auf einem Branch system/*. Fehlt dir ein Weg im Test, schreibe ihn über den Eingang des Bereichs oder halte an und melde es im Issue.";
const EXIT_ROT = 1;

function letzteUrteile(reviews) {
  const jeAutor = new Map();
  for (const review of reviews) {
    if (APPROVERS.includes(review.user?.login) && review.state !== "COMMENTED") jeAutor.set(review.user.login, review);
  }
  return [...jeAutor.values()];
}

export function herkunftBefunde(pull, dateien) {
  const aendertSrc = dateien.some(({ pfad }) => pfad.startsWith(PRODUKTCODE));
  if (!aendertSrc || pull.user?.login === BAU_AGENT) return [];
  return [`Code unter ${PRODUKTCODE} kommt nur vom Bau-Agenten (${BAU_AGENT}); dieser PR ist von ${pull.user?.login}.`];
}

function alsJson(text) {
  return text === undefined ? undefined : JSON.parse(text);
}

function unterdrueckungenJeRegel(daten) {
  const summe = {};
  for (const regeln of Object.values(daten ?? {})) {
    for (const [regel, { count }] of Object.entries(regeln)) summe[regel] = (summe[regel] ?? 0) + count;
  }
  return summe;
}

function waechstUnterdrueckung(basis, kopf, pfad) {
  const vorher = unterdrueckungenJeRegel(alsJson(inhaltAn(basis, pfad)));
  const nachher = unterdrueckungenJeRegel(alsJson(inhaltAn(kopf, pfad)));
  return Object.entries(nachher).some(([regel, anzahl]) => anzahl > (vorher[regel] ?? 0));
}

function bausteinJeQuelle(daten) {
  const karte = new Map();
  for (const { baustein, quellen } of daten?.bausteine ?? []) for (const quelle of quellen) karte.set(quelle, baustein);
  return karte;
}

function ohneQuellen(daten) {
  return JSON.stringify({ ...daten, bausteine: (daten?.bausteine ?? []).map((eintrag) => Object.fromEntries(Object.entries(eintrag).filter(([schluessel]) => schluessel !== "quellen"))) });
}

function aendertBestandBausteine({ basis, kopf, dateien }) {
  const angelegt = new Set(dateien.filter(({ status }) => status === "A").map(({ pfad }) => pfad));
  const vorher = alsJson(inhaltAn(basis, "tools/bausteine.json"));
  const nachher = alsJson(inhaltAn(kopf, "tools/bausteine.json"));
  const neu = bausteinJeQuelle(nachher);
  const alt = bausteinJeQuelle(vorher);
  const bestandErhalten = [...alt].every(([quelle, baustein]) => neu.get(quelle) === baustein);
  const nurNeueDateien = [...neu.keys()].every((quelle) => alt.has(quelle) || angelegt.has(quelle));
  return !bestandErhalten || !nurNeueDateien || ohneQuellen(vorher) !== ohneQuellen(nachher);
}

export function schrankeBefunde({ branch, dateien, basis, kopf }) {
  if (SYSTEM_BRANCH.test(branch ?? "")) return [];
  return dateien
    .filter(({ pfad }) => PRUEFREGELN.some((muster) => muster.test(pfad)))
    .filter(({ pfad }) => {
      if (/^eslint-suppressions[^/]*\.json$/.test(pfad)) return waechstUnterdrueckung(basis, kopf, pfad);
      if (pfad === "tools/bausteine.json") return aendertBestandBausteine({ basis, kopf, dateien });
      return true;
    })
    .map(({ pfad }) => `${pfad}: Prüfregel auf Branch ${branch}. ${SCHRANKE_AUSWEG}`);
}

export function freigabeBefunde(pull, reviews, dateien) {
  const kopf = pull.head.sha;
  const ergebnis = herkunftBefunde(pull, dateien);
  const freigaben = letzteUrteile(reviews).filter(({ state, commit_id: stand }) => state === FREIGEGEBEN && stand === kopf);
  if (freigaben.length === 0) {
    ergebnis.push(`Es fehlt das KI-Urteil: ein Approve von ${APPROVERS.join(" oder ")} auf dem Stand ${kopf.slice(0, KURZ)}.`);
  } else {
    console.log(`Freigegeben von ${freigaben.map(({ user }) => user.login).join(" und ")} auf ${kopf.slice(0, KURZ)}.`);
  }
  return ergebnis;
}

export function befundeFuerLauf({ pull, reviews, dateien, imQueue, basis, kopf }) {
  const schranke = schrankeBefunde({ branch: pull.head.ref, dateien, basis, kopf });
  return [...schranke, ...(imQueue ? freigabeBefunde(pull, reviews, dateien) : herkunftBefunde(pull, dateien))];
}

async function main() {
  if (process.argv[2] === "schranke") {
    const [, , , branch, basis] = process.argv;
    const gefunden = schrankeBefunde({ branch, dateien: geaenderteDateien(basis, undefined), basis, kopf: undefined });
    for (const zeile of gefunden) console.log(zeile);
    process.exitCode = gefunden.length > 0 ? EXIT_ROT : 0;
    return;
  }
  const { pr, basis, kopf } = ereignis();
  const pull = await api(`/pulls/${pr}`);
  const reviews = await alleSeiten(`/pulls/${pr}/reviews`);
  const dateien = geaenderteDateien(basis, kopf);
  const imQueue = kopf !== undefined;
  if (!imQueue) console.log("Das KI-Urteil wird erst in der Merge-Queue verlangt.");
  const gefunden = befundeFuerLauf({ pull, reviews, dateien, imQueue, basis, kopf });
  for (const zeile of gefunden) console.log(zeile);
  if (gefunden.length > 0) process.exitCode = EXIT_ROT;
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
