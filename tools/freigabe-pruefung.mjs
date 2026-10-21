import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import {
  WERKZEUGTEXTE_FILE,
  sendToGitHub,
  textChanges,
  writeSummary,
} from "./pr-zusammenfassung.mjs";
import { instructionFindings, lineFingerprint } from "./anweisungen-befunde.mjs";
import { FREIGABE_GRUENDE, grund, zweckZeilen } from "./freigabe-gruende.mjs";
import { pfadumzuege } from "./freigabe-pfadumzug.mjs";
import { STRENGER, stricterCases } from "./freigabe-strenger.mjs";
import {
  DURCHGELASSEN,
  FEHLALARME_DIR,
  GESTOPPT,
  LOCKERER,
  MANIFEST_FILE,
  ROTPROBEN_DIR,
  fileAt,
  git,
  listedEntries,
  losesProbe,
  manifests,
  matches,
  measureChecks,
} from "./pruefungen-messen.mjs";
import { changedExistingTestFiles, changedUnits } from "./testschutz/aenderungen.mjs";
import { closedIssueNumbers, getJson, graphql, repositoryName } from "./testschutz/github.mjs";
import { vorhandenerPfad } from "./zwillingspfad.mjs";
import {
  gleicheAenderungGegenBasis,
  holeKopf,
  prNummerAus,
} from "./warteschlange/gleicher-stand.mjs";

const APPROVERS = ["Antonio20045", "jonas986"];
const KINDS = [STRENGER, "pruefung", "werkzeugtexte", "tests-geaendert", "gespraech", "code"];
const LABEL_PREFIX = "art:";
const CODEOWNERS_FILE = ".github/CODEOWNERS";
const PACKAGE_FILE = "package.json";
const LOCK_FILE = "package-lock.json";
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const REPOSITORY_ROOT = pathToFileURL(`${process.cwd()}/`);
const CONVERSATION_PATTERNS = [
  "elevenlabs/",
  "src/i18n/prompts/",
  "src/conversation/elevenlabs-agent-config.js",
].map((pattern) => vorhandenerPfad(pattern, REPOSITORY_ROOT));
const STATUS_ADDED = "A";
const GLEICH = "gleich";
const INSTRUCTIONS_CHECK = "anweisungen";
const INSTRUCTION_LIST = "tools/basis/anweisungen.json";
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
const UNKNOWN_AUTHOR = "unbekannt";
const ANNOUNCEMENT_MARKER = "<!-- freigabe-ankuendigung -->";
const WORKFLOW_BOT = "github-actions[bot]";
const COMMENTS_PER_PAGE = 100;
const COMMENT_START = "<!--";
const COMMENT_END = "-->";
const OVERLAPPING_COMMENT_END = /^-?>/;
const LINE_BREAK_PATTERN = /\r?\n/;
const CARRIAGE_RETURN = "\r";
const NAME_CHARACTER = /[\w./|-]/;
const KEY_SEPARATOR = "|";
const LINE_BREAK = "\n";
const NAME_STATUS_FIELDS = 2;
const MIN_AGE_DAYS = 7;
const MS_PER_DAY = 86_400_000;
const REVIEWS_PER_PAGE = 100;
const SHORT_SHA = 7;
const EXIT_FAILURE = 1;
const ISSUE_TYPE = "Issue";
const RELEASE_ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { number body createdAt lastEditedAt author { login } editor { login } }
    }
  }
}`;
const PULL_TEXT_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { createdAt lastEditedAt }
  }
}`;
const USAGE =
  "Aufruf: node tools/freigabe-pruefung.mjs --basis <sha> (--pr <nr> | --warteschlange <ref>) [--registry <url>] [--downloads <url>]";

function parseOptions() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string" },
      pr: { type: "string" },
      warteschlange: { type: "string" },
      registry: { type: "string", default: "https://registry.npmjs.org" },
      downloads: { type: "string", default: "https://api.npmjs.org" },
    },
  });
  const queueMode = values.warteschlange !== undefined;
  if (values.basis === undefined || queueMode === (values.pr !== undefined)) throw new Error(USAGE);
  const sources = { registry: values.registry, downloads: values.downloads };
  const pullRequest = queueMode ? prNummerAus(values.warteschlange) : Number(values.pr);
  if (pullRequest === null) {
    throw new Error(`Keine PR-Nummer im Ref ${JSON.stringify(values.warteschlange)}.`);
  }
  return { basis: values.basis, pullRequest, queueMode, sources };
}

