function istNichtLeererString(wert: unknown): boolean {
  return typeof wert === "string" && wert !== "";
}

export function calleeIsOwner({ to, ownNumber }: { to: unknown; ownNumber: unknown }): boolean {
  return istNichtLeererString(to) && istNichtLeererString(ownNumber) && to === ownNumber;
}

function tenantDarfAusloesen(tenantId: unknown, allowedTenantIds: unknown): boolean {
  if (!istNichtLeererString(tenantId)) return false;
  if (!Array.isArray(allowedTenantIds)) return false;
  return allowedTenantIds.includes(tenantId);
}

export function ownerSelfCallGranted({
  to,
  ownNumber,
  tenantId,
  enabled,
  allowedTenantIds,
}: {
  to: unknown;
  ownNumber: string | null | undefined | (() => unknown);
  tenantId: unknown;
  enabled: unknown;
  allowedTenantIds: unknown;
}): boolean {
  if (enabled !== true) return false;
  if (!tenantDarfAusloesen(tenantId, allowedTenantIds)) return false;
  return calleeIsOwner({ to, ownNumber: typeof ownNumber === "function" ? ownNumber() : ownNumber });
}

export function callerIsOwnerGranted({
  from,
  ownNumber,
  tenantId,
  enabled,
  allowedTenantIds,
}: {
  from: unknown;
  ownNumber: unknown;
  tenantId: unknown;
  enabled: unknown;
  allowedTenantIds: unknown;
}): boolean {
  if (enabled !== true) return false;
  if (!tenantDarfAusloesen(tenantId, allowedTenantIds)) return false;
  return calleeIsOwner({ to: from, ownNumber });
}
