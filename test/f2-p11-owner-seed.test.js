// F2 P11 - Owner-Seed der privaten Summary-Nummer aus config.ownerNumber. Seit P7 geht
// die Inbound-Summary-SMS an tenant.privateNumber statt config.ownerNumber - der Owner-
// Tenant muss seine privateNumber daher EINMALIG idempotent aus der Owner-Config bekommen,
// sonst verloere er nach der Umstellung still seine eigene Summary-SMS.
//
// Achsen, alle offline (reine state-ops-Funktion + pglite, kein Netz) -> F.I.R.S.T.:
//   A) seedOwnerPrivateNumber setzt/normalisiert/idempotent (state-ops, config-frei).
//   B) Trust-Modell: Laendercode-Gate AUS - eine Nicht-DE-Owner-Config-Nummer wird geseedet.
//   C) Fail-soft: leere/ungueltige Config -> kein Seed, KEIN Throw, false (Boot-Warnung).
//   D) Integration (pglite): init() seedet aus config.ownerNumber UND persistiert ueber Restart.
//
// state-ops ist config-frei -> der statische Import laedt config.js NICHT. Erst der
// DYNAMISCHE pg.js-Import in D laedt config (dann ist OWNER_NUMBER gesetzt). node --test
// laeuft pro Datei in eigenem Prozess -> kein env-Leak in andere Suiten.
// ISOLATION: pglite NIE mit einem Server-Spawn in einer Datei (P3/P6a-Lehre) - hier nur pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makeDefaultState, seedOwnerPrivateNumber, findTenant } from "../src/store/state-ops.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";

// A) Setzt + normalisiert (normNum strippt Trennzeichen); liefert true.
test("seedt Owner-privateNumber aus der config-Nummer (normalisiert), liefert true", () => {
  const s = makeDefaultState();
  const ok = seedOwnerPrivateNumber(s, "+49 170 123 4567", OWNER_TENANT_ID);
  assert.equal(ok, true);
  assert.equal(findTenant(s, OWNER_TENANT_ID).privateNumber, "+491701234567", "normalisiert gespeichert");
});

// A) Idempotent: eine bereits gesetzte privateNumber (z.B. per Self-Service) gewinnt.
test("idempotent: vorhandene privateNumber wird NICHT ueberschrieben", () => {
  const s = makeDefaultState();
  findTenant(s, OWNER_TENANT_ID).privateNumber = "+491729998877"; // z.B. Self-Service gesetzt
  const ok = seedOwnerPrivateNumber(s, "+491701234567", OWNER_TENANT_ID);
  assert.equal(ok, true, "Owner hat danach eine Nummer -> true");
  assert.equal(findTenant(s, OWNER_TENANT_ID).privateNumber, "+491729998877", "gesetzte Nummer gewinnt");
});

// B) Trust-Modell: Laendercode-Gate AUS ("*") - die Owner-Config ist Plattform-TRUSTED,
// eine Nicht-DE-Nummer wird geseedet (anders als bei USER-Eingaben in setPrivateNumber).
test("Laendercode-Gate aus: Nicht-DE-Owner-Config-Nummer wird geseedet", () => {
  const s = makeDefaultState();
  const ok = seedOwnerPrivateNumber(s, "+12025550123", OWNER_TENANT_ID);
  assert.equal(ok, true);
  assert.equal(findTenant(s, OWNER_TENANT_ID).privateNumber, "+12025550123");
});

// C) Fail-soft: leere Config -> kein Seed, false (Boot-Warnungs-Signal), kein Throw.
test("leere config.ownerNumber -> kein Seed, false (Boot-Warnung), kein Feld", () => {
  const s = makeDefaultState();
  const ok = seedOwnerPrivateNumber(s, "", OWNER_TENANT_ID);
  assert.equal(ok, false);
  assert.equal("privateNumber" in findTenant(s, OWNER_TENANT_ID), false, "kein leeres Feld at rest");
});

// C) Fail-soft: ungueltiges E.164-Format -> kein Seed, false, KEIN Throw (boot-sicher).
test("ungueltiges Format -> kein Seed, false, KEIN Throw (boot-sicher)", () => {
  const s = makeDefaultState();
  let ok;
  assert.doesNotThrow(() => { ok = seedOwnerPrivateNumber(s, "nicht-eine-nummer", OWNER_TENANT_ID); });
  assert.equal(ok, false);
  assert.equal("privateNumber" in findTenant(s, OWNER_TENANT_ID), false);
});

// Fehlender Owner-Tenant -> No-Op, false (kein Throw).
test("fehlender Owner-Tenant -> false, kein Throw", () => {
  const s = makeDefaultState();
  s.tenants = []; // Owner entfernt (seedState-aehnlicher Grenzfall)
  assert.equal(seedOwnerPrivateNumber(s, "+491701234567", OWNER_TENANT_ID), false);
});

// D) Integration: pg init() seedet die Owner-privateNumber aus config.ownerNumber UND
// persistiert sie ueber einen Restart (Re-Hydrierung aus derselben DB).
test("pg init seedet Owner-privateNumber aus config.ownerNumber und persistiert ueber Restart", async () => {
  // VOR dem ersten config.js-Import setzen (state-ops/defaults laden config nicht).
  process.env.OWNER_NUMBER = "+491701234567";
  const { makePgStore } = await import("../src/store/pg.js");

  const db = new PGlite();
  const open = async () => {
    const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
    const store = makePgStore(runner);
    await store.init();
    return store;
  };

  const store = await open();
  assert.equal(store.tenantPrivateNumber(OWNER_TENANT_ID), "+491701234567", "init hat aus config geseedet");

  const reopened = await open(); // Prozess-Restart simuliert
  assert.equal(reopened.tenantPrivateNumber(OWNER_TENANT_ID), "+491701234567", "ueberlebt den Restart (persistiert)");
});
