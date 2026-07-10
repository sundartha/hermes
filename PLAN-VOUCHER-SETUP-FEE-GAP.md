# PLAN — Owner-Voucher zeigt 0 EUR, Nummer-Provisioning schlaegt trotzdem mit HTTP 402 fehl

**Stand:** 2026-07-09, Agent-Team-Analyse (2 parallele Read-only-Subagents: Frontend-UX-Trace +
adversariale Root-Cause-Verifikation; ein dritter Subagent fuer Produktions-DB-Lesezugriff wurde
vom Auto-Mode-Classifier geblockt — kein expliziter Jonas-Auftrag fuer Prod-DB-Reads, siehe §6).
Status: **Alle drei Fixes (C, A, B) sind implementiert und auf master gemergt.** C: 2026-07-09
`729131c`. A: 2026-07-09 `ce478a9`. B: 2026-07-10 `234a066` (Reports: `tasks/c-report.md`,
`tasks/voucher-fee-a-report.md`, `tasks/voucher-fee-b-report.md`). Fix B wurde von Jonas
explizit freigegeben (Design-Entscheidung "0-EUR-Checkout generisch" + Merge trotz offenem
Coupon, 2026-07-10) — **das Stripe-seitige Redemption-Limit auf dem Voucher-Coupon ist
bewusst NICHT gesetzt, siehe §6 Punkt 3 fuer den aktuellen Live-Stand.**

**Nicht verwechseln mit `HANDOVER-TELNYX-402.md`:** das war ein **Telnyx-Account-Funding-402**
(Telnyx `orderNumber`, Telnyx-Guthaben zu niedrig). Dieser Bug hier ist ein **Stripe-seitiger
402** (`billing.placeHold`, unsere eigene Karten-Belastung des Tenants) — zwei komplett getrennte
Systeme, zufaellig derselbe HTTP-Code.

---

## 1. Was passiert ist (Jonas' Bericht + Log-Beleg)

Jonas hat sich als normaler Self-Service-Tenant angemeldet, im Stripe-Checkout den Rabattcode
`OWNER100` eingegeben, sah **0,00 €** als Summe, hat abgeschlossen. Danach in der Banking-App:
zuerst eine 0-€-Buchung, **eine Sekunde spaeter eine ~5-€-Buchung — abgelehnt (Karte ohne
Deckung)**. Bei Antonio lief exakt derselbe Flow fehlerfrei durch.

Production-Log (`srv-d8m0fhflk1mc73bno570`, Tenant `t_user_01KWKXZ3H8D9G5B05R5RN88Z6J`, plan=business):

```
20:13:11 [audit] self_service_subscribe_rejected reason=no_card
20:13:12 [audit] self_service_setup_checkout plan=business mode=subscription
20:15:09 [audit] self_service_subscribe outcome=ok profile=ok:6        <- Checkout mit OWNER100 = 0 EUR, Abo aktiv
20:15:11 [audit] stripe_webhook_activate profile=ok:6
20:15:14 [provision-worker] Stripe placeHold fehlgeschlagen: HTTP 402  <- ~3s spaeter, ZWEITE, separate Belastung
```

## 2. Root Cause (verifiziert, kein Regressions-Bug)

Der Flow macht **zwei vollstaendig unabhaengige Stripe-Geld-Operationen**, nur die erste kennt den
Rabattcode:

1. **Subscription-Checkout** (`src/billing/stripe.js:229-255`, `allow_promotion_codes: true`) —
   Stripe-gehostet, rabattfaehig. `OWNER100` (100% off, once) macht daraus korrekt 0 EUR. Die App
   liest hier nur `planSlug`/`subscriptionId`/Periode zurueck (`src/billing/subscribe.js:131-200`)
   — nie den tatsaechlich gezahlten Betrag.
2. **Nummer-Einrichtungsgebuehr-Hold** (`src/onboarding.js:69-77`, `provisionNumber` ->
   `billing.placeHold`) — ein **separater**, off-session Stripe-PaymentIntent (`capture_method:
   manual`, sofort `confirm: true`), Betrag = `config.numberSetupFeeCents` (ENV
   `NUMBER_SETUP_FEE_CENTS`, Fallback 0/Pflichtwert bei `PAYMENT_ENABLED=true`; live vermutlich
   ~500 Cents, nicht in diesem Repo dokumentiert — nur in Render-ENV, siehe §6) bzw. Land-Override
   (`src/telephony/provisioning-geo.js`, aktuell fuer alle Laender inkl. DE = Default-Fallback).
   Nirgends im Code fliesst der Rabattcode oder ein "gilt fuer 0" Flag in diesen Aufruf ein.

