// Gemeinsame Aktivierung eines zahlenden Tenants (P5 + A2). EINE Quelle (G5) fuer
// "Abo bezahlt -> Tenant ist scharf": KYC auf CARD heben (oeffnet das Outbound-Gate),
// Status aktivieren (DERSELBE pg-Status-Seam wie webAuthMw/Admin-approve - kein Drift),
// das idempotente, payment-gegatete Nummern-Provisioning anstossen und (A2) das plan-
// abgeleitete Rechteprofil auf account.email provisionieren. Genutzt vom Stripe-Webhook
// (applyStripeWebhook, Backup-Pfad) UND vom Self-Service-Subscribe-Handler (direkter Pfad)
// - identische Wirkung, keine zweite Kopie. Reihenfolge fix KYC->Status->provision->Profil
// (haelt die Invariante "aktiv+verifiziert, bevor eine Nummer entsteht" sichtbar; provision
// liest weder KYC noch Status). Idempotent: provision hat den tenantHasLiveNumber-Guard,
// setKycLevel/setStatus sind idempotente Setter, setProfile schreibt deterministisch
// denselben Tier-Snapshot -> Subscribe + nachfolgendes Webhook-created provisioniert NIE
// doppelt (Invariante 4). Nebeneffekt im Namen (N7).
import { KYC_LEVEL } from "../store/defaults.js";
import { resolveTierForTenant } from "./plan-profile-resolver.js";

// Provisioniert das plan-abgeleitete Rechteprofil auf account.email (A2, GAP A). Die
// schreibfreie Aufloesung (planSlug -> Tier -> Account -> email) + die fail-closed Skip-
// Taxonomie liegen im geteilten resolveTierForTenant (EINE Quelle mit dem A3-Backfill, G5);
// hier kommt NUR der Schreibschritt dazu. SKIP wirft NIE (NIE setProfile(email, undefined)) ->
// der Resolver-Skip wird unveraendert als reason durchgereicht. Liefert ein reines Ergebnis
// (provisioned/reason/keys) - der Aufrufer auditiert es (nur Keys/Reason/Tenant, NIE Profil-
// Werte = PII).
async function provisionPlanProfile({ store, accounts, tenant }) {
  const { tier, account, skip } = await resolveTierForTenant({ store, accounts, tenant });
  if (skip) return { provisioned: false, reason: skip, keys: 0 };
  const { changed } = store.setProfile(account.email, tier);
  return { provisioned: true, reason: null, keys: changed.length };
}

// Audit-Detail-Fragment fuers Profil-Ergebnis. EINE Quelle (G5) fuer beide Aufrufer
// (webhook + self-service), die es an ihr bestehendes activate-/subscribe-Audit haengen.
// Nur Reason + Key-ANZAHL, NIE Profil-Werte/email (PII, Regel 4). undefined (Aktivierung
// lief nicht, z.B. Buchung abgelehnt) -> "profile=none".
export function profileAuditDetail(profile) {
  if (!profile) return "profile=none";
  return profile.provisioned ? `profile=ok:${profile.keys}` : `profile=skip:${profile.reason}`;
}

export async function activatePaidTenant({ store, accounts, provision, tenant }) {
  store.setKycLevel(tenant, KYC_LEVEL.CARD);
  await accounts.setStatus(tenant, "active");
  await provision(tenant);
  // A2: zusaetzlicher idempotenter Effekt NACH der unveraenderten KYC->Status->provision-
  // Reihenfolge - plan-abgeleitetes Rechteprofil auf account.email. SKIP wirft NICHT, damit
  // KYC/Status/provision bei fehlendem Account/Plan stehen bleiben (idempotenter Retry / der
  // A3-Backfill holt das Profil nach). PAYMENT_ENABLED-Gate: der Pfad ist nur payment-gegated
  // erreichbar (server.js Webhook 404 / Self-Service 404) -> aus = byte-identisch (Regel 3).
  return { profile: await provisionPlanProfile({ store, accounts, tenant }) };
}
