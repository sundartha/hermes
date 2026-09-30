import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  commitAll,
  passingTest,
  probeRepository,
  REPO_ROOT,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const CATALOG_TOOL = join(REPO_ROOT, "tools/katalog-pruefen.mjs");
const EXPRESS_URL = pathToFileURL(join(REPO_ROOT, "node_modules/express/index.js")).href;
const CATALOG_PATH = "docs/sicherheitsgrenzen.md";
const MAPPING_PATH = "docs/sicherheitsabgleich.json";
const LIST_PATH = "tools/basis/katalog-ohne-test.txt";
const TESTED = "SG-01";
const UNTESTED = "SG-02";
const LATER = "SG-10";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const LIST_LENGTH = 10;
const PAD = 2;
const TOOL = ["Werkzeug", "probe_werkzeug"];
const ROUTE = ["Route", "GET /api/probe"];
const WEBHOOK = ["Webhook", "POST /webhooks/probe"];
const SURFACES = [TOOL, ROUTE, WEBHOOK];
const ten = (format) => Array.from({ length: LIST_LENGTH }, (_unused, index) => format(index + 1));
const pad = (number) => String(number).padStart(PAD, "0");
const PUBLIC_LISTS = {
  "owasp-mcp-top-10": ten((number) => `MCP${pad(number)}:2025`),
  "mcp-sicherheitspraktiken": [
    ...["confused-deputy-problem", "token-passthrough", "server-side-request-forgery-ssrf"],
    ...["session-hijacking", "state-handle-hijacking", "local-mcp-server-compromise"],
    ...["oauth-authorization-url-validation", "stdio-transport-security-in-proxy-scenarios"],
    ...["mix-up-attacks", "localhost-redirect-uri-impersonation", "cimd-trust-policies"],
    "scope-minimization",
  ],
  "owasp-llm-top-10": ten((number) => `LLM${pad(number)}:2025`),
  "owasp-api-top-10": ten((number) => `API${number}:2023`),
  "owasp-cicd-top-10": ten((number) => `CICD-SEC-${number}`),
};

function catalog({ threats = [TESTED, UNTESTED], surfaces = SURFACES } = {}) {
  return [
    "| Kennung | Angriff | Verletzte Grenze | Mechanismus | Negativtest |",
    "| --- | --- | --- | --- | --- |",
    ...threats.map((id) => `| ${id} | Angriff | Grenze | Mechanismus | ${id} wird abgelehnt |`),
    "",
    "| Art | Fläche | Kennungen |",
    "| --- | --- | --- |",
    ...surfaces.map(([kind, surface]) => `| ${kind} | ${surface} | ${TESTED} |`),
    "",
  ].join("\n");
}

function mapping(pointsById = {}) {
  const listen = Object.entries(PUBLIC_LISTS).map(([kennung, ids]) => ({
    kennung,
    quelle: "https://example.invalid/liste",
    punkte: ids
      .filter((id) => pointsById[id] !== null)
      .map((id) => pointsById[id] ?? { kennung: id, zeilen: [TESTED] }),
  }));
  return JSON.stringify({ listen });
}

function application() {
  const routes = [ROUTE, WEBHOOK].map(([, surface]) => surface.split(" "));
  return [
    `import express from ${JSON.stringify(EXPRESS_URL)};`,
    "export async function buildApp() {",
    "  const app = express();",
    ...routes.map(
      ([method, path]) =>
        `  app.${method.toLowerCase()}(${JSON.stringify(path)}, (_request, response) => response.end());`,
    ),
    "  return { app };",
    "}",
    "",
  ].join("\n");
}

function probe(context, files = {}) {
  return probeRepository(context, {
    "src/config.js": "export const config = { server: {}, auth: {}, tenancy: {}, store: {} };\n",
    "src/mcp-tools.js": [
      "export function registerTools(server) {",
      `  server.registerTool(${JSON.stringify(TOOL[1])}, { description: "Probe" }, async () => ({ content: [] }));`,
      "}",
      "",
    ].join("\n"),
    "src/app.js": application(),
    "test/probe.test.js": passingTest(`${TESTED} wird abgelehnt`),
    [CATALOG_PATH]: catalog(),
    [MAPPING_PATH]: mapping(),
    [LIST_PATH]: `${UNTESTED}\n`,
    ...files,
  });
}

function runCatalogCheck(directory, args = []) {
  return runIn(directory, process.execPath, [CATALOG_TOOL, ...args]);
}

