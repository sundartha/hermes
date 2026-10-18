import { indentOf, isContentLine, triggerSection } from "../workflows-pruefen/struktur.mjs";

const EVENT_INDENT = 2;
const EVENT = /^\s*["']?([\w-]+)["']?\s*:/;
const FILTER = /^\s*["']?(paths(?:-ignore)?)["']?\s*:\s*(.*)$/;
const FILTER_ANYWHERE = /\b(paths(?:-ignore)?)["']?\s*:/;
const ITEM = /^\s*-\s+(.+)$/;
const QUOTES = /^["']|["']$/g;
const COMMENT = /\s+#.*$/;
const NEGATION = /^!/;
const UNREADABLE = "lässt sich nicht als Liste je Zeile lesen";

function itemOf(line) {
  const item = ITEM.exec(line)?.[1].replace(COMMENT, "");
  return item?.trim().replace(QUOTES, "");
}

function endsBlock(line, indent) {
  return indentOf(line) < indent || (indentOf(line) === indent && !ITEM.test(line));
}

function filterAt(lines, index, event) {
  const [, key, inline] = FILTER.exec(lines[index]);
  const indent = indentOf(lines[index]);
  const end = lines.findIndex((line, at) => at > index && endsBlock(line, indent));
  const body = lines.slice(index + 1, end === -1 ? lines.length : end);
  const patterns = body.map(itemOf);
  const readable = inline.replace(COMMENT, "").trim() === "" && !patterns.includes(undefined);
  return { event, key, patterns: readable ? patterns : [], unreadable: !readable };
}

export function workflowFilters(text) {
  const lines = (triggerSection(text.split("\n")) ?? "").split("\n").filter(isContentLine);
  const filters = [];
  let event;
  for (const [index, line] of lines.entries()) {
    if (indentOf(line) === EVENT_INDENT) event = EVENT.exec(line)?.[1];
    const block = indentOf(line) > EVENT_INDENT && FILTER.test(line);
    if (block) filters.push(filterAt(lines, index, event));
    else if (FILTER_ANYWHERE.test(line))
      filters.push({ event, key: FILTER_ANYWHERE.exec(line)[1], patterns: [], unreadable: true });
  }
  return filters;
}

export function filterProblem({ event, key }) {
  return `${["on", event, key].filter(Boolean).join(".")} ${UNREADABLE}`;
}

export function filterHits({ patterns }, path, matches) {
  return patterns.reduce(
    (hit, pattern) => (matches(positivePattern(pattern), path) ? !NEGATION.test(pattern) : hit),
    false,
  );
}

export function positivePattern(pattern) {
  return pattern.replace(NEGATION, "");
}
