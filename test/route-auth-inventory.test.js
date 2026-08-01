// ---- Routen-Inventar (PLAN-AUTH-GATE P1) -----------------------------------------
// Der dauerhafte Ersatz fuer die Sammelsicherung. Heute schuetzt EIN Basic-Auth-Gate
// alles, was nicht ausdruecklich ausgenommen ist - eine neue Route ist damit per
// Default sicher. Faellt das Gate (P7), kehrt sich das um: eine neue Route waere per
// Default oeffentlich, und zwar lautlos (200 statt Fehler, kein Log, siehe
// PLAN-AUTH-GATE Abschnitt 5, S1). Dieser Test stellt den Default wieder her, nur
// maschinell: er laeuft ueber den Routengraph und verlangt fuer JEDE Route eine
// bewusste Einordnung in src/route-policy.js.
//
// WARUM DER GRAPH MIT pg-BACKEND GEBAUT WIRD (B3): der gesamte Web-Login-Block
// (/auth/*, /api/self-service/*, /api/admin/*, /api/portal/state, /webhooks/stripe)
// haengt in src/app.js an `sessionSecret && storeBackend === "pg"`. Die Spawn-Tests
// fahren STORE_BACKEND=json - in ihnen existieren diese Routen NICHT. Ein Inventar-
// Test gegen die Default-Testumgebung waere also blind fuer genau die Middleware, auf
// der P5/P6 ruhen: gruen und wertlos. Deshalb wird hier der PRODUKTIONS-Graph gebaut
// (pg-Schalter + injizierter createPortalRunner, ohne erreichbare Postgres), und der
// erste Test beweist ueber eine Positiv-Assertion, dass es wirklich dieser Graph ist.
//
// Kein Spawn, kein Netz, keine DB: buildApp wird in-process mit Attrappen aufgerufen.
// Der Test stellt KEINE Anfragen - er liest nur den Mount-Baum. Deshalb reichen
// Attrappen, die die Konstruktion ueberstehen.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AUTH_MIDDLEWARE_NAMES,
  GATE_ONLY_ROUTES,
  PUBLIC_ROUTES,
  ROUTE_CLASS,
  classifyRoute,
  routeKey,
} from "../src/route-policy.js";

// src/store.js initialisiert sein Backend zur IMPORTZEIT. Ohne DATA_DIR-Override
// fasste der Import das echte data/store.json an - deshalb Temp-Verzeichnis UND
// dynamischer Import (statische Importe wuerden vor diesen Zeilen ausgewertet).
const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "route-auth-inventory-"));
process.env.DATA_DIR = TEMP_DATA_DIR;
// Die drei Schalter, die den Produktions-Routengraph aufspannen. storeBackend wird
// bewusst NICHT hier gesetzt (der pg-Store wuerde beim Import eine DB suchen),
// sondern erst nach dem Import auf dem config-Singleton - buildApp liest ihn zur
// Aufrufzeit.
process.env.SESSION_SECRET = "route-inventory-test-secret";
process.env.MULTI_TENANT = "true";
process.env.SELF_SERVICE_ENABLED = "true";
process.env.WEB_DIST_DIR = path.join(TEMP_DATA_DIR, "web-dist");
process.env.PUBLIC_URL = "https://route-inventory.test";

const { config } = await import("../src/config.js");
const { buildApp } = await import("../src/app.js");

after(() => fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true }));

// ---- Attrappen ------------------------------------------------------------------
// Nur so viel, wie die KONSTRUKTION der Route-Factories braucht (mehrere
// destrukturieren ihre Kollaboratoren sofort). Kein Handler wird je aufgerufen.
const noop = () => {};
const asyncNoop = async () => {};

const inventoryDeps = () => ({
  config,
  // Der DID-Release-Reconciler startet beim Web-Login-Mount sofort einen Lauf
  // (fire-and-forget). Ein wohlgeformter leerer Zustand laesst ihn geraeuschlos
  // leerlaufen, statt in den catch-Zweig zu fallen.
  store: { load: () => ({ numbers: [], calls: [], tenants: {} }) },
  audit: noop,
  callFinish: { finishCall: asyncNoop },
  lifecycle: {
    armMaxDurationTimer: noop,
    armReserveReleaseTimer: noop,
    reattachActiveCallByControlId: asyncNoop,
  },
  provisioning: { triggerTenantProvisioning: asyncNoop },
  outboundGates: [],
  requestTenant: noop,
  requireTenant: noop,
  conversationWatchdog: {},
  ttsStore: {},
  directiveSynth: {},
  voiceRender: {
    render: noop,
    turnDirectives: noop,
    sayInCallVoice: noop,
    followupTurnDirectives: noop,
    streamDirectives: noop,
  },
  costTruing: {},
  messaging: {},
  consultDelivery: {},
  // Der einzige infrastruktur-beruehrende Kollaborator des Web-Login-Blocks. Die
  // Attrappe liefert die echte Runner-Form (withClient) mit leerem Ergebnis.
  createPortalRunner: async () => ({
    withClient: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    _pool: null,
  }),
});

