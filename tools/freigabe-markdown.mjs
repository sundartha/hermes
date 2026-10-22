const RELEASE_HEADING = /^##\s+Freigabe Antonio (\d{4}-\d{2}-\d{2})$/;
const ANY_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const HEADING_START = /^[ \t]*#{1,6}(?:\s|$)/;
const FENCE_START = /^(`{3,}(?![^`]*`)|~{3,})/;
const FENCE_LIKE = /^[ \t]*(?:`{3,}|~{3,})/;
const INDENTED_FENCE = /^ {1,3}(?:`{3,}|~{3,})/;
const LATE_ORDERED_ITEM = /^ {0,3}(?!1[.)])\d+[.)]/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ITEM_LEAD = /^ {0,3}/;
const ITEM_UNIT = /^(?:[-*+]|\d{1,9}[.)])(?: {1,4}|\t)/;
const BLOCK_MARKER = /^[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))/;
const QUOTE_LINE = /^[ \t]*>/;
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])|<[!?]/;
const LINK_LABEL_START = /^[ \t]*\[(?![^[\]\\]*\](?!:))/;
const SETEXT_UNDERLINE = /^[ \t]*(?:=+|-+)[ \t]*$/;
const TABLE_DELIMITER = /^(?=[^-]*-)(?=[^|:]*[|:])[ \t|:-]+$/;
const BACKSLASH = "\\";
const CODE_INDENT = 4;
const KIND_BLANK = "blank";
const KIND_SKIP = "skip";
const KIND_UNSURE = "unsure";
const KIND_BREAK = "break";
const KIND_END = "end";
const KIND_HEADING = "heading";
const KIND_TEXT = "text";
const LEADING_BLANKS = /^[ \t]*/;
const BLANK_LINE = /^[ \t]*$/;
const TAB_STOP = 4;
const COMMENT_START = "<!--";
const COMMENT_END = "-->";
const OVERLAPPING_COMMENT_END = /^-?>/;
const LINE_BREAK_PATTERN = /\r?\n/;
const CARRIAGE_RETURN = "\r";

function commentStart(line, rest, at) {
  const before = line.slice(0, line.length - rest.length + at);
  const after = rest.slice(at + COMMENT_START.length);
  if (BLANK_LINE.test(before) && columnsOf(before) >= CODE_INDENT) return undefined;
  if (OVERLAPPING_COMMENT_END.test(after)) return undefined;
  if (before.endsWith(BACKSLASH)) return undefined;
  const end = after.indexOf(COMMENT_END);
  if (end !== -1) return { rest: after.slice(end + COMMENT_END.length), open: false };
  return at === 0 && rest === line ? { rest: "", open: true } : undefined;
}

function withoutComments(line, inComment) {
  let text = "";
  let rest = line;
  let open = inComment;
  let touched = inComment;
  while (rest !== "") {
    const at = rest.indexOf(open ? COMMENT_END : COMMENT_START);
    if (at === -1) {
      if (!open) text += rest;
      break;
    }
    touched = true;
    if (open) {
      rest = rest.slice(at + COMMENT_END.length);
      open = false;
      continue;
    }
    text += rest.slice(0, at);
    const started = commentStart(line, rest, at);
    if (started === undefined) return { text, touched, inComment: false, unsure: true };
    ({ rest, open } = started);
  }
  return { text, touched, inComment: open, unsure: false };
}

function isReleaseHeading(line) {
  const date = RELEASE_HEADING.exec(line)?.[1];
  if (date === undefined) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

function columnsOf(text, start = 0) {
  let column = start;
  for (const character of text) {
    column += character === "\t" ? TAB_STOP - (column % TAB_STOP) : 1;
  }
  return column;
}

function withoutMarkers(line, marker) {
  let rest = line;
  for (let hit = marker.exec(rest); hit !== null; hit = marker.exec(rest)) {
    rest = rest.slice(hit[0].length);
  }
  return rest;
}

function itemPrefix(line) {
  const start = ITEM_LEAD.exec(line)[0].length;
  const rest = withoutMarkers(line.slice(start), ITEM_UNIT);
  const end = line.length - rest.length;
  return { rest, text: line.slice(0, end), hasItem: end > start };
}

function itemIndent(line) {
  const { text, hasItem } = itemPrefix(line);
  return hasItem ? columnsOf(text) : undefined;
}

function leavesItem(open, line) {
  const indent = open?.indent;
  if (indent === undefined || BLANK_LINE.test(line)) return false;
  return columnsOf(LEADING_BLANKS.exec(line)[0]) < indent;
}

function withoutItemIndent(line, indent) {
  if (indent === undefined) return line;
  const blanks = LEADING_BLANKS.exec(line)[0];
  return " ".repeat(Math.max(columnsOf(blanks) - indent, 0)) + line.slice(blanks.length);
}

function closingFence(open, line) {
  const inner = withoutItemIndent(line, open.indent);
  return CLOSING_FENCE.exec(inner)?.[1]?.startsWith(open.marker) === true ? undefined : open;
}

function openingFence(line) {
  const marker = FENCE_START.exec(itemPrefix(line).rest)?.[1];
  return marker === undefined ? undefined : { marker, indent: itemIndent(line) };
}

function codeAfterMarker(line) {
  let column = 0;
  let rest = line;
  for (let hit = BLOCK_MARKER.exec(rest); hit !== null; hit = BLOCK_MARKER.exec(rest)) {
    column = columnsOf(hit[0], column);
    rest = rest.slice(hit[0].length);
    const blanks = LEADING_BLANKS.exec(rest)[0];
    if (blanks !== rest && columnsOf(blanks, column) - column > CODE_INDENT) return true;
  }
  return false;
}

function isOpaque(line) {
  return (
    HTML_TAG.test(line) ||
    LINK_LABEL_START.test(withoutMarkers(line, BLOCK_MARKER)) ||
    TABLE_DELIMITER.test(withoutMarkers(line, BLOCK_MARKER)) ||
    codeAfterMarker(line)
  );
}

function isUnsure(line, afterBlank, touched) {
  if (!FENCE_LIKE.test(withoutMarkers(line, BLOCK_MARKER))) return false;
  return (
    touched ||
    !FENCE_START.test(itemPrefix(line).rest) ||
    INDENTED_FENCE.test(line) ||
    (!afterBlank && LATE_ORDERED_ITEM.test(line))
  );
}

function endsSection(line, touched) {
  return (
    HEADING_START.test(withoutMarkers(line, BLOCK_MARKER)) && (touched || !ANY_HEADING.test(line))
  );
}

function plainKind(text) {
  if (SETEXT_UNDERLINE.test(text)) return KIND_BREAK;
  if (columnsOf(LEADING_BLANKS.exec(text)[0]) >= CODE_INDENT) return KIND_SKIP;
  return ANY_HEADING.test(text) ? KIND_HEADING : KIND_TEXT;
}

function quoteKind(text, touched) {
  if (endsSection(text, touched)) return KIND_END;
  const underlined = [QUOTE_LINE, BLOCK_MARKER].some((marker) =>
    SETEXT_UNDERLINE.test(withoutMarkers(text, marker)),
  );
  return underlined ? KIND_BREAK : KIND_SKIP;
}

function lineKind({ text, touched, unsure }, afterBlank) {
  if (unsure) return KIND_UNSURE;
  if (BLANK_LINE.test(text)) return KIND_BLANK;
  if (isOpaque(text)) return KIND_UNSURE;
  if (QUOTE_LINE.test(text)) return quoteKind(text, touched);
  if (isUnsure(text, afterBlank, touched)) return KIND_UNSURE;
  if (endsSection(text, touched)) return KIND_END;
  return plainKind(text);
}

function isDropped(kind, endsItem) {
  return kind === KIND_SKIP || (kind === KIND_TEXT && endsItem);
}

function endsInComment(line) {
  let rest = line;
  let open = false;
  while (rest !== "") {
    const mark = open ? COMMENT_END : COMMENT_START;
    const at = rest.indexOf(mark);
    if (at === -1) break;
    rest = rest.slice(at + mark.length);
    open = !open;
  }
  return open;
}

function unreadable(line, fence) {
  if (line.includes(CARRIAGE_RETURN)) return true;
  if (fence === undefined) return false;
  return endsInComment(line) || (fence.indent !== undefined && ANY_HEADING.test(line));
}

function* lineEvents(body) {
  let fence;
  let afterBlank = true;
  let inComment = false;
  for (const line of body.split(LINE_BREAK_PATTERN)) {
    const endsItem = leavesItem(fence, line);
    if (endsItem) fence = undefined;
    if (unreadable(line, fence)) {
      yield { kind: KIND_UNSURE, line: "" };
      return;
    }
    if (fence !== undefined) {
      fence = closingFence(fence, line);
      afterBlank = false;
      continue;
    }
    const seen = withoutComments(line, inComment);
    inComment = seen.inComment;
    const kind = lineKind(seen, afterBlank);
    afterBlank = kind === KIND_BLANK;
    fence = kind === KIND_TEXT && !seen.touched ? openingFence(line) : undefined;
    if (fence === undefined && !isDropped(kind, endsItem)) yield { kind, line: seen.text };
    if (kind === KIND_UNSURE) return;
  }
}

function dropParagraph(lines) {
  while (lines?.at(-1)) lines.pop();
}

export function releaseSections(body) {
  const sections = [];
  let current;
  for (const { kind, line } of lineEvents(body ?? "")) {
    if (kind === KIND_HEADING) {
      current = isReleaseHeading(line.trim()) ? [] : undefined;
      if (current !== undefined) sections.push(current);
    } else if (kind === KIND_BLANK || kind === KIND_TEXT) current?.push(line.trim());
    else {
      dropParagraph(current);
      current = undefined;
    }
  }
  return sections;
}
