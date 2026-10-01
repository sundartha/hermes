// ---- Routen-Inventar (PLAN-AUTH-GATE P1) -----------------------------------------
// Der dauerhafte Ersatz fuer die Sammelsicherung. Frueher schuetzte EIN Basic-Auth-Gate
// alles, was nicht ausdruecklich ausgenommen war - eine neue Route war damit per
// Default sicher. Seit AUTH-P7 gibt es keine Sammelsicherung mehr: eine neue Route
// waere ohne diesen Test per Default oeffentlich, und zwar lautlos (200 statt Fehler,
// kein Log, siehe PLAN-AUTH-GATE Abschnitt 5, S1). Dieser Test stellt den Default
// wieder her, nur maschinell: er laeuft ueber den Routengraph und verlangt fuer JEDE
// Route eine bewusste Einordnung in src/route-policy.js.
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

// src/store.js initialisiert sein Backend zur IMPORTZEIT (src/store/json.js friert
// config.server.dataDir in einer Modul-Konstante ein). Ohne Override fasste der Import
// das echte data/store.json an - deshalb Temp-Verzeichnis UND dynamischer Import
// (statische Importe wuerden vor diesen Zeilen ausgewertet).
const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "route-auth-inventory-"));

// Die Schalter, die den Produktions-Routengraph aufspannen, werden auf dem
// config-Singleton gesetzt (Muster test/platform-spend-warning.test.js, das dieselbe
// Wahl fuer dataDir trifft; storeBackend unten in graphFor() setzt ihn fort). Die
// Reihenfolge bleibt die tragende Eigenschaft und ist nur eine Zeile weiter gerueckt:
// erst config.js importieren, DANN setzen, DANN app.js - die einfrierenden Module
// (store/json.js) haengen am app-Import, nicht am config-Import. storeBackend bleibt
// auch hier aussen vor (der pg-Store wuerde beim Import eine DB suchen) und wird erst
// pro Graph umgeschaltet - buildApp liest ihn zur Aufrufzeit.
const { config } = await import("../src/config.js");
config.server.dataDir = TEMP_DATA_DIR;
config.auth.sessionSecret = "route-inventory-test-secret";
config.tenancy.multiTenant = true;
config.tenancy.selfServiceEnabled = true;
config.server.webDistDir = path.join(TEMP_DATA_DIR, "web-dist");
config.server.publicUrl = "https://route-inventory.test";

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
// (express.static, Body-Parser, Rate-Limiter) interessieren hier nicht - sie sind
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

const keysOf = (graph) => new Set(graph.map((route) => routeKey(route.method, route.path)));
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
  "DELETE /api/self-service/newsletter-recipients",
  "DELETE /mcp",
  "GET /.well-known/oauth-protected-resource",
  "GET /.well-known/oauth-protected-resource/mcp",
  // E7: Domain-Ownership-Challenge der OpenAI-Einreichung (O-4/O-5). Klasse PUBLIC,
  // Eintrag in src/route-policy.js. Ohne gesetzten Token antwortet sie 404 - gemountet
  // ist sie trotzdem immer (bedingte Registrierung waere im Graph unsichtbar).
  "GET /.well-known/openai-apps-challenge",
  // OpenAI-P10b (I-2b): RFC-9116-Sicherheitskontakt. Klasse PUBLIC, Eintrag in
  // src/route-policy.js.
  "GET /.well-known/security.txt",
  "GET /account",
  "GET /admin",
  // OpenAI-P10b: authentifizierter Ersatz fuer die aus /healthz entfernte
  // configHash-Preisgabe (Preimage-Befund). Klasse AUTH (operatorRoutes), kein Eintrag
  // in src/route-policy.js.
  "GET /api/admin/deploy-info",
  "GET /api/admin/tenants",
  "GET /api/billing/checkout-return",
  "GET /api/billing/cost-drift",
  "GET /api/billing/kosten-deckung",
  "GET /api/billing/platform-costs",
  "GET /api/calls/:id",
  "GET /api/calls/:id/consult",
  "GET /api/plans",
  "GET /api/portal/state",
  "GET /api/self-service/billing/return",
  "GET /api/self-service/billing/status",
  "GET /api/self-service/state",
  "GET /api/state",
  "GET /api/tenant-data/export",
  "GET /app/*",
  "GET /auth/callback",
  "GET /auth/login",
  "GET /dashboard",
  "GET /healthz",
  "GET /login",
  "GET /mcp",
  "GET /newsletter/confirm",
  "GET /newsletter/unsubscribe",
  "GET /portal",
  "GET /sign-in",
  "GET /signin",
  "GET /tenant.html",
  "GET /voice/tts/:token",
  "POST /api/admin/tenants/:id/approve",
  "POST /api/admin/tenants/:id/suspend",
  "POST /api/billing/cost-truing/sweep",
  "POST /api/billing/flush-meters",
  "POST /api/billing/setup-checkout",
  // T2-13 (N-10): Bestaetigungs-Vorschau vor dem Waehlen (prepare_call/place_call). Klasse
  // AUTH (internalOnly, wie POST /api/calls) - kein Eintrag in src/route-policy.js.
  "POST /api/call-confirmations",
  "POST /api/calls",
  "POST /api/calls/:id/cancel",
  "POST /api/calls/:id/consult/answer",
  // Cookie-Einwilligungs-Protokoll (Nachweis Art. 7 Abs. 1 DSGVO) - Klasse PUBLIC,
  // Eintrag in src/route-policy.js, nur im pg-Block gemountet (src/wiring/web-login.js).
  "POST /api/cookie-consent",
  // INBOX-P2: der Konsum-Endpunkt der Anruf-Inbox. Klasse AUTH (internalOnly), deshalb
  // KEIN Eintrag in src/route-policy.js - nur hier und in scripts/probe-auth.sh.
  "POST /api/inbox/poll",
  "POST /api/onboard",
  "POST /api/onboard/retry",
  "POST /api/self-service/billing/cancel",
  "POST /api/self-service/billing/resume",
  "POST /api/self-service/billing/setup-checkout",
  "POST /api/self-service/billing/subscribe",
  "POST /api/self-service/newsletter-consent",
  "POST /api/self-service/newsletter-recipients",
  "POST /api/self-service/private-number",
  "POST /api/self-service/settings",
  "POST /auth/logout",
  "POST /mcp",
  // IEL-B8: Rueckfall-Route und SIP-Bein-Callback des EL-Inbound-Wegs - unter der /voice-Signatur-MW,
  // Eintrag in src/route-policy.js mit VOICE_SIGNATURE_REASON.
  "POST /voice/el-bein",
  "POST /voice/el-rueckfall",
  "POST /voice/incoming",
  "POST /voice/outbound",
  "POST /voice/status",
  "POST /voice/turn",
  "POST /webhooks/elevenlabs/consult",
  // IEL-B6: der Conversation-Initiation-Webhook des Inbound-Wegs - handler-interne Auth
  // (Init-Token + Bindungs-Token), Eintrag in src/route-policy.js.
  "POST /webhooks/elevenlabs/init",
  // Thema B (2026-08-19): der Recherche-Webhook (look_up) - Bauart und Absicherung
  // wortgleich zum Consult-Webhook, Eintrag in src/route-policy.js.
  "POST /webhooks/elevenlabs/lookup",
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

