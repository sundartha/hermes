// AM1: Der Legacy-Socket-Bypass von /mcp (MCP_AUTH="" ohne MCP_AUTH_TOKEN) darf in
// Produktion NIE greifen. Auf Render ist req.socket.remoteAddress immer der Loopback-
// Proxy -> isLocalSocket waere fuer JEDEN Internet-Request wahr. Reine In-Process-Tests
// (isProduction injizierbar bzw. config-Override mit striktem Restore) - kein Spawn,
// kein Netz. Das Nicht-Produktions-Verhalten deckt zusaetzlich security.test.js (Spawn).
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { legacyLocalBypassAllowed, mcpAuth } from "../src/auth.js";

const LOCAL = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const reqFrom = (remoteAddress) => ({ socket: { remoteAddress }, headers: {} });

// Minimal-Express-Double: status() chainbar, json()/set() erfassend.
function fakeRes() {
  const res = { statusCode: null, body: null };
  res.set = () => res;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

test("AM1: legacyLocalBypassAllowed - Produktion verweigert jeden Socket", () => {
  for (const a of LOCAL) assert.equal(legacyLocalBypassAllowed(reqFrom(a), true), false, a);
  assert.equal(legacyLocalBypassAllowed(reqFrom("203.0.113.7"), true), false);
});

test("AM1: legacyLocalBypassAllowed - ausserhalb Produktion nur localhost", () => {
  for (const a of LOCAL) assert.equal(legacyLocalBypassAllowed(reqFrom(a), false), true, a);
  assert.equal(legacyLocalBypassAllowed(reqFrom("203.0.113.7"), false), false);
});

// Verdrahtung: dieselbe localhost-Legacy-Anfrage (kein Token) kippt allein durch das
// Produktions-Gate von next() auf 401. config.* wird ueberschrieben + strikt restauriert
// (Muster config-prod-footguns.test.js withConfig). mcpAuth/mcpAuthToken werden explizit
// gesetzt, damit der Test unabhaengig von der Runner-Env ist (kein BASE_ENV im Prozess).
test("AM1: mcpAuth - Produktions-Gate kippt localhost-Legacy-Bypass auf 401", async () => {
  const saved = {
    isProduction: config.isProduction,
    mcpAuth: config.mcpAuth,
    mcpAuthToken: config.mcpAuthToken,
  };
  try {
    Object.assign(config, { mcpAuth: "", mcpAuthToken: "", isProduction: true });
    let nexted = false;
    const res = fakeRes();
    await mcpAuth(reqFrom("127.0.0.1"), res, () => {
      nexted = true;
    });
    assert.equal(nexted, false, "kein next() in Produktion");
    assert.equal(res.statusCode, 401);

    config.isProduction = false;
    let nexted2 = false;
    const res2 = fakeRes();
    await mcpAuth(reqFrom("127.0.0.1"), res2, () => {
      nexted2 = true;
    });
    assert.equal(nexted2, true, "ausserhalb Produktion Bypass wie bisher");
    assert.equal(res2.statusCode, null);
  } finally {
    Object.assign(config, saved);
  }
});

// PA-17: Verdrahtungs-Test fuer die config.<flatKey> -> config.<namespace>.<key>-Migration
// in auth.js. Reine Zugriffspfad-Aenderung ohne Logik-Aenderung: dieser Test deckt alle vier
// mcpAuth-Modi in einem deterministischen In-Process-Matrix-Lauf ab, damit "vor/nach identisch"
// beweisbar bleibt (Reviewer-Vorgehen: Test gegen unmigrierte und migrierte auth.js gruen).
const reqWith = ({ remoteAddress = "203.0.113.7", auth } = {}) => ({
  socket: { remoteAddress },
  headers: auth ? { authorization: auth } : {},
});

async function runMcpAuth(req) {
  let nexted = false;
  const res = fakeRes();
  await mcpAuth(req, res, () => {
    nexted = true;
  });
  return { nexted, statusCode: res.statusCode };
}

// Override + strikt restaurierter Save/Restore auf den Flach-Keys (Muster oben): der
// Proxy hat kein set-Trap, schreibt also rawConfig[key] durch - die Namespace-Getter
// (config.auth.*) lesen denselben Speicherort, migrierte auth.js sieht den Override.
function withMcpConfig(overrides, fn) {
  const saved = {
    mcpAuth: config.mcpAuth,
    mcpAuthToken: config.mcpAuthToken,
    isProduction: config.isProduction,
  };
  Object.assign(config, { mcpAuth: "", mcpAuthToken: "", isProduction: false, ...overrides });
  try {
    return fn();
  } finally {
    Object.assign(config, saved);
  }
}

test("PA-17: mcpAuth Modus-Matrix (off/oauth/token/legacy) - Verzweigung unveraendert", async () => {
  // off -> immer next(), egal welcher Request
  await withMcpConfig({ mcpAuth: "off" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({})), { nexted: true, statusCode: null });
  });

  // oauth ohne Token -> 401 (offline: verifyOauth liefert deny401 VOR getJwks, kein Netz)
  await withMcpConfig({ mcpAuth: "oauth" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({})), { nexted: false, statusCode: 401 });
  });

  // token: korrektes/falsches/fehlendes Bearer
  await withMcpConfig({ mcpAuth: "token", mcpAuthToken: "t0p" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({ auth: "Bearer t0p" })), {
      nexted: true,
      statusCode: null,
    });
    assert.deepEqual(await runMcpAuth(reqWith({ auth: "Bearer nope" })), {
      nexted: false,
      statusCode: 401,
    });
    assert.deepEqual(await runMcpAuth(reqWith({})), { nexted: false, statusCode: 401 });
  });

  // token-Modus OHNE gesetztes Token -> 401 (verlangt trotzdem eines, kein Fallback)
  await withMcpConfig({ mcpAuth: "token", mcpAuthToken: "" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({})), { nexted: false, statusCode: 401 });
  });

  // Legacy ("") mit statischem Token -> dieselbe safeEqual-Pruefung wie Modus "token"
  await withMcpConfig({ mcpAuth: "", mcpAuthToken: "leg" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({ auth: "Bearer leg" })), {
      nexted: true,
      statusCode: null,
    });
    assert.deepEqual(await runMcpAuth(reqWith({ auth: "Bearer x" })), {
      nexted: false,
      statusCode: 401,
    });
  });
});
