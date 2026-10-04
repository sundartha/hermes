import { env } from "node:process";
import { setTimeout as warten } from "node:timers/promises";

import { PER_PAGE, repo } from "../wochenbericht/github.mjs";
import { gruen, rot } from "./bericht.mjs";

const MS_JE_MINUTE = 60_000;
const FRIST_IN_ABSTAENDEN = 40;
const ROT = "failure";
const FERTIG = "completed";

function abstandMs() {
  const wert = Number(env.ROTPROBEN_ABSTAND_MS ?? MS_JE_MINUTE);
  if (Number.isFinite(wert) && wert >= 0) return wert;
  throw new Error("ROTPROBEN_ABSTAND_MS ist keine Zahl von 0 an aufwärts.");
}

async function pflichtChecks() {
  const regeln = await repo("/rules/branches/master");
  return new Set(
    regeln
      .filter(({ type }) => type === "required_status_checks")
      .flatMap(({ parameters }) => parameters.required_status_checks.map(({ context }) => context)),
  );
}

async function laufFuer(sha, workflow) {
  const suche = `head_sha=${sha}&event=pull_request&per_page=${PER_PAGE}`;
  const { workflow_runs: laeufe } = await repo(`/actions/runs?${suche}`);
  const passende = laeufe.filter(({ name }) => name === workflow);
  return passende.sort((links, rechts) => rechts.id - links.id)[0];
}

function roterSchritt(jobs) {
  for (const job of jobs) {
    const schritt = (job.steps ?? []).find(({ conclusion }) => conclusion === ROT);
    if (schritt) return `${job.name} / ${schritt.name}`;
  }
  return jobs.find(({ conclusion }) => conclusion === ROT)?.name;
}

async function pflichtUrteil(probe, pflicht) {
  if (!pflicht.has(probe.pflicht)) {
    return rot(`durchgegangen: „${probe.pflicht}“ ist kein Pflicht-Check`);
  }
  const suche = `check_name=${encodeURIComponent(probe.pflicht)}&per_page=${PER_PAGE}`;
  const { check_runs: checks } = await repo(`/commits/${probe.sha}/check-runs?${suche}`);
  if (checks.some(({ conclusion }) => conclusion === ROT)) return gruen("gestoppt");
  if (checks.some(({ status }) => status !== FERTIG)) return undefined;
  const ergebnisse = checks.map(({ conclusion }) => conclusion).join(", ") || "nicht vorhanden";
  return rot(`durchgegangen: Pflicht-Check „${probe.pflicht}“ ist ${ergebnisse}`);
}

async function schrittUrteil(probe, lauf, pflicht) {
  const { jobs } = await repo(`/actions/runs/${lauf.id}/jobs?per_page=${PER_PAGE}`);
  const job = jobs.find(({ name }) => name === probe.job);
  const schritt = (job?.steps ?? []).find(({ name }) => name === probe.schritt);
  if (schritt?.conclusion === ROT) return pflichtUrteil(probe, pflicht);
  const anderer = roterSchritt(jobs);
  if (anderer) return rot(`falscher Schritt: ${anderer}`);
  if (lauf.conclusion === "success") return rot("durchgegangen");
  return rot(`durchgegangen (Lauf ${lauf.conclusion})`);
}

async function urteilFuer(probe, pflicht) {
  const pull = await repo(`/pulls/${probe.pr}`);
  if (pull.auto_merge) return rot("Auto-Merge an einer Probe");
  const lauf = await laufFuer(pull.head.sha, probe.workflow);
  if (lauf?.status !== FERTIG) return undefined;
  return schrittUrteil({ ...probe, sha: pull.head.sha }, lauf, pflicht);
}

async function runde(proben, ergebnisse, pflicht) {
  for (const probe of proben.filter(({ fall }) => !ergebnisse.has(fall))) {
    const urteil = await urteilFuer(probe, pflicht);
    if (urteil) ergebnisse.set(probe.fall, urteil);
  }
}

export async function warteUndWerteAus(proben) {
  const abstand = abstandMs();
  const frist = Date.now() + FRIST_IN_ABSTAENDEN * abstand;
  const pflicht = await pflichtChecks();
  const ergebnisse = new Map();
  await runde(proben, ergebnisse, pflicht);
  while (ergebnisse.size < proben.length && Date.now() < frist) {
    await warten(abstand);
    await runde(proben, ergebnisse, pflicht);
  }
  return proben.map((probe) => ({
    ...probe,
    ergebnis: ergebnisse.get(probe.fall) ?? rot("Zeit abgelaufen"),
  }));
}
