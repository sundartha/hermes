import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";

import { dateiAm } from "./auftrag/git.mjs";
import { stammtAusAltemText } from "./auslagerung-eintraege.mjs";

const REGEL = "hermes/wort-nur-in";
const OHNE_UNTERDRUECKUNGEN = "eslint-suppressions.empty.json";
const FEHLER = 2;

async function optionen(eslint, root, datei) {
  const konfiguration = await eslint.calculateConfigForFile(join(root, datei));
  const regel = konfiguration?.rules?.[REGEL];
  return Array.isArray(regel) ? regel.slice(1) : [];
}

function getroffeneZeilen(text, meldungen, name) {
  const zeilen = text.split("\n");
  const treffer = meldungen.filter(
    ({ severity, message }) => severity === FEHLER && message.startsWith(`${name}: `),
  );
  return treffer.map(({ line }) => zeilen[line - 1]);
}

async function zeilenInDerNeuenDatei(wurzeln, { datei, name }) {
  const eslint = new ESLint({
    cwd: wurzeln.hilfe,
    suppressionsLocation: join(wurzeln.hilfe, OHNE_UNTERDRUECKUNGEN),
  });
  const [{ messages }] = await eslint.lintFiles([join(wurzeln.hilfe, datei)]);
  const text = readFileSync(join(wurzeln.hilfe, datei), "utf8");
  return getroffeneZeilen(text, messages, name);
}

async function zeilenInDerAltenDatei(wurzeln, { pfad, name }) {
  const text = dateiAm(wurzeln.basis, pfad, wurzeln.pr);
  if (text === null) return [];
  const eslint = wurzeln.eslint.get(wurzeln.pr);
  const [{ messages }] = await eslint.lintText(text, { filePath: join(wurzeln.pr, pfad) });
  return getroffeneZeilen(text, messages, name);
}

async function vorratDerAlten(wurzeln, { weg, name }) {
  if (!wurzeln.vorrat.has(name)) {
    const jeDatei = await Promise.all(
      weg.map((pfad) => zeilenInDerAltenDatei(wurzeln, { pfad, name })),
    );
    wurzeln.vorrat.set(name, jeDatei.flat());
  }
  return wurzeln.vorrat.get(name);
}

function gleicheZeile(links, rechts) {
  return stammtAusAltemText(links, rechts) && stammtAusAltemText(rechts, links);
}

function ohneZugeordnete(vorrat, zeilen) {
  const frei = [...vorrat];
  for (const zeile of zeilen) {
    const stelle = frei.findIndex((alte) => gleicheZeile(zeile, alte));
    if (stelle === -1) return undefined;
    frei.splice(stelle, 1);
  }
  return frei;
}

function textNach(wurzeln, pfade) {
  const vorhanden = pfade.map((pfad) => join(wurzeln.pr, pfad)).filter(existsSync);
  return vorhanden.map((pfad) => readFileSync(pfad, "utf8")).join("\n");
}

async function umgezogeneTrefferJeEintrag(wurzeln, { name, weg, datei }) {
  const zeilen = await zeilenInDerNeuenDatei(wurzeln, { datei, name });
  const vorrat = await vorratDerAlten(wurzeln, { weg, name });
  const neu = textNach(wurzeln, weg);
  const stehtNochInDerAlten = (zeile) => stammtAusAltemText(zeile, neu);
  const rest = ohneZugeordnete(vorrat, zeilen);
  if (rest === undefined || zeilen.some(stehtNochInDerAlten)) return 0;
  wurzeln.vorrat.set(name, rest);
  return zeilen.length;
}

async function umgezogeneTrefferJeDatei(wurzeln, datei) {
  const [vorher, nachher] = await Promise.all(
    [wurzeln.hilfe, wurzeln.pr].map((root) => optionen(wurzeln.eslint.get(root), root, datei)),
  );
  let summe = 0;
  for (const { name, nurIn } of nachher.filter((eintrag) => eintrag.nurIn.includes(datei))) {
    const alt = vorher.find((eintrag) => eintrag.name === name)?.nurIn;
    if (alt?.length !== nurIn.length) continue;
    const weg = alt.filter((pfad) => !nurIn.includes(pfad));
    summe += await umgezogeneTrefferJeEintrag(wurzeln, { name, weg, datei });
  }
  return summe;
}

export async function ausnahmeUmzug({ basis, hilfe, pr, dateien }) {
  const eslint = new Map([hilfe, pr].map((root) => [root, new ESLint({ cwd: root })]));
  const wurzeln = { basis, hilfe, pr, eslint, vorrat: new Map() };
  let summe = 0;
  for (const datei of dateien.filter((pfad) => existsSync(join(hilfe, pfad))))
    summe += await umgezogeneTrefferJeDatei(wurzeln, datei);
  return summe;
}
