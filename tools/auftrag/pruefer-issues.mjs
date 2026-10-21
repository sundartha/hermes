import { SOLLTE, ersetzeSteuerzeichen } from "./pruefer-schema.mjs";
import { PRUEFER_ZWECK, befundZweck, zweckZeilen } from "./pruefer-zweck.mjs";

export const LABEL = "pruefer";
export const SAMMEL_PRAEFIX = "Prüfer-Sammlung: ";
const KATALOG = ".claude/refs/clean-code.md";
const VERBESSERUNGEN = ["G5", "T1", "T3", "T5", "P11"];
const WURZEL = "Wurzel";
const BEREICH_TIEFE = 2;
const TRENNER = "\n\n---\n\n";
const MAX_TITEL = 200;
const MAX_DATEI_IM_TITEL = 120;
const MAX_FELD = 6000;
const MIN_ZAUN = 3;
const BACKTICKS = /`+/g;
const KATALOG_ID = /^(?:[A-Z]\d{1,2}|SG-\d{2,3})$/;
const OHNE_ID = "Befund";
const MIT_PR = / \(PR #\d+\)$/;
const OFFEN = "open";

function katalogId(id) {
  return KATALOG_ID.test(id) ? id : "";
}

function dateiSpan(datei, grenze = MAX_TITEL) {
  const inhalt = ersetzeSteuerzeichen(datei, " ").replace(BACKTICKS, "").slice(0, grenze);
  return `\`${inhalt}\``;
}

export function issueTitel(befund, pr = null) {
  const stelle = `${dateiSpan(befund.datei, MAX_DATEI_IM_TITEL)}, Zeile ${befund.zeile}`;
  const titel = `Prüfer: ${katalogId(befund.id) || OHNE_ID} in ${stelle}`;
  return pr === null ? titel : `${titel} (PR #${pr})`;
}

function titelVon(titel) {
  return ersetzeSteuerzeichen(titel, " ").slice(0, MAX_TITEL);
}

function eingezaeunt(text) {
  const inhalt = text.slice(0, MAX_FELD);
  const laengste = Math.max(
    0,
    ...[...inhalt.matchAll(BACKTICKS)].map(([treffer]) => treffer.length),
  );
  const zaun = "`".repeat(Math.max(MIN_ZAUN, laengste + 1));
  return [`${zaun}text`, inhalt, zaun].join("\n");
}

function zweckAbsaetze(befund) {
  return zweckZeilen([PRUEFER_ZWECK.ISSUE, ...befundZweck(befund)]).flatMap((zeile) => [zeile, ""]);
}

export function issueText({ sha, pr = null, befund, grund }) {
  const abschnitt = (titel, inhalt) =>
    inhalt.trim() === "" ? [] : [`### ${titel}`, "", eingezaeunt(inhalt), ""];
  const id = katalogId(befund.id);
  return [
    `Der Prüfer hat ${pr === null ? "" : `im Pull Request #${pr} `}im Commit ${sha} einen Befund gemeldet, der den Merge nicht aufhält.`,
    "",
    `- Schwere: ${befund.schwere}${grund ? ` (${grund})` : ""}`,
    ...(id ? [`- Katalog-ID: ${id}`] : []),
    `- Stelle: ${dateiSpan(befund.datei)}, Zeile ${befund.zeile}`,
    "",
    ...zweckAbsaetze(befund),
    ...abschnitt("Beleg", befund.beleg),
    ...abschnitt("Reparatur", befund.reparatur),
    ...abschnitt("Reproduktion", befund.reproduktion),
  ].join("\n");
}

function istVerbesserung(befund) {
  return (
    befund.schwere === SOLLTE && befund.sicherheit === false && VERBESSERUNGEN.includes(befund.id)
  );
}

function bereichVon(datei) {
  const ordner = datei.split("/").slice(0, -1).slice(0, BEREICH_TIEFE);
  return ordner.length === 0 ? WURZEL : ordner.join("/");
}

function sammelTitel(befund) {
  return titelVon(`${SAMMEL_PRAEFIX}${bereichVon(befund.datei).replace(BACKTICKS, "")}`);
}

function eintrag(issue) {
  return [`## ${titelVon(issue.titel)}`, "", issueText(issue)].join("\n");
}

function ersteZeile(text) {
  return (text ?? "").split(/\r?\n/, 1)[0];
}

