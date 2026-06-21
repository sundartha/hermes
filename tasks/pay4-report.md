# Pay4 — Test-Mode-Smoke end-to-end + Report

Letzte Pay-Phase. Zweck: beweisen, dass `Onboard -> Customer -> payment_method -> Hold -> Capture`
im Stripe **TEST-MODE** durchlaeuft, **ohne** Live-Key und **ohne** echten Nummernkauf.

## Status

| Feld | Wert |
|---|---|
| Status | umgesetzt (Skript + Offline-Guard-Test); Live-Netz-Smoke ist Lead-Gate |
| finalBranch | `phase/pay4-smoke` |
| Commit | siehe `git rev-parse HEAD` (headCommit im Struktur-Return) |
| Tests | 708 pass / 0 fail (Baseline 704 + 4 neue Offline-Guard-Tests) |
| Dependencies | keine neue npm-Dependency (globales `fetch`, Node 22.x) |
| `src/`-Edits | keine (Pay1-Pay3 haben Adapter/Onboarding/Store vollstaendig geliefert) |

## Liefergegenstaende

1. `scripts/smoke-stripe-payment.mjs` — Smoke-Skript (kein Teil von `npm test`).
   - Fail-closed-Guard `isTestKey(secretKey)`: nur `sk_test_`-Keys, sonst Abbruch (nie live).
   - Schritte: (1) `createCustomer` (2) `pm_card_visa` attachen + als default setzen
     (3) `provisionNumber` mit Fake-Provisioner (kein echter Kauf) + echtem Stripe-Test
     (4) Hold (`requires_capture`) -> Capture (`succeeded`), strukturell ueber `provisionNumber`.
   - Ausgabe: nur opake ids (`cus_…`, `pi_…`) + Status. KEIN Secret. Geld als Ganzzahl-Cents.
   - `isMain`-Guard: `main()` laeuft NUR als Skript, nicht beim Import (Offline-Test).
2. `test/pay4-smoke-guard.test.js` — 4 Offline-Tests fuer `isTestKey`
   (`sk_test` true; `sk_live`/leer/null/undefined/Nicht-String false). Kein Netz, kein Secret.

## Smoke-Belege (im Worktree, ohne Netz)

- `node --check scripts/smoke-stripe-payment.mjs` -> ok
- `node --check test/pay4-smoke-guard.test.js` -> ok
- `npm test` -> 708 pass / 0 fail (kein Netz-Call waehrend der Suite; `isMain`-Guard greift)
- `STRIPE_SECRET_KEY=sk_live_x node scripts/smoke-stripe-payment.mjs`
  -> `smokePass=false` + "… KEIN sk_test_-Key (fail-closed, nie live)", Exit 1, KEIN Netz-Call
- ohne Key gesetzt -> ebenfalls `smokePass=false` (fail-closed), Exit 1
- Echter Test-Mode-Smoke (Schritt C, NUR Lead mit `sk_test_…` + Netz): in diesem Worktree
  NICHT ausfuehrbar (kein Test-Key vorhanden) -> Lead-Gate, smokePass best-effort=false.

### Lead-Anleitung (echter Test-Mode-Smoke)

```
STRIPE_SECRET_KEY=sk_test_… node scripts/smoke-stripe-payment.mjs
```
Erwartet: `smokePass=true` + `customer=cus_…`, `paymentIntent=pi_…`,
`numberStatus=active`, `betrag=500 Cents eur` — kein Secret in der Ausgabe.

## Was fuer ECHTES Geld noch fehlt

- **Live-Key + echter Kauf**: `sk_live` + `PROVISIONING_ENABLED=true` + echter
  Nummernkauf statt Fake-Provisioner. Heute bewusst aus (fail-closed). `PAYMENT_ENABLED`
  bleibt der Gate; Flag aus = byte-identisch.
- **Meter im Stripe-Dashboard**: Die P6b3-Meter (`voice_minutes`/`ai_tokens`/`number_months`)
  muessen im Stripe-Dashboard angelegt sein, sonst schlaegt `reportMeter` fehl
  (event_name-Mismatch). Eigener Owner-Smoke noetig (Pay4 deckt nur Hold/Capture ab).
- **`stripe_customer_id`-Lebenszyklus**: Customer-Loeschung bei Tenant-Erase (Art.17),
  pg-Persistenz der Stripe-Referenzen (heute via `flushTenants`), Recycling. Reife pruefen,
  bevor echte Kunden Karten hinterlegen.
- **SCA-Edge `authentication_required`**: Der `off_session`-Charge kann bei ECHTEN Karten
  3DS verlangen (`pm_card_visa` tut das nie). Der Capture-Pfad braucht dann einen
  Recovery-Flow (z.B. Kunde-zurueck-ins-Checkout). Heute nicht implementiert.

## Bewusste Abweichungen / Nicht-Aenderungen

- Kein neues `npm run`-Script fuer den Smoke (kleinster Blast-Radius + Spec):
  der Smoke ist explizit kein Teil von `npm test`, wird direkt via `node scripts/…`
  gefahren — analog `scripts/telnyx-ws-echo.mjs`.
- Die Test-Karten-Mechanik (`attach` + default) lebt NUR im Smoke, nicht im Adapter:
  in Produktion macht das die Stripe-Checkout-Setup-Session aus Pay1 — kein toter
  Produktionscode (F4/G9).
- Fake-Provisioner aus `test/helpers.js` wiederverwendet (G5/S2: eine Quelle), da rein
  in-memory + kein Netz. Falls Skript->`test/`-Import als Schichtgrenze gewertet wird:
  Fallback = drei-Zeilen Inline-Stub im Skript.
