# KS-P5 — Detailbericht: Gutschriften der laufenden Periode zulassen (beide Achsen, 0-Boden erhalten)

- **Gate:** PASS
- **finalBranch:** `phase/ks-p5-gutschriften`
- **headCommit:** `0324b8e57e49bd2ebf859b5a5a59451dc226d261`
- **Basis:** `master` = `794ca47`

---

## 1. Plan (gekürzt)

Ausgangsbefund am Code: die negative Korrektur (`bookCostCorrectionCents`) traf bisher nur `usage.costCents` mit 0-Boden; die Perioden-Achse (`budgetPeriodUsageCents`) ist eine reine Ableitung aus `costCents` und hatte deshalb *nie* einen eigenen Missbrauchsschutz — jede Gutschrift, egal wie alt, senkte das Fenster automatisch mit. Die Spend-Monat-Achse (`spendMonthUsageCents`) hatte weder Zugriff auf Gutschriften noch einen 0-Boden.

Kernentscheidung: der Anker einer Gutschrift ist **nicht** `call.startedAt` und **nicht** der Zeitpunkt der Korrektur, sondern die zwei Achsen-Stempel, unter denen die **Belastung** tatsächlich gebucht wurde (`usage.spendMonthKey` / `usage.budgetPeriodKey`), gelesen aus dem Bucket, den `addVoiceUsageCostCents` zurückgibt ("Bucket-Brigade" statt kommentierter Reihenfolge, G31).

Bausteine laut Plan:
- Zwei neue Anker-Felder am Call (`estimatedCostSpendMonthKey`, `estimatedCostPeriodKey`), additiv/nullable, set-once zusammen mit `estimatedCostCents`.
- `chargeAnchorsOfUsage`/`chargeAnchorsOfCall` als einzige Stelle, die die Anker-Form baut; `NO_CHARGE_ANCHORS` als benannter fail-closed-Default für Bestandszeilen ohne Anker.
- `spendMonthCounterCurrent` extrahiert (eine Quelle für Leseprojektion und Gutschrift-Wirksamkeit); `spendMonthUsageCents` bekommt denselben `Math.max(0, …)`-Riegel wie `budgetPeriodUsageCents`.
- `creditHitsSpendMonth` / `creditHitsBudgetPeriod` als benannte Zulässigkeits-Prädikate; `applyCreditCents` als einziger Ort mit Gutschrift-Semantik: 0-Boden auf Lebenszeit, der gekappte Betrag wirkt bedingt auf Spend-Monat, und bei Nicht-Zugehörigkeit zur laufenden Periode wandert `budgetPeriodBaselineCents` kompensierend mit (Fenster bleibt unberührt).
- `recordCallEstimatedCostCents` und `bookCostCorrectionCents` auf Optionsobjekt umgestellt (F1, Arity), `applyCostCorrectionCents` behält seine Arity (Anker reisen im vorhandenen Input-Objekt).
- Persistenz-Parität json/pg (`CALL_FIELD_DEFAULTS`, `rowToCall`, `flushCalls` inkl. `ON CONFLICT`), `schema.sql` additiv/idempotent, `views.js`/`publicCall` strippt beide neuen Felder (kein API-Leak).
- Acht neue Tests (P1–P8) plus Anpassung von sechs Bestandstest-Dateien; Mutationsproben als Pflichtnachweis.
- Doku-Pflichten: `PLAN-SECURITY.md` (Restrisiko auflösen + neuen Befund nachtragen), Report inkl. DDL-Übergabe an den Owner (zwei `ALTER TABLE`, erst migrieren dann deployen — Regel "Keine automatische DB-Migration").

Pre-Mortem (Auszug): Gutschrift sperrt Kunden über 0-Boden-Bruch → strukturell im Gutschrift-Pfad gehalten, nie über `bookCents`. Negativer Monatsverbrauch weitet Plattform-Decke → `Math.max(0,…)`-Riegel wirkt automatisch auch in `platformSpendMonthCents`. Alte Gutschriften drehen abgeschlossene Fenster zurück → Anker statt `nowIso`/`startedAt`. Zwei-Uhren-Fehler an der Monatsgrenze → Bucket-Brigade statt zwei Fassaden-Aufrufe. Bestandszeilen ohne Anker → `NO_CHARGE_ANCHORS`, fail-closed auf Lebenszeit-Achse.

