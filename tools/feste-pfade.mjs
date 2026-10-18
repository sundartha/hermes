import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { geschuetzteMuster } from "./auftrag/format.mjs";
import { ROLLBACK_FOLDER } from "./migrationen-orte.mjs";
import {
  WILDCARD,
  gitignoreGlob,
  hasFileBelow,
  missingGlobAlternatives,
  pathExists,
  regexFindings,
} from "./feste-pfade/muster.mjs";
import { git, matches } from "./pruefungen-messen.mjs";

const NUL = "\0";
const SEPARATOR = "/";
const ANCHOR = "#";
const MANIFEST = "pruefung.json";
const RED_PROBES = "test/werkzeuge/rotproben/";
const ROLES = ".claude/rollen/";
const JSON_ENDING = ".json";
const FUTURE_FOLDER = `${ROLLBACK_FOLDER}**`;
const EDITING = /^(?:Edit|Write)\((.+)\)$/;
const READING = /^Read\((.+)\)$/;
const OUTSIDE_REPOSITORY = /^(?:\/\/|~)/;
const PATH_IN_TEXT = /[\w.-]+(?:\/[\w.-]+)+/g;
const WHITESPACE = /\s/;
const CURRENT_FOLDER = /^\.\//;
const SCRIPT_ENDING = /\.(?:[cm]?[jt]s|sh)$/;
const HINT = [
  "Feste Pfade: Jeder Eintrag oben zeigt ins Leere und wirkt deshalb nicht mehr; die Prüfung überspringt keinen fehlenden Pfad.",
  "Steht die Datei unter neuem Namen im Repo: den Eintrag auf den neuen Pfad nachziehen.",
  "Ist sie gelöscht: in eslint.config.js, tools/bereiche.json, .dependency-cruiser.cjs oder einem Rot-Proben-Manifest den Eintrag löschen.",
  "In tools/gate-tests.json, tools/ziele/geschuetzt.json, tools/auftrag/musterdateien.json, .github/CODEOWNERS, .claude/rollen/ und .claude/settings.json nie selbst löschen: Eine Schutzliste zu kürzen ist eine Lockerung und braucht Antonios Freigabe.",
].join("\n");
const NOT_DECLARED = "ist dort nicht deklariert";
const DECLARATION = /^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;
const EXPORTED_NAME = /(?:[\w$]+\s+as\s+)?([\w$]+)/g;

function missing(where, entry) {
  return `${where}: ${entry} trifft keine versionierte Datei`;
}

function readJson(state, path) {
  return JSON.parse(readFileSync(join(state.root, path), "utf8"));
}

function fileOrFolderFindings(state, where, paths) {
  return paths.filter((path) => !pathExists(state.files, path)).map((path) => missing(where, path));
}

function fileOnlyFindings(state, where, paths) {
  return paths.filter((path) => !state.files.includes(path)).map((path) => missing(where, path));
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

function stringsIn(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
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
  if (!state.files.includes(path)) return [missing(where, entry)];
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
  const edited = EDITING.exec(rule)?.[1];
  if (edited !== undefined)
    return OUTSIDE_REPOSITORY.test(edited) ? [] : [edited.replace(CURRENT_FOLDER, "")];
  const read = READING.exec(rule)?.[1]?.replace(CURRENT_FOLDER, "");
  return read !== undefined && isRepositoryPath(state, read) ? [read] : [];
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
  const roles = state.files.filter((path) => path.startsWith(folder) && path.endsWith(JSON_ENDING));
  return roles.flatMap((role) => settingsFindings(state, role));
}

function optionFindings(state, where, rules = {}) {
  const paths = stringsIn(rules).filter((text) => isRepositoryPath(state, text));
  return paths.flatMap((path) => pathOrGlobFindings(state, where, path));
}

async function eslintFindings(state, file) {
  const { default: blocks } = await import(pathToFileURL(resolve(state.root, file)).href);
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
  const { forbidden = [], required = [] } = createRequire(import.meta.url)(
    resolve(state.root, file),
  );
  return [
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
    ...fileOnlyFindings(state, `${manifest} probe.mitnehmen`, probe.mitnehmen ?? []),
  ];
}

function redProbeFindings(state, folder) {
  const manifests = readdirSync(join(state.root, folder)).map(
    (id) => `${folder}${id}${SEPARATOR}${MANIFEST}`,
  );
  return manifests
    .filter((manifest) => state.files.includes(manifest))
    .flatMap((manifest) => manifestFindings(state, manifest));
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
];

function findingsOf(state, { path, check }) {
  if (!pathExists(state.files, path))
    return [
      `${path} fehlt; die Prüfung fester Pfade liest diese Liste fest und überspringt sie nicht.`,
    ];
  return check(state, path);
}

const files = git(["ls-files", "-z"]).split(NUL).filter(Boolean);
const state = { root: ".", files, top: new Set(files.map((path) => path.split(SEPARATOR)[0])) };
const findings = (await Promise.all(SOURCES.map((source) => findingsOf(state, source)))).flat();
for (const finding of findings) console.error(finding);
if (findings.length > 0) {
  console.log(HINT);
  process.exitCode = 1;
}