function changedFiles(basis) {
  const fields = git(["diff", "--no-renames", "--name-status", "-z", basis, "HEAD"]).split("\0");
  const changes = [];
  for (let i = 0; i + 1 < fields.length; i += NAME_STATUS_FIELDS) {
    changes.push({ status: fields[i], path: fields[i + 1] });
  }
  return changes;
}

function ownerPatterns(basis) {
  const texts = [fileAt(basis, CODEOWNERS_FILE), fileAt("HEAD", CODEOWNERS_FILE)].filter(Boolean);
  const entries = texts.flatMap((text) =>
    text.split("\n").map((line) => line.trim().split(/\s+/)[0]),
  );
  return [...new Set(entries.filter((entry) => entry && !entry.startsWith("#")))];
}

function isOwned(patterns, path) {
  return patterns.some((pattern) =>
    pattern.startsWith("/")
      ? matches(pattern.slice(1), path)
      : matches(pattern, path) || matches(pattern, basename(path)),
  );
}

function kindOf(patterns, path) {
  if (path === WERKZEUGTEXTE_FILE) return "werkzeugtexte";
  if (path === PACKAGE_FILE || path === LOCK_FILE) return "code";
  if (isOwned(patterns, path)) return "pruefung";
  if (CONVERSATION_PATTERNS.some((pattern) => matches(pattern, path))) return "gespraech";
  return "code";
}

function existingTestsChanged(basis) {
  return changedExistingTestFiles(basis).some((change) => changedUnits(basis, change).length > 0);
}

function jsonAt(commit, path) {
  const text = fileAt(commit, path);
  return text === undefined ? {} : JSON.parse(text);
}

function dependencies(manifest) {
  return Object.assign({}, ...DEPENDENCY_SECTIONS.map((section) => manifest[section] ?? {}));
}

function changedKeys(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((key) => !isDeepStrictEqual(before[key], after[key]));
}

function packageChanges(basis) {
  const before = jsonAt(basis, PACKAGE_FILE);
  const after = jsonAt("HEAD", PACKAGE_FILE);
  const [oldDependencies, newDependencies] = [dependencies(before), dependencies(after)];
  const ignored = new Set([...DEPENDENCY_SECTIONS, "scripts"]);
  const changedDependencies = changedKeys(oldDependencies, newDependencies);
  return {
    added: changedDependencies.filter((name) => !Object.hasOwn(oldDependencies, name)),
    removed: changedDependencies.filter((name) => !Object.hasOwn(newDependencies, name)),
    bumped: changedDependencies.filter(
      (name) => Object.hasOwn(oldDependencies, name) && Object.hasOwn(newDependencies, name),
    ),
    scripts: changedKeys(before.scripts, after.scripts),
    fields: changedKeys(before, after).filter((key) => !ignored.has(key)),
    lock: jsonAt("HEAD", LOCK_FILE),
  };
}

function lockedVersion(lock, name) {
  return lock.packages?.[`node_modules/${name}`]?.version;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} antwortet mit HTTP ${response.status}`);
  return response.json();
}

async function publication(name, version, sources) {
  const packument = await fetchJson(`${sources.registry}/${name.replace("/", "%2F")}`);
  const published = packument.time?.[version];
  if (published === undefined) throw new Error(`Version ${version} ist in der Registry unbekannt`);
  const license = packument.versions?.[version]?.license ?? packument.license ?? "unbekannt";
  return {
    ageDays: Math.floor((Date.now() - Date.parse(published)) / MS_PER_DAY),
    license: typeof license === "string" ? license : license.type,
  };
}

async function advisories(name, version, sources) {
  const found = await fetchJson(`${sources.registry}/-/npm/v1/security/advisories/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [name]: [version] }),
  });
  const reported = new Map(Object.entries(found)).get(name) ?? [];
  return reported.map(({ severity, title, url }) => `${severity}: ${title} (${url})`);
}