---

## 2. Implementierung — Zusammenfassung

Vollständig plankonform umgesetzt (Abschnitte 2.1–2.7 des Plans 1:1). Kern-Deliverables:

- **`src/store/state-ops.js`:** `createCall`/`CALL_FIELD_DEFAULTS` um die zwei Anker-Felder erweitert; `recordCallEstimatedCostCents` auf Optionsobjekt `{costCents, chargeAnchors}` umgestellt, schreibt Betrag+Anker in einem set-once-Schritt; `chargeAnchorsOfUsage`/`chargeAnchorsOfCall`/`NO_CHARGE_ANCHORS` neu; `spendMonthCounterCurrent` extrahiert, `spendMonthUsageCents` trägt jetzt `Math.max(0,…)`; `creditHitsSpendMonth`/`creditHitsBudgetPeriod`/`applyCreditCents` neu; `bookCostCorrectionCents` auf Optionsobjekt `{tenantId, deltaCents, chargeAnchors, nowIso}`, negative Korrekturen laufen über `applyCreditCents`; `applyCostCorrectionCents` reicht `chargeAnchors` (Default `NO_CHARGE_ANCHORS`) durch, Arity unverändert.
- **`src/billing/metering.js`:** Bucket-Brigade — `store.addVoiceUsageCostCents(...)` liefert den Bucket, `store.recordCallEstimatedCostCents(call.id, {costCents, chargeAnchors: chargeAnchorsOfUsage(usage)})` konsumiert dessen Rückgabewert; Reihenfolge damit strukturell statt konventionell erzwungen.
- **`src/billing/cost-truing.js`:** `chargeAnchors: chargeAnchorsOfCall(call)` beim Aufruf von `applyCostCorrectionCents` ergänzt.
- **`src/store/json.js` / `src/store/pg.js`:** Fassaden-Parität für die neue `recordCallEstimatedCostCents`-Signatur; `rowToCall` hydriert beide neuen Spalten; `flushCalls` Spaltenliste/Values/`ON CONFLICT DO UPDATE SET` um beide Felder erweitert (40/40 Spalten).
- **`src/db/schema.sql`:** CREATE-Block + idempotenter `ALTER TABLE … ADD COLUMN IF NOT EXISTS`-Nachzug für beide Spalten.
- **`src/store/views.js`:** `publicCall` strippt beide neuen Felder — kein Leak über `/api/state`/MCP.
- **Tests:** neue Datei `test/ks-p5-current-period-credits.test.js` (P1–P8), sechs Bestandsdateien nachgezogen (`usage-correction-booking.test.js` inkl. Aufspaltung (e)→(e1)/(e2), `budget-period-window.test.js`, `ks-p4-snapshot-gate-axis.test.js`, `metering-unit.test.js`, `cost-origin-axis.test.js`, `call-actual-cost-roundtrip.test.js`).
- **`PLAN-SECURITY.md`:** altes Restrisiko als aufgelöst markiert, neuer Befund zur bis-KS-P5 fehlenden Sicherung der Perioden-Achse nachgetragen.

**Verifikation (Impl-Agent):** `node --check` auf allen 13 berührten `.js`-Dateien sauber. `npm test`: 3568 pass / 0 fail (roh 3588/3588, 20 i18n-Wrapper abgezogen); Backends json und pglite-in-process beide in der Suite. Gezielter Lauf über alle berührten Dateien + `api-read-parity`: 87 pass / 0 fail. Sieben Mutationsproben (M1–M7, s. §3) einzeln gesetzt/gefahren/zurückgebaut, danach wieder 8/8 grün, `git diff --stat` identisch zum Vorzustand. Smoke: Server über `test/helpers.startServer`, `/healthz` → 200, `/api/state` → 200 ohne die zwei neuen Felder im Body. Keine verwaisten `node`-Prozesse.

