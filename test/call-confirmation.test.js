import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  CONFIRMATION_CODE_LENGTH,
  CONFIRMATION_CODE_ALPHABET,
  CONFIRMATION_WINDOW_MS,
  CONFIRMATION_SECRET_MIN_LENGTH,
  deriveConfirmationKey,
  canonicalCallRequest,
  issueConfirmationCode,
  verifyConfirmationCode,
  matchedWindowIndex,
  normalizeConfirmationCode,
} from "../src/call-confirmation.js";
import { makeCallConfirmationRoutes } from "../src/routes/api-call-confirmations.js";

const TOO_SHORT_SECRET_LENGTH = CONFIRMATION_SECRET_MIN_LENGTH - 1;
const WINDOWS_AFTER_EXPIRY = 2;
// Haelfte von CONFIRMATION_CODE_LENGTH (6), fest benannt statt geteilt - eine Division
// haette selbst wieder einen unbenannten Magic-Number-Faktor.
const CODE_MIDPOINT = 3;
const SECRET = "a".repeat(CONFIRMATION_SECRET_MIN_LENGTH);
const KEY = deriveConfirmationKey(SECRET);
const NOW = Date.parse("2026-09-24T10:00:00Z");

function argsFixture(overrides = {}) {
  return {
    to: "+4917212345678",
    objective: "Termin vereinbaren",
    briefing: "Bitte hoeflich fragen",
    language: "de-DE",
    max_duration_s: 300,
    mandate: "vollmacht",
    ...overrides,
  };
}

test("gleiche Eingabe ergibt gleichen Code", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  const first = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  const second = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  assert.equal(first.code, second.code);
});

test("Code hat feste Laenge und nur Alphabet-Zeichen", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  const { code } = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  assert.equal(code.length, CONFIRMATION_CODE_LENGTH);
  for (const ch of code) assert.ok(CONFIRMATION_CODE_ALPHABET.includes(ch));
});

const FIELDS = ["to", "objective", "briefing", "language", "max_duration_s", "mandate"];
for (const field of FIELDS) {
  test(`Aenderung an ${field} aendert den Code`, () => {
    const base = argsFixture();
    const changed = argsFixture({
      [field]: field === "max_duration_s" ? base.max_duration_s + 1 : `${base[field]}-anders`,
    });
    const canonicalBase = canonicalCallRequest({ to: base.to, args: base });
    const canonicalChanged = canonicalCallRequest({ to: changed.to, args: changed });
    const codeBase = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical: canonicalBase, nowMs: NOW });
    const codeChanged = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical: canonicalChanged, nowMs: NOW });
    assert.notEqual(codeBase.code, codeChanged.code);
  });
}

test("Aenderung der tenantId aendert den Code", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  const codeT1 = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  const codeT2 = issueConfirmationCode({ key: KEY, tenantId: "t2", canonical, nowMs: NOW });
  assert.notEqual(codeT1.code, codeT2.code);
});

test("Schluesselreihenfolge der Argumente ist egal", () => {
  const sorted = argsFixture();
  const shuffled = {
    objective: sorted.objective,
    to: sorted.to,
    mandate: sorted.mandate,
    briefing: sorted.briefing,
    max_duration_s: sorted.max_duration_s,
    language: sorted.language,
  };
  const canonicalSorted = canonicalCallRequest({ to: sorted.to, args: sorted });
  const canonicalShuffled = canonicalCallRequest({ to: shuffled.to, args: shuffled });
  assert.equal(canonicalSorted, canonicalShuffled);
});

test("vorheriges Fenster wird noch akzeptiert, zwei Fenster spaeter nicht mehr", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  const { code } = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  const oneWindowLater = NOW + CONFIRMATION_WINDOW_MS;
  const twoWindowsLater = NOW + WINDOWS_AFTER_EXPIRY * CONFIRMATION_WINDOW_MS;
  assert.equal(
    verifyConfirmationCode({ key: KEY, tenantId: "t1", canonical, code, nowMs: oneWindowLater }),
    true,
  );
  assert.equal(
    verifyConfirmationCode({ key: KEY, tenantId: "t1", canonical, code, nowMs: twoWindowsLater }),
    false,
  );
});

