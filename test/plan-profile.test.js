// A1 - Plan->Rechteprofil (reines Datenmodul, KEIN Konsument). Pinnt die
// Mapping-Daten (PLAN_PROFILE + planProfileFor): Vollstaendigkeit je Katalog-Slug
// gegen PROFILE_FIELDS (gegen den stillen DEFAULT_PROFILE-Rueckfall A11), die
// 5.1-Owner-Entscheidung (starter==business), die Toll-Fraud-Invariante und den
// fail-closed Lookup. PROFILE_FIELDS treibt die Coverage generisch (kein
// hardcodiertes Feld-Listing, G5) - faellt spaeter ein Whitelist-Feld dazu, wird
// dieser Test rot, bis das Mapping es traegt.
import test from "node:test";
import assert from "node:assert/strict";
import { planProfileFor, CATALOG_SLUGS } from "../src/plans.js";
import { PROFILE_FIELDS } from "../src/store/defaults.js";

test("jeder Katalog-Slug traegt ALLE PROFILE_FIELDS, kein undefined, kein Fremdfeld", () => {
  const expectedKeys = Object.keys(PROFILE_FIELDS).sort();
  for (const slug of CATALOG_SLUGS) {
    const profile = planProfileFor(slug);
    assert.ok(profile, `${slug}: kein Profil`);
    // Genau die Whitelist-Keys - kein fehlendes (A11) UND kein fremdes (das
    // sanitizeProfile spaeter still ausfiltern wuerde).
    assert.deepEqual(Object.keys(profile).sort(), expectedKeys, `${slug}: Feld-Menge != PROFILE_FIELDS`);
    for (const key of expectedKeys) {
      assert.notEqual(profile[key], undefined, `${slug}.${key} ist undefined`);
    }
  }
});

test("5.1: starter und business sind feld-gleich (nur includedMinutes unterscheidet)", () => {
  assert.deepEqual(planProfileFor("starter"), planProfileFor("business"));
  for (const slug of CATALOG_SLUGS) {
    const profile = planProfileFor(slug);
    assert.equal(profile.allowCalendar, false, `${slug}: allowCalendar != false`);
    assert.equal(profile.allowBooking, false, `${slug}: allowBooking != false`);
    assert.equal(profile.unrestricted, false, `${slug}: unrestricted != false`);
    assert.deepEqual(profile.allowedNumbers, [], `${slug}: allowedNumbers != []`);
    assert.equal(profile.maxCallsPerHour, null, `${slug}: maxCallsPerHour != null`);
  }
});

test("Owner-Entscheidung 2026-08-11: allowConsult ist fuer JEDEN Katalog-Slug true (Kernfunktion, kein Owner-Vorbehalt mehr)", () => {
  for (const slug of CATALOG_SLUGS) {
    const profile = planProfileFor(slug);
    assert.equal(profile.allowConsult, true, `${slug}: allowConsult != true`);
  }
});

test("Owner-Entscheidung 2026-08-11 (P6 Werkzeugwahl): allowLookup ist fuer JEDEN Katalog-Slug true - der Vorbehalt aus AL-P10b ist aufgehoben", () => {
  for (const slug of CATALOG_SLUGS) {
    const profile = planProfileFor(slug);
    assert.equal(profile.allowLookup, true, `${slug}: allowLookup != true`);
  }
});

test("Toll-Fraud-Invariante: nie unrestricted, nie eigene Allowlists je Slug", () => {
  for (const slug of CATALOG_SLUGS) {
    const profile = planProfileFor(slug);
    assert.equal(profile.unrestricted, false, `${slug}: unrestricted Freibrief`);
    assert.deepEqual(profile.allowedNumbers, [], `${slug}: eigene allowedNumbers`);
    assert.deepEqual(profile.allowedCountryCodes, [], `${slug}: per-Profil-Land-Freibrief`);
  }
});

test("Lookup fail-closed: unbekannter/leerer/fehlender Slug -> null", () => {
  assert.equal(planProfileFor("nope"), null);
  assert.equal(planProfileFor(""), null);
  assert.equal(planProfileFor(undefined), null);
  assert.equal(planProfileFor(null), null);
});
