import { join } from "node:path";
import { ESLint } from "eslint";

import { zweckBlock } from "./auftrag/zweck.mjs";

import keineKommentare from "./eslint-rules/keine-kommentare.js";
import { istCssOderHtml, kommentareImCssOderHtml } from "./kommentare-css-html.mjs";
import { istYamlOderShell, kommentareImText } from "./kommentare-yaml-shell.mjs";
import {
  dateiInhalt,
  direktAusfuehren,
  geaenderteDateien,
  gelinteteJsDateien,
  gibtEs,
  hinzugefuegteZeilen,
  hinzugefuegteZeilenGegenueber,
  nurTypenUmbenannt,
  ohneTypinformation,
} from "./pr-aenderungen.mjs";

const LEHREN = "docs/lessons.md";
const FRUEHERE_LEHREN = "tasks/lessons.md";
const LEHREN_DATEIEN = new Set([LEHREN, FRUEHERE_LEHREN]);
const PRUEF_PLUGIN = "neue-kommentare";
export const PRUEFREGEL = `${PRUEF_PLUGIN}/kommentar`;
const NEUE_DATEIEN_UND_AENDERUNGEN = "AM";
const TS_DATEIEN = ["**/*.{ts,mts,cts}"];
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const AUFRUF = "Aufruf: node tools/neue-kommentare.mjs --basis <commit>";
const ZWECK = "lint/neue-kommentare";
const HINWEIS =
  "Neue Kommentare werden entfernt, nicht eingefroren: Die Basislinien nehmen keine neuen Einträge auf, auch keine früher entfernten.";

function kommentarPruefer(root) {
  return new ESLint({
    cwd: root,
    applySuppressions: false,
    overrideConfig: [
      {
        plugins: { [PRUEF_PLUGIN]: { rules: { kommentar: keineKommentare } } },
        rules: { [PRUEFREGEL]: "error" },
      },
      { files: TS_DATEIEN, languageOptions: ohneTypinformation() },
    ],
    ruleFilter: ({ ruleId }) => ruleId === PRUEFREGEL,
  });
}

function zeilenVon({ line, endLine = line }) {
  return Array.from({ length: endLine - line + 1 }, (_eintrag, index) => line + index);
}

async function jsKommentarZeilen(werkzeug, datei) {
  const [ergebnis] = await werkzeug.eslint.lintText(dateiInhalt("HEAD", datei, werkzeug.root), {
    filePath: join(werkzeug.root, datei),
    warnIgnored: false,
  });
  const meldungen = ergebnis?.messages ?? [];
  return {
    zeilen: meldungen.filter(({ ruleId }) => ruleId === PRUEFREGEL).flatMap(zeilenVon),
    unlesbar: meldungen
      .filter(({ fatal }) => fatal)
      .map(({ line, message }) => `${datei}:${line} Parser: ${message}`),
  };
}

function lesbar(zeilen) {
  return { zeilen, unlesbar: [] };
}

function textLeser(datei) {
  if (istCssOderHtml(datei)) return kommentareImCssOderHtml;
  return istYamlOderShell(datei) ? kommentareImText : undefined;
}

function textKommentarZeilen(werkzeug, datei, lesen) {
  const text = dateiInhalt("HEAD", datei, werkzeug.root);
  return lesbar(lesen(datei, text).map(({ zeile }) => zeile));
}

async function kommentarZeilen(werkzeug, datei, zeilen) {
  if (LEHREN_DATEIEN.has(datei)) return lesbar(zeilen.map(({ zeile }) => zeile));
  if (werkzeug.js.has(datei)) return jsKommentarZeilen(werkzeug, datei);
  const lesen = textLeser(datei);
  return lesen === undefined ? lesbar([]) : textKommentarZeilen(werkzeug, datei, lesen);
}

function hinzugefuegt({ basis, root, nurTypen }, datei) {
  const alt = nurTypen(datei);
  if (alt !== undefined) return hinzugefuegteZeilenGegenueber(`${basis}:${alt}`, datei, root);
  const umgezogen =
    datei === LEHREN && !gibtEs(basis, LEHREN, root) && gibtEs(basis, FRUEHERE_LEHREN, root);
  if (!umgezogen) return hinzugefuegteZeilen(basis, datei, root);
  return hinzugefuegteZeilenGegenueber(`${basis}:${FRUEHERE_LEHREN}`, datei, root);
}

async function befundeDerDatei(werkzeug, datei) {
  const hinzu = hinzugefuegt(werkzeug, datei);
  const zeilen = hinzu.filter(({ text }) => text.trim() !== "");
  if (zeilen.length === 0) return [];
  const { zeilen: kommentiert, unlesbar } = await kommentarZeilen(werkzeug, datei, zeilen);
  const mitKommentar = new Set(kommentiert);
  const art = LEHREN_DATEIEN.has(datei) ? `neue Zeile in ${datei}` : "neuer Kommentar";
  const neu = zeilen
    .filter(({ zeile }) => mitKommentar.has(zeile))
    .map(({ zeile }) => `${datei}:${zeile} ${art}`);
  return [...unlesbar, ...neu];
}

async function pruefen(root, basis) {
  const dateien = geaenderteDateien(basis, root, { filter: NEUE_DATEIEN_UND_AENDERUNGEN });
  const werkzeug = {
    root,
    basis,
    eslint: kommentarPruefer(root),
    js: await gelinteteJsDateien(root, dateien),
    nurTypen: await nurTypenUmbenannt(basis),
  };
  const befunde = [];
  for (const { datei } of dateien) befunde.push(...(await befundeDerDatei(werkzeug, datei)));
  for (const befund of befunde) console.error(befund);
  if (befunde.length > 0) console.error([HINWEIS, ...zweckBlock(ZWECK)].join("\n"));
  console.log(`Neue Kommentare: ${befunde.length} hinzugefügte Zeilen mit Kommentar in ${dateien.length} geänderten Dateien.`);
  return befunde.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

await direktAusfuehren(import.meta.url, { aufruf: AUFRUF, pruefen });
