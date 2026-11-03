import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { FREIGABE_GRUENDE, grund, zweckZeilen } from "./freigabe-gruende.mjs";
import { rotprobenDerGeaendertenPruefungen } from "./freigabe-rotproben.mjs";
import { fileAt, git, matches } from "./pruefungen-messen.mjs";
import { approvedAtHead, getJson, repositoryName, rest } from "./testschutz/github.mjs";
import { vorhandenerPfad } from "./zwillingspfad.mjs";
import {
  gleicheAenderungGegenBasis,
  holeKopf,
  prNummerAus,
} from "./warteschlange/gleicher-stand.mjs";

const APPROVERS = ["Antonio20045", "jonas986"];
const KINDS = ["pruefung", "werkzeugtexte", "gespraech", "code"];
const LABEL_PREFIX = "art:";
const CODEOWNERS_FILE = ".github/CODEOWNERS";
const WERKZEUGTEXTE_FILE = "test/werkzeuge/werkzeugtexte.json";
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
const NAME_STATUS_FIELDS = 2;
const MS_PER_DAY = 86_400_000;
const REVIEWS_PER_PAGE = 100;
const SHORT_SHA = 7;
const EXIT_FAILURE = 1;
const NUMBER_FORMAT = new Intl.NumberFormat("de-DE");
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

function packageLine({ name, version, alterTage, downloads, lizenz, meldungen, fehler }) {
  const title = `Neues Paket ${name} ${version}`;
  if (fehler !== undefined) return `${title}: Angaben nicht abrufbar (${fehler}).`;
  const advisories = meldungen.length === 0 ? "keine" : meldungen.join("; ");
  const age = `veröffentlicht vor ${NUMBER_FORMAT.format(alterTage)} Tagen`;
  const usage = `${NUMBER_FORMAT.format(downloads)} Downloads in der letzten Woche`;
  return `${title}: ${age}, ${usage}, Lizenz ${lizenz}, bekannte Sicherheitsmeldungen: ${advisories}.`;
}

function listed(zweck, prefix, items) {
  return items.length === 0 ? [] : [grund(zweck, `${prefix}: ${items.join(", ")}.`)];
}

function approvalReasons({ changes, packages }) {
  const modified = changes.filter(({ status }) => status !== STATUS_ADDED);
  const ofKind = (wanted) => modified.filter(({ kind }) => kind === wanted).map(({ path }) => path);
  return [
    ...listed(
      FREIGABE_GRUENDE.PRUEFUNGSDATEIEN,
      "Bestehende Prüfungsdateien geändert oder gelöscht",
      ofKind("pruefung"),
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
    ...listed(FREIGABE_GRUENDE.WERKZEUGTEXTE, "Werkzeugtexte aus tools/list geändert", ofKind("werkzeugtexte")),
  ];
}

async function approvals(pullRequest, headSha) {
  const { full } = repositoryName();
  const reviews = await getJson(
    `/repos/${full}/pulls/${pullRequest}/reviews?per_page=${REVIEWS_PER_PAGE}`,
  );
  return approvedAtHead(reviews, APPROVERS, headSha);
}

async function setKindLabel(pull, kind) {
  const { full } = repositoryName();
  const wanted = `${LABEL_PREFIX}${kind}`;
  const current = pull.labels
    .map(({ name }) => name)
    .filter((name) => name.startsWith(LABEL_PREFIX));
  for (const name of current.filter((label) => label !== wanted)) {
    await rest("DELETE", `/repos/${full}/issues/${pull.number}/labels/${encodeURIComponent(name)}`);
  }
  if (!current.includes(wanted)) {
    await rest("POST", `/repos/${full}/issues/${pull.number}/labels`, { labels: [wanted] });
  }
}

function classify(basis) {
  const patterns = ownerPatterns(basis);
  const changes = changedFiles(basis).map((change) => ({ ...change, kind: kindOf(patterns, change.path) }));
  const packages = packageChanges(basis);
  const kinds = new Set(changes.map(({ kind }) => kind));
  const packageReview = [packages.added, packages.removed, packages.scripts, packages.fields];
  if (packageReview.some((items) => items.length > 0)) kinds.add("pruefung");
  return { changes, packages, kind: KINDS.find((kind) => kinds.has(kind)) ?? "code" };
}

async function evaluate({ basis, sources }) {
  const { changes, packages, kind } = classify(basis);
  const pakete = await Promise.all(
    packages.added.map((name) => packageFacts(name, lockedVersion(packages.lock, name), sources)),
  );
  const blocks = await rotprobenDerGeaendertenPruefungen(basis, changes.map(({ path }) => path));
  return { kind, pakete, blocks, needs: approvalReasons({ changes, packages }) };
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
  if (needs.length === 0) return { approvedBy: [], notes: [] };
  const reviews = await approvals(options.pullRequest, headSha);
  const approvedBy = reviews.map(({ user }) => user.login);
  if (!options.queueMode || approvedBy.length === 0 || sameChangeInQueue(options, headSha)) {
    return { approvedBy, notes: [] };
  }
  return {
    approvedBy: [],
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
  const { approvedBy, notes } = await countedApprovers(options, result, headSha);
  const waiting = result.needs.length > 0 && approvedBy.length === 0;
  const gruende = [
    ...statusLines({ ...result, approvedBy, headSha }),
    ...notes.map(({ text }) => text),
  ];
  const zweck = zweckZeilen([...result.blocks, ...(waiting ? [...result.needs, ...notes] : [])]);
  if (!options.queueMode) await setKindLabel(pull, result.kind);
  console.log(`Freigabe-Prüfung: Art art:${result.kind}.`);
  for (const line of [...result.pakete.map(packageLine), ...gruende, ...zweck]) console.log(line);
  if (result.blocks.length > 0 || waiting) process.exitCode = EXIT_FAILURE;
  else console.log("Keine offene Freigabe.");
}

try {
  await main();
} catch (error) {
  console.error(`Freigabe-Prüfung: Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