### Deviations (aus dem Impl-Report)

1. Der Worktree-Branch `phase/ks-p5-gutschriften` existierte bereits mit einer **uncommitteten Teil-Implementierung** eines abgebrochenen Vorlaufs (alle `src/`-Änderungen plus 5 der 6 Test-Anpassungen, HEAD == master == `794ca47` verifiziert). `git checkout -b` schlug deshalb fehl; der Bestand wurde Zeile für Zeile gegen den Plan geprüft, übernommen statt neu gebaut, fehlende Teile ergänzt (neue Testdatei, `call-actual-cost-roundtrip.test.js`, `PLAN-SECURITY.md`, dieser Report).
2. Der vorgegebene `ln -s "./node_modules" node_modules`-Befehl erzeugte im Worktree einen selbstreferenziellen kaputten Symlink; ersetzt durch Symlink auf den echten `node_modules`-Pfad des Haupt-Repos. Nicht committet (gitignored).
3. Plan-§4 P7 (Anker-Kette) nutzt statt eigener Mini-Helfer den echten Sweep (`makeCostTruing` + `runCostTruingSweep`) über das geteilte `test/cost-truing-harness.js`, mit eigenem minimalen Beleg-Stub, weil die entsprechenden Helfer in `test/cost-truing-booking.test.js` bewusst lokal/nicht exportiert sind — beweist damit die Wirkung, nicht nur die Datenstruktur (stärkere Zusage).
4. Plan-§5 spricht von "sechs" Mutationen, §4 nennt tatsächlich sieben (P2–P8, P1 ist Happy Path ohne Mutation) — alle sieben wurden gefahren.
5. Plan-§5 erwartet "Bestand + 8"; tatsächlich +9, weil die vom Plan selbst in §3 verlangte Aufspaltung des Bestandstests (e) in (e1)+(e2) einen zusätzlichen Test erzeugt.
6. `npm run test:gates` wurde vom Impl-Agenten nicht gefahren (Zeitbudget, laut Spec darf er rot bleiben); keine neue KS-P5-Testkennung trägt ein i18n-Katalog-Präfix, alle landen im Regressionslauf.

---

## 3. Mutationsproben-Protokoll

Sieben Mutationen einzeln gesetzt, `node --test test/ks-p5-current-period-credits.test.js` gefahren, danach zurückgebaut:

| # | Mutation | Erwartung | Ergebnis |
|---|---|---|---|
| M1 | Baseline-Kompensation in `applyCreditCents` entfernt | P2 rot | rot ✓ |
| M2 | `creditHitsSpendMonth` fest auf `false` | P3/P6/P7/P8 rot | rot ✓ |
| M3 | Ankerprüfung durch `nowIso`-Vergleich ersetzt (die von TOD 3 wörtlich geforderte Probe) | P4 rot | rot ✓ |
| M4 | Gutschrift über `bookCents` statt `applyCreditCents` | P2/P4/P5/P6 rot | rot ✓ |
| M5 | `Math.max(0,…)` in `spendMonthUsageCents` entfernt | P6 rot | rot ✓ |
| M6 | Bucket-Brigade zurückgebaut (zwei unabhängige Store-Aufrufe) | P7/P8 rot | rot ✓ |
| M7 | Anker aus `call.startedAt` statt Buchungs-Stempel | P8 rot | rot ✓ |

Nach dem letzten Rückbau wieder 8/8 grün, `git diff --stat` identisch zum Ausgangszustand.

---

## 4. Safety-Urteil (final)

**Verdict: FREIGABE MIT AUFLAGE** (`approved: true`, kein Blocker).

Bestätigt: alle Testläufe unabhängig grün (eigener Lauf: 3588 roh / 3568 korrigiert pass / 0 fail, 96,9 s, beide Backends json+pglite); Safety-Gates intakt; Offenlegungssatz intakt; Auth fail-closed intakt; keine Secrets geleakt; Scope eingehalten; Verhalten wie beabsichtigt. `src/claude.js`, `src/bridge.js`, `src/telephony/outbound-gates.js`, `src/auth.js`, `src/web-auth.js`, `src/middleware.js`, `src/server.js`, `src/config.js`, `package.json`/`package-lock.json` byte-identisch zu master. `test:gates`: 126 pass / 3 fail (GAP-05, 2× GAP-15) — dokumentierte vorbestehende Produktbefunde, keiner durch KS-P5 berührt.

