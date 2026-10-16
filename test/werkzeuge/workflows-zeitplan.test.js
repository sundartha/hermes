import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowFiles, workflowLines } from "./workflow-dateien.js";

const COMMENT = /^\s*#/;
const CRON_MENTION = /\bcron\s*:/;
const CRON_LINE = /^\s*-\s+cron:\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?\s*$/;
const CONDITION_LINE = /^\s*(?:-\s+)?if:\s*(.+?)\s*$/;
const EXPRESSION_WRAPPER = /^\$\{\{\s*|\s*\}\}$/g;
const SCHEDULE_MENTION = /event\W{0,8}schedule/i;
const COMPARISON = /^github\.(event_name|event\.schedule)\s*(==|!=)\s*'([^']*)'$/;
const SCHEDULE_EVENT = "schedule";
const LINE_ENDINGS = ["", "\r"];
const SCHEDULE_KEY = "event.schedule";
const UNREADABLE = "unlesbar";
const UNKNOWN_SCHEDULE = "Zeitplan nicht vorhanden";
const NEVER_TRUE = "nie wahr";
const WEEKLY = "28 6 * * 1";
const DAILY = "28 6 * * 0,2-6";
const WHEN_DAILY = `github.event_name == 'schedule' && github.event.schedule != '${WEEKLY}'`;
const WHEN_WEEKLY = `github.event_name != 'schedule' || github.event.schedule == '${WEEKLY}'`;

const SCHEDULE_CASES = [
  {
    name: "Bedingungen und cron-Zeilen passen zusammen",
    schedule: [cron(WEEKLY), cron(DAILY)],
    conditions: [WHEN_DAILY, WHEN_WEEKLY],
    kinds: [],
  },
  {
    name: "cron-Zeile geändert, Bedingung nicht nachgezogen",
    schedule: [cron("29 6 * * 1"), cron(DAILY)],
    conditions: [WHEN_DAILY, WHEN_WEEKLY],
    kinds: [UNKNOWN_SCHEDULE, UNKNOWN_SCHEDULE, NEVER_TRUE],
  },
  {
    name: "Bedingung mit != nennt einen Zeitplan, den es nicht gibt",
    schedule: [cron("29 6 * * 1"), cron(DAILY)],
    conditions: [WHEN_DAILY],
    kinds: [UNKNOWN_SCHEDULE],
  },
  {
    name: "tägliche cron-Zeile gestrichen, die Bedingung des täglichen Schritts bleibt",
    schedule: [cron(WEEKLY)],
    conditions: [WHEN_DAILY, WHEN_WEEKLY],
    kinds: [NEVER_TRUE],
  },
  {
    name: "Zeitplan gestrichen, Bedingung bleibt",
    schedule: [],
    conditions: [WHEN_WEEKLY],
    kinds: [UNKNOWN_SCHEDULE, NEVER_TRUE],
  },
  {
    name: "Bedingung in Zeichenfolge-Funktion",
    schedule: [cron(WEEKLY)],
    conditions: [`contains(github.event.schedule, '${WEEKLY}')`],
    kinds: [UNREADABLE],
  },
  {
    name: "Bedingung mit Klammern",
    schedule: [cron(WEEKLY), cron(DAILY)],
    conditions: [`(github.event.schedule == '${WEEKLY}')`],
    kinds: [UNREADABLE],
  },
  {
    name: "cron-Zeile als Flussabbildung",
    schedule: [`    - {cron: "${WEEKLY}"}`],
    conditions: [],
    kinds: [UNREADABLE],
  },
  {
    name: "Bedingung in ${{ }}",
    schedule: [cron(WEEKLY), cron(DAILY)],
    conditions: [`\${{ ${WHEN_WEEKLY} }}`],
    kinds: [],
  },
  {
    name: "Zeitplan ohne Bedingung auf den Zeitplan",
    schedule: [cron(WEEKLY)],
    conditions: [],
    kinds: [],
  },
  {
    name: "cron-Zeile in einfachen Anführungszeichen",
    schedule: [`    - cron: '${WEEKLY}'`, cron(DAILY)],
    conditions: [WHEN_DAILY, WHEN_WEEKLY],
    kinds: [],
  },
  {
    name: "Kommentar am Ende einer cron-Zeile",
    schedule: [`${cron(WEEKLY)} # Montag`, cron(DAILY)],
    conditions: [WHEN_DAILY, WHEN_WEEKLY],
    kinds: [],
  },
  {
    name: "auskommentierte cron-Zeile",
    schedule: [cron(WEEKLY), cron(DAILY), '    # - cron: "0 0 * * *"'],
    conditions: [WHEN_DAILY, WHEN_WEEKLY],
    kinds: [],
  },
  {
    name: "Index-Zugriff auf den Zeitplan",
    schedule: [cron(WEEKLY), cron(DAILY)],
    conditions: [`github.event['schedule'] == '${WEEKLY}'`],
    kinds: [UNREADABLE],
  },
  {
    name: "Zeitplan in anderer Groß- und Kleinschreibung",
    schedule: [cron(WEEKLY), cron(DAILY)],
    conditions: [`github.Event.Schedule == '${WEEKLY}'`],
    kinds: [UNREADABLE],
  },
  {
    name: "auskommentierte Bedingung auf den Zeitplan",
    schedule: [cron(WEEKLY)],
    conditions: [],
    comments: [`      # - if: github.event.schedule == '${DAILY}'`],
    kinds: [],
  },
  {
    name: "Bedingung als erste Zeile des Schritts",
    schedule: [cron(WEEKLY), cron(DAILY)],
    conditions: [WHEN_DAILY, WHEN_WEEKLY],
    inline: true,
    kinds: [],
  },
];

