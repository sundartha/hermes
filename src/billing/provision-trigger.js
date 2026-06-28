// Reiner Decision-Core des Webhook-Aktivierungs-Provisionings (BK3): fragt fuer einen
// bezahlten Tenant HOECHSTENS eine Nummer an, idempotent ueber den tenantHasLiveNumber-
// Guard. EINE Quelle (G5) fuer "Abo aktiv -> welche Nummer anfragen?" - server.js
// (triggerTenantProvisioning) UND die Tests rufen dieselbe Funktion, keine Replik.
// Pure: kein store.save, kein config-Zugriff, kein Audit/Log (Command-Query-Trennung,
// P5/P6) - Caps + Fallback-Land + Kauf-Land-Override kommen als Argumente herein (testbar
// mit makeDefaultState). Verhaltens-identisch zur bisherigen Inline-Komposition (provider
// TELNYX explizit, weil DEFAULT_PROVIDER = TWILIO; Herkunftsland aus Tenant-Geo mit
// Fallback; Sprache aus dem HERKUNFTSland). KAUF-Land entkoppelt: forceNumberCountry
// (z.B. "US") ueberschreibt NUR number.country, nie die Sprache - leer = byte-identisch.
import { tenantHasLiveNumber, tenantGeo, requestNumber } from "../store/state-ops.js";
import { languageForCountry } from "../i18n/locales.js";
import { PROVIDER } from "../store/defaults.js";

// Ein Options-Objekt (F1): tenantId + die config-abgeleiteten Werte reisen zusammen.
export function requestNumberForPaidTenant(
  s,
  { tenantId, fallbackCountry, forceNumberCountry, maxNumbers, maxNumbersPerTenant },
) {
  // Idempotenz (Invariante 4): hat der Tenant schon eine lebende Nummer (requested/
  // active), wird KEINE zweite angefragt (Webhook-Retry / Folge-'updated' kauft nie doppelt).
  if (tenantHasLiveNumber(s, tenantId))
    return { ok: false, reason: "already_provisioned" };
  // Herkunftsland = Quelle der Sprache; Kauf-Land = wo die Nummer entsteht. forceNumber-
  // Country (z.B. "US") trennt beide: leer/undefined -> Kauf-Land = Herkunftsland
  // (byte-identisch). Die Sprache bleibt IMMER am Herkunftsland (homeCountry).
  const homeCountry = tenantGeo(s, tenantId).country || fallbackCountry;
  const numberCountry = forceNumberCountry || homeCountry;
  return requestNumber(s, {
    tenantId,
    provider: PROVIDER.TELNYX,
    country: numberCountry,
    language: languageForCountry(homeCountry),
    maxNumbers,
    maxNumbersPerTenant,
  });
}
