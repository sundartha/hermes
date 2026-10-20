import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { zweckBlock } from "./auftrag/zweck.mjs";

const ERGEBNIS_OHNE_LUECKE = 0;
const ERGEBNIS_MIT_LUECKE = 1;
const ERGEBNIS_UNGUELTIGER_AUFRUF = 2;
const ZWECK = "uebrige/anbieter-datenschutz";
const ERSTES_EIGENES_ARGUMENT = 2;
const BEFUND_ZEILE = 1;
const AUFRUF_HINWEIS = "Aufruf: node tools/anbieter-datenschutz-pruefen.mjs [--wurzel ORDNER]";
const STANDARD_WURZEL = new URL("..", import.meta.url);
const DATENSCHUTZ_DATEI = "apps/web/src/data/legal/privacy.de.json";
const ADAPTER_ORDNER = Object.freeze(["src/llm/adapters/", "src/research/adapters/"]);
const ADAPTER_DATEI = /\.[cm]?[jt]s$/;
const TEXT_TRENNER = "\n";
const WORT_ZEICHEN_AM_ENDE = /[\p{L}\p{M}\p{N}]$/u;
const WORT_ZEICHEN_AM_ANFANG = /^[\p{L}\p{M}\p{N}]/u;

const ANBIETER_ANZEIGENAMEN = new Map([
  ["anthropic", "Anthropic"],
  ["deepseek", "DeepSeek"],
  ["anthropic-web-search", "Anthropic"],
  ["exa-search", "Exa"],
]);

const ORDNER_FEHLT = "Adapter-Ordner fehlt";
const DATENSCHUTZ_FEHLT = "Datenschutz-Datei fehlt";
const OHNE_ANZEIGENAMEN = `Anbieter-Adapter ohne Anzeigenamen - Karte in tools/anbieter-datenschutz-pruefen.mjs ergaenzen und den Anbieter in ${DATENSCHUTZ_DATEI} nennen`;

function datenschutzText(dokument) {
  const teile = [dokument.note ?? ""];
  for (const abschnitt of dokument.sections) teile.push(abschnitt.heading, abschnitt.text);
  return teile.join(TEXT_TRENNER);
}

function kommtAlsWortVor(text, name) {
  let stelle = text.indexOf(name);
  while (stelle !== -1) {
    const davor = text.slice(0, stelle);
    const danach = text.slice(stelle + name.length);
    if (!WORT_ZEICHEN_AM_ENDE.test(davor) && !WORT_ZEICHEN_AM_ANFANG.test(danach)) return true;
    stelle = text.indexOf(name, stelle + 1);
  }
  return false;
}

function adapterImOrdner(wurzel, ordner) {
  const ort = new URL(ordner, wurzel);
  if (!existsSync(ort)) return { fehlt: true, dateien: [] };
  const dateien = readdirSync(ort)
    .filter((name) => ADAPTER_DATEI.test(name))
    .sort()
    .map((name) => ({ pfad: `${ordner}${name}`, name: name.replace(ADAPTER_DATEI, "") }));
  return { fehlt: false, dateien };
}

function befundZumAdapter(text, { pfad, name }) {
  const anzeigename = ANBIETER_ANZEIGENAMEN.get(name);
  if (anzeigename === undefined) return `${pfad}:${BEFUND_ZEILE} ${OHNE_ANZEIGENAMEN}`;
  if (kommtAlsWortVor(text, anzeigename)) return null;
  return `${pfad}:${BEFUND_ZEILE} Anbieter ${anzeigename} fehlt in ${DATENSCHUTZ_DATEI}`;
}

function befundeDerWurzel(wurzel) {
  const datenschutzOrt = new URL(DATENSCHUTZ_DATEI, wurzel);
  if (!existsSync(datenschutzOrt)) return [`${DATENSCHUTZ_DATEI}:${BEFUND_ZEILE} ${DATENSCHUTZ_FEHLT}`];
  const text = datenschutzText(JSON.parse(readFileSync(datenschutzOrt, "utf8")));
  const befunde = [];
  for (const ordner of ADAPTER_ORDNER) {
    const { fehlt, dateien } = adapterImOrdner(wurzel, ordner);
    if (fehlt) befunde.push(`${ordner}:${BEFUND_ZEILE} ${ORDNER_FEHLT}`);
    for (const adapter of dateien) befunde.push(befundZumAdapter(text, adapter));
  }
  return befunde.filter((befund) => befund !== null);
}

function gewaehlteWurzel(argumente) {
  const { wurzel } = parseArgs({ args: argumente, options: { wurzel: { type: "string" } } }).values;
  if (wurzel === undefined) return STANDARD_WURZEL;
  const ort = new URL(`${pathToFileURL(wurzel).href}/`);
  if (existsSync(ort)) return ort;
  throw new RangeError(`Die Wurzel ${wurzel} gibt es nicht.`);
}

function pruefe(argumente) {
  let wurzel = null;
  try {
    wurzel = gewaehlteWurzel(argumente);
  } catch (fehler) {
    console.error(`${fehler.message}\n${AUFRUF_HINWEIS}`);
  }
  if (wurzel === null) return ERGEBNIS_UNGUELTIGER_AUFRUF;
  const befunde = befundeDerWurzel(wurzel);
  if (befunde.length === 0) return ERGEBNIS_OHNE_LUECKE;
  console.log(befunde.join(TEXT_TRENNER));
  console.error(zweckBlock(ZWECK).join("\n"));
  return ERGEBNIS_MIT_LUECKE;
}

process.exitCode = pruefe(process.argv.slice(ERSTES_EIGENES_ARGUMENT));
