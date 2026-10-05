import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const CATALOG_PATH = "docs/sicherheitsgrenzen.md";
const MAPPING_PATH = "docs/sicherheitsabgleich.json";
const WITHOUT_TEST_PATH = "tools/basis/katalog-ohne-test.txt";
const TEST_DIRECTORY = "test";
const SOURCE_DIRECTORY = "src";
const TEST_FILE_PATTERN = /\.test\.[cm]?js$/;
const SOURCE_FILE_PATTERN = /\.[cm]?js$/;
const ID_PATTERN = /^SG-\d{2,}$/;
export const TEST_NAME_PATTERN = /\b(?:test|it|describe)\(\s*["'`](SG-\d{2,})(?!\d)/g;
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
const TABLE_ROW_PATTERN = /^\|(.*)\|\s*$/;
const HTTPS_PATTERN = /^https:\/\/\S+$/;
const THREAT_COLUMNS = 5;
const SURFACE_COLUMNS = 3;
const TOOL_KIND = "Werkzeug";
const ROUTE_KIND = "Route";
const WEBHOOK_KIND = "Webhook";
const SURFACE_KINDS = new Set([TOOL_KIND, ROUTE_KIND, WEBHOOK_KIND]);
const WEBHOOK_PREFIXES = ["/voice/", "/webhooks/"];
const TOP_TEN = 10;
const TWO_DIGITS = 2;
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const COMMIT_OBJECT_TYPE = "commit";
const MAX_DISCOVERY_OUTPUT_BYTES = 16_777_216;
const NODE_ENV_WITHOUT_DOTENV = "test";
const PRODUCTION_STORE_BACKEND = "pg";
const PROBE_PUBLIC_URL = "https://katalog-pruefen.invalid";
const PROBE_SESSION_SECRET = "katalog-pruefen";
const DEPENDENCY_NAMES = [
  ...["store", "audit", "callFinish", "lifecycle", "provisioning", "outboundGates"],
  ...["callQuotaDenial", "requestTenant", "requireTenant", "conversationWatchdog", "ttsStore"],
  ...["directiveSynth", "voiceRender", "costTruing", "messaging", "consultDelivery"],
  ...["elevenLabsOutbound", "inboundBridges", "accountsRef", "auditStoreRef", "durableAuditFor"],
];
const NUMBERED = (format) => Array.from({ length: TOP_TEN }, (_unused, index) => format(index + 1));
const TWO_DIGIT = (number) => String(number).padStart(TWO_DIGITS, "0");
const EXPECTED_POINTS = {
  "owasp-mcp-top-10": NUMBERED((number) => `MCP${TWO_DIGIT(number)}:2025`),
  "mcp-sicherheitspraktiken": [
    ...["confused-deputy-problem", "token-passthrough", "server-side-request-forgery-ssrf"],
    ...["session-hijacking", "state-handle-hijacking", "local-mcp-server-compromise"],
    ...["oauth-authorization-url-validation", "stdio-transport-security-in-proxy-scenarios"],
    ...["mix-up-attacks", "localhost-redirect-uri-impersonation", "cimd-trust-policies"],
    "scope-minimization",
  ],
  "owasp-llm-top-10": NUMBERED((number) => `LLM${TWO_DIGIT(number)}:2025`),
  "owasp-api-top-10": NUMBERED((number) => `API${number}:2023`),
  "owasp-cicd-top-10": NUMBERED((number) => `CICD-SEC-${number}`),
};
const NOT_APPLICABLE = "„trifft nicht zu“";
const MESSAGE = {
  duplicateThreat: (id) => `${id} steht mehrfach.`,
  incompleteThreat: ([id]) => `${id} braucht alle fünf Spalten.`,
  misnamedTest: ([id]) => `der Negativtest von ${id} beginnt nicht mit „${id} “.`,
  missingSurface: (key) => `${key} hat keine Zeile im Abschnitt Angriffsfläche.`,
  staleSurface: (key) => `${key} steht im Abschnitt Angriffsfläche, ist aber nicht registriert.`,
  duplicateSurface: (key) => `${key} steht mehrfach im Abschnitt Angriffsfläche.`,
  unlabeledSurface: ([kind, surface]) => `${kind} ${surface} braucht eine Kennung.`,
  unknownReference: (text) => `${text}, die es im Katalog nicht gibt.`,
  listedUnknown: (id) => `${id} steht nicht im Katalog.`,
  listedTested: (id) => `${id} hat jetzt einen Negativtest; streiche die Zeile.`,
  untested: (id) => `${id} hat keinen Negativtest unter test/, dessen Name mit „${id} “ beginnt.`,
  listGrew: (id) => `${id} ist neu; die Liste darf nur kürzer werden, schreibe den Negativtest.`,
  listShape: () => "eine Kennung je Zeile, sortiert, ohne Doppelte (--liste-neu erzeugt sie).",
  missingList: (id) => `die Liste ${id} fehlt.`,
  unknownList: (id) => `die Liste ${id} ist unbekannt.`,
  missingPoint: (id) => `der Punkt ${id} fehlt.`,
  unknownPoint: (id) => `den Punkt ${id} gibt es in dieser Liste nicht.`,
  duplicatePoint: (id) => `der Punkt ${id} steht mehrfach da.`,
  asIs: (text) => text,
};
const USAGE = "Aufruf: node tools/katalog-pruefen.mjs [--basis <commit>] [--liste-neu]";
const BY_ID = (left, right) => left.localeCompare(right, "en", { numeric: true });

const standIn = new Proxy(function standIn() {}, {
  get: (_target, key) => {
    if (key === "then") return undefined;
    return key === Symbol.iterator ? [][Symbol.iterator] : standIn;
  },
  apply: () => standIn,
});

const report = (path, values, message) => values.map((value) => `${path}: ${message(value)}`);
const outside = (values, known) => values.filter((value) => !known.has(value));
const inside = (values, known) => values.filter((value) => known.has(value));
const trimmedParts = (text, separator) => text.split(separator).map((part) => part.trim());
const partsOf = (text = "", separator = ",") => trimmedParts(text, separator).filter(Boolean);
const moduleUrl = (root, path) => pathToFileURL(join(root, path)).href;

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function filesBelow(root, directory, pattern) {
  const base = join(root, directory);
  if (!existsSync(base)) return [];
  const entries = readdirSync(base, { recursive: true, encoding: "utf8" });
  return entries.filter((entry) => pattern.test(entry)).map((entry) => join(directory, entry));
}

function readCatalog(root) {
  const text = readFileSync(join(root, CATALOG_PATH), "utf8");
  const matches = text.split("\n").map((line) => TABLE_ROW_PATTERN.exec(line.trim()));
  const rows = matches.filter(Boolean).map((match) => trimmedParts(match[1], "|"));
  return {
    threats: rows.filter((cells) => ID_PATTERN.test(cells[0])),
    surfaces: rows.filter((cells) => SURFACE_KINDS.has(cells[0])),
  };
}

function threatFindings(threats) {
  const incomplete = threats.filter(
    (cells) => cells.length !== THREAT_COLUMNS || cells.includes(""),
  );
  const misnamed = threats.filter(([id, ...rest]) => !rest.at(-1)?.startsWith(`${id} `));
  return [
    ...report(CATALOG_PATH, duplicates(threats.map(([id]) => id)), MESSAGE.duplicateThreat),
    ...report(CATALOG_PATH, incomplete, MESSAGE.incompleteThreat),
    ...report(CATALOG_PATH, misnamed, MESSAGE.misnamedTest),
  ];
}

function existingFile({ pfad }, { root }) {
  if (!pfad) return "der Pfad der Prüfung fehlt";
  return existsSync(join(root, pfad)) ? undefined : `die Prüfung ${pfad} gibt es nicht`;
}

function noRoute({ pfade }, { routes }) {
  if (!Array.isArray(pfade) || pfade.length === 0) return "die Pfadanfänge fehlen";
  const route = routes.find(({ path }) => pfade.some((prefix) => path.startsWith(prefix)));
  return route && `die Route ${route.flaeche} ist registriert`;
}

function noImport({ modul }, { imports }) {
  if (!modul) return "das Modul fehlt";
  const hit = imports.find(({ specifier }) => specifier.startsWith(modul));
  return hit && `${hit.file} importiert ${hit.specifier}`;
}

const PREMISE_CHECKS = new Map([
  ["datei", existingFile],
  ["keine_route", noRoute],
  ["kein_import", noImport],
]);

function exemptionProblems(exemption, context) {
  if (!exemption.begruendung?.trim()) return [`${NOT_APPLICABLE} braucht eine Begründung.`];
  const premise = PREMISE_CHECKS.get(exemption.pruefung?.art);
  const kinds = [...PREMISE_CHECKS.keys()].join(", ");
  if (!premise) return [`${NOT_APPLICABLE} braucht eine Prüfung der Art ${kinds}.`];
  const problem = premise(exemption.pruefung, context);
  return problem ? [`${NOT_APPLICABLE} gilt nicht mehr, ${problem}.`] : [];
}

function pointProblems(point, context) {
  const hasRows = Array.isArray(point.zeilen) && point.zeilen.length > 0;
  const hasExemption = point.trifft_nicht_zu !== undefined;
  if (hasRows === hasExemption)
    return [`braucht Katalogzeilen oder ${NOT_APPLICABLE}, genau eines.`];
  const sourceOk = point.quelle === undefined || HTTPS_PATTERN.test(point.quelle);
  const source = sourceOk ? [] : ["die Quelle muss eine https-Adresse sein."];
  if (hasExemption) return [...source, ...exemptionProblems(point.trifft_nicht_zu, context)];
  const unknown = outside(point.zeilen, context.threatIds);
  return [...source, ...unknown.map((id) => `${id} gibt es im Katalog nicht.`)];
}

function listFindings(list, expected, context) {
  const where = `${MAPPING_PATH}: Liste ${list.kennung}`;
  const points = list.punkte ?? [];
  const ids = points.map((point) => point.kennung);
  const source = HTTPS_PATTERN.test(list.quelle ?? "") ? [] : ["braucht eine https-Quelle."];
  return [
    ...report(where, source, MESSAGE.asIs),
    ...report(where, outside(expected, new Set(ids)), MESSAGE.missingPoint),
    ...report(where, outside(ids, new Set(expected)), MESSAGE.unknownPoint),
    ...report(where, duplicates(ids), MESSAGE.duplicatePoint),
    ...points.flatMap((point) =>
      report(`${where}, ${point.kennung}`, pointProblems(point, context), MESSAGE.asIs),
    ),
  ];
}

function mappingFindings(mapping, context) {
  const lists = mapping.listen ?? [];
  const known = new Set(Object.keys(EXPECTED_POINTS));
  const present = lists.map((list) => list.kennung);
  const checked = lists.filter((list) => known.has(list.kennung));
  return [
    ...report(MAPPING_PATH, outside([...known], new Set(present)), MESSAGE.missingList),
    ...report(MAPPING_PATH, outside(present, known), MESSAGE.unknownList),
    ...checked.flatMap((list) => listFindings(list, EXPECTED_POINTS[list.kennung], context)),
  ];
}

function surfaceFindings(rows, registered, threatIds) {
  const keys = rows.map(([kind, surface]) => `${kind} ${surface}`);
  const expected = registered.map(({ art, flaeche }) => `${art} ${flaeche}`);
  const unlabeled = rows.filter(
    (cells) => cells.length !== SURFACE_COLUMNS || !partsOf(cells[2])[0],
  );
  const unknown = rows.flatMap(([kind, surface, cell]) =>
    outside(partsOf(cell), threatIds).map((id) => `${kind} ${surface} verweist auf ${id}`),
  );
  return [
    ...report(CATALOG_PATH, outside(expected, new Set(keys)), MESSAGE.missingSurface),
    ...report(CATALOG_PATH, outside(keys, new Set(expected)), MESSAGE.staleSurface),
    ...report(CATALOG_PATH, duplicates(keys), MESSAGE.duplicateSurface),
    ...report(CATALOG_PATH, unlabeled, MESSAGE.unlabeledSurface),
    ...report(CATALOG_PATH, unknown, MESSAGE.unknownReference),
  ];
}

function testFindings({ threatIds, tested, listed, basisListed }) {
  const canonical = [...new Set(listed)].sort(BY_ID).join("\n");
  const wellFormed = listed.every((id) => ID_PATTERN.test(id)) && canonical === listed.join("\n");
  const untested = outside(outside([...threatIds], tested), new Set(listed));
  const added = basisListed === null ? [] : outside(listed, basisListed);
  return [
    ...report(WITHOUT_TEST_PATH, wellFormed ? [] : [listed], MESSAGE.listShape),
    ...report(WITHOUT_TEST_PATH, outside(listed, threatIds), MESSAGE.listedUnknown),
    ...report(WITHOUT_TEST_PATH, inside(listed, tested), MESSAGE.listedTested),
    ...report(CATALOG_PATH, untested, MESSAGE.untested),
    ...report(WITHOUT_TEST_PATH, added, MESSAGE.listGrew),
  ];
}

function testedIds(root) {
  const files = filesBelow(root, TEST_DIRECTORY, TEST_FILE_PATTERN);
  const texts = files.map((file) => readFileSync(join(root, file), "utf8"));
  const matches = texts.flatMap((text) => [...text.matchAll(TEST_NAME_PATTERN)]);
  return new Set(matches.map((match) => match[1]));
}

function sourceImports(root) {
  return filesBelow(root, SOURCE_DIRECTORY, SOURCE_FILE_PATTERN).flatMap((file) => {
    const matches = [...readFileSync(join(root, file), "utf8").matchAll(IMPORT_PATTERN)];
    return matches.map((match) => ({ file, specifier: match[1] }));
  });
}

function basisList(basis) {
  if (basis === undefined) return null;
  const objectType = spawnSync("git", ["cat-file", "-t", basis], { encoding: "utf8" });
  if (objectType.stdout.trim() !== COMMIT_OBJECT_TYPE) {
    throw new Error(`Die Basis ${basis} ist kein Commit in diesem Checkout.`);
  }
  const shown = spawnSync("git", ["show", `${basis}:${WITHOUT_TEST_PATH}`], { encoding: "utf8" });
  return shown.status === EXIT_OK ? new Set(partsOf(shown.stdout, "\n")) : null;
}

async function registeredTools(root) {
  const { registerTools } = await import(moduleUrl(root, "src/mcp-tools.js"));
  const server = new McpServer({ name: "katalog-pruefen", version: "0.0.0" });
  const names = [];
  const register = server.registerTool.bind(server);
  server.registerTool = (name, ...rest) => {
    names.push(name);
    return register(name, ...rest);
  };
  registerTools(server, { consultAllowed: true });
  return names.map((name) => ({ art: TOOL_KIND, flaeche: name }));
}

function routesOf(stack) {
  return stack.flatMap((layer) => {
    if (layer.handle?.stack) return routesOf(layer.handle.stack);
    const methods = Object.keys(layer.route?.methods ?? {});
    return methods.map((method) => ({ method: method.toUpperCase(), path: layer.route.path }));
  });
}

async function quietly(work) {
  const { log, error, warn } = console;
  console.log = console.error = console.warn = () => {};
  try {
    return await work();
  } finally {
    Object.assign(console, { log, error, warn });
  }
}

async function productionApp(root, scratch) {
  const { config } = await import(moduleUrl(root, "src/config.js"));
  const webDistDir = join(scratch, "web");
  Object.assign(config.server, { dataDir: scratch, webDistDir, publicUrl: PROBE_PUBLIC_URL });
  Object.assign(config.auth, { sessionSecret: PROBE_SESSION_SECRET });
  Object.assign(config.tenancy, { multiTenant: true, selfServiceEnabled: true });
  const { buildApp } = await quietly(() => import(moduleUrl(root, "src/app.js")));
  config.store.storeBackend = PRODUCTION_STORE_BACKEND;
  const dependencies = {
    ...Object.fromEntries(DEPENDENCY_NAMES.map((name) => [name, standIn])),
    config,
    createPortalRunner: async () => ({ withClient: async (work) => work(standIn), _pool: null }),
  };
  const { app } = await quietly(() => buildApp(dependencies));
  return app;
}

async function registeredRoutes(root) {
  const scratch = mkdtempSync(join(tmpdir(), "katalog-pruefen-"));
  try {
    const routes = routesOf((await productionApp(root, scratch))._router.stack);
    const unique = new Map(routes.map((route) => [`${route.method} ${route.path}`, route.path]));
    return [...unique].map(([flaeche, path]) => {
      const webhook = WEBHOOK_PREFIXES.some((prefix) => path.startsWith(prefix));
      return { art: webhook ? WEBHOOK_KIND : ROUTE_KIND, flaeche, path };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function surfacesInCleanEnvironment(root) {
  const discovery = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--flaechen"], {
    cwd: root,
    encoding: "utf8",
    env: { NODE_ENV: NODE_ENV_WITHOUT_DOTENV },
    maxBuffer: MAX_DISCOVERY_OUTPUT_BYTES,
  });
  if (discovery.status !== EXIT_OK) {
    throw new Error(`Werkzeuge und Routen ließen sich nicht ermitteln: ${discovery.stderr.trim()}`);
  }
  return JSON.parse(discovery.stdout);
}

function summary({ threats, listed, surfaces, mapping }) {
  const count = (kind) => surfaces.filter(({ art }) => art === kind).length;
  const lists = mapping.listen ?? [];
  const points = lists.flatMap((list) => list.punkte ?? []);
  const exempt = points.filter((point) => point.trifft_nicht_zu !== undefined).length;
  return [
    `Bedrohungskatalog: ${threats.length} Zeilen, davon ${listed.length} ohne Negativtest.`,
    `Angriffsfläche: ${count(TOOL_KIND)} Werkzeuge, ${count(ROUTE_KIND)} Routen, ${count(WEBHOOK_KIND)} Webhooks.`,
    `Abgleich: ${points.length} Punkte aus ${lists.length} Listen, ${exempt} ${NOT_APPLICABLE}.`,
  ];
}

function check(root, basis) {
  const { threats, surfaces: surfaceRows } = readCatalog(root);
  const threatIds = new Set(threats.map(([id]) => id));
  const mapping = JSON.parse(readFileSync(join(root, MAPPING_PATH), "utf8"));
  const listPath = join(root, WITHOUT_TEST_PATH);
  const listed = existsSync(listPath) ? partsOf(readFileSync(listPath, "utf8"), "\n") : [];
  const surfaces = surfacesInCleanEnvironment(root);
  const routes = surfaces.filter(({ art }) => art !== TOOL_KIND);
  const context = { root, threatIds, routes, imports: sourceImports(root) };
  const findings = [
    ...threatFindings(threats),
    ...testFindings({ threatIds, tested: testedIds(root), listed, basisListed: basisList(basis) }),
    ...mappingFindings(mapping, context),
    ...surfaceFindings(surfaceRows, surfaces, threatIds),
  ];
  for (const line of summary({ threats, listed, surfaces, mapping })) console.log(line);
  for (const finding of findings) console.error(finding);
  return findings.length > 0 ? EXIT_FINDING : EXIT_OK;
}

function writeList(root) {
  const tested = testedIds(root);
  const ids = readCatalog(root).threats.map(([id]) => id);
  const untested = outside(ids, tested).sort(BY_ID);
  writeFileSync(join(root, WITHOUT_TEST_PATH), untested.map((id) => `${id}\n`).join(""));
  console.log(`${WITHOUT_TEST_PATH}: ${untested.length} Kennungen ohne Negativtest geschrieben.`);
  return EXIT_OK;
}

async function main() {
  const flag = { type: "boolean", default: false };
  const options = { basis: { type: "string" }, "liste-neu": flag, flaechen: flag };
  const { values } = parseArgs({ options });
  if (values.flaechen) {
    console.log(
      JSON.stringify([...(await registeredTools(".")), ...(await registeredRoutes("."))]),
    );
    return EXIT_OK;
  }
  if (values["liste-neu"]) return writeList(".");
  return check(".", values.basis);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Abbruch: ${error.message}`);
    console.error(USAGE);
    process.exitCode = EXIT_USAGE;
  }
}
