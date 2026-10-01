import { readFileSync } from "node:fs";

import { DAY_MS, WEEK_MS, daysInMonth, monthName, monthStart } from "./zeit.mjs";

const BUDGET_FILE = ".github/budget.json";
const MINUTE_MS = 60_000;
const PERCENT = 100;
const NOT_BILLED = new Set(["skipped"]);

export function readBudget() {
  return JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
}

function billedMinutes(run) {
  if (run.status !== "completed" || NOT_BILLED.has(run.conclusion)) return 0;
  const duration = new Date(run.updated_at) - new Date(run.run_started_at);
  return Math.max(1, Math.ceil(duration / MINUTE_MS));
}

function rowOf(table, name) {
  if (!table.has(name)) table.set(name, { week: 0, month: 0 });
  return table.get(name);
}

function minutesByWorkflow(runs, { weekStart, start }) {
  const table = new Map();
  for (const run of runs) {
    const minutes = billedMinutes(run);
    if (minutes === 0) continue;
    const created = new Date(run.created_at);
    const row = rowOf(table, run.name);
    if (created >= weekStart) row.week += minutes;
    if (created >= start) row.month += minutes;
  }
  return [...table.entries()].sort(
    ([, left], [, right]) => right.week - left.week || right.month - left.month,
  );
}

function longestRun(runs, workflow, weekStart) {
  const minutes = runs
    .filter((run) => run.name === workflow && new Date(run.created_at) >= weekStart)
    .map(billedMinutes);
  return minutes.length === 0 ? undefined : Math.max(...minutes);
}

function perRunLines(runs, budget, weekStart) {
  return Object.entries(budget.minutenJeLauf).map(([workflow, limit]) => {
    const longest = longestRun(runs, workflow, weekStart);
    if (longest === undefined)
      return `- ${workflow}: ${limit} Minuten je Lauf, in sieben Tagen kein Lauf.`;
    const verdict = longest > limit ? "über dem Kontingent" : "im Kontingent";
    return `- ${workflow}: ${limit} Minuten je Lauf, längster Lauf in sieben Tagen ${longest} Minuten, ${verdict}.`;
  });
}

function quotaLines(total, budget, now) {
  const start = monthStart(now);
  const elapsedDays = Math.max(1, (now - start) / DAY_MS);
  const forecast = Math.round((total / elapsedDays) * daysInMonth(now));
  const share = Math.round((total / budget.monatsMinuten) * PERCENT);
  const order = budget.verzicht.join(", dann ");
  const warning =
    forecast > budget.monatsMinuten
      ? `Bei diesem Tempo reicht das Kontingent nicht; verzichtet wird zuerst auf ${order}.`
      : `Bei diesem Tempo reicht das Kontingent. Reihenfolge des Verzichts, falls es knapp wird: ${order}.`;
  return [
    `Monatskontingent ${monthName(now)}: ${total} von ${budget.monatsMinuten} Minuten verbraucht (${share} %), bei gleichem Tempo bis Monatsende etwa ${forecast} Minuten.`,
    warning,
  ];
}

export function costSection(runs, budget, now) {
  const weekStart = new Date(now - WEEK_MS);
  const rows = minutesByWorkflow(runs, { weekStart, start: monthStart(now) });
  const total = rows.reduce((sum, [, row]) => sum + row.month, 0);
  const weekTotal = rows.reduce((sum, [, row]) => sum + row.week, 0);
  const table = [
    `| Workflow | Minuten in sieben Tagen | Minuten im ${monthName(now)} |`,
    "| --- | ---: | ---: |",
    ...rows.map(([name, row]) => `| ${name.split("|").join("\\|")} | ${row.week} | ${row.month} |`),
    `| **Summe** | **${weekTotal}** | **${total}** |`,
  ];
  return [
    ...table,
    "",
    ...quotaLines(total, budget, now),
    "",
    "Kontingent je Lauf aus `.github/budget.json`:",
    "",
    ...perRunLines(runs, budget, weekStart),
    "",
    "Geschätzt aus den Laufzeiten der Workflows: je Lauf vom Start bis zum Ende, auf ganze Minuten aufgerundet, übersprungene Läufe zählen nicht. Parallele Jobs eines Laufs zählen nur einmal; Wartezeit in der Warteschlange zählt nicht.",
    "",
  ];
}

export function runWindowStart(now) {
  return new Date(Math.min(monthStart(now).getTime(), now - WEEK_MS));
}
