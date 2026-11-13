import { meldeBetreiberNotiz } from "../telephony/outage-report.js";
import * as ops from "../store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../begriffe/mandant.js";
import { schliesseMarker as schliesseMarkerUntypisiert } from "./price-drift-watch.js";

interface Store {
  load: () => unknown;
  save: () => unknown;
  withStoreLock: <Result>(fn: () => Result) => Promise<Result>;
}

type Audit = (event: string, actor: null, detail: string) => unknown;

interface Config {
  billing: { paidWithoutNumberGraceMs: number };
}

interface Kandidat {
  tenantId: string;
  paidSinceIso: string;
}

const schliesseMarker: (args: {
  store: Store;
  istZuSchliessen: (code: string) => boolean;
  nowMs: number;
}) => Promise<number> = schliesseMarkerUntypisiert;

const befundKandidaten: (
  state: unknown,
  auswahl: { nowMs: number; graceMs: number; kycMinLevel: string },
) => Kandidat[] = ops.paidWithoutNumberCandidates;

const BEFUND_BUCKET_PREFIX = "paid-no-number:";
const BEFUND_EVENT = "paid_without_number";
const BEHOBEN_EVENT = "paid_without_number_recovered";

export const paidWithoutNumberBucket = (tenantId: string): string => `${BEFUND_BUCKET_PREFIX}${tenantId}`;

const istBefundBucket = (code: string): boolean => code.startsWith(BEFUND_BUCKET_PREFIX);

function befundZeile({ tenantId, paidSinceIso }: Kandidat): string {
  return `tenant=${tenantId} zahlend_seit=${paidSinceIso}`;
}

async function meldeMandant({
  store,
  audit,
  kandidat,
  nowMs,
}: {
  store: Store;
  audit: Audit;
  kandidat: Kandidat;
  nowMs: number;
}): Promise<void> {
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

async function schliesseBehobene({
  store,
  audit,
  aktuelleBuckets,
  nowMs,
}: {
  store: Store;
  audit: Audit;
  aktuelleBuckets: ReadonlySet<string>;
  nowMs: number;
}): Promise<void> {
  const geschlossen = await schliesseMarker({
    store, nowMs,
    istZuSchliessen: (code: string) => istBefundBucket(code) && !aktuelleBuckets.has(code),
  });
  if (geschlossen === 0) return;
  const zeile = `marker=${String(geschlossen)}`;
  console.log(`[paid-no-number] behoben ${zeile}`);
  audit(BEHOBEN_EVENT, null, zeile);
}

export async function runPaidWithoutNumberSweep({
  store,
  config,
  audit,
  nowMs = Date.now(),
}: {
  store: Store;
  config: Config;
  audit: Audit;
  nowMs?: number;
}): Promise<void> {
  try {
    const graceMs = config.billing.paidWithoutNumberGraceMs;
    if (graceMs <= 0) return;
    const kandidaten = befundKandidaten(store.load(), {
      nowMs,
      graceMs,
      kycMinLevel: KYC_OUTBOUND_MIN,
    });
    console.log(`[paid-no-number] kandidaten=${String(kandidaten.length)}`);
    for (const kandidat of kandidaten) await meldeMandant({ store, audit, kandidat, nowMs });
    const aktuelleBuckets = new Set(kandidaten.map((kandidat) => paidWithoutNumberBucket(kandidat.tenantId)));
    await schliesseBehobene({ store, audit, aktuelleBuckets, nowMs });
  } catch (err) {
    console.error("[paid-no-number]", err instanceof Error ? err.message : String(err));
  }
}

export function makePaidWithoutNumberWatch({ store, config, audit }: { store: Store; config: Config; audit: Audit }): {
  runPaidWithoutNumberSweep: () => Promise<void>;
} {
  return { runPaidWithoutNumberSweep: () => runPaidWithoutNumberSweep({ store, config, audit }) };
}
