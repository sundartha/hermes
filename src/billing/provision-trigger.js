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
import {
  tenantHasLiveNumber,
  tenantGeo,
  requestNumber,
  redriveAgeHoldReason,
} from "../store/state-ops.js";
import { languageForCountry } from "../i18n/locales.js";
import { PROVIDER, NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../store/defaults.js";
// Fix A1 (Runde 1, G5): Kauf-Land-Override-Kombination (forceNumberCountry || homeCountry)
// lebt EINMAL in geo/resolve.js - dieselbe Funktion nutzt numberSetupFeeCentsFor
// (self-service-routes.js), keine zweite Inline-Kopie der "wer gewinnt"-Logik hier.
import { resolveNumberCountry } from "../geo/resolve.js";

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
  const numberCountry = resolveNumberCountry(homeCountry, forceNumberCountry);
  return requestNumber(s, {
    tenantId,
    provider: PROVIDER.TELNYX,
    country: numberCountry,
    language: languageForCountry(homeCountry),
    maxNumbers,
    maxNumbersPerTenant,
  });
}

// PROV-01/F7: Retry-Lever-Entscheidung. Vor dem Anfragen einer NEUEN Nummer prueft der
// Operator-Re-Trigger (POST /api/onboard/retry, ueber triggerTenantProvisioning), ob der
// Tenant eine in 'requested' HAENGENDE Nummer MIT noch QUEUED-Job hat (Crash zwischen
// Enqueue und Drain, PROV-01). Ein junger stuck-Job wird geld-sicher NACHGEFUEHRT (redrive:
// dieselbe numberId/derselbe Job -> KEIN Doppelkauf, nur innerhalb des Anbieter-Idempotenz-
// Fensters ueber das geteilte Alters-Gate); zu alt / alters-unbekannt -> KEIN Auto-Kauf,
// Verweis an den Owner-Reconcile (needs_manual_reconcile). Kein stuck-Zustand -> unveraenderter
// Fallthrough auf requestNumberForPaidTenant (aktive/requested-ohne-Job -> already_provisioned;
// terminal 'failed' -> frische 'requested'-Nummer, Bestandsschutz). REIN: liest s, mutiert NICHT
// (der fresh-Pfad mutiert via requestNumber wie bisher); nowMs/maxAgeMs kommen als Argument
// (config-frei, testbar/repeatable). Abo/KYC-Gate liegt beim Aufrufer (Route: tenantActive-
// Subscriber VOR dem Trigger) - hier NICHT dupliziert. opts ist der Superset von requestNumber-
// ForPaidTenant-opts (+ nowMs/maxAgeMs); die Extra-Keys werden dort ignoriert.
export function resolveProvisionRetry(s, opts) {
  const stuck = findStuckRequestedProvision(s, opts.tenantId);
  if (!stuck) return requestNumberForPaidTenant(s, opts);
  if (redriveAgeHoldReason(stuck.job, opts.nowMs, opts.maxAgeMs))
    return { ok: false, reason: "needs_manual_reconcile" };
  return { ok: true, reason: "redrive", numberId: stuck.number.id, jobId: stuck.job.id, job: stuck.job };
}

// Findet die eine "stuck" Kombination eines Tenants: eine REQUESTED-Nummer, zu der noch ein
// QUEUED-Job existiert (Enqueue persistiert, Drain nie gelaufen). Liefert {number, job} oder
// null. EIN Scan (kein find-dann-refind, G5). Aktive/terminale Nummern und requested-Nummern
// OHNE offenen Job sind KEIN stuck-Fall -> null -> regulaerer requestNumberForPaidTenant-Pfad.
function findStuckRequestedProvision(s, tenantId) {
  for (const number of s.numbers) {
    if (number.tenantId !== tenantId || number.status !== NUMBER_STATUS.REQUESTED) continue;
    const job = s.provisioningJobs.find(
      (j) => j.numberId === number.id && j.status === PROVISIONING_JOB_STATUS.QUEUED,
    );
    if (job) return { number, job };
  }
  return null;
}
