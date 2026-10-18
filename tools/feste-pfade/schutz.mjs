import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { imBereich } from "../auftrag/format.mjs";
import { matches } from "../pruefungen-messen.mjs";
import {
  ALLOWED_UNCHECKED,
  codeownersEntries,
  exportedValue,
  manifestFiles,
  moduleOf,
  permissionTarget,
  readJson,
  roleFiles,
  stringsIn,
} from "./lesen.mjs";
import { gitignoreMatches, globMatches, pathExists, regexHits } from "./muster.mjs";
import { lostRules, ruleSource } from "./regeln.mjs";
import { filterHits, filterProblem, workflowFilters } from "./workflows.mjs";

const GUARDING_KINDS = new Set(["deny", "ask"]);
const GRANTING_KIND = "allow";
const PATHS = "paths";
const RULE_KINDS = ["forbidden", "required"];
const SIDES = ["from", "to", "module"];
const BACK_REFERENCE = /\$\d/;
const PREFIX_END = "/";
const WORKFLOW_FILE = /\.ya?ml$/;
const IN_BASIS = "Basis-Stand: ";
const UNREADABLE = "lässt sich für den Vergleich umbenannter Dateien nicht lesen";
const NOT_COMPARABLE =
  "fehlt; ohne die Liste lässt sich der Schutz umbenannter Dateien nicht vergleichen.";

function guarding(labels) {
  return { guards: labels, grants: [] };
}

function sourceHits(sources, path) {
  return [sources ?? []].flat().some((source) => regexHits([path], source));
}

function ownerKeys(entries, path, file) {
  const owning = entries.findLast(({ pattern }) => gitignoreMatches(pattern, path));
  return guarding((owning?.owners ?? []).map((owner) => `${file} Besitzer ${owner}`));
}

function hitTools(rules, path) {
  const targets = stringsIn(rules)
    .map(permissionTarget)
    .filter((target) => target !== undefined && gitignoreMatches(target.pattern, path));
  return [...new Set(targets.map(({ tool }) => tool))];
}

function permissionKeys(roles, path) {
  const hits = roles.flatMap(({ file, permissions = {} }) =>
    Object.entries(permissions).flatMap(([kind, rules]) =>
      hitTools(rules, path).map((tool) => ({ kind, label: `${file} ${kind} ${tool}` })),
    ),
  );
  const labels = (keep) => hits.filter(({ kind }) => keep(kind)).map(({ label }) => label);
  return {
    guards: labels((kind) => GUARDING_KINDS.has(kind)),
    grants: labels((kind) => kind === GRANTING_KIND),
  };
}

function areaKeys(areas, path, file) {
  const labels = areas.flatMap((area) =>
    Object.entries(area)
      .filter(([, sources]) => Array.isArray(sources) && sourceHits(sources, path))
      .map(([key]) => `${file} ${area.bereich}.${key}`),
  );
  return { guards: labels, grants: labels };
}

function applies(side, path) {
  return (
    (side.path === undefined || sourceHits(side.path, path)) && !sourceHits(side.pathNot, path)
  );
}

function cruiserRules(config) {
  return RULE_KINDS.flatMap((kind) => config[kind] ?? []);
}

function cruiserKeys(config, path, file) {
  const guards = cruiserRules(config).flatMap((rule) =>
    SIDES.filter((side) => rule[side] !== undefined && applies(rule[side], path)).map(
      (side) => `${file} ${rule.name} ${side}`,
    ),
  );
  const { exclude, includeOnly } = config.options ?? {};
  const included = includeOnly === undefined || sourceHits(includeOnly.path ?? includeOnly, path);
  const excluded = exclude !== undefined && sourceHits(exclude.path ?? exclude, path);
  return {
    guards: included ? [...guards, `${file} options.includeOnly`] : guards,
    grants: excluded ? [`${file} options.exclude`] : [],
  };
}

