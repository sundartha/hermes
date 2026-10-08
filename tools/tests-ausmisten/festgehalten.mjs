const ERFOLG = "success";
const PRUEFSUMMEN_ZEILE = /^(?:\S+ )?Basis-Prüfsumme basis-(\d+): ([0-9a-f]{64})\s*$/;

export function basisJobName(nummer) {
  return `Paket ${nummer} / Basis messen`;
}

export function branchJobName(nummer) {
  return `Paket ${nummer} / Branch messen`;
}

export function pruefsummenZeile(nummer, summe) {
  return `Basis-Prüfsumme basis-${nummer}: ${summe}`;
}

export function summeImProtokoll(protokoll, nummer) {
  const treffer = protokoll
    .split("\n")
    .map((zeile) => PRUEFSUMMEN_ZEILE.exec(zeile))
    .filter(Boolean);
  if (treffer.length !== 1 || treffer[0][1] !== String(nummer)) return undefined;
  return treffer[0][2];
}

export async function jobsDesLaufs(github, laufId) {
  return github.alle(`/actions/runs/${laufId}/jobs?filter=latest`, (antwort) => antwort.jobs);
}

function einzigerJob(jobs, name) {
  const passend = jobs.filter((job) => job.name === name);
  if (passend.length === 1) return { job: passend[0] };
  return { fehler: `Job „${name}“ gibt es ${passend.length}-mal` };
}

export function jobFehler(jobs, name) {
  const { job, fehler } = einzigerJob(jobs, name);
  if (fehler) return fehler;
  if (job.conclusion === ERFOLG) return undefined;
  return `Job „${name}“ endete mit ${job.conclusion ?? job.status}`;
}

export async function festgehalteneSumme(github, { jobs, nummer }) {
  const name = basisJobName(nummer);
  const fehler = jobFehler(jobs, name);
  if (fehler) return { fehler };
  const { job } = einzigerJob(jobs, name);
  let protokoll;
  try {
    protokoll = (await github.roh(`/actions/jobs/${job.id}/logs`)).toString("utf8");
  } catch (grund) {
    return { fehler: `Protokoll von „${name}“ nicht lesbar: ${grund.message}` };
  }
  const summe = summeImProtokoll(protokoll, nummer);
  if (summe !== undefined) return { summe };
  return { fehler: `Das Protokoll von „${name}“ nennt die Prüfsumme nicht genau einmal` };
}
