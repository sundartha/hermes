import { test } from "node:test";
import assert from "node:assert/strict";

import { DEPLOY_TOKEN_MIN_LENGTH } from "../src/routes/intern-anrufe-laufend.js";

const RICHTIGES_TOKEN = "r".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const DEPLOY_TOKEN_VARIABLE = "HERMES_DEPLOY_TOKEN";
let konfigurationsZaehler = 0;

async function deployTokenDerKonfiguration(umgebungswert) {
  const gesichert = process.env[DEPLOY_TOKEN_VARIABLE];
  konfigurationsZaehler += 1;
  try {
    if (umgebungswert === undefined) delete process.env[DEPLOY_TOKEN_VARIABLE];
    else process.env[DEPLOY_TOKEN_VARIABLE] = umgebungswert;
    const frisch = await import(`../src/config.js?paket15-deploy-token-${konfigurationsZaehler}`);
    return frisch.config.auth.deployToken;
  } finally {
    if (gesichert === undefined) delete process.env[DEPLOY_TOKEN_VARIABLE];
    else process.env[DEPLOY_TOKEN_VARIABLE] = gesichert;
  }
}

test("Paket 15: die Konfiguration liefert das gesetzte Deploy-Token unverändert", async () => {
  assert.equal(await deployTokenDerKonfiguration(RICHTIGES_TOKEN), RICHTIGES_TOKEN);
});

test("Paket 15: die Konfiguration schneidet Leerzeichen und Zeilenumbruch um das Deploy-Token ab", async () => {
  assert.equal(await deployTokenDerKonfiguration(`  ${RICHTIGES_TOKEN}\n`), RICHTIGES_TOKEN);
});

test("Paket 15: ein leeres oder fehlendes Deploy-Token wird zur leeren Zeichenkette", async () => {
  assert.equal(await deployTokenDerKonfiguration(""), "");
  assert.equal(await deployTokenDerKonfiguration("  \n"), "");
  assert.equal(await deployTokenDerKonfiguration(undefined), "");
});

const SCHLUESSEL_DER_ANMELDE_KONFIGURATION = Object.freeze([
  "mcpAuthToken",
  "mcpAuth",
  "oauthIssuerUrl",
  "oauthAudience",
  "sessionSecret",
  "oidcClientId",
  "oidcClientSecret",
  "workosApiBase",
  "workosManagementApiKey",
  "adminEmails",
  "loginRateLimitPerMin",
  "sessionTtlSeconds",
  "loginCookieTtlSeconds",
  "dashboardPassword",
  "ownerIdpSubject",
  "devLoginEnabled",
  "callConfirmationSecret",
  "deployToken",
]);

test("Paket 15: die Anmelde-Konfiguration bietet genau diese Schlüssel an, darunter deployToken", async () => {
  const { config } = await import("../src/config.js");
  assert.deepEqual(Object.keys(config.auth), SCHLUESSEL_DER_ANMELDE_KONFIGURATION);
});
