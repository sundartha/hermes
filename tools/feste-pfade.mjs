import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { geschuetzteMuster } from "./auftrag/format.mjs";
import { MELDUNG, befundeMeldenUndScheitern } from "./auftrag/zweck.mjs";
import {
  WILDCARD,
  gitignoreGlob,
  hasFileBelow,
  hasFileStartingWith,
  isListed,
  missingGlobAlternatives,
  pathExists,
  regexFindings,
} from "./feste-pfade/muster.mjs";
import {
  ALLOWED_UNCHECKED,
  READ,
  exportedValue,
  manifestFiles,
  moduleOf,
  permissionTarget,
  readJson,
  roleFiles,
  stringsIn,
} from "./feste-pfade/lesen.mjs";
import { filterProblem, positivePattern, workflowFilters } from "./feste-pfade/workflows.mjs";
import { ROLLBACK_FOLDER } from "./migrationen-orte.mjs";
import { git, matches } from "./pruefungen-messen.mjs";
import { isCommit } from "./ts-dateien.mjs";

const NUL = "\0";
const SEPARATOR = "/";
const ANCHOR = "#";
const RED_PROBES = "test/werkzeuge/rotproben/";
const ROLES = ".claude/rollen/";
const WORKFLOW_FILE = /\.ya?ml$/;
const RULE_FILES = ["HERMES_REGELN_DATEI", "TESTREGELN_DATEI"];
const FUTURE_FOLDER = `${ROLLBACK_FOLDER}**`;
const PATH_IN_TEXT = /[\w.-]+(?:\/[\w.-]+)+/g;
const WHITESPACE = /\s/;
const CURRENT_FOLDER = /^\.\//;
const SCRIPT_ENDING = /\.(?:[cm]?[jt]s|sh)$/;
const NOT_DECLARED = "ist dort nicht deklariert";
const DECLARATION = /^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;
const EXPORTED_NAME = /(?:[\w$]+\s+as\s+)?([\w$]+)/g;
const ONLY_NEW_WITHOUT_BASIS =
  "--nur-neue braucht --basis; ohne Basis lässt sich nicht sagen, welcher Befund neu ist.";
const NO_COMMIT =
  "ist kein lesbarer Commit; ohne Basis lässt sich der Schutz umbenannter Dateien nicht vergleichen.";

function missing(where, entry) {
  return `${where}: ${entry} trifft keine versionierte Datei`;
}

function fileOrFolderFindings(state, where, paths) {
  return paths.filter((path) => !pathExists(state.files, path)).map((path) => missing(where, path));
}

function fileOnlyFindings(state, where, paths) {
  return paths.filter((path) => !isListed(state.files, path)).map((path) => missing(where, path));
}

function carriedFindings(state, where, paths) {
  const carried = (path) =>
    path.endsWith(SEPARATOR) ? hasFileBelow(state.files, path) : isListed(state.files, path);
  return paths.filter((path) => !carried(path)).map((path) => missing(where, path));
}

function globFindings(state, { where, pattern, folderToo = false, protectsAhead = false }) {
  return missingGlobAlternatives(state.files, pattern, { folderToo })
    .filter((alternative) => !protectsAhead || alternative !== FUTURE_FOLDER)
    .map((alternative) =>
      missing(where, alternative === pattern ? pattern : `${pattern} (Alternative ${alternative})`),
    );
}

function pathOrGlobFindings(state, where, path) {
  return WILDCARD.test(path)
    ? globFindings(state, { where, pattern: path })
    : fileOrFolderFindings(state, where, [path]);
}

function isRepositoryPath(state, text) {
  const [first] = text.split(SEPARATOR);
  return !WHITESPACE.test(text) && text.includes(SEPARATOR) && state.top.has(first);
}

