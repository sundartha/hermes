function istNichtLeererString(wert) {
  return typeof wert === "string" && wert !== "";
}

export function calleeIsOwner({ to, ownNumber }) {
  return istNichtLeererString(to) && istNichtLeererString(ownNumber) && to === ownNumber;
}

function tenantDarfAusloesen(tenantId, allowedTenantIds) {
  if (!istNichtLeererString(tenantId)) return false;
  if (!Array.isArray(allowedTenantIds)) return false;
  return allowedTenantIds.includes(tenantId);
}

export function ownerSelfCallGranted({ to, ownNumber, tenantId, enabled, allowedTenantIds }) {
  if (enabled !== true) return false;
  if (!tenantDarfAusloesen(tenantId, allowedTenantIds)) return false;
  return calleeIsOwner({ to, ownNumber });
}

export function callerIsOwnerGranted({ from, ownNumber, tenantId, enabled, allowedTenantIds }) {
  if (enabled !== true) return false;
  if (!tenantDarfAusloesen(tenantId, allowedTenantIds)) return false;
  return calleeIsOwner({ to: from, ownNumber });
}
