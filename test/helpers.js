// Test-Helpers: Server als Kindprozess starten (PORT=0 -> echten Port aus dem
// Log parsen), Store-Seeding in ein Temp-DATA_DIR und Requests ueber die
// externe Interface-IP (fuer Tests, die NICHT als localhost gelten sollen).
import { spawn } from "child_process";
import fs from "fs";
import http from "node:http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_TIMEOUT_MS = 15000;

// ALLE config-relevanten Env-Variablen explizit setzen: dotenv fuellt nur
// UNgesetzte Variablen, so kann eine lokale .env die Tests nicht beeinflussen.
export const BASE_ENV = {
  PORT: "0",
  DATA_DIR: "", // wird pro Server durch ein Temp-Verzeichnis ersetzt
  ANTHROPIC_API_KEY: "test-anthropic-key",
  CLAUDE_MODEL: "claude-haiku-4-5",
  MAX_BUDGET_EUR: "8",
  // ---- LLM-Resilienz-Seam (P3b-R, src/llm.js) ----
  // Neutral + deterministisch: kurzer Timeout/Backoff, damit Tests, die den Seam ab
  // CP3 beruehren, nicht haengen; sonst leakt eine lokale .env via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift). LLM_BACKOFF_MS=1 (nicht 250), damit
  // der ab CP3 konsumierte Seam Spawn-Tests nicht ausbremst (CP3 ownt diese Datei nicht).
  LLM_REQUEST_TIMEOUT_MS: "3500",
  LLM_MAX_RETRIES: "2",
  LLM_BACKOFF_MS: "1",
  LLM_BREAKER_THRESHOLD: "5",
  LLM_BREAKER_WINDOW_MS: "10000",
  LLM_BREAKER_COOLDOWN_MS: "30000",
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
  TWILIO_NUMBER: "+15005550006",
  TWILIO_EDGE: "frankfurt",
  OWNER_NAME: "Jonas",
  OWNER_NUMBER: "",
  SEND_SMS_SUMMARY: "false",
  PUBLIC_URL: "https://agent.test",
  DASHBOARD_PASSWORD: "",
  MCP_AUTH_TOKEN: "",
  ALLOWED_NUMBERS: "",
  ALLOWED_COUNTRY_CODES: "*", // Land-Gate fuer Altbestand neutral; number-gate.test.js setzt es explizit
  MAX_CALLS_PER_HOUR: "100", // hoch genug, dass es Altbestand-Tests nicht bremst (wie RATE_LIMIT_PER_MIN)
  PROFILES_JSON: "", // Profile-Seed leer; einzelne Tests setzen es explizit
  MAX_CALL_DURATION_S: "180",
  SKIP_TWILIO_SIGNATURE_CHECK: "true",
  RATE_LIMIT_PER_MIN: "1000",
  RETENTION_DAYS: "0",
  VOICE_ENGINE: "budget",
  OPENAI_API_KEY: "",
  REALTIME_MODEL: "gpt-realtime",
  REALTIME_VOICE: "alloy",
  // ---- Telnyx (zweiter Provider) ----
  // Alle leer: der Default-Outbound-Provider bleibt Twilio. Sonst kippt eine
  // lokale .env mit gesetzter TELNYX_NUMBER den Outbound-Pfad auf Telnyx (200
  // statt 500) und faelscht Profile-/Gate-/Audit-Tests.
  TELNYX_NUMBER: "",
  TELNYX_API_KEY: "",
  TELNYX_PUBLIC_KEY: "",
  TELNYX_API_BASE: "",
  TELNYX_CONNECTION_ID: "",
  TELNYX_ACCOUNT_SID: "",
  // ---- Store-Backend + Onboarding/Provisioning ----
  // Neutral + fail-closed: json-Store, kein echter Nummern-Kauf. Tests, die das
  // brauchen (pg, Cap, echtes Provisioning), setzen es explizit per env-Override.
  STORE_BACKEND: "json",
  DATABASE_URL: "",
  // Queue-Backend neutral + fail-closed (In-Memory, deterministisch). Ohne diese
  // Zeile leakt eine lokale .env mit QUEUE_BACKEND=pgboss via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift).
  QUEUE_BACKEND: "memory",
  MAX_NUMBERS: "5",
  MAX_NUMBERS_PER_TENANT: "1",
  PROVISIONING_ENABLED: "false",
  PROVISIONING_COUNTRY: "DE",
  // Multi-Tenant default AUS: Bestandssuite laeuft byte-identisch im Owner-Pfad.
  // Ohne diesen Eintrag wuerde eine lokale .env mit MULTI_TENANT=true via dotenv
  // in Spawn-Tests lecken -> Baseline-Drift (Lehre test-base-env-drift).
  MULTI_TENANT: "false",
  // Self-Service default AUS (fail-closed): Bestandssuite byte-identisch. Ohne diese
  // Zeile leakt eine lokale .env mit SELF_SERVICE_ENABLED=true via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  SELF_SERVICE_ENABLED: "false",
  // ---- Payment/Billing (P6b1) ----
  // Neutral + fail-closed: kein Hold/Capture. Ohne diese Zeilen leakt eine lokale
  // .env mit PAYMENT_ENABLED=true via dotenv in Spawn-Tests -> Baseline-Drift.
  PAYMENT_ENABLED: "false",
  STRIPE_SECRET_KEY: "",
  STRIPE_API_BASE: "",
  NUMBER_SETUP_FEE_CENTS: "0",
  PAYMENT_CURRENCY: "eur",
  // Voice-Minuten-Meter-Tarif (P6b3) neutral 0: ohne diese Zeile leakt eine lokale
  // .env mit VOICE_MINUTE_COST_CENTS via dotenv in Spawn-Tests -> Baseline-Drift.
  VOICE_MINUTE_COST_CENTS: "0",
  // ---- MCP-Auth + OAuth + Hosting ----
  // Neutral; oauth.test.js / mcp-Tests setzen Issuer/Audience/Modus explizit.
  MCP_AUTH: "",
  OAUTH_ISSUER_URL: "",
  OAUTH_AUDIENCE: "",
  RENDER_EXTERNAL_URL: "",
};

