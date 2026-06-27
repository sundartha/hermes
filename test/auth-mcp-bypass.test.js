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
