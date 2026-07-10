# Report — Phase `voucher-fee-b`

**Fix B: Voucher-Tenants von Nummer-Setup-Fee-Hold befreien (0-EUR-Checkout generisch)**

| Feld | Wert |
|---|---|
| Gate | **PASS** |
| finalBranch | `fix/voucher-setup-fee-gap-b-fix1` |
| headCommit (Impl) | `e625989f1d4bdb245fe72524555094fd9aa6cd82` |
| Umbrella | `PLAN-VOUCHER-SETUP-FEE-GAP.md` Fix-Option B |
| Scope-Quelle | `tasks/voucher-fee-b-spec.md` (Design-Entscheidung "0-EUR-Checkout generisch", Jonas-bestaetigt) |

---

## 1. Plan (gekuerzt)

### 1.1 Zentrale Design-Entscheidung

Die Spec-Vorab-Recherche vermutete `activateSubscriptionFromCheckoutSession` (`subscribe.js`) als natuerlichen Ort fuer das Flag-Setzen. Das reicht nicht: `activatePaidTenant` (`src/billing/activation.js`) wird von **vier** Stellen aufgerufen (`subscribe.js` 2x, `webhook.js` 1x, `self-service-routes.js` 1x). Laut Bestandskommentar in `webhook.js` gewinnt der **Webhook regelmaessig** das Rennen gegen den Checkout-Return. Eine Pruefung nur im Checkout-Return-Pfad haette den Bug im Regelfall nicht behoben.

**Entscheidung:** Die 0-EUR-Pruefung lebt an **genau einer Stelle** — in `activatePaidTenant` selbst, direkt vor `provision(tenant)`. Das ist der einzige Punkt, durch den beide Race-Teilnehmer garantiert laufen (G5: keine Duplizierung in `subscribe.js` UND `webhook.js`). Datenquelle: `billing.retrieveSubscription(subscriptionId)` (GET `/v1/subscriptions/{id}?expand[]=latest_invoice`), **nicht** `getSubscriptionCheckoutResult`/`amount_total` (nur im Checkout-Return-Pfad verfuegbar).

Fail-closed durchgehend: Stripe-Call schlaegt fehl / `billing` fehlt / kein `subscriptionId` → Flag bleibt unberuehrt → `tenantSubscription().numberSetupFeeExempt` faellt auf `false` zurueck → `placeHold` laeuft wie heute (kein stiller Kosten-Bypass).

### 1.2 Edits pro Datei (Kernpunkte)

- **`src/store/state-ops.js`** — neues Tenant-Feld `stripeNumberSetupFeeExempt`, selektiver Patch in `setTenantSubscription`, Fail-closed-Default `false` in `tenantSubscription`.
- **`src/billing/stripe.js`** — `retrieveSubscription` erweitert um `expand[]=latest_invoice`; `numberSetupFeeExempt` strikt via `typeof invoiceTotal === "number" ? invoiceTotal === 0 : false` (kein Trueish-Fallback).
- **`src/billing/ports.js`** — JSDoc-Vertrag fuer `retrieveSubscription`/`SubscriptionAmountCheck` ergaenzt (fehlte bisher komplett).
- **`src/billing/activation.js`** — neue Hilfsfunktion `syncNumberSetupFeeExemption({store, billing, tenant})`, aufgerufen in `activatePaidTenant` VOR `provision(tenant)` (Race-Schutz). Bei Stripe-Fehler: `console.error`, Flag bleibt unberuehrt, KYC/Status/Provisioning laufen trotzdem durch (fail-soft, P8).
- **4 Call-Sites von `activatePaidTenant`** — `billing` durchgereicht: `self-service-routes.js:151`, `subscribe.js:174` + `:192`, `webhook.js:232`.
- **`src/billing/webhook.js`** — `applyStripeWebhook` erhaelt `billing` als optionale Dependency.
- **`src/server.js`** — `billing: stripeBilling` an den Webhook-Aufruf durchgereicht.
- **`src/onboarding.js`** — neue Hilfsfunktion `placeHoldUnlessExempt(s, numberId, {tenantId, billing, holdAmountCents, currency})`: kapselt die bisherige Money-Safety-Logik (Karte-Pflicht → `placeHold` → `beginProvisioning`-mit-PI) unveraendert fuer normale Tenants; bei `numberSetupFeeExempt=true` wird `beginProvisioning` ohne PI aufgerufen, Rueckgabe `null`, Capture-Block (`if billing && paymentIntentId`) wird uebersprungen. State-Maschine `PROVISIONING → ACTIVE` bereits legal (kein neuer State).
- **`src/db/schema.sql`** — additive nullable Spalte `stripe_number_setup_fee_exempt BOOLEAN` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, kein Backfill, kein CHECK).
- **`src/store/pg.js`** — Spalte durch `TENANT_COLUMNS`, `rowToTenant`, `flushTenants` (inkl. `ON CONFLICT ... DO UPDATE`) gezogen. `src/store/json.js`: keine Aenderung (serialisiert gesamtes State-Objekt).

