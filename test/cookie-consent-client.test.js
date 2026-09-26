// Cookie-Einwilligung, Browser-Seite: die reinen Entscheidungen aus
// apps/web/src/scripts/consent-core.js (Widerruf -> Neuladen, Banner nur bei
// einwilligungspflichtigem Dienst, Kennung und Protokoll-Nutzlast) sowie die
// Naht zum Gateway (Pfad-Spiegel + CSP connect-src der Static Site).
// Offline, kein DOM, kein Build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import {
  CONSENT_VERSION,
  buildConsent,
  logPayload,
  needsReload,
  newConsentId,
  revokedCategories,
  shouldPrompt,
} from "../apps/web/src/scripts/consent-core.js";
import { COOKIE_CONSENT_PATH, parseConsentRecord } from "../src/cookie-consent-log.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW = new Date("2026-09-25T12:00:00.000Z");
const ID = "3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f";
const OTHER_ID = "0b6f1d2c-3e4a-4b5c-9d6e-7f8091a2b3c4";
const ALL = Object.freeze({ statistics: true, marketing: true });
const NONE = Object.freeze({ statistics: false, marketing: false });
const GATED_ONE = 1;

const consentWith = (choice, previous = null) =>
  buildConsent({ choice, previous, id: ID, now: NOW });

test("newConsentId: UUID v4 - mit randomUUID und im getRandomValues-Rueckfall", () => {
  assert.match(newConsentId(webcrypto), UUID_V4);
  const withoutRandomUuid = { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
  assert.match(newConsentId(withoutRandomUuid), UUID_V4);
});

test("buildConsent: Kennung bleibt ueber Aenderung und Widerruf dieselbe", () => {
  const first = buildConsent({ choice: ALL, previous: null, id: ID, now: NOW });
  const revoked = buildConsent({ choice: NONE, previous: first, id: OTHER_ID, now: NOW });
  assert.equal(first.id, ID);
  assert.equal(revoked.id, ID, "ein Widerruf ist Teil derselben Folge, keine neue Person");
  assert.equal(revoked.version, CONSENT_VERSION);
  assert.equal(revoked.necessary, true);
  assert.equal(revoked.ts, NOW.toISOString());
});

test("buildConsent: Altbestand ohne Kennung bekommt beim naechsten Entscheiden eine", () => {
  const legacy = { version: CONSENT_VERSION, ts: NOW.toISOString(), necessary: true, ...ALL };
  assert.equal(
    buildConsent({ choice: NONE, previous: legacy, id: OTHER_ID, now: NOW }).id,
    OTHER_ID,
  );
});

test("logPayload: genau vier Felder - und genau die, die der Gateway annimmt", () => {
  const payload = logPayload(consentWith({ statistics: true }));
  assert.deepEqual(Object.keys(payload).sort(), ["id", "marketing", "statistics", "version"]);
  assert.deepEqual(parseConsentRecord(JSON.stringify(payload)), {
    consentId: ID,
    version: CONSENT_VERSION,
    statistics: true,
    marketing: false,
  });
});

test("revokedCategories: nur, was vorher erlaubt war und jetzt nicht mehr", () => {
  assert.deepEqual(revokedCategories(null, consentWith(NONE)), []);
  assert.deepEqual(revokedCategories(consentWith(ALL), consentWith(NONE)), [
    "statistics",
    "marketing",
  ]);
  assert.deepEqual(revokedCategories(consentWith({ statistics: true }), consentWith(ALL)), []);
});

test("needsReload: Widerruf einer Kategorie mit LAUFENDEM Skript laedt neu, sonst nicht", () => {
  const previous = consentWith(ALL);
  const next = consentWith({ marketing: true });
  assert.equal(needsReload({ previous, next, activated: new Set(["statistics"]) }), true);
  assert.equal(
    needsReload({ previous, next, activated: new Set() }),
    false,
    "nichts geladen -> nichts zu entladen",
  );
  assert.equal(
    needsReload({ previous, next, activated: new Set(["marketing"]) }),
    false,
    "marketing bleibt erlaubt",
  );
  assert.equal(needsReload({ previous: null, next, activated: new Set(["statistics"]) }), false);
});

test("shouldPrompt: Banner ungefragt nur ohne Entscheidung UND mit wartendem Dienst", () => {
  assert.equal(shouldPrompt({ consent: null, gatedScripts: GATED_ONE }), true);
  assert.equal(
    shouldPrompt({ consent: null, gatedScripts: 0 }),
    false,
    "nichts einwilligungspflichtig -> nichts fragen",
  );
  assert.equal(shouldPrompt({ consent: consentWith(NONE), gatedScripts: GATED_ONE }), false);
});

// ---- Naht zum Gateway ---------------------------------------------------------------

const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
const webService = renderYaml.slice(renderYaml.indexOf("name: hermes-web"));
const gatewayOrigin = webService.match(
  /key:\s*PUBLIC_GATEWAY_URL[\s\S]*?value:\s*"?(https:\/\/[^"\s]+)"?/,
)[1];

test("routes.js: COOKIE_CONSENT_URL zeigt auf COOKIE_CONSENT_PATH des Gateways", async () => {
  process.env.PUBLIC_GATEWAY_URL = gatewayOrigin;
  const { COOKIE_CONSENT_URL } = await import("../apps/web/src/lib/routes.js");
  assert.equal(COOKIE_CONSENT_URL, `${gatewayOrigin}${COOKIE_CONSENT_PATH}`);
});

test("render.yaml: CSP der Static Site erlaubt den Beacon an den Gateway (connect-src)", () => {
  const csp = webService.match(/name:\s*Content-Security-Policy\s*\n\s*value:\s*"([^"]+)"/)[1];
  const connectSrc = csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("connect-src"));
  assert.ok(connectSrc, "connect-src fehlt in der CSP");
  assert.ok(
    connectSrc.split(/\s+/).includes(gatewayOrigin),
    `connect-src nennt ${gatewayOrigin} nicht`,
  );
  assert.ok(!connectSrc.includes("*"), "kein Wildcard in connect-src");
});
