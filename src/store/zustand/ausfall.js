import {
  claimOutageAlert,
  closeOutageAlert,
  openOutageAlert,
  platformHoldEscalationCandidates,
} from "./nummern.js";

export function sendeplatzReserviert(state, { bucket, nowMs }) {
  const reserviertAm = new Date(nowMs).toISOString();
  return state.outageAlerts.some((alert) => alert.code === bucket && alert.lastAttemptAt === reserviertAm);
}

export function sendeplatzReservieren(state, { bucket, nowMs, frei }) {
  if (!frei(openOutageAlert(state, bucket))) return false;
  claimOutageAlert(state, { code: bucket, nowMs, sent: true, channels: [] });
  return true;
}

export function urteilClaimen(state, { bucket, nowMs, beurteile, istAlarm }) {
  const ergebnis = beurteile({ calls: state.calls, marker: openOutageAlert(state, bucket) });
  if (istAlarm(ergebnis)) claimOutageAlert(state, { code: bucket, nowMs, sent: true, channels: [] });
  return ergebnis;
}

export function alarmVersendet(state, { code, nowMs, channels }) {
  claimOutageAlert(state, { code, nowMs, sent: true, channels });
}

export function notizClaimen(state, { code, nowMs }) {
  claimOutageAlert(state, { code, nowMs });
}

export function markerSchliessen(state, { code, nowMs }) {
  closeOutageAlert(state, { code, nowMs });
}

export function holdEskalationClaimen(state, { bucket, nowMs }) {
  if (openOutageAlert(state, bucket)) return false;
  claimOutageAlert(state, { code: bucket, nowMs, sent: true, channels: [] });
  return true;
}

export function selbsttestClaimen(state, { bucket, nowMs, faellig }) {
  const istFaellig = faellig(openOutageAlert(state, bucket));
  if (istFaellig) claimOutageAlert(state, { code: bucket, nowMs, sent: true, channels: [] });
  return istFaellig;
}

export function offeneAusfallZustand(state) {
  return { calls: state.calls, outageAlerts: state.outageAlerts.filter((alert) => alert.closedAt === null) };
}

export function holdKandidaten(state, { nowMs, maxAgeMs }) {
  return platformHoldEscalationCandidates(state, { nowMs, maxAgeMs });
}
