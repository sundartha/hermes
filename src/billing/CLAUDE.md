`src/billing/` (Stripe Hold/Capture + Metering, hinter `PAYMENT_ENABLED`)

## Baustein abrechnung (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Pläne, Zahlung, Budget, Kostenbelege und Abgleich.
- Darf nutzen: basis, konfiguration, speicher, texte, mail, sperrdaten
- Ort für Neues: Neue Dateien in `src/billing/` gehören zu abrechnung, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Andere Bausteine importieren aus `src/billing/` nur activation.js, cancellation-mail.js, card-setup.js, contract-end-cleanup.js, cost-calibration.js, kostenarten.js, meter.js, metering.js, payment-gate.js, payment-method-eligibility.js, period.js, plan-caps.js, provision-outcome.js, provision-retry.js, stripe-reconcile.js, stripe.js, subscribe.js, subscription-cancellation.js.
