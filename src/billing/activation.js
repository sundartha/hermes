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
import { provisionCleared } from "./provision-outcome.js";
import { resolvePeriodStartIso } from "./period.js";

// O4/GAP-01: Reset des Verbrauchszaehlers und Reaktivierung haengen an DERSELBEN
// Bedingung - deshalb steht der Stempel hier und nicht im Webhook. Erreichbar ist diese
// Funktion nur fuer ein bestaetigtes Abo (webhook.js CONFIRMED_SUBSCRIPTION_STATUS:
// past_due/unpaid/incomplete werden vorher als IGNORE verworfen). Zusaetzlich fail-closed
// gegen eine offene Zahlungsbeanstandung (billingHoldActive): wer eine ungeklaerte
// Rechnung hat, bekommt kein frisches Kontingent auf Plattformkosten. Ohne Perioden-Anker
// passiert nichts - das Gate bleibt dann auf der Lebenszeit-Achse (strenger).
// Liefert true, wenn ein neues Fenster begonnen hat (Audit-Detail).
function stampBudgetPeriodIfPaid({ store, tenant }) {
  if (store.billingHoldActive(tenant)) return false;
  return store.stampBudgetPeriod(tenant, resolvePeriodStartIso(store.tenantSubscription(tenant))) === true;
}

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

// Fix B (0-EUR-Checkout generisch): prueft best-effort, ob die gerade persistierte
// Subscription mit 0 EUR abgerechnet wurde (billing.retrieveSubscription) und
// persistiert das Ergebnis am Tenant. EIN Ort statt zwei (G5): Checkout-Return UND
// Webhook rufen BEIDE activatePaidTenant - hier lebt die Pruefung genau einmal,
// unabhaengig davon, welcher der beiden das Aktivierungs-Rennen gewinnt (webhook.js:
// der Webhook gewinnt es REGELMAESSIG - eine Pruefung nur im Checkout-Return-Pfad
// haette den Bug fuer den Regelfall nicht behoben). billing fehlt/kein subscriptionId/
// Stripe wirft -> Flag bleibt unberuehrt (fail-closed: provisionNumber sieht dann
// "nicht befreit", Bestandsverhalten - ein Stripe-Hakler darf KYC/Status/Provisioning
// nie blockieren, P8).
async function syncNumberSetupFeeExemption({ store, billing, tenant }) {
  if (!billing || typeof billing.retrieveSubscription !== "function") return;
  const { subscriptionId } = store.tenantSubscription(tenant);
  if (!subscriptionId) return;
  try {
    const { numberSetupFeeExempt } = await billing.retrieveSubscription(subscriptionId);
    store.setTenantSubscription(tenant, { numberSetupFeeExempt });
  } catch (e) {
    console.error(`[activation] numberSetupFeeExempt-Check fehlgeschlagen (tenant=${tenant}):`, e.message);
  }
}

