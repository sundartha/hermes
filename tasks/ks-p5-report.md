# KS-P5 — Gutschriften der laufenden Periode zulassen (beide Achsen, 0-Boden erhalten)

Branch `phase/ks-p5-gutschriften`, Basis `master` = `794ca47`.

---

## 1. Was die Phase geaendert hat

Der Anker der Gutschrift ist seit dieser Phase **nicht** `call.startedAt`, **nicht** der
Zeitpunkt der Korrektur, sondern die **zwei Achsen-Stempel, unter denen die BELASTUNG
tatsaechlich gebucht wurde**: `usage.spendMonthKey` und `usage.budgetPeriodKey`, gelesen aus
dem Bucket, den `addVoiceUsageCostCents` gerade zurueckgegeben hat (Bucket-Brigade, G31).
Sie werden zusammen mit `estimatedCostCents` in EINEM set-once-Schritt am Call persistiert
(`estimatedCostSpendMonthKey` / `estimatedCostPeriodKey`, DB: `estimated_cost_spend_month_key`
/ `estimated_cost_period_key`).

Wirkung je Achse:

| Achse | vor KS-P5 | nach KS-P5 |
|---|---|---|
| Lebenszeit (`costCents`) | Gutschrift wirkt immer, 0-Boden | unveraendert |
| Spend-Monat (`spendMonthCostCents`) | Gutschrift erreicht sie NIE (pauschal gesperrt) | wirkt, wenn der Anker den gerade gezaehlten Monat trifft; zusaetzlich 0-Boden in `spendMonthUsageCents` |
| Perioden-Fenster (Ableitung `costCents` - Baseline) | jede Gutschrift senkte es mit — **der Missbrauchsschutz existierte hier gar nicht** | fremder Anker -> `budgetPeriodBaselineCents` wandert um denselben Betrag mit, das Fenster bleibt unberuehrt |

Fehlender Anker (Bestandszeile vor KS-P5, Aufrufer ohne Call) -> `NO_CHARGE_ANCHORS` ->
Gutschrift nur auf der Lebenszeit-Achse = exakt das Bestandsverhalten, also fail-closed.

## 2. Mutationsproben-Protokoll (Pflicht)

Jede Mutation einzeln gesetzt, `node --test test/ks-p5-current-period-credits.test.js`
gefahren, danach aus einer Kopie zurueckgebaut. Ergebnis nach dem letzten Rueckbau:
8 pass / 0 fail.

| # | Mutation | Datei | rot geworden |
|---|---|---|---|
| M1 | Baseline-Kompensation im Perioden-Zweig abgeschaltet (`if (false && !creditHitsBudgetPeriod(...))`) | `state-ops.js` | **P2** |
| M2 | `creditHitsSpendMonth` auf `false` festgenagelt | `state-ops.js` | **P3, P6, P7, P8** |
| M3 | Ankerpruefung durch reinen `nowIso`-Vergleich ersetzt (`return spendMonthCounterCurrent(bucket, nowIso)`) — die von TOD 3 woertlich geforderte Probe | `state-ops.js` | **P4** |
| M4 | Gutschrift ueber `bookCents(usage, deltaCents, nowIso)` statt `applyCreditCents` (0-Boden weg) | `state-ops.js` | **P2, P4, P5, P6** |
| M5 | `Math.max(0, ...)` in `spendMonthUsageCents` entfernt | `state-ops.js` | **P6** |
| M6 | Bucket-Brigade zurueckgebaut (zwei unabhaengige Store-Aufrufe, Anker fest `null`) | `metering.js` | **P7, P8** |
| M7 | Anker aus `call.startedAt` statt aus dem gebuchten Bucket | `metering.js` | **P8** |

Kein neuer Test blieb bei einer Mutation gruen, die seine Aussage aufhebt. Umgekehrt haben
M2/M4 mehr als einen Test gefaerbt — die Tests ueberlappen bewusst an den Geld-Kanten.

## 3. Testlage

- `npm test`: **3568 pass / 0 fail** (nach Abzug der 20 Datei-Wrapper durch
  `i18n-catalog-run`). Neu: `test/ks-p5-current-period-credits.test.js` (8 Tests) sowie die
  Aufspaltung des Bestandstests `(e)` in `(e1)`/`(e2)` in
  `test/usage-correction-booking.test.js`.
- Gezielter Lauf ueber alle beruehrten Bestandsdateien
  (`call-actual-cost-roundtrip`, `usage-correction-booking`, `budget-period-window`,
  `ks-p4-snapshot-gate-axis`, `metering-unit`, `cost-origin-axis`, `cost-truing-booking`,
  `api-read-parity`): **87 pass / 0 fail**.
