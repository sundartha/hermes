// Schreibfreier Resolver Plan-Slug -> Tier-Profil + Account. EINE Quelle (G5) fuer die
// Aufloesungs-Kette planProfileFor(planSlug) -> accountByTenant -> account.email UND fuer
// die fail-closed Skip-Taxonomie (PROFILE_SKIP), geteilt von der A2-Aktivierung
// (activation.js: schreibt danach via setProfile) UND dem A3-Backfill (backfill-profiles.js:
// nutzt ihn fuer Dry-Run/Idempotenz/Report). Frueher lag dieselbe Kette + dieselben Reason-
// Strings doppelt -> bei einer 4. Skip-Art/Umbenennung waeren beide gedriftet.
//
// KEIN Nebeneffekt: liest nur (tenantSubscription/accountByTenant), schreibt NIE (kein
// setProfile) -> die Schreibentscheidung (Merge==Replace) bleibt beim jeweiligen Aufrufer
// (N7/P6). Profil keyt EMAIL-FIRST (account.email = exakt der resolveProfile/place_call-
// Lesepfad, A7), NICHT tenantId/sub (Regel 5) - sonst verfehlt place_call den Eintrag.
import { planProfileFor } from "../plans.js";

// Fail-closed Skip-Gruende der Profil-Aufloesung (kein Magic-String, G25). Genau hier
// definiert, vom Backfill (BACKFILL_SKIP) importiert -> die Strings no_plan/no_account/
// no_email leben EINMAL (die Aktivierung reicht den Resolver-Skip unveraendert als Reason durch).
export const PROFILE_SKIP = Object.freeze({
  NO_PLAN: "no_plan", // kein/unbekannter planSlug -> NIE raten, NIE setProfile(email, undefined)
  NO_ACCOUNT: "no_account", // accountByTenant -> null (0 ODER >1 = mehrdeutig, §5.6)
  NO_EMAIL: "no_email", // leere account.email (Lesepfad ignoriert sie)
});

// Loest das auf account.email zu setzende Tier-Profil auf. tenant = tenantId. Liefert
// {tier, account} bei Erfolg ODER {skip: <PROFILE_SKIP>} fail-closed (NIE Wurf). Reihenfolge
// fix planProfileFor -> accountByTenant -> email-Praesenz (so wie die Laufzeit liest, A7).
export async function resolveTierForTenant({ store, accounts, tenant }) {
  const tier = planProfileFor(store.tenantSubscription(tenant).planSlug);
  if (!tier) return { skip: PROFILE_SKIP.NO_PLAN };
  const account = await accounts.accountByTenant(tenant);
  if (!account) return { skip: PROFILE_SKIP.NO_ACCOUNT };
  if (!account.email) return { skip: PROFILE_SKIP.NO_EMAIL };
  return { tier, account };
}
