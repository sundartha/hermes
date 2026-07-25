// GAP-36 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-36").
// /healthz muss Commit und einen secret-/PII-freien Konfigurations-Fingerabdruck
// ausweisen (post-Deploy-Smoke + Rollback-Drill brauchen einen Vergleichswert). Heute
// liefert /healthz nur {ok:true} (src/app.js:107). Reiner Spawn (startServer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

test("GAP-36 SOLL: /healthz weist commit und einen Konfigurations-Fingerabdruck aus (heute nur {ok:true})", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(
      typeof body.commit === "string" && body.commit.length > 0,
      `SOLL: /healthz muss ein 'commit'-Feld tragen; heute: ${JSON.stringify(body)} ` +
        "(src/app.js:107 liefert nur {ok:true}; die einzige Live-Versionsanzeige ist eine " +
        "als TEMP-DIAGNOSE markierte console.log-Zeile, src/boot.js:265-268)",
    );
    assert.ok(
      typeof body.configHash === "string" && body.configHash.length > 0,
      `SOLL: /healthz muss einen 'configHash' (allowedCountryCodes/maxCallsPerHour/` +
        `budgetMonthEnabled/multiTenant/paymentCurrency) tragen; heute: ${JSON.stringify(body)}`,
    );
  } finally {
    await srv.stop();
  }
});
