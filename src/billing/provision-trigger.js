// Reiner Decision-Core des Webhook-Aktivierungs-Provisionings (BK3): fragt fuer einen
// bezahlten Tenant HOECHSTENS eine Nummer an, idempotent ueber den tenantHasLiveNumber-
// Guard. EINE Quelle (G5) fuer "Abo aktiv -> welche Nummer anfragen?" - server.js
// (triggerTenantProvisioning) UND die Tests rufen dieselbe Funktion, keine Replik.
// Pure: kein store.save, kein config-Zugriff, kein Audit/Log (Command-Query-Trennung,
// P5/P6) - Caps + Fallback-Land kommen als Argumente herein (testbar mit makeDefaultState).
// Verhaltens-identisch zur bisherigen Inline-Komposition (provider TELNYX explizit, weil
// DEFAULT_PROVIDER = TWILIO; Land aus Tenant-Geo mit Fallback; Sprache aus dem Land).
import { tenantHasLiveNumber, tenantGeo, requestNumber } from "../store/state-ops.js";
import { languageForCountry } from "../i18n/locales.js";
import { PROVIDER } from "../store/defaults.js";

// Ein Options-Objekt (F1): tenantId + die drei config-abgeleiteten Werte reisen zusammen.
export function requestNumberForPaidTenant(
  s,
  { tenantId, fallbackCountry, maxNumbers, maxNumbersPerTenant },
) {
  // Idempotenz (Invariante 4): hat der Tenant schon eine lebende Nummer (requested/
  // active), wird KEINE zweite angefragt (Webhook-Retry / Folge-'updated' kauft nie doppelt).
  if (tenantHasLiveNumber(s, tenantId))
    return { ok: false, reason: "already_provisioned" };
  const country = tenantGeo(s, tenantId).country || fallbackCountry;
  return requestNumber(s, {
    tenantId,
    provider: PROVIDER.TELNYX,
    country,
    language: languageForCountry(country),
    maxNumbers,
    maxNumbersPerTenant,
  });
}
