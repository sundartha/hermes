// outbound-p1c (S1-2)/KV-P2: die finishCall-VERDRAHTUNG des Budget-Reconcile end-to-end
// ueber die echte /voice/status-Route (kein Unit-Mock). Der reine Helper
// addVoiceUsageCostCents ist auf state-ops-Ebene gepinnt (outbound-reserve-reconcile.test.js);
// dieser Spawn-Test deckt die drei zuvor unverifizierten Stellen ab:
//   1) reconcileVoiceBudget laeuft bei JEDEM Call-Ende (auch ohne PAYMENT_ENABLED) und
//      mutiert persistent den Tenant-Budget-Bucket (costCents im Store),
//   2) KV-P2: ein INBOUND-Call bucht seit dieser Phase MIT (der frueher hier gepinnte
//      direction-Guard ist die Hauptluecke, die KV-P2 schliesst - dieselbe Datei traegt
//      seither keine Richtungs-Luege mehr im Namen, git mv von
//      outbound-reconcile-finishcall.test.js),
//   3) der Leg-Tarif (callTariffCentsPerMin) am Reconcile-Pfad: Inland vs. International
//      buchen unterschiedliche Cents (der Tarif haengt am Leg, nicht pauschal); Inbound
//      bucht seinen eigenen, kalibrierten Satz unabhaengig davon.
//
// Deterministisch ohne echtes Netz: die Calls sind mit fixen answeredAt/endedAt (5 Min
// Abstand) und status="completed" geseedet -> endCallRecord laesst sie unberuehrt (nur
// "active" wird umgeschrieben), finishCall liest also exakt diese Minuten. Leeres
// Transkript -> finishCall returnt VOR jedem LLM-Call (kein Anthropic-Mock noetig). Der
// json-Store schreibt synchron (writeFileSync), darum ist der Bucket nach der Antwort auf
// Platte. Muster wie voice-status-lifecycle.test.js (echte Route gegen den Kindprozess).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog, DOMESTIC_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Fixe Abrechnungsfenster: answeredAt..endedAt = genau BILLED_MINUTES (ceil-stabil, da
// exaktes Vielfaches einer Minute). Aus diesen Konstanten leiten sich die Erwartungswerte
// ab - kein nacktes Cent-Literal (G25).
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const BILLED_MINUTES = 5;
const DOMESTIC_TARIFF_CENTS = 20; // +49/+33/+44 -> Inlandstarif
const DEFAULT_TARIFF_CENTS = 300; // alles andere -> Worst-Case-Default
// KV-P2: bewusst von DOMESTIC/DEFAULT verschieden - ein Rueckfall auf einen der beiden
// Outbound-Saetze waere an der ZAHL sichtbar, nicht nur am Vorzeichen.
const INBOUND_TARIFF_CENTS = 5;
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

// KV2-10-Nachbesserung (Race, nicht Verhaltensaenderung): terminateAndBillCall feuert
// bill() als NICHT erwartete Promise (telephony/call-termination.js), und finishCall
// schreibt den Store erst NACH einem await (releaseReserve). waitForLog wartet nur auf
// die [voice/status]-Zeile, die VOR dem Settlement geloggt wird - unter paralleler
// Suite-Last las der Parent damit gelegentlich den Stand von VOR der Buchung (reproduzierbar
// rot, seit die Suite um eine Spawn-Datei wuchs). Pollen bis der Wert den vorherigen
// verlassen hat; schlaegt die Buchung fehl, laeuft die Frist ab und die Assertion faellt
// mit derselben Diagnose wie vorher.
const BUCHUNGS_FRIST_MS = 3000;
const POLL_TAKT_MS = 20;
async function ownerCostCentsNachBuchung(srv, standDavor) {
  const frist = Date.now() + BUCHUNGS_FRIST_MS;
  for (;;) {
    const cents = ownerCostCents(srv);
    if (cents !== standDavor || Date.now() > frist) return cents;
    await new Promise((aufloesen) => setTimeout(aufloesen, POLL_TAKT_MS));
  }
}

test("Reconcile-Verdrahtung: outbound bucht tarif-x-minuten, inbound bucht den kalibrierten Inbound-Satz", async () => {
  const srv = await startServer({
    env: {
      VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
      VOICE_TARIFF_DEFAULT_CENTS: String(DEFAULT_TARIFF_CENTS),
      VOICE_TARIFF_INBOUND_CENTS: String(INBOUND_TARIFF_CENTS),
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
          // Absender mit +49: der Inlandssatz greift seit P5 nur bei gleicher Vorwahl an
          // BEIDEN Enden (seedCall-Default ist die US-DID = Auslands-Leg).
          from: DOMESTIC_TEST_NUMBER.e164,
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
    // (2) INBOUND zuerst: KV-P2 bucht seit dieser Phase MIT, mit dem eigenen kalibrierten
    // Inbound-Satz - unabhaengig vom Land der DID (readStore liefert den Owner-Bucket erst
    // NACH dem ersten save(), den finishCall hier ausloest - vorher haelt store.json die
    // flache Seed-Form).
    await completeCall(srv, "rc_inbound");
    const afterInbound = BILLED_MINUTES * INBOUND_TARIFF_CENTS;
    assert.equal(await ownerCostCentsNachBuchung(srv, 0), afterInbound, "Inbound bucht Minuten x kalibrierten Inbound-Satz");

    // (1)+(3) OUTBOUND Inland: Reconcile bucht BILLED_MINUTES x Inlandstarif, additiv auf
    // dem Inbound-Beleg oben.
    await completeCall(srv, "rc_out_dom");
    const afterDomestic = afterInbound + BILLED_MINUTES * DOMESTIC_TARIFF_CENTS;
    assert.equal(await ownerCostCentsNachBuchung(srv, afterInbound), afterDomestic, "Outbound Inland: Minuten x Inlandstarif additiv gebucht");

    // (3) OUTBOUND International: derselbe Pfad tarifiert das Leg -> der teurere
    // Default-Tarif kommt OBENDRAUF (beweist die Kopplung ans Leg, nicht pauschal).
    await completeCall(srv, "rc_out_intl");
    const afterIntl = afterDomestic + BILLED_MINUTES * DEFAULT_TARIFF_CENTS;
    assert.equal(await ownerCostCentsNachBuchung(srv, afterDomestic), afterIntl, "Outbound International: Default-Tarif additiv gebucht");
  } finally {
    await srv.stop();
  }
});
