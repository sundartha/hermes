import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT_REL = "elevenlabs";
export const TEST_CONFIGS_DIR_NAME = "test_configs";
export const TEST_CONFIGS_DIR_REL = `${PROJECT_ROOT_REL}/${TEST_CONFIGS_DIR_NAME}`;
export const LEGACY_DIR_NAME = "tests";
export const LEGACY_DIR_REL = `${PROJECT_ROOT_REL}/${LEGACY_DIR_NAME}`;
export const TEMPLATES_DIR_NAME = "templates";
const REGISTRY_REL = `${PROJECT_ROOT_REL}/tests.json`;
const AGENT_CONFIG_REL = `${PROJECT_ROOT_REL}/agent_configs/outbound-agent.template.json`;
const REGISTRY_KEY = "tests";
const JSON_INDENT = 2;

const createdRoots = [];

export function makeRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

export function removeRoots() {
  for (const dir of createdRoots) rmSync(dir, { recursive: true, force: true });
  createdRoots.length = 0;
}

export function writeJson(root, rel, value) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, JSON_INDENT));
}

function registryEntries(root) {
  const abs = join(root, REGISTRY_REL);
  if (!existsSync(abs)) return [];
  return JSON.parse(readFileSync(abs, "utf8"))[REGISTRY_KEY];
}

export function writeRegistry(root, entries) {
  writeJson(root, REGISTRY_REL, { [REGISTRY_KEY]: entries });
}

export function registerConfigPath(root, configPath) {
  writeRegistry(root, [...registryEntries(root), { config: configPath }]);
}

export function writeRegisteredDefinition(root, fileName, value) {
  writeJson(root, `${TEST_CONFIGS_DIR_REL}/${fileName}`, value);
  registerConfigPath(root, `${TEST_CONFIGS_DIR_NAME}/${fileName}`);
}

export function writeAgentConfig(root, names) {
  const text = names.map((name) => `{{${name}}}`).join(" ");
  writeJson(root, AGENT_CONFIG_REL, {
    conversation_config: {
      agent: { prompt: { prompt: text }, first_message: text },
    },
  });
}

export function hasFinding(findings, ...needles) {
  return findings.some((finding) =>
    needles.every((needle) => finding.includes(needle)),
  );
}

export function joined(findings) {
  return findings.length === 0 ? "(keine)" : findings.join(" | ");
}
