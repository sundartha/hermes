// P2/OT-4 AC4: Der Boot EHRT das assertConfig-Ergebnis. Bei ungueltiger Safety-/
// Pflicht-Config startet der Dienst GAR NICHT (kein app.listen, kein /voice, kein
// /mcp) - er verweigert mit klarer Diagnose und exit(1). Lieber kein Dienst als ein
// Dienst ohne Gates (fail-closed). Kindprozess-Tests: Exit-Code + stderr/stdout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "./helpers.js";

test("T-P2-06: NaN-Budget (MAX_BUDGET_EUR=acht) -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { MAX_BUDGET_EUR: "acht" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /MAX_BUDGET_EUR/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P2-07: fehlender TWILIO_AUTH_TOKEN -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { TWILIO_AUTH_TOKEN: "" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /TWILIO_AUTH_TOKEN/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("Boot-Guard: keine aktive Nummer im Store -> Boot verweigert (exit 1), nennt CLI", async () => {
  // ownerNumber: null -> Spawn-Store OHNE aktive Nummer (Opt-out vom Auto-Seed der
  // Helper). Config ist gueltig -> der Refusal faellt NICHT in assertConfig, sondern in
  // den tenant-agnostischen Nummer-Boot-Guard (P2b, Ersatz fuer die TWILIO_NUMBER-Pflicht).
  const { code, output } = await startServerExpectExit({ ownerNumber: null });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Keine aktive Nummer im Store/);
  assert.match(output, /bootstrap-tenant/, "verweist actionable aufs Bootstrap-CLI");
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P2-08: vollstaendige Config bootet -> GET /healthz 200 (kein Fehl-Refusal)", async () => {
  const srv = await startServer({ env: { MAX_BUDGET_EUR: "8" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "saubere Config muss unveraendert booten");
  } finally {
    await srv.stop();
  }
});

test("OUT-05 F2: FAKE_ORIGINATE=true ohne SKIP_TWILIO_SIGNATURE_CHECK -> Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({
    env: { FAKE_ORIGINATE: "true", SKIP_TWILIO_SIGNATURE_CHECK: "false" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /FAKE_ORIGINATE/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});
