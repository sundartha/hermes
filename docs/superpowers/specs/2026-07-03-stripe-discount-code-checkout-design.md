# Design: Rabattcode ueber Stripe-Checkout (Subscription-Modus)

Status: Approved (Jonas, 2026-07-03)
Naechster Schritt: `writing-plans` (Fable-Planung), dann Umsetzung (Sonnet) ueber `phase-impl-lean`.

## Problem

RUNBOOK-STRIPE-LIVE.md Schritt 7 (Live-Smoke) verlangt eine echte Kartenzahlung.
Jonas (Owner) will den Smoke-Test durchziehen, ohne echtes Geld zu zahlen.
Zusaetzlich soll ein Rabattcode generell fuer beliebige Tenants nutzbar sein
(nicht nur ein Owner-Sonderpfad).

## Entscheidungen (getroffen mit Jonas, 2026-07-03)

1. **Restriktion komplett Stripe-seitig**: kein App-Code fuer "wer darf einen
   Code nutzen". Gueltigkeit/Ablauf/max. Einloesungen/Customer-Bindung leben
   in Stripe (Coupon + Promotion Code), nicht in unserem Code.
2. **Platzierung: auf Stripes eigener Checkout-Seite**, genau dort wo die
   Kartendaten eingegeben werden - nicht als eigenes Feld in unserem
   Self-Service-Dashboard (tenant.html).
3. **Architektur-Konsequenz aus (2)**: die Checkout-Session fuer den
   Erst-Abschluss (Karte + Plan gleichzeitig, "carried-plan"-Pfad) wechselt
   von Stripe-Checkout-Modus `setup` auf Modus `subscription`. Stripe zeigt
   dann selbst ein natives Rabattcode-Feld (`allow_promotion_codes: true`)
   und legt Karte + Abo in einem gehosteten Schritt an.

## Architektur: vorher/nachher

**Heute (beide Pfade):**
1. Kachel-Flow waehlt Plan -> `POST /api/self-service/billing/setup-checkout {plan}`
   -> `ensureCustomer` -> `billing.createSetupCheckoutSession` (Stripe-Checkout,
   Modus `setup`, 0 EUR, nur Karte speichern) -> Redirect zu Stripe.
2. Stripe redirectet zurueck -> `GET /api/self-service/billing/return?session_id=...&plan=...`
   -> `bindCardFromSession` (liest Karte aus der Session, Customer-Match-Pruefung,
   persistiert `customerId`+`paymentMethodId`) -> bei mitgetragenem Plan:
   `subscribeAndActivate` -> `createTenantSubscription` -> `billing.createSubscription`
   (SEPARATER off_session API-Call, kein Stripe-Formular, `error_if_incomplete`).

**Neu (nur wenn ein Plan mitgetragen wird - der Onboarding-Standardfall):**
1. `POST /api/self-service/billing/setup-checkout {plan}` -> `ensureCustomer`
   (unveraendert) -> **neu**: `billing.createSubscriptionCheckoutSession`
   (Stripe-Checkout, Modus `subscription`, `line_items` = Plan-Price,
   `allow_promotion_codes: true`) -> Redirect zu Stripe. Stripe zeigt Karten-
   erfassung UND natives Rabattcode-Feld auf einer Seite, legt bei Abschluss
   Karte + Abo direkt an (inkl. angewendetem Rabatt, falls Code eingegeben).
2. Stripe redirectet zurueck -> `GET /api/self-service/billing/return?session_id=...&plan=...`
   -> **neu**: `billing.getSubscriptionCheckoutResult(sessionId)` liest
   `customerId`, `paymentMethodId`, `subscriptionId`, `currentPeriodStart`,
   `currentPeriodEnd` direkt aus der abgeschlossenen Session (KEIN zweiter
   API-Call mehr) -> `activateSubscriptionFromCheckoutSession` (neue
   Orchestrierungs-Funktion, spiegelt `subscribeAndActivate`): Customer-Match-
   Pruefung (dieselbe Sicherheits-Invariante wie `bindCardFromSession`, fail-
   closed 403 bei Mismatch) -> `already_subscribed`-Guard (Doppel-Redirect-
   Schutz, spiegelt `createTenantSubscription`) -> Persistenz
   (`setTenantStripe`, `setTenantSubscription`) -> `activatePaidTenant`.

**Reiner Karten-Flow ohne Plan** (Button "Karte hinzufuegen" ohne Plan-Auswahl)
bleibt **byte-identisch**: Modus `setup`, `bindCardFromSession` wie heute.

