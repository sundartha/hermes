# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: Abo-ohne-Nummer Wurzelfix (Webhook-Race) — 2026-07-06

## Befund (Live-Logs 2026-07-06 07:05-07:06 UTC, verifiziert)

Tenant `t_user_01KWSDW4JZ12WF02NGPYW0BA4V`, Plan business:

1. 07:05:51 `self_service_subscribe_rejected reason=no_card` -> `setup_checkout mode=subscription` (korrekt)
2. 07:06:23 `stripe_webhook_activate profile=ok:6` — der Webhook GEWINNT das Rennen
   gegen den Browser-Return, speichert Abo, stoesst Provisioning an
3. 07:06:23 `[provision-worker] ... hat kein hinterlegtes Zahlungsmittel` — Nummer
   -> failed. Der Webhook-Pfad speichert NIE customerId/paymentMethodId
4. 07:06:25 `self_service_subscribe outcome=already_subscribed profile=none` — der
   Return-Pfad bricht in `activateSubscriptionFromCheckoutSession` (subscribe.js:145-148)
   VOR `setTenantStripe` (Z.154) ab -> Karte wird NIE gebunden -> Provisioning dauerhaft tot

Warum "hat schon mal funktioniert": vor dem Stripe-Live-Cutover war der Webhook-Secret
tot (alle Webhooks signature-rejected) -> der Return gewann immer und band die Karte.
MAX_NUMBERS war ein Fehlschluss der letzten Session (failed-Nummern zaehlen NICHT gegen
die Caps, state-ops.js liveNumbers schliesst FAILED aus; Worker-Log nennt die Wurzel klar).

## Fix (2 Schichten, beide fail-closed)

- [ ] 1. `src/billing/webhook.js`: ACTIVATE-Event traegt `customer` + `default_payment_method`
      (signatur-verifiziert). Fehlt die Karte am Tenant UND matcht der Customer
      (customerMatches, R4), Karte VOR activatePaidTenant binden -> Webhook-Pfad
      provisioniert selbststaendig (Browser-Return wird optional, wie es sein muss).
      NIE eine vorhandene Karte ueberschreiben (nur Luecke fuellen).
  - Erwartet: neuer Test p3-payment-webhook: Event mit customer+default_payment_method
    + Tenant ohne Karte -> setTenantStripe({paymentMethodId}) genau 1x vor provision;
    mit Karte -> kein Bind; Customer-Mismatch -> kein Bind
  - Verifikation: `node --test test/p3-payment-webhook.test.js` gruen
- [ ] 2. `src/billing/subscribe.js` (`activateSubscriptionFromCheckoutSession`):
      already_subscribed mit IDENTISCHER subscriptionId + Tenant OHNE Karte =
      Webhook-gewonnenes Rennen -> heilen (setTenantStripe + activatePaidTenant,
      beides idempotent). MIT Karte = echter Doppel-Redirect -> No-op wie bisher.
  - Erwartet: bk2-Test (7) mit Karte-Seed unveraendert gruen; neuer Test (16):
    subscribed ohne Karte -> 302 sub=ok, pm gebunden, provision genau 1x
  - Verifikation: `node --test test/bk2-checkout-return-plan.test.js` gruen
- [ ] 3. `paymentMethodIdOf` von stripe.js nach webhook.js verschieben (G5, eine
      Quelle; Abhaengigkeitsrichtung Adapter -> pures Modul)
  - Verifikation: `node --check` auf beide Dateien + bestehende Stripe-Tests gruen
- [ ] 4. Volle Suite + Syntax
  - Verifikation: `npm test` komplett gruen
- [ ] 5. Commit (NUR die beruehrten Dateien, Tree ist dirty mit fremder Arbeit),
      Push origin + upstream (Render autodeployt master)
  - Verifikation: Render-Deploy live + [boot]-Banner mit neuem Commit-Hash
- [ ] 6. Live-Reparatur Tenant `t_user_01KWSDW4JZ12WF02NGPYW0BA4V`: Stripe-Event
      `customer.subscription.updated` erneut zustellen (Stripe-Dashboard "Resend"
      oder Metadata-Edit) ODER Return-URL aus Browser-History erneut oeffnen ->
      Fix 1/2 bindet Karte + provisioniert
  - Verifikation: Render-Log `stripe_webhook_activate` + Provision-Worker OHNE
    Zahlungsmittel-Fehler, Nummer wird active

## Offene Nebenbefunde (nicht Teil dieses Fixes)

- `stripe_webhook_rejected signature` weiterhin sporadisch (04:58, 07:06:22, 07:06:39)
  NEBEN erfolgreichen Zustellungen -> vermutlich zweiter/alter Webhook-Endpoint im
  Stripe-Dashboard mit totem Secret. Ops: alten Endpoint loeschen.
- MAX_NUMBERS-Erhoehung der letzten Session war wirkungslos (kein Schaden, kann bleiben).