// buildApp meldet den Boot-Erfolg auf der Konsole ("[boot] Web-Login aktiv"). Im
// Testlauf ist das nur Rauschen; der Erfolgsfall wird ueber die Positiv-Assertion
// geprueft, nicht ueber das Log.
async function withSilencedConsole(fn) {
  const { log, error } = console;
  console.log = noop;
  console.error = noop;
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

// ---- Graph einsammeln -------------------------------------------------------------
// Express 4: layer.route ist eine Route (Pfad + Methoden + Handler-Kette),
// layer.handle.stack ein gemounteter Router. Middleware-Schichten ohne Route
// (express.static, das Auth-Gate, Body-Parser) interessieren hier nicht - sie sind
// nicht einer Route zugeordnet und darum nicht einzuordnen.
function collectRoutes(app) {
  const routes = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        const handlerNames = layer.route.stack.map((entry) => entry.handle.name);
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ method: method.toUpperCase(), path: layer.route.path, handlerNames });
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(app._router.stack);
  return routes;
}

async function graphFor(storeBackend) {
  const previous = config.store.storeBackend;
  config.store.storeBackend = storeBackend;
  try {
    const { app } = await withSilencedConsole(() => buildApp(inventoryDeps()));
    return collectRoutes(app);
  } finally {
    config.store.storeBackend = previous;
  }
}

// Beide Graphen EINMAL vor allen Tests bauen: sie teilen sich das config-Singleton,
// ein Umschalten waehrend laufender Tests waere von der Ausfuehrungsreihenfolge
// abhaengig (F.I.R.S.T./I).
const PROD_GRAPH = await graphFor("pg");
const LEAN_GRAPH = await graphFor("json");

const keysOf = (graph) => new Set(graph.map((r) => routeKey(r.method, r.path)));
const PROD_KEYS = keysOf(PROD_GRAPH);

// Diese vier Routen entstehen AUSSCHLIESSLICH im Web-Login-Block. Sie sind der Beweis,
// dass der gepruefte Graph der Produktions-Graph ist.
const WEB_LOGIN_PROOF = [
  "GET /api/self-service/state",
  "GET /api/admin/tenants",
  "GET /api/portal/state",
  "POST /webhooks/stripe",
];

// Gepinnter Fingerprint: jede Route mehr oder weniger erzwingt eine bewusste
// Aktualisierung dieser Liste - und damit eine Einordnung in src/route-policy.js.
const ROUTE_FINGERPRINT = [
  "DELETE /api/profiles/:tenantId",
  "DELETE /mcp",
  "GET /.well-known/oauth-protected-resource",
  "GET /.well-known/oauth-protected-resource/mcp",
  "GET /api/admin/tenants",
  "GET /api/billing/checkout-return",
  "GET /api/billing/cost-drift",
  "GET /api/billing/platform-costs",
  "GET /api/calls/:id",
  "GET /api/calls/:id/consult",
  "GET /api/plans",
  "GET /api/portal/state",
  "GET /api/profiles",
  "GET /api/self-service/billing/return",
  "GET /api/self-service/billing/status",
  "GET /api/self-service/state",
  "GET /api/state",
  "GET /api/tenant-data/export",
  "GET /app/*",
  "GET /auth/callback",
  "GET /auth/login",
  "GET /healthz",
  "GET /mcp",
  "GET /tenant.html",
  "GET /voice/tts/:token",
  "POST /api/action-items/:id/toggle",
  "POST /api/admin/tenants/:id/approve",
  "POST /api/admin/tenants/:id/suspend",
  "POST /api/billing/cost-truing/sweep",
  "POST /api/billing/flush-meters",
  "POST /api/billing/setup-checkout",
  "POST /api/calendar",
  "POST /api/calls",
  "POST /api/calls/:id/cancel",
  "POST /api/calls/:id/consult/answer",
  "POST /api/onboard",
  "POST /api/onboard/retry",
  "POST /api/profiles",
  "POST /api/self-service/billing/setup-checkout",
  "POST /api/self-service/billing/subscribe",
  "POST /api/self-service/private-number",
  "POST /api/self-service/settings",
  "POST /api/settings",
  "POST /auth/logout",
  "POST /mcp",
  "POST /v1/chat/completions",
  "POST /voice/call-control",
  "POST /voice/incoming",
  "POST /voice/outbound",
  "POST /voice/status",
  "POST /voice/turn",
  "POST /webhooks/stripe",
];