**Bare `/api/self-service/billing/subscribe`** (Karte schon hinterlegt, z.B.
Plan-Wechsel) bleibt **unveraendert** - off_session, kein Stripe-Formular,
kein "Karte eingeben"-Moment, an den ein Rabattfeld haengen koennte. Das
akzeptierte SCA/3DS-Risiko (RUNBOOK-STRIPE-LIVE.md #9.1) bleibt fuer DIESEN
Pfad unveraendert bestehen - der Umbau loest es nur fuer den Erst-Abschluss
(Checkout ist interaktiv, Stripe handhabt 3DS dort selbst on-session).

## Betroffene Komponenten

| Datei | Aenderung |
|---|---|
| `src/billing/ports.js` | 2 neue Port-Methoden (JSDoc-Typdefs): `createSubscriptionCheckoutSession({tenantRef, customerId, priceId, successUrl, cancelUrl}) -> {url, sessionId}`, `getSubscriptionCheckoutResult(sessionId) -> {customerId, paymentMethodId, subscriptionId, currentPeriodStart, currentPeriodEnd}` |
| `src/billing/stripe.js` | Implementierung beider Methoden. `createSubscriptionCheckoutSession`: `POST /v1/checkout/sessions` mit `mode=subscription`, `line_items[0][price]`, `line_items[0][quantity]=1`, `allow_promotion_codes=true`, `customer`, `metadata[tenant_ref]`. `getSubscriptionCheckoutResult`: `GET /v1/checkout/sessions/{id}?expand[]=subscription&expand[]=subscription.default_payment_method`, liest `customer`, `subscription.id`, `subscription.default_payment_method`, `subscription.items.data[0].current_period_{start,end}`. Fehlt die Subscription (Session nicht abgeschlossen) -> Fehler werfen (fail-closed, Muster wie `getCheckoutSessionResult`). |
| `src/billing/subscribe.js` | Neue Funktion `activateSubscriptionFromCheckoutSession({store, billing, accounts, provision, tenant, sessionId, expectedPlanSlug})`: ruft `getSubscriptionCheckoutResult`, prueft Customer-Match gegen `store.tenantStripe(tenant)` (403-Signal bei Mismatch, wie `bindCardFromSession`), prueft `already_subscribed` (wie `createTenantSubscription`), persistiert, ruft `activatePaidTenant`. |
| `src/self-service-routes.js` | `/setup-checkout`: bei bekanntem `planSlug` -> Preis via `priceIdForPlan` aufloesen (fehlender Price -> 500 `plan_unconfigured`, wie heute) -> `createSubscriptionCheckoutSession` statt `createSetupCheckoutSession`. Ohne Plan: unveraendert. `/return`: bei mitgetragenem Plan -> `activateSubscriptionFromCheckoutSession` statt `subscribeAndActivate`; Fehler-Mapping (Mismatch -> `CARD_RETURN_ERROR`/403, `already_subscribed` -> `SUB_RETURN_OK` da idempotent-erfolgreich) analog Bestand. |
| `docs/RUNBOOK-STRIPE-LIVE.md` | Neues Addendum: Coupon (100% off, once) + Promotion Code in Stripe Live anlegen (Owner-Smoke-Workaround) - reine Anleitung, kein Code. |
| `test/*` | Fakes fuer die 2 neuen Port-Methoden in den bestehenden Billing-Test-Doubles. Neue/angepasste Tests: carried-plan-Erfolg ueber den neuen Pfad, Customer-Mismatch weiter 403, doppelter `/return`-Aufruf idempotent (kein Doppel-Abo), reiner Karten-Flow (kein Plan) unveraendert (Regression), `plan_unconfigured` weiter sauberer Fehler VOR dem Stripe-Call. |

## Sicherheits-Invarianten (unveraendert, nur an neuer Stelle durchgesetzt)

- Customer-Match: eine fremde `session_id` darf NIE ein fremdes `payment_method`
  oder Abo an einen anderen Tenant binden (R4) - dieselbe Pruefung wie heute,
  nur gegen das Ergebnis von `getSubscriptionCheckoutResult` statt
  `getCheckoutSessionResult`.
- `already_subscribed`-Schutz bleibt Pflicht, auch wenn Stripe die Subscription
  schon serverseitig angelegt hat - verhindert doppelte lokale Aktivierung bei
  Doppel-Redirect/Reload.
- Secrets (weiterhin nur `STRIPE_SECRET_KEY` im Header, nie im Body/Log/Fehlertext).
- `PAYMENT_ENABLED`-Gate unveraendert davor (404 wenn aus).

## Out of Scope

- Kein App-seitiges Coupon-/Code-Validierungs-UI (Stripe rendert das selbst).
- Kein App-seitiges Berechtigungssystem fuer Codes (Entscheidung 1).
- Bare `/subscribe`-Pfad (Plan-Wechsel bei bestehender Karte) unveraendert,
  SCA/3DS-Risiko dort bleibt offen wie im Runbook dokumentiert.
- Keine Aenderung an `src/billing/webhook.js` angenommen (Checkout-Sessions im
  `subscription`-Modus loesen weiterhin `customer.subscription.created` aus -
  dieselben 4 Webhook-Events wie im Runbook Schritt 4 reichen). Wird in der
  Planungs-/Umsetzungsphase gegen den tatsaechlichen Code verifiziert, nicht
  nur angenommen.

## Manuelle Stripe-Dashboard-Schritte fuer Jonas (kann Claude nicht selbst)

Wird als kurze Anleitung mit der Umsetzung geliefert: Coupon "100% off, once"
anlegen, Promotion Code (z.B. `OWNER100`) daran binden, max. 1 Einloesung
(oder auf den eigenen Customer beschraenkt).

## Pre-Mortem (ein Jahr in der Zukunft, Entscheidung war falsch)

- **Code geleakt/erraten**: jeder eingeloggte Tenant mit einem gueltigen Code
  kann ihn nutzen (Entscheidung 1, akzeptiert). Mitigation liegt bei Jonas:
  `max_redemptions`, Ablaufdatum, ggf. Customer-Bindung in Stripe.
  Akzeptiertes Risiko, nicht durch App-Code mitigiert.
- **Timing-Luecke**: `GET /checkout/sessions/{id}` direkt nach Redirect liefert
  die `subscription` moeglicherweise noch nicht voll expandiert. Wird im
  Live-Smoke explizit geprueft (Verifikationspunkt, kein Blocker).
- **Falsches Sicherheitsgefuehl**: der Umbau behebt das SCA/3DS-Risiko NUR fuer
  den Erst-Abschluss-Pfad, NICHT fuer `/subscribe` (Plan-Wechsel bei
  bestehender Karte). Muss in der Kommunikation an Jonas klar bleiben, damit
  das offene Risiko im Runbook nicht faelschlich als "erledigt" gilt.
