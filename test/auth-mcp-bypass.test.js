import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { legacyLocalBypassAllowed, makeMcpAuth } from "../src/auth.js";
import { makeConfigOverrides } from "./helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);
const ERLAUBT = () => ({ allowed: true, retryAfterS: 0 });
const mcpAuth = makeMcpAuth({ ablehnungsDrossel: ERLAUBT, ipSperre: ERLAUBT });

const LOCAL = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const reqWith = ({ remoteAddress = "203.0.113.7", auth } = {}) => ({
  socket: { remoteAddress },
  headers: auth ? { authorization: auth } : {},
});
const reqFrom = (remoteAddress) => reqWith({ remoteAddress });

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

function withMcpConfig(overrides, fn) {
  return withConfigOverrides({ mcpAuth: "", mcpAuthToken: "", isProduction: false, ...overrides }, fn);
}

test("AM1: mcpAuth - Produktions-Gate kippt localhost-Legacy-Bypass auf 401", async () => {
  await withMcpConfig({ isProduction: true, mcpAuth: "", mcpAuthToken: "" }, async () => {
    let nexted = false;
    const res = fakeRes();
    await mcpAuth(reqFrom("127.0.0.1"), res, () => {
      nexted = true;
    });
    assert.equal(nexted, false, "kein next() in Produktion");
    assert.equal(res.statusCode, 401);

    config.server.isProduction = false;
    let nexted2 = false;
    const res2 = fakeRes();
    await mcpAuth(reqFrom("127.0.0.1"), res2, () => {
      nexted2 = true;
    });
    assert.equal(nexted2, true, "ausserhalb Produktion Bypass wie bisher");
    assert.equal(res2.statusCode, null);
  });
});

async function runMcpAuth(req) {
  let nexted = false;
  const res = fakeRes();
  await mcpAuth(req, res, () => {
    nexted = true;
  });
  return { nexted, statusCode: res.statusCode };
}

test("PA-17: mcpAuth Modus-Matrix (off/oauth/token/legacy) - Verzweigung unveraendert", async () => {
  await withMcpConfig({ mcpAuth: "off" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({})), { nexted: true, statusCode: null });
  });

  await withMcpConfig({ mcpAuth: "oauth" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({})), { nexted: false, statusCode: 401 });
  });

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

  await withMcpConfig({ mcpAuth: "token", mcpAuthToken: "" }, async () => {
    assert.deepEqual(await runMcpAuth(reqWith({})), { nexted: false, statusCode: 401 });
  });

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
