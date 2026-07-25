// PAY-04 (Katalog: tasks/i18n-tests/07-geld-und-waehrung.md, Abschnitt "PAY-04") +
// GAP-32-Nachbarschaft. Reserve-Rechnung fuer einen Starter-Tenant, der ein Nicht-
// Inlandsziel anruft: reserveExceedsBudget() gegen die Starter-Plan-Decke.
//
// CHARAKTERISIERUNG (heutiger Stand), NICHT der Sollzustand-Beweis: die Reserve-
// RECHNUNG (reserveExceedsBudget, planCapCents) ist der MECHANISMUS und bleibt richtig
// (R3 der kanonischen Liste, 00-kanonische-liste.md) - der eigentliche Defekt sitzt in
// den WERTEN (VOICE_TARIFF_DEFAULT_CENTS zu hoch / die Decke zu niedrig fuer JEDES
// Nicht-Inlandsziel) und ist dort Launch-Gate:
//   - GAP-32 (test/gap-32-worst-case-fatal.test.js): der Boot-Guard muss das FATAL
//     machen (heute nur WARN) - der SOLL(rot)-Test fuer die Werte-Frage.
//   - GAP-33 (test/prod-config-smoke.test.js, "GAP-33: Outbound ins Ausland kommt
//     unter ausgelieferten Werten bis zum Provider durch") ist der SOLL(rot)-Test
//     fuer GENAU dieses Symptom: ein Nicht-Inlandsanruf soll durchkommen, faellt
//     heute mit 402 - dieselbe Ursache wie hier.
// Dieser Test hier bestaetigt NUR, dass die Rechnung selbst (0 Ist-Verbrauch + volle
// Worst-Case-Reserve > Starter-Decke) tut, was der Code vorschreibt - er ist bewusst
// GRUEN (Regressionsschutz auf der Formel), keine neue Erwartung.
//
// Live-Zahlen (tasks/i18n-tests/13-live-env-befund.md Abschnitt 3+6, NICHT die
// aelteren Katalog-Zahlen 900/300 gegen 180s Dauer): VOICE_TARIFF_DEFAULT_CENTS=300
// (Code-Fallback UND render.yaml:281 identisch), MAX_CALL_DURATION_CAP_S=300
// (src/store/defaults.js:253, der reale Worst-Case, NICHT render.yaml's
// MAX_CALL_DURATION_S=180 - das ist nur der Anfrage-DEFAULT) -> Reserve = 300*5 = 1500 ct.
// Die Starter-Decke (planCapCents) bleibt bei 300 ct (render.yaml:287-291 bestaetigt
// VOICE_CAP_RATE_CENTS_PER_MIN=6 explizit mit dem Kommentar "-> 300 / 900 ct" - das
// ist die live gueltige Formel, unabhaengig von DEFAULT_TENANT_BUDGET_CENTS=600, das
// eine ANDERE Achse ist (Tenant OHNE eigenen Plan, s. GAP-32). PAY-04/GAP-32 teilen
// eine Wurzel, sind aber verschiedene Faelle (Vorgabe des Blocks) - hier bleibt die
// Starter-PLAN-Decke (300), nicht die generische Tenant-Decke (600).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { makeDefaultState, registerTenant, setTenantBudget, reserveExceedsBudget } from "../src/store/state-ops.js";
import { planCapCents } from "../src/billing/plan-caps.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

const TENANT_A = "t_pay04_starter";
const NON_DOMESTIC_TARGET = "+15551234567"; // kein +49/+33/+44-Praefix

test("Charakterisierung PAY-04: Starter-Decke (300 ct) uebersteigt die Worst-Case-Reserve (1500 ct) schon bei 0 Ist-Verbrauch", () => {
  const capCents = planCapCents("starter", { voiceCapRateCentsPerMin: 6 });
  assert.equal(capCents, 300, "Vorbedingung: Starter-Plan-Decke (render.yaml:287-291-Formel)");

  const reserveCents = tariffCentsPerMin(NON_DOMESTIC_TARGET) * Math.ceil(MAX_CALL_DURATION_CAP_S / 60);
  assert.equal(
    reserveCents,
    1500,
    "Vorbedingung: live-gemessene Worst-Case-Reserve (VOICE_TARIFF_DEFAULT_CENTS=300 * 5 Minuten)",
  );

  const s = makeDefaultState();
  registerTenant(s, TENANT_A, {});
  setTenantBudget(s, TENANT_A, { budgetCents: capCents, hardCapCents: capCents });

  assert.equal(
    reserveExceedsBudget(s, TENANT_A, reserveCents, config.billing),
    true,
    "heutiger Stand: JEDER Nicht-Inlandsanruf sprengt die Starter-Decke, auch bei 0 Ist-Verbrauch " +
      "(0 + 0 + 1500 > 300) - das SOLL fuer 'der Anruf soll durchkommen' fuehrt " +
      "test/prod-config-smoke.test.js (GAP-33, Auslandsziel)",
  );
});
