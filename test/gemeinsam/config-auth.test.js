import { test } from "node:test";
import assert from "node:assert/strict";

import { DEPLOY_TOKEN_MIN_LENGTH } from "../../src/routes/intern-anrufe-laufend.js";

const RICHTIGES_TOKEN = "r".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const DEPLOY_TOKEN_VARIABLE = "HERMES_DEPLOY_TOKEN";

async function deployTokenDerKonfiguration(umgebungswert, frischLaden) {
  const gesichert = process.env[DEPLOY_TOKEN_VARIABLE];
  try {
    if (umgebungswert === undefined) delete process.env[DEPLOY_TOKEN_VARIABLE];
    else process.env[DEPLOY_TOKEN_VARIABLE] = umgebungswert;
    const frisch = await frischLaden();
    return frisch.config.auth.deployToken;
  } finally {
    if (gesichert === undefined) delete process.env[DEPLOY_TOKEN_VARIABLE];
    else process.env[DEPLOY_TOKEN_VARIABLE] = gesichert;
  }
}

test("Paket 15: die Konfiguration liefert das gesetzte Deploy-Token unverändert", async () => {
  assert.equal(await deployTokenDerKonfiguration(RICHTIGES_TOKEN, () => import("../../src/config.js?paket15-deploy-token-gesetzt")), RICHTIGES_TOKEN);
});

test("Paket 15: die Konfiguration schneidet Leerzeichen und Zeilenumbruch um das Deploy-Token ab", async () => {
  assert.equal(await deployTokenDerKonfiguration(`  ${RICHTIGES_TOKEN}\n`, () => import("../../src/config.js?paket15-deploy-token-getrimmt")), RICHTIGES_TOKEN);
});

test("Paket 15: ein leeres oder fehlendes Deploy-Token wird zur leeren Zeichenkette", async () => {
  assert.equal(await deployTokenDerKonfiguration("", () => import("../../src/config.js?paket15-deploy-token-leer")), "");
  assert.equal(await deployTokenDerKonfiguration("  \n", () => import("../../src/config.js?paket15-deploy-token-nur-leerzeichen")), "");
  assert.equal(await deployTokenDerKonfiguration(undefined, () => import("../../src/config.js?paket15-deploy-token-ungesetzt")), "");
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
  "webhookZustellungSecret",
  "deployToken",
  "statusToken",
]);

test("Paket 15: die Anmelde-Konfiguration bietet genau diese Schlüssel an, darunter deployToken", async () => {
  const { config } = await import("../../src/config.js");
  assert.deepEqual(Object.keys(config.auth), SCHLUESSEL_DER_ANMELDE_KONFIGURATION);
});

const STATUS_TOKEN_VARIABLE = "HERMES_STATUS_TOKEN";
const RICHTIGES_STATUS_TOKEN = "s".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const ANMELDE_TOKENS = Object.freeze(["deployToken", "statusToken"]);

function setzeUmgebung(variable, wert) {
  if (wert === undefined) delete process.env[variable];
  else process.env[variable] = wert;
}

async function anmeldeTokensDerKonfiguration({ deployToken, statusToken }, frischLaden) {
  const gesichert = {
    [DEPLOY_TOKEN_VARIABLE]: process.env[DEPLOY_TOKEN_VARIABLE],
    [STATUS_TOKEN_VARIABLE]: process.env[STATUS_TOKEN_VARIABLE],
  };
  try {
    setzeUmgebung(DEPLOY_TOKEN_VARIABLE, deployToken);
    setzeUmgebung(STATUS_TOKEN_VARIABLE, statusToken);
    const frisch = await frischLaden();
    return Object.fromEntries(
      Object.entries(frisch.config.auth).filter(([schluessel]) =>
        ANMELDE_TOKENS.includes(schluessel),
      ),
    );
  } finally {
    for (const [variable, wert] of Object.entries(gesichert)) setzeUmgebung(variable, wert);
  }
}

test("a2: die Konfiguration liefert das gesetzte Status-Token unverändert unter statusToken", async () => {
  assert.deepEqual(
    await anmeldeTokensDerKonfiguration(
      { deployToken: undefined, statusToken: RICHTIGES_STATUS_TOKEN },
      () => import("../../src/config.js?a2-status-token-gesetzt"),
    ),
    { deployToken: "", statusToken: RICHTIGES_STATUS_TOKEN },
  );
});

test("a2: die Konfiguration schneidet Leerzeichen und Zeilenumbruch um das Status-Token ab", async () => {
  assert.deepEqual(
    await anmeldeTokensDerKonfiguration(
      { deployToken: undefined, statusToken: `  ${RICHTIGES_STATUS_TOKEN}\n` },
      () => import("../../src/config.js?a2-status-token-getrimmt"),
    ),
    { deployToken: "", statusToken: RICHTIGES_STATUS_TOKEN },
  );
});

test("a2: ein leeres Status-Token wird zur leeren Zeichenkette", async () => {
  assert.deepEqual(
    await anmeldeTokensDerKonfiguration(
      { deployToken: undefined, statusToken: "" },
      () => import("../../src/config.js?a2-status-token-leer"),
    ),
    { deployToken: "", statusToken: "" },
  );
  assert.deepEqual(
    await anmeldeTokensDerKonfiguration(
      { deployToken: undefined, statusToken: "  \n" },
      () => import("../../src/config.js?a2-status-token-nur-leerzeichen"),
    ),
    { deployToken: "", statusToken: "" },
  );
});

test("a2: Status-Token und Deploy-Token stehen getrennt nebeneinander, keiner überschreibt den anderen", async () => {
  assert.deepEqual(
    await anmeldeTokensDerKonfiguration(
      { deployToken: RICHTIGES_TOKEN, statusToken: RICHTIGES_STATUS_TOKEN },
      () => import("../../src/config.js?a2-status-und-deploy-token"),
    ),
    { deployToken: RICHTIGES_TOKEN, statusToken: RICHTIGES_STATUS_TOKEN },
  );
});

test("[NIE1] ohne HERMES_STATUS_TOKEN bleibt statusToken leer, auch wenn ein Deploy-Token gesetzt ist", async () => {
  const mitDeployToken = await anmeldeTokensDerKonfiguration(
    { deployToken: RICHTIGES_TOKEN, statusToken: undefined },
    () => import("../../src/config.js?nie1-nur-deploy-token"),
  );
  assert.equal(mitDeployToken.statusToken, "");
  assert.equal(mitDeployToken.deployToken, RICHTIGES_TOKEN);

  const ganzOhne = await anmeldeTokensDerKonfiguration(
    { deployToken: undefined, statusToken: undefined },
    () => import("../../src/config.js?nie1-ohne-tokens"),
  );
  assert.equal(ganzOhne.statusToken, "");
});
