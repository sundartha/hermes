import { ersetzeSteuerzeichen } from "./pruefer-schema.mjs";

export const LABEL = "pruefer";
const MAX_TITEL = 200;
const MAX_FELD = 6000;
const MIN_ZAUN = 3;
const BACKTICKS = /`+/g;

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

export function issueText({ sha, befund, grund }) {
  const abschnitt = (titel, inhalt) =>
    inhalt.trim() === "" ? [] : [`### ${titel}`, "", eingezaeunt(inhalt), ""];
  return [
    `Der Prüfer hat im Commit ${sha} einen Befund gemeldet, der den Merge nicht aufhält.`,
    "",
    `- Schwere: ${befund.schwere}${grund ? ` (${grund})` : ""}`,
    `- Katalog-ID: ${befund.id.slice(0, MAX_TITEL)}`,
    `- Stelle: Zeile ${befund.zeile}`,
    "",
    ...abschnitt("Beleg", befund.beleg),
    ...abschnitt("Reparatur", befund.reparatur),
    ...abschnitt("Reproduktion", befund.reproduktion),
  ].join("\n");
}

export async function legeIssuesAn(issues, github) {
  if (issues.length === 0) return { neu: 0, vorhanden: 0 };
  const offen = await github.alle(`/issues?state=open&labels=${LABEL}`, (liste) => liste);
  const titel = new Set(offen.map(({ title }) => title));
  let neu = 0;
  for (const issue of issues) {
    const title = titelVon(issue.titel);
    if (titel.has(title)) continue;
    await github.sende("POST", "/issues", { title, body: issueText(issue), labels: [LABEL] });
    titel.add(title);
    neu += 1;
  }
  return { neu, vorhanden: issues.length - neu };
}
