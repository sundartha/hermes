import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePrivateNumber,
  setPrivateNumber,
  findTenant,
  makeDefaultState,
  registerTenant,
  setTenantGeo,
} from "../src/store/state-ops.js";

test("normalizePrivateNumber: Nummer passt nicht zum Land -> wirft (Allowlist bleibt bestehen)", () => {
  assert.throws(() => normalizePrivateNumber("+491701234567", "US"), /Laendercode nicht erlaubt/);
});

test("normalizePrivateNumber: Premium-Praefix im NEUEN Land wird trotzdem abgelehnt (Toll-Fraud-Gate)", () => {
  assert.throws(
    () => normalizePrivateNumber("+19005550123", "US"),
    /gesperrter Nummernbereich/,
    "ohne die geteilte Denylist waere dieser Test rot",
  );
});

test("normalizePrivateNumber: Premium-Praefix im Heimatland wird abgelehnt (bewusste Haertung)", () => {
  assert.throws(() => normalizePrivateNumber("+499001234567", "DE"), /gesperrter Nummernbereich/);
});

test("normalizePrivateNumber: unbekanntes Land -> strenger Bestands-Default (+49), +34 wirft", () => {
  assert.equal(normalizePrivateNumber("+491701234567", "ES"), "+491701234567");
  assert.throws(() => normalizePrivateNumber("+34911234567", "ES"), /Laendercode nicht erlaubt/);
});

test("normalizePrivateNumber: NANP-Karibik (JM) wird trotz NANP-Allowlist von der Denylist abgelehnt", () => {
  assert.throws(() => normalizePrivateNumber("+18761234567", "JM"), /gesperrter Nummernbereich/);
});

test("setPrivateNumber: leitet das Land aus tenant.country her (US-Tenant kann +1 setzen, DE-Tenant nicht)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_us");
  registerTenant(s, "t_de");
  setTenantGeo(s, "t_us", { country: "US" });
  setTenantGeo(s, "t_de", { country: "DE" });
  setPrivateNumber(s, "t_us", "+12025550123");
  assert.equal(findTenant(s, "t_us").privateNumber, "+12025550123");
  assert.throws(() => setPrivateNumber(s, "t_de", "+12025550123"), /Laendercode nicht erlaubt/);
});

test("normalizePrivateNumber: Notruf-Kurzwahl wirft (Format bzw. Denylist)", () => {
  assert.throws(() => normalizePrivateNumber("112", "DE"));
});

test("normalizePrivateNumber: Hochpreis-Laendercode (+53) wird abgelehnt (KS-P7 wirkt geteilt)", () => {
  assert.throws(() => normalizePrivateNumber("+5352345678", "CU"), /gesperrter Nummernbereich/);
});
