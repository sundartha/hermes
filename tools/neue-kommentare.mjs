import { join } from "node:path";
import { ESLint } from "eslint";

import keineKommentare from "./eslint-rules/keine-kommentare.js";
import { istYamlOderShell, kommentareImText } from "./kommentare-yaml-shell.mjs";
import {
  ausfuehren,
  basisAusAufruf,
  dateiInhalt,
  geaenderteDateien,
  gelinteteJsDateien,
  hinzugefuegteZeilen,
} from "./pr-aenderungen.mjs";

const LEHREN = "tasks/lessons.md";
const PRUEF_PLUGIN = "neue-kommentare";
const PRUEFREGEL = `${PRUEF_PLUGIN}/kommentar`;
const NEUE_DATEIEN_UND_AENDERUNGEN = "AM";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const AUFRUF = "Aufruf: node tools/neue-kommentare.mjs --basis <commit>";
const HINWEIS =
  "Neue Kommentare werden entfernt, nicht eingefroren: Die Basislinien nehmen keine neuen Einträge auf, auch keine früher entfernten.";

function kommentarPruefer(root) {
  return new ESLint({
    cwd: root,
    applySuppressions: false,
    overrideConfig: {
      plugins: { [PRUEF_PLUGIN]: { rules: { kommentar: keineKommentare } } },
      rules: { [PRUEFREGEL]: "error" },
    },
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
  const meldungen = (ergebnis?.messages ?? []).filter(({ ruleId }) => ruleId === PRUEFREGEL);
  return meldungen.flatMap(zeilenVon);
}

function textKommentarZeilen(werkzeug, datei) {
  const text = dateiInhalt("HEAD", datei, werkzeug.root);
  return kommentareImText(datei, text).map(({ zeile }) => zeile);
}

async function kommentarZeilen(werkzeug, datei, zeilen) {
  if (datei === LEHREN) return zeilen.map(({ zeile }) => zeile);
  if (werkzeug.js.has(datei)) return jsKommentarZeilen(werkzeug, datei);
  return istYamlOderShell(datei) ? textKommentarZeilen(werkzeug, datei) : [];
}

async function befundeDerDatei(werkzeug, datei) {
  const hinzu = hinzugefuegteZeilen(werkzeug.basis, datei, werkzeug.root);
  const zeilen = hinzu.filter(({ text }) => text.trim() !== "");
  if (zeilen.length === 0) return [];
  const mitKommentar = new Set(await kommentarZeilen(werkzeug, datei, zeilen));
  const art = datei === LEHREN ? "neue Zeile in tasks/lessons.md" : "neuer Kommentar";
  return zeilen
    .filter(({ zeile }) => mitKommentar.has(zeile))
    .map(({ zeile }) => `${datei}:${zeile} ${art}`);
}

async function pruefen(root, basis) {
  const dateien = geaenderteDateien(basis, root, { filter: NEUE_DATEIEN_UND_AENDERUNGEN });
  const werkzeug = { root, basis, eslint: kommentarPruefer(root), js: await gelinteteJsDateien(root, dateien) };
  const befunde = [];
  for (const { datei } of dateien) befunde.push(...(await befundeDerDatei(werkzeug, datei)));
  for (const befund of befunde) console.error(befund);
  if (befunde.length > 0) console.error(HINWEIS);
  console.log(`Neue Kommentare: ${befunde.length} hinzugefügte Zeilen mit Kommentar in ${dateien.length} geänderten Dateien.`);
  return befunde.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

await ausfuehren(async (root) => pruefen(root, basisAusAufruf(AUFRUF, root)));
