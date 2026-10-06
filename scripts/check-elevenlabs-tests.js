#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_DIR_REL = "elevenlabs";
const TEST_CONFIGS_DIR_NAME = "test_configs";
const LEGACY_DIR_NAME = "tests";
const TEST_CONFIGS_DIR_REL = `${PROJECT_DIR_REL}/${TEST_CONFIGS_DIR_NAME}`;
const LEGACY_DIR_REL = `${PROJECT_DIR_REL}/${LEGACY_DIR_NAME}`;
const REGISTRY_REL = `${PROJECT_DIR_REL}/tests.json`;
const REGISTRY_KEY = "tests";
const REGISTRY_CONFIG_KEY = "config";
const AGENT_CONFIG_REL = `${PROJECT_DIR_REL}/agent_configs/outbound-agent.template.json`;
const TEMPLATES_DIR_NAME = "templates";
const JSON_EXT = ".json";
const PLACEHOLDER_PATTERN = /<AUSFUELLEN:[^>]*>/g;
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const DYNAMIC_VARIABLES_KEY = "dynamic_variables";
const DOC_KEY_PREFIX = "_";
const PATH_ROOT = "$";
const PATH_SEPARATOR = "/";
const PARENT_DIR_SEGMENT = "..";
const CURRENT_DIR_SEGMENT = ".";
const LOG_PREFIX = "[check-elevenlabs-tests]";

function isDocKey(key) {
  return key.startsWith(DOC_KEY_PREFIX);
}

function listJsonFiles(absDir, rootDir, skipDirAbs) {
  const found = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (absPath === skipDirAbs) continue;
      found.push(...listJsonFiles(absPath, rootDir, skipDirAbs));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(JSON_EXT)) {
      found.push(relative(rootDir, absPath));
    }
  }
  return found;
}

function listDefinitionFiles(rootDir, dirRel) {
  const dirAbs = join(rootDir, dirRel);
  if (!existsSync(dirAbs)) return [];
  return listJsonFiles(dirAbs, rootDir, join(dirAbs, TEMPLATES_DIR_NAME));
}

function directoryEntryNames(dirAbs) {
  try {
    return readdirSync(dirAbs);
  } catch {
    return [];
  }
}

function existsCaseSensitive(baseAbs, relPath) {
  const segments = relPath
    .split(PATH_SEPARATOR)
    .filter((segment) => segment !== "" && segment !== CURRENT_DIR_SEGMENT);
  if (segments.length === 0) return false;
  let dirAbs = baseAbs;
  for (const segment of segments) {
    if (!directoryEntryNames(dirAbs).includes(segment)) return false;
    dirAbs = join(dirAbs, segment);
  }
  return true;
}

function walkForPlaceholders(value, path, findings) {
  if (typeof value === "string") {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
      findings.push({ path, marker: match[0] });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkForPlaceholders(item, `${path}[${index}]`, findings);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (isDocKey(key)) continue;
      walkForPlaceholders(child, `${path}.${key}`, findings);
    }
  }
}

function declaredVariableNames(value) {
  const isPlainObject =
    value !== null && typeof value === "object" && !Array.isArray(value);
  return isPlainObject ? Object.keys(value) : [];
}

function walkObjectForVariables(objectValue, acc) {
  for (const [key, child] of Object.entries(objectValue)) {
    if (isDocKey(key)) continue;
    if (key === DYNAMIC_VARIABLES_KEY) {
      for (const name of declaredVariableNames(child)) acc.declared.add(name);
    }
    walkForVariables(child, acc);
  }
}

