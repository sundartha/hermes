import { LABEL, LABEL_TEXT, botIssues, legeIssueAn } from "./befunde.mjs";
import { PRUEFER } from "./rangliste.mjs";

export const SAMMEL_TITEL = "Aufräumen: Rangliste und Befunde";
const MAX_TEXT = 60_000;
const PLATZ_FUER_SCHLUSS = 200;
const SICHERER_NAME = /^[\w./@+:-]{1,300}$/;
const UNSICHER = "(Name mit Sonderzeichen)";
const SHA_KURZ = 12;
const KATALOG_ID = /^(?:[A-Z]\d{1,2}|SG-\d{2,3})$/;
const WIEDERKEHREND = 2;
const TABELLE = ["| Rang | Datei | Befunde | Prüfungen | Änderungen | Umfang | Brennpunkt |", "|---|---|---|---|---|---|---|"];

function code(name) {
  return SICHERER_NAME.test(String(name)) ? `\`${name}\`` : UNSICHER;
}

function ohneVerweis(text) {
  return `\`${String(text).replace(/`/g, "'")}\``;
}

function zielZeilen({ sorte, datei, grund, pr, autoMerge }) {
  const ziel = datei ? `Ziel dieses Laufs: ${code(sorte)} in ${code(datei)}.` : `Ziel dieses Laufs: keines${grund ? ` (${ohneVerweis(grund)})` : ""}.`;
  if (!pr) return [ziel];
  const nummer = ohneVerweis(`#${pr}`);
  return [ziel, autoMerge === false ? `PR ${nummer} ohne Auto-Merge: Die Art ${code(sorte)} steht nicht in \`tools/ziele/umbau-arten.json\`. Ein Mensch entscheidet über den PR.` : `PR ${nummer} mit Auto-Merge.`];
}

function jePruefung(befunde) {
  const zaehlung = new Map();
  for (const { pruefung, anzahl } of befunde) zaehlung.set(pruefung, (zaehlung.get(pruefung) ?? 0) + anzahl);
  return [...zaehlung].sort(([links], [rechts]) => links.localeCompare(rechts)).map(([name, zahl]) => `${code(name)} ${zahl}`);
}

function befundZeilen({ befunde, rangliste }) {
  const dateien = rangliste.filter((eintrag) => eintrag.befunde > 0).length;
  const summe = befunde.reduce((zahl, { anzahl }) => zahl + anzahl, 0);
  return [`Befunde: ${summe} in ${dateien} Dateien (${jePruefung(befunde).join(", ") || "keine"}).`];
}

export function lintVorschlaege(befunde) {
  const jeRegel = new Map();
  for (const { pruefung, regel, datei } of befunde) {
    if (pruefung === PRUEFER && KATALOG_ID.test(regel)) jeRegel.set(regel, new Set([...(jeRegel.get(regel) ?? []), datei]));
  }
  const wiederkehrend = [...jeRegel].filter(([, liste]) => liste.size >= WIEDERKEHREND);
  return wiederkehrend.map(([regel, liste]) => ({ regel, dateien: liste.size })).sort((links, rechts) => rechts.dateien - links.dateien || links.regel.localeCompare(rechts.regel));
}

function vorschlagZeilen(vorschlaege) {
  const liste = vorschlaege.map(({ regel, dateien }) => `- ${code(regel)} in ${dateien} Dateien`);
  return [
    "## Vorschläge für Lint-Regeln",
    "",
    "Diese Befunde des Prüfers kehren in mehreren Dateien wieder. Das Aufräumen baut keine Lint-Regel selbst; ein Mensch entscheidet, ob eine gebaut wird.",
    "",
    ...(liste.length > 0 ? liste : ["Keine."]),
  ];
}

function ranglisteZeile(eintrag, index) {
  const { datei, befunde, pruefungen, aenderungen, umfang, brennpunkt } = eintrag;
  return `| ${index + 1} | ${code(datei)} | ${befunde} | ${pruefungen.map(code).join(", ")} | ${aenderungen} | ${umfang} | ${brennpunkt} |`;
}

function mitRangliste(kopf, rangliste) {
  const zeilen = [...kopf];
  let laenge = zeilen.join("\n").length;
  let gezeigt = 0;
  for (const zeile of rangliste.map(ranglisteZeile)) {
    if (laenge + zeile.length + 1 > MAX_TEXT - PLATZ_FUER_SCHLUSS) break;
    zeilen.push(zeile);
    laenge += zeile.length + 1;
    gezeigt += 1;
  }
  const rest = rangliste.length - gezeigt;
  return [...zeilen, "", rest > 0 ? `Die übrigen ${rest} Dateien stehen in \`durchgang.json\` im Artefakt \`ziel\` des Laufs.` : "Die Rangliste ist vollständig."].join("\n");
}

export function sammelText({ durchgang, ergebnis }) {
  const kopf = [
    "Diese Liste schreibt das nächtliche Aufräumen bei jedem Lauf neu. Sie ersetzt einzelne Issues je Befund.",
    "",
    `Lauf: ${ergebnis.lauf}, master \`${String(durchgang.master ?? "").slice(0, SHA_KURZ)}\`.`,
    ...zielZeilen(ergebnis),
    ...befundZeilen(durchgang),
    "",
    ...vorschlagZeilen(lintVorschlaege(durchgang.befunde)),
    "",
    "## Rangliste",
    "",
    "Brennpunkt = Änderungen ohne Aufräum-Commits × Umfang (nicht leere Zeilen, tiefer eingerückte zählen mehr). Gleichstand: mehr Befunde zuerst.",
    "",
    ...TABELLE,
  ];
  return mitRangliste(kopf, durchgang.rangliste);
}

export async function schreibeSammelIssue(github, { durchgang, ergebnis }) {
  const vorhanden = (await botIssues(github, LABEL, LABEL_TEXT)).find(({ title }) => title === SAMMEL_TITEL);
  const text = sammelText({ durchgang, ergebnis });
  if (vorhanden === undefined) {
    const neu = await legeIssueAn(github, { titel: SAMMEL_TITEL, text, label: LABEL });
    return { nummer: neu.number, art: "neu" };
  }
  await github.sende("PATCH", `/issues/${vorhanden.number}`, { body: text, state: "open" });
  return { nummer: vorhanden.number, art: "aktualisiert" };
}
