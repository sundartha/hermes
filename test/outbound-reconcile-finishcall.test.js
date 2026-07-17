// outbound-p1c (S1-2): die finishCall-VERDRAHTUNG des Budget-Reconcile end-to-end ueber
// die echte /voice/status-Route (kein Unit-Mock). Der reine Helper addVoiceUsageCostCents
// ist auf state-ops-Ebene gepinnt (outbound-reserve-reconcile.test.js); dieser Spawn-Test
// deckt die drei zuvor unverifizierten Stellen ab:
//   1) reconcileOutboundVoiceBudget laeuft bei JEDEM Call-Ende (auch ohne PAYMENT_ENABLED)
//      und mutiert persistent den Tenant-Budget-Bucket (costCents im Store),
//   2) der direction-Guard: ein INBOUND-Call darf NICHT abziehen (byte-identisch),
//   3) tariffCentsPerMin(call.to) am Reconcile-Pfad: Inland vs. International buchen
//      unterschiedliche Cents (der Tarif ist am Ziel gekoppelt, nicht pauschal).
//
// Deterministisch ohne echtes Netz: die Calls sind mit fixen answeredAt/endedAt (5 Min
// Abstand) und status="completed" geseedet -> endCallRecord laesst sie unberuehrt (nur
// "active" wird umgeschrieben), finishCall liest also exakt diese Minuten. Leeres
// Transkript -> finishCall returnt VOR jedem LLM-Call (kein Anthropic-Mock noetig). Der
// json-Store schreibt synchron (writeFileSync), darum ist der Bucket nach der Antwort auf
// Platte. Muster wie voice-status-lifecycle.test.js (echte Route gegen den Kindprozess).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Fixe Abrechnungsfenster: answeredAt..endedAt = genau BILLED_MINUTES (ceil-stabil, da
// exaktes Vielfaches einer Minute). Aus diesen Konstanten leiten sich die Erwartungswerte
// ab - kein nacktes Cent-Literal (G25).
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const BILLED_MINUTES = 5;
const DOMESTIC_TARIFF_CENTS = 20; // +49/+33/+44 -> Inlandstarif
const DEFAULT_TARIFF_CENTS = 300; // alles andere -> Worst-Case-Default
const DOMESTIC_TO = "+4915112345678"; // DE -> Inlandstarif
const INTL_TO = "+12025550123"; // US -> Default-Tarif

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

// Beendet einen geseedeten Call ueber die echte Route und wartet, bis der synchrone
// finishCall-Pfad (Reconcile + save) durch ist (die [voice/status]-Logzeile steht
// unmittelbar davor im Handler).
async function completeCall(srv, callId) {
  const res = await postStatus(srv, callId, { CallStatus: "completed" });
  assert.equal(res.status, 200);
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
}

// costCents des Owner-Buckets aus dem PERSISTIERTEN Store (Quelle der Wahrheit).
const ownerCostCents = (srv) => srv.readStore().usage[BOOTSTRAP_TENANT_ID].costCents;

test("Reconcile-Verdrahtung: outbound bucht tarif-x-minuten, inbound zieht nichts ab", async () => {
  const srv = await startServer({
    env: {
      VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
      VOICE_TARIFF_DEFAULT_CENTS: String(DEFAULT_TARIFF_CENTS),
    },
    seed: seedState({
      calls: [
        // Alle als status="completed" + answeredAt/endedAt geseedet (deterministische
        // Minuten). direction/to variieren, der Rest ist seedCall-Default (Owner-Tenant).
        seedCall({
          id: "rc_inbound",
          direction: "inbound",
          from: DOMESTIC_TO,
          status: "completed",
          answeredAt: ANSWERED_AT,
          endedAt: ENDED_AT,
        }),
        seedCall({
          id: "rc_out_dom",
          direction: "outbound",
          to: DOMESTIC_TO,
          status: "completed",
          answeredAt: ANSWERED_AT,
          endedAt: ENDED_AT,
        }),
        seedCall({
          id: "rc_out_intl",
          direction: "outbound",
          to: INTL_TO,
          status: "completed",
          answeredAt: ANSWERED_AT,
          endedAt: ENDED_AT,
        }),
      ],
    }),
  });
  try {
    // (2) INBOUND zuerst: der direction-Guard verhindert jeden Abzug. Der seedState-
    // Bucket startet bei costCents 0; der Inbound-Call hat abrechenbare Minuten (5 Min,
    // to=Inland) - ein gebrochener Guard wuerde also abziehen. costCents bleibt 0 ->
    // byte-identisch. (readStore liefert den Owner-Bucket erst NACH dem ersten save(),
    // den finishCall hier ausloest - vorher haelt store.json die flache Seed-Form.)
    await completeCall(srv, "rc_inbound");
    assert.equal(ownerCostCents(srv), 0, "Inbound bucht NICHT in den Budget-Bucket (direction-Guard)");

    // (1)+(3) OUTBOUND Inland: Reconcile bucht BILLED_MINUTES x Inlandstarif.
    await completeCall(srv, "rc_out_dom");
    const afterDomestic = BILLED_MINUTES * DOMESTIC_TARIFF_CENTS;
    assert.equal(ownerCostCents(srv), afterDomestic, "Outbound Inland: Minuten x Inlandstarif gebucht");

    // (3) OUTBOUND International: derselbe Pfad nutzt tariffCentsPerMin(call.to) -> der
    // teurere Default-Tarif kommt OBENDRAUF (beweist die Kopplung an call.to, nicht pauschal).
    await completeCall(srv, "rc_out_intl");
    const afterIntl = afterDomestic + BILLED_MINUTES * DEFAULT_TARIFF_CENTS;
    assert.equal(ownerCostCents(srv), afterIntl, "Outbound International: Default-Tarif additiv gebucht");
  } finally {
    await srv.stop();
  }
});
