# P3 — Payment-gated Aktivierung + Provisioning (Report)

**Stand:** 2026-06-26 · **Branch:** `phase/p3-payment-chain` -> gemerged nach `master` (lokal, **nicht gepusht**) · **Gates:** Safety PASS, Clean-Code PASS · **Tests:** 1022 pass / 0 fail.

Spec: `tasks/p3-payment-chain-spec.md`. Umbrella: `PLAN-ONBOARDING.md`. Setzt P0 (kanonische Tenant-Identitaet) voraus.

## Umgesetzt (Impl-Commit `ffed1c2`)

Kern-Fix gegen "Signup macht nichts, keine Nummer, kein Abo":

- `src/billing/webhook.js` — `applyStripeWebhook` hebt bei bestaetigter Zahlung KYC auf `CARD` (oeffnet das Outbound-Gate `tenantActiveSubscriber`, KYC>=CARD) und stoesst ueber einen injizierten `provision`-Seam genau EINEN Provisioning-Trigger pro Tenant an. `SUBSCRIPTION_EVENT.CREATED` ergaenzt (faellt in den ACTIVATE-Zweig).
- `src/server.js` — `triggerTenantProvisioning` (idempotent via `tenantHasLiveNumber`-Guard, Land aus Tenant-Geo mit config-Fallback, Kauf NUR bei `PROVISIONING_ENABLED` -> P3-Default Dry-Run, kein Geld). `queueProvisioning` aus dem `/api/onboard`-Pfad extrahiert und mit dem Webhook-Trigger geteilt (Duplizierung sinkt).
- `src/store/state-ops.js` — neue Queries `tenantHasLiveNumber`/`tenantGeo` (state-ops-Ebene).
- Tests: `test/p3-payment-webhook.test.js` (Unit, Fake-Seams + state-ops), `test/stripe-webhook-signature.test.js` (erweitert).

Invarianten erfuellt: Payment-gated (Invariante 1), Webhook setzt alle drei Effekte (2), beide Plaene berechtigen (3), Idempotenz `provision_<numberId>` (4), Flags bleiben Code-extern (5), Tenant-Aufloesung ueber P0-Identitaet (6), Signatur fail-closed unveraendert (7).

## Dualer Review nachgeholt (Workflow-Pipeline starb am Stripe-/API-Spend-Limit)

Der `phase-impl-lean`-Workflow lieferte die Impl, aber Review/Self-Fix/Report-Subagents brachen mit `monthly spend limit` ab (Gate kam fail-closed als BLOCKED zurueck, ohne echte Findings). Review daher manuell nachgezogen:

- **Clean-Code: PASS** — keine S1/S2. Benannte Konstanten (kein Magic-String), keine toten/abgeschalteten Sicherungen, Funktionslaengen < 100, Duplizierung gesunken. 1 S3 (Test-Mirror `triggerCore` kann driften — kein Blocker).
- **Safety: 1x S2 gefunden, dann gefixt.**

### S2 (gefixt, Commit `4fc95eb`)

`interpretStripeEvent` mappte JEDES `customer.subscription.created/updated` bedingungslos auf ACTIVATE — ohne `object.status` zu pruefen. Stripe feuert `.created` auch bei `incomplete` (vor erster Zahlung) und `.updated` bei Dunning (`past_due`/`unpaid`). Folge: ein unbezahltes/Dunning-Event oeffnete das Outbound-Call-Gate (flag-unabhaengig) und triggerte bei `PROVISIONING_ENABLED` den realen Nummernkauf; ein nachgelagertes `past_due`-`.updated` konnte zudem einen ueber `PAYMENT_FAILED` gesperrten Tenant re-aktivieren. Verletzte Invariante 1/2.

**Fix:** benannte Konstante `CONFIRMED_SUBSCRIPTION_STATUS = {active, trialing}`; nur diese Status aktivieren, alle anderen -> `ignore`. Suspend bleibt ausschliesslich `DELETED`/`PAYMENT_FAILED` (Spec, kein Scope-Creep). Happy-Path-Fixtures auf `status:"active"` gehoben; Regressionstests: Dunning/`incomplete`/`unpaid`/`canceled` -> ignore (kein KYC/active/provision), `trialing` -> activate. Safety-Re-Review: **GATE PASS** (S2 geschlossen, keine neue Luecke; fehlendes `object.status` -> fail-closed ignore).

## Verbleibende Risiken (S3, bewusst akzeptiert — kein Blocker)

- **trialing + `PROVISIONING_ENABLED=true`**: wuerde eine reale Nummer vor dem ersten Charge kaufen. Aktuell inert (Flag default false, kein Trial konfiguriert). Bei Trial-Einfuehrung beachten.
- **Prozess-lokaler `withStoreLock`**: bei echt-gleichzeitiger Doppel-Delivery an zwei Render-Instanzen theoretisch zwei Nummern. Entspricht bestehender onboard-Architektur; Haertung optional via DB-seitigem partial UNIQUE Index.
- **Order-Fragilitaet** (`setStatus(active)` vor `provision()`) + nicht-transaktionales activate (forward-idempotent). Als Invariante im Code kommentiert.

## Nebenbefund behoben — node_modules-Symlink

Der P3-Branch hatte versehentlich (durch ein `git add -A` im Worktree) den self-referentiellen Symlink `node_modules -> ./node_modules` committet (`.gitignore` hatte nur `node_modules/` = Dir). Beim ff-Merge ueberschrieb der Checkout das funktionierende node_modules im Main-Repo -> 112 Import-Fails. Behoben: Symlink aus dem Commit amended (`a7dc56e` -> `4fc95eb`), Symlink entfernt + `npm install`, `.gitignore` um `/node_modules` + `.claude/worktrees/` gehaertet (Commit `d8015af`). master danach 1022/1022 grün.

## Offen (Jonas / spaeter — nicht Teil von P3)

- `PLAN-ONBOARDING §9.1`: Stripe-Webhook-Endpoint `https://app.sundartha.com/webhooks/stripe` im Stripe-Dashboard registrieren (nach Deploy, sonst 404). `STRIPE_WEBHOOK_SECRET` liegt in Render.
- `§9.2/§9.4`: `PAYMENT_ENABLED=true` (nach gruenem Stripe-Testmodus) + `PROVISIONING_ENABLED=true` (Geld-Gate P4) per Render-MCP.
- Push: master ist ahead von `origin/master` (P0 `a56e06b`, P3-Impl `ffed1c2`, P3-S2-Fix `4fc95eb`, gitignore `d8015af`; P1 `961bbac` ggf. schon auf origin) — **nicht gepusht** (manual-push-Protokoll).
