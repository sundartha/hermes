import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";

import { dateiAm } from "./auftrag/git.mjs";
import { stammtAusAltemText } from "./auslagerung-eintraege.mjs";
import { nurWeiterleitungenAuf, waechstNurUm } from "./ausnahme-weiterleitung.mjs";

const REGEL = "hermes/wort-nur-in";
const OHNE_UNTERDRUECKUNGEN = "eslint-suppressions.empty.json";
const FEHLER = 2;
const OHNE_KONFIGURATION = "config-file-missing";

async function konfigurationDer(eslint, root, datei) {
  try {
    return await eslint.calculateConfigForFile(join(root, datei));
  } catch (fehler) {
    if (fehler.messageTemplate === OHNE_KONFIGURATION) return undefined;
    throw fehler;
  }
}

async function regelDer(eslint, root, datei) {
  const konfiguration = await konfigurationDer(eslint, root, datei);
  const regel = konfiguration?.rules?.[REGEL];
  return Array.isArray(regel) ? regel : [];
}

async function optionen(eslint, root, datei) {
  return (await regelDer(eslint, root, datei)).slice(1);
}

function getroffene(meldungen, name) {
  return meldungen.filter(
    ({ severity, message }) => severity === FEHLER && message.startsWith(`${name}: `),
  );
}

function getroffeneZeilen(text, meldungen, name) {
  const zeilen = text.split("\n");
  return getroffene(meldungen, name).map(({ line }) => zeilen[line - 1]);
}

function eslintOhneUnterdrueckungen(root) {
  return new ESLint({ cwd: root, suppressionsLocation: join(root, OHNE_UNTERDRUECKUNGEN) });
}

async function zeilenInDerNeuenDatei(wurzeln, { datei, name }) {
  const eslint = eslintOhneUnterdrueckungen(wurzeln.hilfe);
  const [{ messages }] = await eslint.lintFiles([join(wurzeln.hilfe, datei)]);
  const text = readFileSync(join(wurzeln.hilfe, datei), "utf8");
  return getroffeneZeilen(text, messages, name);
}

async function zeilenImBasisText(eslint, { root, pfad, text, name }) {
  if (text === null) return [];
  const [{ messages }] = await eslint.lintText(text, { filePath: join(root, pfad) });
  return getroffeneZeilen(text, messages, name);
}

function zeilenInDerAltenDatei(wurzeln, { pfad, name }) {
  const text = dateiAm(wurzeln.basis, pfad, wurzeln.pr);
  const eslint = wurzeln.eslint.get(wurzeln.pr);
  return zeilenImBasisText(eslint, { root: wurzeln.pr, pfad, text, name });
}

