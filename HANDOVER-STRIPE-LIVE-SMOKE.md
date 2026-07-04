# Handover: Stripe-Live-Cutover-Smoke (RUNBOOK-STRIPE-LIVE.md Schritt 7)

Datum: 2026-07-04. Status am Session-Ende: **nicht abgeschlossen** - Starter-Checkout
technisch fehlerfrei, aber KEIN Log-Beleg fuer eine tatsaechlich abgeschlossene
Zahlung. Business zusaetzlich durch zwei verschraenkte Stripe-Fehler blockiert.
Verifiziert durch 2 unabhaengige Read-only-Check-Agents (Ergebnisse unten
eingearbeitet, nicht nur meine eigene Einschaetzung).

## Ausgangslage

RUNBOOK-STRIPE-LIVE.md sollte per reinem Config-Cutover (Render-Env + Stripe-
Dashboard) live gehen, ohne Code-Change. Parallel wurde in dieser Session ein
neues Feature gebaut (Rabattcode via Stripe-Checkout Subscription-Modus, Design-
Spec `docs/superpowers/specs/2026-07-03-stripe-discount-code-checkout-design.md`,
Plan `docs/superpowers/plans/2026-07-03-stripe-discount-code-checkout.md`),
weil der Owner (Jonas) den Live-Smoke ohne echte Zahlung durchziehen wollte.
Beim tatsaechlichen Live-Smoke kamen dann mehrere unabhaengige, echte Bugs zum
Vorschein - dokumentiert unten in der Reihenfolge, wie sie auftraten.

## Was diese Session tatsaechlich geaendert/behoben hat (bestaetigt)

| # | Problem | Fix | Nachweis |
|---|---|---|---|
| 1 | Kein Diagnose-Text bei Stripe-Fehlern (`assertOk` liest Body nicht) | `assertOkWithDetail`-Helper in `src/billing/stripe.js`, Commit `584b976` | 1651/1651 Tests gruen, seither lesbare Stripe-Fehler in den Logs |
| 2 | Tenant hatte alte Test-Mode-Customer-ID (`cus_UokkFVyQ8bXDkl`) gespeichert - existierte im Live-Account nicht (`resource_missing`) | Manuelles `UPDATE tenant SET stripe_customer_id=NULL, stripe_payment_method_id=NULL WHERE id='t_user_01KWKXZ3H8D9G5B05R5RN88Z6J'` auf `hermes-db` (Postgres, `dpg-d8tpesreo5us73bogaig-a`) + Service-Neustart (pg-Store hydriert `state` NUR beim Boot, s.u.) | Fehler verschwand nach Neustart, neuer Fehler kam (Preis-Problem, s.u.) |
| 3 | Stripe-Produkt hinter dem Live-Starter-Price war archiviert (`product not active`) | Jonas hat Produkt in Stripe Live reaktiviert (Dashboard, Account `acct_1Tki8x3d0y9L6Epq`) | Fehler verschwand |
| 4 | `STRIPE_BUSINESS_PRICE_ID` in Render war leer (`plan_unconfigured`) | Ich habe `price_1Tp38M3d0y9L6EpqLprdGYw3` direkt via Render-MCP gesetzt (Jonas' Eingabe hatte aus unbekanntem Grund keinen Deploy ausgeloest) | Deploy `dep-d94cjl28qa3s73cci1l0` live 08:55:34Z |
| 5 | Antonio (Kollege) hat parallel auf `Launch-Fixes-Kette` (F1-F12) gearbeitet und einen Merge mit Konflikt in `src/billing/stripe.js` direkt auf `origin/master` gepusht | Verifiziert (Agent, read-only): Merge sauber, KEINE Konflikt-Reste, alle 4 neuen Funktionen intakt, 1745/1745 Tests gruen auf `origin/master` | Siehe Verifikations-Ergebnis unten |

**Wichtige Umgebungs-Erkenntnis:** es gibt/gab ZWEI verschiedene Stripe-Accounts
im Spiel - ein alter Test-Account (`acct_1Tki9B3QGz3ubjYA`) und der jetzt aktive
Live-Account (`acct_1Tki8x3d0y9L6Epq`). Der `request_log_url` in jeder Stripe-
Fehlermeldung verraet das Konto zuverlaessig (`/test/` im Pfad = Test-Mode).

**Architektur-Erkenntnis (fuer kuenftige DB-Fixes wichtig):** `src/store/pg.js`
hydriert den kompletten State EINMALIG beim Boot (`init()`); externe SQL-Aenderungen
(z.B. via `psql`) werden vom laufenden Prozess NICHT automatisch bemerkt - es
braucht einen Neustart (z.B. via harmlosen Env-Var-Touch-Redeploy) danach.

## OFFEN - nicht geloest, naechste Session

### 1. Starter-Plan: Checkout-Session wird erzeugt, aber KEIN Beleg fuer Abschluss

Log-Beweis (Verifikations-Agent, Zeitraum 08:20-09:00Z, Tenant
`t_user_01KWKXZ3H8D9G5B05R5RN88Z6J`): 3x `self_service_setup_checkout ...
plan=starter mode=subscription` (= Checkout-Session ERZEUGT, Redirect zu Stripe
ausgeloest). Aber NIRGENDS eine `self_service_subscribe outcome=ok` oder
`self_service_card_saved` Audit-Zeile (= die `/billing/return`-Route, die nach
erfolgreichem Stripe-Checkout laeuft). Es ist NICHT bewiesen, dass Jonas den
Stripe-Checkout jemals wirklich abgeschlossen (Karte eingegeben + bestaetigt)
hat - "funktioniert!" bezog sich vermutlich nur auf "kein Backend-Fehler mehr
beim Redirect", nicht auf einen abgeschlossenen Kauf.

**Naechster Schritt:** Owner geht den Flow NOCHMAL komplett durch (bis zur
Ruckkehr-Seite `/tenant.html?sub=ok`), danach in den Render-Logs nach
`self_service_subscribe` mit `outcome=ok` suchen ODER in Stripe Live-Dashboard
(`https://dashboard.stripe.com/acct_1Tki8x3d0y9L6Epq/subscriptions`) nach
einer echten Subscription fuer diesen Tenant schauen.

### 2. Business-Plan: doppelt blockiert

a) **Stale Customer (neu, anderer als Fix #2 oben):** bare
`/api/self-service/billing/subscribe`-Pfad (laeuft nur wenn `hasCardOnFile`
bereits true ist) scheitert mit `No such customer: 'cus_UojtlTVoGszA1C'`
(HTTP 404, resource_missing). Das ist eine ANDERE, neue Customer-ID als der
urspruengliche Fix - vermutlich waehrend der vielen Testversuche in dieser
Session unter wechselnden Stripe-Zustaenden entstanden. Gleiches Muster wie
Fix #2: `stripe_customer_id`/`stripe_payment_method_id` fuer diesen Tenant in
`hermes-db` pruefen und ggf. erneut auf NULL setzen + Neustart.

b) **Stripe-Idempotency-Lock (bestaetigt, exakter Fehler):**
```
Keys for idempotent requests can only be used with the same parameters they
were first used with. Try using a key other than
'subcs_t_user_01KWKXZ3H8D9G5B05R5RN88Z6J_business' if you meant to execute a
different request.
```
Der Idempotency-Key ist tenant+plan-gebunden (`checkoutSessionIdempotencyKey`
in `src/billing/subscribe.js`, bewusst so gebaut gegen Doppel-Klick-Races,
G5/S1-Fix aus dieser Session) und wurde durch die vielen Retries mit
wechselnder `STRIPE_BUSINESS_PRICE_ID` "verbrannt". Stripe-Keys verfallen nach
24h automatisch. **Zwei Wege:** entweder bis morgen warten, oder mit einem
ANDEREN/neuen Test-Tenant testen (Key ist pro Tenant+Plan, ein frischer Tenant
hat einen frischen Key).

