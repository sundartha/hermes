// A3 (GAP A) - idempotenter, fail-closed Backfill plan-abgeleiteter Rechteprofile fuer
// BESTANDS-Subscriber, die VOR A2 (Aktivierung provisioniert das Profil) aktiviert wurden.
// Testbarer Kern (DIP): reine Orchestrierung ueber injizierte Seams (store/accounts/
// resolvePlanSlug), importiert KEIN store.js/web-auth.js (sonst nicht pglite-/Fake-testbar),
// nur die puren Helfer. Spiegelt activation.js: gleiche Skip-Taxonomie (no_plan/no_account/
// no_email), gleiche EMAIL-FIRST-Profil-Quelle (planProfileFor), gleiche fail-closed SKIPs.
// Setzt NIE ein permissiveres Recht als das A1-Tier (Merge==Replace raeumt sogar Alt-
// unrestricted=true ab) -> keine Toll-Fraud-Flaeche. apply=false = reiner Dry-Run.
import { isDeepStrictEqual } from "node:util";
import { BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN, sanitizeProfile } from "../store/defaults.js";
import { planProfileFor } from "../plans.js";

// Skip-/Aktions-Gruende (kein Magic-String, G25). Taxonomie spiegelt A2
// (no_plan/no_account/no_email), erweitert um bootstrap/not_subscriber.
export const BACKFILL_SKIP = Object.freeze({
  BOOTSTRAP: "bootstrap", // Owner hart ausgenommen (BOOTSTRAP_TENANT_ID)
  NOT_SUBSCRIBER: "not_subscriber", // kein aktiver+CARD Subscriber (Nicht-Zahler)
  NO_PLAN: "no_plan", // aktiver Subscriber OHNE/unbekanntem planSlug -> NIE raten
  NO_ACCOUNT: "no_account", // accountByTenant -> null (0 ODER >1 = mehrdeutig, §5.6)
  NO_EMAIL: "no_email", // leere account.email (Lesepfad ignoriert sie)
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
    let planSlug = store.tenantSubscription(id).planSlug;
    // Reconcile-Vorlauf NUR fuer aktive Subscriber OHNE Slug (apply): heilt slug-lose
    // Bestands-Abos (webhook.js selektiver Patch), sonst stiller DEFAULT_PROFILE (-> A4-Sperre).
    if (!planSlug && apply && resolvePlanSlug && tenant.stripeSubscriptionId) {
      const slug = await resolvePlanSlug(tenant.stripeSubscriptionId); // fail-soft (Aufrufer faengt)
      if (slug) {
        store.setTenantSubscription(id, { planSlug: slug });
        planSlug = slug;
        report.reconciled.push({ id });
      }
    }
    const tier = planProfileFor(planSlug); // NIE mit undefined aufrufen -> hier garantiert Slug/null
    if (!tier) {
      report.skipped.push({ id, reason: BACKFILL_SKIP.NO_PLAN });
      continue;
    }
    const account = await accounts.accountByTenant(id); // genau-1-sonst-null (A2-Bruecke)
    if (!account) {
      report.skipped.push({ id, reason: BACKFILL_SKIP.NO_ACCOUNT });
      continue;
    }
    if (!account.email) {
      report.skipped.push({ id, reason: BACKFILL_SKIP.NO_EMAIL });
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