function sammelText(issue, title) {
  const bereich = title.slice(SAMMEL_PRAEFIX.length);
  return [
    eintrag(issue),
    `Weitere Verbesserungsbefunde in \`${bereich}\` (${VERBESSERUNGEN.join(", ")} nach ${KATALOG}) kommen als Kommentar hinzu.`,
  ].join(TRENNER);
}

function sperrtNeues({ state, title }) {
  return state === OFFEN || MIT_PR.test(title);
}

async function kommentareVon(number, github) {
  const kommentare = await github.alle(`/issues/${number}/comments`, (liste) => liste);
  return kommentare.map((kommentar) => kommentar.body ?? "");
}

async function texteVon({ number, body }, github) {
  const texte = [(body ?? "").split(TRENNER, 1)[0], ...(await kommentareVon(number, github))];
  return texte.filter((text) => text.trim() !== "");
}

async function schliesseDoppelt({ number }, ziel, github) {
  const body = `Doppelt zu #${ziel.number}; weitere Einträge für diesen Bereich kommen dort hinzu.`;
  await github.sende("POST", `/issues/${number}/comments`, { body });
  await github.sende("PATCH", `/issues/${number}`, {
    state: "closed",
    state_reason: "not_planned",
  });
}

async function uebernimm(texte, ziel, github) {
  for (const text of texte.filter((eintrag) => !ziel.eintraege.has(ersteZeile(eintrag)))) {
    await github.sende("POST", `/issues/${ziel.number}/comments`, { body: text });
    ziel.eintraege.add(ersteZeile(text));
  }
}

async function fuehreSammlungenZusammen(bekannt, { gesucht, github }) {
  const offen = new Map();
  const geschlossen = new Set();
  const sammelIssues = bekannt
    .filter(({ title }) => gesucht.has(title))
    .sort((links, rechts) => links.number - rechts.number);
  for (const issue of sammelIssues) {
    const texte = await texteVon(issue, github);
    const eintraege = texte.map(ersteZeile);
    const ziel = offen.get(issue.title);
    if (issue.state !== OFFEN)
      for (const kopf of eintraege.filter((zeile) => MIT_PR.test(zeile))) geschlossen.add(kopf);
    else if (ziel) {
      await uebernimm(texte, ziel, github);
      await schliesseDoppelt(issue, ziel, github);
    } else offen.set(issue.title, { number: issue.number, eintraege: new Set(eintraege) });
  }
  return { offen, geschlossen };
}

async function sammle(issue, { titel, offen, geschlossen, github }) {
  const title = sammelTitel(issue.befund);
  const kopf = ersteZeile(eintrag(issue));
  const sammlung = offen.get(title);
  if (titel.has(titelVon(issue.titel)) || geschlossen.has(kopf) || sammlung?.eintraege.has(kopf))
    return null;
  if (sammlung) {
    await github.sende("POST", `/issues/${sammlung.number}/comments`, { body: eintrag(issue) });
    sammlung.eintraege.add(kopf);
    return "kommentare";
  }
  const angelegt = await github.sende("POST", "/issues", {
    title,
    body: sammelText(issue, title),
    labels: [LABEL],
  });
  offen.set(title, { number: angelegt.number, eintraege: new Set([kopf]) });
  return "neu";
}

async function einzeln(issue, { titel, github }) {
  const title = titelVon(issue.titel);
  if (titel.has(title)) return null;
  await github.sende("POST", "/issues", { title, body: issueText(issue), labels: [LABEL] });
  titel.add(title);
  return "neu";
}

export async function legeIssuesAn(issues, github) {
  const zaehlung = { neu: 0, kommentare: 0, vorhanden: 0 };
  if (issues.length === 0) return zaehlung;
  const bekannt = await github.alle(`/issues?state=all&labels=${LABEL}`, (liste) => liste);
  const titel = new Set(bekannt.filter(sperrtNeues).map(({ title }) => title));
  const gesucht = new Set(
    issues.filter(({ befund }) => istVerbesserung(befund)).map(({ befund }) => sammelTitel(befund)),
  );
  const { offen, geschlossen } = await fuehreSammlungenZusammen(bekannt, { gesucht, github });
  for (const issue of issues) {
    const ablage = istVerbesserung(issue.befund) ? sammle : einzeln;
    zaehlung[(await ablage(issue, { titel, offen, geschlossen, github })) ?? "vorhanden"] += 1;
  }
  return zaehlung;
}
