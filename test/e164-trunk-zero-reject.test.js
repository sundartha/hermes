// Phase C4: Trunk-0 nach Laendervorwahl -> REJECT (fail-closed). Eine '0' direkt
// nach +49/+33/+44 ist ein nationaler Trunk-Praefix, der in E.164 nicht vorkommt
// (+4901737... statt +491737...). Diese Schreibweise passiert heute die E164-Regex
// (erste Ziffer 4 != 0) und wuerde unveraendert gewaehlt - das wird abgewiesen.
//
// Zwei Sektionen: (1) reines Praedikat (offline, deterministisch); (2) der Producer
// POST /api/calls ueber HTTP. Offline-Diskriminator wie number-gate.test.js: eine
// NICHT mit "AC" beginnende TWILIO_ACCOUNT_SID ("x") laesst den Twilio-Client synchron
// VOR jedem Netzzugriff werfen -> ein durchgelassener Call endet als 500 (alle Gates
// passiert), ein Trunk-0-Reject als 400 (Short-Circuit vor createCall), eine Denylist-
// Sperre als 403.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTrunkZeroAfterCountryCode } from "../src/store/defaults.js";
import { startServer } from "./helpers.js";

const postCall = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

// ---- Sektion 1: reines Praedikat ----
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
    // Italien behaelt die fuehrende 0 im NSN -> +390612345678 ist GUELTIG, kein Trunk-0.
    assert.equal(hasTrunkZeroAfterCountryCode("+390612345678"), false);
  });

  await t.test("Raender / fail-closed -> false", () => {
    for (const n of ["", null, undefined, 12345, {}, "+49"]) {
      assert.equal(hasTrunkZeroAfterCountryCode(n), false, `${n} -> false`);
    }
  });
});

// ---- Sektion 2: Producer-Gate ueber HTTP (POST /api/calls) ----
const TRUNK_ZERO = ["+4901737252163", "+3301737252163", "+4401737252163"]; // 400 erwartet
const CLEAN = ["+491737252163", "+33123456789", "+447700900123"]; // 500 erwartet

test("POST /api/calls: Trunk-0 -> 400, korrekte Nummer passiert (C4)", async (t) => {
  const srv = await startServer({
    env: {
      ALLOWED_NUMBERS: [...TRUNK_ZERO, ...CLEAN].join(","),
      ALLOWED_COUNTRY_CODES: "+49,+33,+44",
      TWILIO_ACCOUNT_SID: "x",
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

// Gate-Bypass-Negativtest: eine Nummer, die GLEICHZEITIG denied (+490900 DE-0900-Premium)
// UND trunk-0-foermig (+490...) ist, bleibt 403 denylist (auditiert) - der !isDenied-Guard
// wahrt die Denylist-Praezedenz (Regel 1), kein Kippen auf 400.
test("POST /api/calls: denied UND trunk-0-foermig bleibt 403 denylist (C4-Bypass-Schutz)", async (t) => {
  const srv = await startServer({
    env: { ALLOWED_NUMBERS: "+4915112345678", ALLOWED_COUNTRY_CODES: "*", TWILIO_ACCOUNT_SID: "x" },
  });
  const blockedByDenylist = async (to) => {
    const res = await postCall(srv.localUrl, to);
    assert.equal(res.status, 403, `${to} muss am Denylist-Gate sperren (nicht 400)`);
    assert.match((await res.json()).error, /is blocked/, `${to} muss grund=denylist sein`);
  };
  try {
    // +49090012345678: denied (+490900) UND trunk-0-foermig (+490) -> Denylist gewinnt.
    await blockedByDenylist("+49090012345678");
    // plain +4990012345678 (denied via +49900, NICHT trunk-0-foermig) bleibt unveraendert 403.
    await blockedByDenylist("+4990012345678");
  } finally {
    await srv.stop();
  }
});
