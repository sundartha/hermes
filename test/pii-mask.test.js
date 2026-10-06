import { test } from "node:test";
import assert from "node:assert/strict";
import { maskNumber, hashEmail } from "../src/util.js";

test("maskNumber: letzte 4 Ziffern sichtbar + Korrelations-Hash, kein Vollwert", () => {
  const masked = maskNumber("+491701234567");
  assert.match(masked, /^\*\*\*4567#[0-9a-f]{6}$/, "Format ***<last4>#<hash6>");
  assert.ok(!masked.includes("491701234"), "der Vollwert darf nicht im Token stehen");
});

test("maskNumber: deterministisch (gleiche Nummer -> gleiches Token)", () => {
  assert.equal(maskNumber("+491701234567"), maskNumber("+491701234567"));
});

test("maskNumber: verschiedene Nummern -> verschiedene Tokens", () => {
  assert.notEqual(maskNumber("+491701234567"), maskNumber("+499991234567"));
});

test("maskNumber: leer/null/undefined -> '-'", () => {
  assert.equal(maskNumber(""), "-");
  assert.equal(maskNumber(null), "-");
  assert.equal(maskNumber(undefined), "-");
  assert.equal(maskNumber("   "), "-");
});

test("hashEmail: 8 Hex-Stellen, kein Klartext", () => {
  const h = hashEmail("alice@team.test");
  assert.match(h, /^[0-9a-f]{8}$/, "genau 8 Hex-Stellen");
  assert.ok(!h.includes("alice"), "kein Klartext-Local-Part");
  assert.ok(!h.includes("@"), "kein @ -> keine Adresse im Token");
});

test("hashEmail: deterministisch und case-/whitespace-normalisiert", () => {
  const base = hashEmail("alice@team.test");
  assert.equal(hashEmail("alice@team.test"), base);
  assert.equal(hashEmail("Alice@Team.Test"), base, "Gross-/Kleinschreibung egal");
  assert.equal(hashEmail("  alice@team.test  "), base, "umschliessender Whitespace egal");
});

test("hashEmail: verschiedene Adressen -> verschiedene Tokens", () => {
  assert.notEqual(hashEmail("alice@team.test"), hashEmail("bob@team.test"));
});

test("hashEmail: leer/null/undefined -> '-'", () => {
  assert.equal(hashEmail(""), "-");
  assert.equal(hashEmail(null), "-");
  assert.equal(hashEmail(undefined), "-");
});