### 1.3 Tests (geplant)

2 neue Testdateien (`test/voucher-fee-b-exempt-flag.test.js`, `-pg.test.js`) + 4 erweiterte Bestandsdateien (`stripe-setup-checkout.test.js`, `profile-a2-activation.test.js`, `billing-hold-capture.test.js`, `billing-subscribe.test.js`). Kernbeweis: Race-Fix-Reihenfolge (Flag VOR `provision()`), Fail-soft bei Stripe-Fehler, Webhook-Pfad == Checkout-Return-Pfad identisch, Hold/Capture-Skip inkl. kartenlosem Exempt-Tenant, Plumbing-Durchreichung.

### 1.4 Out of Scope

Kein neuer Config-Flag/Kill-Switch (Spec verlangt "generisch"). Stripe-seitige Redemption-Begrenzung (`max_redemptions`/Ablauf/Customer-Bindung) auf `OWNER100` bzw. jedem 100%-off-Code liegt bewusst ausserhalb dieser Code-Aenderung — Voraussetzung fuer Live, kein Blocker fuer Implementierung.

---

## 2. Impl-Zusammenfassung

Fix B wurde exakt gemaess Plan umgesetzt: `activatePaidTenant` prueft ueber `syncNumberSetupFeeExemption` per `billing.retrieveSubscription` (jetzt mit `expand[]=latest_invoice`), ob die aktive Subscription mit 0 EUR abgerechnet wurde, und persistiert das Ergebnis als `tenant.stripeNumberSetupFeeExempt` (selektiver Patch, Fail-closed-Default `false`). Diese Pruefung sitzt an **genau einer Stelle**, durch die sowohl Checkout-Return-Pfad (`subscribe.js`, 2x) als auch Webhook-Pfad (`webhook.js`, gewinnt laut Bestandskommentar meist das Aktivierungs-Rennen) laufen — `billing` wird dazu durch alle 4 `activatePaidTenant`-Call-Sites sowie `server.js → webhook.js` durchgereicht.

`src/onboarding.js`: `placeHoldUnlessExempt` ueberspringt `placeHold`/`captureHold` fuer befreite Tenants; Nummer wird trotzdem regulaer `ACTIVE` (real bei Telnyx gekauft), `paymentIntentId` bleibt `null`. Postgres-Schicht additiv durchgezogen; `json.js` unveraendert.

**Dateien:**
- Neu: `test/voucher-fee-b-exempt-flag.test.js`, `test/voucher-fee-b-exempt-flag-pg.test.js`
- Editiert (Produktion, 10): `src/store/state-ops.js`, `src/billing/stripe.js`, `src/billing/ports.js`, `src/billing/activation.js`, `src/onboarding.js`, `src/billing/subscribe.js`, `src/billing/webhook.js`, `src/self-service-routes.js`, `src/server.js`, `src/store/pg.js`, `src/db/schema.sql`
- Editiert (Tests, 4): `test/stripe-setup-checkout.test.js`, `test/profile-a2-activation.test.js`, `test/billing-hold-capture.test.js`, `test/billing-subscribe.test.js`

**Testergebnis:** 1945/1945 gruen (1929 Baseline + 16 neue/erweiterte Tests), 0 fail. `node --check` auf allen 10 geaenderten Produktions-Dateien sauber.

**Smoke:** Server bootet sauber mit `PAYMENT_ENABLED=false` (json-Backend, `/healthz` → 200, kein Crash trotz Signaturaenderung). Mit `PAYMENT_ENABLED=true` (json-Backend) liefert `/webhooks/stripe` 404 — erwartetes Bestandsverhalten (Webhook-Registrierungsblock in `server.js` an `sessionSecret + pg-Backend` gegated, unabhaengig von diesem Fix). Reale E2E-Abdeckung des Webhook-Pfads laeuft ueber pg-backed Spawn-Tests (`p3-payment-webhook.test.js`, `bk3-auto-provision.test.js`, `w5-billing-revoke.test.js`, `bk5-smoke-e2e.test.js`), alle gruen.

### Deviations

