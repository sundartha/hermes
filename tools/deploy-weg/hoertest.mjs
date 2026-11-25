import { appendFileSync } from "node:fs";

import { urteilen } from "../../scripts/anruf-probe/urteil.mjs";
import { AUTOMATION_LOGIN } from "../github.mjs";
import { Abbruch, zeileBauen } from "./ausgabe.mjs";
import { anbieterStoerungen, anfrage, githubZugang } from "./netz.mjs";
import { absichtlichRotMelden, fruehwarnungOk } from "./staging.mjs";
import { ECHTE_UHR } from "./takt.mjs";

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

function probeText({ commit, laufUrl, seit, grund, messungGrund }) {
  if (grund !== undefined) {
    return [
      "Die Anrufprobe gegen Staging ist nicht gelaufen: " + grund + " (Commit " + commit + ").",
      "Seit: " + seit,
      "Lauf: " + laufUrl,
      "",
      "Das ist kein Hörtest und keine Freigabe für Live. Es fand kein Anruf statt.",
      "",
    ].join("\n");
  }
  return [
    "Die Anrufprobe gegen Staging ist rot, auch die Wiederholung (Commit " + commit + ").",
    "Seit: " + seit,
    ...(messungGrund === undefined ? [] : ["Messung warf: " + messungGrund]),
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

function vorfallText({ titel, commit, laufUrl, seit, grund, gestoert }) {
  return [
    titel + " (Commit " + commit + ").",
    ...(grund === undefined ? [] : ["Grund: " + grund]),
    ...(seit === undefined ? [] : ["Seit: " + seit]),
    "Umgebung: Staging.",
    ...gestoert.map((name) => "Anbieter meldet gerade Störung: " + name),
    "Lauf: " + laufUrl,
    "Erster Schritt: Ursache im Lauf lesen",
  ].join("\n");
}

function frischGemeldet(vorher, jetzt) {
  const geaendert = Date.parse(vorher?.updated_at ?? "");
  return Number.isFinite(geaendert) && jetzt - geaendert < VORFALL_ENTPRELLEN_MS;
}

async function vorfallSenden({ adresse, koerper, vorsilbe, ausgabe }) {
  const { status } = await anfrage(adresse, { methode: "POST", koerper });
  if (status < HTTP_OK || status >= HTTP_NICHT_OK_AB) {
    ausgabe.melde(vorsilbe + "_nicht_zugestellt", { http: status });
    return false;
  }
  ausgabe.melde(vorsilbe + "_gesendet");
  return true;
}

async function vorfallMelden({ einstellungen, vorfall, vorher, ausgabe }) {
  const wege = [
    { vorsilbe: "slack", adresse: einstellungen.slackUrl },
    { vorsilbe: "vorfall", adresse: einstellungen.vorfallUrl },
  ];
  const aktiv = wege.filter((weg) => weg.adresse !== null);
  for (const weg of wege) if (weg.adresse === null) ausgabe.melde(weg.vorsilbe + "_uebersprungen");
  const entprellt = frischGemeldet(vorher, Date.now());
  const gestoert = entprellt || aktiv.length === 0 ? [] : await anbieterStoerungen(einstellungen.anbieterStatus);
  const text = vorfallText({ ...vorfall, laufUrl: laufAdresse(einstellungen), gestoert });
  for (const weg of aktiv) {
    if (entprellt) {
      ausgabe.melde(weg.vorsilbe + "_entprellt");
      continue;
    }
    const koerper = weg.vorsilbe === "slack" ? { text } : { incident: { id: vorfall.id, status: "alert" }, text };
    await vorfallSenden({ adresse: weg.adresse, koerper, vorsilbe: weg.vorsilbe, ausgabe });
  }
}

export async function liveProbeMelden({ einstellungen, abweichungen, ausgabe }) {
  if (einstellungen.slackUrl === null) {
    ausgabe.melde("slack_uebersprungen");
    return;
  }
  const gestoert = await anbieterStoerungen(einstellungen.anbieterStatus);
  const text = [
    ...abweichungen.map(({ teil, http }) => "Live-Probe: Webhook " + teil + " antwortet mit " + http),
    "Umgebung: Produktion.",
    ...gestoert.map((name) => "Anbieter meldet gerade Störung: " + name),
    "Lauf: " + laufAdresse(einstellungen),
  ].join("\n");
  await vorfallSenden({ adresse: einstellungen.slackUrl, koerper: { text }, vorsilbe: "slack", ausgabe });
}

export async function alarmprobe({ einstellungen, ausgabe }) {
  if (einstellungen.slackUrl === null) {
    ausgabe.melde("slack_uebersprungen");
    return false;
  }
  const text =
    "Probe, kein echter Fehler (Alarmweg-Probe, Lauf " + laufAdresse(einstellungen) + ")";
  return vorfallSenden({
    adresse: einstellungen.slackUrl,
    koerper: { text },
    vorsilbe: "slack",
    ausgabe,
  });
}

const HEARTBEAT_PROBE_MELDUNGEN = Object.freeze({
  uebersprungen: "heartbeat_probe_uebersprungen",
  gemeldet: "heartbeat_probe_gemeldet",
  nichtZugestellt: "heartbeat_probe_nicht_zugestellt",
});
const HEARTBEAT_NACHTLAUF_MELDUNGEN = Object.freeze({
  uebersprungen: "heartbeat_uebersprungen",
  gemeldet: "heartbeat_gemeldet",
  nichtZugestellt: "heartbeat_nicht_zugestellt",
});

export async function heartbeatMelden({ einstellungen, werte, ausgabe }) {
  const probe = werte.get("--name") === "probe";
  const meldungen = probe ? HEARTBEAT_PROBE_MELDUNGEN : HEARTBEAT_NACHTLAUF_MELDUNGEN;
  const adresse = probe ? einstellungen.heartbeatProbeUrl : einstellungen.heartbeatNachtlaufUrl;
  if (adresse === null) {
    ausgabe.melde(meldungen.uebersprungen);
    return true;
  }
  const { status } = await anfrage(adresse, { fristMs: HEARTBEAT_FRIST_MS });
  if (status < HTTP_OK || status >= HTTP_NICHT_OK_AB) {
    ausgabe.melde(meldungen.nichtZugestellt, { http: status });
    return true;
  }
  ausgabe.melde(meldungen.gemeldet);
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
  grund,
  messungGrund,
  ausgabe,
}) {
  const { titel, meldungen, text, vorfallId } = ANLAESSE[anlass];
  const body = text({ commit, teile, seit, grund, messungGrund, laufUrl: laufAdresse(einstellungen) });
  const vorher = await issueSchreiben({ einstellungen, titel, body, meldungen, ausgabe });
  if (vorfallId === undefined) return;
  const vorfall = { id: vorfallId, titel, commit, seit, grund };
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

const MONATSERSTER = 1;
const STUMM = Object.freeze({ melde: () => undefined });
const UEBER_SCHWELLE = Object.freeze({ webhooksAbgewiesen: 1, anrufeUeberHoechstdauer: 1 });

const SCHICHTEN = Object.freeze([
  {
    id: "1",
    name: "Staging-Smoke",
    rotErzeugen: () =>
      absichtlichRotMelden({ einstellungen: { absichtlichRot: true }, ausgabe: STUMM }),
  },
  {
    id: "2a",
    name: "Stille-Waechter",
    rotErzeugen: () =>
      !fruehwarnungOk({ stand: UEBER_SCHWELLE, basis: 0, eigene: 0, ausgabe: STUMM }),
  },
  { id: "3", name: "Anrufprobe", rotErzeugen: () => !urteilen(null).gruen },
]);

function zugestellt(status) {
  return status >= HTTP_OK && status < HTTP_NICHT_OK_AB;
}

function zeitMelden({ einstellungen, ausgabe, schicht, ms }) {
  ausgabe.melde("pruefung_zeit", { schicht: schicht.id, ms });
  if (einstellungen.schrittZusammenfassung === null) return;
  const zeile = zeileBauen("pruefung_zeit", { schicht: schicht.id, ms });
  appendFileSync(einstellungen.schrittZusammenfassung, zeile + "\n");
}

async function schichtPruefen({ einstellungen, ausgabe, uhr, schicht }) {
  const start = uhr.jetzt();
  if (!schicht.rotErzeugen()) {
    ausgabe.melde("pruefung_defekt", { schicht: schicht.id });
    return false;
  }
  const text =
    "Probe, kein echter Fehler (Prüfung der Prüfung, Schicht " +
    schicht.id +
    " " +
    schicht.name +
    ", Lauf " +
    laufAdresse(einstellungen) +
    ")";
  const { status } = await anfrage(einstellungen.slackUrl, { methode: "POST", koerper: { text } });
  const ende = uhr.jetzt();
  if (!zugestellt(status)) {
    ausgabe.melde("pruefung_nicht_zugestellt", { schicht: schicht.id, http: status });
    return false;
  }
  zeitMelden({ einstellungen, ausgabe, schicht, ms: ende - start });
  return true;
}

export async function monatspruefung({
  einstellungen,
  ausgabe,
  uhr = ECHTE_UHR,
  schichten = SCHICHTEN,
}) {
  if (new Date(uhr.jetzt()).getUTCDate() !== MONATSERSTER) {
    ausgabe.melde("pruefung_uebersprungen");
    return true;
  }
  if (einstellungen.slackUrl === null) {
    ausgabe.melde("pruefung_ohne_slack");
    return false;
  }
  const ergebnisse = [];
  for (const schicht of schichten) {
    ergebnisse.push(await schichtPruefen({ einstellungen, ausgabe, uhr, schicht }));
  }
  return ergebnisse.every(Boolean);
}
