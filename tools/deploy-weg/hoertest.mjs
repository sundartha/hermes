import { AUTOMATION_LOGIN } from "../akteure.mjs";
import { Abbruch } from "./ausgabe.mjs";
import { githubZugang } from "./netz.mjs";

export const HOERTEST_TITEL = "Hörtest nötig vor dem Live-Deploy";
const HTTP_OK = 200;
const HTTP_ANGELEGT = 201;
const SEITE = 100;
const OHNE_NAMEN = "(der Abgleich hat keine Namen gemeldet)";

function issueText({ commit, teile, laufUrl }) {
  const namen = teile.length > 0 ? teile.map((teil) => "- " + teil) : ["- " + OHNE_NAMEN];
  return [
    "Der Commit " + commit + " ändert das Gespräch. Vor dem Live-Deploy ist ein Hörtest nötig.",
    "",
    "Geänderte Teile des Gesprächsabdrucks:",
    ...namen,
    "",
    "Lauf: " + laufUrl,
    "",
    "Nach dem Hörtest startet Antonio20045 oder jonas986 den Workflow „live“ von Hand:",
    "Actions → live → Run workflow, Branch master, Eingabe commit = " + commit + ".",
    "Der Hand-Start gilt als bestätigter Hörtest; alle anderen Prüfungen laufen trotzdem.",
    "",
  ].join("\n");
}

function eigenesIssue(eintrag) {
  return (
    eintrag?.title === HOERTEST_TITEL &&
    eintrag.user?.login === AUTOMATION_LOGIN &&
    eintrag.pull_request === undefined &&
    Number.isInteger(eintrag.number)
  );
}

async function offeneIssues(github, seite) {
  const filter = new URLSearchParams({
    state: "open",
    creator: AUTOMATION_LOGIN,
    per_page: String(SEITE),
    page: String(seite),
  });
  const { status, daten } = await github.lesen("/issues?" + filter.toString());
  if (status !== HTTP_OK || !Array.isArray(daten)) throw new Abbruch("issue_suche", status);
  return daten;
}

async function vorhandenesIssue(github) {
  const eigene = [];
  for (let seite = 1; ; seite += 1) {
    const issues = await offeneIssues(github, seite);
    eigene.push(...issues.filter(eigenesIssue));
    if (issues.length < SEITE) break;
  }
  eigene.sort((links, rechts) => links.number - rechts.number);
  return eigene[0] ?? null;
}

export async function hoertestIssueAnlegenOderErsetzen({ einstellungen, commit, teile, ausgabe }) {
  const github = githubZugang(einstellungen);
  const { serverUrl, repository, runId } = einstellungen;
  const laufUrl = [serverUrl, repository, "actions/runs", runId].join("/");
  const body = issueText({ commit, teile, laufUrl });
  const vorhanden = await vorhandenesIssue(github);
  if (vorhanden !== null) {
    const pfad = "/issues/" + vorhanden.number;
    const { status } = await github.senden({ methode: "PATCH", pfad, koerper: { body } });
    if (status !== HTTP_OK) throw new Abbruch("issue_schreiben", status);
    ausgabe.melde("issue_ersetzt", { nummer: vorhanden.number });
    return;
  }
  const koerper = { title: HOERTEST_TITEL, body };
  const { status, daten } = await github.senden({ methode: "POST", pfad: "/issues", koerper });
  if (status !== HTTP_ANGELEGT || !Number.isInteger(daten?.number)) {
    throw new Abbruch("issue_schreiben", status);
  }
  ausgabe.melde("issue_angelegt", { nummer: daten.number });
}
