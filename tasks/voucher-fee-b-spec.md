# voucher-fee-b

Phase B von `PLAN-VOUCHER-SETUP-FEE-GAP.md` (Fix-Option B): Voucher/100%-off-Tenants auch vom
Nummer-Einrichtungsgebuehr-Hold (`placeHold`) befreien.

## Design-Entscheidung (von Jonas bestaetigt)

**Keying-Strategie: "0-EUR-Checkout generisch"** — NICHT eine Tenant-Allowlist. Die App liest
beim Checkout-Abschluss den tatsaechlich gezahlten Betrag von Stripe (nicht ob irgendein
Coupon-Code existiert) und merkt sich pro Tenant, ob die Subscription mit 0 EUR abgerechnet
wurde. Bei der spaeteren Nummer-Provisionierung (`placeHold`) wird der Hold uebersprungen,
wenn dieses Flag gesetzt ist. Gilt generisch fuer JEDEN 100%-off-Checkout (nicht nur OWNER100
hart-codiert) — konsistent mit der bestehenden Design-Linie aus
`docs/superpowers/specs/2026-07-03-stripe-discount-code-checkout-design.md` Decision 1
("Restriktion lebt komplett in Stripe, kein App-Code fuer wer den Code nutzen darf").

## Bekannte Fakten aus Vorab-Recherche (Explore-Agent, bereits erhoben)

- Aktuell liest NICHTS im Code den tatsaechlich gezahlten Betrag/Discount von Stripe zurueck.
  `src/billing/stripe.js` (`getSubscriptionCheckoutResult`) expandiert nur
  `subscription`+`default_payment_method`, liest `customerId`/`paymentMethodId`/
  `subscriptionId`/`currentPeriod*`/`planSlug`. KEIN `discounts`/`total_details`/
  `amount_total` wird gelesen. Muss NEU geplumbt werden (z. B. die Checkout Session selbst
  hat bereits `amount_total`/`amount_subtotal` — pruefen ob das ohne zusaetzliches `expand[]`
  reicht, sonst `expand[]=total_details` ergaenzen).
- `src/billing/subscribe.js` (`activateSubscriptionFromCheckoutSession`) ist die Stelle, die
  `outcome.*` konsumiert und den Tenant aktiviert — natuerlicher Ort, ein Flag (z. B.
  `numberSetupFeeExempt: true` o.ae.) am Tenant zu setzen.
- Es gibt einen PARALLELEN Webhook-Pfad (`src/billing/webhook.js`, `interpretStripeEvent` fuer
  `customer.subscription.created/updated`). Pruefen: reicht EIN Ort (Checkout-Return ODER
  Webhook) als Single Source, ohne den jeweils anderen Pfad zu vergessen — Konsistenzrisiko,
  falls Checkout-Return und Webhook unabhaengig voneinander den Tenant aktivieren koennen.
- `placeHold`-Aufruf: `src/onboarding.js` (`provisionNumber`). Liest bisher NUR
  `tenantStripe` (`customerId`/`paymentMethodId`), keine Subscription-/Payment-Daten. Muss ein
  neues Feld lesen, um zu wissen ob der Hold uebersprungen werden soll.
- Kein bestehendes Exemption-Pattern fuer `placeHold`: `BOOTSTRAP_TENANT_ID` ist strukturell
  komplett anders (umgeht `provisionNumber` komplett via Boot-Seed statt eines Skip-Branchs
  darin) — echter neuer Code noetig.
- `src/config.js` hat aktuell keine voucher/discount/coupon-Flags.

## Pre-Mortem-Risiko (siehe PLAN-VOUCHER-SETUP-FEE-GAP.md Section "Pre-Mortem")

Wird dieser Fix umgesetzt, befreit ein geleakter/erratener 100%-off-Code nicht nur die
Subscription, sondern auch die Nummer-Gebuehr — potenziell hoehere echte Kosten pro
Missbrauchsfall (Telnyx-Nummernkauf ist ein realer Fremdkosten-Posten, keine reine
Software-Grenze). Mitigation liegt Stripe-seitig (`max_redemptions`/Ablauf/Customer-Bindung
auf dem Coupon/Promotion-Code) — das ist NICHT Teil dieser Code-Aenderung (liegt ausserhalb
des Repos, im Stripe-Dashboard). Die Stripe-seitige Bestaetigung wird SEPARAT (ausserhalb
dieses Workflows) eingeholt, bevor final gemergt/deployed wird — kein Blocker fuer die
Code-Implementierung selbst, aber im Report explizit als offene Voraussetzung nennen.

## Referenz-Muster dieser Session

Phase A und Phase C dieses selben Plans sind bereits gemergt (Commits `ce478a9`, `729131c`).
Gleicher Qualitaets-/Test-/Review-Standard gilt hier. Insbesondere: EINE Quelle fuer
Geld-Formeln (Anzeige == Charge, siehe `numberSetupFeeCentsFor` aus Phase A als Vorbild fuer
"keine zweite Inline-Kopie einer Geld-Berechnung").