// ---- Tests ------------------------------------------------------------------------

test("Routen-Inventar: der gepruefte Graph ist der Produktions-Graph (Web-Login-Block gemountet)", () => {
  for (const key of WEB_LOGIN_PROOF) {
    assert.ok(
      PROD_KEYS.has(key),
      `${key} fehlt im geprueften Graph. Entweder ist der pg-Schalter wirkungslos ` +
        "geworden, oder guardedBoot hat den Web-Login-Block verschluckt - in beiden " +
        "Faellen prueft dieser Test nicht mehr, was er zu pruefen vorgibt.",
    );
  }
});

test("Routen-Inventar: jede Route hat Auth, steht in der Oeffentlich-Liste oder ist gemeldete Gate-Restarbeit", () => {
  const unprotected = PROD_GRAPH.filter(
    (route) => classifyRoute(route) === ROUTE_CLASS.UNPROTECTED,
  ).map((route) => routeKey(route.method, route.path));
  assert.deepEqual(
    unprotected,
    [],
    "Diese Routen tragen keine Auth-Middleware und sind in src/route-policy.js nirgends " +
      "eingeordnet. Entweder eine Auth-Middleware davorsetzen oder den Eintrag mit " +
      "Begruendung ergaenzen (Absolute Regel 3).",
  );
});

test("Routen-Inventar: keine verwaisten Eintraege in Oeffentlich-Liste und Gate-Restliste", () => {
  const stale = [...PUBLIC_ROUTES, ...GATE_ONLY_ROUTES]
    .map((entry) => routeKey(entry.method, entry.path))
    .filter((key) => !PROD_KEYS.has(key));
  assert.deepEqual(
    stale,
    [],
    "Diese Eintraege in src/route-policy.js zeigen auf Routen, die es nicht mehr gibt. " +
      "Eine verwaiste Ausnahme ist eine Ausnahme, die beim naechsten gleichnamigen " +
      "Endpunkt still wieder greift - loeschen.",
  );
});

test("Routen-Inventar: der Routen-Fingerprint ist unveraendert", () => {
  assert.deepEqual(
    [...PROD_KEYS].sort(),
    ROUTE_FINGERPRINT,
    "Der Routenbestand hat sich geaendert. Das ist erlaubt - aber nur bewusst: Liste hier " +
      "nachziehen UND die neue/entfallene Route in src/route-policy.js einordnen.",
  );
});

test("Routen-Inventar: die drei Auth-Middlewares sind benannte Funktionen und im Graph sichtbar", () => {
  const seen = new Set(PROD_GRAPH.flatMap((route) => route.handlerNames));
  for (const name of AUTH_MIDDLEWARE_NAMES) {
    assert.ok(
      seen.has(name),
      `${name} taucht in keiner Handler-Kette auf. Wurde die Middleware in eine anonyme ` +
        "Funktion umgewandelt, ist sie im Express-Stack '<anonymous>' - dann haelt dieser " +
        "Test jede damit geschuetzte Route faelschlich fuer ungeschuetzt.",
    );
  }
});

test("Routen-Inventar: eine unbekannte Route ohne Auth wird als ungeschuetzt gemeldet", () => {
  assert.equal(
    classifyRoute({ method: "GET", path: "/probe-unbekannt-12345", handlerNames: [] }),
    ROUTE_CLASS.UNPROTECTED,
  );
  assert.equal(
    classifyRoute({
      method: "GET",
      path: "/probe-unbekannt-12345",
      handlerNames: ["webAuthGateMiddleware"],
    }),
    ROUTE_CLASS.AUTH,
  );
});

test("Routen-Inventar: ohne pg-Backend fehlt der Web-Login-Block (der Graph-Schalter wirkt)", () => {
  const leanKeys = keysOf(LEAN_GRAPH);
  for (const key of WEB_LOGIN_PROOF) {
    assert.ok(
      !leanKeys.has(key),
      `${key} existiert auch ohne pg-Backend. Dann ist die Positiv-Assertion oben ` +
        "wertlos, weil sie auch gegen den mageren Testgraph gruen waere.",
    );
  }
});
