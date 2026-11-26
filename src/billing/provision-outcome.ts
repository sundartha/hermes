import {
  NEEDS_MANUAL_RECONCILE_REASON,
  REQUEST_NUMBER_REASON,
} from "../begriffe/nummern-vergabe.ts";
import type { Ergebnis } from "../utils/ergebnis.ts";

interface Grund {
  reason?: string;
}

export type Provisionsergebnis = Ergebnis<Grund, string | Grund>;

export const PROVISION_REASON = Object.freeze({
  QUEUED: "queued",
  REDRIVE: "redrive",
  DRY_RUN: "dry_run",
  ALREADY_PROVISIONED: "already_provisioned",
  TENANT_CAP: REQUEST_NUMBER_REASON.TENANT_CAP,
  GLOBAL_CAP: REQUEST_NUMBER_REASON.GLOBAL_CAP,
  PERSIST_ERROR: "persist_error",
  NEEDS_MANUAL_RECONCILE: NEEDS_MANUAL_RECONCILE_REASON,
});

const CLEARING_REASONS: ReadonlySet<string | undefined> = Object.freeze(
  new Set([
    PROVISION_REASON.QUEUED,
    PROVISION_REASON.REDRIVE,
    PROVISION_REASON.DRY_RUN,
    PROVISION_REASON.ALREADY_PROVISIONED,
  ]),
);

export function provisionReason(result: Provisionsergebnis | null | undefined): string | undefined {
  if (result?.ok) return result.wert.reason;
  const grund = result?.fehler;
  return typeof grund === "string" ? grund : grund?.reason;
}

export function provisionCleared(result: Provisionsergebnis | null | undefined): boolean {
  return CLEARING_REASONS.has(provisionReason(result));
}

export function provisionAuditDetail(result: Provisionsergebnis | null | undefined): string {
  const grund = provisionReason(result);
  if (!grund) return "provision=none";
  return provisionCleared(result) ? `provision=${grund}` : `provision=withheld:${grund}`;
}