function refersBack(side = {}) {
  return stringsIn([side.path, side.pathNot]).some((source) => BACK_REFERENCE.test(source));
}

function cruiserProblems(config, file) {
  const referring = cruiserRules(config).flatMap((rule) =>
    SIDES.filter((side) => refersBack(rule[side])).map(
      (side) =>
        `${file} ${rule.name} ${side}: ein Rückverweis ($1) lässt sich je Datei nicht prüfen`,
    ),
  );
  return config.allowed === undefined ? referring : [...referring, `${file} ${ALLOWED_UNCHECKED}`];
}

function listHits(entry, path) {
  return entry === path || (entry.endsWith(PREFIX_END) && path.startsWith(entry));
}

function protectedKeys(groups, path, file) {
  const hit = Object.entries(groups).filter(([, entries]) =>
    [entries].flat().some((entry) => listHits(entry, path)),
  );
  return guarding(hit.map(([group]) => `${file} ${group}`));
}

function exampleKeys(examples, path, file) {
  const lists = Object.entries(examples).filter(([, entries]) => Array.isArray(entries));
  return guarding(
    lists.flatMap(([kind, entries]) =>
      entries
        .filter(({ praefix, datei }) => path.startsWith(praefix) || path === datei)
        .map(({ art }) => `${file} ${kind} ${art}`),
    ),
  );
}

function manifestKeys(manifests, path) {
  const hit = manifests.filter(({ pfade }) => pfade.some((pattern) => matches(pattern, path)));
  return guarding(hit.map(({ manifest }) => `${manifest} pfade`));
}

function prefixListKeys(name, hits) {
  return (entries, path, file) =>
    guarding(entries.some((entry) => hits(entry, path)) ? [`${file} ${name}`] : []);
}

function workflowKeys(workflows, path) {
  const hits = workflows.flatMap(({ workflow, filters }) =>
    filters
      .filter((filter) => !filter.unreadable && filterHits(filter, path, globMatches))
      .map(({ event, key }) => ({ key, label: `${workflow} on.${event}.${key}` })),
  );
  const labels = (keep) => hits.filter(({ key }) => keep(key)).map(({ label }) => label);
  return { guards: labels((key) => key === PATHS), grants: labels((key) => key !== PATHS) };
}

function loadJson(state, file) {
  return { data: readJson(state, file) };
}

function loadRoles(state, folder) {
  const files = roleFiles(state, folder);
  return { data: files.map((file) => ({ file, permissions: readJson(state, file).permissions })) };
}

function loadSettings(state, file) {
  return { data: [{ file, permissions: readJson(state, file).permissions }] };
}

function loadCodeowners(state, file) {
  return { data: codeownersEntries(state, file) };
}

function loadCruiser(state, file) {
  const config = createRequire(import.meta.url)(resolve(state.root, file));
  return { data: config, problems: cruiserProblems(config, file) };
}

function loadManifests(state, folder) {
  const manifests = manifestFiles(state, folder);
  return {
    data: manifests.map((manifest) => ({ manifest, pfade: readJson(state, manifest).pfade ?? [] })),
  };
}

function loadExported(name) {
  return async (state, file) => {
    const { finding, value } = exportedValue(await moduleOf(state, file), file, name);
    return finding === undefined ? { data: [value].flat() } : { data: [], problems: [finding] };
  };
}

function loadWorkflows(state, folder) {
  const files = state.files.filter((path) => path.startsWith(folder) && WORKFLOW_FILE.test(path));
  const workflows = files.map((workflow) => ({
    workflow,
    filters: workflowFilters(readFileSync(join(state.root, workflow), "utf8")),
  }));
  const problems = workflows.flatMap(({ workflow, filters }) =>
    filters
      .filter(({ unreadable }) => unreadable)
      .map((filter) => `${workflow}: ${filterProblem(filter)}`),
  );
  return { data: workflows, problems };
}

function loadRules(state) {
  return { data: ruleSource(state) };
}

