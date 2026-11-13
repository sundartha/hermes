import * as ops from "../store/state-ops.js";
import { NUMBER_DISPLAY_STATUS, numberStatusFor } from "../store/views.js";
import { PM_TYPE_OUTCOME, fillPaymentMethodType } from "./payment-method-type-reconcile.ts";
import { PROVISION_RETRY_OUTCOME, retriggerFailedProvisioning } from "./provision-retry.ts";

const FRIST_BUCKET_PREFIX = "provision-retry:";
const SWEEP_EVENT = "provision_retry_sweep";
const LOG_PREFIX = "[provision-retry-sweep]";

export const provisionRetryBucket = (tenantId: string): string => `${FRIST_BUCKET_PREFIX}${tenantId}`;

type Zaehler = "angestossen" | "gedrosselt" | "erschoepft" | "ungeeignet";

type TypNachtrag = Parameters<typeof fillPaymentMethodType>[0];

type SweepStore = TypNachtrag["store"] & {
  save: () => void;
  withStoreLock: <T>(arbeit: () => T) => Promise<T>;
};

type Billing = TypNachtrag["billing"];

interface SweepConfig {
  provisioning: { provisioningRetryMinIntervalMs: number; provisioningRetryMaxAttempts: number };
}

interface SweepDeps {
  store: SweepStore;
  config: SweepConfig;
  provision: (tenantId: string) => Promise<unknown>;
  audit: Audit;
  billing?: Billing | null;
}

const offenerAusfall: (state: unknown, code: string) => { lastSeenAt?: string | null } | null = ops.openOutageAlert;

const stripeDatenOf: (
  state: unknown,
  tenantId: string,
) => { paymentMethodId?: string | null; paymentMethodType?: string | null } = ops.tenantStripe;

const alleMandantenIds: (state: unknown) => string[] = ops.allTenantIds;

type Audit = (event: string, actor: null, detail: string) => void;

interface Frist {
  tenantId: string;
  nowMs: number;
  minIntervalMs: number;
}

const ZAEHLER_JE_AUSGANG: Readonly<Record<string, Zaehler>> = Object.freeze({
  [PROVISION_RETRY_OUTCOME.RETRY]: "angestossen",
  [PROVISION_RETRY_OUTCOME.THROTTLED]: "gedrosselt",
  [PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED]: "erschoepft",
  [PROVISION_RETRY_OUTCOME.PAYMENT_METHOD_UNSUITABLE]: "ungeeignet",
});

const AUDIT_AUSGAENGE: ReadonlySet<string> = new Set([
  PROVISION_RETRY_OUTCOME.RETRY,
  PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED,
]);

export function provisionRetryDue(state: unknown, { tenantId, nowMs, minIntervalMs }: Frist): boolean {
  const marker = offenerAusfall(state, provisionRetryBucket(tenantId));
  if (!marker?.lastSeenAt) return true;
  const letzteMs = Date.parse(marker.lastSeenAt);
  if (Number.isNaN(letzteMs)) return false;
  return nowMs - letzteMs >= minIntervalMs;
}

async function beanspruche({ store, tenantId, nowMs, minIntervalMs }: Frist & { store: SweepStore }): Promise<boolean> {
  const beansprucht = await store.withStoreLock(() => {
    const state = store.load();
    if (!provisionRetryDue(state, { tenantId, nowMs, minIntervalMs })) return false;
    ops.claimOutageAlert(state, { code: provisionRetryBucket(tenantId), nowMs });
    return true;
  });
  store.save();
  return beansprucht;
}

function zaehleAusgaenge(ausgaenge: string[]): Record<Zaehler, number> {
  const zaehler: Record<Zaehler, number> = { angestossen: 0, gedrosselt: 0, erschoepft: 0, ungeeignet: 0 };
  for (const outcome of ausgaenge) {
    const name = ZAEHLER_JE_AUSGANG[outcome];
    if (name) zaehler[name] += 1;
  }
  return zaehler;
}

function meldeAusgang({
  audit,
  tenantId,
  entscheidung,
}: {
  audit: Audit;
  tenantId: string;
  entscheidung: { outcome: string; attempts: number };
}): void {
  if (!AUDIT_AUSGAENGE.has(entscheidung.outcome)) return;
  audit(
    SWEEP_EVENT,
    null,
    `tenant=${tenantId} ausgang=${entscheidung.outcome} versuche=${String(entscheidung.attempts)}`,
  );
}

async function heileUnbekanntenTyp({
  store,
  billing,
  tenantId,
}: {
  store: SweepStore;
  billing: Billing | null;
  tenantId: string;
}): Promise<string | null> {
  if (!billing || typeof billing.retrievePaymentMethodType !== "function") return null;
  const state = store.load();
  if (numberStatusFor(state, tenantId) !== NUMBER_DISPLAY_STATUS.FAILED) return null;
  const { paymentMethodId, paymentMethodType } = stripeDatenOf(state, tenantId);
  if (!paymentMethodId || paymentMethodType) return null;
  const { outcome } = await fillPaymentMethodType({
    store,
    billing,
    tenant: { id: tenantId, stripePaymentMethodId: paymentMethodId },
    apply: true,
  });
  if (outcome === PM_TYPE_OUTCOME.FILLED) store.save();
  return outcome;
}

export async function runProvisionRetrySweep({
  store,
  config,
  provision,
  audit,
  billing = null,
  nowMs = Date.now(),
}: SweepDeps & { nowMs?: number }): Promise<void> {
  try {
    const minIntervalMs = config.provisioning.provisioningRetryMinIntervalMs;
    if (minIntervalMs <= 0) return;
    const maxAttempts = config.provisioning.provisioningRetryMaxAttempts;
    const tenantIds = alleMandantenIds(store.load());
    const ausgaenge: string[] = [];
    for (const tenantId of tenantIds) {
      await heileUnbekanntenTyp({ store, billing, tenantId });
      const entscheidung = await retriggerFailedProvisioning({
        store,
        provision,
        tenantId,
        maxAttempts,
        claimAttempt: () => beanspruche({ store, tenantId, nowMs, minIntervalMs }),
      });
      ausgaenge.push(entscheidung.outcome);
      meldeAusgang({ audit, tenantId, entscheidung });
    }
    const zaehler = zaehleAusgaenge(ausgaenge);
    console.log(
      `${LOG_PREFIX} geprueft=${String(tenantIds.length)} angestossen=${String(zaehler.angestossen)} ` +
        `gedrosselt=${String(zaehler.gedrosselt)} erschoepft=${String(zaehler.erschoepft)} ungeeignet=${String(zaehler.ungeeignet)}`,
    );
  } catch (err) {
    console.error(LOG_PREFIX, err instanceof Error ? err.message : String(err));
  }
}

export function makeProvisionRetryWatch({ store, config, provision, audit, billing = null }: SweepDeps): {
  runProvisionRetrySweep: () => Promise<void>;
} {
  return {
    runProvisionRetrySweep: () => runProvisionRetrySweep({ store, config, provision, audit, billing }),
  };
}
