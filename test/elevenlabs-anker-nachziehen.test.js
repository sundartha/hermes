import assert from "node:assert/strict";
import test from "node:test";

import { voiceMinutesOf } from "../src/billing/metering.js";
import { answeredAnchorOutcome } from "../src/elevenlabs/outbound.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  createCall,
  isInCallConsult,
  makeDefaultState,
  markAnswered,
  recordAnsweredUnclearReason,
  trueUpAnsweredAt,
} from "../src/store/state-ops.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";

const ENDED_AT = "2026-08-15T10:05:00.000Z";
const STALE_DIAL_TIME_STAMP = "2026-08-15T10:00:00.000Z";
const DURATION_SECS_OVER_A_MINUTE = 125;
const EXPECTED_MINUTES_CEIL = 3;

function freshCall(state) {
  return createCall(state, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
}

test("KS-EL1: Dauer > 0 -> Anker exakt um die Anbieter-Dauer nachgezogen, gebucht werden ceil(Dauer/60) Minuten", () => {
  const state = makeDefaultState();
  const call = freshCall(state);
  call.endedAt = ENDED_AT;

  const outcome = answeredAnchorOutcome(ENDED_AT, {
    metadata: { call_duration_secs: DURATION_SECS_OVER_A_MINUTE },
  });
  assert.equal(outcome.unclearReason, null, "eine eindeutige Dauer traegt keinen Grund");

  const angewendet = trueUpAnsweredAt(state, call.id, outcome.answeredAtIso);
  assert.equal(angewendet.changed, true);

  assert.equal(
    Date.parse(ENDED_AT) - Date.parse(call.answeredAt),
    DURATION_SECS_OVER_A_MINUTE * MS_PER_SECOND,
    "die Differenz zu endedAt muss exakt die vom Anbieter gelieferte Dauer sein",
  );
  assert.equal(
    voiceMinutesOf(call),
    EXPECTED_MINUTES_CEIL,
    "voiceMinutesOf (unveraendert) muss ceil(Dauer/60) liefern - die Minuten des Anbieters",
  );
});

test("KS-EL1: Dauer 0 -> answeredAt faellt auf null, NICHTS wird gebucht (Regressionsfang gegen die erfundene Minute)", () => {
  const state = makeDefaultState();
  const call = freshCall(state);
  call.answeredAt = STALE_DIAL_TIME_STAMP;
  call.endedAt = ENDED_AT;

  const outcome = answeredAnchorOutcome(ENDED_AT, { status: "done", metadata: { call_duration_secs: 0 } });
  assert.equal(outcome.answeredAtIso, null);
  assert.equal(outcome.unclearReason, "call_duration_secs_zero_not_answered");
  assert.equal(outcome.keepExistingAnchor, false, "ein beendetes Gespraech ohne Rufannahme behaelt keinen Anker");

  trueUpAnsweredAt(state, call.id, outcome.answeredAtIso);

  assert.equal(call.answeredAt, null, "der vorlaeufige Stempel muss weichen - niemand hat abgenommen");
  assert.equal(
    voiceMinutesOf(call),
    0,
    "voiceMinutesOf (unveraendert) darf ohne answeredAt keine Minute erfinden",
  );
});

test("KS-EL1: metadata.call_duration_secs fehlt -> answeredAt faellt auf null, nichts gebucht, Grund-Feld gesetzt", () => {
  const state = makeDefaultState();
  const call = freshCall(state);
  call.answeredAt = STALE_DIAL_TIME_STAMP;
  call.endedAt = ENDED_AT;
  assert.equal(call.answeredUnclearReason, null, "Vorbedingung: frischer Call ohne Grund");

  const outcome = answeredAnchorOutcome(ENDED_AT, {});
  assert.equal(outcome.answeredAtIso, null);
  assert.ok(outcome.unclearReason, "ein nicht ermittelbarer Wert muss einen Grund tragen");

  trueUpAnsweredAt(state, call.id, outcome.answeredAtIso);
  recordAnsweredUnclearReason(state, call.id, outcome.unclearReason);

  assert.equal(call.answeredAt, null);
  assert.equal(voiceMinutesOf(call), 0);
  assert.equal(typeof call.answeredUnclearReason, "string");
  assert.ok(call.answeredUnclearReason.length > 0);
});

test("KS-EL1: der Stempel am Anrufstart (markAnswered) bleibt WAEHREND des laufenden Anrufs erhalten - der Rueckfrage-Kostenriegel sieht ihn", () => {
  const state = makeDefaultState();
  const call = freshCall(state);

  const { changed } = markAnswered(state, call.id);
  assert.equal(changed, true, "markAnswered muss beim Anrufstart stempeln");
  assert.ok(call.answeredAt, "kein Stempel am Anrufstart");

  const rueckfrageWaehrendDesAnrufs = { askedAt: new Date().toISOString() };
  assert.equal(
    isInCallConsult(call, rueckfrageWaehrendDesAnrufs),
    true,
    "eine Rueckfrage waehrend des laufenden Anrufs muss als In-Call-Consult erkannt werden - trueUpAnsweredAt darf diesen Stempel erst am Gespraechsende anfassen, nicht vorher",
  );
});
