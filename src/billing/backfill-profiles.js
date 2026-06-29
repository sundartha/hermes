// A3 (GAP A) - idempotenter, fail-closed Backfill plan-abgeleiteter Rechteprofile fuer
// BESTANDS-Subscriber, die VOR A2 (Aktivierung provisioniert das Profil) aktiviert wurden.
// Testbarer Kern (DIP): reine Orchestrierung ueber injizierte Seams (store/accounts/
// resolvePlanSlug), importiert KEIN store.js/web-auth.js (sonst nicht pglite-/Fake-testbar),
// nur die puren Helfer. Teilt die Profil-Aufloesung (planSlug -> Tier -> Account -> email)
// und die fail-closed Skip-Taxonomie mit der A2-Aktivierung ueber resolveTierForTenant /
// PROFILE_SKIP (EINE Quelle, G5) - hier kommen NUR Bestands-Enumeration, Reconcile-Vorlauf,
// Dry-Run/Idempotenz und der Report dazu. Setzt NIE ein permissiveres Recht als das A1-Tier
// (Merge==Replace raeumt sogar Alt-unrestricted=true ab) -> keine Toll-Fraud-Flaeche.
// apply=false = reiner Dry-Run.
import { isDeepStrictEqual } from "node:util";
import { BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN, sanitizeProfile } from "../store/defaults.js";
import { PROFILE_SKIP, resolveTierForTenant } from "./plan-profile-resolver.js";

// Skip-/Aktions-Gruende (kein Magic-String, G25). Die Profil-Aufloesungs-Skips
// (no_plan/no_account/no_email) kommen aus der geteilten PROFILE_SKIP-Quelle (kein zweites
// Literal, G5); backfill-spezifisch ergaenzt: bootstrap/not_subscriber.
export const BACKFILL_SKIP = Object.freeze({
  BOOTSTRAP: "bootstrap", // Owner hart ausgenommen (BOOTSTRAP_TENANT_ID)
  NOT_SUBSCRIBER: "not_subscriber", // kein aktiver+CARD Subscriber (Nicht-Zahler)
  ...PROFILE_SKIP, // NO_PLAN/NO_ACCOUNT/NO_EMAIL - geteilt mit der A2-Aktivierung
});

// Idempotente, fail-closed Migration. Enumeriert store.load().tenants (volle Hydrierung
// traegt kyc/planSlug/subscription), provisioniert je aktiven+CARD Subscriber das A1-
// Tier-Profil auf account.email (email-first wie die Laufzeit). apply=false => reiner Dry-
// Run (KEINE Mutation). resolvePlanSlug = optionaler Reconcile-Seam (async (subId)=>slug|
// null, fail-soft beim Aufrufer); fehlt er, bleiben slug-lose Subscriber no_plan-Skip.
// Liefert einen strukturierten Report (KEINE Profil-Werte; email als Operator-Schluessel ok).
// Nebeneffekt (setProfile/setTenantSubscription) NUR bei apply -> N7.
export async function backfillPlanProfiles({ store, accounts, apply = false, resolvePlanSlug }) {
  const s = store.load();
  const report = { apply, scanned: 0, changes: [], unchanged: [], skipped: [], reconciled: [] };
  for (const tenant of s.tenants) {
    report.scanned++;
    const id = tenant.id;
    if (id === BOOTSTRAP_TENANT_ID) {
      report.skipped.push({ id, reason: BACKFILL_SKIP.BOOTSTRAP });
      continue;
    }
    // Status+KYC in EINER vorhandenen Query (G5): nur aktive, CARD-verifizierte Subscriber.
    if (!store.tenantActiveSubscriber(id, KYC_OUTBOUND_MIN)) {
      report.skipped.push({ id, reason: BACKFILL_SKIP.NOT_SUBSCRIBER });
      continue;
    }
    // Reconcile-Vorlauf NUR fuer aktive Subscriber OHNE Slug (apply): heilt slug-lose Bestands-
    // Abos (webhook.js selektiver Patch) VOR der Aufloesung, sonst blieben sie no_plan-Skip
    // (-> stiller DEFAULT_PROFILE, A4-Sperre). Mutiert den Spiegel; resolveTierForTenant liest ihn.
    if (apply && resolvePlanSlug && tenant.stripeSubscriptionId && !store.tenantSubscription(id).planSlug) {
      const slug = await resolvePlanSlug(tenant.stripeSubscriptionId); // fail-soft (Aufrufer faengt)
      if (slug) {
        store.setTenantSubscription(id, { planSlug: slug });
        report.reconciled.push({ id });
      }
    }
    // Schreibfreie Profil-Aufloesung, geteilt mit der A2-Aktivierung (G5): planSlug -> Tier,
    // dann Account (genau-1-sonst-null), dann email. fail-closed Skip statt Wurf/undefined-Profil.
    const { tier, account, skip } = await resolveTierForTenant({ store, accounts, tenant: id });
    if (skip) {
      report.skipped.push({ id, reason: skip });
      continue;
    }
    // Idempotenz: vergleiche gegen die KANONISCHE at-rest-Form (sanitizeProfile == was
    // setProfile speichert, G5). Gleich -> keine Aenderung (2. Lauf = 0 changes).
    const desired = sanitizeProfile(tier);
    const existing = s.profiles[account.email];
    if (existing && isDeepStrictEqual(existing, desired)) {
      report.unchanged.push({ id, email: account.email });
      continue;
    }
    report.changes.push({ id, email: account.email, hadExisting: !!existing });
    if (apply) store.setProfile(account.email, tier); // Merge==Replace: voller 6-Felder-Snapshot
  }
  return report;
}
