import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONFIRMATION_CODE_LENGTH,
  CONFIRMATION_CODE_ALPHABET,
  CONFIRMATION_WINDOW_MS,
  CONFIRMATION_SECRET_MIN_LENGTH,
  deriveConfirmationKey,
  canonicalCallRequest,
  issueConfirmationCode,
  verifyConfirmationCode,
} from "../src/call-confirmation.js";

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

test("falscher Code wird abgelehnt", () => {
  const canonical = canonicalCallRequest({ to: argsFixture().to, args: argsFixture() });
  assert.equal(
    verifyConfirmationCode({ key: KEY, tenantId: "t1", canonical, code: "ZZZZZZ", nowMs: NOW }),
    false,
  );
});
