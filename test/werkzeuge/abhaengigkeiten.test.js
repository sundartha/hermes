import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEPENDENCY_TOOL, REPO_ROOT, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const CONFIG_PATH = ".dependency-cruiser.cjs";
const KNOWN_VIOLATIONS_PATH = ".dependency-cruiser-known-violations.json";
const ROUTE = "src/routes/voice.js";
const ADAPTER = "src/telephony/adapters/telnyx/voice.js";
const STORE_INTERNAL = "src/store/defaults.js";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const UNKNOWN_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const ROUTE_THROUGH_PORTS = [
  'import { adapter } from "../telephony/registry.js";',
  'import { defaults } from "../store.js";',
  "export const route = [adapter, defaults];",
  "",
].join("\n");
const ROUTE_TO_ADAPTER =
  'import { voice } from "../telephony/adapters/telnyx/voice.js";\nexport const route = voice;\n';
const ROUTE_TO_STORE_INTERNAL =
  'import { defaults } from "../store/defaults.js";\nexport const route = defaults;\n';
const FOLDER_CYCLE = {
  "src/a/a.js": 'import { b } from "../b/b.js";\nexport const a = () => b;\n',
  "src/b/b.js": 'import { a } from "../a/a.js";\nexport const b = () => a;\n',
};

const CLEAN_TREE = {
  [CONFIG_PATH]: readFileSync(join(REPO_ROOT, CONFIG_PATH), "utf8"),
  "src/telephony/ports.js": "export const port = 1;\n",
  [ADAPTER]: "export const voice = 1;\n",
  "src/telephony/registry.js":
    'import { voice } from "./adapters/telnyx/voice.js";\nexport const adapter = voice;\n',
  [STORE_INTERNAL]: "export const defaults = {};\n",
  "src/store.js": 'export { defaults } from "./store/defaults.js";\n',
  [ROUTE]: ROUTE_THROUGH_PORTS,
};

function frozen(rule, from, to) {
  return { type: "dependency", from, to, rule: { severity: "error", name: rule } };
}

const FROZEN_PORT_BYPASS = frozen("telefonie-nur-ueber-ports", ROUTE, ADAPTER);
const FROZEN_FOLDER_CYCLE = [
  frozen("keine-ordnerzyklen", "src/a", "src/b"),
  frozen("keine-ordnerzyklen", "src/b", "src/a"),
];

function knownList(entries) {
  return { [KNOWN_VIOLATIONS_PATH]: JSON.stringify(entries) };
}

function repositoryWith(context, files) {
  return probeRepository(context, { ...CLEAN_TREE, ...knownList([]), ...files });
}

function checkDependencies(directory, basis = "HEAD") {
  return runIn(directory, process.execPath, [DEPENDENCY_TOOL, "--basis", basis]);
}

test("ohne neuen falschen Import ist die Prüfung grün", (context) => {
  const result = checkDependencies(repositoryWith(context, {}));
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("ein neuer Import aus src/telephony/adapters/ in src/routes/ ist rot und nennt den Port", (context) => {
  const directory = repositoryWith(context, {});
  writeFiles(directory, { [ROUTE]: ROUTE_TO_ADAPTER });

  const result = checkDependencies(directory);
  assert.equal(result.status, EXIT_FINDING);
  assert.match(
    result.stderr,
    /src\/routes\/voice\.js → src\/telephony\/adapters\/telnyx\/voice\.js/,
  );
  assert.match(result.stderr, /src\/telephony\/ports\.js/);
});

test("ein neuer Import aus src/store/ an der Fassade vorbei ist rot und nennt die Fassade", (context) => {
  const directory = repositoryWith(context, {});
  writeFiles(directory, { [ROUTE]: ROUTE_TO_STORE_INTERNAL });

  const result = checkDependencies(directory);
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.stderr, /src\/routes\/voice\.js → src\/store\/defaults\.js/);
  assert.match(result.stderr, /Fassade src\/store\.js/);
});

test("zwei Ordner unter src/, die sich neu gegenseitig importieren, sind rot", (context) => {
  const directory = repositoryWith(context, {});
  writeFiles(directory, FOLDER_CYCLE);

  const result = checkDependencies(directory);
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.stderr, /src\/a → src\/b verstößt gegen „keine-ordnerzyklen“/);
});

test("eingefrorene Altverstöße bleiben grün, auch ein Zyklus zwischen Ordnern", (context) => {
  const directory = repositoryWith(context, {
    [ROUTE]: ROUTE_TO_ADAPTER,
    ...FOLDER_CYCLE,
    ...knownList([FROZEN_PORT_BYPASS, ...FROZEN_FOLDER_CYCLE]),
  });

  const result = checkDependencies(directory);
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("wer einen neuen Verstoß in die eingefrorene Liste schreibt, bekommt trotzdem rot", (context) => {
  const directory = repositoryWith(context, {});
  writeFiles(directory, { [ROUTE]: ROUTE_TO_ADAPTER, ...knownList([FROZEN_PORT_BYPASS]) });

  const result = checkDependencies(directory);
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.stderr, /darf nur kürzer werden/);
  assert.match(
    result.stderr,
    /src\/routes\/voice\.js → src\/telephony\/adapters\/telnyx\/voice\.js/,
  );
});

test("ein behobener Altverstoß darf aus der eingefrorenen Liste gestrichen werden", (context) => {
  const directory = repositoryWith(context, {
    [ROUTE]: ROUTE_TO_ADAPTER,
    ...knownList([FROZEN_PORT_BYPASS]),
  });
  writeFiles(directory, { [ROUTE]: ROUTE_THROUGH_PORTS, ...knownList([]) });

  const result = checkDependencies(directory);
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("eine Basis, die es im Checkout nicht gibt, lässt die Prüfung nicht durch", (context) => {
  const result = checkDependencies(repositoryWith(context, {}), UNKNOWN_COMMIT);
  assert.equal(result.status, EXIT_USAGE);
  assert.match(result.stderr, /kein Commit/);
});
