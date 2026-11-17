import { AUTOMATION_LOGIN } from "../github.mjs";
import { Abbruch } from "./ausgabe.mjs";
import { anfrage, githubZugang } from "./netz.mjs";

export const HOERTEST_TITEL = "Hörtest nötig vor dem Live-Deploy";
export const NACHKONTROLLE_TITEL = "Nachkontrolle: Update-Deploy zurückgenommen";
const NACHTLAUF_TITEL = "Staging-Nachtlauf rot";
const STAGINGLAUF_TITEL = "Staging-Deploy rot";
const PROBE_TITEL = "Staging-Anrufprobe rot";
const HOERTEST_MELDUNGEN = Object.freeze({ ersetzt: "issue_ersetzt", angelegt: "issue_angelegt" });
const NACHTLAUF_MELDUNGEN = Object.freeze({
  ersetzt: "nachtlauf_ersetzt",
  angelegt: "nachtlauf_angelegt",
});
const STAGINGLAUF_MELDUNGEN = Object.freeze({
  ersetzt: "staginglauf_ersetzt",
  angelegt: "staginglauf_angelegt",
});
const PROBE_MELDUNGEN = Object.freeze({ ersetzt: "probe_ersetzt", angelegt: "probe_angelegt" });
const NACHKONTROLLE_MELDUNGEN = Object.freeze({
  ersetzt: "nachkontrolle_ersetzt",
  angelegt: "nachkontrolle_angelegt",
});
const HTTP_OK = 200;
const HTTP_ANGELEGT = 201;
const HTTP_NICHT_OK_AB = 300;
const SEITE = 100;
const HEARTBEAT_FRIST_MS = 5000;
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

function nachtlaufText({ commit, laufUrl }) {
  return [
    "Die Prüfung gegen Staging ist im Nachtlauf rot geworden (Commit " + commit + ").",
    "Lauf: " + laufUrl,
    "",
    "Das ist kein Hörtest und keine Freigabe für Live. Die Ursache steht im Lauf.",
    "",
  ].join("\n");
}

function staginglaufText({ commit, laufUrl }) {
  return [
    "Die Prüfung gegen Staging ist nach dem Merge rot geworden (Commit " + commit + ").",
    "Lauf: " + laufUrl,
    "",
    "Das ist kein Hörtest und keine Freigabe für Live. Die Ursache steht im Lauf.",
    "",
  ].join("\n");
}

function probeText({ commit, laufUrl, seit }) {
  return [
    "Die Anrufprobe gegen Staging ist rot, auch die Wiederholung (Commit " + commit + ").",
    "Seit: " + seit,
    "Lauf: " + laufUrl,
    "",
    "Das ist kein Hörtest und keine Freigabe für Live. Der gerissene Wert steht im Lauf.",
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
    return vorhanden;
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
  return null;
}

const MS_JE_SEKUNDE = 1000;
const SEKUNDEN_JE_MINUTE = 60;
const ENTPRELLEN_MINUTEN = 60;
const VORFALL_ENTPRELLEN_MS = ENTPRELLEN_MINUTEN * SEKUNDEN_JE_MINUTE * MS_JE_SEKUNDE;

function vorfallText({ titel, commit, laufUrl, seit }) {
  return [
    titel + " (Commit " + commit + ").",
    ...(seit === undefined ? [] : ["Seit: " + seit]),
    "Umgebung: Staging.",
    "Lauf: " + laufUrl,
    "Erster Schritt: Ursache im Lauf lesen",
  ].join("\n");
}

function frischGemeldet(vorher, jetzt) {
  const geaendert = Date.parse(vorher?.updated_at ?? "");
  return Number.isFinite(geaendert) && jetzt - geaendert < VORFALL_ENTPRELLEN_MS;
}

async function vorfallMelden({ einstellungen, vorfall, vorher, ausgabe }) {
  if (einstellungen.vorfallUrl === null) {
    ausgabe.melde("vorfall_uebersprungen");
    return;
  }
  if (frischGemeldet(vorher, Date.now())) {
    ausgabe.melde("vorfall_entprellt");
    return;
  }
  const text = vorfallText({ ...vorfall, laufUrl: laufAdresse(einstellungen) });
  const { status } = await anfrage(einstellungen.vorfallUrl, {
    methode: "POST",
    koerper: { incident: { id: vorfall.id, status: "alert" }, text },
  });
  if (status < HTTP_OK || status >= HTTP_NICHT_OK_AB) {
    ausgabe.melde("vorfall_nicht_zugestellt", { http: status });
    return;
  }
  ausgabe.melde("vorfall_gesendet");
}

export async function heartbeatNachtlauf({ einstellungen, ausgabe }) {
  if (einstellungen.heartbeatNachtlaufUrl === null) {
    ausgabe.melde("heartbeat_uebersprungen");
    return true;
  }
  const { status } = await anfrage(einstellungen.heartbeatNachtlaufUrl, {
    fristMs: HEARTBEAT_FRIST_MS,
  });
  if (status < HTTP_OK || status >= HTTP_NICHT_OK_AB) {
    ausgabe.melde("heartbeat_nicht_zugestellt", { http: status });
    return true;
  }
  ausgabe.melde("heartbeat_gemeldet");
  return true;
}

function laufAdresse({ serverUrl, repository, runId }) {
  return [serverUrl, repository, "actions/runs", runId].join("/");
}

const ANLAESSE = Object.freeze({
  hoertest: { titel: HOERTEST_TITEL, meldungen: HOERTEST_MELDUNGEN, text: issueText },
  nachtlauf: {
    titel: NACHTLAUF_TITEL,
    meldungen: NACHTLAUF_MELDUNGEN,
    text: nachtlaufText,
    vorfallId: "nachtlauf-staging",
  },
  staginglauf: {
    titel: STAGINGLAUF_TITEL,
    meldungen: STAGINGLAUF_MELDUNGEN,
    text: staginglaufText,
    vorfallId: "deploy-staging",
  },
  probe: {
    titel: PROBE_TITEL,
    meldungen: PROBE_MELDUNGEN,
    text: probeText,
    vorfallId: "probe-staging",
  },
});

export async function hoertestIssueAnlegenOderErsetzen({
  einstellungen,
  anlass = "hoertest",
  commit,
  teile,
  seit,
  ausgabe,
}) {
  const { titel, meldungen, text, vorfallId } = ANLAESSE[anlass];
  const body = text({ commit, teile, seit, laufUrl: laufAdresse(einstellungen) });
  const vorher = await issueSchreiben({ einstellungen, titel, body, meldungen, ausgabe });
  if (vorfallId === undefined) return;
  const vorfall = { id: vorfallId, titel, commit, seit };
  await vorfallMelden({ einstellungen, vorfall, vorher, ausgabe });
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