1. **Keine inhaltliche Abweichung vom Plan** — alle 9 (bzw. 10, inkl. `schema.sql`) Produktions-Datei-Edits + 2 neue + 4 erweiterte Testdateien exakt wie spezifiziert umgesetzt (Diff Zeile-fuer-Zeile gegen Plan-Vorher/Nachher-Bloecke verifiziert).
2. **Smoke-Test-404 auf `/webhooks/stripe`** mit `PAYMENT_ENABLED=true` + `STORE_BACKEND=json` ist keine Fix-Regression, sondern Bestands-Gating in `server.js` (`sessionSecret && storeBackend==="pg"`) — curl-Smoke mit json-Backend kann diese Route grundsaetzlich nicht erreichen. Abdeckung stattdessen ueber pg-backed Spawn-Suite (staerker als manueller curl-Test).
3. **Zwei bekannte, plan-unabhaengige Timing-Flakes** beobachtet (`test/voice-status-lifecycle.test.js:137`, laut Plan-Baseline bereits bekannt; einmalig zusaetzlich `test/telnyx-event-ingest-route.test.js:49`) — beide isoliert 3/3 gruen, beruehren keine der 15 geaenderten Dateien; im finalen `npm test`-Lauf (1945/1945 gruen) nicht mehr aufgetreten.

---

## 3. Safety-Urteil

**Verdict: APPROVED** (Code-Review-Ebene).

- `testsPassIndependently`: true — `npm test` auf `review-voucher-fee-b-r1` (= `fix/voucher-setup-fee-gap-b-fix1`) zweimal unabhaengig ausgefuehrt: 1945/1945 pass, 0 fail, 0 skipped, beide Laeufe identisch. Beide Backends in einem Lauf (JSON + pglite-Postgres, netzwerklos).
- `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`: alle **true**.
- Kern-Refactor `placeHoldUnlessExempt()` kapselt die bisherige Money-Safety-Logik unveraendert fuer normale Tenants; fuer `numberSetupFeeExempt=true` wird `beginProvisioning` ohne PI aufgerufen und der Capture-Block uebersprungen — Nummer wird trotzdem real bei Telnyx gekauft (bewusstes, im Plan benanntes Restrisiko).
- Race-Fix verifiziert: `syncNumberSetupFeeExemption` laeuft in `activatePaidTenant()` VOR `provision(tenant)`; Checkout-Return- UND Webhook-Pfad rufen dieselbe Funktion — durch dedizierte Tests in `profile-a2-activation.test.js` belegt.
- `eslint` auf allen geaenderten Dateien 0 Errors (1 Warning in `server.js` vorbestehend auf `master`, nicht durch diesen Diff eingefuehrt).

**Concerns (kein Code-Defekt, Business-/Prozess-Gate):**

1. `PLAN-VOUCHER-SETUP-FEE-GAP.md` dokumentiert selbst zwei offene Merge-Voraussetzungen, die Code-Review nicht pruefen kann: (a) Stripe-seitige Redemption-Begrenzung (`max_redemptions`/Ablauf/Customer-Bindung) auf `OWNER100` nicht verifiziert — der Code prueft bewusst generisch "Rechnung war 0 EUR", d.h. jede Stripe-Konstellation mit 0-EUR-Ergebnis befreit auch von der Nummer-Setup-Gebuehr (realer Telnyx-Fremdkosten-Posten pro Missbrauchsfall); die einzige Missbrauchs-Bremse liegt komplett ausserhalb des Repos, in Stripe selbst. (b) Keine im Artefakt-Trail dokumentierte explizite Jonas-Freigabe fuer die Produktentscheidung "Voucher-Tenants zahlen wirklich 0 EUR inkl. Nummer-Gebuehr".
2. **Empfehlung:** NICHT auf `master` mergen, bevor Jonas Punkt 3+4 aus `PLAN-VOUCHER-SETUP-FEE-GAP.md §6` abgehakt hat.

---

## 4. Clean-Code-Audit (S1–S4)

**Verdict: PASS.** Phase `voucher-fee-b` (`fix/voucher-setup-fee-gap-b-fix1` gegen `master`) — **0 S1-Flags, 0 S2-Flags.**

- Diff sauber: eine Quelle (`activation.js`/`syncNumberSetupFeeExemption`) fuer die Exempt-Pruefung, korrekt VOR `provision(tenant)` fuer Race-Schutz platziert, konsistent an allen 4 `activatePaidTenant`-Aufrufstellen durchgereicht.
- Fail-closed durchgaengig: Stripe-Fehler/fehlende `subscriptionId`/fehlendes `billing.retrieveSubscription` lassen das Flag unberuehrt (`false`), niemals stiller Bypass.
- Kompletter Testlauf gruen: 1945/1945; `node --check` auf allen geaenderten `src/`-Dateien sauber.

**S1:** keine. **S2:** keine.

