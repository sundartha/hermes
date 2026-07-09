# Phase A — Einrichtungsgebuehr vor Checkout im UI ausweisen

**Plan:** PLAN-VOUCHER-SETUP-FEE-GAP.md, Fix-Option A
**Gate:** PASS
**finalBranch:** `fix/voucher-setup-fee-gap-a-fix1` (gemergt, ff, master @ ce478a9)

## Ziel

Problem A aus dem Plan: die Nummer-Einrichtungsgebuehr (`placeHold`, separater off-session
Stripe-Charge nach dem Subscription-Checkout) war im UI nirgends sichtbar. Jeder zahlende
Kunde mit knapper Kartendeckung konnte von dieser zweiten, ueberraschenden Abbuchung mit
HTTP 402 getroffen werden.

## Umsetzung

- `config.numberSetupFeeCents` + `currency` jetzt Teil von zwei bestehenden, bereits
  authentifizierten Routen (`/api/state`, `/api/self-service/billing/status`) statt nur
  env-only — kein neuer Endpoint.
- `numberSetupFeeCentsFor` (`src/self-service-routes.js`) nutzt **dieselbe** Formel
  (`holdAmountForCountry`) wie der echte Charge in `server.js` (runProvisioningDrain) — kein
  Drift zwischen Anzeige und tatsaechlichem Hold-Betrag.
- Kauf-Land-Praezedenz (`forceNumberCountry || homeCountry`) in `src/geo/resolve.js`
  (`resolveNumberCountry`) zentralisiert — genutzt von `provision-trigger.js` (echter Kauf)
  UND `self-service-routes.js` (Anzeige), keine dritte Inline-Kopie (Review-Blocker
  FEE-COUNTRY-DRIFT aus Runde 1, gefixt in `ce478a9`).
- Frontend: `numberSetupFeeFrom` (apps/web/src/lib/api.js) + Spiegel-Funktion gleichen Namens
  in `public/tenant.html` (Legacy-Dashboard, kein gemeinsames Build-System — analoges Muster
  zu `numberPlaceholderText`/`agentNumberText` aus Phase C). Gebuehren-Zeile erscheint als
  ruhige Fussnote unter den Plan-Features, vor dem Subscribe-Button.

## Review

- **Safety:** APPROVED, 0 S1. Keine neue Route, keine Secrets exponiert (kein cus_/sub_/pm_),
  Anzeige-Formel == Charge-Formel, keine Float-Arithmetik.
- **Clean-Code:** 0 S1/S2. Ein S3-Hinweis (nicht blockierend, von Safety mitgefunden):
  `numberSetupFeeCentsFor` liest `homeCountry` ohne den `|| fallbackCountry`, den der echte
  Kaufpfad anwendet — aktuell folgenlos, da kein Land einen `holdAmountCents`-Override traegt;
  wird erst relevant, falls spaeter ein Land-spezifischer Hold-Override UND Pre-Onboard-
  Anzeige (Tenant-Land noch null) zusammenkommen. Empfehlung: bei Einfuehrung eines
  Land-Overrides einzeiligen Kommentar/Fix nachziehen, kein jetziger Blocker.

## Tests

- Neue Unit-Tests: `numberSetupFeeFrom` (api.js), `feeLine`/`planTiles`/`renderPlanChoice`
  mit Fee-Parameter (subscribe.js), `resolveNumberCountry` (geo/resolve.js, inkl.
  Regressionstest fuer den Runde-1-Blocker), tenant.html-Verdrahtungstest (Musterparität zu
  Phase C).
- Volle Suite nach Merge auf master: **1929/1929 gruen**, 0 Failures.
- Zwei Failures waren waehrend der Session in `outbound-reconcile-finishcall.test.js` bzw.
  `telnyx-event-ingest-route.test.js` aufgetreten (je 1x, unterschiedliche Dateien, beide von
  Phase A nicht beruehrt) — isoliert und auf master beide gruen, bestaetigte
  Suite-Flakiness, kein Phase-A-Regressionsbefund.

## Offen

Phase B (Voucher/100%-off-Tenants vom `placeHold` befreien) bleibt Jonas' Entscheidung —
siehe PLAN-VOUCHER-SETUP-FEE-GAP.md §5/§6.
