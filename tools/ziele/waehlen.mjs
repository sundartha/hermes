import { existsSync } from "node:fs";
import { join } from "node:path";

import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";
import {
  BLOCKIERT,
  SAUBER,
  WEITER,
  ergebnisVon,
  leseJson,
  schreibeJson,
  setzeAusgaben,
} from "./ausgabe.mjs";
import { befundZeiten } from "./befunde.mjs";
import { nimmGithubZugang } from "./github.mjs";
import { pausierteSorten } from "./pause.mjs";
import { eigenePrs } from "./prs.mjs";
import { istUnterdrueckt, kandidatenGrund, schutzLage, testsFuer } from "./schutz.mjs";
import {
  ALTFUNKTION,
  BASIS,
  BASIS_WERKZEUGE,
  JSCPD,
  KNIP,
  SORTEN,
  basisVergleich,
  befundeDer,
  entfernbareNamen,
  istDuplikat,
  nurHierGenannt,
} from "./sorten.mjs";
import { DATEI as VORPRUEFUNG, ORDNER, masterSha } from "./vorpruefen.mjs";

export const DATEI = "ziel.json";
const MAX_KANDIDATEN = 10;

export function reihum(letzteSorte) {
  const start = SORTEN.indexOf(letzteSorte) + 1;
  return [...SORTEN.slice(start), ...SORTEN.slice(0, start)];
}

function letzteAenderung(root, datei) {
  return Date.parse(gitAusgabe(["log", "-1", "--format=%cI", "--", datei], root).trim());
}

export function ausgeschlosseneDateien(zeiten, root) {
  return [...zeiten].filter(([datei, zeit]) => !(letzteAenderung(root, datei) > zeit)).map(([datei]) => datei);
}

export function verworfeneZiele(prs, root) {
  const geschlossen = prs.filter((pr) => !pr.offen && !pr.gemergt && pr.datei !== "");
  const juenger = geschlossen.filter((pr) => Date.parse(pr.geschlossen || pr.erstellt) > letzteAenderung(root, pr.datei));
  return new Set(juenger.map(({ sorte, datei }) => `${sorte}|${datei}`));
}

function gesperrt(sorte, datei, { ausgeschlossen, verworfen }) {
  return ausgeschlossen.includes(datei) || verworfen.has(`${sorte}|${datei}`);
}

function istKandidat(sorte, [datei, liste], kontext) {
  const { root, schutz } = kontext;
  const frei = existsSync(join(root, datei)) && kandidatenGrund(datei, schutz) === null;
  if (!frei || gesperrt(sorte, datei, kontext)) return false;
  if (sorte === ALTFUNKTION) return true;
  const agentErlaubt = !istUnterdrueckt(datei, schutz);
  if (sorte === JSCPD) return agentErlaubt;
  const duplikateErlaubt = agentErlaubt || !liste.some(istDuplikat);
  return sorte !== KNIP || (duplikateErlaubt && liste.every((eintrag) => nurHierGenannt(root, datei, eintrag)));
}

function zielText(root, datei, eintrag) {
  if (!istDuplikat(eintrag)) return eintrag.text;
  return `${eintrag.text} (entfernbar: ${entfernbareNamen(root, datei, eintrag).join(", ")})`;
}

function brennpunkt(root, datei) {
  return Number(gitAusgabe(["rev-list", "--count", "HEAD", "--", datei], root).trim());
}

function altfunktionKandidat([datei, [ziel]], { root, schutz }) {
  const zielbefunde = [ziel.text];
  return { datei, zielbefunde, arten: [ziel.art], agentErlaubt: true, tests: testsFuer(datei, schutz), funktion: ziel.funktion, aenderungen: brennpunkt(root, datei) };
}

function kandidat([datei, liste], { root, schutz }) {
  return {
    datei,
    zielbefunde: liste.map((eintrag) => zielText(root, datei, eintrag)),
    arten: liste.map(({ art }) => art),
    agentErlaubt: !istUnterdrueckt(datei, schutz),
    tests: testsFuer(datei, schutz),
  };
}