function declaredNames(text) {
  const declared = [...text.matchAll(DECLARATION)].map(([, name]) => name);
  const listed = [...text.matchAll(EXPORT_LIST)].flatMap(([, list]) =>
    [...list.matchAll(EXPORTED_NAME)].map(([, name]) => name),
  );
  return [...declared, ...listed];
}

function declares(text, name) {
  return declaredNames(text).includes(name);
}

function moduleFindings(state, where, entry) {
  const [path, anchor] = entry.split(ANCHOR);
  if (!isListed(state.files, path)) return [missing(where, entry)];
  const text = readFileSync(join(state.root, path), "utf8");
  return anchor === undefined || declares(text, anchor)
    ? []
    : [`${where}: ${entry}: ${anchor} ${NOT_DECLARED}`];
}

function gateFindings(state, file) {
  return Object.entries(readJson(state, file)).flatMap(([gate, { module, tests }]) => [
    ...module.flatMap((entry) => moduleFindings(state, `${file} ${gate}.module`, entry)),
    ...fileOnlyFindings(state, `${file} ${gate}.tests`, tests),
  ]);
}

function protectedFindings(state, file) {
  const { gates, ...groups } = readJson(state, file);
  return [
    ...fileOnlyFindings(state, `${file} gates`, [gates]),
    ...Object.entries(groups).flatMap(([group, paths]) =>
      fileOrFolderFindings(state, `${file} ${group}`, paths),
    ),
  ];
}

function examplePrefixFindings(state, where, prefix) {
  return hasFileBelow(state.files, prefix) ? [] : [missing(where, prefix)];
}

function exampleFindings(state, file) {
  const lists = Object.entries(readJson(state, file)).filter(([, value]) => Array.isArray(value));
  return lists.flatMap(([kind, examples]) =>
    examples.flatMap(({ datei, praefix }) => [
      ...fileOnlyFindings(state, `${file} ${kind}`, [datei]),
      ...examplePrefixFindings(state, `${file} ${kind}`, praefix),
    ]),
  );
}

function codeownersFindings(state, file) {
  return geschuetzteMuster(state.root).flatMap((pattern) =>
    globFindings(state, {
      where: `${file} ${pattern}`,
      pattern: gitignoreGlob(pattern),
      folderToo: true,
      protectsAhead: true,
    }),
  );
}

function permissionPath(state, rule) {
  const target = permissionTarget(rule);
  if (target === undefined) return [];
  return target.tool === READ && !isRepositoryPath(state, target.pattern) ? [] : [target.pattern];
}

function permissionFindings(state, where, { deny = [], ...others } = {}) {
  const check = (rules, protectsAhead) =>
    stringsIn(rules)
      .flatMap((rule) => permissionPath(state, rule))
      .flatMap((path) =>
        globFindings(state, {
          where,
          pattern: gitignoreGlob(path),
          folderToo: true,
          protectsAhead,
        }),
      );
  return [...check(deny, true), ...check(others, false)];
}

function hookFindings(state, where, hooks = {}) {
  const commands = stringsIn(hooks).flatMap((command) => command.match(PATH_IN_TEXT) ?? []);
  const paths = commands.map((path) => path.replace(CURRENT_FOLDER, ""));
  return fileOnlyFindings(
    state,
    where,
    paths.filter((path) => SCRIPT_ENDING.test(path) || isRepositoryPath(state, path)),
  );
}

function settingsFindings(state, file) {
  const { permissions, hooks } = readJson(state, file);
  return [
    ...permissionFindings(state, `${file} permissions`, permissions),
    ...hookFindings(state, `${file} hooks`, hooks),
  ];
}

function roleFindings(state, folder) {
  return roleFiles(state, folder).flatMap((role) => settingsFindings(state, role));
}

function optionFindings(state, where, rules = {}) {
  const paths = stringsIn(rules).filter((text) => isRepositoryPath(state, text));
  return paths.flatMap((path) => pathOrGlobFindings(state, where, path));
}