async function packageFacts(name, version, sources) {
  if (version === undefined)
    return { name, version: "?", fehler: "package-lock.json nennt es nicht" };
  try {
    const [{ ageDays, license }, downloads, meldungen] = await Promise.all([
      publication(name, version, sources),
      fetchJson(`${sources.downloads}/downloads/point/last-week/${name}`),
      advisories(name, version, sources),
    ]);
    return {
      name,
      version,
      alterTage: ageDays,
      lizenz: license,
      downloads: downloads.downloads,
      meldungen,
    };
  } catch (error) {
    return { name, version, fehler: error.message };
  }
}

async function youngVersions(packages, sources) {
  const reasons = [];
  for (const name of packages.bumped) {
    const version = lockedVersion(packages.lock, name);
    try {
      const { ageDays } = await publication(name, version ?? "?", sources);
      if (ageDays < MIN_AGE_DAYS) {
        reasons.push(
          grund(
            FREIGABE_GRUENDE.JUNGE_VERSION,
            `${name} ${version} ist erst ${ageDays} Tage veröffentlicht, verlangt sind ${MIN_AGE_DAYS}.`,
          ),
        );
      }
    } catch (error) {
      reasons.push(
        grund(
          FREIGABE_GRUENDE.ALTER_UNBEKANNT,
          `Das Alter von ${name} ${version ?? "?"} ist nicht ermittelbar: ${error.message}.`,
        ),
      );
    }
  }
  return reasons;
}

function listed(zweck, prefix, items) {
  return items.length === 0 ? [] : [grund(zweck, `${prefix}: ${items.join(", ")}.`)];
}

function approvalReasons({ changes, packages, texts, measured }) {
  const modified = changes.filter(
    ({ kind, status }) => kind === "pruefung" && status !== STATUS_ADDED,
  );
  const looser = measured.pruefungen.filter(({ urteil }) => urteil === LOCKERER);
  return [
    ...listed(
      FREIGABE_GRUENDE.PRUEFUNGSDATEIEN,
      "Bestehende Prüfungsdateien geändert oder gelöscht",
      modified.map(({ path }) => path),
    ),
    ...listed(
      FREIGABE_GRUENDE.LOCKERER,
      "Prüfungen werden lockerer",
      looser.map(({ titel }) => titel),
    ),
    ...listed(FREIGABE_GRUENDE.NEUE_PAKETE, "Neue npm-Pakete", packages.added),
    ...listed(FREIGABE_GRUENDE.ENTFERNTE_PAKETE, "Entfernte npm-Pakete", packages.removed),
    ...listed(
      FREIGABE_GRUENDE.SKRIPTE,
      "Geänderte Skript-Einträge in package.json",
      packages.scripts,
    ),
    ...listed(
      FREIGABE_GRUENDE.PAKETFELDER,
      "Geänderte weitere Felder in package.json",
      packages.fields,
    ),
    ...(texts.aenderungen.length > 0
      ? [
          grund(
            FREIGABE_GRUENDE.WERKZEUGTEXTE,
            "Werkzeugtexte aus tools/list geändert (Vorher und Nachher unten).",
          ),
        ]
      : []),
  ];
}

function unprovenLoosenings(measured) {
  return measured.pruefungen.filter(
    ({ urteil, fehlalarmBelegt }) => urteil === LOCKERER && !fehlalarmBelegt,
  );
}

function blockReasons(loosenings) {
  return loosenings.map(({ titel, id }) =>
    grund(
      FREIGABE_GRUENDE.OHNE_FEHLALARM,
      `Die Prüfung „${titel}“ wird lockerer, aber der PR bringt kein Fehlalarm-Beispiel unter test/werkzeuge/fehlalarme/${id}/ mit, das master meldet und dieser PR nicht mehr.`,
    ),
  );
}

async function approvals(pullRequest, headSha) {
  const { full } = repositoryName();
  const reviews = await getJson(
    `/repos/${full}/pulls/${pullRequest}/reviews?per_page=${REVIEWS_PER_PAGE}`,
  );
  const latest = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (APPROVERS.includes(login) && review.state !== "COMMENTED") latest.set(login, review);
  }
  return [...latest.values()].filter(
    (review) => review.state === "APPROVED" && review.commit_id === headSha,
  );
}