**Auflagen/Concerns (nicht blockierend):**

1. **Flag-gated Regression:** `usage.spendMonthCostCents` kann seit KS-P5 im Speicher **negativ bleiben** (der `Math.max(0,…)`-Riegel sitzt nur an der Lesekante `spendMonthUsageCents`, nicht am Speicher). Eigene Messung: Bucket `costCents=423`/`spendMonthCostCents=200`, Gutschrift `-861` mit Anker laufender Monat → gespeichert `-223`; eine danach folgende echte Belastung `+200` ct ergibt gespeichert `-23`, `gateUsageCents` (Flag AN) liest `0` statt der korrekten `200` — eine spätere echte Belastung desselben Monats wird verschluckt. Gegenprobe auf master: dort bleibt der Speicherwert bei `200`, Gate liest nach `+200` korrekt `400`. Wirkung heute **inert**, weil `BUDGET_MONTH_ENABLED` Default `false` ist (`config.js`, `render.yaml`) — der live tragende Gate ist die Perioden-Achse. Zusätzlich verfälscht dies die ungegatete Anzeige `spendMonthCostEur` (`routes/api-read.js`) nach unten. **Muss vor jedem Flip von `BUDGET_MONTH_ENABLED` aufgelöst sein** (Fix wäre einzeilig — Speicher ebenfalls klemmen —, kippt aber Test P6, der den negativen Speicherwert bewusst pinnt → Owner-Entscheidung nötig).
2. Dieser Report (ursprüngliche Fassung) führte die Restwirkung aus (1) nicht auf — hiermit nachgetragen (s. §5 unten, Restrisiko 4).
3. Der alte Kommentarblock in `bookCostCorrectionCents`, der explizit festhielt, dass der 0-Boden die Invariante `spendMonthCostCents <= costCents` still bricht, wurde ersatzlos entfernt, obwohl der Sachverhalt unter KS-P5 stärker gilt (Monatszahl kann jetzt sogar negativ werden) — sollte weiter dokumentiert bleiben.
4. Robustheit: `recordCallEstimatedCostCents({costCents, chargeAnchors})` hat keinen Default für `chargeAnchors`; bei fehlendem/nullem Aufruf würde `call.estimatedCostCents` bereits gesetzt, bevor der Zugriff auf `chargeAnchors` wirft → Teilmutation "Betrag ohne Anker". Heute unerreichbar (einziger Aufrufer `metering.js` liefert immer beides), aber `NO_CHARGE_ANCHORS` als Default wäre dieselbe fail-closed-Absicherung wie in `applyCostCorrectionCents`.
5. Deploy-Vorbedingung (korrekt dokumentiert, hier zur Weitergabe): zwei neue `call`-Spalten, ohne vorherige manuelle Migration bricht der erste `flushCalls` nach Deploy. Reihenfolge zwingend erst `psql`, dann Deploy.
6. Bewusst getragen und korrekt bewertet: Gutschriften für Calls von vor dem Deploy haben keinen Anker (kein Backfill möglich) und wirken nur auf der Lebenszeit-Achse — für die Perioden-Achse ist das strenger als Bestandsverhalten, also die sichere Richtung.

---

## 5. Bewusst getragene Restrisiken