function vorrang(links, rechts) {
  const haeufiger = (rechts.aenderungen ?? 0) - (links.aenderungen ?? 0);
  if (haeufiger !== 0) return haeufiger;
  const mehr = rechts.zielbefunde.length - links.zielbefunde.length;
  return mehr === 0 ? links.datei.localeCompare(rechts.datei) : mehr;
}

export function kandidatenDer(sorte, kontext) {
  const befunde = [...befundeDer(sorte, kontext.root)].filter((eintrag) => istKandidat(sorte, eintrag, kontext));
  const bauen = sorte === ALTFUNKTION ? altfunktionKandidat : kandidat;
  return befunde.map((eintrag) => bauen(eintrag, kontext)).sort(vorrang);
}

function basisZiel(root, sperren) {
  for (const werkzeug of BASIS_WERKZEUGE) {
    const vergleich = basisVergleich(werkzeug, root);
    if (!vergleich.gruen) throw new Error(`basis-vergleich ${werkzeug} ist auf master rot:\n${vergleich.ausgabe}`);
    if (vergleich.behoben.length > 0 && !gesperrt(BASIS, vergleich.datei, sperren)) {
      const eintrag = { datei: vergleich.datei, zielbefunde: vergleich.behoben, arten: [werkzeug], agentErlaubt: false, tests: [] };
      return { sorte: BASIS, ...eintrag, kandidaten: [eintrag] };
    }
  }
  return null;
}

async function reihumZiel({ root, pausiert, prs, sperren }) {
  const letzte = prs.find((pr) => pr.sorte !== BASIS)?.sorte;
  const kontext = { root, schutz: await schutzLage(root), ...sperren };
  const uebersprungen = [];
  for (const sorte of reihum(letzte)) {
    if (pausiert.has(sorte)) {
      uebersprungen.push(`${sorte} pausiert: ${pausiert.get(sorte)}`);
      continue;
    }
    const kandidaten = kandidatenDer(sorte, kontext).slice(0, MAX_KANDIDATEN);
    if (kandidaten.length > 0) return { ziel: { sorte, ...kandidaten[0], kandidaten }, uebersprungen };
    uebersprungen.push(`${sorte} ohne Kandidaten`);
  }
  return { ziel: null, uebersprungen };
}

export async function waehle({ github, root }) {
  const master = masterSha(root);
  const { pausiert, befunde } = await pausierteSorten({ github, root });
  const prs = await eigenePrs(github, "all");
  const sperren = { ausgeschlossen: ausgeschlosseneDateien(await befundZeiten(github), root), verworfen: verworfeneZiele(prs, root) };
  const basis = pausiert.has(BASIS) ? null : basisZiel(root, sperren);
  const { ziel, uebersprungen } = basis ? { ziel: basis, uebersprungen: [] } : await reihumZiel({ root, pausiert, prs, sperren });
  if (pausiert.has(BASIS)) uebersprungen.unshift(`${BASIS} pausiert: ${pausiert.get(BASIS)}`);
  if (ziel) return { ...ergebnisVon(WEITER, ""), master, ...ziel, befunde, uebersprungen };
  const ausgang = pausiert.size > 0 ? BLOCKIERT : SAUBER;
  const grund = uebersprungen.join("; ") || "kein Ziel";
  return { ...ergebnisVon(ausgang, grund), master, befunde, uebersprungen };
}

export async function befehl({ ordner }, root, { github = nimmGithubZugang() } = {}) {
  const vorpruefung = leseJson(join(ordner, ORDNER), VORPRUEFUNG);
  if (vorpruefung?.ausgang !== WEITER) throw new Error("die Vorprüfung hat nicht „weiter“ ergeben");
  const ergebnis = await waehle({ github, root });
  schreibeJson(join(ordner, ORDNER), DATEI, ergebnis);
  setzeAusgaben({ ausgang: ergebnis.ausgang, grund: ergebnis.grund, sorte: ergebnis.sorte ?? "", datei: ergebnis.datei ?? "" });
  console.log(`Ziel: ${ergebnis.ausgang}${ergebnis.datei ? ` ${ergebnis.sorte} in ${ergebnis.datei}` : ""}${ergebnis.grund ? ` (${ergebnis.grund})` : ""}`);
  return 0;
}