**S3:** keine. Kommentare durchgehend praezise, konsistent mit Bestand (Deutsch, ohne Umlaute), begruenden jede Design-Entscheidung (Race-Reihenfolge, fail-closed-Defaults, Eine-Quelle-Prinzip). Namen (`syncNumberSetupFeeExemption`, `placeHoldUnlessExempt`, `numberSetupFeeExempt`) aussagekraeftig, nennen Nebeneffekte (N7).

**S4:** keine. `activatePaidTenant` waechst auf 5 destrukturierte Options-Objekt-Felder (`store`, `accounts`, `provision`, `billing`, `tenant`) — technisch 1 Parameter, folgt dem repo-weit etablierten Options-Objekt-Idiom (G24-Konvention, andere Funktionen bereits 6-7 Felder) — kein neuer Verstoss, nicht geflaggt.

**PassNotes:** Money-Safety intakt (Exempt-Pfad ueberspringt Karten-Pflicht bewusst und getestet, kein Capture → kein Charge-Risiko; Nicht-Exempt-Pfad byte-identisch zum Bestand). G5/S2 sauber vermieden: `placeHoldUnlessExempt` extrahiert vormals inline Hold-Logik in eine Funktion statt Duplizierung. Neues DB-Feld additiv nullable mit fail-closed-Default, Migration folgt Bestandsmuster (ALTER-only, kein CHECK). Test-Abdeckung ueberdurchschnittlich vollstaendig (exempt+Race-Reihenfolge, Stripe-Fehler fail-soft, Webhook==Direkt-Pfad-Identitaet, Plumbing-Regressionsnetz, pg-Round-Trip, kartenloser exempt-Tenant). Einzige nicht direkt getestete Codezeile: der fruehe `if (!subscriptionId) return;`-Guard in `syncNumberSetupFeeExemption` — in beiden echten Call-Pfaden ist `subscriptionId` zum Aufrufzeitpunkt bereits gesetzt (defensiver Fail-closed-Zweig, kein Sicherheits-/Korrektheitsrisiko, daher kein S1-Flag).

**Top-TODOs (kein Blocker fuer Clean-Code-Gate, aber vor Merge):**
1. Vor Merge auf `master`: explizite Jonas-Freigabe fuer Fix B einholen (`PLAN-VOUCHER-SETUP-FEE-GAP.md §6` Punkt 4 — Produktentscheidung, kein Code-Thema).
2. Vor Merge: Stripe-Dashboard verifizieren, dass der `OWNER100`-Coupon `max_redemptions`/Ablauf/Customer-Bindung hat (§6 Punkt 3) — sonst befreit jeder 0-EUR-Checkout generisch von der Nummer-Setup-Gebuehr.
3. Optional (nice-to-have, kein Blocker): expliziter Unit-Test fuer den `!subscriptionId`-Fruehausstieg in `syncNumberSetupFeeExemption` schliesst die letzte theoretische Luecke in der Branch-Abdeckung.

---

## 5. Fix-Runden

### Runde 1 (r1)

Beide gelisteten Review-Blocker sind Prozess-/Freigabe-Luecken, keine Code-Korrektheitsbugs im Implementierungs-Commit (`e625989`) selbst — deshalb keine Code-Aenderung, sondern `PLAN-VOUCHER-SETUP-FEE-GAP.md` korrigiert und praezisiert.

- **Blocker 1 (Jonas-Freigabe fehlt):** Der Plan-Text widersprach dem B[...]

> Quellinformation zu Runde 1 endet an dieser Stelle unvollstaendig (abgeschnittener Input) — der genaue Wortlaut der Blocker-1-Aufloesung sowie ein moeglicher Blocker-2-Absatz liegen nicht vor. Laut Safety- und Clean-Code-Urteil (final) bestehen keine offenen Code-Blocker mehr (`blockers: []`, Clean-Code `blocker: false`); die verbleibenden Punkte sind ausschliesslich die zwei oben unter Safety-Concerns / Top-TODOs gelisteten Business-/Freigabe-Gates. Finaler Commit auf `fix/voucher-setup-fee-gap-b-fix1`: `e625989` + `234a066` (laut Safety-Urteil).

---

## 6. Gesamtfazit

Gate **PASS** auf Code-Review-Ebene (Safety APPROVED, Clean-Code PASS, 0 S1/S2). Branch `fix/voucher-setup-fee-gap-b-fix1` ist scope-sauber, safety-gate-neutral, verhaltenserhaltend fuer den Nicht-Exempt-Pfad, 1945/1945 Tests gruen. **Nicht mergefertig fuer `master`** ohne die zwei in `PLAN-VOUCHER-SETUP-FEE-GAP.md §6` benannten Business-Gates: (1) Jonas-Freigabe der Produktentscheidung, (2) Stripe-seitige Redemption-Begrenzung auf `OWNER100`.