function cron(expression) {
  return `    - cron: "${expression}"`;
}

function scheduleWorkflow({ schedule, conditions, comments = [], inline = false }) {
  return [
    "name: Probe",
    "on:",
    "  schedule:",
    ...schedule,
    "  workflow_dispatch:",
    "jobs:",
    "  probe:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...conditions.flatMap((condition) =>
      inline
        ? [`      - if: ${condition}`, "        run: echo ok"]
        : ["      - name: Schritt", `        if: ${condition}`, "        run: echo ok"],
    ),
    ...comments,
  ];
}

function problem(kind, line) {
  return { kind, text: line.trim() };
}

function cronsOf(workflow) {
  const mentions = workflow.filter((line) => !COMMENT.test(line) && CRON_MENTION.test(line));
  const crons = mentions.map((line) => CRON_LINE.exec(line));
  return {
    crons: crons.filter(Boolean).map((match) => match[1] ?? match[2]),
    problems: mentions
      .filter((line, index) => !crons[index])
      .map((line) => problem(UNREADABLE, line)),
  };
}

function comparisonsOf(line) {
  const expression = CONDITION_LINE.exec(line)?.[1].replace(EXPRESSION_WRAPPER, "");
  if (expression === undefined) return undefined;
  const alternatives = expression
    .split("||")
    .map((part) => part.split("&&").map((atom) => COMPARISON.exec(atom.trim())));
  return alternatives.flat().every(Boolean) ? alternatives : undefined;
}

function holds(alternatives, schedule) {
  const context = new Map([
    ["event_name", SCHEDULE_EVENT],
    [SCHEDULE_KEY, schedule],
  ]);
  return alternatives.some((atoms) =>
    atoms.every(
      ([, key, operator, literal]) => (context.get(key) === literal) === (operator === "=="),
    ),
  );
}

function conditionProblems(line, crons) {
  const alternatives = comparisonsOf(line);
  if (alternatives === undefined) return [problem(UNREADABLE, line)];
  const named = alternatives.flat().filter(([, key]) => key === SCHEDULE_KEY);
  const unknown = named.filter(([, , , literal]) => !crons.includes(literal));
  const found = unknown.map(() => problem(UNKNOWN_SCHEDULE, line));
  if (!crons.some((schedule) => holds(alternatives, schedule)))
    found.push(problem(NEVER_TRUE, line));
  return found;
}

function scheduleProblems(workflow) {
  const { crons, problems } = cronsOf(workflow);
  const conditions = workflow.filter((line) => !COMMENT.test(line) && SCHEDULE_MENTION.test(line));
  return [...problems, ...conditions.flatMap((line) => conditionProblems(line, crons))];
}

function realProblems() {
  return workflowFiles().flatMap((file) => {
    const workflow = workflowLines(file);
    return scheduleProblems(workflow).map(({ kind, text }) => `${file}: ${kind}: ${text}`);
  });
}

test("Workflows Zeitplan: jede Bedingung auf github.event.schedule nennt einen vorhandenen Zeitplan und trifft ihn", () => {
  assert.deepEqual(realProblems(), []);
});

test("Workflows Zeitplan: erkennt, wenn Bedingung und cron-Zeilen auseinanderlaufen", () => {
  const wrong = SCHEDULE_CASES.filter(({ kinds, ...parts }) =>
    LINE_ENDINGS.some((ending) => {
      const workflow = scheduleWorkflow(parts).map((line) => line + ending);
      const found = scheduleProblems(workflow).map(({ kind }) => kind);
      return found.sort().join("|") !== [...kinds].sort().join("|");
    }),
  );
  assert.deepEqual(
    wrong.map(({ name }) => name),
    [],
  );
});