async function setKindLabel(pull, kind) {
  const { full } = repositoryName();
  const wanted = `${LABEL_PREFIX}${kind}`;
  const current = pull.labels
    .map(({ name }) => name)
    .filter((name) => name.startsWith(LABEL_PREFIX));
  for (const name of current.filter((label) => label !== wanted)) {
    await sendToGitHub(
      "DELETE",
      `/repos/${full}/issues/${pull.number}/labels/${encodeURIComponent(name)}`,
    );
  }
  if (!current.includes(wanted)) {
    await sendToGitHub("POST", `/repos/${full}/issues/${pull.number}/labels`, { labels: [wanted] });
  }
}

function classify(basis) {
  const patterns = ownerPatterns(basis);
  const files = changedFiles(basis);
  const strenger = stricterCases(basis, files) ?? [];
  const umzuege = pfadumzuege(basis, files);
  const kindFor = (path) => (umzuege.has(path) ? "code" : kindOf(patterns, path));
  const changes = files.map((change) => ({
    ...change,
    kind: strenger.length > 0 ? STRENGER : kindFor(change.path),
  }));
  const packages = packageChanges(basis);
  const kinds = new Set(changes.map(({ kind }) => kind));
  if (existingTestsChanged(basis)) kinds.add("tests-geaendert");
  const packageReview = [packages.added, packages.removed, packages.scripts, packages.fields];
  if (packageReview.some((items) => items.length > 0)) kinds.add("pruefung");
  return { changes, packages, strenger, kind: KINDS.find((kind) => kinds.has(kind)) ?? "code" };
}

function parsedJson(commit, path) {
  try {
    return JSON.parse(fileAt(commit, path));
  } catch {
    return undefined;
  }
}

function changesBesideList(id, manifest, changes) {
  const own = [ROTPROBEN_DIR, FEHLALARME_DIR].map((directory) => `${directory}/${id}/`);
  const list = manifest.ausnahmen?.datei;
  const guarded = [...own, ...manifest.pfade].filter((pattern) => pattern !== list);
  return changes.some(({ path }) => guarded.some((pattern) => matches(pattern, path)));
}

function changesInstructionCheck(basis, changes) {
  const manifest = parsedJson(basis, `${ROTPROBEN_DIR}/${INSTRUCTIONS_CHECK}/${MANIFEST_FILE}`);
  if (manifest?.ausnahmen?.datei !== INSTRUCTION_LIST) return true;
  return changesBesideList(INSTRUCTIONS_CHECK, manifest, changes);
}

function entryList(content) {
  const befunde = listedEntries(content);
  if (befunde === undefined) return undefined;
  const rest = Array.isArray(content)
    ? []
    : Object.fromEntries(Object.entries(content).filter(([key]) => key !== "befunde"));
  return { befunde, rest };
}

function instructionList(commit) {
  const content = parsedJson(commit, INSTRUCTION_LIST);
  return Array.isArray(content) ? undefined : entryList(content);
}

function addedEntries(old, current) {
  if (old === undefined || current === undefined) return undefined;
  if (!isDeepStrictEqual(old.rest, current.rest)) return undefined;
  const left = [...old.befunde];
  return current.befunde.filter((entry) => {
    const index = left.indexOf(entry);
    if (index !== -1) left.splice(index, 1);
    return index === -1;
  });
}

