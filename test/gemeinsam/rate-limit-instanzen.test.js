import test from "node:test";
import assert from "node:assert/strict";
import { startServer, startIdp, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { anteiligesLimit } from "../../src/utils/rate-limit-anteil.ts";
import { execFileSync } from "node:child_process";
import { ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const IP = "203.0.113.77";
const SUB = "sub-anteil";
const TENANT = "t_anteil";
const SKRIPT = 'import("./src/config.js").then(({ config }) => process.stdout.write(JSON.stringify({ safety: config.safety, auth: config.auth })));';

function loadConfig(umgebung) {
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", SKRIPT], { cwd: ROOT, env, encoding: "utf8" }));
}

const initBody = { jsonrpc: "2.0", id: 1, method: "initialize" };

async function stati(env, anzahl, ip = IP) {
  const srv = await startServer({ env });
  try {
    const ergebnis = [];
    for (let i = 0; i < anzahl; i++) {
      const res = await abrufMitFrist(`${srv.localUrl}/healthz`, { headers: { "X-Forwarded-For": ip } });
      ergebnis.push({ status: res.status, retryAfter: res.headers.get("retry-after") });
    }
    return ergebnis;
  } finally {
    await srv.stop();
  }
}

test("RLI-1: 4 Instanzen und Limit 8 -> je Instanz 2 Anfragen, die 3. ist 429 mit Retry-After", async () => {
  const antworten = await stati({ SERVER_INSTANCES: "4", RATE_LIMIT_PER_MIN: "8" }, 3);
  assert.deepEqual(antworten.map((a) => a.status), [HTTP_OK, HTTP_OK, HTTP_TOO_MANY]);
  assert.ok(antworten[2].retryAfter);
});

test("RLI-2: ohne SERVER_INSTANCES gilt das Limit unveraendert je Instanz", async () => {
  const antworten = await stati({ SERVER_INSTANCES: "", RATE_LIMIT_PER_MIN: "3" }, 4);
  assert.deepEqual(antworten.map((a) => a.status), [HTTP_OK, HTTP_OK, HTTP_OK, HTTP_TOO_MANY]);
});

for (const wert of ["0", "-2", "abc"]) {
  test(`RLI-2: SERVER_INSTANCES=${wert} faellt auf 1 zurueck`, async () => {
    const config = loadConfig({ SERVER_INSTANCES: wert });
    assert.equal(config.safety.serverInstanzen, 1);
  });
}

test("RLI-3: Limit 3 bei 4 Instanzen -> je Instanz mindestens 1", async () => {
  const antworten = await stati({ SERVER_INSTANCES: "4", RATE_LIMIT_PER_MIN: "3" }, 2);
  assert.deepEqual(antworten.map((a) => a.status), [HTTP_OK, HTTP_TOO_MANY]);
});

test("RLI-3: Limit 0 sperrt weiter alles, auch mit mehreren Instanzen", async () => {
  const antworten = await stati({ SERVER_INSTANCES: "4", RATE_LIMIT_PER_MIN: "0" }, 1);
  assert.deepEqual(antworten.map((a) => a.status), [HTTP_TOO_MANY]);
});

test("RLI-4: die MCP-Drossel gilt anteilig je Mandant", async () => {
  const idp = await startIdp();
  const seed = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: TENANT, status: "active", idpSubject: SUB },
    ],
  });
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, SERVER_INSTANCES: "4", RATE_LIMIT_PER_MIN: "8" },
    seed,
  });
  try {
    const token = await idp.sign({ sub: SUB });
    const stati = [];
    for (let i = 0; i < 3; i++) {
      const res = await abrufMitFrist(`${srv.localUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          "X-Forwarded-For": IP,
        },
        body: JSON.stringify(initBody),
      });
      stati.push(res.status);
    }
    assert.deepEqual(stati, [HTTP_OK, HTTP_OK, HTTP_TOO_MANY]);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("RLI-5: die Login-Bremse bleibt bei 4 Instanzen unveraendert", () => {
  const config = loadConfig({ SERVER_INSTANCES: "4", LOGIN_RATE_LIMIT_PER_MIN: "10", MAX_CALLS_PER_HOUR: "8" });
  assert.equal(config.auth.loginRateLimitPerMin, 10);
  assert.equal(config.safety.maxCallsPerHour, 8);
  assert.equal(config.safety.serverInstanzen, 4);
});

const TABELLE = [
  [8, 4, 2],
  [10, 4, 2],
  [3, 4, 1],
  [1, 4, 1],
  [0, 4, 0],
  [120, 1, 120],
  [120, 3, 40],
];
for (const [limit, instanzen, erwartet] of TABELLE) {
  test(`anteiligesLimit(${limit}, ${instanzen}) = ${erwartet}`, () => {
    assert.equal(anteiligesLimit(limit, instanzen), erwartet);
  });
}
