// Gemeinsame 3-Effekt-Aktivierung eines zahlenden Tenants (P5). EINE Quelle (G5) fuer
// "Abo bezahlt -> Tenant ist scharf": KYC auf CARD heben (oeffnet das Outbound-Gate),
// Status aktivieren (DERSELBE pg-Status-Seam wie webAuthMw/Admin-approve - kein Drift)
// und das idempotente, payment-gegatete Nummern-Provisioning anstossen. Genutzt vom
// Stripe-Webhook (applyStripeWebhook, Backup-Pfad) UND vom Self-Service-Subscribe-Handler
// (direkter Pfad) - identische Wirkung, keine zweite Kopie. Reihenfolge fix KYC->Status->
// provision (haelt die Invariante "aktiv+verifiziert, bevor eine Nummer entsteht" sichtbar;
// provision liest weder KYC noch Status). Idempotent: provision hat den tenantHasLiveNumber-
// Guard, setKycLevel/setStatus sind idempotente Setter -> Subscribe + nachfolgendes
// Webhook-created provisioniert NIE doppelt (Invariante 4). Nebeneffekt im Namen (N7).
import { KYC_LEVEL } from "../store/defaults.js";

export async function activatePaidTenant({ store, accounts, provision, tenant }) {
  store.setKycLevel(tenant, KYC_LEVEL.CARD);
  await accounts.setStatus(tenant, "active");
  await provision(tenant);
}
