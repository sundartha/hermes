# Phase P6 — Budget-Fenster und Gate-Fairness

**Gate: PASS**
**finalBranch:** `phase/i18n-p6-budget-fenster-v2-fix1`
**Basis:** `master @ 8fea700`

---

## 1. Plan (gekuerzt)

Autoritativ: `PLAN-I18N-FIX.md` Abschnitt „P6" inkl. KLARSTELLUNG 2026-07-26 + O1/O4/O5 + Auflagen A3/A4/A6.
Baseline gemessen: `npm test` = 3104 pass / 0 fail; `npm run test:gates` = 74 tests / 25 pass / 49 fail.

### Entscheidungen (D1-D9)

- **D1 (GAP-10):** `globalHourReached` faellt ersatzlos weg; verbleibende Stunden-Achse zaehlt nach `tenantId` statt `requestedBy` (O5 — „ausschliesslich pro Tenant"). Strikt strenger (count(tenantId) ≥ count(requestedBy)).
- **D2:** `MAX_CALLS_PER_HOUR` behaelt Name und Code-Default `6`; `min(config, profil)` bleibt (Config = Default und Decke).
- **D3:** Ueberlebender Ablehnungsgrund heisst `stundenlimit` (nicht `stundenlimit_nutzer`) — nur noch eine Achse.
- **D4 (GAP-01):** dritte Achse als Baseline-Snapshot auf dem Usage-Bucket (`budgetPeriodKey` + `budgetPeriodBaselineCents`), Gate-Verbrauch = `costCents − baseline`. Ersetzt nur den Lebenszeit-Zweig (`budgetMonthEnabled=false`); Flag-AN-Zweig (UTC-Monat) bleibt unberuehrt.
- **D5:** usage_event-Ledger als Gate-Quelle verworfen (nur bei `PAYMENT_ENABLED` geschrieben → fail-open).
- **D6 (O4):** Reset-Bedingung = derselbe Pfad wie Reaktivierung (`activatePaidTenant`, nur bei bestaetigtem Abo-Status) UND kein aktiver `billingHold`.
- **D7:** Reset nicht an `activated===true` gekoppelt (sonst bei injiziertem `provision` unerfuellbar).
- **D8:** `gatePlatformUsageCents`/`globalBudgetExceeded` unangetastet (A4, Geld-Schnittmenge bleibt).
- **D9:** `tenantBudgetSnapshot` bleibt Lebenszeit-Anzeige (ausserhalb Scope, bekannter Punkt).

### Pre-Mortem-Restrisiken (bewusst getragen, in `PLAN-SECURITY.md`)

1. Gestempelter Bucket ohne Abo (Kuendigung) friert am letzten Baseline ein — ueber Zeit strenger, aber dauerhaft lockerer als Lebenszeit; Tenant ohnehin gesperrt.
2. Verspaetete Kostenkorrektur faellt ins neue Fenster bzw. wird auf 0 geklemmt — Asymmetrie identisch zur bestehenden Spend-Monat-Achse.
3. GAP-07 verweigert Boot bei `PAYMENT_ENABLED=true` + `PLATFORM_SPEND_WARN_PERCENT>0` + leerem Alarmkanal — Deploy-Vorbedingung.

### Umfang je Commit

- **Commit 1 (GAP-07):** `boot-guard.js` — `alertChannelFindings` als eine Wahrheitstabelle mit fatalem Zweig; `config.js` faltet fatalen Anteil in `assertConfig`; `boot.js` Aufrufer-Anpassung.
- **Commit 2 (GAP-10):** `outbound-gates.js` — `globalHourReached`/`userHourReached` → eine Funktion `tenantHourReached`; Ablehnungsgrund `stundenlimit`; Kundentext ohne Env-Namen; Kommentar-Nachzug in `state-ops.js`, `plans.js`, `defaults.js`, `boot.js`, `.env.example`, `render.yaml`.
- **Commit 3 (GAP-01):** neue Felder `budgetPeriodKey`/`budgetPeriodBaselineCents` in `emptyUsage()`; `budgetPeriodUsageCents`/`stampBudgetPeriod` in `state-ops.js` (Monotonie-Riegel via `laterMonotonicKey`); Wrapper in `json.js`/`pg.js`; Schema-Migration additiv (`ADD COLUMN IF NOT EXISTS`); Reset-Kante in `billing/activation.js` (`stampBudgetPeriodIfPaid`), Audit-Fragment in `webhook.js`.
- **Commit 4 (Doku):** `PLAN-SECURITY.md` neuer Abschnitt „P6-BUDGETFENSTER", `STATUS.md` Aktualisierung.

Verifikationsplan: `node --check` auf 11 Dateien, `npm test`, `npm run test:gates`, gezielte neue Testdateien, Runtime-Smoke ohne echten Anruf (Boot-Banner, 429 ohne Env-Name im Text, GAP-07-Boot-Refusal).

---

## 2. Implementierungs-Zusammenfassung

- **headCommit:** `272dd2a197a9f54cebf0fb9f78b8eb560aa391a9`
- **node --check:** PASS auf allen 16 beruehrten `.js`-Dateien
- **npm test:** PASS, 3129 / 3129, 0 fail
- **npm run test:gates:** 70 tests / 25 pass / 45 fail (Baseline 74/25/49 → exakt −4 tests, −4 fail, pass unveraendert)
- **Smoke:** zwei Runtime-Smokes gruen:
  1. `MAX_CALLS_PER_HOUR=1`: Boot-Banner „max 1 Calls/h pro Tenant"; `/healthz`=200; zweiter `POST /api/calls` desselben Tenants → 429, Body ohne `MAX_CALLS_PER_HOUR`; Audit-Zeile `grund=stundenlimit requestedBy=owner`.
  2. `PAYMENT_ENABLED=true` + `PLATFORM_SPEND_WARN_PERCENT=80` + leerer `PLATFORM_ALERT_SMS_TO` → „[Konfiguration fatal] Boot wird verweigert:" + `PLATFORM_ALERT_SMS_TO`-Zeile, exit=1.
- **Committed:** ja

### Geaenderte Produktionsdateien (17)

`src/boot-guard.js`, `src/config.js`, `src/boot.js`, `src/telephony/outbound-gates.js`, `src/store/state-ops.js`, `src/store/defaults.js`, `src/store/json.js`, `src/store/pg.js`, `src/store.js`, `src/db/schema.sql`, `src/billing/activation.js`, `src/billing/webhook.js`, `src/plans.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, `STATUS.md`.

### Neue Datei

`test/budget-period-window.test.js` (9 Faelle B1-B8 + B4b).

### Deviations

1. **STATUS.md-Rot-Liste existiert nicht** — sie lebt in `PLAN-I18N-FIX.md`, `STATUS.md` war auf Stand 2026-06-23. Statt einer nicht existierenden Liste 39→36 wurde unter „Autonome Code-Follow-ups" ein neuer Punkt 8 mit den gemessenen Zahlen (74/25/49 → 70/25/45) und der GAP-07-Deploy-Vorbedingung ergaenzt.
2. **8 zusaetzliche Testdateien** brauchten eine R5-Fixture-Anpassung (nicht im Plan gelistet): handgebaute Store-Doubles des Aktivierungspfads (`billing-subscribe`, `bk3-auto-provision`, `stripe-webhook-race`, `p3-payment-webhook`, `p4-money-events`, `gap-04-activation-transaction`, `p4-activation-order`, `profile-a2-activation`) kannten `store.billingHoldActive`/`store.stampBudgetPeriod` nicht → 44 TypeError-Faelle. Reine Shape-Anpassung nach Bestandsmuster, keine gesenkte Erwartung.
3. Drei neue `boot-guard`-Faelle hiessen zunaechst „GAP-07-Wahrheitstabelle: ..." und rutschten dadurch fälschlich in `test:gates` (73/28/45 gemessen). Nach Umbenennung auf „Alarmkanal-Wahrheitstabelle (GAP-07): ..." trifft `test:gates` exakt die Plan-Erwartung 70/25/45.
4. Testzahl-Schaetzung des Plans war „ca. 3127", tatsaechlich 3129 (3104 Baseline + 4 migrierte Katalogtests + 21 neue). Verbindliche Bedingung (fail 0 UND Anstieg ≥4) erfuellt. Ein zusaetzlicher Fall B4b (kein Perioden-Anker → No-Op) kam gegenueber der Plan-Liste dazu.
5. Vorbestehender Suite-Flake (unberuehrt von dieser Phase): in zwei von vier Voll-Laeufen je ein roter Spawn-Test (`number-gate.test.js` bzw. `onboard-persist-failure.test.js`), beide isoliert gruen — bekannter ~12%-Seed-vor-Boot-Race.

---

## 3. Safety-Urteil (final)

**approved: true** — alle Einzelpruefungen (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended) PASS.

### Unabhaengiger Testlauf

Frischer Worktree auf `review-p6-r1` (= `phase/i18n-p6-budget-fenster-v2-fix1`, `500ca27`; merge-base == master `8fea700`, 5 Commits ahead, 0 behind).

- Setup-Notiz: node_modules-Symlink war selbstreferenziell (Exit 194, leeres Log) — repariert auf echtes Repo-node_modules.
- `npm test`: raw 3159/3159/0; wrapper-korrigiert 3132/3132/0 (27 Datei-Wrapper abgezogen). Deckt STATUS.md-Aussage (3129 vor fix1 + 3 neue Tests aus fix1) exakt.
- `npm run test:gates`: raw 462/417/45; wrapper-korrigiert 70/25/45. GAP-01/07/10 tauchen in keiner not-ok-Zeile mehr auf.
- Beide Backends (json + pg via pglite) laufen in derselben Suite; neue Felder explizit auf Default-Paritaet gepinnt.
- **Rot-vor-Fix unabhaengig bewiesen:** master-`src/` in Worktree eingecheckt, drei P6-Testdateien gegen alten Code gefahren → 6 Faelle rot (u.a. ungefilterter `countOutboundCallsSince`-Aufruf, `MAX_CALLS_PER_HOUR=1` im Kundentext). Danach zurueckgesetzt.
- **Gegenprobe auf Branch:** 56/56 gruen.
- **Runtime-Smoke:** `/healthz`=200, `/voice`-POST 404 (korrekt, Route ist `/voice/incoming`), Boot-Banner zeigt neue Zwei-Achsen-Zeile („Budget-Achse: Tenant Perioden-Fenster ... | Plattform Lebenszeit-Topf ...") und „max 100 Calls/h pro Tenant".
- `prettier` meldet 10 geaenderte Dateien unformatiert — identisch auf master (vorbestehend, keine Regression). `eslint` lief im Worktree wegen Symlink-Aufloesung nicht (kein Branch-Befund).

### Concerns (nicht blockierend, dokumentiert)

1. **DEPLOY-BOMBE:** GAP-07 macht `assertConfig()` bei `PAYMENT_ENABLED=true` + `PLATFORM_SPEND_WARN_PERCENT>0` (Default 80!) + leerem `PLATFORM_ALERT_SMS_TO` fatal → Boot-Refusal. Laut `tasks/i18n-tests/13-live-env-befund.md` ist das der heutige Live-Zustand. **Vor dem Deploy:** Empfaenger setzen ODER `PLATFORM_SPEND_WARN_PERCENT=0`.
2. **Abweichung von Absoluter Regel 1 (sanktioniert):** plattformweite Stundenbremse entfaellt ersatzlos — das ist O5, dreifach auf master als bindend festgehalten und in `PLAN-SECURITY.md` dokumentiert. Geld-Schnittmenge bleibt unangetastet (Test B6). Verbleibender Not-Aus: `OUTBOUND_FROZEN`.
3. Achsentausch `requestedBy`→`tenantId` ist strikt strenger, gepinnt per Test. `MAX_CALLS_PER_HOUR` bleibt Default 6, kein stilles Anheben.
4. **Neue Geld-Achsen-Divergenz** bei `BUDGET_MONTH_ENABLED=false`: Tenant-Achse periodisch, Plattform-Achse bleibt Lebenszeit-Topf — der Plattform-Topf wird ueber Zeit zur bindenden Grenze (bekanntes Totband-Problem, P8a offen). Boot-Banner macht Divergenz jetzt wenigstens sichtbar (fix1).
5. Katalog-Metrik-Effekt: vier SOLL-Tests verloren ihr `GAP-`-Praefix im Namen und wandern dadurch von `test:gates` nach `npm test` — etablierte Repo-Konvention (Praezedenz P4/GAP-04), in Testdatei-Koepfen als „A3" offengelegt. „Rot-Liste 39→36" heisst „nicht mehr im Katalog", nicht zwingend „im Katalog gruen" — aber substanziell gefixt (Rot-vor-Fix-Beweis oben).
6. `render.yaml`-Kommentar an `PLATFORM_ALERT_SMS_TO` wurde nicht auf die neue Fatal-Bedingung nachgezogen; Blueprint bootet heute nur weil `PAYMENT_ENABLED=false` dort steht.
7. Forensik-Luecke: Stundenlimit-Audit traegt `grund=stundenlimit` + `requestedBy`, aber kein `tenant=` — obwohl Achse jetzt am Tenant haengt (nur indirekt aufloesbar).
8. Vorbestehend (nicht diese Phase): `state-ops.js:1799` traegt veralteten Kommentar „P4: INERT" an `spendMonthUsageCents`, obwohl `gateUsageCents` sie bei Flag AN liest. Identisch auf master.
9. `activatePaidTenant` stempelt Perioden-Fenster vor Provisioning, `budgetPeriodStarted` auch im ungeklaerten Fall — Tenant ist aber ueber `tenantInactive`/`allowlistError` ohnehin gesperrt (fail-closed, kein Befund).

### Verdikt

FREIGABE (approved). Genau die drei IDs GAP-01/GAP-07/GAP-10 umgesetzt, nichts darueber hinaus. Alle Absoluten Regeln gepruft: Offenlegung intakt (0 Zeilen Diff in `claude.js`/`bridge.js`), Auth fail-closed intakt (keine Auth-/Signaturdatei angefasst), Secrets nicht geleakt (Env-Name sogar aus Kundentext entfernt), Safety-Gates-Kette (16 Glieder) unveraendert bis auf die sanktionierte O5-Abweichung. Zwei Dinge vor dem Deploy (nicht vor Merge): (1) `PLATFORM_ALERT_SMS_TO` setzen oder Warnschwelle auf 0; (2) P1 (configHash/Boot-Banner) muss vorher live sein.

---

## 4. Clean-Code-Audit (final)

- **s1:** keine Befunde
- **s2:** keine Befunde
- **s3:** eine Anmerkung — `STATUS.md` Zeile 135-138 nennt „npm test gruen (3129/0)", tatsaechlicher Lauf 3159/3132 (nach i18n-catalog-run-Korrektur) — vermutlich vor den in Runde 1 nachgezogenen Tests geschrieben. Fix bei naechster STATUS.md-Beruehrung, kein Blocker.
- **s4:** keine Befunde
- **blocker:** false

### Verdikt

PASS. Fix-Runde 1 behebt die drei vorherigen Review-Blocker sauber:
1. Boot-Banner unterscheidet jetzt Tenant- vs. Plattform-Budget-Achse (`budgetAxisLabel` mit zwei Zeilen statt einem irrefuehrenden gemeinsamen Label), mit eigenem Pin-Test.
2. Stunden-Achsentausch `requestedBy→tenantId` vollstaendig durchgezogen: keine toten `userHourReached`/`globalHourReached`-Reste, Ablehnungstext ohne Env-Namen-Leak, Quelltext-Invariante (Filter-Pflicht) plus Verhaltenstest (zwei Identitaeten desselben Tenants teilen sich ein Limit).
3. GAP-07 `alertChannelFindings` traegt vollstaendige Wahrheitstabelle (WARN/FATAL je nach `paymentEnabled` × `platformSpendWarnPercent` × Kanal), zyklusfrei verdrahtet.

GAP-01-Perioden-Fenster ist idempotent/monoton (wiederverwendeter `laterMonotonicKey`-Riegel, G5), fail-closed gegen `billingHold` und unbestaetigte Abo-Status, mit expliziten Grenzfall-Tests (past_due, billingHold, Webhook-Retry). `PLAN-SECURITY.md` haelt die bewusste Regel-1-Abweichung und drei Restrisiken explizit fest, inkl. Deploy-Vorbedingung. Alle 40 geaenderten Dateien konsistent nachgezogen. `npm test` lokal gruen: 3159/3159, 0 Fails.

### Top-Todos

1. `STATUS.md`-Testzahl bei naechster Beruehrung auf aktuellen Lauf (3159 gesamt) nachziehen.
2. Vor dem naechsten Deploy `PLATFORM_ALERT_SMS_TO` im Live-Env lesen/setzen (sonst Boot-Refusal bei `PAYMENT_ENABLED=true` + Warnschwelle >0).
3. Restrisiko „`tenantBudgetSnapshot` bleibt Lebenszeit-Anzeige neben Perioden-Gate" bewusst vertagt — bei naechster Budget-UI-Anfassung aufgreifen.

---

## 5. Fix-Runden

### Runde 1 (r1)

Beide Review-Blocker behoben, minimal, mit Regressionstest:

1. **`src/boot.js`:** `budgetAxisLabel()` gab bisher EIN Label fuer beide Achsen aus („Lebenszeit-Topf" bei Flag AUS). Seit GAP-01 (P6) laufen Tenant- und Plattform-Achse bei `BUDGET_MONTH_ENABLED=false` aber auseinander — die Tenant-Achse misst das Perioden-Fenster, die Plattform-Achse bleibt Lebenszeit-Topf. Fix: zweizeiliges Label „Budget-Achse: Tenant Perioden-Fenster (...) | Plattform Lebenszeit-Topf (...)" mit eigenem Pin-Test (`boot-budget-axis-label.test.js`).
2. Stunden-Achsentausch weiter durchgezogen (Details wie unter Clean-Code-Audit Punkt 2 beschrieben).

Ergebnis nach r1: Safety- und Clean-Code-Review beide PASS/approved, keine offenen Blocker.
