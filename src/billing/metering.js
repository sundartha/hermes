import { config as defaultConfig } from "../config.js";
import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { callStartAnchorMs, carrierEndMsOf, chargeAnchorsOfUsage, numbersDueForMonthMeter } from "../store/state-ops.js";
import { tariffCentsPerMin } from "../telephony/outbound-gates.js";
import { MS_PER_MINUTE } from "../utils/timer.js";
import { KOSTENPROFIL } from "./kostenarten.js";

export function voiceMinutesOf(call) {
  if (!call.answeredAt || !call.endedAt) return 0;
  const minutes = Math.ceil((new Date(call.endedAt) - new Date(call.answeredAt)) / MS_PER_MINUTE);
  return Number.isFinite(minutes) ? minutes : 0;
}

export function callTariffCentsPerMin(call) {
  if (billsCalibratedInboundRate(call)) return defaultConfig.billing.voiceTariffInboundCents;
  return tariffCentsPerMin(call.to, call.from);
}

function billsCalibratedInboundRate(call) {
  return call.direction === "inbound" && call.costProfile !== KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
}

function liveVoiceMinutesOf(call, nowMs) {
  const elapsedMs = carrierEndMsOf(call, nowMs) - callStartAnchorMs(call);
  if (!Number.isFinite(elapsedMs)) return NaN;
  return Math.max(0, Math.ceil(elapsedMs / MS_PER_MINUTE));
}

export function liveVoiceSpendCents(activeCalls, nowMs) {
  return activeCalls.reduce(
    (sum, call) => sum + liveVoiceMinutesOf(call, nowMs) * callTariffCentsPerMin(call),
    0,
  );
}

export function makeMetering({ store }) {
  function recordVoiceMinuteMeter(call) {
    const minutes = voiceMinutesOf(call);
    if (minutes <= 0) return;
    store.recordUsageEvent({
      tenantId: call.tenantId,
      callId: call.id,
      kind: USAGE_EVENT_KIND.VOICE_MINUTE,
      quantity: minutes,
      costCents: minutes * callTariffCentsPerMin(call),
    });
  }

  function reconcileVoiceBudget(call) {
    const minutes = voiceMinutesOf(call);
    if (minutes <= 0) return;
    const estimatedCostCents = minutes * callTariffCentsPerMin(call);
    const usage = store.addVoiceUsageCostCents(call.tenantId, estimatedCostCents);
    store.recordCallEstimatedCostCents(call.id, {
      costCents: estimatedCostCents,
      chargeAnchors: chargeAnchorsOfUsage(usage),
    });
  }

  function monthlyRentCents(number) {
    return Number.isInteger(number.monthlyCostCents) ? number.monthlyCostCents : null;
  }

  function recordNumberMonthMeter(number, nowIso) {
    if (!number) return false;
    const costCents = monthlyRentCents(number);
    if (costCents === null) return false;
    store.recordUsageEvent({
      tenantId: number.tenantId,
      numberId: number.id,
      kind: USAGE_EVENT_KIND.NUMBER_MONTH,
      quantity: 1,
      costCents,
      occurredAt: nowIso,
    });
    return true;
  }

  function recordDueNumberMonthMeters(s, { nowIso, tenantId = null }) {
    const faellige = numbersDueForMonthMeter(s, { nowIso, tenantId });
    let gebucht = 0;
    let ohnePreis = 0;
    let fehler = 0;
    for (const number of faellige) {
      try {
        if (recordNumberMonthMeter(number, nowIso)) gebucht++;
        else ohnePreis++;
      } catch (err) {
        fehler++;
        console.error(`[number-month] Beleg fehlgeschlagen number=${number.id}:`, err.message);
      }
    }
    return { faellig: faellige.length, gebucht, ohnePreis, fehler };
  }

  return {
    voiceMinutesOf,
    recordVoiceMinuteMeter,
    reconcileVoiceBudget,
    recordNumberMonthMeter,
    recordDueNumberMonthMeters,
  };
}