test("Routen-Inventar: die vier Auth-Middlewares sind benannte Funktionen und im Graph sichtbar", () => {
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

// ---- AUTH-P6: die Betreiber-Routen tragen BEIDE Middlewares -----------------------
// classifyRoute() wertet AUTH schon dann, wenn IRGENDEINE Auth-Middleware in der Kette
// steht (Plan Abschnitt 5, "Ehrliche Luecke") - webAuthGateMiddleware ALLEIN waere fuer
// diese Routen zu wenig (jeder eingeloggte, aber nicht-admin Kunde saehe sie).
// Die Paar-Assertion unten schliesst genau diese Luecke fuer diese Routen. (OpenAI-P10b:
// GET /api/admin/deploy-info kam als achte Route dazu - die feste Zahl "sieben" aus dem
// AUTH-P6-Namen war ab da sachlich falsch und ist hier bewusst entfernt.)
const OPERATOR_ROUTE_KEYS = [
  "POST /api/billing/flush-meters",
  "POST /api/billing/cost-truing/sweep",
  "GET /api/billing/cost-drift",
  "GET /api/billing/kosten-deckung",
  "GET /api/billing/platform-costs",
  "POST /api/onboard",
  "POST /api/onboard/retry",
  "GET /api/admin/deploy-info",
];

test("AUTH-P6-7: die Betreiber-Routen tragen webAuthGateMiddleware UND adminOnlyMiddleware", () => {
  const byKey = new Map(PROD_GRAPH.map((route) => [routeKey(route.method, route.path), route]));
  for (const key of OPERATOR_ROUTE_KEYS) {
    const route = byKey.get(key);
    assert.ok(route, `${key} fehlt im Produktions-Graph`);
    assert.ok(
      route.handlerNames.includes("webAuthGateMiddleware"),
      `${key}: webAuthGateMiddleware fehlt in der Handler-Kette (${route.handlerNames.join(",")})`,
    );
    assert.ok(
      route.handlerNames.includes("adminOnlyMiddleware"),
      `${key}: adminOnlyMiddleware fehlt in der Handler-Kette (${route.handlerNames.join(",")})`,
    );
  }
});

test("AUTH-P6-8: ohne pg-Backend sind die Betreiber-Routen gar nicht gemountet (Kehrseite von AUTH-P6-5, In-Process)", () => {
  const leanKeys = keysOf(LEAN_GRAPH);
  for (const key of OPERATOR_ROUTE_KEYS) {
    assert.ok(
      !leanKeys.has(key),
      `${key} existiert auch ohne pg-Backend - die Betreiber-Routen duerfen ohne ` +
        "operatorAuth (webAuthMw+adminMw) gar nicht gemountet sein (fail-closed by construction).",
    );
  }
});
