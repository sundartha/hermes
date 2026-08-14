// Attrappen-Bau fuer die drei Suiten um scripts/check-elevenlabs-tests.js.
//
// Der produktive Ablageort ist elevenlabs/test_configs/ PLUS die Registry
// elevenlabs/tests.json (Beleg: elevenlabs/tests/README.md, Abschnitt "Ablage:
// test_configs/ + tests.json"). Beides gehoert zusammen: die CLI laedt nicht,
// was im Ordner liegt, sondern was in der Registry steht - sie oeffnet den
// config-Pfad einer Registry-Zeile unveraendert, also relativ zum
// Arbeitsverzeichnis elevenlabs/ (pushTests, "const configPath =
// testDef.config"). Deshalb legt writeRegisteredDefinition beides zugleich an;
// wer eine Definition OHNE Registry-Zeile braucht, sagt das mit writeJson
// ausdruecklich, statt es zu vergessen.
//
// Jede Attrappe liegt in einem eigenen Temp-Verzeichnis (mkdtemp-Muster) -
// keine Suite fasst die echten Dateien unter elevenlabs/ an, weder lesend als
// Erwartungswert noch schreibend. Offline, kein Netz, keine Abhaengigkeit.
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
// Ordnername, den die ElevenLabs-CLI erwartet (Baumdiagramm in README.md).
export const TEST_CONFIGS_DIR_NAME = "test_configs";
export const TEST_CONFIGS_DIR_REL = `${PROJECT_ROOT_REL}/${TEST_CONFIGS_DIR_NAME}`;
// Der Ort, an dem die Definitionen frueher lagen. Kein gueltiger Ablageort
// mehr - hier stehen nur noch README.md und templates/.
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

// In afterEach aufrufen: raeumt jede von makeRoot erzeugte Attrappe weg.
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

// Schreibt die Registry mit genau diesen Zeilen - auch mit Zusatzfeldern, die
// die CLI selbst zurueckschreibt (id, type).
export function writeRegistry(root, entries) {
  writeJson(root, REGISTRY_REL, { [REGISTRY_KEY]: entries });
}

// Haengt eine Registry-Zeile an, ohne eine Datei anzulegen. Der Pfad ist
// relativ zu elevenlabs/, so wie die CLI ihn oeffnet.
export function registerConfigPath(root, configPath) {
  writeRegistry(root, [...registryEntries(root), { config: configPath }]);
}

// Legt eine Testdefinition am produktiven Ort ab UND traegt sie in die
// Registry ein - der Normalfall, aus dem die CLI hochlaedt.
export function writeRegisteredDefinition(root, fileName, value) {
  writeJson(root, `${TEST_CONFIGS_DIR_REL}/${fileName}`, value);
  registerConfigPath(root, `${TEST_CONFIGS_DIR_NAME}/${fileName}`);
}

// Attrappe der Agentenkonfiguration: referenziert die uebergebenen Namen als
// {{name}} in prompt/first_message - genau die Form, aus der das Gate die
// Konfigurationsseite des Vokabulars liest.
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
