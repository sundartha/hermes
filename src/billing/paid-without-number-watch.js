import { meldeBetreiberNotiz } from "../telephony/outage-report.js";
import * as ops from "../store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../store/defaults.js";

const BEFUND_BUCKET_PREFIX = "paid-no-number:";
const BEFUND_EVENT = "paid_without_number";
const BEHOBEN_EVENT = "paid_without_number_recovered";

export const paidWithoutNumberBucket = (tenantId) => `${BEFUND_BUCKET_PREFIX}${tenantId}`;

const istBefundBucket = (code) => code.startsWith(BEFUND_BUCKET_PREFIX);

function befundZeile({ tenantId, paidSinceIso }) {
  return `tenant=${tenantId} zahlend_seit=${paidSinceIso}`;
}

async function meldeMandant({ store, audit, kandidat, nowMs }) {
  const bucket = paidWithoutNumberBucket(kandidat.tenantId);
  const zuMelden = await store.withStoreLock(() => {
    const state = store.load();
    if (ops.openOutageAlert(state, bucket)) return false;
    ops.claimOutageAlert(state, { code: bucket, nowMs });
    return true;
  });
  store.save();
  if (!zuMelden) return;
  const zeile = befundZeile(kandidat);
  await meldeBetreiberNotiz({ store, audit, bucket, aktion: BEFUND_EVENT, zeile, nowMs });
}

async function schliesseBehobene({ store, audit, aktuelleBuckets, nowMs }) {
  const geschlossen = await store.withStoreLock(() => {
    const state = store.load();
    const offene = state.outageAlerts.filter(
      (alert) => alert.closedAt === null && istBefundBucket(alert.code) && !aktuelleBuckets.has(alert.code),
    );
    for (const marker of offene) ops.closeOutageAlert(state, { code: marker.code, nowMs });
    return offene.length;
  });
  store.save();
  if (geschlossen === 0) return;
  const zeile = `marker=${geschlossen}`;
  console.log(`[paid-no-number] behoben ${zeile}`);
  audit(BEHOBEN_EVENT, null, zeile);
}

export async function runPaidWithoutNumberSweep({ store, config, audit, nowMs = Date.now() }) {
  try {
    const graceMs = config.billing.paidWithoutNumberGraceMs;
    if (graceMs <= 0) return;
    const kandidaten = ops.paidWithoutNumberCandidates(store.load(), {
      nowMs,
      graceMs,
      kycMinLevel: KYC_OUTBOUND_MIN,
    });
    console.log(`[paid-no-number] kandidaten=${kandidaten.length}`);
    for (const kandidat of kandidaten) await meldeMandant({ store, audit, kandidat, nowMs });
    const aktuelleBuckets = new Set(kandidaten.map((kandidat) => paidWithoutNumberBucket(kandidat.tenantId)));
    await schliesseBehobene({ store, audit, aktuelleBuckets, nowMs });
  } catch (err) {
    console.error("[paid-no-number]", err.message);
  }
}

export function makePaidWithoutNumberWatch({ store, config, audit }) {
  return { runPaidWithoutNumberSweep: () => runPaidWithoutNumberSweep({ store, config, audit }) };
}