function lineTexts(text = "") {
  return text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function newLineEntries(basis, path) {
  const before = new Set(lineTexts(fileAt(basis, path)));
  return lineTexts(fileAt("HEAD", path))
    .filter((line) => !before.has(line))
    .map((line) => [path, lineFingerprint(line)].join(KEY_SEPARATOR));
}

function newInstructionEntries(basis, changes) {
  const reported = new Set(
    instructionFindings(".")
      .filter((finding) => finding.always !== true)
      .map(({ key }) => key),
  );
  const entries = changes.flatMap(({ path }) => newLineEntries(basis, path));
  return new Set(entries.filter((entry) => reported.has(entry)));
}

function onlyAddsNewInstructionLines(basis, changes) {
  if (changesInstructionCheck(basis, changes)) return false;
  const added = addedEntries(instructionList(basis), instructionList("HEAD"));
  if (added === undefined || added.length === 0 || new Set(added).size !== added.length)
    return false;
  const expected = newInstructionEntries(basis, changes);
  return added.length === expected.size && added.every((entry) => expected.has(entry));
}

function withNewInstructionLines(basis, changes, measured) {
  if (!onlyAddsNewInstructionLines(basis, changes)) return measured;
  const pruefungen = measured.pruefungen.map((result) =>
    result.id === INSTRUCTIONS_CHECK && result.urteil === LOCKERER
      ? { ...result, urteil: GLEICH }
      : result,
  );
  return { ...measured, pruefungen };
}

async function measure(basis, changes) {
  const checkFiles = changes.filter((change) => change.kind === "pruefung").map(({ path }) => path);
  if (checkFiles.length === 0) return { pruefungen: [], ohneMessung: [] };
  const changedFiles = changes.map(({ path }) => path);
  const measured = await measureChecks(basis, { changedFiles, checkFiles });
  return withNewInstructionLines(basis, changes, measured);
}

async function evaluate({ basis, sources }) {
  const { changes, packages, strenger, kind } = classify(basis);
  const measured = await measure(basis, changes);
  const texts = textChanges(basis);
  const pakete = await Promise.all(
    packages.added.map((name) => packageFacts(name, lockedVersion(packages.lock, name), sources)),
  );
  const needs = [
    ...approvalReasons({ changes, packages, texts, measured }),
    ...(await youngVersions(packages, sources)),
  ];
  return { kind, strenger, measured, texts, pakete, needs, changes };
}

function allProbesRan({ proben }) {
  const ran = (verdict) => verdict === GESTOPPT || verdict === DURCHGELASSEN;
  return proben.length > 0 && proben.every(({ basis, pr }) => ran(basis) && ran(pr));
}

function addedExceptions(basis, changes, result) {
  const path = `${ROTPROBEN_DIR}/${result.id}/${MANIFEST_FILE}`;
  const manifest = parsedJson(basis, path);
  if (manifest === undefined || !isDeepStrictEqual(manifest, parsedJson("HEAD", path))) return [];
  const list = manifest.ausnahmen?.datei;
  if (list === undefined || !allProbesRan(result) || losesProbe(result)) return [];
  if (changesBesideList(result.id, manifest, changes)) return [];
  const [old, current] = [basis, "HEAD"].map((commit) => entryList(parsedJson(commit, list)));
  return addedEntries(old, current) ?? [];
}

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

function releaseSections(body) {
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

function standsAlone(text, at, length) {
  const neighbours = [text[at - 1], text[at + length]];
  return neighbours.every(
    (character) => character === undefined || !NAME_CHARACTER.test(character),
  );
}

function namesWord(text, word) {
  if (typeof word !== "string" || word === "") return false;
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (standsAlone(text, at, word.length)) return true;
  }
  return false;
}

function releasesOnLine(line, pruefung, checks) {
  const named = checks.filter(({ id, titel }) => namesWord(line, titel) || namesWord(line, id));
  return named.length === 1 && named[0].id === pruefung.id;
}

function namesException(lines, { pruefung, entries }, checks) {
  const own = lines.filter((line) => releasesOnLine(line, pruefung, checks));
  return entries.every((entry) => own.some((line) => namesWord(line, entry)));
}

function writtenBeforeApproval(texts, approvedAt) {
  const written = texts.map((text) => text?.lastEditedAt ?? text?.createdAt);
  if (!written.every((time) => typeof time === "string")) return false;
  return approvedAt.some((time) => written.every((at) => time >= at));
}

async function linkedIssues(pull) {
  const found = await Promise.all(
    closedIssueNumbers(pull.body).map(
      async (number) => (await graphql(RELEASE_ISSUE_QUERY, number)).issueOrPullRequest,
    ),
  );
  return found.filter((node) => node?.__typename === ISSUE_TYPE);
}

async function namedExceptions(options, result, pull) {
  const candidates = unprovenLoosenings(result.measured)
    .map((pruefung) => ({
      pruefung,
      entries: addedExceptions(options.basis, result.changes, pruefung),
    }))
    .filter(({ entries }) => entries.length > 0);
  if (candidates.length === 0) return [];
  const checks = [...manifests(".")].map(([id, { titel }]) => ({ id, titel }));
  const issues = await linkedIssues(pull);
  const named = candidates.flatMap(({ pruefung, entries }) => {
    const naming = issues.filter(({ body }) =>
      releaseSections(body).some((lines) => namesException(lines, { pruefung, entries }, checks)),
    );
    return naming.length === 0 ? [] : [{ pruefung, entries, issues: naming }];
  });
  if (named.length === 0) return [];
  const pullText = (await graphql(PULL_TEXT_QUERY, pull.number)).pullRequest;
  return named.map((exception) => ({ ...exception, pullText }));
}

function announcementLine({ pruefung, entries }) {
  const listed = entries.map((entry) => `\`${entry}\``).join(", ");
  return `- Prüfung „${pruefung.titel}“ (${pruefung.id}): ${listed}`;
}

function announcementText(exceptions, headSha) {
  return [
    ANNOUNCEMENT_MARKER,
    "## Freigabe-Prüfung: Ankündigung",
    "",
    `Stand: ${headSha}`,
    "",
    ...exceptions.map(announcementLine),
    "",
    `Diese Ausnahmen ohne Fehlalarm-Beispiel gelten erst mit einem Approve von ${APPROVERS.join(" oder ")} auf diesem Stand, gegeben nach diesem Kommentar. Wird der Kommentar bearbeitet, gilt er nicht mehr.`,
    "",
  ].join(LINE_BREAK);
}

function announces(comment, headSha, exception) {
  if (comment.user?.login !== WORKFLOW_BOT) return false;
  const lines = (comment.body ?? "").split(LINE_BREAK_PATTERN);
  return (
    lines[0] === ANNOUNCEMENT_MARKER &&
    lines.includes(`Stand: ${headSha}`) &&
    lines.includes(announcementLine(exception))
  );
}

async function announced(options, named, headSha) {
  if (named.length === 0) return named;
  const { full } = repositoryName();
  const path = `/repos/${full}/issues/${options.pullRequest}/comments`;
  const comments = await getJson(`${path}?per_page=${COMMENTS_PER_PAGE}`);
  const withAnnouncement = named.map((exception) => ({
    ...exception,
    announcement: comments.find((comment) => announces(comment, headSha, exception)),
  }));
  const missing = withAnnouncement.filter(({ announcement }) => announcement === undefined);
  if (!options.queueMode && missing.length > 0) {
    await sendToGitHub("POST", path, { body: announcementText(missing, headSha) });
  }
  return withAnnouncement;
}

function announcementWritten(announcement) {
  if (announcement === undefined) return undefined;
  return { createdAt: announcement.created_at, lastEditedAt: announcement.updated_at };
}

function releasingIssue({ issues, pullText, announcement }, approvedAt) {
  const texts = [pullText, announcementWritten(announcement)];
  return issues.find((issue) => writtenBeforeApproval([issue, ...texts], approvedAt));
}

function notAnnouncedLine({ announcement }, approvedAt) {
  if (approvedAt.length === 0) return [];
  if (writtenBeforeApproval([announcementWritten(announcement)], approvedAt)) return [];
  return [
    "Die Ausnahme wurde vor dem Approve nicht angekündigt; die Ankündigung steht jetzt als Kommentar „Freigabe-Prüfung: Ankündigung“ im PR, ein neues Approve auf diesem Stand gibt sie frei.",
  ];
}

function issueName({ number, author, editor }) {
  const edited = editor?.login === undefined ? "" : `, zuletzt bearbeitet von ${editor.login}`;
  return `#${number} (geschrieben von ${author?.login ?? UNKNOWN_AUTHOR}${edited})`;
}

function exceptionLines(named, approvedAt) {
  return named.flatMap((exception) => {
    const { pruefung, entries, issues } = exception;
    const issue = releasingIssue(exception, approvedAt);
    const lockerung = `Die Prüfung „${pruefung.titel}“ wird lockerer ohne Fehlalarm-Beispiel`;
    if (issue !== undefined) {
      return [
        `Freigegebene Ausnahme laut Issue ${issueName(issue)}: ${lockerung}, freigegeben für ${entries.join(", ")}.`,
      ];
    }
    const names = issues.map(issueName).join(", ");
    return [
      `Ausnahme nach Issue ${names}: ${lockerung} für ${entries.join(", ")}; ein Approve von ${APPROVERS.join(" oder ")} auf diesem Stand, gegeben nach der Ankündigung im PR und nach dem Anlegen und der letzten Änderung des Issues und des PR-Texts, gibt sie frei.`,
      ...notAnnouncedLine(exception, approvedAt),
    ];
  });
}

function statusLines({ needs, blocks, approvedBy, headSha }) {
  const approval =
    approvedBy.length > 0
      ? [
          `Freigegeben von ${approvedBy.join(" und ")} auf dem Stand ${headSha.slice(0, SHORT_SHA)}.`,
        ]
      : [
          `Es fehlt eine Freigabe von ${APPROVERS.join(" oder ")} auf dem Stand ${headSha.slice(0, SHORT_SHA)}.`,
        ];
  return [
    ...blocks.map(({ text }) => `Muss geändert werden: ${text}`),
    ...needs.map(({ text }) => `Braucht Freigabe: ${text}`),
    ...(needs.length > 0 ? approval : []),
  ];
}

function sameChangeInQueue({ basis, pullRequest }, headSha) {
  holeKopf(pullRequest, headSha, process.cwd());
  return gleicheAenderungGegenBasis({ basis, kopf: headSha }, process.cwd()).gleich;
}

async function countedApprovers(options, { needs }, headSha) {
  if (needs.length === 0) return { approvedBy: [], approvedAt: [], notes: [] };
  const reviews = await approvals(options.pullRequest, headSha);
  const approvedBy = reviews.map(({ user }) => user.login);
  if (!options.queueMode || approvedBy.length === 0 || sameChangeInQueue(options, headSha)) {
    return { approvedBy, approvedAt: reviews.map(({ submitted_at }) => submitted_at), notes: [] };
  }
  return {
    approvedBy: [],
    approvedAt: [],
    notes: [
      grund(
        FREIGABE_GRUENDE.WARTESCHLANGE,
        `Die Freigabe auf dem Stand ${headSha.slice(0, SHORT_SHA)} zählt in der Warteschlange nicht, weil die Änderung dort anders ist.`,
      ),
    ],
  };
}

async function main() {
  const options = parseOptions();
  const { full } = repositoryName();
  const pull = await getJson(`/repos/${full}/pulls/${options.pullRequest}`);
  const result = await evaluate(options);
  const headSha = pull.head.sha;
  const { approvedBy, approvedAt, notes } = await countedApprovers(options, result, headSha);
  const named = await announced(options, await namedExceptions(options, result, pull), headSha);
  const released = named.filter((exception) => releasingIssue(exception, approvedAt) !== undefined);
  const blocks = blockReasons(
    unprovenLoosenings(result.measured).filter(
      (pruefung) => !released.some((exception) => exception.pruefung === pruefung),
    ),
  );
  const gruende = [
    ...exceptionLines(named, approvedAt),
    ...statusLines({ ...result, blocks, approvedBy, headSha }),
    ...notes.map(({ text }) => text),
  ];
  const waiting = result.needs.length > 0 && approvedBy.length === 0;
  const zweck = zweckZeilen([...blocks, ...(waiting ? [...result.needs, ...notes] : [])]);
  const { pruefungen, ohneMessung } = result.measured;
  const findings = [
    pruefungen,
    ohneMessung,
    result.pakete,
    result.texts.aenderungen,
    result.strenger,
  ];
  const relevant = result.texts.erstmals || findings.some((items) => items.length > 0);
  const report = {
    art: result.kind,
    gruende,
    zweck,
    strenger: result.strenger,
    ...result.measured,
    pakete: result.pakete,
    texte: result.texts,
  };
  if (!options.queueMode) {
    await writeSummary(options.pullRequest, report, relevant);
    await setKindLabel(pull, result.kind);
  }
  console.log(`Freigabe-Prüfung: Art art:${result.kind}.`);
  for (const { path, fall } of result.strenger) console.log(`Strenger: ${path}: ${fall}`);
  for (const line of [...gruende, ...zweck]) console.log(line);
  if (blocks.length > 0 || waiting) process.exitCode = EXIT_FAILURE;
  else console.log("Keine offene Freigabe.");
}

try {
  await main();
} catch (error) {
  console.error(`Freigabe-Prüfung: Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
