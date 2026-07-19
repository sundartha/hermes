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

// ---- P3 (Boot-Guards Konfig-Kohaerenz/Modellpreise) -------------------------------

// T-P3-10: MAX_BUDGET_EUR=8 (BASE_ENV) -> platformSpendCapCents=800. Mit dem
// ausgelieferten alten .env.example-Wert DEFAULT_TENANT_BUDGET_CENTS=1000 ist die
// Tenant-Achse inert (1000 >= 800) - echter Schutzverlust, Klausel A. Rot vor Fix:
// heute bootet diese Konstellation durch (kein Kohaerenz-Guard existiert).
test("T-P3-10: DEFAULT_TENANT_BUDGET_CENTS=1000 gegen MAX_BUDGET_EUR=8 -> Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({
    env: { DEFAULT_TENANT_BUDGET_CENTS: "1000" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Start abgebrochen/);
  assert.match(output, /DEFAULT_TENANT_BUDGET_CENTS/);
  assert.match(output, /MAX_BUDGET_EUR/);
  assert.match(output, /1000/);
  assert.match(output, /800/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

// T-P3-11 (Merge-Gate): die in BASE_ENV gepinnten Werte (MAX_BUDGET_EUR=8,
// DEFAULT_TENANT_BUDGET_CENTS=0, VOICE_TARIFF_DEFAULT_CENTS=0, CLAUDE_MODEL/
// PRECALL_BRIEFING_MODEL beide bepreist) muessen weiterhin gruen booten - byte-identisch
// bis auf die eine A0-Konfig-Warnung (Sentinel 0 ist dokumentiertes Bestandsverhalten).
test("T-P3-11: BASE_ENV (Default=0) bootet gruen, genau eine A0-Konfig-Warnung, keine weiteren Warnungen", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const warnLines = srv.stdout
      .split("\n")
      .filter((l) => /\[boot\] Konfig-Warnung: .*DEFAULT_TENANT_BUDGET_CENTS=0/.test(l));
    assert.equal(warnLines.length, 1, `erwartet genau eine A0-Zeile, Output:\n${srv.stdout}`);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(srv.stdout, /max_duration_s=/, "Klausel B darf bei Default 0 nicht feuern");
    assert.doesNotMatch(
      srv.stdout,
      /ohne Preis in modelPricesUsd/,
      "BASE_ENV pinnt claude-haiku-4-5 + claude-sonnet-5, beide bepreist",
    );
  } finally {
    await srv.stop();
  }
});

// T-P3-12: die AUSGELIEFERTE Beispiel-Konfiguration (.env.example/render.yaml nach der
// P3-Korrektur: DEFAULT_TENANT_BUDGET_CENTS=600, VOICE_TARIFF_DEFAULT_CENTS=300) bootet
// gruen, feuert aber die Klausel-B-Warnung inkl. Audit-Zeile (600 < 300*5=1500).
test("T-P3-12: ausgelieferte Beispiel-Konfig (600/300) bootet gruen, Klausel-B-Warnung + Audit", async () => {
  const srv = await startServer({
    env: { DEFAULT_TENANT_BUDGET_CENTS: "600", VOICE_TARIFF_DEFAULT_CENTS: "300" },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.match(srv.stdout, /\[boot\] Konfig-Warnung: .*max_duration_s=120/);
    assert.match(srv.stdout, /\[audit\] boot_konfig_warnung ip=system grund=worst_case_unaffordable/);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(srv.stdout, /DEFAULT_TENANT_BUDGET_CENTS=0/);
  } finally {
    await srv.stop();
  }
});

// T-P3-13 (Review-Fix Runde 1, Merge-Gate): ECHTER Spawn OHNE jeden Override fuer
// DEFAULT_TENANT_BUDGET_CENTS/MAX_BUDGET_EUR - der numEnv-CODE-FALLBACK greift also
// exakt wie auf einem Host, der beide Vars nie setzt. `undefined` in env ueberschreibt
// den BASE_ENV-Pin auf dieselbe Var und wird von child_process.spawn aus der Kind-Env
// entfernt (nicht als String "undefined" gesetzt) - process.env sieht die Var damit als
// echt ABWESEND, genau wie ein Host ohne diese Env-Zeilen. Rot vor diesem Fix: der alte
// Fallback 1000 verlor gegen den platformSpendCapCents-Fallback 800 -> exit(1) trotz
// "keine Config gesetzt".
test("T-P3-13: kein Override fuer DEFAULT_TENANT_BUDGET_CENTS/MAX_BUDGET_EUR (reine CODE-Fallbacks) bootet gruen", async () => {
  const srv = await startServer({
    env: { DEFAULT_TENANT_BUDGET_CENTS: undefined, MAX_BUDGET_EUR: undefined },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, `reiner CODE-Fallback darf nicht booten verweigern:\n${srv.stdout}`);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(
      srv.stdout,
      /Konfig-Warnung: .*DEFAULT_TENANT_BUDGET_CENTS/,
      "Fallback 600 ist weder 0 (A0) noch >= 800 (A)",
    );
  } finally {
    await srv.stop();
  }
});
