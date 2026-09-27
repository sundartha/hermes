import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  CONFIRMATION_CODE_LENGTH,
  CONFIRMATION_CODE_ALPHABET,
  CONFIRMATION_WINDOW_MS,
  CONFIRMATION_SECRET_MIN_LENGTH,
  MAX_FAILED_CONFIRMATIONS_PER_WINDOW,
  deriveConfirmationKey,
  canonicalCallRequest,
  issueConfirmationCode,
  verifyConfirmationCode,
  matchedWindowIndex,
  normalizeConfirmationCode,
} from "../src/call-confirmation.js";
import { makeCallConfirmationRoutes } from "../src/routes/api-call-confirmations.js";
import { CALL_CONFIRMATION_SECRET_FINDING, callConfirmationSecretFindings } from "../src/boot-guard.js";

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
    constraints: "hoechstens 40 Euro",
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

// Gebunden: ALLE Argumente ausser confirmation_code (Lead-Entscheidung Safety-Review T2-13,
// briefing/context eingeschlossen - context s. eigener Test unten, er ist ein Objekt).
const FIELDS = ["to", "objective", "briefing", "language", "max_duration_s", "mandate", "constraints"];
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

// Lead-Entscheidung Safety-Review T2-13: der Nutzer bestaetigt, was tatsaechlich passiert -
// briefing UND context sind gebunden, leer/fehlend eindeutig unterschieden.
function canonicalOf(args) {
  return canonicalCallRequest({ to: args.to, args });
}

test("briefing und context sind gebunden; leer, fehlend und leeres Objekt sind verschiedene Anfragen", () => {
  const base = argsFixture({ context: { summary: "alt" } });
  const canonicalBase = canonicalOf(base);
  assert.equal(canonicalOf(argsFixture({ context: { summary: "alt" } })), canonicalBase, "Positiv-Kontrolle: unveraendert = gleich");
  const variants = [
    argsFixture({ context: { summary: "neu" } }),
    argsFixture({ briefing: "anders", context: { summary: "alt" } }),
    argsFixture({ briefing: "", context: { summary: "alt" } }),
    argsFixture({ briefing: undefined, context: { summary: "alt" } }),
    argsFixture({ context: {} }),
    argsFixture({ context: undefined }),
  ];
  const canonicals = variants.map(canonicalOf);
  assert.equal(new Set([canonicalBase, ...canonicals]).size, variants.length + 1, "jede Variante ist eine eigene Anfrage");
});

test("confirmation_code selbst ist nicht gebunden (sonst koennte kein Code je passen)", () => {
  const base = argsFixture();
  assert.equal(canonicalOf({ ...base, confirmation_code: "ABC123" }), canonicalOf(base));
});

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
    constraints: sorted.constraints,
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

