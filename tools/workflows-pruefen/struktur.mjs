export const SECRETS_PATTERN = /\bsecrets\b/i;
const INDENT_PATTERN = /^\s*/;
const CONTENT_LINE_PATTERN = /^\s*[^\s#]/;
const TOP_LEVEL_KEY_PATTERN = /^(?!-(?:\s|$))[^\s#]/;
const TRIGGER_KEY_PATTERN = /^["']?on["']?\s*:/;
const TRIGGER_VALUE_PATTERN = /^["']?on["']?\s*:([^#]*)/;
const JOBS_KEY_PATTERN = /^["']?jobs["']?\s*:/;
const NAME_PATTERN = /^\s*(?:-\s+)?["']?([^\s"':#]+)/;
const FLOW_LIST_PATTERN = /^\[(.*)\]$/;
const QUOTES_PATTERN = /^["']|["']$/g;
const WORKFLOW_RUN = "workflow_run";
const WORKFLOW_RUN_PATTERN = /\bworkflow_run\b/;
const ENVIRONMENT_KEY_PATTERN = /^\s*["']?environment["']?\s*:/;
const CHECKOUT_PATTERN = /\buses\s*:\s*["']?actions\/checkout@/i;
const CHECKOUT_TARGET_PATTERN = /(?:^|[\s{,])["']?(?:ref|repository)["']?\s*:/;
const SWITCH_COMMAND_PATTERN =
  /\bgit\b.*\b(?:checkout|switch|worktree|restore|reset)\b|\bgh\s+pr\s+checkout\b/;
const WRITE_PERMISSION_PATTERN = /\b(?:statuses|checks)["']?\s*:\s*["']?write\b|\bwrite-all\b/;
const PRUEFER_NAME_PATTERN = /(?:^|[[{,:]|-\s)\s*["']?prüfer["']?\s*(?=$|[\]},:#])/iu;

export function indentOf(line) {
  return INDENT_PATTERN.exec(line)[0].length;
}

export function isContentLine(line) {
  return CONTENT_LINE_PATTERN.test(line);
}

function topLevelBlock(lines, keyPattern) {
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start === -1) return undefined;
  const next = lines.findIndex((line, index) => index > start && TOP_LEVEL_KEY_PATTERN.test(line));
  return { start, end: next === -1 ? lines.length : next };
}

export function triggerSection(lines) {
  const block = topLevelBlock(lines, TRIGGER_KEY_PATTERN);
  return block && lines.slice(block.start, block.end).join("\n");
}

function childBlocks(lines, { start, end }) {
  const children = [];
  for (let i = start + 1; i < end; i++) if (isContentLine(lines[i])) children.push(i);
  if (children.length === 0) return [];
  const indent = indentOf(lines[children[0]]);
  const heads = children.filter((index) => indentOf(lines[index]) === indent);
  return heads.map((head, position) => ({ start: head, end: heads[position + 1] ?? end }));
}

function inlineNames(value) {
  const list = FLOW_LIST_PATTERN.exec(value);
  const parts = list === null ? [value] : list[1].split(",");
  return parts.map((part) => part.trim().replace(QUOTES_PATTERN, ""));
}

function triggerNames(lines) {
  const block = topLevelBlock(lines, TRIGGER_KEY_PATTERN);
  if (block === undefined) return [];
  const [, inline] = TRIGGER_VALUE_PATTERN.exec(lines[block.start]);
  if (inline.trim() !== "") return inlineNames(inline.trim());
  return childBlocks(lines, block).map(({ start }) => NAME_PATTERN.exec(lines[start])?.[1]);
}

function startsOnlyByWorkflowRun(lines) {
  const names = triggerNames(lines);
  return names.length === 1 && names[0] === WORKFLOW_RUN;
}

function describeJob(lines, job) {
  const body = lines.slice(job.start, job.end);
  const keys = childBlocks(lines, job).map(({ start }) => lines[start]);
  return {
    ...job,
    secrets: body.some((line) => SECRETS_PATTERN.test(line)),
    environment: keys.some((line) => ENVIRONMENT_KEY_PATTERN.test(line)),
    checkout: body.some((line) => CHECKOUT_PATTERN.test(line)),
  };
}

function describeJobs(lines) {
  const block = topLevelBlock(lines, JOBS_KEY_PATTERN);
  if (block === undefined) return [];
  return childBlocks(lines, block).map((job) => describeJob(lines, job));
}

function jobAt(jobs, index) {
  return jobs.find((job) => job.start <= index && index < job.end);
}

function secretsWithoutEnvironment(jobs) {
  return (line, index) => {
    if (!SECRETS_PATTERN.test(line) || jobAt(jobs, index)?.environment) return undefined;
    return "secrets nur in Jobs mit environment:";
  };
}

function foreignCodeInSecretJob(jobs) {
  return (line, index) => {
    const job = jobAt(jobs, index);
    if (!job?.secrets) return undefined;
    if (SWITCH_COMMAND_PATTERN.test(line))
      return "git checkout, switch, worktree, restore oder reset in einem Job mit secrets";
    if (job.checkout && CHECKOUT_TARGET_PATTERN.test(line))
      return "actions/checkout mit ref: oder repository: in einem Job mit secrets";
    return undefined;
  };
}

function writePermissionOutsideWorkflowRun(lines) {
  const allowed = startsOnlyByWorkflowRun(lines);
  return (line) => {
    if (allowed || !WRITE_PERMISSION_PATTERN.test(line)) return undefined;
    return "statuses: write, checks: write und write-all nur in Workflows mit workflow_run als einzigem Auslöser";
  };
}

function prueferAsName(line) {
  if (!PRUEFER_NAME_PATTERN.test(line.normalize("NFC"))) return undefined;
  return "kein Job darf Prüfer heißen; den Status Prüfer setzt nur die Status-API";
}

function workflowRunWithOtherTriggers(lines) {
  const mentioned = WORKFLOW_RUN_PATTERN.test(triggerSection(lines) ?? "");
  const broken = mentioned && !startsOnlyByWorkflowRun(lines);
  const triggerLine = lines.findIndex((line) => TRIGGER_KEY_PATTERN.test(line));
  return (_line, index) => {
    if (!broken || index !== triggerLine) return undefined;
    return "workflow_run in einem Workflow aus der Liste nur als einziger Auslöser";
  };
}

export function structureRules(lines, { listed }) {
  const jobs = describeJobs(lines);
  const rules = [
    secretsWithoutEnvironment(jobs),
    foreignCodeInSecretJob(jobs),
    writePermissionOutsideWorkflowRun(lines),
    prueferAsName,
  ];
  return listed ? [...rules, workflowRunWithOtherTriggers(lines)] : rules;
}
