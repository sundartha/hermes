// Schreibfreier Resolver Plan-Slug -> Tier-Profil. EINE Quelle (G5) fuer die Aufloesung
// planProfileFor(planSlug) UND fuer die fail-closed Skip-Taxonomie (PROFILE_SKIP), geteilt
// von der A2-Aktivierung (activation.js: schreibt danach via setProfile) UND dem A3-Backfill
// (backfill-profiles.js: nutzt ihn fuer Dry-Run/Idempotenz/Report). Frueher lag dieselbe
// Kette + dieselben Reason-Strings doppelt -> bei einer weiteren Skip-Art/Umbenennung waeren
// beide gedriftet.
//
// KEIN Nebeneffekt: liest nur (tenantSubscription), schreibt NIE (kein setProfile) -> die
// Schreibentscheidung (Merge==Replace) bleibt beim jeweiligen Aufrufer (N7/P6). Profil keyt
// seit Phase S auf die tenantId (= der resolveProfile/place_call-Lesepfad) - kein Account-/
// email-Lookup mehr noetig (der Schreib-Aufrufer schluesselt direkt auf die tenantId).
import { planProfileFor } from "../plans.js";

// Fail-closed Skip-Grund der Profil-Aufloesung (kein Magic-String, G25). Genau hier
// definiert, vom Backfill (BACKFILL_SKIP) importiert -> der String no_plan lebt EINMAL
// (die Aktivierung reicht den Resolver-Skip unveraendert als Reason durch).
export const PROFILE_SKIP = Object.freeze({
  NO_PLAN: "no_plan", // kein/unbekannter planSlug -> NIE raten, NIE setProfile(tenantId, undefined)
});

// Loest das fuer die tenantId zu setzende Tier-Profil auf. tenant = tenantId. Liefert
// {tier} bei Erfolg ODER {skip: <PROFILE_SKIP>} fail-closed (NIE Wurf). Reiner Lese-Schritt
// (planProfileFor): seit Phase S keyt das Profil auf die tenantId, also kein Account-/email-
// Lookup mehr - synchron.
export function resolveTierForTenant({ store, tenant }) {
  const tier = planProfileFor(store.tenantSubscription(tenant).planSlug);
  if (!tier) return { skip: PROFILE_SKIP.NO_PLAN };
  return { tier };
}
