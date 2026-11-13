import {
  NEEDS_MANUAL_RECONCILE_REASON,
  REQUEST_NUMBER_REASON,
} from "../begriffe/nummern-vergabe.js";

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

export function provisionCleared(result: { reason?: string } | null | undefined): boolean {
  return CLEARING_REASONS.has(result?.reason);
}

export function provisionAuditDetail(result: { reason?: string } | null | undefined): string {
  if (!result?.reason) return "provision=none";
  return provisionCleared(result) ? `provision=${result.reason}` : `provision=withheld:${result.reason}`;
}
