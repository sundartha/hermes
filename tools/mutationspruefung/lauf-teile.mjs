import { nurInfrastrukturGescheitert } from "./lauf-einordnung.mjs";

const TEIL_JOB = /^(?:.+ \/ )?Mutationsprüfung \d+$/;
const FERTIG = "completed";
const WARTET = new Set(["queued", "waiting", "pending", "requested"]);
const GESCHEITERT = new Set(["failure", "cancelled", "timed_out"]);
const UEBERSPRUNGEN = new Set(["skipped", "neutral"]);

function teilJobs(jobs) {
  return jobs.filter((job) => TEIL_JOB.test(job.name));
}

export function festlegenderTeil(jobs) {
  return teilJobs(jobs).find((job) => job.status === FERTIG && job.conclusion === "failure" && !nurInfrastrukturGescheitert([job])) ?? null;
}

export function teilStand(jobs) {
  const teile = teilJobs(jobs);
  const fertig = teile.filter((job) => job.status === FERTIG);
  const rot = fertig.filter((job) => GESCHEITERT.has(job.conclusion)).length;
  const uebersprungen = fertig.filter((job) => UEBERSPRUNGEN.has(job.conclusion)).length;
  const wartend = teile.filter((job) => WARTET.has(job.status)).length;
  return { gesamt: teile.length, gruen: fertig.length - rot - uebersprungen, uebersprungen, rot, wartend, laufend: teile.length - fertig.length - wartend };
}
