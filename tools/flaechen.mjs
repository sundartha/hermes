import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const TOOL_KIND = "Werkzeug";
export const ROUTE_KIND = "Route";
export const WEBHOOK_KIND = "Webhook";
const WEBHOOK_PREFIXES = ["/voice/", "/webhooks/"];
const EXIT_OK = 0;
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

const standIn = new Proxy(function standIn() {}, {
  get: (_target, key) => {
    if (key === "then") return undefined;
    return key === Symbol.iterator ? [][Symbol.iterator] : standIn;
  },
  apply: () => standIn,
});

const moduleUrl = (root, path) => pathToFileURL(join(root, path)).href;

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

export function surfacesInCleanEnvironment(root) {
  const discovery = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
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

export async function registeredSurfaces(root) {
  return [...(await registeredTools(root)), ...(await registeredRoutes(root))];
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  console.log(JSON.stringify(await registeredSurfaces(".")));
}