function walkForVariables(value, acc) {
  if (typeof value === "string") {
    for (const match of value.matchAll(VARIABLE_PATTERN)) {
      acc.referenced.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkForVariables(item, acc);
    return;
  }
  if (value === null || typeof value !== "object") return;
  walkObjectForVariables(value, acc);
}

function collectVariables(parsed) {
  const acc = { referenced: new Set(), declared: new Set() };
  walkForVariables(parsed, acc);
  return acc;
}

function readJsonFile(rootDir, relFile) {
  try {
    return { parsed: JSON.parse(readFileSync(join(rootDir, relFile), "utf8")) };
  } catch (err) {
    return { error: `${relFile}: nicht als JSON lesbar (${err.message})` };
  }
}

function registryError(message) {
  return { paths: [], findings: [message] };
}

function unsafePathReason(configPath) {
  if (isAbsolute(configPath)) {
    return "absoluter Pfad";
  }
  if (configPath.split(PATH_SEPARATOR).includes(PARENT_DIR_SEGMENT)) {
    return `Ausbruch aus ${PROJECT_DIR_REL}/ (${PARENT_DIR_SEGMENT})`;
  }
  return null;
}

function toRepoRel(configPath) {
  return join(PROJECT_DIR_REL, configPath);
}

function inspectRegistryEntry(entry, index, seenPaths) {
  const configPath = entry?.[REGISTRY_CONFIG_KEY];
  if (typeof configPath !== "string" || configPath === "") {
    return {
      finding: `${REGISTRY_REL}: ${REGISTRY_KEY}[${index}] ohne "${REGISTRY_CONFIG_KEY}"-Pfad - diese Zeile kann die CLI nicht oeffnen`,
    };
  }
  const unsafeReason = unsafePathReason(configPath);
  if (unsafeReason) {
    return {
      finding: `${REGISTRY_REL}: ${configPath} - ${unsafeReason}; die CLI oeffnet den Pfad unveraendert relativ zu ${PROJECT_DIR_REL}/ und findet die Datei nicht`,
    };
  }
  if (seenPaths.has(toRepoRel(configPath))) {
    return {
      finding: `${REGISTRY_REL}: ${configPath} - schon in einer frueheren ${REGISTRY_KEY}-Zeile; der Push legt diese Testdefinition doppelt in ElevenLabs an`,
    };
  }
  return { path: configPath };
}

function registryConfigPaths(entries) {
  const paths = [];
  const findings = [];
  const seenPaths = new Set();
  entries.forEach((entry, index) => {
    const { path, finding } = inspectRegistryEntry(entry, index, seenPaths);
    if (finding) findings.push(finding);
    if (path === undefined) return;
    seenPaths.add(toRepoRel(path));
    paths.push(path);
  });
  return { paths, findings };
}

function readRegistry(rootDir) {
  if (!existsSync(join(rootDir, REGISTRY_REL))) {
    return registryError(
      `Datei fehlt (fail-closed): ${REGISTRY_REL} - ohne Registry laedt die CLI keine einzige Testdefinition hoch`,
    );
  }
  const { parsed, error } = readJsonFile(rootDir, REGISTRY_REL);
  if (error) return registryError(error);

  const entries = parsed?.[REGISTRY_KEY];
  if (!Array.isArray(entries)) {
    return registryError(
      `${REGISTRY_REL}: kein Feld "${REGISTRY_KEY}" mit einer Liste von Registry-Zeilen (fail-closed)`,
    );
  }
  return registryConfigPaths(entries);
}

function missingFileReason(rootDir, configPath) {
  if (existsSync(join(rootDir, PROJECT_DIR_REL, configPath))) {
    return "Registry-Zeile mit abweichender Gross-/Kleinschreibung; die Datei gibt es nur anders geschrieben, auf einem case-sensitiven Dateisystem (Linux-CI) bricht der Push hier ab";
  }
  return "Registry-Zeile ohne Datei; der Push bricht am fehlenden Pfad ab";
}

function missingFileFindings(rootDir, registryPaths) {
  const projectAbs = join(rootDir, PROJECT_DIR_REL);
  return registryPaths
    .filter((configPath) => !existsCaseSensitive(projectAbs, configPath))
    .map(
      (configPath) =>
        `${REGISTRY_REL}: ${configPath} - ${missingFileReason(rootDir, configPath)}`,
    );
}

function registryFilesToInspect(rootDir, registryPaths) {
  const projectAbs = join(rootDir, PROJECT_DIR_REL);
  return registryPaths
    .filter((configPath) => existsCaseSensitive(projectAbs, configPath))
    .map(toRepoRel);
}

function unregisteredFindings(definitionFiles, registryPaths) {
  const registered = new Set(registryPaths.map(toRepoRel));
  return definitionFiles
    .filter((relFile) => !registered.has(relFile))
    .map(
      (relFile) =>
        `${relFile}: keine Zeile in ${REGISTRY_REL} - diese Testdefinition wird nie hochgeladen`,
    );
}

function legacyLocationFindings(legacyFiles) {
  return legacyFiles.map(
    (relFile) =>
      `${relFile}: liegt unter ${LEGACY_DIR_REL}/ - kein Ablageort mehr; nach ${TEST_CONFIGS_DIR_REL}/ verschieben und die Zeile in ${REGISTRY_REL} nachziehen`,
  );
}

function emptyLocationFindings(definitionFiles) {
  if (definitionFiles.length > 0) return [];
  return [
    `Keine Testdefinition unter ${TEST_CONFIGS_DIR_REL}/ (fail-closed) - es wuerde nichts hochgeladen`,
  ];
}

function placeholderFindings(relFile, parsed) {
  const placeholders = [];
  walkForPlaceholders(parsed, PATH_ROOT, placeholders);
  return placeholders.map(
    ({ path, marker }) =>
      `${relFile}: ${path} - Platzhalter gefunden (${marker})`,
  );
}

function inspectDefinitions(rootDir, relFiles) {
  const findings = [];
  const vocabularyByFile = new Map();
  for (const relFile of relFiles) {
    const { parsed, error } = readJsonFile(rootDir, relFile);
    if (error) {
      findings.push(error);
      continue;
    }
    findings.push(...placeholderFindings(relFile, parsed));
    vocabularyByFile.set(relFile, collectVariables(parsed));
  }
  return { findings, vocabularyByFile };
}

function anyVariableUsed(vocabularyByFile) {
  for (const { declared, referenced } of vocabularyByFile.values()) {
    if (declared.size > 0 || referenced.size > 0) return true;
  }
  return false;
}

function uncoveredVariableFindings(configVariables, vocabularyByFile) {
  const findings = [];
  for (const [relFile, { declared }] of vocabularyByFile) {
    for (const name of configVariables) {
      if (declared.has(name) || name.startsWith("system__")) continue;
      findings.push(
        `${relFile}: {{${name}}} - Variable der Agentenkonfiguration, die diese Testdefinition nicht setzt (${DYNAMIC_VARIABLES_KEY}); dieser Testlauf rendert sie leer`,
      );
    }
  }
  return findings;
}

function unknownVariableFindings(configVariables, vocabularyByFile) {
  const findings = [];
  for (const [relFile, { declared, referenced }] of vocabularyByFile) {
    for (const name of new Set([...declared, ...referenced])) {
      if (configVariables.has(name)) continue;
      findings.push(
        `${relFile}: {{${name}}} - Variable der Testdefinition, die die Agentenkonfiguration nicht kennt (${AGENT_CONFIG_REL})`,
      );
    }
  }
  return findings;
}

function checkVariableVocabulary(rootDir, vocabularyByFile) {
  if (!existsSync(join(rootDir, AGENT_CONFIG_REL))) {
    if (!anyVariableUsed(vocabularyByFile)) return [];
    return [
      `Datei fehlt (fail-closed): ${AGENT_CONFIG_REL} - Vokabular-Abgleich nicht moeglich`,
    ];
  }
  const { parsed, error } = readJsonFile(rootDir, AGENT_CONFIG_REL);
  if (error) return [error];

  const configVariables = collectVariables(parsed).referenced;
  return [
    ...uncoveredVariableFindings(configVariables, vocabularyByFile),
    ...unknownVariableFindings(configVariables, vocabularyByFile),
  ];
}

export function checkElevenlabsTests({ rootDir = REPO_ROOT } = {}) {
  const definitionFiles = listDefinitionFiles(rootDir, TEST_CONFIGS_DIR_REL);
  const legacyFiles = listDefinitionFiles(rootDir, LEGACY_DIR_REL);
  const registry = readRegistry(rootDir);
  const filesToInspect = new Set([
    ...definitionFiles,
    ...legacyFiles,
    ...registryFilesToInspect(rootDir, registry.paths),
  ]);
  const { findings: contentFindings, vocabularyByFile } = inspectDefinitions(
    rootDir,
    filesToInspect,
  );

  const findings = [
    ...emptyLocationFindings(definitionFiles),
    ...legacyLocationFindings(legacyFiles),
    ...registry.findings,
    ...missingFileFindings(rootDir, registry.paths),
    ...unregisteredFindings(definitionFiles, registry.paths),
    ...contentFindings,
    ...checkVariableVocabulary(rootDir, vocabularyByFile),
  ];

  return { ok: findings.length === 0, findings };
}

function runCli() {
  const { ok, findings } = checkElevenlabsTests({});
  if (ok) {
    console.log(
      `${LOG_PREFIX} OK - jede Testdefinition in ${TEST_CONFIGS_DIR_REL}/ (ausser ${TEMPLATES_DIR_NAME}/) steht in ${REGISTRY_REL} und umgekehrt, keine Platzhalter, ${LEGACY_DIR_REL}/ ohne Definition, Vokabular deckt sich mit ${AGENT_CONFIG_REL}.`,
    );
    return 0;
  }
  for (const finding of findings) console.error(`${LOG_PREFIX} ${finding}`);
  return 1;
}

const isMain =
  fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  try {
    process.exit(runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}
