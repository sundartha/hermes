# Phase P3 — Payment-gated Aktivierung + Provisioning (Stripe Checkout -> Webhook -> active + KYC + Nummer)

Autoritative Scope-/Invarianten-Definition fuer Phase **P3**. Umbrella: `PLAN-ONBOARDING.md`. Setzt Phase **P0** voraus (kanonische Tenant-Identitaet). Dies ist der Kern-Fix gegen "Signup macht nichts, keine Nummer, kein Abo".

## Problem (verifiziert, Code-gegroundet)

Die Kette Signup -> Zahlung -> Aktivierung -> KYC -> Nummer reisst an jeder Naht:

- Kein Stripe-Redirect im Signup-Flow: `POST /api/onboard` (`src/server.js:1284`) kehrt bei `provisioningEnabled=false` frueh zurueck (`:1360-1368`); die Checkout-Routen sind nur manuelle Dashboard-Buttons.
- `customer.subscription.updated`-Webhook (`src/billing/webhook.js:130-150`) setzt `setTenantSubscription` + `accounts.setStatus(active)`, ruft aber **KEIN `setKycLevel`**.
- `setTenantSubscription` (`src/store/state-ops.js:668`) speichert `planSlug`, setzt KEIN KYC.
- Call-Gate `tenantActiveSubscriber` (`src/store/state-ops.js:613-618`) verlangt `status=ACTIVE` **UND** `kycLevel >= CARD` (`KYC_OUTBOUND_MIN=KYC_LEVEL.CARD`, `src/store/defaults.js:141`). Da KYC nie gesetzt wird, bleibt das Gate zu.
- Flags default aus: `PAYMENT_ENABLED` (`src/config.js:108`), `PROVISIONING_ENABLED` (`src/config.js:223`).

Vorhandene Bausteine: Stripe-Webhook-Route `POST /webhooks/stripe` (`src/server.js:243`, Pfad-Konstante `:132`, Signaturpruefung `verifyStripeSignature`, 404 wenn `!paymentEnabled`). Plaene `PLAN_SLUGS=[starter,business]` (`src/billing/subscribe.js:15`) -> `stripeStarterPriceId`/`stripeBusinessPriceId`. Provisioning-Orchestrierung `provisionNumber` (`src/onboarding.js:42-140`, Hold -> order -> configure -> capture -> activate), Provider Telnyx (Default `src/telephony/registry.js:43`).

## Ziel / Soll-Flow

Registrierung -> (Plan-Auswahl) -> **Stripe Checkout (Subscription-Mode)** -> Zahlung -> **Webhook** loest atomar aus: `status=active` **+ `setKycLevel(CARD)` + Provisioning anstossen** (Telnyx, nach Capture) -> Nummer erscheint im Dashboard, MCP/Calls erlaubt.

## Invarianten (verbindlich)

1. **Payment-gated:** Nummer wird ERST nach bestaetigter Zahlung provisioniert (nicht bei Signup). Council-Konsens.
2. **Webhook setzt alle drei Effekte:** auf bestaetigte Subscription (das/die Stripe-Event(s) eines abgeschlossenen Subscription-Checkouts) -> `status=active` + `setKycLevel(CARD)` + Provisioning-Trigger. Der heutige fehlende `setKycLevel(CARD)` ist der Kern-Fix.
3. **Beide Plaene** (starter/business) berechtigen zur Nummer; das Gate ist Payment->KYC, nicht der Plan. Unterschied = Preis/Limits.
4. **Idempotenz:** Webhook-Retries duerfen NICHT doppelt provisionieren/belasten (Idempotency-Key; vorhandenes Muster `provision_<numberId>` nutzen).
5. **Flags bleiben Code-extern:** P3 aendert NICHT `PAYMENT_ENABLED`/`PROVISIONING_ENABLED` im Code. P3 ist der CODE HINTER den Flags. Bei `provisioningEnabled=false` bleibt der reale Kauf aus (Nummer `requested`), aber die Aktivierungs-/KYC-Kette muss korrekt laufen und testbar sein.
6. **Tenant-Aufloesung im Webhook** ueber die kanonische Identitaet aus P0 (Stripe customer/subscription -> Tenant-Mapping; `stripeCustomerId` am Tenant).
7. **Safety/Signatur:** `verifyStripeSignature` (fail-closed) unveraendert; kein Secret-Leak; Disclosure/Auth/Gates unantastbar.

## Akzeptanz (deterministische Tests, Pflicht — offline, ohne echtes Stripe)

1. Synthetisches, korrekt signiertes Subscription-Event an `POST /webhooks/stripe` -> Tenant wird `active`, `kycLevel=CARD`, Subscription-Felder gesetzt, Provisioning-Trigger ausgeloest (bei `provisioningEnabled=false`: Nummer `requested`/queued, KEIN realer Kauf, KEIN Geld).
2. Nach diesem Flow ist `tenantActiveSubscriber(tenant, CARD) === true` -> Outbound-Gate offen.
3. Webhook-Retry (dasselbe Event 2x) -> keine Doppel-Provisionierung/Doppel-Capture (Idempotenz).
4. Bei `paymentEnabled=false` bleibt der Webhook 404 und der Bestand byte-identisch (kein Regress).
5. `npm test` gruen (json + pglite). Neues Verhalten -> neue Tests.

## Abgrenzung (NICHT P3)

- KEIN Flip von `PAYMENT_ENABLED`/`PROVISIONING_ENABLED` (das macht Claude via Render-MCP / Jonas — siehe PLAN-ONBOARDING §9.2/§9.4).
- KEINE Stripe-Webhook-Registrierung im Stripe-Dashboard (Jonas, nach Deploy — PLAN-ONBOARDING §9.1 #4).
- KEINE Domain-/Branding-/Tenant-Identitaets-Arbeit (P2/P1/P0).
- Echte Nummernkaeufe / `PROVISIONING_ENABLED=true` = P4 (Geld-Gate).

## Constraints

ESM, kein Build-Step, kein TypeScript. Kommentare deutsch OHNE Umlaute. Neue npm-Deps nur mit Begruendung. Safety-Gates/Disclosure/Auth/Signaturpruefung unantastbar, fail-closed. clean-code.md harte Gates (S1/S2 = Blocker). Secrets nur via env, nie loggen/leaken.

## Push/Deploy

NICHT pushen. Lead merged den zurueckgegebenen `finalBranch` nach master (lokal). Go-live-Schritte (Stripe-Webhook registrieren, `PAYMENT_ENABLED=true`) stehen in PLAN-ONBOARDING §9.
