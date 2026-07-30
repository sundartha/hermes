// PAY-04 (Katalog: tasks/i18n-tests/07-geld-und-waehrung.md, Abschnitt "PAY-04") +
// GAP-32-Nachbarschaft. Reserve-Rechnung fuer einen Starter-Tenant, der ein Nicht-
// Inlandsziel anruft: reserveExceedsBudget() gegen die Starter-Plan-Decke.
//
// SOLLZUSTAND seit KS-P5a/E5a (vorher: Charakterisierung eines Defekts). Die Decke und die
// Reserve leiten sich seither aus DEMSELBEN Satz ab (voiceTariffDefaultCents) - es gibt
// keinen zweiten Deckel-Basissatz mehr, der davon abweichen koennte. Damit gilt fuer JEDEN
// Satz T: 0 Ist-Verbrauch + 0 In-Flight-Reserve + 5*T <= 50*T (Starter-Decke), ein
// Starter-Abonnent kommt also zu einem Nicht-Inlandsziel durch.
//
// Der gepruefte MECHANISMUS bleibt derselbe (R3 der kanonischen Liste,
// 00-kanonische-liste.md): Reserve = tariffCentsPerMin * angefangene Minuten der
// MAX_CALL_DURATION_CAP_S, gegen die abgeleitete Plan-Decke. Die Nachbarn bleiben
// unberuehrt: GAP-32 (test/gap-32-worst-case-fatal.test.js, Boot-Guard-Schaerfe) und
// GAP-33 (test/prod-config-smoke.test.js, Auslandsziel kommt bis zum Provider durch).
//
// Bewusst OHNE hartkodierte Zahlen: derselbe config.billing speist Decke UND Reserve, die
// Aussage ist damit satz-unabhaengig. Bei abgeschalteter Kosten-Achse (Satz 0) ist der Fall
// vakuum-gruen - und das ist korrekt, dann reserviert niemand etwas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { makeDefaultState, registerTenant, setTenantBudget, reserveExceedsBudget } from "../src/store/state-ops.js";
import { planCapCents } from "../src/billing/plan-caps.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

const SECONDS_PER_MINUTE = 60;
const TENANT_A = "t_pay04_starter";
const NON_DOMESTIC_TARGET = "+15551234567"; // kein +49/+33/+44-Praefix
const US_OWN_DID = "+15005550006"; // ausgelieferte Default-DID (ebenfalls ohne Inlands-Vorwahl)

test("PAY-04: Starter-Decke traegt die Worst-Case-Reserve eines Nicht-Inlandsanrufs bei 0 Ist-Verbrauch", () => {
  const capCents = planCapCents("starter", config.billing);
  assert.ok(capCents > 0, "Vorbedingung: die Kosten-Achse ist aktiv (Satz > 0)");

  const reserveCents =
    tariffCentsPerMin(NON_DOMESTIC_TARGET, US_OWN_DID) * Math.ceil(MAX_CALL_DURATION_CAP_S / SECONDS_PER_MINUTE);

  const s = makeDefaultState();
  registerTenant(s, TENANT_A, {});
  setTenantBudget(s, TENANT_A, { budgetCents: capCents, hardCapCents: capCents });

  assert.equal(
    reserveExceedsBudget(s, TENANT_A, reserveCents, config.billing),
    false,
    "seit KS-P5a leiten Decke und Reserve sich aus DEMSELBEN Satz ab - ein Starter-Abonnent " +
      "kommt bei 0 Ist-Verbrauch zu einem Nicht-Inlandsziel durch",
  );
});