**Design-Beleg, dass das eine Luecke und kein bewusstes Risiko ist:**
`docs/superpowers/specs/2026-07-03-stripe-discount-code-checkout-design.md` — von Jonas selbst
approved, explizit gebaut, damit **er** den Live-Smoke-Test faehrt "ohne echtes Geld zu zahlen"
(Zeile 8-9), Coupon-Name buchstaeblich `OWNER100` (Zeile 105). Das dortige Pre-Mortem (Zeile
108-120) deckt Code-Leak, Timing-Luecke, SCA/3DS-Restrisiko ab — **die Nummer-Gebuehr taucht dort
nirgends auf.** Niemand hat den Fall "Rabattcode soll ALLES abdecken" mitgedacht.

**Kein Exemption-Muster wurde umgangen:** `BOOTSTRAP_TENANT_ID` ist der einzige bestehende
"zahlt nichts"-Pfad, aber strukturell komplett anders (vorbelegte Nummer beim Boot, beruehrt
Self-Service/`placeHold` nie). Es gibt keinen bestehenden "skip placeHold fuer X"-Zweig, den der
Voucher-Fall haette mitnutzen koennen — eine Exemption waere Neu-Code.

## 3. Zwei unabhaengige Probleme, nicht eins

**A. Die Gebuehr ist nirgends sichtbar — fuer JEDEN Tenant, nicht nur Voucher-Faelle.**
Frontend-Trace (Astro-App `apps/web/src/components/app/BillingIsland.astro` UND Legacy-Dashboard
`public/tenant.html`) fand **keine** Erwaehnung eines Betrags fuer die Rufnummer — nur die vage
Klammer "(z.B. eigene Rufnummer)" neben "Zahlungsmethode hinzufuegen". Kein Preis, kein Hinweis,
dass das eine ZWEITE, separate Abbuchung nach dem Checkout ist. Jeder zahlende Kunde mit knapper
Kartendeckung oder Bank-Fraud-Flag auf eine zweite Sofort-Abbuchung kann denselben 402 treffen —
der Voucher-Fall macht es nur maximal sichtbar, weil Jonas explizit 0 EUR erwartet hatte.

**B. Scheitert die Gebuehr, sieht der Tenant NICHTS.** `failNumber` setzt die Nummer korrekt auf
`FAILED` (sauberer Rollback, siehe §4) — aber `numberStatusFor` (`src/store/views.js:58-66`) und
das Frontend-Pendant (`apps/web/src/lib/api.js:156-161`) kennen **keinen** `FAILED`-Zweig. Die UI
faellt auf "No number assigned yet" / "nicht konfiguriert" zurueck — ununterscheidbar von "noch
nicht bestellt". Kein Fehlertext, kein Retry-Button, kein Auto-Polling (`/api/state` wird nur
einmal beim Laden gezogen). Jonas hat den Fehler nur gefunden, weil er als Owner in seine
Banking-App geschaut hat — ein normaler Kunde saehe nur "kein Nummer", ohne zu wissen warum.

## 4. Geld-Sicherheit: kein Verlust, aber Sackgasse

`placeHold` schlaegt VOR jedem Provider-Call fehl -> `failNumber` (`onboarding.js:63-81`) -> keine
Nummer gekauft, kein bezahlter Orphan, nichts freizugeben (Hold selbst kam nie zustande). Jonas hat
**kein Geld verloren** — die Buchung, die er als "5 € abgezogen" sah, ist die abgelehnte
Autorisierung (Bank zeigt das oft trotzdem kurz an). Der Tenant bleibt aber "aktiv+abonniert+KYC
CARD, aber keine funktionierende Nummer" — nur ueber `POST /api/onboard/retry` (Owner-only) oder
den Boot-Sweep-Reconciler wiederholbar, kein Self-Service-Ausweg fuer den Tenant selbst.

## 5. Fix-Optionen

| # | Massnahme | Umfang | Status |
|---|---|---|---|
| **C** | `FAILED`/`BLOCKED`-Zweig in `numberStatusFor` + Frontend-Mapping ergaenzen: sichtbarer Fehler + Retry-Hinweis statt stillem "keine Nummer" | klein | **umgesetzt + gemergt** (`729131c`) |
| **A** | Einrichtungsgebuehr VOR Checkout im UI ausweisen ("+X € einmalige Einrichtung fuer deine Rufnummer") | klein-mittel | **umgesetzt + gemergt** (`ce478a9`) |
| **B** | Voucher/100%-off-Tenants auch vom `placeHold` befreien (0-EUR-Checkout generisch ueber `billing.retrieveSubscription`, siehe `src/billing/activation.js`) | mittel-gross | **umgesetzt + gemergt** (`234a066`, 2026-07-10) — Stripe-Guard bewusst offen gelassen, siehe §6 Punkt 3 |
| D | Sofort-Workaround fuer Jonas' Tenant: Karte aufladen ODER Gebuehr manuell in Stripe erlassen, dann `POST /api/onboard/retry` | keine Code-Aenderung | obsolet (B gemergt) |

## Pre-Mortem (B ist umgesetzt — hier steht, was VOR dem Merge noch zu Ende gedacht werden muss)

