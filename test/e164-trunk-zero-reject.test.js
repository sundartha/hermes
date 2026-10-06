import { test } from "node:test";
import assert from "node:assert/strict";
import { E164, hasTrunkZeroAfterCountryCode } from "../src/store/defaults.js";
import { isTrunkZeroFormatError } from "../src/telephony/outbound-gates.js";
import { startServer } from "./helpers.js";

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("hasTrunkZeroAfterCountryCode (Praedikat)", async (t) => {
  await t.test("Trunk-0 nach +49/+33/+44 -> true", () => {
    for (const n of ["+4901737252163", "+3301737252163", "+4401737252163", "+490"]) {
      assert.equal(hasTrunkZeroAfterCountryCode(n), true, `${n} ist Trunk-0-foermig`);
    }
  });

  await t.test("korrekte E.164 ohne Trunk-0 -> false", () => {
    for (const n of ["+491737252163", "+33123456789", "+447700900123"]) {
      assert.equal(hasTrunkZeroAfterCountryCode(n), false, `${n} ist korrekt`);
    }
  });

  await t.test("kein False-Positive fuer Laender ohne Trunk-0-Drop (+39 IT)", () => {
    assert.equal(hasTrunkZeroAfterCountryCode("+390612345678"), false);
  });

  await t.test("Raender / fail-closed -> false", () => {
    for (const n of ["", null, undefined, 12345, {}, "+49"]) {
      assert.equal(hasTrunkZeroAfterCountryCode(n), false, `${n} -> false`);
    }
  });
});

test("FMT-20 (Mechanismus, gruen) - E164 akzeptiert NANP-Nummern (+1 + 10 Ziffern)", () => {
  for (const n of ["+12025550123", "+14155550123", "+18005550123"]) {
    assert.equal(E164.test(n), true, `${n} ist gueltiges E.164`);
  }
});

test("FMT-21 (Mechanismus, gruen) - TRUNK_ZERO_COUNTRY_CODES betrifft +1 nicht (kein False-Positive fuer US)", () => {
  assert.equal(hasTrunkZeroAfterCountryCode("+10202555123"), false, "0 nach +1 ist kein Trunk-Praefix");
  assert.equal(hasTrunkZeroAfterCountryCode("+12025550123"), false);
  assert.equal(hasTrunkZeroAfterCountryCode("+490202555123"), true, "Kontrast: dieselbe Form mit +49 ist ein Verstoss");
});

test("OUT-16 (Mechanismus, gruen) - der Pre-Check isTrunkZeroFormatError ist fuer NANP-Nummern nie einschlaegig", () => {
  for (const n of ["+10202555123", "+12025550123", "+19005550123"]) {
    assert.equal(isTrunkZeroFormatError(n), false, `${n} darf den Pre-Check nie ausloesen`);
  }
  assert.equal(isTrunkZeroFormatError("+4901737252163"), true, "Kontrast: +49 mit Trunk-0 loest aus");
});

const TRUNK_ZERO = ["+4901737252163", "+3301737252163", "+4401737252163"];
const CLEAN = ["+491737252163", "+33123456789", "+447700900123"];

test("POST /api/calls: Trunk-0 -> 400, korrekte Nummer passiert (C4)", async (t) => {
  const srv = await startServer({
    env: {
      ALLOWED_NUMBERS: [...TRUNK_ZERO, ...CLEAN].join(","),
      ALLOWED_COUNTRY_CODES: "+49,+33,+44",
    },
  });
  try {
    await t.test("Trunk-0 nach Laendervorwahl -> 400 (E.164), kein Originate", async () => {
      for (const to of TRUNK_ZERO) {
        const res = await postCall(srv.localUrl, to);
        assert.equal(res.status, 400, `${to} muss als Formatfehler 400 liefern (nicht 500)`);
        assert.match((await res.json()).error, /E\.164/, `${to} -> E.164-Meldung`);
      }
    });

    await t.test("korrekte Nummer ist kein False-Positive -> passiert (500)", async () => {
      for (const to of CLEAN) {
        assert.equal(
          (await postCall(srv.localUrl, to)).status,
          500,
          `${to} darf NICHT vom Trunk-0-Reject getroffen werden`,
        );
      }
    });
  } finally {
    await srv.stop();
  }
});

test("POST /api/calls: denied UND trunk-0-foermig bleibt 403 denylist (C4-Bypass-Schutz)", async (t) => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "+4915112345678", ALLOWED_COUNTRY_CODES: "*" },
  });
  const blockedByDenylist = async (to) => {
    const res = await postCall(srv.localUrl, to);
    assert.equal(res.status, 403, `${to} muss am Denylist-Gate sperren (nicht 400)`);
    assert.match((await res.json()).error, /is blocked/, `${to} muss grund=denylist sein`);
  };
  try {
    await blockedByDenylist("+49090012345678");
    await blockedByDenylist("+4990012345678");
  } finally {
    await srv.stop();
  }
});
