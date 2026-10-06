import { MS_PER_MINUTE } from "../utils/timer.js";
import { reasonWithoutCarrier } from "./failure-reason.js";

export const OUTAGE_VERDICT = Object.freeze({
  OFF: "aus",
  NONE: "kein-befund",
  FIRST: "erstbefund",
  ALERT: "alarm",
  RECOVERED: "erholt",
});

export const MIN_TENANTS_SHARED_FAULT = 2;

const PERCENT_BASE = 100;

export const outageBucket = reasonWithoutCarrier;

export const ZAEHLWEISE_OUTBOUND = Object.freeze({
  zaehltMit: (call) => call.direction === "outbound",
  belegtErfolg: (call) => Boolean(call.answeredAt),
  belegtFehler: (call, bucket) => outageBucket(call.failureReason) === bucket,
});

export function outageWindow(calls, { nowMs, windowMs, bucket, zaehlweise = ZAEHLWEISE_OUTBOUND }) {
  const zahlen = { fehler: 0, versuche: 0, erfolge: 0, tenants: 0 };
  const betroffeneTenants = new Set();
  for (const call of calls) {
    if (!zaehlweise.zaehltMit(call)) continue;
    const endedMs = Date.parse(call.endedAt || "");
    if (Number.isNaN(endedMs) || endedMs < nowMs - windowMs || endedMs > nowMs) continue;
    zahlen.versuche += 1;
    if (zaehlweise.belegtErfolg(call)) {
      zahlen.erfolge += 1;
      continue;
    }
    if (!zaehlweise.belegtFehler(call, bucket)) continue;
    zahlen.fehler += 1;
    betroffeneTenants.add(call.tenantId);
  }
  zahlen.tenants = betroffeneTenants.size;
  return zahlen;
}

export function meldeErlaubt(marker, nowMs, { debounceMs, retryMs }) {
  if (marker.reportedAt) return nowMs - Date.parse(marker.reportedAt) >= debounceMs;
  if (marker.lastAttemptAt) return nowMs - Date.parse(marker.lastAttemptAt) >= retryMs;
  return true;
}

function kleinesVolumenAlarm(fenster, schwellen) {
  return (
    fenster.versuche < schwellen.minAttempts &&
    fenster.fehler >= schwellen.minFailures &&
    (fenster.erfolge === 0 || fenster.tenants >= MIN_TENANTS_SHARED_FAULT)
  );
}

function skalaAlarm(fenster, schwellen) {
  return (
    fenster.versuche >= schwellen.minAttempts &&
    fenster.fehler * PERCENT_BASE >= fenster.versuche * schwellen.failSharePercent
  );
}

export function beurteileAusfall({ fenster, marker, schwellen, nowMs }) {
  if (schwellen.windowMs === 0) return { urteil: OUTAGE_VERDICT.OFF, zahlen: fenster };
  if (fenster.fehler === 0) {
    const erholtBelegt = !!marker && fenster.erfolge > 0;
    return { urteil: erholtBelegt ? OUTAGE_VERDICT.RECOVERED : OUTAGE_VERDICT.NONE, zahlen: fenster };
  }
  if (!marker) return { urteil: OUTAGE_VERDICT.FIRST, zahlen: fenster };
  const alarmBedingungErfuellt = kleinesVolumenAlarm(fenster, schwellen) || skalaAlarm(fenster, schwellen);
  const urteil =
    alarmBedingungErfuellt && meldeErlaubt(marker, nowMs, schwellen)
      ? OUTAGE_VERDICT.ALERT
      : OUTAGE_VERDICT.NONE;
  return { urteil, zahlen: fenster };
}

export function alarmZeile({ code, zahlen, regel, windowMs }) {
  const fensterMin = Math.round(windowMs / MS_PER_MINUTE);
  return (
    "Hermes Betriebsmeldung\n" +
    `klasse=${code} fehler=${zahlen.fehler} versuche=${zahlen.versuche} ` +
    `erfolge=${zahlen.erfolge} tenants=${zahlen.tenants} fenster_min=${fensterMin} regel=${regel}`
  );
}
