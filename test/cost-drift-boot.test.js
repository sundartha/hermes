// LCT P5 (Drift-Waechter): Boot-Beweis der zwei neuen Boot-Guards - Alarmkanal-Guard
// (alertChannelFindings) UND Drift-Waechter-Ausloeser 1/2 (warnTariffDrift). Muster
// test/provider-rate-guard.test.js (f2): echter Kindprozess-Spawn ueber startServer,
// kein Flag-Setup noetig (beide Guards sind unkonditional). BASE_ENV traegt
// PLATFORM_ALERT_SMS_TO="" bereits (test/helpers.js) - der leere Kanal ist der Default-Fall.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

test("P5-B3: BASE_ENV (leerer Alarmkanal) -> Server startet, genau eine PLATFORM_ALERT_SMS_TO-WARN, kein Boot-Refusal", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const matches = srv.stdout.match(/PLATFORM_ALERT_SMS_TO ist leer/g);
    assert.equal(matches ? matches.length : 0, 1, `erwartet genau eine WARN-Zeile, Output:\n${srv.stdout}`);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("P5-B4: PLATFORM_ALERT_SMS_TO gesetzt -> keine Alarmkanal-WARN, die Nummer erscheint NIRGENDS im Log", async () => {
  const NUMBER = "+491234567890";
  const srv = await startServer({ env: { PLATFORM_ALERT_SMS_TO: NUMBER } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /PLATFORM_ALERT_SMS_TO ist leer/);
    assert.doesNotMatch(
      srv.stdout,
      new RegExp(NUMBER.replace("+", "\\+")),
      "die Zielnummer darf nirgends im Boot-Log erscheinen (Regel 4/PII)",
    );
  } finally {
    await srv.stop();
  }
});

test("P5-B5: genau eine [boot] Tarif-Drift:-Zeile, nicht eine je Praefix (WARN-Muedigkeit)", async () => {
  const srv = await startServer({});
  try {
    const matches = srv.stdout.match(/\[boot\] Tarif-Drift:/g);
    assert.equal(matches ? matches.length : 0, 1, `erwartet genau eine Zeile, Output:\n${srv.stdout}`);
  } finally {
    await srv.stop();
  }
});
