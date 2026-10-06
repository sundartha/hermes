import { test } from "node:test";
import assert from "node:assert/strict";
import {
  costTruingCoveragePercent,
  PROVIDER_COST_RECORD_WINDOW_DAYS,
  makeCostTruing,
  SWEEP_TRIGGER,
} from "../src/billing/cost-truing.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE } from "../src/store/defaults.js";
import {
  makeDueOutboundCall, makeDueInboundCall, isoMinutesAgo, makeStubStore, fakeConfig, fakeVoiceControl,
} from "./cost-truing-harness.js";
import { captureConsole } from "./helpers.js";

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

test("KV-M3-1 gemischte Fixture: alte Formel (alle beendeten Calls) vs. neue Formel (nur belegbare Calls), inkl. Inbound und drei Nebenzaehler", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();

  const provenOutbound = makeDueOutboundCall(state, {
    nowMs, estimatedCostCents: 20, legRef: { callControlId: "cc_m3_out_p" },
  });
  provenOutbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  provenOutbound.costTruedAt = new Date(nowMs).toISOString();
  const provenInbound = makeDueInboundCall(state, {
    nowMs, estimatedCostCents: 12, legRef: { callControlId: "cc_m3_in_p" },
  });
  provenInbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  provenInbound.costTruedAt = new Date(nowMs).toISOString();

  const unprovenOutbound = makeDueOutboundCall(state, {
    nowMs, estimatedCostCents: 15, legRef: { callControlId: "cc_m3_out_u" },
  });
  unprovenOutbound.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  unprovenOutbound.costTruedAt = new Date(nowMs).toISOString();

  const neverAnswered = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_m3_never" } });
  neverAnswered.answeredAt = null;

  makeDueInboundCall(state, { nowMs, legRef: { callControlId: "cc_m3_noest" } });

  const outsideWindowMinutesAgo = (PROVIDER_COST_RECORD_WINDOW_DAYS + 1) * MINUTES_PER_DAY;
  const outsideWindow = makeDueOutboundCall(state, {
    nowMs, estimatedCostCents: 10, legRef: { callControlId: "cc_m3_old" },
    endedMinutesAgo: outsideWindowMinutesAgo,
  });
  outsideWindow.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  outsideWindow.costTruedAt = isoMinutesAgo(nowMs, outsideWindowMinutesAgo);

  const altValue = Math.floor((2 * 100) / 6);
  assert.equal(altValue, 33, "Kontrollrechnung der alten Formel, damit der Unterschied im Diff sichtbar bleibt");

  assert.equal(costTruingCoveragePercent(state, nowMs), 66, "floor(2/3*100) - Inbound zaehlt mit (KV-P3-Wechselwirkung)");
  assert.notEqual(costTruingCoveragePercent(state, nowMs), altValue, "die neue Formel weicht bewusst von der alten ab");
});

test("KV-M3-2 leerer Nenner: kein einziger belegbarer Call -> 0%, nicht NaN, nicht Infinity, nicht 100", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const never = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_m3_empty_never" } });
  never.answeredAt = null;
  makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_m3_empty_noest" } });

  const percent = costTruingCoveragePercent(state, nowMs);
  assert.equal(percent, 0);
  assert.ok(!Number.isNaN(percent));
  assert.ok(Number.isFinite(percent));
  assert.notEqual(percent, 100, "Nenner 0 ist KEIN Freispruch");
});

test("KV-M3-3 Fenstergrenze: genau PROVIDER_COST_RECORD_WINDOW_DAYS Tage sind noch belegbar, einen Tag mehr nicht", () => {
  const nowMs = Date.now();
  const atEdge = makeDefaultState();
  const c1 = makeDueOutboundCall(atEdge, {
    nowMs, estimatedCostCents: 10, legRef: { callControlId: "cc_m3_edge" },
    endedMinutesAgo: PROVIDER_COST_RECORD_WINDOW_DAYS * MINUTES_PER_DAY,
  });
  c1.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  assert.equal(costTruingCoveragePercent(atEdge, nowMs), 100, "auf der Grenze ist der Call noch belegbar");

  const overEdge = makeDefaultState();
  const c2 = makeDueOutboundCall(overEdge, {
    nowMs, estimatedCostCents: 10, legRef: { callControlId: "cc_m3_over" },
    endedMinutesAgo: PROVIDER_COST_RECORD_WINDOW_DAYS * MINUTES_PER_DAY + 1,
  });
  c2.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  assert.equal(costTruingCoveragePercent(overEdge, nowMs), 0, "eine Minute drueber -> nicht mehr belegbar, Nenner 0");
});

test("KV-M3-4 Sweep: die drei Nebenzaehler stehen IMMER in der Log-Zeile und im Rueckgabewert, mit den Werten der Fixture", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();

  const provenOutbound = makeDueOutboundCall(state, {
    nowMs, estimatedCostCents: 20, legRef: { callControlId: "cc_m3s_out_p" },
  });
  provenOutbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  provenOutbound.costTruedAt = new Date(nowMs).toISOString();

  const neverAnswered = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_m3s_never" } });
  neverAnswered.answeredAt = null;

  makeDueInboundCall(state, { nowMs, legRef: { callControlId: "cc_m3s_noest" } });

  const outsideWindowMinutesAgo = (PROVIDER_COST_RECORD_WINDOW_DAYS + 1) * MINUTES_PER_DAY;
  const outsideWindow = makeDueOutboundCall(state, {
    nowMs, estimatedCostCents: 10, legRef: { callControlId: "cc_m3s_old" },
    endedMinutesAgo: outsideWindowMinutesAgo,
  });
  outsideWindow.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  outsideWindow.costTruedAt = isoMinutesAgo(nowMs, outsideWindowMinutesAgo);

  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit: () => {}, now: () => nowMs,
  });

  let result;
  const logs = await captureConsole(async () => {
    result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  });

  const coverageLine = logs.find((line) => line.startsWith("[cost-truing] deckung="));
  assert.ok(coverageLine, "die Deckungszeile steht im Log");
  assert.match(
    coverageLine,
    /^\[cost-truing\] deckung=100% schwelle=80% ohne_schaetzung=1 nie_beantwortet=1 ausserhalb_fenster=1$/,
  );

  assert.equal(result.coveragePercent, 100);
  assert.equal(result.coverageNoEstimate, 1);
  assert.equal(result.coverageNeverAnswered, 1);
  assert.equal(result.coverageOutsideWindow, 1);
});