- `api-read-parity` gruen belegt die Gegenprobe „kein API-Leak": `publicCall` strippt beide
  neuen Felder wie die fuenf LCT-P2-Kostenfelder.

Angepasste Bestandstests und ihr Grund:

| Datei | Aenderung | Grund |
|---|---|---|
| `usage-correction-booking.test.js` | Objekt-Signatur; `(e)` -> `(e1)` fremder Anker (Assertion woertlich erhalten) + `(e2)` neu: Anker = laufender Monat senkt die Monatszahl | `(e)` pinnte bisher pauschal „negative Korrektur laesst die Monats-Achse unangetastet" |
| `budget-period-window.test.js` | B5 auf Objekt-Signatur mit `NO_CHARGE_ANCHORS` | Assertion `gateUsageCents === 0` bleibt gruen (Baseline 100 -> 70, `costCents` 70) — Regressionsbeweis, dass die Kompensation die alte Aussage nicht kippt |
| `ks-p4-snapshot-gate-axis.test.js` | Objekt-Signatur mit `NO_CHARGE_ANCHORS` | KS-P4-Eigenschaft (vergifteter Lebenszeit-Zaehler vs. gesunde Gate-Zahl) unveraendert |
| `metering-unit.test.js`, `cost-origin-axis.test.js` | Fake-Store liefert einen Bucket zurueck; `recordCallEstimatedCostCents(callId, input)` | echte Interface-Erweiterung (Bucket-Brigade) |
| `call-actual-cost-roundtrip.test.js` | B1/B2 um die zwei Felder (`=== null`), E1 um „Anker werden mitpersistiert" | json<->pg-Paritaet der neuen Spalten |

## 4. Bewusst getragene Restrisiken

1. Faellt eine Gutschrift durch den 0-Boden von `costCents` und ist sie zugleich
   perioden-**un**zulaessig, wird die Baseline auf 0 geklemmt und das Fenster schrumpft
   dennoch (es kann nie groesser als `costCents` sein). Bounded, ausschliesslich in Faellen,
   in denen die Gutschrift die gesamte Lebenszeit-Buchung uebersteigt.
2. Unter Uhr-Anomalie (der Monotonie-Riegel `laterMonotonicKey` haelt den Stempel in der
   Zukunft) wird eine legitime Gutschrift auf der Monats-Achse **verworfen** — nie
   faelschlich akzeptiert. Fail-closed.
3. Der Anker ist rueckwirkend nicht erhebbar. Gutschriften fuer vor dem Deploy gefuehrte
   Calls bleiben auf der Lebenszeit-Achse (kein Backfill, `NULL` heisst „Anker unbekannt").

## 5. DDL-Uebergabe an den Owner (Deploy-Vorbedingung)

Die Phase fasst die Prod-DB **nicht** an (Regel 0 der Ketten-Spec). Zwei neue Spalten,
additiv NULLABLE, kein Backfill. Reihenfolge zwingend: **erst migrieren, dann deployen** —
zusaetzliche Spalten stoeren den laufenden alten Code nicht, fehlende brechen den neuen
sofort (Lehre `no-automatic-db-migration`; `applySchema` laeuft nur in Tests).

```sql
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_spend_month_key TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_period_key TEXT;
```

Anwenden mit `psql "$(cat ~/.config/hermes/db-url)" -f <datei>.sql`.
Gegenprobe: `\d call` zeigt beide Spalten.

## 6. Doku

`PLAN-SECURITY.md`, Block „Perioden-Fenster des Budget-Gates (GAP-01)":

- Restrisiko 2 durchgestrichen und als **in KS-P5 aufgeloest** markiert (Muster
  Restrisiko 3 / KS-P4).
- Neu nachgetragen: dass die Perioden-Achse den Missbrauchsschutz **vor** KS-P5 gar nicht
  hatte, dass `spendMonthUsageCents` seit KS-P5 denselben 0-Boden traegt wie
  `budgetPeriodUsageCents` (inkl. der Folge fuer `platformSpendMonthCents`), und die
  DDL-Deploy-Vorbedingung.

## 7. Abweichung vom Plan

`test/ks-p5-current-period-credits.test.js` bringt fuer die Leseseite von P7 einen eigenen
Beleg-Stub (`nullCostControl`, `PFLICHT_RECORD_TYPES`) mit, statt Helfer aus
`test/cost-truing-booking.test.js` zu teilen — diese liegen dort bewusst lokal (dokumentiert
im Kopf jener Datei) und sind nicht exportiert. Der Stub ist auf das Noetige reduziert
(Belege ueber die volle Pflicht-Menge, Ist-Kosten 0 bei `billedSec > 0`); `makeStubStore`,
`fakeConfig` und `makeDueOutboundCall` kommen aus dem geteilten `cost-truing-harness.js`.