// GAP-04: Aktivierung wartet das Provisioning-Ergebnis ab, statt es vorwegzunehmen. VORHER
// setzte diese Funktion active VOR provision() und wertete dessen Rueckgabe nie aus - ein
// fehlgeschlagener Kauf (z.B. globaler Nummern-Cap erschoepft) hinterliess einen bezahlten,
// aktiven Tenant OHNE Nummer und OHNE jede Kompensation. Jetzt: KYC wird unbedingt gesetzt
// (Reifegrad-Fakt, unabhaengig vom Kaufausgang), der GAP-04-Wartezustands-Marker
// (stripeActivationPending) erlaubt state-ops.tenantMayRequestNumber die Nummern-Anfrage
// OHNE den Statuswechsel vorwegzunehmen, und erst ein GEKLAERTES Provisioning-Ergebnis
// (provisionCleared) aktiviert den Tenant. Liefert zusaetzlich { activated, provisioned } -
// die Aufrufer (webhook.js/subscribe.js) auditieren beides und koennen bei activated===false
// einen Plattform-Alarm ausloesen.
export async function activatePaidTenant({ store, accounts, provision, billing, tenant }) {
  store.setKycLevel(tenant, KYC_LEVEL.CARD);
  // tenant-prolif-c (Invariante 2): der Tenant hat gerade bezahlt -> den Grace-Anker loeschen,
  // die Suspend-Uhr ist zurueckgesetzt (kein Release-Kandidat mehr). Ruft denselben Store-
  // Primitiv (store.clearSuspendedAt, G5) wie der dritte Reaktivierungspfad Admin-approve
  // (web-auth.js). Idempotent (No-Op ohne gesetzten Anker).
  store.clearSuspendedAt(tenant);
  // O4/GAP-01: dieselbe Ebene wie die uebrigen Store-Effekte (G30). Der Stempel setzt das
  // Budget-Fenster des Gates auf den Beginn der laufenden Abrechnungsperiode - eine
  // Subtraktions-Baseline, kein Nullen des Lebenszeit-Zaehlers.
  const budgetPeriodStarted = stampBudgetPeriodIfPaid({ store, tenant });
  // Wartezustand statt Vorab-Aktivierung: der Marker ist die benannte Erlaubnis, fuer diesen
  // bezahlten Tenant eine Nummer anzufragen (state-ops tenantMayRequestNumber). Er ueberlebt
  // einen Fehlschlag bewusst: der Operator-Retry findet den Tenant so wieder.
  store.setTenantSubscription(tenant, { activationPending: true });
  // VOR provision(tenant): das ausgeloeste, idempotente Nummern-Provisioning kann
  // asynchron sehr schnell in den echten placeHold laufen (Provisioning-Drain,
  // single-flight) - die Befreiung muss vorher am Tenant stehen (Race-Schutz).
  await syncNumberSetupFeeExemption({ store, billing, tenant });
  const provisioned = await provision(tenant);
  const profile = provisionPlanProfile({ store, tenant });
  // Fail-closed auf der GELD-Seite: nur ein geklaertes Provisioning-Ergebnis aktiviert. Ein
  // unbekannter/abgelehnter Grund gilt als NICHT geklaert (nie raten, G26) - der Marker bleibt
  // gesetzt, der Operator-Retry (POST /api/onboard/retry) findet den Tenant wieder.
  if (!provisionCleared(provisioned))
    return { profile, activated: false, provisioned, budgetPeriodStarted };
  await accounts.setStatus(tenant, "active");
  store.setTenantSubscription(tenant, { activationPending: false });
  // Spiegel-Nachzug: accounts.setStatus schreibt NUR die DB. Bisher zog der nachgelagerte
  // triggerTenantProvisioning->ensureTenant den Wert in den Spiegel; nach der Umkehr laeuft er
  // davor (provision() ist ja bereits gelaufen). Ohne diesen Aufruf saehen die Spiegel-Leser
  // (tenantActiveSubscriber, tenantInactive) den Tenant bis zum naechsten Login als gesperrt ->
  // Outbound waere trotz bezahltem Abo zu.
  await store.ensureTenant(tenant);
  // A2: zusaetzlicher idempotenter Effekt NACH KYC->Wartezustand->provision->Status - plan-
  // abgeleitetes Rechteprofil auf die tenantId. SKIP wirft NICHT, damit KYC/Status/provision
  // bei fehlendem Plan stehen bleiben (idempotenter Retry / der A3-Backfill holt das Profil
  // nach). PAYMENT_ENABLED-Gate: der Pfad ist nur payment-gegated erreichbar (server.js
  // Webhook 404 / Self-Service 404) -> aus = byte-identisch (Regel 3). accounts wird nur noch
  // fuer setStatus gebraucht (Profil keyt seit Phase S auf die tenantId).
  return { profile, activated: true, provisioned, budgetPeriodStarted };
}
