// F2 P11 - Owner-Seed der privaten Summary-Nummer aus config.ownerNumber. Seit P7 geht
// die Inbound-Summary-SMS an tenant.privateNumber statt config.ownerNumber - der Owner-
// Tenant muss seine privateNumber daher EINMALIG idempotent aus der Owner-Config bekommen,
// sonst verloere er nach der Umstellung still seine eigene Summary-SMS.
//
// Achsen, alle offline (reine state-ops-Funktion, kein Netz) -> F.I.R.S.T.:
//   A) seedBootstrapPrivateNumber setzt/normalisiert/idempotent (state-ops, config-frei).
//   B) Trust-Modell: Laendercode-Gate AUS - eine Nicht-DE-Owner-Config-Nummer wird geseedet.
//   C) Fail-soft: leere/ungueltige Config -> kein Seed, KEIN Throw, false (Boot-Warnung).
//
// P2b: die fruehere Achse D (pg init() seedet aus config.ownerNumber) ist ENTFERNT - der
// config-derived Boot-Seed existiert nicht mehr (Erst-Setup via scripts/bootstrap-tenant.js).
// state-ops ist config-frei -> der statische Import laedt config.js NICHT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, seedBootstrapPrivateNumber, findTenant } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// A) Setzt + normalisiert (normNum strippt Trennzeichen); liefert true.
test("seedt Owner-privateNumber aus der config-Nummer (normalisiert), liefert true", () => {
  const s = makeDefaultState();
  const ok = seedBootstrapPrivateNumber(s, "+49 170 123 4567", BOOTSTRAP_TENANT_ID);
  assert.equal(ok, true);
  assert.equal(
    findTenant(s, BOOTSTRAP_TENANT_ID).privateNumber,
    "+491701234567",
    "normalisiert gespeichert",
  );
});

// A) Idempotent: eine bereits gesetzte privateNumber (z.B. per Self-Service) gewinnt.
test("idempotent: vorhandene privateNumber wird NICHT ueberschrieben", () => {
  const s = makeDefaultState();
  findTenant(s, BOOTSTRAP_TENANT_ID).privateNumber = "+491729998877"; // z.B. Self-Service gesetzt
  const ok = seedBootstrapPrivateNumber(s, "+491701234567", BOOTSTRAP_TENANT_ID);
  assert.equal(ok, true, "Owner hat danach eine Nummer -> true");
  assert.equal(
    findTenant(s, BOOTSTRAP_TENANT_ID).privateNumber,
    "+491729998877",
    "gesetzte Nummer gewinnt",
  );
});

// B) Trust-Modell: Laendercode-Gate AUS ("*") - die Owner-Config ist Plattform-TRUSTED,
// eine Nicht-DE-Nummer wird geseedet (anders als bei USER-Eingaben in setPrivateNumber).
test("Laendercode-Gate aus: Nicht-DE-Owner-Config-Nummer wird geseedet", () => {
  const s = makeDefaultState();
  const ok = seedBootstrapPrivateNumber(s, "+12025550123", BOOTSTRAP_TENANT_ID);
  assert.equal(ok, true);
  assert.equal(findTenant(s, BOOTSTRAP_TENANT_ID).privateNumber, "+12025550123");
});

// C) Fail-soft: leere Eingabe -> kein Seed, false (Boot-Warnungs-Signal), kein Throw.
test("leere Owner-Nummer -> kein Seed, false (Boot-Warnung), kein Feld", () => {
  const s = makeDefaultState();
  const ok = seedBootstrapPrivateNumber(s, "", BOOTSTRAP_TENANT_ID);
  assert.equal(ok, false);
  assert.equal(
    "privateNumber" in findTenant(s, BOOTSTRAP_TENANT_ID),
    false,
    "kein leeres Feld at rest",
  );
});

// C) Fail-soft: ungueltiges E.164-Format -> kein Seed, false, KEIN Throw (boot-sicher).
test("ungueltiges Format -> kein Seed, false, KEIN Throw (boot-sicher)", () => {
  const s = makeDefaultState();
  let ok;
  assert.doesNotThrow(() => {
    ok = seedBootstrapPrivateNumber(s, "nicht-eine-nummer", BOOTSTRAP_TENANT_ID);
  });
  assert.equal(ok, false);
  assert.equal("privateNumber" in findTenant(s, BOOTSTRAP_TENANT_ID), false);
});

// Fehlender Owner-Tenant -> No-Op, false (kein Throw).
test("fehlender Owner-Tenant -> false, kein Throw", () => {
  const s = makeDefaultState();
  s.tenants = []; // Owner entfernt (seedState-aehnlicher Grenzfall)
  assert.equal(seedBootstrapPrivateNumber(s, "+491701234567", BOOTSTRAP_TENANT_ID), false);
});