function ruleFileFindings(state, file, module) {
  return RULE_FILES.flatMap((name) => {
    const { finding, value } = exportedValue(module, file, name);
    if (finding !== undefined) return [finding];
    const path = relative(resolve(state.root), fileURLToPath(value));
    return fileOnlyFindings(state, `${file} ${name}`, [path]);
  });
}

async function eslintFindings(state, file) {
  const module = await moduleOf(state, file);
  return [...blockFindings(state, file, module.default), ...ruleFileFindings(state, file, module)];
}

function blockFindings(state, file, blocks) {
  return blocks.flatMap((block, index) => {
    const where = `${file} ${block.name ?? `Block ${index + 1}`}`;
    const patternsOf = (list) =>
      [list ?? []].flat(Number.POSITIVE_INFINITY).filter((pattern) => typeof pattern === "string");
    const ignored = block.files === undefined ? [] : patternsOf(block.ignores);
    return [
      ...patternsOf(block.files).flatMap((pattern) =>
        globFindings(state, { where: `${where} files`, pattern }),
      ),
      ...ignored.flatMap((pattern) => globFindings(state, { where: `${where} ignores`, pattern })),
      ...optionFindings(state, `${where} rules`, block.rules),
    ];
  });
}

function sourceFindings(state, where, sources) {
  return [sources ?? []]
    .flat()
    .flatMap((source) => regexFindings(state.files, source).map((text) => `${where}: ${text}`));
}

function dependencyFindings(state, file) {
  const {
    forbidden = [],
    required = [],
    allowed,
  } = createRequire(import.meta.url)(resolve(state.root, file));
  return [
    ...(allowed === undefined ? [] : [`${file} ${ALLOWED_UNCHECKED}`]),
    ...forbidden.flatMap(({ name, from, to }) => [
      ...sourceFindings(state, `${file} ${name} from.path`, from?.path),
      ...sourceFindings(state, `${file} ${name} to.path`, to?.path),
    ]),
    ...required.flatMap(({ name, module, to }) => [
      ...sourceFindings(state, `${file} ${name} module.path`, module?.path),
      ...sourceFindings(state, `${file} ${name} to.path`, to?.path),
    ]),
  ];
}

function areaFindings(state, file) {
  return readJson(state, file).flatMap((area) =>
    Object.entries(area)
      .filter(([, value]) => Array.isArray(value))
      .flatMap(([key, sources]) =>
        sourceFindings(state, `${file} ${area.bereich}.${key}`, sources),
      ),
  );
}

function manifestPathFindings(state, where, pattern) {
  try {
    return state.files.some((file) => matches(pattern, file)) ? [] : [missing(where, pattern)];
  } catch (error) {
    return [`${where}: ${error.message}`];
  }
}

function manifestFindings(state, manifest) {
  const { pfade = [], probe = {} } = readJson(state, manifest);
  return [
    ...pfade.flatMap((path) => manifestPathFindings(state, `${manifest} pfade`, path)),
    ...carriedFindings(state, `${manifest} probe.mitnehmen`, probe.mitnehmen ?? []),
  ];
}

function redProbeFindings(state, folder) {
  return manifestFiles(state, folder).flatMap((manifest) => manifestFindings(state, manifest));
}

function codeList(names, hits) {
  return async (state, file) => {
    const module = await moduleOf(state, file);
    return names.flatMap((name) => {
      const { finding, value } = exportedValue(module, file, name);
      if (finding !== undefined) return [finding];
      const entries = [value].flat();
      return entries
        .filter((entry) => !hits(state.files, entry))
        .map((entry) => missing(`${file} ${name}`, entry));
    });
  };
}

