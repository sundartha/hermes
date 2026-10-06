import { join } from "node:path";
import { ESLint, Linter } from "eslint";

import { alleKnoten } from "./eslint-rules/knoten.js";
import { istYamlOderShell, kommentareImText } from "./kommentare-yaml-shell.mjs";
import {
  STATUS_GELOESCHT,
  STATUS_NEU,
  ausfuehren,
  basisAusAufruf,
  dateiInhalt,
  geaenderteDateien,
  gelinteteJsDateien,
  git,
  hinzugefuegteZeilen,
} from "./pr-aenderungen.mjs";

const MARKDOWN = ".md";
const KOMMENTAR_ARTEN = new Set(["Line", "Block"]);
const TEXT_KNOTEN = new Set(["Literal", "TemplateElement"]);
const WOERTER_JE_ABDRUCK = 6;
const NICHT_WORT = /[^\p{L}\p{N}]+/gu;
const WORTTRENNER = " ";
const ZEILENENDE = "\n";
const SPALTENTRENNER = "\t";
const UNBEKANNTE_ZAHL = "-";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const AUFRUF = "Aufruf: node tools/kommentar-wanderung.mjs --basis <commit>";

export function woerter(text) {
  const getrennt = text.toLowerCase().replace(NICHT_WORT, WORTTRENNER);
  return getrennt.split(WORTTRENNER).filter(Boolean);
}

function abdruecke(wortListe) {
  const gefunden = [];
  for (let index = 0; index + WOERTER_JE_ABDRUCK <= wortListe.length; index += 1) {
    gefunden.push({ index, abdruck: wortListe.slice(index, index + WOERTER_JE_ABDRUCK).join(WORTTRENNER) });
  }
  return gefunden;
}

function zusammengefasst(eintraege) {
  const bloecke = [];
  for (const eintrag of eintraege) {
    const letzter = bloecke.at(-1);
    const anschluss = letzter?.zeilenweise && eintrag.zeilenweise && eintrag.zeile === letzter.bis + 1;
    if (anschluss) bloecke.splice(-1, 1, { ...letzter, bis: eintrag.bis, text: `${letzter.text} ${eintrag.text}` });
    else bloecke.push(eintrag);
  }
  return bloecke;
}

async function quelltext(werkzeug, datei, text) {
  if (text === "") return undefined;
  const config = await werkzeug.eslint.calculateConfigForFile(join(werkzeug.root, datei));
  const meldungen = werkzeug.linter.verify(text, { languageOptions: config?.languageOptions ?? {} });
  return meldungen.some(({ fatal }) => fatal) ? undefined : werkzeug.linter.getSourceCode();
}

function jsKommentare(sourceCode) {
  const kommentare = (sourceCode?.getAllComments() ?? []).filter(({ type }) => KOMMENTAR_ARTEN.has(type));
  return zusammengefasst(
    kommentare.map(({ type, value, loc }) => ({
      zeile: loc.start.line,
      bis: loc.end.line,
      text: value,
      zeilenweise: type === "Line",
    })),
  );
}

function textKommentare(datei, text) {
  const kommentare = kommentareImText(datei, text);
  return zusammengefasst(kommentare.map(({ zeile, text: inhalt }) => ({ zeile, bis: zeile, text: inhalt, zeilenweise: true })));
}

async function kommentarBloecke(werkzeug, datei, text) {
  if (istYamlOderShell(datei)) return textKommentare(datei, text);
  return jsKommentare(await quelltext(werkzeug, datei, text));
}

function inhaltOderLeer(commit, { status, datei }, root) {
  const fehlt = commit === "HEAD" ? status === STATUS_GELOESCHT : status === STATUS_NEU;
  return fehlt ? "" : dateiInhalt(commit, datei, root);
}

function entfernteBloecke(alt, neu) {
  const uebrig = new Map();
  for (const block of neu) {
    const schluessel = woerter(block.text).join(WORTTRENNER);
    uebrig.set(schluessel, (uebrig.get(schluessel) ?? 0) + 1);
  }
  return alt.filter((block) => {
    const schluessel = woerter(block.text).join(WORTTRENNER);
    const anzahl = uebrig.get(schluessel) ?? 0;
    uebrig.set(schluessel, anzahl - 1);
    return anzahl <= 0;
  });
}

