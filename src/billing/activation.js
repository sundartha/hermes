// Gemeinsame Aktivierung eines zahlenden Tenants (P5 + A2). EINE Quelle (G5) fuer
// "Abo bezahlt -> Tenant ist scharf": KYC auf CARD heben (oeffnet das Outbound-Gate),
// Status aktivieren (DERSELBE pg-Status-Seam wie webAuthMw/Admin-approve - kein Drift),
// das idempotente, payment-gegatete Nummern-Provisioning anstossen und (A2) das plan-
// abgeleitete Rechteprofil auf die tenantId provisionieren (Phase S: tenant-gekeyt). Genutzt
// vom Stripe-Webhook (applyStripeWebhook, Backup-Pfad) UND vom Self-Service-Subscribe-Handler
// (direkter Pfad) - identische Wirkung, keine zweite Kopie. Reihenfolge fix
// KYC->Status->provision->Profil (haelt die Invariante "aktiv+verifiziert, bevor eine Nummer
// entsteht" sichtbar; provision liest weder KYC noch Status). Idempotent: provision hat den
// tenantHasLiveNumber-Guard, setKycLevel/setStatus sind idempotente Setter, setProfile schreibt
// deterministisch denselben Tier-Snapshot -> Subscribe + nachfolgendes Webhook-created
// provisioniert NIE doppelt (Invariante 4). Nebeneffekt im Namen (N7).
import { KYC_LEVEL } from "../store/defaults.js";
import { resolveTierForTenant } from "./plan-profile-resolver.js";

// Provisioniert das plan-abgeleitete Rechteprofil auf die tenantId (A2, GAP A; Phase S
// tenant-gekeyt). Die schreibfreie Aufloesung (planSlug -> Tier) + die fail-closed Skip-
// Taxonomie liegen im geteilten resolveTierForTenant (EINE Quelle mit dem A3-Backfill, G5);
// hier kommt NUR der Schreibschritt dazu. SKIP wirft NIE (NIE setProfile(tenant, undefined)) ->
// der Resolver-Skip wird unveraendert als reason durchgereicht. Liefert ein reines Ergebnis
// (provisioned/reason/keys) - der Aufrufer auditiert es (nur Keys/Reason/Tenant, NIE Profil-
// Werte = PII).
function provisionPlanProfile({ store, tenant }) {
  const { tier, skip } = resolveTierForTenant({ store, tenant });
  if (skip) return { provisioned: false, reason: skip, keys: 0 };
  const { changed } = store.setProfile(tenant, tier);
  return { provisioned: true, reason: null, keys: changed.length };
}

// Audit-Detail-Fragment fuers Profil-Ergebnis. EINE Quelle (G5) fuer beide Aufrufer
// (webhook + self-service), die es an ihr bestehendes activate-/subscribe-Audit haengen.
// Nur Reason + Key-ANZAHL, NIE Profil-Werte (PII, Regel 4). undefined (Aktivierung lief
// nicht, z.B. Buchung abgelehnt) -> "profile=none".
export function profileAuditDetail(profile) {
  if (!profile) return "profile=none";
  return profile.provisioned ? `profile=ok:${profile.keys}` : `profile=skip:${profile.reason}`;
}

export async function activatePaidTenant({ store, accounts, provision, tenant }) {
  store.setKycLevel(tenant, KYC_LEVEL.CARD);
  await accounts.setStatus(tenant, "active");
  await provision(tenant);
  // A2: zusaetzlicher idempotenter Effekt NACH der unveraenderten KYC->Status->provision-
  // Reihenfolge - plan-abgeleitetes Rechteprofil auf die tenantId. SKIP wirft NICHT, damit
  // KYC/Status/provision bei fehlendem Plan stehen bleiben (idempotenter Retry / der A3-Backfill
  // holt das Profil nach). PAYMENT_ENABLED-Gate: der Pfad ist nur payment-gegated erreichbar
  // (server.js Webhook 404 / Self-Service 404) -> aus = byte-identisch (Regel 3). accounts wird
  // nur noch fuer setStatus gebraucht (Profil keyt seit Phase S auf die tenantId).
  return { profile: provisionPlanProfile({ store, tenant }) };
}
