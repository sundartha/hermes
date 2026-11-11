import { test } from "node:test";
import assert from "node:assert/strict";
import * as konfig from "../../src/config.js";

const ISSUER_FAELLE = [
  ["http://evil.example", true],
  ["http://127.0.0.1:8080", false],
  ["http://localhost", false],
  ["http://localhost/pfad", false],
  ["http://[::1]:3000", false],
  ["http://localhost.evil.example", true],
  ["https://issuer.example", false],
  ["", false],
];

test("isInsecureHttpIssuer: nur http ausserhalb von Loopback ist unsicher", () => {
  for (const [url, erwartet] of ISSUER_FAELLE)
    assert.equal(konfig.isInsecureHttpIssuer?.(url), erwartet, url);
});

test("isSelfServiceLive: braucht Self-Service und Multi-Tenant zugleich", () => {
  const tabelle = [
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ];
  for (const [selfServiceEnabled, multiTenant, erwartet] of tabelle)
    assert.equal(konfig.isSelfServiceLive({ tenancy: { selfServiceEnabled, multiTenant } }), erwartet);
});

const SICHERE_KONFIG = {
  server: { publicUrl: "https://agent.test", publicUrlExplicit: true },
  store: { storeBackend: "pg" },
  safety: { skipTwilioSignatureCheck: false },
  auth: { dashboardPassword: "geheim", mcpAuth: "oauth", oauthIssuerUrl: "", oauthAudience: "" },
};

test("productionFootguns: DEV_LOGIN_ENABLED=true aus der Umgebung ist im Hosting ein Befund, sonst nicht", () => {
  const vorher = process.env.DEV_LOGIN_ENABLED;
  try {
    process.env.DEV_LOGIN_ENABLED = "true";
    const befunde = konfig.productionFootguns(SICHERE_KONFIG, true);
    assert.equal(befunde.length, 1);
    assert.match(befunde[0], /DEV_LOGIN_ENABLED=true/);
    assert.deepEqual(konfig.productionFootguns(SICHERE_KONFIG, false), []);
    process.env.DEV_LOGIN_ENABLED = "false";
    assert.deepEqual(konfig.productionFootguns(SICHERE_KONFIG, true), []);
  } finally {
    if (vorher === undefined) delete process.env.DEV_LOGIN_ENABLED;
    else process.env.DEV_LOGIN_ENABLED = vorher;
  }
});

test("productionFootguns und productionAuthHints: ohne Hosting-Erkennung im Test keine Befunde", () => {
  const offen = { ...SICHERE_KONFIG, auth: { ...SICHERE_KONFIG.auth, mcpAuth: "token" } };
  assert.deepEqual(konfig.productionFootguns(offen), []);
  assert.deepEqual(konfig.productionAuthHints(offen), []);
  assert.equal(konfig.productionAuthHints(offen, true).length, 1);
});

test("productionFootguns und productionAuthHints: ohne Konfiguration pruefen sie die echte Konfiguration", () => {
  assert.deepEqual(konfig.productionFootguns(undefined, false), []);
  assert.deepEqual(konfig.productionAuthHints(undefined, false), []);
  const echt = konfig.productionAuthHints(undefined, true);
  assert.equal(echt.length, konfig.config.auth.mcpAuth === "oauth" ? 0 : 1);
});
