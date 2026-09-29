// F9 (A6, T3b) - finishCall bucht die Voice-Minuten GENAU EINMAL ueber Prozessgrenzen.
// Der In-Memory-Marker call._finished deckt Doppel-Callbacks INNERHALB eines Prozesses ab
// (bereits abgedeckt: outbound-reconcile-finishcall.test.js), aber ueberlebt keinen Restart.
// Dieser Test faehrt den Kindprozess auf DERSELBEN dataDir zweimal hoch (echte Prozess-
// Neustart-Simulation, kein Mock) und beweist, dass der persistierte billedAt-Marker
// (state-ops.markBilled, server.js finishCall-Guard) den zweiten /voice/status-Callback
// abfaengt - die Buchung bleibt bei X, nicht 2X.
//
// Rot-vor-Fix (Lead-Notiz): OHNE den billedAt-Guard in finishCall wuerde der zweite
// Prozess (frisches call._finished=false nach Boot) die Minuten erneut buchen -> 2X.
//
// Deterministisch ohne echtes Netz: der Call ist mit fixen answeredAt/endedAt (5 Min
// Abstand) und status="completed" geseedet (Muster outbound-reconcile-finishcall.test.js).
// Leeres Transkript -> finishCall returnt VOR jedem LLM-Call (kein Anthropic-Mock noetig).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog, DOMESTIC_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Fixes Abrechnungsfenster: answeredAt..endedAt = genau BILLED_MINUTES (Muster
// outbound-reconcile-finishcall.test.js - kein nacktes Cent-Literal, G25).
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const BILLED_MINUTES = 5;
const DOMESTIC_TARIFF_CENTS = 20; // +49/+33/+44 -> Inlandstarif
const DEFAULT_TARIFF_CENTS = 300; // alles andere -> Worst-Case-Default
const DOMESTIC_TO = "+4915112345678"; // DE -> Inlandstarif
const CALL_ID = "bill_once";
const HTTP_OK = 200;

const TARIFF_ENV = {
  VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
  VOICE_TARIFF_DEFAULT_CENTS: String(DEFAULT_TARIFF_CENTS),
};

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

// Beendet den geseedeten Call ueber die echte Route und wartet, bis der synchrone
// finishCall-Pfad (Buchung + save) durch ist (Muster outbound-reconcile-finishcall.test.js).
async function completeCall(srv, callId) {
  const res = await postStatus(srv, callId, { CallStatus: "completed" });
  assert.equal(res.status, HTTP_OK);
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
}

// costCents des Owner-Buckets aus dem PERSISTIERTEN Store (Quelle der Wahrheit).
function ownerCostCents(srv) {
  const { usage } = srv.readStore();
  return usage[BOOTSTRAP_TENANT_ID].costCents;
}

test("finishCall bucht Voice-Minuten genau einmal ueber einen Prozess-Neustart hinweg", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        direction: "outbound",
        to: DOMESTIC_TO,
        // Absender mit +49: der Inlandssatz greift seit P5 nur bei gleicher Vorwahl an
        // BEIDEN Enden (seedCall-Default ist die US-DID = Auslands-Leg).
        from: DOMESTIC_TEST_NUMBER.e164,
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
      }),
    ],
  });

  const srv1 = await startServer({ env: TARIFF_ENV, seed });
  const expectedCostCents = BILLED_MINUTES * DOMESTIC_TARIFF_CENTS;
  let dataDir;
  try {
    await completeCall(srv1, CALL_ID);
    assert.equal(ownerCostCents(srv1), expectedCostCents, "erste Buchung: Minuten x Inlandstarif");
    // _finished ist jetzt In-Memory gesetzt, aber NICHT auf Platte (json.save()-Replacer, F9).
    const persisted = srv1.readStore().calls.find((call) => call.id === CALL_ID);
    assert.equal(
      Object.prototype.hasOwnProperty.call(persisted, "_finished"),
      false,
      "_finished ist strukturell ephemer und landet nie auf Platte",
    );
    assert.ok(persisted.billedAt, "billedAt ist der persistierte, prozessuebergreifende Marker");
    dataDir = srv1.dataDir;
  } finally {
    await srv1.stop();
  }

  // Prozess-NEUSTART auf DERSELBEN Platte: frisches call._finished (Boot-Default), aber
  // der Store traegt den persistierten billedAt-Marker vom ersten Prozess weiter.
  const srv2 = await startServer({ env: TARIFF_ENV, dataDir });
  try {
    await completeCall(srv2, CALL_ID);
    assert.equal(
      ownerCostCents(srv2),
      expectedCostCents,
      "zweiter /voice/status-Callback nach Restart bucht NICHT erneut (bleibt X, nicht 2X)",
    );
  } finally {
    await srv2.stop();
  }
});
