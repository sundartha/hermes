import assert from "node:assert/strict";
import { test } from "node:test";

import { SESSION_COOKIE_NAME, signValue } from "../../src/web-auth.js";
import { anmelden, startHermesMitAnmeldung } from "./hermes-mit-anmeldung.js";

const STATE_PATH = "/api/self-service/state";
const SETTINGS_PATH = "/api/self-service/settings";
const FREMDER_SIGNIERWERT = "fremd";
const ALLOWED_NAME = "Probe";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_CONFLICT = 409;

function sessionIdOf(cookie) {
  const signed = decodeURIComponent(cookie.slice(SESSION_COOKIE_NAME.length + 1));
  return signed.slice(0, signed.lastIndexOf("."));
}

function forgedCookies(cookie) {
  const sessionId = sessionIdOf(cookie);
  const withValue = (value) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`;
  return {
    "fremder Schlüssel": withValue(signValue(sessionId, FREMDER_SIGNIERWERT)),
    "ohne Signatur": withValue(sessionId),
    "erfundene Sitzung": withValue(`${sessionId}x.${cookie.split(".").at(-1)}`),
  };
}

function postSettings(hermes, cookie, patch) {
  return fetch(`${hermes.url}${SETTINGS_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(patch),
  });
}

test("SG-23 Anfrage mit manipuliertem Sitzungs-Cookie wird abgelehnt", async (context) => {
  const hermes = await startHermesMitAnmeldung(context);
  const cookie = await anmelden(hermes);
  const genuine = await fetch(`${hermes.url}${STATE_PATH}`, { headers: { Cookie: cookie } });
  assert.equal(genuine.status, HTTP_OK);
  for (const [variant, forged] of Object.entries(forgedCookies(cookie))) {
    const response = await fetch(`${hermes.url}${STATE_PATH}`, { headers: { Cookie: forged } });
    assert.equal(response.status, HTTP_UNAUTHORIZED, variant);
  }
});

test("SG-24 Einstellungs-Aufruf mit gesperrtem Feld ändert nichts", async (context) => {
  const hermes = await startHermesMitAnmeldung(context);
  const cookie = await anmelden(hermes);
  const before = structuredClone(hermes.store.tenantContext(hermes.tenantId).settings);
  const locked = await postSettings(hermes, cookie, { country: "US" });
  assert.equal(locked.status, HTTP_CONFLICT);
  const escalation = { allowBankData: true, allowSummaries: false, disclosureSentence: "" };
  const mixed = await postSettings(hermes, cookie, { ...escalation, agentName: ALLOWED_NAME });
  assert.equal(mixed.status, HTTP_OK);
  const after = hermes.store.tenantContext(hermes.tenantId).settings;
  assert.deepEqual(after, { ...before, agentName: ALLOWED_NAME });
});