async function bestandstrefferDerZieldatei(wurzeln, { text, datei, name }) {
  const eslint = eslintOhneUnterdrueckungen(wurzeln.hilfe);
  const zeilen = await zeilenImBasisText(eslint, { root: wurzeln.hilfe, pfad: datei, text, name });
  return zeilen.length;
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

async function zieldateiOhneBestandstreffer(wurzeln, { zeilen, datei, name }) {
  const bestand = dateiAm(wurzeln.basis, datei, wurzeln.pr);
  if (zeilen.some((zeile) => stammtAusAltemText(zeile, bestand))) return false;
  return (await bestandstrefferDerZieldatei(wurzeln, { text: bestand, datei, name })) === 0;
}

async function verbraucheUmgezogeneTreffer(wurzeln, { name, weg, datei }) {
  const zeilen = await zeilenInDerNeuenDatei(wurzeln, { datei, name });
  const vorrat = await vorratDerAlten(wurzeln, { weg, name });
  const neu = textNach(wurzeln, weg);
  const stehtNochInDerAlten = (zeile) => stammtAusAltemText(zeile, neu);
  const rest = ohneZugeordnete(vorrat, zeilen);
  if (rest === undefined || zeilen.some(stehtNochInDerAlten)) return 0;
  if (!(await zieldateiOhneBestandstreffer(wurzeln, { zeilen, datei, name }))) return 0;
  wurzeln.vorrat.set(name, rest);
  return zeilen.length;
}

async function eslintOhneAusnahme(wurzeln, { quelle, name }) {
  const [stufe, ...eintraege] = await regelDer(
    wurzeln.eslint.get(wurzeln.hilfe),
    wurzeln.hilfe,
    quelle,
  );
  const ohneQuelle = (eintrag) =>
    eintrag.name === name
      ? { ...eintrag, nurIn: eintrag.nurIn.filter((pfad) => pfad !== quelle) }
      : eintrag;
  return new ESLint({
    cwd: wurzeln.hilfe,
    suppressionsLocation: join(wurzeln.hilfe, OHNE_UNTERDRUECKUNGEN),
    overrideConfig: [
      { files: [quelle], rules: { [REGEL]: [stufe, ...eintraege.map(ohneQuelle)] } },
    ],
  });
}

async function treffer(eslint, { wurzeln, quelle, text, name }) {
  const [{ messages }] = await eslint.lintText(text, { filePath: join(wurzeln.hilfe, quelle) });
  return getroffene(messages, name);
}

async function leitetNurWeiter(wurzeln, { quelle, datei, name, zeilen }) {
  const alt = dateiAm(wurzeln.basis, quelle, wurzeln.pr);
  const neu = readFileSync(join(wurzeln.pr, quelle), "utf8");
  if (alt === null || zeilen.some((zeile) => stammtAusAltemText(zeile, neu))) return false;
  const eslint = await eslintOhneAusnahme(wurzeln, { quelle, name });
  const vorher = await treffer(eslint, { wurzeln, quelle, text: alt, name });
  const nachher = await treffer(eslint, { wurzeln, quelle, text: neu, name });
  const vorrat = vorher.map(({ line }) => alt.split("\n")[line - 1]);
  if (nachher.length > vorher.length || ohneZugeordnete(vorrat, zeilen) === undefined) return false;
  return nurWeiterleitungenAuf({
    ...{ root: wurzeln.hilfe, eslint: wurzeln.eslint.get(wurzeln.hilfe), text: neu },
    ...{ meldungen: nachher, quelle, ziel: datei },
  });
}

async function verbraucheWeitergeleiteteTreffer(wurzeln, { name, alt, datei }) {
  const zeilen = await zeilenInDerNeuenDatei(wurzeln, { datei, name });
  if (!(await zieldateiOhneBestandstreffer(wurzeln, { zeilen, datei, name }))) return 0;
  const quellen = alt.filter(
    (pfad) => wurzeln.dateien.includes(pfad) && existsSync(join(wurzeln.pr, pfad)),
  );
  for (const quelle of quellen) {
    if (await leitetNurWeiter(wurzeln, { quelle, datei, name, zeilen })) return zeilen.length;
  }
  return 0;
}

async function umgezogenNach(wurzeln, { name, alt, nurIn, datei }) {
  if (alt === undefined) return 0;
  if (alt.length === nurIn.length) {
    const weg = alt.filter((pfad) => !nurIn.includes(pfad));
    return verbraucheUmgezogeneTreffer(wurzeln, { name, weg, datei });
  }
  if (!waechstNurUm(alt, nurIn, datei)) return 0;
  return verbraucheWeitergeleiteteTreffer(wurzeln, { name, alt, datei });
}

async function umgezogeneTrefferJeDatei(wurzeln, datei) {
  const [vorher, nachher] = await Promise.all(
    [wurzeln.hilfe, wurzeln.pr].map((root) => optionen(wurzeln.eslint.get(root), root, datei)),
  );
  let summe = 0;
  for (const { name, nurIn } of nachher.filter((eintrag) => eintrag.nurIn.includes(datei))) {
    const alt = vorher.find((eintrag) => eintrag.name === name)?.nurIn;
    summe += await umgezogenNach(wurzeln, { name, alt, nurIn, datei });
  }
  return summe;
}

export async function ausnahmeUmzug({ basis, hilfe, pr, dateien, gezaehlteRegel }) {
  if (gezaehlteRegel !== undefined && gezaehlteRegel !== REGEL) return 0;
  const eslint = new Map([hilfe, pr].map((root) => [root, new ESLint({ cwd: root })]));
  const wurzeln = { basis, hilfe, pr, eslint, dateien, vorrat: new Map() };
  let summe = 0;
  for (const datei of dateien.filter((pfad) => existsSync(join(hilfe, pfad))))
    summe += await umgezogeneTrefferJeDatei(wurzeln, datei);
  return summe;
}