// Erste nicht-interne IPv4-Adresse - Requests dorthin gelten serverseitig
// nicht als localhost (req.socket.remoteAddress != 127.0.0.1).
export function externalIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

// rawStore (String, optional): schreibt den Inhalt VERBATIM als store.json - fuer
// Tests, die ein bewusst kaputtes/nicht-JSON-File am Boot brauchen (Korruptions-
// Pfad, T-P1-03). seedState geht weiter durch JSON.stringify (gueltiges JSON).
export function tempDataDir(seedState, rawStore) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-test-"));
  if (typeof rawStore === "string") fs.writeFileSync(path.join(dir, "store.json"), rawStore);
  else if (seedState) fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(seedState, null, 2));
  return dir;
}

// Minimal-vollstaendiger Store-Zustand zum Seeden einzelner Testfaelle. tenants
// und numbers haben bewusst KEINEN Default (undefined): ohne sie ist die Form
// byte-identisch zum Altbestand (Conditional-Spread unten), mit ihnen laesst sich
// ein aktiver Tenant samt eigener Nummer seeden (Inbound-Routing + Identitaet).
export function seedState({ calls = [], actionItems = [], notifications = [], settings = {}, profiles = {}, tenants, numbers } = {}) {
  return {
    settings: {
      agentName: "Hermes",
      greeting: "Hallo, hier ist der KI-Assistent von {owner}. Wie kann ich helfen?",
      allowCalendar: true,
      allowBooking: true,
      allowSummaries: true,
      allowPersonalData: false,
      allowBankData: false,
      ...settings,
    },
    calls,
    actionItems,
    calendar: [],
    usage: { inputTokens: 0, outputTokens: 0, costEur: 0, calls: calls.length },
    notifications,
    profiles,
    ...(tenants ? { tenants } : {}),
    ...(numbers ? { numbers } : {}),
  };
}

export function seedCall(overrides = {}) {
  return {
    id: "call_test1",
    twilioSid: null,
    direction: "outbound",
    from: "+15005550006",
    to: "+4915112345678",
    goal: "Testziel",
    briefing: null,
    constraints: null,
    callerName: null,
    language: "de",
    maxDurationS: 60,
    status: "active",
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    actionItemIds: [],
    ...overrides,
  };
}