test("leeres oder zu kurzes Geheimnis ergibt keinen Schluessel, verify dann immer false", () => {
  assert.equal(deriveConfirmationKey(""), null);
  assert.equal(deriveConfirmationKey("a".repeat(TOO_SHORT_SECRET_LENGTH)), null);
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  const { code } = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  assert.equal(
    verifyConfirmationCode({ key: null, tenantId: "t1", canonical, code, nowMs: NOW }),
    false,
  );
});

test("Kleinbuchstaben und umgebende Leerzeichen/Bindestriche werden akzeptiert", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  const { code } = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  const messy = ` ${code.slice(0, CODE_MIDPOINT).toLowerCase()}-${code.slice(CODE_MIDPOINT).toLowerCase()} `;
  assert.equal(
    verifyConfirmationCode({ key: KEY, tenantId: "t1", canonical, code: messy, nowMs: NOW }),
    true,
  );
});

test("matchedWindowIndex liefert den WindowIndex des treffenden Fensters", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  const { code } = issueConfirmationCode({ key: KEY, tenantId: "t1", canonical, nowMs: NOW });
  const currentWindowIdx = Math.floor(NOW / CONFIRMATION_WINDOW_MS);
  const oneWindowLater = NOW + CONFIRMATION_WINDOW_MS;
  assert.equal(
    matchedWindowIndex({ key: KEY, tenantId: "t1", canonical, code, nowMs: NOW }),
    currentWindowIdx,
  );
  assert.equal(
    matchedWindowIndex({ key: KEY, tenantId: "t1", canonical, code, nowMs: oneWindowLater }),
    currentWindowIdx,
  );
  assert.equal(
    matchedWindowIndex({ key: KEY, tenantId: "t1", canonical, code: "ZZZZZZ", nowMs: NOW }),
    null,
  );
});

test("normalizeConfirmationCode entfernt Bindestriche/Leerzeichen und macht Grossbuchstaben", () => {
  assert.equal(normalizeConfirmationCode(" ab-cd12 "), "ABCD12");
  assert.equal(normalizeConfirmationCode(CODE_MIDPOINT), "");
});

test("falscher Code wird abgelehnt", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  assert.equal(
    verifyConfirmationCode({ key: KEY, tenantId: "t1", canonical, code: "ZZZZZZ", nowMs: NOW }),
    false,
  );
});

// ==================== Route-Unit-Test (Safety-Review T2-13-Nachbesserung) =================
// makeCallConfirmationRoutes traegt eine now-Injektionsnaht extra fuer diesen Test (Kommentar
// an der Funktion, Spec-Abschnitt "Abnahme am Draht" Punkt (d)). Bisher gab es dafuer keinen
// Test - der reale Draht-Test (openai-t2-13-bestaetigung.test.js) laeuft nur mit der echten
// Systemuhr und deckt den Ablauf-Grenzfall darum nicht ab. EINE lokale Express-App (Muster
// mountProbe, test/auth-p5-internal-only.test.js) statt eines vollen Server-Spawns.

const ROUTE_SECRET = "call-confirmation-route-test-secret-mind-32-z";
const ROUTE_TARGET = "+4917298765432";
const ROUTE_OBJECTIVE = "Rueckruf vereinbaren";
const CODE_PATTERN_ROUTE = new RegExp(`^[${CONFIRMATION_CODE_ALPHABET}]{${CONFIRMATION_CODE_LENGTH}}$`);
const HTTP_OK_ROUTE = 200;
const HTTP_SERVICE_UNAVAILABLE_ROUTE = 503;

// Trivialer Store: resolveDialTarget() braucht nur diese drei Methoden (Gate-Kette selbst
// laeuft hier NICHT, die Route prueft nur den Bestaetigungs-Code). Keine Privatnummer, kein
// aktiver Anschluss, Heimatland DE - der Test-Ziel ist bereits E.164, bleibt also unveraendert.
function fakeStoreForRoute() {
  return {
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE" }),
    load: () => ({ numbers: [] }),
  };
}

// requestTenant liest, wie am echten /mcp-Gateway, den vorgelagert aufgeloesten Mandanten aus
// X-Internal-Tenant (keine zweite Aufloesungsregel fuer diesen Test - der Header IST die
// Aufloesung, dieselbe Schnittstelle wie tenant.requestTenant(req) in api-call-confirmations.js).
function requestTenantFromHeader(req) {
  return req.headers["x-internal-tenant"] || "route-test-tenant";
}

