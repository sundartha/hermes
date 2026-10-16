import assert from "node:assert/strict";
import { test } from "node:test";

import { probeDirectory } from "./probe-repo.js";
import { workflowFiles, workflowLines } from "./workflow-dateien.js";

const NACHMESSEN = "systemstand-nachmessen.yml";
const SYSTEMSTAND = "systemstand.yml";
const TOP_LEVEL = /^\S/;
const TRIGGER_KEY = /^["']?on["']?:\s*$/;
const ANY_TRIGGER_KEY = /^["']?on["']?\s*:/;
const COMMENT_OR_BLANK = /^\s*(?:#.*)?$/;
const TRAILING_COMMENT = /\s+#.*$/;
const NAME_KEY = /^name:\s*(.+)$/;
const PUSH_KEY = /^ {2}push:\s*$/;
const TRIGGER_CHILD = /^ {2}\S/;
const BRANCHES_KEY = /^ {4}branches:\s*\[(.*)\]\s*$/;
const WORKFLOWS_KEY = /^ {4}workflows:\s*$/;
const LIST_ITEM = /^ {6}-\s+(.+)$/;
const QUOTES = /^["']|["']$/g;
const PUSH_MENTION = /(?:^|[\s[{,"'])push["']?\s*(?::|[,\]}]|$)/;
const PLAIN_BRANCH = /^[\w./*-]+$/;
const GLOB_TOKEN = /\*+|\./g;
const MASTER = "master";
const COMMENTED_PUSH = [
  "on:",
  "  pull_request:",
  "# nur master",
  "  push:",
  "    branches: [master]",
];
const JOB_KEY = /^ {2}[a-z][\w-]*:\s*$/;
const PUSH_ONLY_JOB_IF = "    if: github.event.workflow_run.event == 'push'";
const GROUP_BY_EVENT = "  group: systemstand-nachmessen-${{ github.event.workflow_run.event }}";
const SYSTEMSTAND_RUN = /node tools\/systemstand\.mjs (--pruefen|--issues)\s*$/;
const UNREADABLE = "unlesbar";
const PUSHES_MASTER = "push auf master";
const NO_PUSH = "kein push auf master";
const PROBE_JOBS = [
  "jobs:",
  "  probe:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: git push origin HEAD",
];
const READ_AS_PUSH = [PUSHES_MASTER];
const NOT_READ_AS_NO_PUSH = [PUSHES_MASTER, UNREADABLE];
const READ_AS_NO_PUSH = [NO_PUSH];
const NOT_READ_AS_PUSH = [NO_PUSH, UNREADABLE];
const PUSH_SPELLINGS = [
  {
    name: "übliche Schreibweise",
    trigger: ["on:", "  push:", "    branches: [master]"],
    outcomes: READ_AS_PUSH,
  },
  {
    name: "Kommentar in Spalte 0 vor push",
    trigger: COMMENTED_PUSH,
    outcomes: READ_AS_PUSH,
  },
  {
    name: "Kommentar zwischen push und branches",
    trigger: ["on:", "  push:", "  # nur master", "    branches: [master]"],
    outcomes: READ_AS_PUSH,
  },
  { name: "Glob **", trigger: ["on:", "  push:", '    branches: ["**"]'], outcomes: READ_AS_PUSH },
  { name: "Glob *", trigger: ["on:", "  push:", '    branches: ["*"]'], outcomes: READ_AS_PUSH },
  {
    name: "vier Leerzeichen Einrückung",
    trigger: ["on:", "    push:", "        branches: [master]"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "Punkt im Zweignamen ist kein Platzhalter",
    trigger: ["on:", "  push:", "    branches: [maste.]"],
    outcomes: READ_AS_NO_PUSH,
  },
  {
    name: "on in doppelten Anführungszeichen",
    trigger: ['"on":', "  push:", "    branches: [master]"],
    outcomes: READ_AS_PUSH,
  },
  {
    name: "on in einfachen Anführungszeichen",
    trigger: ["'on':", "  push:", "    branches: [master]"],
    outcomes: READ_AS_PUSH,
  },
  {
    name: "Leerzeichen vor dem Doppelpunkt von on",
    trigger: ["on :", "  push:", "    branches: [master]"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "push in Anführungszeichen",
    trigger: ["on:", '  "push":', "    branches: [master]"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "Kommentar hinter branches",
    trigger: ["on:", "  push:", "    branches: [master] # nur master"],
    outcomes: READ_AS_PUSH,
  },
  {
    name: "Auslöser als Blockliste mit Kommentar am Zeilenende",
    trigger: ["on:", "  - push # alle Zweige", "  - pull_request"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "Auslöser als Blockliste mit push in Anführungszeichen",
    trigger: ["on:", '  - "push"'],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "Kommentar hinter push:",
    trigger: ["on:", "  push: # nur master", "    branches: [master]"],
    outcomes: READ_AS_PUSH,
  },
  {
    name: "Kommentar hinter on:",
    trigger: ["on: # Auslöser", "  push:", "    branches: [master]"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "push ohne Zweigfilter",
    trigger: ["on:", "  push:", "  pull_request:"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "push mit null",
    trigger: ["on:", "  push: null"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "Leerzeichen in der Zweigliste",
    trigger: ["on:", "  push:", "    branches: [ master ]"],
    outcomes: READ_AS_PUSH,
  },
  {
    name: "branches als Blockliste",
    trigger: ["on:", "  push:", "    branches:", "      - master"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "Auslöser als Blockliste",
    trigger: ["on:", "  - push", "  - pull_request"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  { name: "Auslöser als Wert", trigger: ["on: push"], outcomes: NOT_READ_AS_NO_PUSH },
  {
    name: "Auslöser als Flussliste",
    trigger: ["on: [push, pull_request]"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "push als Flussabbildung",
    trigger: ["on:", "  push: {branches: [master]}"],
    outcomes: NOT_READ_AS_NO_PUSH,
  },
  {
    name: "Glob mit Ausschluss von master",
    trigger: ["on:", "  push:", '    branches: ["**", "!master"]'],
    outcomes: NOT_READ_AS_PUSH,
  },
  {
    name: "nur pull_request",
    trigger: ["on:", "  pull_request:", "    branches: [master]"],
    outcomes: READ_AS_NO_PUSH,
  },
  {
    name: "push nur auf andere Zweige",
    trigger: ["on:", "  push:", '    branches: ["ausmisten/**"]'],
    outcomes: READ_AS_NO_PUSH,
  },
  {
    name: "push nur im Pfad einer Datei",
    trigger: ["on:", "  pull_request:", "    paths:", "      - tools/push.mjs"],
    outcomes: READ_AS_NO_PUSH,
  },
  {
    name: "nur Zeitplan",
    trigger: ["on:", "  schedule:", '    - cron: "1 2 * * *"'],
    outcomes: READ_AS_NO_PUSH,
  },
];

function triggerBlock(workflow) {
  const content = workflow
    .filter((line) => !COMMENT_OR_BLANK.test(line))
    .map((line) => line.replace(TRAILING_COMMENT, ""));
  const start = content.findIndex((line) => TRIGGER_KEY.test(line));
  const rest = content.slice(start + 1);
  const end = rest.findIndex((line) => TOP_LEVEL.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function pushBlock(workflow) {
  const block = triggerBlock(workflow);
  const start = block.findIndex((line) => PUSH_KEY.test(line));
  if (start === -1) return undefined;
  const rest = block.slice(start + 1);
  const end = rest.findIndex((line) => TRIGGER_CHILD.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function pushBranchesLine(workflow) {
  return pushBlock(workflow)
    ?.map((line) => BRANCHES_KEY.exec(line))
    .find(Boolean);
}

function pushBranches(workflow) {
  const branches = pushBranchesLine(workflow);
  if (branches === undefined) return [];
  const entries = branches[1].split(",");
  return entries.map((branch) => branch.trim().replace(QUOTES, ""));
}

function workflowName(workflow) {
  const [, name] = workflow.map((line) => NAME_KEY.exec(line)).find(Boolean);
  return name.trim();
}

function matchesMaster(pattern) {
  const regex = pattern.replace(GLOB_TOKEN, (token) => (token === "." ? "\\." : ".*"));
  return new RegExp(`^${regex}$`).test(MASTER);
}

function unreadablePush(workflow) {
  const triggerKeys = workflow.filter((line) => ANY_TRIGGER_KEY.test(line));
  if (triggerKeys.length !== 1 || !TRIGGER_KEY.test(triggerKeys[0])) return true;
  const mentions = triggerBlock(workflow).filter((line) => PUSH_MENTION.test(line));
  if (mentions.length === 0) return false;
  if (pushBranchesLine(workflow) === undefined) return true;
  return !pushBranches(workflow).every((branch) => PLAIN_BRANCH.test(branch));
}

function pushOutcome(workflow) {
  if (unreadablePush(workflow)) return UNREADABLE;
  return pushBranches(workflow).some(matchesMaster) ? PUSHES_MASTER : NO_PUSH;
}

function pushedOnMaster(directory) {
  const files = workflowFiles(directory).filter((file) => file !== SYSTEMSTAND);
  const workflows = files.map((file) => workflowLines(file, directory));
  const pushed = workflows.filter((workflow) => pushOutcome(workflow) === PUSHES_MASTER);
  return pushed.map(workflowName).sort();
}

function probeWorkflow(trigger, name = "Probe") {
  return [`name: ${name}`, ...trigger, ...PROBE_JOBS];
}

function jobsOf(workflow) {
  const start = workflow.indexOf("jobs:");
  return workflow.slice(start + 1).filter((line) => JOB_KEY.test(line));
}

function awaited() {
  const block = triggerBlock(workflowLines(NACHMESSEN));
  const start = block.findIndex((line) => WORKFLOWS_KEY.test(line));
  const names = [];
  for (const line of block.slice(start + 1)) {
    const item = LIST_ITEM.exec(line);
    if (!item) break;
    names.push(item[1].trim());
  }
  return names.sort();
}

function systemstandRuns(file) {
  const options = workflowLines(file).map((line) => SYSTEMSTAND_RUN.exec(line)?.[1]);
  return options.filter(Boolean).sort();
}

test("Systemstand nachmessen: wartet auf genau die Workflows, die bei einem Push auf master laufen", () => {
  assert.deepEqual(awaited(), pushedOnMaster());
});

test("Systemstand nachmessen: erkennt den push-Auslöser jeder Workflow-Datei", () => {
  assert.deepEqual(
    workflowFiles().filter((file) => unreadablePush(workflowLines(file))),
    [],
  );
});

test("Systemstand nachmessen: kein Workflow mit push auf master fällt unbemerkt aus der Prüfung", () => {
  const wrong = PUSH_SPELLINGS.filter(
    ({ trigger, outcomes }) => !outcomes.includes(pushOutcome(probeWorkflow(trigger))),
  );
  assert.deepEqual(
    wrong.map(({ name }) => name),
    [],
  );
});

test("Systemstand nachmessen: misst nur nach Push-Läufen, getrennt von anderen Ereignissen", () => {
  const workflow = workflowLines(NACHMESSEN);
  const guarded = workflow.filter((line) => line === PUSH_ONLY_JOB_IF);
  assert.equal(guarded.length, jobsOf(workflow).length);
  assert.ok(workflow.includes(GROUP_BY_EVENT));
});

test("Systemstand nachmessen: misst mit denselben Aufrufen wie der Systemstand auf master", () => {
  assert.deepEqual(systemstandRuns(NACHMESSEN), ["--issues", "--pruefen"]);
  assert.deepEqual(systemstandRuns(NACHMESSEN), systemstandRuns(SYSTEMSTAND));
});

test("Systemstand nachmessen: liest auch Workflow-Dateien mit der Endung .yaml", (context) => {
  const trigger = ["on:", "  push:", "    branches: [master]"];
  const directory = probeDirectory(context, {
    "nur-yaml.yaml": probeWorkflow(trigger, "Nur yaml").join("\n"),
    "nur-yml.yml": probeWorkflow(trigger, "Nur yml").join("\n"),
    "notiz.txt": probeWorkflow(trigger, "Notiz").join("\n"),
  });
  assert.deepEqual(pushedOnMaster(directory), ["Nur yaml", "Nur yml"]);
});

test("Systemstand nachmessen: liest auch Workflow-Dateien mit Windows-Zeilenenden", (context) => {
  const directory = probeDirectory(context, {
    "windows.yml": probeWorkflow(COMMENTED_PUSH, "Mit CRLF").join("\r\n"),
  });
  assert.deepEqual(pushedOnMaster(directory), ["Mit CRLF"]);
});
