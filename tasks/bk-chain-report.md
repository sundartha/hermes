# Phase BK5 — Test-Mode Smoke end-to-end (Verifikations-Report)

**Phase:** BK5 — Test-Mode Smoke E2E + Report
**Gate:** **PASS**
**Branch:** `phase/bk5-smoke`
**Tests:** 1089 pass / 0 fail (Baseline BK4 = 1082, **+7 BK5**, beide Backends json + pglite)
**Art:** reine Verifikations-Phase — **0 Produktionsdatei-Edits**, 1 neuer Test + dieser Report.

BK5 beweist den gesamten Buchungs-Funnel (BK0–BK4) in **einem durchgehenden in-process
E2E-Lauf auf einem geteilten pglite-Store**, gefahren ueber echte HTTP-Requests
(`node:http`, curl-funktional) gegen die echten Seams. Kein Server-Spawn (Boot ist
fail-closed, Repo-Konvention „Lehre p6a-Stall"). Der `provision`-Seam ist der **echte**
Produktions-Core `requestNumberForPaidTenant` auf dem geteilten Store, der Webhook-Schritt
verifiziert die **echte** HMAC + wendet `applyStripeWebhook` an — kein Mock-Schatten.

---

## 1. Funnel-Walkthrough

| Station | Eingang (HTTP/Seam) | Erwarteter Status | Erwarteter Store-State | Beleg (Fall) |
|---|---|---|---|---|
| Pricing pre-Auth | `GET /api/plans` (ohne Cookie) | `200` | unveraendert; 2 Slugs `starter`/`business`, 499/999 Cents `eur` | (1) |
| Leerzustand | `GET /api/self-service/state` | `200` | kein Abo: `subscription.planSlug=null`, `quota=null`, `agent.number=""`, `hasCard=false` | (2) |
| Plan waehlen | `POST …/billing/setup-checkout {plan:starter}` | `200` | — (successUrl traegt `&plan=starter`) | (3) |
| Rueckkehr → buchen+aktivieren+provisionieren | `GET …/billing/return?session_id=cs_bk5&plan=starter` | `302 → /tenant.html?sub=ok` | Tenant: `stripeSubscriptionId=sub_new`, `stripePlanSlug=starter`, `kycLevel=card`; Account `active`; Stripe-Price `price_starter`; **genau 1** `requested`-Nummer | (4) |
| Webhook `active` (idempotent) | `verifyStripeSignature(…)=true` → `applyStripeWebhook(event,{… provision})` | — (No-op-Wirkung) | **weiterhin genau 1** Nummer (Doppelkauf-Schutz `tenantHasLiveNumber`); Account bleibt `active` | (5) |
| Dashboard final | `GET …/self-service/state` | `200` | `planSlug=starter`, `currentPeriodEnd=PERIOD_END`, `quota={30,0,30}`, **kein** `subscriptionId` (kein Id-Leak), `agent.number=""` | (6) |
| Kontingent live abgeleitet | usage_event `VOICE_MINUTE q=5` → `GET …/state` | `200` | `quota.usedMinutes=5`, `remainingMinutes=25` | (7) |

Faelle (1)+(2) belegen die Pre-Abo-Sicht, (3)+(4) den Geld-/Aktivierungs-Pfad, (5) die
Webhook-Idempotenz, (6)+(7) das Dashboard-Ergebnis. Cap-Block, `PAYMENT_ENABLED`-aus-404,
`no_card`/`already_subscribed` sind in bk2/bk3/w4 abgedeckt und werden hier **nicht**
wiederholt (G5): BK5 prueft die *Verkettung*, nicht erneut jede Gate-Verzweigung.

---

## 2. Dry-Run-Wahrheit (kein Bug, erwartetes Verhalten)

Der gesamte Lauf ist **Test-Mode/Dry-Run** (`PROVISIONING_ENABLED=false`, P3-Default).
Konsequenz, im Test als Fall (6) fixiert:

- `requestNumberForPaidTenant` legt die Nummer als `status=REQUESTED` an; der Drain
  (Transition → `ACTIVE`) laeuft **nur** bei `provisioningEnabled=true`
  (`src/server.js` — Dry-Run-Early-Return im `triggerTenantProvisioning`).
- `activeNumberFor` (`src/store/views.js` → `findActiveNumber`) liefert **nur `ACTIVE`-Nummern**.
  In Dry-Run ist deshalb `agent.number === ""`, obwohl eine reservierte `requested`
  Dry-Run-Nummer fuer den Tenant im Store liegt.

„Dashboard zeigt Nummer" bedeutet in Dry-Run also: **Plan + Kontingent sichtbar,
Dry-Run-Nummer im Store reserviert**, `agent.number` erst nach echtem Kauf. Die echte
E.164-Aktivierung ist der **Owner-Go-Live** (PLAN-Abschnitt 8) — kein Code-Workaround
weicht die Dry-Run-Safety auf.

---

## 3. Beobachtung (kein Fix, Scope BK5)

Im direkten Subscribe-/Rueckkehr-Pfad laeuft das Provisioning **bereits synchron** ueber
`activatePaidTenant` (KYC=CARD → Status `active` → idempotentes `provision`), weil
`createSubscription` mit `error_if_incomplete` arbeitet ⇒ die Zahlung ist beim Rueckkehr
bestaetigt. Der Stripe-Webhook (`applyStripeWebhook`) bestaetigt danach **idempotent**
(Fall 5: kein Doppelkauf via `tenantHasLiveNumber`). Beides erfuellt Owner-Decision #4
(„kein Kauf ohne bestaetigte Zahlung"). Die Webhook-vs-Klick-Nuance ist dokumentiert,
**nicht** geaendert — BK5 ist Verifikation, kein Umbau.

---

## 4. Manuelle Live-curl-Recipe (Owner-Go-Live — NICHT Teil von `npm test`)

Der automatisierte BK5-Smoke ist offline/Dry-Run (kein echtes Geld, keine echte Nummer).
Der Live-Pfad ist ein bewusster, separater **Owner-Schritt** und laeuft **nie** in der
Test-Suite. Voraussetzung: ein manuell gestarteter Server mit Stripe-**Test**-Keys
(`sk_test_…`, fail-closed) und `SKIP_TWILIO_SIGNATURE_CHECK=true`.

```
# 1) Bestehendes Test-Mode-Gate (fail-closed: nur sk_test_, NIE live):
node scripts/smoke-stripe-payment.mjs        # prueft isTestKey + Hold/Capture im Test-Mode

# 2) Server lokal (Test-Mode), oeffentlicher Plan-Katalog:
PORT=3999 PAYMENT_ENABLED=true PROVISIONING_ENABLED=true \
  STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
  SKIP_TWILIO_SIGNATURE_CHECK=true npm start

curl -s localhost:3999/api/plans                       # 200, Katalog (pre-Auth, keine PII)
# 3) Browser-Login (OIDC) -> Cookie -> Self-Service-Dashboard:
#    Plan-Kachel -> setup-checkout -> Stripe Checkout (Test-Karte 4242…) -> billing/return
#    -> Abo gebucht + aktiviert; bei PROVISIONING_ENABLED=true zieht der Drain die Nummer auf ACTIVE.
curl -s --cookie "session=<signed>" localhost:3999/api/self-service/state   # agent.number = echte E.164
```

`scripts/smoke-stripe-payment.mjs` ist der bestehende, fail-closed Test-Mode-Gate
(`isTestKey`, `TEST_KEY_PREFIX = "sk_test_"`). Diese Recipe ist **Dokumentation**, kein
ausfuehrbares Skript-Artefakt im Repo.

---

## 5. Safety-Quittung

| Kriterium | Status |
|---|---|
| Keine neuen Calls/SMS/Geld-Endpunkte | ja — BK5 fuegt **0** Produktionsendpunkte hinzu, konsumiert nur bestehende Seams |
| Safety-Gates intakt | ja — `numberGateError` (Allowlist/Denylist/Land/Stundenlimit), Budget-Guard, Max-Dauer, Provider-Signatur unberuehrt |
| Disclosure intakt | ja — `claude.js`/`bridge.js` nicht angefasst |
| Auth fail-closed | ja — `/state` an `webAuthMw` (active-only), Billing-Routen an `webAuthPendingMw`; `verifyStripeSignature` timing-sicher; kein neuer Endpunkt |
| Keine Secrets/IDs geleakt | ja — Responses tragen kein `cus_`/`sub_`/`pm_`, keine PII; `subscriptionId` bewusst aus der View (Fall 6 assertet das) |
| Audio nie durch MCP | ja — nicht beruehrt |
| Kein echtes Geld / kein Provider-Kauf | ja — Fake-BillingPort (kein Stripe-Call), `provisioningEnabled` ungesetzt (Nummer bleibt `requested`), kein `sk_live` |

---

## 6. Verifikations-Output

Exakte package.json-Test-Kommandozeile (`NODE_ENV=test node --test "test/*.test.js"`,
beide Backends):

```
ℹ tests 1089
ℹ suites 6
ℹ pass 1089
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 55616.379917
```

Isolierter BK5-Lauf (`node --test test/bk5-smoke-e2e.test.js`): **7 pass / 0 fail**.
`node --check test/bk5-smoke-e2e.test.js`: exit 0.

**Tooling-Hinweis (kein Test-Fehler):** Der `npm test`-Wrapper (npm 11.12.1 / node v25.9.0)
gibt in diesem Runner nur den Script-Banner aus und endet mit exit 194, ohne die
`node:test`-Ausgabe durchzureichen — ein npm-Wrapper-Artefakt. Die identische
Script-Kommandozeile direkt bzw. via `sh -c` laeuft sauber gruen (1089/0, exit 0).

---

## 7. Betroffene Dateien

**Neu:**
- `test/bk5-smoke-e2e.test.js` (7 Faelle, in-process HTTP-E2E auf geteiltem pglite-Store)
- `tasks/bk-chain-report.md` (dieser Report)

**Produktionscode editiert:** keine (`src/` byte-identisch). `package.json`-Test-Glob
(`test/*.test.js`) matcht die neue Datei automatisch — kein Script-Edit noetig.

Damit ist die BK-Kette (BK0–BK5 aus `PLAN-BUCHUNG-PRICING.md`) komplett verifiziert.