// Wartet, bis das stdout des Kindprozesses auf das Pattern matcht - die
// HTTP-Antwort kommt oft an, BEVOR die Log-Pipe beim Parent eingetroffen ist.
export async function waitForLog(srv, regex, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!regex.test(srv.stdout)) {
    if (Date.now() > deadline) throw new Error(`Log-Pattern ${regex} nicht gefunden in:\n${srv.stdout}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Mock der Telnyx-PROVISIONING-API: routet nach Pfad (search/order/configure).
// Liefert e164 +4915799990001. Geteilt von onboarding-route + onboarding-identity
// (G5: eine Definition statt zweier Kopien). Name explizit "...ProvisioningMock",
// um die Kollision mit dem lokalen Voice/Originate-Mock in onboarding-outbound.test.js
// (startTelnyxVoiceMock) aufzuloesen - zwei verschiedene Telnyx-APIs (TD-9).
export async function startTelnyxProvisioningMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, body });
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v2/available_phone_numbers"))
        return res.end(JSON.stringify({ data: [{ phone_number: "+4915799990001" }] }));
      if (req.url === "/v2/number_orders")
        return res.end(JSON.stringify({ data: { phone_numbers: [{ id: "num_ext_1", phone_number: "+4915799990001" }] } }));
      // configure (PATCH .../voice), release (DELETE) -> 200 ok
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

// Fake-Billing-Adapter (P6b1): aufzeichnend + per-Override werfbar, analog dem
// Fake-Provisioner. Lebt in test/helpers.js (NICHT in src/) - reines Test-Double
// fuer provisionNumber. log haelt [methode, ...args] in Aufrufreihenfolge.
export function fakeBilling(overrides = {}) {
  const log = [];
  const base = {
    async placeHold(args) { log.push(["placeHold", args]); return { paymentIntentId: "pi_fake_1" }; },
    async captureHold(id, amt) { log.push(["captureHold", id, amt]); },
    async cancelHold(id) { log.push(["cancelHold", id]); },
    async reportMeter(args) { log.push(["reportMeter", args]); }, // P6b3-Meter-Aufzeichner
  };
  return { log, ...base, ...overrides };
}

// Fake-Provisioner-Adapter: aufzeichnend (log) + per-Override werfbar (DIP) -
// reines Test-Double fuer provisionNumber/handleProvisionJob, kein Netz. Eine Quelle
// (G5/S2) statt der frueher in onboarding-service/billing-hold-capture/provisioning-
// worker dreifach kopierten Definition. log haelt die Schritte in Aufrufreihenfolge.
export function fakeProvisioner(overrides = {}) {
  const log = [];
  const base = {
    async searchNumbers() { log.push("search"); return [{ e164: "+4915799990001" }]; },
    async orderNumber({ e164, idempotencyKey }) { log.push(`order:${e164}:${idempotencyKey}`); return { e164, providerNumberId: "num_ext_1" }; },
    async configureNumber({ providerNumberId, connectionId }) { log.push(`configure:${providerNumberId}:${connectionId}`); },
    async releaseNumber(id) { log.push(`release:${id}`); },
  };
  return { log, ...base, ...overrides };
}

// ---- OAuth-Mini-IdP (offline) fuer MCP_AUTH=oauth-Tests ----
// = PUBLIC_URL/mcp aus BASE_ENV (kanonische Audience).
export const MCP_AUDIENCE = "https://agent.test/mcp";
const KID = "test-key-1";

// Lokaler IdP: Metadata zeigt auf den JWKS-Endpunkt, JWKS enthaelt den
// oeffentlichen Schluessel. Liefert Issuer-URL + Signierer. metadataPath waehlt
// den Well-known-Pfad (WorkOS AuthKit nutzt oauth-authorization-server).
export async function startIdp({ metadataPath = "/.well-known/openid-configuration" } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const server = http.createServer((req, res) => {
    if (req.url === metadataPath) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const issuer = `http://127.0.0.1:${server.address().port}`;

  // Zweiter Schluessel mit GLEICHER kid -> jose findet den Key, die Signatur
  // passt aber nicht: sauberer 401 ohne JWKS-Refetch.
  const wrong = await generateKeyPair("RS256");

  // noSubject: true laesst den sub-Claim ganz weg (fuer den Fail-closed-Test:
  // verifiziertes Token ohne email UND sub).
  const sign = (claims = {}, { key = privateKey, exp = "5m", aud = MCP_AUDIENCE, iss = issuer, noSubject = false } = {}) => {
    let jwt = new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp);
    if (!noSubject) jwt = jwt.setSubject(claims.sub || "user-1");
    return jwt.sign(key);
  };

  return { issuer, sign, wrongKey: wrong.privateKey, close: () => new Promise((r) => server.close(r)) };
}

// POST an /mcp (Streamable HTTP). Ohne body: initialize. Antwort kann SSE sein.
export function mcpPost(url, token, body = { jsonrpc: "2.0", id: 1, method: "initialize" }) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// JSON-RPC tools/call-Body fuer ein MCP-Tool (stateless: kein initialize noetig).
export const toolCall = (name, args = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

// Startet src/server.js und ERWARTET einen Boot-Refusal (Exit statt listen). Fuer
// die Fail-closed-Tests (OT-4): liefert { code, output }. Wirft, wenn der Prozess
// NICHT innerhalb timeoutMs beendet (d.h. der Boot lief durch). Teilt BASE_ENV +
// tempDataDir mit startServer (G5: keine zweite Spawn-Definition).
export async function startServerExpectExit({ env = {}, seed, rawStore, timeoutMs = 8000 } = {}) {
  const dataDir = tempDataDir(seed, rawStore);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Server ist NICHT beendet (Boot-Refusal erwartet). Output:\n${output}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

// Startet src/server.js als Kindprozess und liefert Port, gesammeltes stdout
// und einen stop()-Handle. Wirft bei Startproblemen mit dem bisherigen Output.
export async function startServer({ env = {}, seed, rawStore } = {}) {
  const dataDir = tempDataDir(seed, rawStore);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = { text: "" };
  child.stdout.on("data", (d) => (output.text += d.toString()));
  child.stderr.on("data", (d) => (output.text += d.toString()));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server-Start Timeout. Output:\n${output.text}`)),
      STARTUP_TIMEOUT_MS
    );
    const onData = (d) => {
      const m = output.text.match(/laeuft auf http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(parseInt(m[1], 10));
      }
    };
    child.stdout.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server vorzeitig beendet (code ${code}). Output:\n${output.text}`));
    });
  });

  return {
    port,
    dataDir,
    child,
    localUrl: `http://127.0.0.1:${port}`,
    externalUrl: externalIp() ? `http://${externalIp()}:${port}` : null,
    get stdout() {
      return output.text;
    },
    readStore() {
      return JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
    },
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    },
  };
}