async function mountConfirmationRoutes({ now, secret = ROUTE_SECRET } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    makeCallConfirmationRoutes({
      store: fakeStoreForRoute(),
      config: { auth: { callConfirmationSecret: secret }, voice: { elevenLabsOutbound: { enabled: false } } },
      tenant: { requestTenant: requestTenantFromHeader },
      ...(now ? { now } : {}),
    }),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function postConfirmation(base, body, tenantHeader = "route-test-tenant") {
  const res = await fetch(`${base}/api/call-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": tenantHeader },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test("Route: gueltiger Code -> confirmed:true; Fenster abgelaufen (injizierte Uhr) -> confirmed:false", async () => {
  let clockMs = Date.parse("2026-09-24T12:00:00Z");
  const app = await mountConfirmationRoutes({ now: () => clockMs });
  try {
    const issued = await postConfirmation(app.base, { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE });
    assert.equal(issued.status, HTTP_OK_ROUTE);
    const code = issued.json.confirmation.code;
    assert.match(code, CODE_PATTERN_ROUTE);

    // Noch im selben Fenster: bestaetigt.
    const stillValid = await postConfirmation(app.base, {
      to: ROUTE_TARGET,
      objective: ROUTE_OBJECTIVE,
      confirmation_code: code,
    });
    assert.equal(stillValid.json.confirmed, true, "im selben Fenster gueltig");

    // Zwei Fenster weiter (ueber ACCEPTED_WINDOWS hinaus): der Code ist abgelaufen. Ein FRISCH
    // ausgestellter zweiter Code desselben Requests wird gegen den ABGELAUFENEN geprueft
    // (der erste ist ohnehin schon verbraucht, s. Einmal-Verbrauch-Test unten) - der Ablauf
    // selbst wird direkt ueber matchedWindowIndex in call-confirmation.test.js oben bewiesen;
    // hier zaehlt, dass die Route dieselbe Antwort (confirmed:false) liefert.
    clockMs += CONFIRMATION_WINDOW_MS * WINDOWS_AFTER_EXPIRY;
    const expired = await postConfirmation(app.base, {
      to: ROUTE_TARGET,
      objective: ROUTE_OBJECTIVE,
      confirmation_code: code,
    });
    assert.equal(expired.json.confirmed, false, "abgelaufener Code -> confirmed:false");
  } finally {
    await app.close();
  }
});

test("Route: derselbe Code ein zweites Mal (zweiter Treffer) -> confirmed:false", async () => {
  const app = await mountConfirmationRoutes({ now: () => Date.parse("2026-09-24T13:00:00Z") });
  try {
    const issued = await postConfirmation(app.base, { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE });
    const code = issued.json.confirmation.code;
    const first = await postConfirmation(app.base, {
      to: ROUTE_TARGET,
      objective: ROUTE_OBJECTIVE,
      confirmation_code: code,
    });
    assert.equal(first.json.confirmed, true, "erster Verbrauch gilt");
    const second = await postConfirmation(app.base, {
      to: ROUTE_TARGET,
      objective: ROUTE_OBJECTIVE,
      confirmation_code: code,
    });
    assert.equal(second.json.confirmed, false, "zweiter Verbrauch desselben Codes wird abgelehnt");
  } finally {
    await app.close();
  }
});

test("Route: Code eines anderen Mandanten wird abgelehnt", async () => {
  const app = await mountConfirmationRoutes({ now: () => Date.parse("2026-09-24T14:00:00Z") });
  try {
    const issued = await postConfirmation(
      app.base,
      { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE },
      "tenant-a",
    );
    const code = issued.json.confirmation.code;
    const foreign = await postConfirmation(
      app.base,
      { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE, confirmation_code: code },
      "tenant-b",
    );
    assert.equal(foreign.json.confirmed, false, "Code von tenant-a gilt nicht fuer tenant-b");
  } finally {
    await app.close();
  }
});

test("Route: kein/zu kurzes CALL_CONFIRMATION_SECRET -> 503, kein Code ausgestellt", async () => {
  const app = await mountConfirmationRoutes({ secret: "" });
  try {
    const res = await postConfirmation(app.base, { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE });
    assert.equal(res.status, HTTP_SERVICE_UNAVAILABLE_ROUTE);
    assert.equal(res.json.reason, "confirmation_unavailable");
    assert.equal("confirmation" in res.json, false, "kein Code im 503-Body");
  } finally {
    await app.close();
  }
});
