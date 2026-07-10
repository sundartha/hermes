// Onboard-Guard (tenant-prolif-b): reine Bedingung, ob ein sub das Onboarding fortsetzen
// darf. Ist der sub bereits (per Email-Merge, Phase A) an einen ANDEREN als den
// t_<sub>-Tenant gebunden, wuerde registerTenant einen Zweit-Tenant anlegen -> Tenant-/
// Nummern-Proliferation (die Wurzel dieser Kette, inkl. echtem Telnyx-DID-Kauf). Rein
// (kein IO/Express, resolveTenant wird injiziert) -> isoliert unit-testbar ohne
// Store/HTTP. Der Aufrufer (server.js /api/onboard) reicht store.resolveTenant durch -
// derselbe reine Lese-Check, den auch der MCP/REST-Kanal nutzt (G5, EINE Quelle).
export const SUB_ALREADY_MERGED_ERROR = "Dieser Account ist bereits einem Tenant zugeordnet.";

// Liefert bei Verstoss {status, error} (Status+Error-Shape EINE Quelle mit dem
// Aufrufer, der sie 1:1 in die Response spiegelt), sonst null (Guard erlaubt das
// Onboarding). Ohne sub (Operator-Pfad ohne idpSubject) immer null - byte-identisch
// zum Bestand.
export function checkSubAlreadyMerged({ sub, tenantId, resolveTenant }) {
  if (!sub) return null;
  const canonical = resolveTenant(sub);
  if (canonical && canonical !== tenantId) {
    return { status: 409, error: SUB_ALREADY_MERGED_ERROR };
  }
  return null;
}
