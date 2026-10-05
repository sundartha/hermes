import { issueTitel } from "./pruefer-issues.mjs";
import {
  BLOCKER,
  GEPRUEFT,
  UNVOLLSTAENDIG,
  reproduzierbareBlocker,
  schluesselVon,
} from "./pruefer-schema.mjs";

export const KONTEXT = "Prüfer";
const MAX_BESCHREIBUNG = 140;
const AUSLASSUNG = "…";
const ERWARTUNG = "erwartung";
const FEHLER = "error";
const ROT = "failure";
const WARTET = "pending";
const GRUEN = "success";

function grundDes(commit) {
  return commit.zustand === UNVOLLSTAENDIG ? `unvollständig, ${commit.grund}` : commit.grund;
}

function geprueft(commits) {
  return commits.filter(({ zustand }) => zustand === GEPRUEFT);
}

function bestaetigt(eintrag) {
  return eintrag?.pr === ERWARTUNG && eintrag.basis !== ERWARTUNG;
}

function erfolg({ commits }) {
  if (commits.length === 0) return { state: GRUEN, description: "keine zu prüfenden Commits" };
  const uebernommen = commits.filter((commit) => commit.uebernommen).length;
  return {
    state: GRUEN,
    description: `${commits.length - uebernommen} Commits geprüft, ${uebernommen} übernommen`,
  };
}

function ohneNachstellung({ blocker, nachstellung }) {
  const offen = blocker.find(({ schluessel }) => !nachstellung?.has(schluessel));
  if (!offen) return null;
  if (nachstellung === null) return { state: WARTET, description: "Reproduktion läuft" };
  return { state: FEHLER, description: `Nachstellung fehlt: ${offen.datei}` };
}

const REGELN = [
  ({ probeBranch }) =>
    probeBranch ? { state: FEHLER, description: "Probe-Branch, nicht geprüft" } : null,
  ({ commits }) => {
    const offen = commits.find(({ zustand }) => zustand !== GEPRUEFT);
    return offen
      ? { state: FEHLER, description: `Prüfer nicht gelaufen: ${grundDes(offen)}` }
      : null;
  },
  ({ commits }) => {
    const sicherheit = commits.some(({ befunde }) => befunde.some((befund) => befund.sicherheit));
    return sicherheit
      ? { state: ROT, description: "Sicherheitsbefund, Details nicht öffentlich" }
      : null;
  },
  ({ blocker, nachstellung }) => {
    const treffer = blocker.find(({ schluessel }) => bestaetigt(nachstellung?.get(schluessel)));
    return treffer ? { state: ROT, description: `BLOCKER bestätigt: ${treffer.datei}` } : null;
  },
  ohneNachstellung,
  erfolg,
];

function gekuerzteBeschreibung({ state, description }) {
  const text =
    description.length > MAX_BESCHREIBUNG
      ? `${description.slice(0, MAX_BESCHREIBUNG - 1)}${AUSLASSUNG}`
      : description;
  return { state, description: text };
}

function blockerGrund(befund, eintrag) {
  if (befund.reproduktion.trim() === "") return "verworfen: ohne Reproduktion";
  if (eintrag === undefined || bestaetigt(eintrag)) return null;
  if (eintrag.pr === ERWARTUNG) return "schon auf master";
  return `verworfen: Reproduktion ${eintrag.pr}`;
}

function issueGrund(befund, eintrag) {
  if (befund.sicherheit || befund.id.trim() === "") return null;
  return befund.schwere === BLOCKER ? blockerGrund(befund, eintrag) : "";
}

function issuesDes(commit, nachstellung) {
  return commit.befunde.flatMap((befund, index) => {
    const grund = issueGrund(befund, nachstellung?.get(schluesselVon(commit.sha, index)));
    if (grund === null) return [];
    return [{ titel: issueTitel(befund), sha: commit.sha, befund, grund }];
  });
}

function ohneDoppelte(issues) {
  const titel = new Set();
  return issues.filter((issue) => !titel.has(issue.titel) && titel.add(issue.titel));
}

export function urteile({ probeBranch = false, commits, nachstellung = null }) {
  const lage = {
    probeBranch,
    commits,
    nachstellung,
    blocker: reproduzierbareBlocker({ commits: geprueft(commits) }),
  };
  const status = REGELN.map((regel) => regel(lage)).find(Boolean);
  const issues = probeBranch
    ? []
    : ohneDoppelte(geprueft(commits).flatMap((commit) => issuesDes(commit, nachstellung)));
  return { ...gekuerzteBeschreibung(status), issues };
}