function workflowFindings(state, folder) {
  const workflows = state.files.filter(
    (path) => path.startsWith(folder) && WORKFLOW_FILE.test(path),
  );
  return workflows.flatMap((workflow) =>
    workflowFilters(readFileSync(join(state.root, workflow), "utf8")).flatMap((filter) =>
      filter.unreadable
        ? [`${workflow}: ${filterProblem(filter)}`]
        : filter.patterns.flatMap((pattern) =>
            globFindings(state, {
              where: `${workflow} on.${filter.event}.${filter.key}`,
              pattern: positivePattern(pattern),
            }),
          ),
    ),
  );
}

function migratedFindings(state, file) {
  const entries = readJson(state, file).map((entry) => entry.file);
  return fileOnlyFindings(state, `${file} file`, entries);
}

const SOURCES = [
  { path: "tools/gate-tests.json", check: gateFindings },
  { path: "tools/ziele/geschuetzt.json", check: protectedFindings },
  { path: "tools/auftrag/musterdateien.json", check: exampleFindings },
  { path: ".github/CODEOWNERS", check: codeownersFindings },
  { path: ROLES, check: roleFindings },
  { path: ".claude/settings.json", check: settingsFindings },
  { path: "eslint.config.js", check: eslintFindings },
  { path: ".dependency-cruiser.cjs", check: dependencyFindings },
  { path: "tools/bereiche.json", check: areaFindings },
  { path: RED_PROBES, check: redProbeFindings },
  {
    path: "tools/auftrag/agenten.mjs",
    check: codeList(["KRITISCH_OHNE_GATE_TEST"], hasFileStartingWith),
  },
  { path: "tools/auftrag/bereiche.mjs", check: codeList(["GEMEINSAME_ORDNER"], pathExists) },
  { path: "tools/auftrag/lauf.mjs", check: codeList(["PIN_PRUEFUNG", "PIN_HAKEN"], isListed) },
  {
    path: "tools/mutationspruefung/vorlage.mjs",
    check: codeList(["KETTENANFANG", "SCHEMA"], isListed),
  },
  { path: ".github/workflows/", check: workflowFindings },
  { path: "test/abnahme-ausgewandert.json", check: migratedFindings },
];

function findingsOf(state, { path, check }) {
  if (!pathExists(state.files, path))
    return [
      `${path} fehlt; die Prüfung fester Pfade liest diese Liste fest und überspringt sie nicht.`,
    ];
  return check(state, path);
}

function stateOf(root, files) {
  return { root, files, top: new Set(files.map((path) => path.split(SEPARATOR)[0])) };
}

async function existenceFindings(state) {
  return (await Promise.all(SOURCES.map((source) => findingsOf(state, source)))).flat();
}

async function basisFindings(state, { basis, onlyNew }) {
  const { renamePairs, trackedAt, withSnapshot } = await import("./feste-pfade/basis.mjs");
  const { protectionFindings } = await import("./feste-pfade/schutz.mjs");
  const pairs = renamePairs(basis);
  const current = await existenceFindings(state);
  if (pairs.length === 0 && !onlyNew) return current;
  return withSnapshot(basis, async (root) => {
    const before = stateOf(root, trackedAt(basis));
    const known = new Set(onlyNew ? await existenceFindings(before) : []);
    const lost =
      pairs.length === 0 ? [] : await protectionFindings(pairs, { before, after: state });
    return [...current.filter((finding) => !known.has(finding)), ...lost];
  });
}

function findings({ basis, "nur-neue": onlyNew }) {
  const state = stateOf(".", git(["ls-files", "-z"]).split(NUL).filter(Boolean));
  if (basis === undefined) return onlyNew ? [ONLY_NEW_WITHOUT_BASIS] : existenceFindings(state);
  if (!isCommit(basis)) return [`--basis ${JSON.stringify(basis)} ${NO_COMMIT}`];
  return basisFindings(state, { basis, onlyNew });
}

const { values } = parseArgs({
  options: { basis: { type: "string" }, "nur-neue": { type: "boolean", default: false } },
});
befundeMeldenUndScheitern([...new Set(await findings(values))], MELDUNG.FESTE_PFADE);
