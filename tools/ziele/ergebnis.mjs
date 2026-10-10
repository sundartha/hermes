import { join } from "node:path";
import { env } from "node:process";

import {
  BLOCKIERT,
  FORMAT,
  GEAENDERT,
  SAUBER,
  WEITER,
  einzeilig,
  laufAdresse,
  leseJson,
  schreibeJson,
  setzeAusgaben,
  zusammenfassung,
} from "./ausgabe.mjs";
import { IDS, befund, gueltigeBefunde, meldeBefunde } from "./befunde.mjs";
import { nimmGithubZugang } from "./github.mjs";
import { DURCHGANG_DATEI } from "./rangliste.mjs";
import { schreibeSammelIssue } from "./sammel.mjs";

export const ERGEBNIS_ORDNER = "ergebnis";
export const ERGEBNIS_DATEI = "ergebnis.json";
const MS_JE_SEKUNDE = 1000;
const MAX_GRUND = 300;
const AUSGAENGE = new Set([SAUBER, GEAENDERT, BLOCKIERT, WEITER]);
export const QUELLEN = {
  aufraeumen: [
    ["ziel", "vorpruefung.json", ["master", "start"]],
    ["ziel", "ziel.json", ["master", "sorte", "datei"]],
    ["agent", "agent.json", ["tokens", "zuege"]],
    ["pruefung", "pruefung.json", []],
    ["pr", "pr.json", ["pr", "autoMerge"]],
  ],
  auswertung: [
    ["zaehlung", "zaehlung.json", ["master", "start"]],
    ["vorschlag", "vorschlag.json", ["tokens", "zuege"]],
    ["issue", "issue.json", ["issue"]],
  ],
};

const PRUEFUNG = "pruefung";
const PR = "pr";

function erlaubterTeil(teil, { quelle, felder }) {
  if (teil === null || !AUSGAENGE.has(teil.ausgang)) return null;
  const weitere = Object.fromEntries(felder.filter((feld) => teil[feld] !== undefined).map((feld) => [feld, teil[feld]]));
  const befunde = Array.isArray(teil.befunde) ? teil.befunde : [];
  return { quelle, ausgang: teil.ausgang, grund: einzeilig(teil.grund).slice(0, MAX_GRUND), befunde, ...weitere };
}

function prBefunde(teile) {
  const bestanden = teile.some(({ quelle, ausgang }) => quelle === PRUEFUNG && ausgang === WEITER);
  const datei = teile.findLast((teil) => teil.datei)?.datei;
  if (!bestanden || !datei || teile.some(({ quelle }) => quelle === PR)) return [];
  return [befund(IDS.prAnlage, datei, "")];
}

function gescheiterteJobs() {
  try {
    const jobs = Object.entries(JSON.parse(env.JOB_ERGEBNISSE ?? "{}"));
    return jobs.filter(([, { result }]) => result === "failure" || result === "cancelled").map(([name, { result }]) => `${name}: ${result}`);
  } catch {
    return [];
  }
}

function summe(teile, feld) {
  return teile.reduce((zahl, teil) => zahl + (Number(teil[feld]) || 0), 0);
}

export function fuehreZusammen(teile, { workflow, jetzt }) {
  const entscheidend = teile.find(({ ausgang }) => ausgang !== WEITER);
  const gescheitert = gescheiterteJobs();
  const unvollstaendig = `Lauf unvollständig${gescheitert.length > 0 ? ` (${gescheitert.join(", ")})` : ""}`;
  const start = Date.parse(teile[0]?.start ?? "");
  const mit = (feld) => teile.findLast((teil) => teil[feld] !== undefined && teil[feld] !== null)?.[feld] ?? null;
  return {
    format: FORMAT,
    workflow,
    lauf: laufAdresse(),
    master: mit("master"),
    ausgang: entscheidend?.ausgang ?? BLOCKIERT,
    grund: entscheidend ? entscheidend.grund : unvollstaendig,
    sorte: mit("sorte"),
    datei: mit("datei"),
    pr: mit("pr"),
    autoMerge: mit("autoMerge"),
    issue: mit("issue"),
    tokens: summe(teile, "tokens"),
    zuege: summe(teile, "zuege"),
    dauerSekunden: Number.isFinite(start) ? Math.round((jetzt - start) / MS_JE_SEKUNDE) : null,
    befunde: gueltigeBefunde([...teile.flatMap((teil) => teil.befunde), ...prBefunde(teile)]),
  };
}

async function sammelIssue(github, { ordner, workflow, ergebnis }) {
  const durchgang = workflow === "aufraeumen" ? leseJson(join(ordner, "ziel"), DURCHGANG_DATEI) : null;
  if (durchgang === null) return "";
  try {
    const { nummer, art } = await schreibeSammelIssue(github, { durchgang, ergebnis });
    return `Sammel-Issue #${nummer} (${art})`;
  } catch (fehler) {
    console.error(`Sammel-Issue nicht geschrieben: ${fehler.message}`);
    return `Sammel-Issue nicht geschrieben: ${fehler.message}`;
  }
}

export async function befehl({ ordner, workflow }, root, { github = nimmGithubZugang() } = {}) {
  const quellen = QUELLEN[workflow];
  if (quellen === undefined) throw new Error(`unbekannter Workflow ${workflow}`);
  const teile = quellen.map(([quelle, name, felder]) => erlaubterTeil(leseJson(join(ordner, quelle), name), { quelle, felder })).filter(Boolean);
  const ergebnis = fuehreZusammen(teile, { workflow, jetzt: Date.now() });
  const gemeldet = await meldeBefunde(github, ergebnis.befunde, ergebnis.lauf);
  schreibeJson(join(ordner, ERGEBNIS_ORDNER), ERGEBNIS_DATEI, ergebnis);
  const sammel = await sammelIssue(github, { ordner, workflow, ergebnis });
  setzeAusgaben({ ausgang: ergebnis.ausgang });
  zusammenfassung([
    `## ${workflow === "aufraeumen" ? "Aufräumen" : "Auswertung"}: ${ergebnis.ausgang}`,
    "",
    ergebnis.grund ? `Grund: ${ergebnis.grund}` : "",
    ergebnis.datei ? `Ziel: ${ergebnis.sorte} in \`${ergebnis.datei}\`` : "",
    ergebnis.pr ? `PR: #${ergebnis.pr}` : "",
    ergebnis.issue ? `Issue: #${ergebnis.issue}` : "",
    `Tokens ${ergebnis.tokens}, Züge ${ergebnis.zuege}, Dauer ${ergebnis.dauerSekunden ?? "?"} s`,
    ...gemeldet.map(({ nummer, art }) => `Befund-Issue #${nummer} (${art})`),
    sammel,
  ].filter(Boolean));
  return 0;
}