Ein Jahr weiter, Voucher-Tenants sind vom Hold befreit — was ging schief? Ein geleakter/erratener
Code (Pre-Mortem-Risiko aus dem Original-Design, akzeptiert) befreit jetzt nicht nur die
Subscription, sondern auch die Nummer-Gebuehr — potenziell mehr echte Kosten pro Missbrauchsfall
(Telnyx-Nummernkauf ist ein realer Fremdkosten-Posten, keine reine Software-Grenze). Der Code
prueft absichtlich generisch "Rechnung war 0 EUR" (`src/billing/stripe.js:retrieveSubscription`)
und NICHT einen konkreten Coupon-Namen — jede Konstellation, die Stripe auf 0 EUR bringt, loest
die Befreiung aus. Die komplette Restriktion gegen Missbrauch liegt damit ausserhalb der App, in
Stripe: dieselbe Redemption-Begrenzung (`max_redemptions`, Ablaufdatum, Customer-Bindung) auf dem
`OWNER100`-Coupon, die `docs/RUNBOOK-STRIPE-LIVE.md` §10 bereits empfiehlt. **Diese Begrenzung
konnte in diesem Review-Fix-Durchlauf NICHT verifiziert werden** — dieser Sandbox-Worktree hat
keinen Stripe-Dashboard-/API-Zugriff (kein `.env`, kein Stripe-MCP-Tool). Siehe §6 Punkt 3.

## 6. Offene Punkte / Jonas-Aktion

1. **Antonios erfolgreicher Durchlauf ist nicht durch Prod-DB-Daten bestaetigt** — der DB-Read-Subagent
   wurde vom Auto-Mode-Classifier geblockt (kein expliziter Auftrag fuer Produktions-DB-Zugriff in
   der urspruenglichen Anfrage). Arbeits-These: Antonios Karte hatte genug Deckung fuer die
   ~5-€-Gebuehr, die Gebuehr wurde bei ihm NICHT erlassen — er hat sie einfach unbemerkt bezahlt.
   Falls gewuenscht: expliziten Auftrag fuer einen Postgres-Read (`mcp__render__query_render_postgres`)
   geben, um Tenant-IDs aus den Logs auf Accounts/Nummern-Status zu mappen und das zu verifizieren.
2. **Exakter `NUMBER_SETUP_FEE_CENTS`-Wert** ist nicht im Repo (nur Render-ENV) — falls fuer die
   Fix-Entscheidung relevant, im Render-Dashboard nachsehen oder Freigabe fuer einen Env-Read geben.
3. **Stripe-seitige Redemption-Begrenzung — GEPRUEFT 2026-07-10, bewusst offen gelassen.**
   Jonas hat den Coupon im Stripe-Dashboard nachgeschaut: Promotion Code heisst tatsaechlich
   `SDA-OWNER-94KX7Q` (nicht `OWNER100` — das war nur der Name im urspruenglichen Design-Doc/
   Audit-Log-Kontext). Befund: **kein `max_redemptions`, kein Ablaufdatum, Coupon-Dauer
   "unbegrenzt/wiederkehrend"** (nicht "einmalig" wie in `docs/RUNBOOK-STRIPE-LIVE.md` §10
   vorgesehen). Bereits 4 Einloesungen durch 2 Kunden (antonio.fotiadis.francisco@gmail.com 3x,
   jonas@kroh-willich.de 1x). Jonas hat sich entschieden, Fix B trotzdem zu mergen (Risiko
   akzeptiert) — der Code ist technisch weiterhin offen: jeder mit `SDA-OWNER-94KX7Q` bekommt
   Subscription UND Nummer-Gebuehr umsonst. Absichern (max_redemptions/Ablauf setzen oder Code
   deaktivieren) bleibt eine reine Stripe-Dashboard-Aktion, kein Code-Fix moeglich (§ Pre-Mortem).
4. **Explizite Jonas-Freigabe fuer Fix B — ERTEILT 2026-07-09/10.** Design-Entscheidung
   "0-EUR-Checkout generisch" (statt Tenant-Allowlist) sowie der Merge trotz offenem Coupon
   (Punkt 3) wurden von Jonas explizit bestaetigt. B ist auf master (`234a066`).
5. **NEU (2026-07-10, separat von Fix B): Coupon-Dauer "wiederkehrend" statt "einmalig".**
   `SDA-OWNER-94KX7Q` ist als 100%-Rabatt MIT WIEDERKEHRENDER Dauer konfiguriert, nicht als
   Einmal-Rabatt fuer den Owner-Smoke-Test. Das heisst: Antonio und Jonas bekommen ihre gesamte
   Subscription **jeden Abrechnungszeitraum** umsonst, nicht nur einmalig — ein bestehender
   Revenue-Leak, unabhaengig von der Nummer-Gebuehr aus diesem Plan-Dokument. Kein Code-Fix
   moeglich/noetig (reine Stripe-Konfiguration); Entscheidung liegt bei Jonas (Coupon-Dauer auf
   "once" umstellen oder bewusst so belassen).