async function entfernteKommentare(werkzeug, eintrag) {
  const { basis, root } = werkzeug;
  const alt = await kommentarBloecke(werkzeug, eintrag.datei, inhaltOderLeer(basis, eintrag, root));
  const neu = await kommentarBloecke(werkzeug, eintrag.datei, inhaltOderLeer("HEAD", eintrag, root));
  return entfernteBloecke(alt, neu).map((block) => ({ ...block, datei: eintrag.datei }));
}

function wortFolge(abschnitte) {
  return abschnitte.flatMap(({ zeile, text }) => woerter(text).map((wort) => ({ wort, zeile })));
}

function zieleEintragen(ziele, datei, abschnitte) {
  const folge = wortFolge(abschnitte);
  for (const { index, abdruck } of abdruecke(folge.map(({ wort }) => wort))) {
    if (!ziele.has(abdruck)) ziele.set(abdruck, { datei, zeile: folge[index].zeile });
  }
}

function istTextAufZeilen(node, zeilen) {
  const istText = TEXT_KNOTEN.has(node.type) && (node.type !== "Literal" || typeof node.value === "string");
  const { start, end } = node.loc;
  return istText && [...zeilen].some((zeile) => start.line <= zeile && zeile <= end.line);
}

function textAufZeilen(sourceCode, zeilen) {
  const gefunden = alleKnoten(sourceCode).filter((node) => istTextAufZeilen(node, zeilen));
  return gefunden
    .toSorted((links, rechts) => links.range[0] - rechts.range[0])
    .map((node) => ({ zeile: node.loc.start.line, text: node.value?.cooked ?? node.value }));
}

async function jsZiele(werkzeug, datei) {
  const zeilen = new Set(hinzugefuegteZeilen(werkzeug.basis, datei, werkzeug.root).map(({ zeile }) => zeile));
  if (zeilen.size === 0) return [];
  return textAufZeilen(await quelltext(werkzeug, datei, dateiInhalt("HEAD", datei, werkzeug.root)), zeilen);
}

async function wiederaufnahmeOrte(werkzeug, dateien) {
  const ziele = new Map();
  for (const { status, datei } of dateien) {
    if (status === STATUS_GELOESCHT) continue;
    if (datei.endsWith(MARKDOWN)) zieleEintragen(ziele, datei, hinzugefuegteZeilen(werkzeug.basis, datei, werkzeug.root));
    if (werkzeug.js.has(datei)) zieleEintragen(ziele, datei, await jsZiele(werkzeug, datei));
  }
  return ziele;
}

function wanderungen(entfernt, ziele) {
  return entfernt.flatMap((block) => {
    const treffer = abdruecke(woerter(block.text)).find(({ abdruck }) => ziele.has(abdruck));
    if (treffer === undefined) return [];
    const ziel = ziele.get(treffer.abdruck);
    return [`Kommentar aus ${block.datei}:${block.zeile} taucht in ${ziel.datei}:${ziel.zeile} wieder auf: „${treffer.abdruck}“`];
  });
}

function markdownZuwachs(werkzeug) {
  const zeilen = git(["diff", "--numstat", "--no-renames", werkzeug.basis, "HEAD", "--", `*${MARKDOWN}`], werkzeug.root)
    .split(ZEILENENDE)
    .filter(Boolean);
  return zeilen
    .map((zeile) => zeile.split(SPALTENTRENNER))
    .filter(([plus, minus]) => plus !== UNBEKANNTE_ZAHL && minus !== UNBEKANNTE_ZAHL)
    .reduce((summe, [plus, minus]) => summe + Number(plus) - Number(minus), 0);
}

async function pruefen(root, basis) {
  const dateien = geaenderteDateien(basis, root, { filter: "AMD" });
  const werkzeug = {
    root,
    basis,
    eslint: new ESLint({ cwd: root }),
    linter: new Linter({ cwd: root }),
    js: await gelinteteJsDateien(root, dateien),
  };
  const quellen = dateien.filter(({ datei }) => werkzeug.js.has(datei) || istYamlOderShell(datei));
  const entfernt = [];
  for (const eintrag of quellen) entfernt.push(...(await entfernteKommentare(werkzeug, eintrag)));
  const funde = wanderungen(entfernt, await wiederaufnahmeOrte(werkzeug, dateien));
  for (const fund of funde) console.error(fund);
  console.log(`Markdown-Zuwachs im PR: ${markdownZuwachs(werkzeug)} Zeilen (wird nur angezeigt).`);
  console.log(`Kommentar-Wanderung: ${entfernt.length} entfernte Kommentare, ${funde.length} wieder aufgetaucht.`);
  return funde.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

await ausfuehren(async (root) => pruefen(root, basisAusAufruf(AUFRUF, root)));
