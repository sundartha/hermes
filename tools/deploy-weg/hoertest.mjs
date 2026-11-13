import { AUTOMATION_LOGIN } from "../github.mjs";
import { Abbruch } from "./ausgabe.mjs";
import { githubZugang } from "./netz.mjs";

export const HOERTEST_TITEL = "Hörtest nötig vor dem Live-Deploy";
export const NACHKONTROLLE_TITEL = "Nachkontrolle: Update-Deploy zurückgenommen";
const HOERTEST_MELDUNGEN = Object.freeze({ ersetzt: "issue_ersetzt", angelegt: "issue_angelegt" });
const NACHKONTROLLE_MELDUNGEN = Object.freeze({
  ersetzt: "nachkontrolle_ersetzt",
  angelegt: "nachkontrolle_angelegt",
});
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

function nachkontrolleText({ commit, grund, laufUrl, revertUrl }) {
  const weg =
    revertUrl === null
      ? "Kein Revert-PR: Rücknahme von Hand über notfall/zurueckrollen."
      : "Revert-PR: " + revertUrl;
  return [
    "Der Update-Deploy mit Commit " + commit + " wurde nachkontrolliert.",
    "Grund: " + grund,
    "",
    weg,
    "Lauf: " + laufUrl,
    "",
  ].join("\n");
}

function eigenesIssue(eintrag, titel) {
  return (
    eintrag?.title === titel &&
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

async function vorhandenesIssue(github, titel) {
  const eigene = [];
  for (let seite = 1; ; seite += 1) {
    const issues = await offeneIssues(github, seite);
    eigene.push(...issues.filter((eintrag) => eigenesIssue(eintrag, titel)));
    if (issues.length < SEITE) break;
  }
  eigene.sort((links, rechts) => links.number - rechts.number);
  return eigene[0] ?? null;
}

async function issueSchreiben({ einstellungen, titel, body, meldungen, ausgabe }) {
  const github = githubZugang(einstellungen);
  const vorhanden = await vorhandenesIssue(github, titel);
  if (vorhanden !== null) {
    const pfad = "/issues/" + vorhanden.number;
    const { status } = await github.senden({ methode: "PATCH", pfad, koerper: { body } });
    if (status !== HTTP_OK) throw new Abbruch("issue_schreiben", status);
    ausgabe.melde(meldungen.ersetzt, { nummer: vorhanden.number });
    return;
  }
  const { status, daten } = await github.senden({
    methode: "POST",
    pfad: "/issues",
    koerper: { title: titel, body },
  });
  if (status !== HTTP_ANGELEGT || !Number.isInteger(daten?.number)) {
    throw new Abbruch("issue_schreiben", status);
  }
  ausgabe.melde(meldungen.angelegt, { nummer: daten.number });
}

function laufAdresse({ serverUrl, repository, runId }) {
  return [serverUrl, repository, "actions/runs", runId].join("/");
}

export async function hoertestIssueAnlegenOderErsetzen({ einstellungen, commit, teile, ausgabe }) {
  const body = issueText({ commit, teile, laufUrl: laufAdresse(einstellungen) });
  await issueSchreiben({
    einstellungen,
    titel: HOERTEST_TITEL,
    body,
    meldungen: HOERTEST_MELDUNGEN,
    ausgabe,
  });
}

export async function nachkontrolleIssueSchreiben({
  einstellungen,
  commit,
  grund,
  revertUrl,
  ausgabe,
}) {
  const body = nachkontrolleText({ commit, grund, laufUrl: laufAdresse(einstellungen), revertUrl });
  await issueSchreiben({
    einstellungen,
    titel: NACHKONTROLLE_TITEL,
    body,
    meldungen: NACHKONTROLLE_MELDUNGEN,
    ausgabe,
  });
}