function byKeys(keys) {
  return ({ before, after, path }, { alt, neu }) => {
    const [old, current] = [keys(before.data, alt, path), keys(after.data, neu, path)];
    return [
      ...old.guards
        .filter((label) => !current.guards.includes(label))
        .map((label) => `${alt} → ${neu}: ${label} trifft ${alt}, aber nicht ${neu}`),
      ...current.grants
        .filter((label) => !old.grants.includes(label))
        .map((label) => `${alt} → ${neu}: ${label} trifft ${neu}, aber nicht ${alt}`),
    ];
  };
}

async function byRules(sides, pair) {
  const lost = await lostRules(sides, pair);
  return lost.map(
    (rule) =>
      `${pair.alt} → ${pair.neu}: ${sides.path} ${rule} gilt für ${pair.alt}, für ${pair.neu} nicht mit mindestens derselben Stufe und denselben Optionen`,
  );
}

const SOURCES = [
  { path: "eslint.config.js", load: loadRules, compare: byRules },
  { path: ".github/CODEOWNERS", load: loadCodeowners, compare: byKeys(ownerKeys) },
  { path: ".claude/rollen/", load: loadRoles, compare: byKeys(permissionKeys) },
  { path: ".claude/settings.json", load: loadSettings, compare: byKeys(permissionKeys) },
  { path: "tools/bereiche.json", load: loadJson, compare: byKeys(areaKeys) },
  { path: ".dependency-cruiser.cjs", load: loadCruiser, compare: byKeys(cruiserKeys) },
  { path: "tools/ziele/geschuetzt.json", load: loadJson, compare: byKeys(protectedKeys) },
  { path: "tools/auftrag/musterdateien.json", load: loadJson, compare: byKeys(exampleKeys) },
  { path: "test/werkzeuge/rotproben/", load: loadManifests, compare: byKeys(manifestKeys) },
  {
    path: "tools/auftrag/agenten.mjs",
    load: loadExported("KRITISCH_OHNE_GATE_TEST"),
    compare: byKeys(
      prefixListKeys("KRITISCH_OHNE_GATE_TEST", (entry, path) => path.startsWith(entry)),
    ),
  },
  {
    path: "tools/auftrag/bereiche.mjs",
    load: loadExported("GEMEINSAME_ORDNER"),
    compare: byKeys(prefixListKeys("GEMEINSAME_ORDNER", imBereich)),
  },
  { path: ".github/workflows/", load: loadWorkflows, compare: byKeys(workflowKeys) },
];

function firstLine(error) {
  return String(error.message).split("\n")[0];
}

async function loaded(state, { path, load }) {
  if (!pathExists(state.files, path)) return { path, problems: [`${path} ${NOT_COMPARABLE}`] };
  try {
    const { data, problems = [] } = await load(state, path);
    return { path, root: state.root, data, problems };
  } catch (error) {
    return { path, problems: [`${path} ${UNREADABLE}: ${firstLine(error)}`] };
  }
}

async function readableFindings(source, states, pairs) {
  try {
    return await sourceFindings(source, states, pairs);
  } catch (error) {
    return [`${source.path} ${UNREADABLE}: ${firstLine(error)}`];
  }
}

async function sourceFindings(source, { before, after }, pairs) {
  const sides = await Promise.all([loaded(before, source), loaded(after, source)]);
  const problems = [
    ...sides[0].problems.map((problem) => `${IN_BASIS}${problem}`),
    ...sides[1].problems,
  ];
  if (problems.length > 0) return problems;
  const found = await Promise.all(
    pairs.map((pair) =>
      source.compare({ before: sides[0], after: sides[1], path: source.path, pairs }, pair),
    ),
  );
  return found.flat();
}

export async function protectionFindings(pairs, states) {
  const found = await Promise.all(SOURCES.map((source) => readableFindings(source, states, pairs)));
  return found.flat();
}