1. Fällt eine Gutschrift durch den 0-Boden von `costCents` und ist sie zugleich perioden-unzulässig, wird die Baseline auf 0 geklemmt und das Fenster schrumpft dennoch (nie größer als `costCents`). Bounded, nur wenn die Gutschrift die gesamte Lebenszeit-Buchung übersteigt.
2. Unter Uhr-Anomalie (Monotonie-Riegel hält den Stempel in der Zukunft) wird eine legitime Gutschrift auf der Monats-Achse verworfen — nie fälschlich akzeptiert. Fail-closed.
3. Der Anker ist rückwirkend nicht erhebbar: Gutschriften für vor dem Deploy geführte Calls bleiben auf der Lebenszeit-Achse (kein Backfill).
4. **Neu (aus dem Safety-Review nachgetragen):** `spendMonthCostCents` kann im Speicher negativ bleiben und spätere echte Belastungen desselben Monats teilweise verschlucken (Detail s. §4, Concern 1). Heute inert hinter `BUDGET_MONTH_ENABLED=false`. **Vor jedem Flip dieses Flags ist der 0-Boden zusätzlich an der Schreibkante nachzuziehen** (oder die Entscheidung, ihn dort bewusst wegzulassen, explizit festzuhalten) — offener Punkt für die nächste Phase, die `BUDGET_MONTH_ENABLED` anfasst.

---

## 6. Clean-Code-Audit

**Verdict: PASS** (kein Blocker).

- **S1 (Blocker):** keine Funde.
- **S2 (schwerwiegend, kein Blocker):** keine Funde.
- **S3 (leicht):** eine Fundstelle — `src/store/state-ops.js:2358-2360`: lokale Variablennamen `vorher`/`wirksam` (Deutsch statt sonst durchgängig Englisch für Identifier). Bereits existierende Präzedenz im Repo (`test/usage-event-meter.test.js`), im Rahmen der Repo-Praxis vertretbar, kein Fix nötig.
- **S4:** keine Funde.

**Begründung (Auszug):** Kern-Invarianten sauber durchdacht — 0-Boden auf allen drei Achsen, Baseline-Kompensation bei fremdem Perioden-Anker, `NO_CHARGE_ANCHORS` als benannter fail-closed-Default, Monatsgrenzen-Fall explizit getestet. Signaturänderungen (F1) sauber an allen Callern durchgezogen, kein vergessener Aufrufer (`git grep` über den vollen Branch-Inhalt). G5 eingehalten: `chargeAnchorsOfUsage`/`chargeAnchorsOfCall` sind die eine Stelle für die Anker-Form. json/pg-Parität vollständig, `views.js` strippt beide neuen Felder. Schema-Migration additiv/nullable/idempotent, Deploy-Vorbedingung in `PLAN-SECURITY.md` und Report dokumentiert. Testabdeckung: dedizierte 8-Test-Datei mit vollständigem Mutationsprotokoll, Bestandstests konsistent nachgezogen inkl. sauberer Aufspaltung (e)→(e1)/(e2) statt Überladung eines Tests mit zwei Konzepten.

**Top-TODOs aus dem Audit:**
1. DDL vor dem nächsten Deploy anwenden (s. §7) — sonst bricht der erste Call nach Deploy.
2. Optional/kosmetisch: deutsche Identifier `vorher`/`wirksam` bei Gelegenheit an die überwiegend-englische Namenskonvention angleichen (kein Blocker).

---

## 7. Fix-Runden

Keine — der finale Stand ist der aus Impl+Review geprüfte Stand. Es wurden keine Nach-Review-Fixes committet (`=== FIXES ===` im Quellmaterial ist leer). Die im Safety-Review benannten Auflagen (Concerns 1–4, s. §4/§5) sind als Restrisiken dokumentiert, aber nicht Teil dieser Phase behoben — sie sind explizit an den nächsten Flip von `BUDGET_MONTH_ENABLED` bzw. an Gelegenheits-Pflege gebunden.

---

## 8. Deploy-Vorbedingung (Regel „Keine automatische DB-Migration")

Zwei additive, nullable Spalten. Reihenfolge zwingend: **erst migrieren, dann deployen.**

```sql
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_spend_month_key TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_period_key TEXT;
```

Anwenden: `psql "$(cat ~/.config/hermes/db-url)" -f <datei>.sql`. Gegenprobe: `\d call` zeigt beide Spalten. Kein Backfill möglich — Gutschriften für vor dem Deploy geführte Calls bleiben auf der Lebenszeit-Achse. Die Phase selbst fasst die Prod-DB nicht an.