### 3. Preis-Drift-Verdacht (ungeklaert, von Jonas erwaehnt)

Jonas sagte "6,99 Euro" fuer Business, Katalog (`src/plans.js`) sagt 9,99 EUR.
Nicht verifiziert ob er wirklich einen 6,99-Preis in Stripe angelegt hat oder
sich vertippt hat. **Pruefen:** `https://dashboard.stripe.com/acct_1Tki8x3d0y9L6Epq/prices/price_1Tp38M3d0y9L6EpqLprdGYw3`
- steht da wirklich 9,99 EUR?

## Code-Stand (verifiziert, keine Sorge noetig)

- `origin/master` Tip: `21553b4c742076eb36c0be21a9a9e1e5929fd0ee` (Antonios
  Merge). Live auf Render seit 08:56:02Z.
- `src/billing/stripe.js` darauf: vollstaendig, keine Merge-Konflikt-Reste,
  `node --check` sauber, alle Session-Fixes drin.
- `npm test` auf `origin/master`: **1745/1745 gruen** (verifiziert in
  isoliertem Worktree, lokaler Checkout nicht angefasst).
- Lokaler Checkout in `/Users/jonaskroh/Larry/deliverables/vodafone-agent`
  ist 39 Commits hinter `origin/master` (nur veraltet, keine Konflikte) -
  **vor der naechsten Session `git pull` machen.**

## Render-Env-Stand (von mir/Jonas gesetzt, zur Doku - keine Werte hier, nur Keys)

`PAYMENT_CURRENCY`, `NUMBER_SETUP_FEE_CENTS`, `STRIPE_BUSINESS_PRICE_ID` wurden
diese Session gesetzt/veraendert (Service `vodafone-agent`,
`srv-d8m0fhflk1mc73bno570`). `STRIPE_STARTER_PRICE_ID`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` wurden von Jonas direkt im Dashboard gepflegt (nie
durch den Chat gelaufen, Repo-Regel 4).

## Empfohlene Reihenfolge naechste Session

1. `git pull` (39 Commits nachziehen, Antonios F1-F12-Kette pruefen ob relevant fuer eigene Arbeit).
2. Stripe Live-Dashboard pruefen: existiert eine echte Subscription fuer
   `t_user_01KWKXZ3H8D9G5B05R5RN88Z6J`? Falls nein: Starter-Checkout nochmal
   komplett bis zur Ruckkehr-Seite durchziehen.
3. Business: `hermes-db`-Tenant-Row pruefen/bereinigen (Muster wie Fix #2),
   dann Idempotency-Key-Situation abwarten ODER neuen Test-Tenant nutzen.
4. Preis-Drift (6,99 vs. 9,99) im Stripe-Dashboard verifizieren.
5. Erst NACH echtem gruenen Smoke (Runbook Schritt 7 komplett, inkl. Webhook-
   2xx-Check + Meter-Flush-Check): Cleanup (Test-Abo kuendigen/refunden, wie
   Runbook Schritt 7.7 vorschreibt).
