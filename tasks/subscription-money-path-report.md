# Report: Abo-Money-Path Phase 0 + Backend-Fix

Strategie: `docs/subscription-checkout-strategy.md`. Owner-Ziel: Abo abschliessen (Registrierung bevorzugt,
Dashboard alternativ); Single-Origin auf sundartha.com; Ziellinie = gruen im Stripe-Test-Mode.

## Phase 0 — Aufklaerung + Harness (Subagents) ✅

- 3-Agenten-Investigation: Abo-Backend ist VOLLSTAENDIG + bereits live (Render `d34d026`). Symptom-Wurzel ist
  Config (`PAYMENT_ENABLED=false` + fehlende Stripe-Price/Webhook + Boot-Falle `NUMBER_SETUP_FEE_CENTS=0`) +
  Frontend-Spaltung (tenant.html funktioniert / apps/web cross-origin tot, kein Abonnieren-Button).
- Lokaler Stripe-Test-Stack aufgebaut: Postgres (homebrew :5433, **non-superuser-Rolle** wegen F5 portal-pool-
  Guard), `.env.test-payment` + `seed-test-payment.mjs` (gitignored), Cookie-Mint wie in den Tests.
- Stripe-Test-Produkte/Preise autonom via `sk_test` angelegt (idempotent, lookup_key):
  `STRIPE_STARTER_PRICE_ID=price_1TmqEK3QGz3ubjYAhzgXgENX`, `STRIPE_BUSINESS_PRICE_ID=price_1TmqEL3QGz3ubjYAe8QUnYM7`.

## Backend-Money-Path-Fix (3 echte Bugs) ✅

| Bug | Datei | Fix | Wie gefunden |
|-----|-------|-----|--------------|
| #1 `currency` fehlt im setup-Mode -> Stripe HTTP 400 | `src/billing/stripe.js` | `currency: config.paymentCurrency` | Harness (echter Stripe-Test-Call) |
| #2 async-Handler-Hang (Express 4 leitet Rejections nicht weiter) | `src/self-service-routes.js` | `asyncBilling(fn,onError)`-Wrapper -> 502 `billing_unavailable` (JSON) / Redirect `card=error` (return) | Phase-0-Repro (2-Min-Hang) |
| #3 `current_period_end` top-level -> NULL | `src/billing/stripe.js` | aus `items.data[0].current_period_end` + Fallback | Live-Subscribe (Feld blieb leer) |

Nebenfix: S3-Dedup (`billingUnavailable`-Responder), S4-Kommentar praezisiert.

## Verifikation

- **Tests:** `npm test` 1128/1128 (5 neue: currency-Assert, 2× createSubscription-Period, 3× asyncBilling-Catch).
- **Dual-Review:** Safety/Verhalten = PASS (kein Secret-Leak, fachliche Ablehnungen nicht verschluckt, kein Hang,
  Money-Gates byte-identisch). Clean-Code-S1 (fehlende Tests) behoben. Re-Review des Deltas laeuft.
- **Live (echtes Stripe-Test, nicht Fake):** setup-checkout 400→**200** + echte `cs_test`-URL `livemode:false`;
  voller Pfad Karte→subscribe→**echte Test-Subscription** `status=active` `livemode:false`, Tenant
  suspended→**active**, kyc=card; Hang-Fix **502 in 0,11s**.

## Status / Offen

- Aenderungen im Working Tree, **NICHT committet** (vermischt mit Owner-WIP). Prod = P4 (deferred), Render=upstream.
- Webhook-Pfad (`/webhooks/stripe`) in Test-Mode noch nicht verifiziert (Dummy-Secret; braucht `stripe listen`).
- Kein lokaler Browser-Login → P1 baut fail-closed Dev-Login-Shim (dualer Review) fuer die Chrome-e2e.

## Naechste Phase

**P1 Single-Origin-Unifizierung** (Impl-Workflow): Gateway serviert apps/web same-origin, `tenant.html` als
Nutzer-Seite abloesen, Dashboard = Anrufverlauf + zugeordnete Nummer; verifiziert per Chrome e2e.
