import { basename } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";

import {
  WERKZEUGTEXTE_FILE,
  sendToGitHub,
  textChanges,
  writeSummary,
} from "./pr-zusammenfassung.mjs";
import { STRENGER, stricterCases } from "./freigabe-strenger.mjs";
import { LOCKERER, fileAt, git, matches, measureChecks } from "./pruefungen-messen.mjs";
import { changedExistingTestFiles, changedUnits } from "./testschutz/aenderungen.mjs";
import { getJson, repositoryName } from "./testschutz/github.mjs";

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
const CONVERSATION_PATTERNS = [
  "elevenlabs/",
  "src/i18n/prompts/",
  "src/conversation/elevenlabs-agent-config.js",
];
const STATUS_ADDED = "A";
const NAME_STATUS_FIELDS = 2;
const MIN_AGE_DAYS = 7;
const MS_PER_DAY = 86_400_000;
const REVIEWS_PER_PAGE = 100;
const SHORT_SHA = 7;
const EXIT_FAILURE = 1;
const USAGE =
  "Aufruf: node tools/freigabe-pruefung.mjs --basis <sha> --pr <nr> [--registry <url>] [--downloads <url>]";

function parseOptions() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string" },
      pr: { type: "string" },
      registry: { type: "string", default: "https://registry.npmjs.org" },
      downloads: { type: "string", default: "https://api.npmjs.org" },
    },
  });
  if (values.basis === undefined || values.pr === undefined) throw new Error(USAGE);
  const sources = { registry: values.registry, downloads: values.downloads };
  return { basis: values.basis, pullRequest: Number(values.pr), sources };
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
          `${name} ${version} ist erst ${ageDays} Tage veröffentlicht, verlangt sind ${MIN_AGE_DAYS}.`,
        );
      }
    } catch (error) {
      reasons.push(
        `Das Alter von ${name} ${version ?? "?"} ist nicht ermittelbar: ${error.message}.`,
      );
    }
  }
  return reasons;
}

function listed(prefix, items) {
  return items.length === 0 ? [] : [`${prefix}: ${items.join(", ")}.`];
}

function approvalReasons({ changes, packages, texts, measured }) {
  const modified = changes.filter(
    ({ kind, status }) => kind === "pruefung" && status !== STATUS_ADDED,
  );
  const looser = measured.pruefungen.filter(({ urteil }) => urteil === LOCKERER);
  return [
    ...listed(
      "Bestehende Prüfungsdateien geändert oder gelöscht",
      modified.map(({ path }) => path),
    ),
    ...listed(
      "Prüfungen werden lockerer",
      looser.map(({ titel }) => titel),
    ),
    ...listed("Neue npm-Pakete", packages.added),
    ...listed("Entfernte npm-Pakete", packages.removed),
    ...listed("Geänderte Skript-Einträge in package.json", packages.scripts),
    ...listed("Geänderte weitere Felder in package.json", packages.fields),
    ...(texts.aenderungen.length > 0
      ? ["Werkzeugtexte aus tools/list geändert (Vorher und Nachher unten)."]
      : []),
  ];
}

function blockReasons(measured) {
  return measured.pruefungen
    .filter(({ urteil, fehlalarmBelegt }) => urteil === LOCKERER && !fehlalarmBelegt)
    .map(
      ({ titel, id }) =>
        `Die Prüfung „${titel}“ wird lockerer, aber der PR bringt kein Fehlalarm-Beispiel unter test/werkzeuge/fehlalarme/${id}/ mit, das master meldet und dieser PR nicht mehr.`,
    );
}

async function approvers(pullRequest, headSha) {
  const { full } = repositoryName();
  const reviews = await getJson(
    `/repos/${full}/pulls/${pullRequest}/reviews?per_page=${REVIEWS_PER_PAGE}`,
  );
  const latest = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (APPROVERS.includes(login) && review.state !== "COMMENTED") latest.set(login, review);
  }
  return [...latest]
    .filter(([, review]) => review.state === "APPROVED" && review.commit_id === headSha)
    .map(([login]) => login);
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
  const changes = files.map((change) => ({
    ...change,
    kind: strenger.length > 0 ? STRENGER : kindOf(patterns, change.path),
  }));
  const packages = packageChanges(basis);
  const kinds = new Set(changes.map(({ kind }) => kind));
  if (existingTestsChanged(basis)) kinds.add("tests-geaendert");
  const packageReview = [packages.added, packages.removed, packages.scripts, packages.fields];
  if (packageReview.some((items) => items.length > 0)) kinds.add("pruefung");
  return { changes, packages, strenger, kind: KINDS.find((kind) => kinds.has(kind)) ?? "code" };
}

async function evaluate({ basis, sources }) {
  const { changes, packages, strenger, kind } = classify(basis);
  const checkFiles = changes.filter((change) => change.kind === "pruefung").map(({ path }) => path);
  const measured =
    checkFiles.length === 0
      ? { pruefungen: [], ohneMessung: [] }
      : await measureChecks(basis, { changedFiles: changes.map(({ path }) => path), checkFiles });
  const texts = textChanges(basis);
  const pakete = await Promise.all(
    packages.added.map((name) => packageFacts(name, lockedVersion(packages.lock, name), sources)),
  );
  const needs = [
    ...approvalReasons({ changes, packages, texts, measured }),
    ...(await youngVersions(packages, sources)),
  ];
  return { kind, strenger, measured, texts, pakete, needs, blocks: blockReasons(measured) };
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
    ...blocks.map((reason) => `Muss geändert werden: ${reason}`),
    ...needs.map((reason) => `Braucht Freigabe: ${reason}`),
    ...(needs.length > 0 ? approval : []),
  ];
}

async function main() {
  const options = parseOptions();
  const { full } = repositoryName();
  const pull = await getJson(`/repos/${full}/pulls/${options.pullRequest}`);
  const result = await evaluate(options);
  const headSha = pull.head.sha;
  const approvedBy = result.needs.length > 0 ? await approvers(options.pullRequest, headSha) : [];
  const gruende = statusLines({ ...result, approvedBy, headSha });
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
    strenger: result.strenger,
    ...result.measured,
    pakete: result.pakete,
    texte: result.texts,
  };
  await writeSummary(options.pullRequest, report, relevant);
  await setKindLabel(pull, result.kind);
  console.log(`Freigabe-Prüfung: Art art:${result.kind}.`);
  for (const { path, fall } of result.strenger) console.log(`Strenger: ${path}: ${fall}`);
  for (const line of gruende) console.log(line);
  const waiting = result.needs.length > 0 && approvedBy.length === 0;
  if (result.blocks.length > 0 || waiting) process.exitCode = EXIT_FAILURE;
  else console.log("Keine offene Freigabe.");
}

try {
  await main();
} catch (error) {
  console.error(`Freigabe-Prüfung: Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
