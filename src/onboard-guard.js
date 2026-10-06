export const SUB_ALREADY_MERGED_ERROR = "Dieser Account ist bereits einem Tenant zugeordnet.";

export function checkSubAlreadyMerged({ sub, tenantId, resolveTenant }) {
  if (!sub) return null;
  const canonical = resolveTenant(sub);
  if (canonical && canonical !== tenantId) {
    return { status: 409, error: SUB_ALREADY_MERGED_ERROR };
  }
  return null;
}
