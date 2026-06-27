# Phase BK5 — Test-Mode Smoke end-to-end + Report

**Gate:** PASS
**finalBranch:** `phase/bk5-smoke`
**headCommit:** `2f7875c441908e5bc4e69fc7445ff0b9831e30b2`
**Typ:** reine Verifikations-Phase (kein Produktionscode)

---

## 1. Kurzfassung

BK5 beweist den gesamten Buchungs-Funnel (BK0–BK4) in **einem durchgehenden in-process E2E-Lauf** auf einem geteilten pglite-Store ueber echte HTTP-Requests gegen die echten Seams. Es wird **kein Produktionscode** hinzugefuegt — der Funnel-Code existiert bereits merged und einzeln getestet. BK5 prueft die **Verkettung**, nicht erneut jede Gate-Verzweigung.

Ergebnis: **2 neue Dateien, 0 `src/`-Edits**, 7 E2E-Faelle alle gruen, Gesamtsuite 1089 pass / 0 fail (Baseline 1082 + 7 BK5), beide Backends (json + pglite). Kein git-Commit auf master; die Arbeit liegt auf `phase/bk5-smoke`.

---

## 2. Plan (gekuerzt)

### Kernbefund

BK5 ist eine reine Verifikations-Phase. Zwei harte Code-Constraints bestimmen die Form:

1. **Kein `src/server.js`-Child-Spawn-Smoke.** Der boot-guard ist fail-closed (BK4 Deviation #1: Server verweigert Start ohne persistierte aktive Nummer + echte Provider-/Stripe-Secrets); die Repo-Konvention bannt Server-Spawn-Smokes ("Lehre p6a-Stall"). Etablierte Form: in-process `app.listen(0)` + echte HTTP-Requests via `node:http` — der "geskriptete curl-Smoke", offline + deterministisch.
2. **Dry-Run-Wahrheit (`PROVISIONING_ENABLED=false`):** `requestNumberForPaidTenant` legt die Nummer als `status=REQUESTED` an; der Drain nach `ACTIVE` laeuft nur bei `provisioningEnabled=true` (`src/server.js:1505`). `activeNumberFor` (`src/store/views.js:40`) liefert nur `ACTIVE`-Nummern → in Dry-Run ist `agent.number === ""`, obwohl eine reservierte `requested` Dry-Run-Nummer existiert. **Erwartetes Verhalten, kein Bug.**

Konsequenz: kleinster Blast-Radius = 2 neue Dateien, 0 Edits an `src/`.

### Neue Dateien (geplant)

- `test/bk5-smoke-e2e.test.js` — ein durchgehender Funnel auf einem geteilten pglite-Store + Account/Session-Schicht, gefahren ueber echte HTTP-Requests gegen `makeSelfServiceRoutes` + `GET /api/plans` + den echten Webhook-Seam. Modelliert nach `bk2-checkout-return-plan` (Harness) + `bk3-auto-provision` (Webhook-Seam), aber alle Stationen auf demselben State.
- `tasks/bk-chain-report.md` — der finale E2E-Verifikations-Report (distinkt vom Handover).

### Reuse statt Replik (G5/S2)

- `provision`-Seam ruft den echten Produktions-Core `requestNumberForPaidTenant` (genau wofuer `provision-trigger.js` extrahiert wurde).
- Webhook-Schritt ruft `verifyStripeSignature` + `applyStripeWebhook` (keine Nachbildung der Server-Webhook-Route).
- Katalog aus `PLAN_CATALOG` (`src/plans.js`) — dieselbe Quelle wie `server.js:168`, kein zweites Literal.

Kein Stueck Produktionslogik wird im Test dupliziert.

### Geplante Test-Faelle (1 Konzept pro Test)

| Fall | Station | Assertion (deterministisch) |
|---|---|---|
| (1) | `GET /api/plans` pre-Auth | `200`; 2 slugs `["starter","business"]`; `amountCents` 499/999; `currency:"eur"` |
| (2) | `GET …/self-service/state` Leerzustand | `planSlug==null`; `quota==null`; `agent.number==""`; `hasCard==false` |
| (3) | `POST …/billing/setup-checkout {plan:"starter"}` | `200`; `successUrl` enthaelt `&plan=starter` |
| (4) | `GET …/billing/return?session_id=…&plan=starter` | `302` → `/tenant.html?sub=ok`; Mirror gesetzt; account `active`; `priceId=="price_starter"`; genau 1 `REQUESTED`-Nummer |
| (5) | signierter `active`-Webhook → idempotent | weiterhin genau 1 Nummer (Doppelkauf-Schutz); account-Status unveraendert |
| (6) | Dashboard final | `planSlug=="starter"`; `currentPeriodEnd==PERIOD_END`; `quota` 30/0/30; kein Id-Leak; `agent.number==""` (Dry-Run) |
| (7) | Kontingent live abgeleitet | usage_event 5 min → `usedMinutes==5`, `remainingMinutes==25` |

Cap-Block, `PAYMENT_ENABLED`-aus-404, `no_card`/`already_subscribed` sind in bk2/bk3/w4 abgedeckt → in BK5 **nicht wiederholt** (G5).

### Edits an Bestand

**Keine.** Jede `src/`-Aenderung waere Scope-Verstoss (CLAUDE.md Regel 6) und wuerde die byte-identisch-Invariante der Vorphasen brechen. `package.json` `"test": "node --test test/*.test.js"` matcht die neue Datei automatisch — kein Script-Edit. Falls der E2E-Lauf eine echte Funnel-Luecke aufdeckt (nicht die erwartete Dry-Run-Wahrheit): stoppen, separates Ticket, nicht im BK5-Scope fixen.

---

## 3. Implementierungs-Zusammenfassung

Plan-getreu umgesetzt: **2 neue Dateien, 0 `src/`-Edits.**

`test/bk5-smoke-e2e.test.js` fuehrt den gesamten Funnel in einem in-process E2E-Lauf auf einem geteilten pglite-Store ueber echte HTTP-Requests (`node:http`, `app.listen(0)`) gegen die echten Seams:

1. `GET /api/plans` (pre-Auth, Katalog aus `PLAN_CATALOG`)
2. Self-Service `/state` Leerzustand
3. `setup-checkout` mit Plan-Carry (`successUrl` traegt `&plan=starter`)
4. `billing/return` = buchen + aktivieren + provisionieren — mit dem **echten** `requestNumberForPaidTenant`-Core auf dem geteilten Store (kein Spy)
5. signierter `active`-Webhook (`verifyStripeSignature` + `applyStripeWebhook`), idempotent, kein Doppelkauf
6. Dashboard-Plan + Kontingent ohne Id-Leak
7. live Kontingent-Ableitung aus dem usage_event-Ledger

7 Faelle, alle gruen. Dry-Run-Wahrheit (`PROVISIONING_ENABLED=false` → Nummer bleibt `requested`, `agent.number==""`, echte E.164 = Owner-Go-Live) in Test und Report dokumentiert.

`tasks/bk-chain-report.md` liefert: Funnel-Walkthrough-Tabelle, Dry-Run-Begruendung mit Code-Ankern, Webhook-vs-Klick-Beobachtung (kein Fix), manuelle Live-curl-Recipe (Owner-Go-Live, nicht Teil von `npm test`, mit Verweis auf den fail-closed Gate `scripts/smoke-stripe-payment.mjs` / `isTestKey`), Safety-Quittung und den Verifikations-Output.

**Verifikation:** `node --check` exit 0; `node --test` (package.json-Kommando): 1089 pass / 0 fail, beide Backends, keine Regression. Commit `2f7875c` auf `phase/bk5-smoke`, `node_modules`-Symlink nicht committet.

### Smoke

Der in-process `node:http`-E2E-Lauf **IST** der plan-definierte curl-Smoke: `app.listen(0)` + echte HTTP-Requests gegen die echten Seams, offline/deterministisch — 7/7 gruen. Ein Live-Spawn von `src/server.js` wurde bewusst **nicht** gefahren (boot-guard fail-closed + Repo-Konvention "Lehre p6a-Stall"). Die Live-curl-Sequenz ist als Owner-Go-Live-Dokumentation in `tasks/bk-chain-report.md` §4 festgehalten.

### Deviations

1. **npm-Wrapper-Artefakt (KEIN Test-Fehler):** `npm test` (npm 11.12.1 / node v25.9.0) gibt in diesem Runner nur den Script-Banner aus und endet mit **exit 194**, ohne die `node:test`-Ausgabe durchzureichen. Die identische package.json-Kommandozeile direkt bzw. via `sh -c 'NODE_ENV=test node --test "test/*.test.js"'` laeuft sauber gruen: **1089 pass / 0 fail / exit 0** (beide Backends). Vorbestehendes Tooling-Artefakt (package.json byte-identisch, nicht BK5-verursacht). Beleg im Report §6.
2. **Minor additive Clean-Code-Schaerfung (keine Plan-Abweichung):** `SESSION_TTL_S` benannt (G25) statt inline 3600 fuer die Test-Session-TTL.
3. **Plan-konform:** Post-Abo-Faelle (5)/(6)/(7) fahren den Rueckkehr-Flow als Build-Phase (`subscribeViaReturn`, P13) auf je eigenem `setup()` — F.I.R.S.T.-Independence. Das "geteilte State"-Kriterium ist innerhalb jedes `setup()` erfuellt (Routen + echter provision-Core + Webhook auf EINEM pglite-Store).

---

## 4. Safety-Urteil

**APPROVED / PASS.** Alle absoluten Regeln halten.

- **Scope:** `git diff master..phase/bk5-smoke` = exakt 2 hinzugefuegte Dateien (`test/bk5-smoke-e2e.test.js` + `tasks/bk-chain-report.md`). Zero `src/`/`public/`/`package`-Edits, keine neue npm-Dependency, keine Env-Pollution.
- **Safety-Gates:** `numberGateError`-Kette byte-identisch; Budget/Land-Gate/Allowlist unberuehrt.
- **Disclosure:** `disclosureSentence` weiterhin fest verdrahtet in `claude.js` + `bridge.js`.
- **Auth fail-closed:** echtes `webAuthMw` (active-only auf `/state`), `webAuthPendingMw` auf Billing-Routen, echte timing-sichere `verifyStripeSignature`, kein neuer Endpunkt.
- **Secrets:** keine geleakt — nur Fake-Fixtures; Fall (6) assertet aktiv KEIN `subscriptionId`/`sub_`/`cus_`/`pm_`-Id-Leak in der `/state`-View.
- **Geld/Calls/SMS:** keine echten — Fake-BillingPort (kein Stripe-Call), Dry-Run-Provisioning laesst Nummern `requested` (kein Provider-Kauf), kein `sk_live`.
- **Audio:** unberuehrt, nie durch MCP.
- **Tests unabhaengig gruen:** in frischem Worktree (`review-bk5` off `phase/bk5-smoke`) — isoliert BK5: 7 pass / 0 fail; Gesamtsuite via Canonical-Command minus npm-Wrapper: 1089 pass / 0 fail, exit 0; `node --check` exit 0.

**Concerns (keine Blocker, vorbestehend, korrekt dokumentiert):**

1. `npm test` (canonical wrapper) exit 194 unter npm 11.12.1 / node v25.9.0, waehrend `NODE_ENV=test node --test test/*.test.js` exit 0 mit 1089/0 liefert. Vorbestehendes Tooling-Artefakt (package.json byte-identisch). Risiko: ein CI-Step, der am npm-Exit-Code haengt, wuerde rot zeigen.
2. Erzwingt man `STORE_BACKEND=pg` auf die ganze Suite offline, scheitern 12 unrelated src-spawnende Tests (bridge, disclosure-regression, store-*, retention, claude-identity …) mit "DB unerreichbar" — sie brauchen ein echtes Netz-Postgres. Intendiertes Offline-Design (der pg-Code-Pfad wird in-process via pglite/`makePgTestStore` im Default-Lauf geuebt); keine BK5-Regression (zero src changes).

---

## 5. Clean-Code-Audit (S1–S4)

**Verdict: PASS** — reine Verifikations-Phase, 0 `src`-Edits, nur 2 neue Dateien (1 Test + 1 Report). 7 disziplinierte in-process-E2E-Faelle gegen die echten Seams. S1/S2 leer, nur S3-Kleinkram.

- **S1 (Blocker):** keine
- **S2 (Blocker):** keine
- **S3 (Stil/Konsistenz, optional):**
  1. **G11/G25** · `test/bk5-smoke-e2e.test.js` (setup() + Faelle 4/5) · bare `'active'`-String fuer Account-Status, obwohl Geschwister-Enums `NUMBER_STATUS`/`USAGE_EVENT_KIND` aus `store/defaults.js` importiert sind und `TENANT_STATUS.ACTIVE` dort existiert+importierbar waere. Empfehlung: `TENANT_STATUS.ACTIVE` auf der setStatus-Call-Seite. Nur S3, weil Prod `web-auth.js:473` selbst `'active'` inline schreibt (Inkonsistenz vorbestehend).
  2. **G25** · `test/bk5-smoke-e2e.test.js` (`realProvision`) · Inline-Literal `'DE'` als `fallbackCountry` ohne Namen. Empfehlung: benannte Konstante (z.B. `DEFAULT_FALLBACK_COUNTRY`); grenzwertig/selbsterklaerend, optional.
  3. **P7/Kapselung** · `test/bk5-smoke-e2e.test.js` (`seedVoiceMinute`) · greift nach `recordUsageEvent` in das zurueckgegebene Event-Objekt (`event.occurredAt=…`) statt ueber eine API/Clock-Seam. Akzeptabel fuer P12-Repeatable ohne Clock-Injection und als "Muster bk4" dokumentiert; sauberer waere ein `occurredAt`-Param an `recordUsageEvent`.
- **S4:** keine
- **Blocker:** false

**Pass-Notes:** Verifiziert gegen die echten Quellen — `makeSelfServiceRoutes`/`requestNumberForPaidTenant`/`applyStripeWebhook`/`verifyStripeSignature`/`PLAN_CATALOG` existieren mit exakt den genutzten Signaturen + Shapes. Staerken:

- **(a) Echter Core statt Mock** — provision-Seam ist der Produktions-Core `requestNumberForPaidTenant` auf dem geteilten pglite-Store, Webhook-Schritt verifiziert die echte HMAC + `applyStripeWebhook` (kein Mock-Schatten) → echtes Verkettungs-E2E.
- **(b) F.I.R.S.T. sauber** — offline (pglite, kein Netz/Secrets), repeatable (fixe `PERIOD_END`/`NOW_S`/`USAGE_OCCURRED_AT`, kein `Date.now`/Zufall), independent (jeder Fall eigenes `setup()` mit eigener `new PGlite()` + `finally close()`), self-validating (boolesche Asserts).
- **(c) G5 bewusst befolgt** — Gate-Verzweigungen (Cap-Block, `PAYMENT_ENABLED`-404, `no_card`/`already_subscribed`) nicht erneut getestet; Plan-Katalog aus derselben Quelle `PLAN_CATALOG`.
- **(d) G25 durchgaengig** — alle Magic-Values benannt (`SECRET`, `WEBHOOK_SECRET`, `PERIOD_END`, `NOW_S`, `INCLUDED_MIN`, `VOICE_MINUTES_USED`, `HIGH_CAP`, `SESSION_TTL_S`, `USAGE_OCCURRED_AT`, `RETURN_SUB_OK`; `costCents 0` = erlaubte 0-Ausnahme).
- **(e) P13 Build-Operate-Check** via `subscribeViaReturn`-Helper; F1 alle Funktionen ≤3 Argumente (Options-Objekt bei setup); N7 Nebeneffekte im Namen (`seedVoiceMinute`, `subscribeViaReturn`).
- **(f) Security-positiv** — Fall (6) assertet aktiv KEIN `sub_`/`cus_`/`pm_`-Id-Leak in der `/state`-View; Idempotenz-Assert (5) ist echt (re-run des realen Cores, Count bleibt 1), keine Tautologie.

Report `tasks/bk-chain-report.md` ist mit dem Diff konsistent (0 src-Edits bestaetigt, nur 2 neue Dateien). C5/G9 kein toter/auskommentierter Code, G12 keine ungenutzten Imports (alle 9 Imports verwendet). ESM, kein Build-Step, kein TS, Kommentare deutsch ohne Umlaute.

**Optionale Top-Todos (kein Blocker):**
1. `TENANT_STATUS.ACTIVE` statt bare `'active'` auf der setStatus-Call-Seite — Geschwister-Enums werden schon importiert, schliesst die G11-Konsistenzluecke.
2. `'DE'`-fallbackCountry als benannte Konstante ziehen.

---

## 6. Fix-Runden

**Keine.** Der Self-Fix-Loop wurde nicht ausgeloest:

- Safety-Review: APPROVED ohne Blocker (nur 2 vorbestehende environmental/tooling-Concerns).
- Clean-Code-Review: PASS, S1/S2 leer (nur optionale S3-Hinweise).

Da beide Gates ohne Blocker bestanden, war keine Fix-Runde noetig. Die offenen Punkte sind optionaler Polish (S3) bzw. vorbestehende Tooling-/Env-Artefakte ausserhalb des BK5-Scopes.

---

## 7. Verifikations-Output (Beleg)

```
# Isolierte BK5-Probe:
NODE_ENV=test node --test test/bk5-smoke-e2e.test.js   →  # pass 7   # fail 0   exit 0

# Gesamtsuite (Canonical-Command, ohne npm-Wrapper):
NODE_ENV=test node --test "test/*.test.js"             →  # pass 1089  # fail 0  exit 0
                                                          (Baseline BK4 1082 + 7 BK5; json + pglite)

# Syntax-Gate:
node --check test/bk5-smoke-e2e.test.js                →  exit 0

# Artefakt (kein Test-Fehler):
npm test                                               →  exit 194 (npm-Wrapper-Artefakt; underlying node exit 0)
```

**Dateien (absolut):**
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/test/bk5-smoke-e2e.test.js` (neu)
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/tasks/bk-chain-report.md` (neu)

**Branch:** `phase/bk5-smoke` · **Commit:** `2f7875c441908e5bc4e69fc7445ff0b9831e30b2` · **Gate:** PASS
