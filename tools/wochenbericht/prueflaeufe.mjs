import { repoPages } from "./github.mjs";
import { NOT_BILLED, billedMinutes, billedMinutesBetween, durationMs, tableCell } from "./kosten.mjs";
import { WEEK_MS } from "./zeit.mjs";

const TOP_JOBS = 10;
const JOB_RUN_LIMIT = 100;
const PARALLEL = 10;

function runJobs(run) {
  return repoPages(`/actions/runs/${run.id}/jobs`, { pick: (page) => page.jobs });
}

function runDuration(run) {
  return durationMs(run.run_started_at, run.updated_at);
}

function weekRuns(runs, now) {
  const weekStart = new Date(now - WEEK_MS);
  return runs
    .filter((run) => new Date(run.created_at) >= weekStart && billedMinutes(run) > 0)
    .sort((left, right) => runDuration(right) - runDuration(left));
}

async function jobsOrNothing(run, fetchJobs) {
  try {
    const jobs = await fetchJobs(run);
    return Array.isArray(jobs) ? jobs : null;
  } catch {
    return null;
  }
}

async function answersFor(runs, fetchJobs) {
  const answers = [];
  for (let start = 0; start < runs.length; start += PARALLEL) {
    const batch = runs.slice(start, start + PARALLEL);
    answers.push(...(await Promise.all(batch.map((run) => jobsOrNothing(run, fetchJobs)))));
  }
  return answers;
}

function billedJob(job) {
  return !NOT_BILLED.has(job.conclusion) && Boolean(job.started_at) && Boolean(job.completed_at);
}

function jobRows(runs, answers) {
  return runs.flatMap((run, index) =>
    (answers[index] ?? []).filter(billedJob).map((job) => ({
      run,
      job: job.name,
      ms: durationMs(job.started_at, job.completed_at),
      minutes: billedMinutesBetween(job.started_at, job.completed_at),
    })),
  );
}

function headOf(run) {
  const pull = run.pull_requests?.[0]?.number;
  return pull === undefined ? run.head_branch : `#${pull} (${run.head_branch})`;
}

function topLines(rows) {
  const longest = [...rows].slice(0, TOP_JOBS);
  return [
    "| Workflow | Job | Minuten | Lauf | Branch/PR |",
    "| --- | --- | ---: | --- | --- |",
    ...longest.map(
      ({ run, job, minutes }) =>
        `| ${tableCell(run.name)} | ${tableCell(job)} | ${minutes} | [Lauf](${run.html_url}) | ${tableCell(headOf(run) ?? "")} |`,
    ),
  ];
}

function sumLines(rows) {
  const sums = new Map();
  for (const { run, minutes } of rows) sums.set(run.name, (sums.get(run.name) ?? 0) + minutes);
  return [
    "| Workflow | Job-Minuten in sieben Tagen |",
    "| --- | ---: |",
    ...[...sums.entries()]
      .sort(([, left], [, right]) => right - left)
      .map(([name, minutes]) => `| ${tableCell(name)} | ${minutes} |`),
  ];
}

function coverageLine({ asked, total, missing }) {
  const shortest = asked.length === 0 ? 0 : billedMinutes(asked.at(-1));
  return `Abgefragt: die ${asked.length} längsten von ${total} abgerechneten Läufen der Woche (höchstens ${JOB_RUN_LIMIT} Abfragen), der kürzeste abgefragte Lauf dauerte ${shortest} Minuten; ${missing} Läufe ohne Jobs-Antwort. Die Summen je Workflow zählen nur die abgefragten Läufe.`;
}

export async function expensiveRunsSection(runs, now, { fetchJobs = runJobs } = {}) {
  const billed = weekRuns(runs, now);
  const asked = billed.slice(0, JOB_RUN_LIMIT);
  const answers = await answersFor(asked, fetchJobs);
  const missing = answers.filter((answer) => answer === null).length;
  const rows = jobRows(asked, answers);
  const coverage = coverageLine({ asked, total: billed.length, missing });
  if (rows.length === 0) return ["Keine Daten: zu den Läufen der Woche kam keine Jobs-Antwort mit gelaufenen Jobs.", "", coverage, ""];
  return [
    ...topLines(rows),
    "",
    ...sumLines(rows),
    "",
    coverage,
    "Je Job vom Start bis zum Ende, auf ganze Minuten aufgerundet; übersprungene Jobs zählen nicht, parallele Jobs zählen einzeln.",
    "",
  ];
}