test("ein Werkzeug, eine Route und ein Webhook mit Katalogzeile gehen durch, ohne Zeile ist die Prüfung rot", (context) => {
  const complete = runCatalogCheck(probe(context));
  assert.equal(complete.status, EXIT_OK, complete.stderr);
  assert.match(complete.stdout, /1 Werkzeuge, 1 Routen, 1 Webhooks/);

  const withoutTool = runCatalogCheck(
    probe(context, { [CATALOG_PATH]: catalog({ surfaces: [ROUTE, WEBHOOK] }) }),
  );
  assert.equal(withoutTool.status, EXIT_FINDING);
  assert.match(
    withoutTool.stderr,
    /Werkzeug probe_werkzeug hat keine Zeile im Abschnitt Angriffsfläche/,
  );

  const webhookAsRoute = runCatalogCheck(
    probe(context, { [CATALOG_PATH]: catalog({ surfaces: [TOOL, ROUTE, ["Route", WEBHOOK[1]]] }) }),
  );
  assert.equal(webhookAsRoute.status, EXIT_FINDING);
  assert.match(webhookAsRoute.stderr, /Webhook POST \/webhooks\/probe hat keine Zeile/);
});

test("eine Katalogzeile ohne Negativtest ist nur erlaubt, solange sie in der Liste ohne Test steht", (context) => {
  const unlisted = runCatalogCheck(probe(context, { [LIST_PATH]: "" }));
  assert.equal(unlisted.status, EXIT_FINDING);
  assert.match(unlisted.stderr, /SG-02 hat keinen Negativtest/);

  const testedButListed = runCatalogCheck(
    probe(context, { "test/zweite.test.js": passingTest(`${UNTESTED} wird abgelehnt`) }),
  );
  assert.equal(testedButListed.status, EXIT_FINDING);
  assert.match(testedButListed.stderr, /SG-02 hat jetzt einen Negativtest; streiche die Zeile/);

  const testedAndRemoved = runCatalogCheck(
    probe(context, {
      "test/zweite.test.js": passingTest(`${UNTESTED} wird abgelehnt`),
      [LIST_PATH]: "",
    }),
  );
  assert.equal(testedAndRemoved.status, EXIT_OK, testedAndRemoved.stderr);
});

test("die Liste ohne Test darf gegenüber der Basis nur kürzer werden", (context) => {
  const directory = probe(context);
  writeFiles(directory, {
    [CATALOG_PATH]: catalog({ threats: [TESTED, UNTESTED, LATER] }),
    [LIST_PATH]: `${UNTESTED}\n${LATER}\n`,
  });
  const grown = runCatalogCheck(directory, ["--basis", "HEAD"]);
  assert.equal(grown.status, EXIT_FINDING);
  assert.match(grown.stderr, /SG-10 ist neu; die Liste darf nur kürzer werden/);

  commitAll(directory, "Liste mit zwei Einträgen");
  writeFiles(directory, {
    "test/zehn.test.js": passingTest(`${LATER} wird abgelehnt`),
    [LIST_PATH]: `${UNTESTED}\n`,
  });
  const shrunk = runCatalogCheck(directory, ["--basis", "HEAD"]);
  assert.equal(shrunk.status, EXIT_OK, shrunk.stderr);
});

test("jeder Punkt der fünf Listen muss im Abgleich stehen, und „trifft nicht zu“ gilt nur, solange die Prüfung hält", (context) => {
  const missing = runCatalogCheck(
    probe(context, { [MAPPING_PATH]: mapping({ "LLM08:2025": null }) }),
  );
  assert.equal(missing.status, EXIT_FINDING);
  assert.match(missing.stderr, /Liste owasp-llm-top-10: der Punkt LLM08:2025 fehlt/);

  const exemptionFor = (pfade) => ({
    "cimd-trust-policies": {
      kennung: "cimd-trust-policies",
      trifft_nicht_zu: {
        begruendung: "Kein Autorisierungsserver.",
        pruefung: { art: "keine_route", pfade },
      },
    },
  });
  const holds = runCatalogCheck(
    probe(context, { [MAPPING_PATH]: mapping(exemptionFor(["/authorize"])) }),
  );
  assert.equal(holds.status, EXIT_OK, holds.stderr);

  const broken = runCatalogCheck(
    probe(context, { [MAPPING_PATH]: mapping(exemptionFor(["/api/"])) }),
  );
  assert.equal(broken.status, EXIT_FINDING);
  assert.match(
    broken.stderr,
    /cimd-trust-policies: „trifft nicht zu“ gilt nicht mehr, die Route GET \/api\/probe ist registriert/,
  );
});

test("--liste-neu schreibt die Kennungen ohne Negativtest sortiert, eine je Zeile", (context) => {
  const directory = probe(context, {
    [CATALOG_PATH]: catalog({ threats: [LATER, TESTED, UNTESTED] }),
    [LIST_PATH]: "",
  });
  const result = runCatalogCheck(directory, ["--liste-neu"]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(readFileSync(join(directory, LIST_PATH), "utf8"), `${UNTESTED}\n${LATER}\n`);
});
