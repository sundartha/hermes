import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_TEXTS } from "../src/i18n/gate-texts.js";

const CONFIG_IDENTIFIER = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const ARG_PLACEHOLDER = "<arg>";

function materializeGateTexts() {
  const out = [];
  for (const [language, bundle] of Object.entries(GATE_TEXTS))
    for (const [key, value] of Object.entries(bundle))
      out.push({
        label: `${language}.${key}`,
        text:
          typeof value === "function"
            ? value(...Array.from({ length: value.length }, () => ARG_PLACEHOLDER))
            : value,
      });
  return out;
}

test("P15b/C3: kein Ablehnungstext nennt einen internen Konfigurations-Bezeichner", () => {
  const texts = materializeGateTexts();
  const languages = Object.keys(GATE_TEXTS).length;
  const keys = Object.keys(GATE_TEXTS.de).length;
  assert.equal(texts.length, languages * keys, "jeder Schluessel jeder Sprache wurde geprueft");
  assert.ok(texts.length > 0);
  const hits = texts.filter((t) => CONFIG_IDENTIFIER.test(t.text));
  assert.deepEqual(
    hits.map((h) => `${h.label}: ${h.text.match(CONFIG_IDENTIFIER)[0]}`),
    [],
    "ein Ablehnungstext nennt NIE einen internen Env-/Konfigurationsnamen",
  );
});

test("P15b/C3: das Waechter-Muster trifft legitime Kuerzel NICHT (Kalibrierung)", () => {
  for (const ok of ["KYC", "SMS", "EUR", "E.164", "NaN", "Hermes", "Anruf verweigert."])
    assert.equal(CONFIG_IDENTIFIER.test(ok), false, `${ok} ist kein Konfigurations-Bezeichner`);
  for (const bad of ["ALLOWED_COUNTRY_CODES", "MAX_BUDGET_EUR", "OUTBOUND_FROZEN"])
    assert.equal(CONFIG_IDENTIFIER.test(bad), true, `${bad} muss anschlagen`);
});
