import { test } from "node:test";
import assert from "node:assert/strict";
import { deniedPrefix, DENIED_PREFIXES } from "../src/telephony/number-denylist.js";

const HIGH_COST_TARGETS = {
  "+5352345678": "+53",
  "+50934567890": "+509",
  "+23276123456": "+232",
  "+23670123456": "+236",
  "+23999112233": "+239",
  "+240222123456": "+240",
  "+2463701234": "+246",
  "+2476123": "+247",
  "+252612345678": "+252",
  "+2902345": "+290",
  "+2917123456": "+291",
  "+67077212345": "+670",
  "+6723123456": "+672",
  "+6745551234": "+674",
  "+67570123456": "+675",
  "+6777412345": "+677",
  "+6785551234": "+678",
  "+681821234": "+681",
  "+68251234": "+682",
  "+6834002": "+683",
  "+68673012345": "+686",
  "+6882901234": "+688",
  "+6904012": "+690",
  "+8502381234": "+850",
  "+8781012345": "+878",
};

const ORDINARY_TARGETS = [
  "+4915112345678",
  "+491701234567",
  "+33612345678",
  "+447700900123",
  "+12025550123",
  "+16045550123",
  "+18685550123",
  "+34600000000",
  "+5511987654321",
  "+525512345678",
  "+679123456",
  "+687751234",
  "+6913201234",
  "+685721234",
  "+233241234567",
  "+237671234567",
  "+238991234567",
  "+251911234567",
  "+254712345678",
  "+61412345678",
  "+821012345678",
  "+85251234567",
];

test("KS-P7: neu aufgenommene Hochpreis-Ziele sperren und nennen den treffenden Praefix", () => {
  for (const [to, praefix] of Object.entries(HIGH_COST_TARGETS))
    assert.equal(deniedPrefix(to), praefix, `${to} muss gesperrt sein (Praefix ${praefix})`);
});

test("KS-P7: Nachbarlaender und Startmaerkte passieren die Denylist", () => {
  for (const to of ORDINARY_TARGETS)
    assert.equal(deniedPrefix(to), null, `${to} darf NICHT gesperrt werden`);
});

test("KS-P7: die Liste bleibt E.164-foermig, dubletten- und ueberdeckungsfrei", () => {
  for (const p of DENIED_PREFIXES) assert.match(p, /^\+[1-9]\d+$/, `${p} ist kein E.164-Praefix`);
  assert.equal(new Set(DENIED_PREFIXES).size, DENIED_PREFIXES.length, "Dublette in der Liste");
  for (const a of DENIED_PREFIXES)
    for (const b of DENIED_PREFIXES)
      if (a !== b)
        assert.ok(!b.startsWith(a), `${a} verdeckt ${b} - der Audit-Praefix waere mehrdeutig`);
});
