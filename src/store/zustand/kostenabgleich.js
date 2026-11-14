import { actualCostMicroCentsForMonth, carrierGateCostCentsForMonth, crossCheckDueMonthKey } from "./nutzung.js";

export function abgleichZustand(state) {
  return { calls: state.calls, callCostEvidence: state.callCostEvidence };
}

export function querpruefungMonat(state, nowIso) {
  return crossCheckDueMonthKey(state, nowIso);
}

export function querpruefungSummen(state, { monthKey, belegSummeJeTraeger }) {
  return {
    traegerSummen: belegSummeJeTraeger({ state, monthKey }),
    istGesamtMicroCents: actualCostMicroCentsForMonth(state, monthKey),
    gateCarrierEurCents: carrierGateCostCentsForMonth(state, monthKey),
  };
}