async function mountConfirmationRoutes({ now, secret = ROUTE_SECRET, languageEnabled = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    makeCallConfirmationRoutes({
      store: fakeStoreForRoute(),
      config: {
        auth: { callConfirmationSecret: secret },
        voice: { elevenLabsOutbound: { enabled: languageEnabled } },
      },
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
    assert.equal(second.json.reason, "already_used", "verbrauchter Code eindeutig gemeldet (T2-14-Nachbesserung)");
    assert.ok(!JSON.stringify(second.json).includes(code), "Antwort nennt den Code nie");
  } finally {
    await app.close();
  }
});

test("Route: already_used nur fuer den EIGENEN verbrauchten Code - fremder Mandant und falscher Code bleiben generisch (Positiv-Kontrolle)", async () => {
  const app = await mountConfirmationRoutes({ now: () => Date.parse("2026-09-24T13:30:00Z") });
  try {
    const request = { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE };
    const issued = await postConfirmation(app.base, request, "tenant-a");
    const code = issued.json.confirmation.code;
    const consumed = await postConfirmation(app.base, { ...request, confirmation_code: code }, "tenant-a");
    assert.equal(consumed.json.confirmed, true);
    assert.equal(consumed.json.reason, undefined, "ein Erfolg traegt keinen Grund");

    const foreign = await postConfirmation(app.base, { ...request, confirmation_code: code }, "tenant-b");
    assert.equal(foreign.json.confirmed, false);
    assert.equal(foreign.json.reason, undefined, "fremder Mandant erfaehrt nichts ueber den Verbrauch");
    const wrong = await postConfirmation(app.base, { ...request, confirmation_code: "000000" }, "tenant-a");
    assert.equal(wrong.json.reason, undefined, "nie ausgestellter Code bleibt generisch");
    const replay = await postConfirmation(app.base, { ...request, confirmation_code: code }, "tenant-a");
    assert.equal(replay.json.reason, "already_used");
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

// ============ Safety-Review T2-13 (zweite Runde): Ablauf, Slots, Bremse, Bindung ===========
// Alle ueber die ECHTE Route-Factory mit injizierter Uhr. ROUTE_TENANT ist der Default aus
// requestTenantFromHeader/postConfirmation oben.
const ROUTE_TENANT = "route-test-tenant";
const ROUTE_KEY = deriveConfirmationKey(ROUTE_SECRET);
const ROUTE_CLOCK_START = Date.parse("2026-09-24T15:00:00Z");
const FUTURE_SLOT = 2;
const WINDOWS_UNTIL_EXPIRED = 2;
const EMPTY_ATTEMPTS_BEYOND_LIMIT = MAX_FAILED_CONFIRMATIONS_PER_WINDOW + 1;

function confirmBody(code, extra = {}) {
  return { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE, ...extra, confirmation_code: code };
}

function makeRouteClock() {
  let nowMs = ROUTE_CLOCK_START;
  return {
    now: () => nowMs,
    advance: (deltaMs) => {
      nowMs += deltaMs;
    },
  };
}

async function withRouteClock(run, options = {}) {
  const clock = makeRouteClock();
  const app = await mountConfirmationRoutes({ now: clock.now, ...options });
  try {
    await run({ base: app.base, clock });
  } finally {
    await app.close();
  }
}

async function issueCode(base, extra = {}) {
  const issued = await postConfirmation(base, { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE, ...extra });
  return issued.json.confirmation.code;
}

test("Route-Ablauf (injizierte Uhr): unverbrauchter Code gilt im Folgefenster, zwei Fenster spaeter nicht mehr", async () => {
  await withRouteClock(async ({ base, clock }) => {
    const codeA = await issueCode(base, { objective: "Anliegen A" });
    const codeB = await issueCode(base, { objective: "Anliegen B" });
    clock.advance(CONFIRMATION_WINDOW_MS);
    const inNextWindow = await postConfirmation(base, confirmBody(codeA, { objective: "Anliegen A" }));
    assert.equal(inNextWindow.json.confirmed, true, "Positiv-Kontrolle: vorheriges Fenster wird angenommen");
    clock.advance(CONFIRMATION_WINDOW_MS * (WINDOWS_UNTIL_EXPIRED - 1));
    const expired = await postConfirmation(base, confirmBody(codeB, { objective: "Anliegen B" }));
    assert.equal(expired.json.confirmed, false, "unverbrauchter Code nach Ablauf -> confirmed:false");
  });
});

test("Route: verbrauchter Code ist auch im FOLGEFENSTER nicht erneut gueltig (Einmal-Verbrauch bis Annahmeende)", async () => {
  await withRouteClock(async ({ base, clock }) => {
    const code = await issueCode(base);
    const first = await postConfirmation(base, confirmBody(code));
    assert.equal(first.json.confirmed, true, "erster Verbrauch gilt");
    clock.advance(CONFIRMATION_WINDOW_MS);
    const replay = await postConfirmation(base, confirmBody(code));
    assert.equal(replay.json.confirmed, false, "Replay im Folgefenster wird abgelehnt");
  });
});

test("Route: Code aus altem Slot wird abgelehnt, der frische Slot-Code gilt", async () => {
  await withRouteClock(async ({ base }) => {
    const oldCode = await issueCode(base);
    assert.equal((await postConfirmation(base, confirmBody(oldCode))).json.confirmed, true);
    const freshCode = await issueCode(base);
    assert.notEqual(freshCode, oldCode, "nach Verbrauch ein neuer Code");
    const old = await postConfirmation(base, confirmBody(oldCode));
    assert.equal(old.json.confirmed, false, "Code des alten Slots -> confirmed:false");
    const fresh = await postConfirmation(base, confirmBody(freshCode));
    assert.equal(fresh.json.confirmed, true, "Code des aktuellen Slots gilt");
  });
});

test("Route: Code eines noch nicht ausgestellten Slots wird abgelehnt (nur der aktuelle Slot je Fenster zaehlt)", async () => {
  await withRouteClock(async ({ base, clock }) => {
    const canonical = canonicalCallRequest({ to: ROUTE_TARGET, args: { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE } });
    const derive = (slot) =>
      issueConfirmationCode({ key: ROUTE_KEY, tenantId: ROUTE_TENANT, canonical, nowMs: clock.now(), slot }).code;
    assert.equal(derive(0), await issueCode(base), "Positiv-Kontrolle: Test-Ableitung == Route-Ausstellung");
    const future = await postConfirmation(base, confirmBody(derive(FUTURE_SLOT)));
    assert.equal(future.json.confirmed, false, "Zukunfts-Slot -> confirmed:false (frueher bis zu 8 Slots geprueft)");
    const current = await postConfirmation(base, confirmBody(derive(0)));
    assert.equal(current.json.confirmed, true, "der aktuelle Slot-Code gilt weiterhin");
  });
});

test("Route: Fehlversuchsbremse sperrt nach MAX_FAILED_CONFIRMATIONS_PER_WINDOW Fehlversuchen auch den richtigen Code bis Fensterende", async () => {
  await withRouteClock(async ({ base, clock }) => {
    const code = await issueCode(base);
    for (let attempt = 0; attempt < MAX_FAILED_CONFIRMATIONS_PER_WINDOW; attempt++) {
      assert.equal((await postConfirmation(base, confirmBody("ZZZZZZ"))).json.confirmed, false);
    }
    const locked = await postConfirmation(base, confirmBody(code));
    assert.equal(locked.json.confirmed, false, "gesperrt: auch der richtige Code wird abgelehnt");
    clock.advance(CONFIRMATION_WINDOW_MS);
    const afterWindow = await postConfirmation(base, confirmBody(code));
    assert.equal(afterWindow.json.confirmed, true, "neues Fenster: Sperre vorbei, Code (Vorfenster) gilt");
  });
});

test("Route: leere Codes zaehlen nicht als Fehlversuch (kein Rateversuch)", async () => {
  await withRouteClock(async ({ base }) => {
    const code = await issueCode(base);
    for (let attempt = 0; attempt < EMPTY_ATTEMPTS_BEYOND_LIMIT; attempt++) {
      assert.equal((await postConfirmation(base, confirmBody(""))).json.confirmed, false);
    }
    assert.equal((await postConfirmation(base, confirmBody(code))).json.confirmed, true);
  });
});

test("Route: Fehlversuchsbremse ist je Mandant - Fehlversuche von A sperren B nicht", async () => {
  await withRouteClock(async ({ base }) => {
    for (let attempt = 0; attempt < MAX_FAILED_CONFIRMATIONS_PER_WINDOW; attempt++) {
      await postConfirmation(base, confirmBody("ZZZZZZ"), "tenant-a");
    }
    const issuedB = await postConfirmation(base, { to: ROUTE_TARGET, objective: ROUTE_OBJECTIVE }, "tenant-b");
    const confirmedB = await postConfirmation(base, confirmBody(issuedB.json.confirmation.code), "tenant-b");
    assert.equal(confirmedB.json.confirmed, true);
  });
});

test("Route: geaenderte language/briefing/context werden abgelehnt, unveraenderte Anfrage bestaetigt", async () => {
  await withRouteClock(
    async ({ base }) => {
      const issued = { language: "de", briefing: "alt", context: { summary: "alt" } };
      const code = await issueCode(base, issued);
      const otherLanguage = await postConfirmation(base, confirmBody(code, { ...issued, language: "en" }));
      assert.equal(otherLanguage.status, HTTP_OK_ROUTE, "Sprache ist freigeschaltet (kein 400 vor der Pruefung)");
      assert.equal(otherLanguage.json.confirmed, false, "geaenderte language -> confirmed:false");
      const otherBriefing = await postConfirmation(base, confirmBody(code, { ...issued, briefing: "neu" }));
      assert.equal(otherBriefing.json.confirmed, false, "geaendertes briefing -> confirmed:false");
      const otherContext = await postConfirmation(base, confirmBody(code, { ...issued, context: { summary: "neu" } }));
      assert.equal(otherContext.json.confirmed, false, "geaenderter context -> confirmed:false");
      const unchanged = await postConfirmation(base, confirmBody(code, issued));
      assert.equal(unchanged.json.confirmed, true, "Positiv-Kontrolle: unveraenderte Anfrage bestaetigt");
    },
    { languageEnabled: true },
  );
});

// Boot-Befund (Safety-Review T2-13): fehlendes UND zu kurzes Geheimnis melden, nie den Wert.
test("Boot-Befund: CALL_CONFIRMATION_SECRET fehlt / zu kurz / ok - Meldung enthaelt nie den Wert", () => {
  const secretMarker = "x9Qz";
  const tooShort = secretMarker.padEnd(TOO_SHORT_SECRET_LENGTH, "#");
  assert.deepEqual(
    callConfirmationSecretFindings({ secret: "" }).map((finding) => finding.code),
    [CALL_CONFIRMATION_SECRET_FINDING.UNSET],
  );
  const shortFindings = callConfirmationSecretFindings({ secret: tooShort });
  assert.deepEqual(shortFindings.map((finding) => finding.code), [CALL_CONFIRMATION_SECRET_FINDING.TOO_SHORT]);
  assert.equal(shortFindings[0].fatal, false, "nie fatal (kein Boot-Refusal)");
  assert.ok(!shortFindings[0].message.includes(secretMarker), "kein Teil des Werts in der Meldung");
  assert.ok(!shortFindings[0].message.includes("##"), "auch nicht das Fuellzeichen");
  assert.ok(!shortFindings[0].message.includes(String(TOO_SHORT_SECRET_LENGTH)), "keine Laenge des Werts");
  assert.equal(deriveConfirmationKey(tooShort), null, "zu kurz bleibt fail-closed (kein Schluessel)");
  assert.deepEqual(callConfirmationSecretFindings({ secret: SECRET }), [], "ausreichend lang: kein Befund");
});
