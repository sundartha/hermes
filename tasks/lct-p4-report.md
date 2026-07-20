# Phase-Report: P4 — Der Flip: Korrekturbuchung auf Ist-Kosten

**Plan-Quelle:** PLAN-LIVE-COST-TRACING.md, Abschnitt "P4"
**Umfang:** Bucht — hinter dem neuen Flag `COST_TRUING_BOOKING_ENABLED` (Default AUS) — die Differenz zwischen gemessenen Ist-Kosten (Provider, USD-Mikro-Cent) und dem in P2 persistierten `estimatedCostCents` (EUR-Cent) auf `usage.costCents`/`spendMonthCostCents`. Überschätzung wird **bedingungslos** geheilt; Rückerstattung (Ist < Schätzung) **nur** bei bewiesener Vollständigkeit der Provider-Records. Zwei neue Boot-Guards: leere Pflicht-Menge = fataler Boot-Refusal, Deckungsquote unter Schwelle = WARN.
**Gate-Ergebnis: PASS**
**finalBranch:** `phase/lct-p4-correction-booking-fix1`
**headCommit (Runde 1, Implementierung):** `3336806eceac66f93432a2c5715b5f4b738de4b2`
**headCommit (final, nach Fix-Runde r1):** `1b048a65d63491851cc13c750afed8b4beccd529`
**Basis:** `master @ 8e393ba` (P1–P5 bereits gemergt)
**Datum:** 2026-07-20

---

## 1. Plan (gekürzt)

### 1.1 Vorbedingungen und Scope-Riegel (Kapitel 0)

| # | Vorbedingung | Status laut Plan |
|---|---|---|
| V1 | Fall A (Nebenkosten-`record_types` joinbar, Summe deckt STT/TTS/Recording/Inference ab) vs. Fall B | **Harter Blocker, als Fall A umgesetzt.** `voiceOverheadCentsPerMin` wird bewusst **nicht** eingeführt (Config ohne Verbraucher wäre toter Code). Ergibt ein späterer Live-Beleg Fall B, muss P4 vor Wirksamkeit um den Aufschlag erweitert werden. |
| V2 | `COST_TRUING_REQUIRED_RECORD_TYPES` aus echten API-Antworten gesetzt | Betriebsschritt, kein Code. Boot-Riegel (Fall n) erzwingt ihn ab dieser Phase. |
| V3 | Deckungsquote ≥ `COST_TRUING_MIN_COVERAGE_PERCENT` | Betriebsschritt. Deckungs-Riegel (Fall p) macht ihn sichtbar (WARN), erzwingt ihn nicht fatal. |
| V4 | PLAN-BUDGET-AXES P7 (Monatsachsen-Flip) geht **nicht** im selben Deploy live | Koordinationsregel, Betriebsschritt. |
| V5 | P5 aktiv, Alarmkanal `PLATFORM_ALERT_SMS_TO` besetzt | P5 gemergt; Besetzung des Kanals ist Betriebsschritt. |

**Scope-Riegel:** `src/billing/metering.js` bleibt unangetastet (bucht weiterhin unverändert Tarif × Minuten). Keine neue Dependency, kein Backfill, kein neuer Index.

### 1.2 Neue Funktionen (Kapitel 1)

- `src/store/defaults.js`: `PROVIDER_RATE_SCALE` (benannte Kurs-Skala, 1e6) + `isCorrectionCents(x)` (eigenes Prädikat für Korrektur-Beträge, **beliebiges Vorzeichen** — Schwester von `isBookableCents`, die unverändert bleibt).
- `src/store/state-ops.js`: `convertProviderMicroToBucketCents` (reine Ganzzahl-Umrechnung mit Rest-Übertrag, mutiert nichts), `bookCostCorrectionCents` (Cent-Schreibkante: 0-Boden + Achsen-Asymmetrie), `applyCostCorrectionCents` (ein Schritt: Umrechnung + Fall-Entscheidung + Buchung + Rest-Fortschreibung, alles-oder-nichts).
- `src/boot-guard.js`: `COST_TRUING_BOOKING_FINDING`-Enum + `costTruingBookingFindings` (reine Funktion, Buchung AUS → `[]`; leere Pflicht-Menge → `fatal:true`; Deckung unter Schwelle → `fatal:false`).

### 1.3 Die Formel (Kapitel 5, von Hand durchgerechnet)

```
CORRECTION_DIVISOR = MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE = 1e6 * 1e6 = 1e12
totalMicro  = remMicro + actualCostMicroCents * providerToBucketRateMicro
bucketCents = floor(totalMicro / CORRECTION_DIVISOR)
remMicro'   = totalMicro % CORRECTION_DIVISOR          // nie verworfen
deltaCents  = bucketCents - estimatedCostCents          // gegen den PERSISTIERTEN Wert
```

Kein `/1e6`-Zwischenschritt (keine zweite Float-Präzisionsstufe); `Math.floor`/`%` sind auf ganzzahligen, nicht-negativen Operanden exakt.

### 1.4 Rot-vor-Fix-Reihenfolge (Kapitel 4, verbindlich)

1. Grünen Ausgangsstand auf unverändertem `master@8e393ba` festhalten.
2. Nur die vier Testdateien schreiben, `COST_TRUING_BOOKING_ENABLED` in `BASE_ENV` ergänzen.
3. Rot fahren, wörtliche Fehlermeldungen protokollieren.
4. Jeden roten Fall zusätzlich isoliert fahren (vorbestehender ~12-%-Voll-Last-Flake).
5. Implementieren, `node --check` je Datei, volle Suite grün.
6. Smoke-Test am echten Prozess: Flag AUS = byte-identisches `usage`-JSON vor/nach Sweep; Flag AN + Pflicht-Menge gesetzt = sichtbare Wirkung.

---

## 2. Implementierungs-Zusammenfassung

Plan exakt umgesetzt auf Branch `phase/lct-p4-correction-booking` (Commit `3336806`, Basis `master@8e393ba`), nach Fix-Runde r1 auf `phase/lct-p4-correction-booking-fix1` (Commit `1b048a6`) überführt.

**Kern:** `state-ops.js` bekommt `convertProviderMicroToBucketCents` + `bookCostCorrectionCents` (0-Boden, Achsen-Asymmetrie: positive Korrekturen über `bookCents` auf beide Achsen, negative nur auf `costCents`) + `applyCostCorrectionCents` (Ist > Schätzung immer gebucht, Ist < Schätzung nur mit Vollständigkeitsbeweis). `defaults.js` bekommt `costCorrectionMicroCentsRem` (persistiert, im Unterschied zum ephemeren `costMicroCentsRem`) + `PROVIDER_RATE_SCALE` + `isCorrectionCents`. `cost-truing.js` verdrahtet den Flip hinter `COST_TRUING_BOOKING_ENABLED` (Default `false`) mit `refundProven`/`truedSourceOf`/`bookCorrectionFor`. Zwei Boot-Riegel: `providerRateOutOfBand` ist jetzt fatal (vorher WARN seit P2), `costTruingBookingFindings` (neu) verweigert den Start bei leerer Pflicht-Menge und warnt bei Deckung unter Schwelle. Store-Fassaden (`store.js`/`json.js`/`pg.js`) + Schema (`schema.sql`, neue Spalte `cost_correction_micro_cents_rem`) mit Wrapper-Parität.

**Testergebnis (final, nach Fix-Runde r1):** volle Suite **2781/2781 grün**, mehrfach reproduziert; ein vorbestehender ~12-%-Voll-Last-Flake in `telnyx-event-ingest-route.test.js` isoliert bestätigt grün und unabhängig von dieser Änderung.

### 2.1 Deviations (vom Implementierer selbst benannt)

1. **F2-02 in `test/provider-rate-guard.test.js` nicht angefasst**, obwohl der Plan sie als "Neu" bezeichnet: der bestehende Test erfüllte die geforderte Aussage (Gegenprobe `920000` ohne jedes Flag-Setup → `/healthz` 200, keine WARN, kein `COST_TRUING_BOOKING_ENABLED` im Log) bereits wortgetreu — bewusst nicht ohne inhaltliche Änderung neu geschrieben.
2. **`convertProviderMicroToBucketCents`**: der Plan gab nur Signatur + JSDoc vor (kein Rumpf-Snippet). Der im Kommentar selbst geforderte fail-closed-Riegel für `remMicro` außerhalb `[0, CORRECTION_DIVISOR)` wurde als Code ergänzt (eigener Guard), da der Plan-Kommentar dieses Verhalten explizit verlangt.
3. Zwei zusätzliche, über die Plan-Vorgabe hinausgehende Testfälle ergänzt (`isCorrectionCents(0)`/`isCorrectionCents(5)` im Prädikat-Test, ein Fall "beide Befunde können gemeinsam auftreten" im Guard-Unit-Test) — beide prüfen dokumentiertes Verhalten aus dem Plan selbst, keine Scope-Erweiterung der Implementierung.

**Bewusst nicht angefasst:** `src/billing/metering.js`, `src/outbound-gates.js`, `src/call-finish.js` (per `git diff --stat` bestätigt leer).

---

## 3. Rot-vor-Fix-Nachweis (wörtliche Fehlermeldung)

Vier Testdateien vollständig **vor** jeder Implementierungszeile geschrieben und gegen unveränderten `master@8e393ba` gefahren. Wortgetreue Fehlerklassen:

1. `test/usage-correction-booking.test.js` + `test/cost-truing-booking.test.js`:
   ```
   SyntaxError: The requested module '../src/store/state-ops.js' does not provide an export named 'applyCostCorrectionCents'
   ```
2. `test/cost-truing-booking-guard.test.js`:
   ```
   SyntaxError: The requested module '../src/boot-guard.js' does not provide an export named 'COST_TRUING_BOOKING_FINDING'
   ```
3. `test/provider-rate-guard.test.js` (F1-01):
   ```
   AssertionError [ERR_ASSERTION]: LCT P4: der Kurs bewegt jetzt Geld / false !== true
   ```
   (Guard lieferte noch `fatal:false`.)
4. `test/provider-rate-guard.test.js` (F2-01):
   ```
   Error: Server ist NICHT beendet (Boot-Refusal erwartet)
   ```
   (Timeout nach 8 s — Server bootete durch und loggte "Hermes Gateway laeuft".)

Alle vier Fälle zusätzlich **einzeln/isoliert** nachgefahren (`node --test <einzeldatei>` bzw. `--test-name-pattern`) und dort ebenfalls rot bestätigt — kein Fall hängt am 12-%-Voll-Last-Flake.

---

## 4. Tabelle der Rot-vor-Fix-Fälle (a)–(p)

| Fall | Beschreibung (Plan Kapitel 3) | Testdatei | Status |
|---|---|---|---|
| (a) | Ist > Schätzung, Records vollständig, Kurs 1e6 → Korrektur gebucht | `cost-truing-booking.test.js` | rot → grün |
| (b) | Records decken die Pflicht-Menge nicht ab → `'incomplete'`, keine Rückerstattung ("wichtigster Test des Plans") | `cost-truing-booking.test.js` | rot → grün |
| (c) | Ist > Schätzung bei Quelle `'incomplete'` → Asymmetrie in Gegenrichtung, trotzdem bedingungslos geheilt | `cost-truing-booking.test.js` | rot → grün |
| (d) | 0-Boden: `costCents` fällt nie unter 0 | `usage-correction-booking.test.js` | rot → grün |
| (e) | Achsen-Asymmetrie: negative Korrektur rührt `spendMonthCostCents`/`spendMonthKey` nicht an | `usage-correction-booking.test.js` | rot → grün |
| (f) | Kurs-Arithmetik + Rest-Übertrag, 200 × 400.000 Mikro-Cent @ 920000 | `usage-correction-booking.test.js` | rot → grün |
| (g) | Flag AUS → byte-identisch zu P3 (`costCents`, `spendMonthCostCents`, `costCorrectionMicroCentsRem`, `costTruedSource`) | `cost-truing-booking.test.js` (g-a/g-b/g-c) | rot → grün |
| (h) | Idempotenz: zweiter Sweep über denselben Call verändert nichts mehr | `cost-truing-booking.test.js` | rot → grün |
| (i) | Korrektur gegen persistierten `estimatedCostCents`, nicht gegen neu abgeleiteten Tarif | `cost-truing-booking.test.js` | rot → grün |
| (j) | Kurs-Arithmetik Gegenrechnung: `+26`, nicht `+30` | `usage-correction-booking.test.js` | rot → grün |
| (k) | Frei definierte Pflicht-Menge (kein geratener Enum-Name), Ist < Schätzung, Menge nicht abgedeckt | `cost-truing-booking.test.js` | rot → grün |
| (l) | Fehlender `estimatedCostCents` (Bestandszeile vor P2) → keine Korrektur, Quelle `'incomplete'` | `cost-truing-booking.test.js` | rot → grün |
| (m) | Leere Pflicht-Menge zur Laufzeit (Allquantor-Falle) → keine Rückerstattung | `cost-truing-booking.test.js` | rot → grün |
| (n) | Leere Pflicht-Menge am Boot → `exit(1)`, Gegenprobe mit gesetzter Menge → `/healthz` 200 | `cost-truing-booking-guard.test.js` | rot → grün |
| (o) | Kurs-Guard jetzt fatal (F1-01 Unit, F2-01 Spawn) | `provider-rate-guard.test.js` | rot → grün |
| (p) | Deckungs-WARN genau einmal bei Unterschreitung, keine WARN bei 5/5 bzw. bei Flag AUS | `cost-truing-booking-guard.test.js` | rot → grün |

Zusätzlich vier im Plan nicht einzeln gekennzeichnete, aber verbindlich verlangte Fälle: **"Rest bit-gleich"** (Rest nach verworfenem Lauf unverändert), **"Prädikate"** (`isBookableCents` unverändert, `isCorrectionCents` mit Vorzeichen/NaN/Infinity/Bruch), **"billedSec-Riegel"** (Records mit `billedSec:0` beweisen nichts) und **"Rest end-to-end"** (Rest-Fortschreibung über den vollen Sweep-Pfad) — alle implementiert und grün.

---

## 5. Die harten Zusagen der Phase (mit Beleg)

| # | Zusage | Status | Beleg |
|---|---|---|---|
| 1 | **Flag AUS → byte-identisch zu P3** | ✅ erfüllt | Fall (g): `costCents`, `spendMonthCostCents`, `costCorrectionMicroCentsRem`, `costTruedSource` deep-equal vor/nach Sweep bei `costTruingBookingEnabled:false`. Manueller Smoke-Test am echten Prozess bestätigt dasselbe live. |
| 2 | **Achsen-Asymmetrie** | ✅ erfüllt | `bookCostCorrectionCents`: positive Deltas laufen über `bookCents` (beide Achsen), negative schreiben **nur** `usage.costCents`. Fall (e): `spendMonthCostCents`/`spendMonthKey` nach negativer Korrektur bit-gleich. Begründung im Code: verhindert, dass eine verspätete Gutschrift aus einem abgeschlossenen Monat die Monatsdecke aufweitet. |
| 3 | **Rechnung gegen den persistierten Schätzbetrag** | ✅ erfüllt | `deltaCents = bucketCents - input.estimatedCostCents` — `estimatedCostCents` kommt vom Call (P2), nie neu aus Tarif rekonstruiert. Fall (i): Tarif zur Abgleichzeit auf 25 geändert, Korrektur bleibt gegen den bei Buchung gültigen Wert (6) berechnet → `−2`, nicht `−59`. |
| 4 | **Leere Pflicht-Menge fail-closed auf BEIDEN Pfaden** | ✅ erfüllt | Laufzeit (Fall m): `classifyRecords`-Länge-Prüfung verhindert, dass "jeder Typ vertreten" über der leeren Menge allquantifiziert wahr wird → `'incomplete'`. Boot (Fall n): `costTruingBookingFindings` liefert `fatal:true`, `assertCostTruingBooking` ruft `process.exit(1)` **vor** `rearmActiveCallTimers`. |
| 5 | **`isBookableCents` unverändert** | ✅ erfüllt | Funktionskörper laut Impl-Bericht byte-identisch (per `git diff` verifiziert, nur additive Nachbar-Definitionen). Eigenes Prädikat `isCorrectionCents` (Vorzeichen erlaubt) daneben eingeführt, kein Aufweichen des Bestandsriegels. Prädikat-Test pinnt `isBookableCents(-1) === false` weiterhin. |
| 6 | **0-Boden** | ✅ erfüllt | `bookCostCorrectionCents`: `usage.costCents = Math.max(0, usage.costCents + deltaCents)` bei negativem Delta. Fall (d): `costCents` fällt nicht unter 0. Dokumentierter Nebeneffekt: bricht die unabhängige Gegenprobe `spendMonthCostCents <= costCents` nach einem Clamp (Restrisiko 3, Abschnitt 8). |
| 7 | **`spendMonth` unberührt (bei negativer Korrektur)** | ✅ erfüllt | Direkte Folge der Achsen-Asymmetrie (Zusage 2). Fall (e) prüft explizit `spendMonthCostCents` **und** `spendMonthKey` bit-gleich. |
| 8 | **Rest alles-oder-nichts** | ✅ erfüllt | `convertProviderMicroToBucketCents` mutiert nichts (reine Funktion); `usage.costCorrectionMicroCentsRem` wird in `applyCostCorrectionCents` **ausschließlich** im `booked`-Zweig geschrieben. Fall (f): 200 × 400.000 Mikro-Cent @ 920000 → `costCents=73`, `costCorrectionMicroCentsRem=600.000.000.000` von Hand nachgerechnet (Kapitel 5). "Rest bit-gleich": Rest nach verworfenem Lauf identisch zum Kontrolllauf ohne diesen Lauf. |
| 9 | **Kurs-Guard FATAL** | ✅ erfüllt | `providerRateOutOfBand` liefert seit P4 `fatal:true` (vorher `fatal:false` seit P2). `assertProviderRateInBand` ruft `process.exit(1)`, **unkonditional**, an kein Flag gekoppelt (Fall o, F2-01 fährt ohne jedes Flag-Setup). |
| 10 | **Deckungs-Guard WARN** | ✅ erfüllt | `costTruingBookingFindings`: Deckung unter Schwelle → `fatal:false`, nur `console.warn`, kein `exit(1)`. Liest `costTruingCoveragePercent(store)` — dieselbe Quelle wie P3/Sweep-Ausgabe, keine zweite Rechnung (Fall p). |

---

## 6. Safety-Urteil (final)

**Verdikt: APPROVE.**

P4 erfüllt jedes Akzeptanzkriterium und jeden Rot-vor-Fix-Fall (a)–(p) des Plans. Die teuerste Fehlerklasse (Rückerstattung ohne beweisbar vollständige Datenlage) ist strukturell verriegelt: negative Korrektur nur bei `refundProven = (source===DETAIL_RECORDS UND billedSecTotal>0 UND isBookableCents(estimatedCostCents))`; Überschätzung wird bedingungslos geheilt. Allquantor-Falle über der leeren Pflicht-Menge fail-closed auf beiden Pfaden. Keine Safety-Gate-Aufweichung, keine Änderung an Offenlegungssatz/Auth, kein Secret-/PII-Leak in neuen Logs (Korrektur-Zeile trägt nur `call.id` + zwei Zahlen), keine neue Dependency.

**Unabhängige Test-Reproduktion:** JSON-Backend (Live-relevanter Default) 2781/2781 grün (79 s). PG-Backend-Vollsuite 2475: 2434 grün, 41 Fails — alle 41 sind `"[store] FATAL: pg-Backend nicht initialisierbar ... DB unerreichbar"` (kein lokaler Postgres im Review-Sandkasten), betreffen ausschließlich Spawn-/Import-Tests, die P4 nicht anfasst, und sind branch-unabhängig (identisch auf `master`). Die vier P4-Testdateien laufen unter PG explizit **37/37 grün**. `node --check` grün für alle geänderten Quelldateien, keine neue npm-Dependency.

### Handrechnung Währungsumrechnung (aus dem Safety-Review, Test (j) bestätigt)

> Ist 50 USD-ct = 50 × 1e6 = 5e7 Mikro-Cent. `increment = actualCostMicroCents × rate = 5e7 × 920000 = 4,6e13`. `DIVISOR = MICRO_CENTS_PER_CENT × PROVIDER_RATE_SCALE = 1e6 × 1e6 = 1e12`. `bucketCents = floor(4,6e13 / 1e12) = 46` EUR-Cent (= 50 × 0,92), `remMicro = 4,6e13 mod 1e12 = 0`. `deltaCents = 46 − 20 = +26` (**nicht** +30). Die einzige Division steckt im gemeinsamen Carry-Idiom (`floor` + `modulo` teilen denselben Quotienten) — kein `"* rate / 1e6"`-Float-Zwischenschritt.

### Handrechnung Rest-Übertrag, Fall (f) (aus dem Plan, Kapitel 5, unabhängig nachvollzogen)

> Produkt je Lauf: `400.000 × 920.000 = 368.000.000.000` (0,368 Cent — unter einem Cent; ohne Übertrag fiele jede Korrektur auf 0, 73 Cent verschwänden systematisch). Summe über 200 Läufe: `200 × 3,68e11 = 7,36e13`. `7,36e13 / 1e12 = 73,6` → gebucht **73 Cent**, Rest **600.000.000.000** (= 0,6 Cent). Der schrittweise `floor` mit Übertrag ist identisch zum `floor` der Gesamtsumme. Größenordnung: `7,36e13` liegt zwei Zehnerpotenzen unter `Number.MAX_SAFE_INTEGER` (9,007e15).

### Concerns (nicht-blockierend, aus dem Safety-Review)

1. `convertProviderMicroToBucketCents` prüft **nicht** `Number.isSafeInteger` auf dem Produkt `actualCostMicroCents × providerToBucketRateMicro`, obwohl die Schwesterfunktion in `cost-calibration.js` genau diesen Guard trägt. Praktisch unerreichbar: ein Überlauf bräuchte Ist-Kosten > ~54 USD pro Call — durch `maxCallDurationS` und das Budget-Gate (`MAX_BUDGET_EUR`) faktisch nicht erreichbar; Plan hat die Größenordnung explizit geprüft.
2. `billedSecTotal > 0` ist Teil von `refundProven`, aber **nicht** von `costTruingCoveragePercent`/`truedSourceOf` — ein Call mit vollständiger Typ-Menge, aber `billedSec=0` zählt in der Deckungsquote als "proven", kann aber nie erstattet werden. Konservativ (Refund-Gate strenger als Coverage-Messung), kein Sicherheitsrisiko.
3. `cost-calibration.js` ändert sich (`MICRO_RATE_UNIT` → importiertes `PROVIDER_RATE_SCALE`) — reine Dedup, wertidentisch (1e6), Verhalten unverändert; liegt am Rand des P4-Scopes, aber durch die neue Konstantenquelle gerechtfertigt.

---

## 7. Clean-Code-Audit (final)

**Verdikt: PASS mit Auflagen.** Kein S1-Blocker (keine deaktivierten Sicherungen, keine Geld-als-Float, kein Datenverlust). Geld-Arithmetik durchgehend Ganzzahl, `CORRECTION_DIVISOR` zusammengesetzt aus benannten Konstanten (kein nacktes `1e12`), `PROVIDER_RATE_SCALE` zentral definiert und auch von `cost-calibration.js` übernommen (Duplizierung dort beseitigt). Fail-closed konsequent: `isCorrectionCents`/`isBookableCents` sauber getrennt, `discardCorruptWrite` loggt und verwirft alles-oder-nichts (per Test bewiesen: Bucket bit-identisch bei NaN/1.5/Infinity). Alle 82 einschlägigen Tests grün (inkl. echter PG-Spawn-Tests), `node --check` fehlerfrei, keine Umlaute in Kommentaren, keine toten Imports/Exporte, keine Magic Numbers ohne Konstante, keine Funktion über ~50 Zeilen, keine Verschachtelung > 3.

**s1 (Blocker):** keine.

**s2 (ein Fund):**
- **COLL-1** — `costTruedSource='incomplete'` bekommt seit P4 eine **zweite, unabhängige Bedeutung**: (a) Provider-Records tatsächlich unvollständig (klassisches P3-Verhalten) und (b) Provider-Records vollständig bewiesen, aber kein persistierter `estimatedCostCents` (z. B. Bestandszeile vor P2). `truedSourceOf()` überschreibt den persistierten Wert von `'telnyx_detail_records'` auf `'incomplete'`, wenn Buchung AN ist und der Schätzbetrag fehlt — unabhängig davon, ob die Records selbst vollständig waren. `costTruingCoveragePercent()` (unverändert seit P3) liest genau dieses Feld; ihr eigener Kommentar ("EINE Quelle der Vollständigkeits-Aussage, kein zweites Prädikat") ist dadurch nachweislich falsch geworden. Beleg: `trueOneCall()`/`countOutcome()` zählen den **rohen** `measured.source` (Call erscheint als "gemessen"), während `store.recordCallCostTruingResult()` den **abgewerteten** `truedSourceOf()`-Wert persistiert — derselbe Sweep-Lauf widerspricht sich damit in der eigenen Log-Zeilengruppe selbst. Demonstriert durch Fall (l) (`estimatedCostCents=null`, Records vollständig → `costTruedSource='incomplete'`), lief grün. Money-Pfad selbst ist **nicht** betroffen — `refundProven()` nutzt bewusst den rohen `measured.source`, nicht `truedSourceOf()` — deshalb S2 statt S1, aber derselbe Fehlertyp wie die aus P5 bekannte Kollisions-Klasse.

**s3 (zwei Funde, nicht-blockierend):**
- **COLL-2** — `applyCostCorrectionCents()`/`bookCostCorrectionCents()`: `booked:false` vereint zwei Ursachen ohne Unterscheidung im Rückgabewert — (a) "Rückerstattung nicht bewiesen" (`dataComplete:false`, gewollte Policy-Ablehnung) vs. (b) `isCorrectionCents(deltaCents)` schlägt fehl (NaN/Bruch/Infinity, echte Datenkorruption). `bookCorrectionFor()` loggt in beiden Fällen identisch `gebucht=false`; nur Fall (b) erzeugt zusätzlich einen separaten `console.error` über `discardCorruptWrite()`. Praktisch selten erreichbar (vorgelagerte Guards filtern `estimatedCostCents` und `providerToBucketRateMicro` bereits ab), deshalb S3, nicht S1/S2.
- `applyCostCorrectionCents(s, tenantId, {...}, nowIso)` hat 4 Parameter (F1-Grenze) — folgt aber dem bereits im Bestand etablierten Muster `trackUsage(s, tenantId, tokens, cfg, nowIso)`, keine neue Abweichung.
- C4/Stil: `assertProviderRateInBand`/`assertCostTruingBooking` machen den Toleranzband-Guard jetzt **unkonditional** fatal, auch bei `COST_TRUING_BOOKING_ENABLED=false` — eine Ausnahme von der sonst durchgehaltenen Zusage "Flag AUS → byte-identisch/wirkungsfrei". Im Code klar begründet und testgepinnt (sonst nach P8-Flag-Entfernung lautlos tot); die Zusage sollte in `.env.example`/`render.yaml` präzisiert werden: gilt nur für die Buchung selbst, nicht für den Kurs-Guard.

**s4:** keine.

**collidingCodesOrStates (wörtlich aus dem Audit):**
1. `costTruedSource='incomplete'` (persistiert, gelesen von `costTruingCoveragePercent`) trägt seit P4 zwei unabhängige Bedeutungen unter einem Wert — siehe COLL-1.
2. `applyCostCorrectionCents()`/`bookCostCorrectionCents()`-Rückgabe `booked:false` vereint zwei Ursachen (Policy-Ablehnung vs. Datenkorruption) ohne Unterscheidung im Rückgabewert; nur die Korruptions-Ursache erzeugt zusätzlich einen separaten Log — siehe COLL-2.

**topTodos (für eine spätere Phase, nicht Bedingung für dieses PASS):**
- `costTruedSource`/`costTruingCoveragePercent` entflechten: fehlenden Schätzbetrag nicht über denselben Enum-Wert `'incomplete'` kodieren wie unvollständige Provider-Daten; Kommentar an `costTruingCoveragePercent` korrigieren.
- `applyCostCorrectionCents()`: `booked:false`-Ursache (Policy vs. Korruption) im Rückgabewert unterscheidbar machen.
- "Flag AUS → byte-identisch"-Formulierungen in `.env.example`/`render.yaml` präzisieren (gilt nicht für den jetzt unkonditional fatalen Kurs-Guard).

---

## 8. Fix-Runden

### Runde 1 (Commit `1b048a6`)

Alle drei aus der ersten Review-Runde gemeldeten Blocker behoben, minimal, kein Scope-Drift:

1. **S1 (Test-Lücke, verbindlich):** In `test/usage-correction-booking.test.js` zwei End-to-End-Discard-Tests ergänzt — `applyCostCorrectionCents`/`bookCostCorrectionCents` mit korruptem `deltaCents`/`estimatedCostCents` end-to-end getestet (Discard, Bucket bit-identisch, Log), analog zum Bestandsmuster `budget-nan-fail-closed.test.js`.
2. **G5 (Duplizierung):** `PROVIDER_RATE_SCALE` ist jetzt die eine Kurs-Skala-Quelle; `cost-calibration.js` importiert sie, statt `MICRO_RATE_UNIT` erneut zu deklarieren.
3. **G5 (Duplizierung):** gemeinsamer Helper `carryMicroRemainder` für das Mikro-Cent-Carry-Idiom, wiederverwendet in `trackUsage` **und** `convertProviderMicroToBucketCents` statt kopiert.

Danach: volle Suite **2781/0** grün, `node --check` ok, `node_modules` nicht committet, Dateien einzeln geaddet.

Die im finalen Safety-/Clean-Code-Review verbliebenen Funde (COLL-1, COLL-2, C4-Stil-Hinweis, die drei Safety-Concerns) sind ausdrücklich **nicht blockierend** (`blocker:false`) und wurden als `topTodos` für eine spätere Phase festgehalten — keine weitere Fix-Runde war Bedingung für das PASS.

---

## 9. VOR DEM DEPLOY ZU SETZEN

P4 fügt **eine** neue Pflicht-Variable hinzu (`COST_TRUING_BOOKING_ENABLED`) und verschärft das Verhalten von **zwei** bestehenden Variablen (Kurs-Guard jetzt fatal statt WARN; Deckungs-Guard aus P3 bekommt eine zweite, jetzt scharfe Konsequenz). Werte unten sind die auf dem Phasen-Branch (`phase/lct-p4-correction-booking-fix1`) ausgelieferten `render.yaml`-Defaults — vor dem eigentlichen Umlegen des Flips im Render-Dashboard gegenprüfen, da `render.yaml` dort nicht automatisch die Wahrheit ist (Dashboard-Werte können abweichen).

| Variable | Neu/geändert in P4? | Ausgelieferter Default (`render.yaml`/`.env.example`) | Bedeutung / Aktion vor dem Flip |
|---|---|---|---|
| **`COST_TRUING_BOOKING_ENABLED`** | **Ja, neu** | `"false"` | **Der Flip-Schalter dieser Phase.** `false` = Korrekturbuchung wirkungsfrei, byte-identisch zu P3 (Beleg: Fall g). Erst auf `true` setzen, **nachdem** die drei folgenden Vorbedingungen (V1–V3) erfüllt sind. Laut Plan ist das Flag befristet: Entfernung erst in P8, nach einem vollen Abrechnungsmonat mit Flag AN ohne Drift-Alarm. |
| **`COST_TRUING_REQUIRED_RECORD_TYPES`** | **Kritischste Vorbedingung (V2)** | leer (`""`) — Stand P3-Report unverändert | **Muss vor dem Flip aus echten Live-API-Antworten befüllt sein.** Solange die Menge leer bleibt, verweigert der neue Boot-Guard (`costTruingBookingFindings`, Fall n) den Start **fatal** (`exit(1)`), sobald `COST_TRUING_BOOKING_ENABLED=true` gesetzt wird — bewusst so (Allquantor-Falle über der leeren Menge: "jeder Typ ist vertreten" wäre sonst leer-wahr und erstattete jede Schätzung). Aus dem P3-Report dokumentierte Kandidaten (Live-Messung 2026-07-20): `sip-trunking, call-control, speech-to-text, text-to-speech, recording, inference, ai-voice-assistant` (Typ `call` existiert **nicht**) — vor dem Flip gegen den dann aktuellen Live-Beleg erneut verifizieren, nicht blind übernehmen. |
| **`COST_TRUING_MIN_COVERAGE_PERCENT`** | Bestand (P3), Konsequenz seit P4 schärfer sichtbar | `"80"` | Vorbedingung V3. Unter dieser Schwelle bleibt der Boot-Guard **nicht fatal** (nur WARN, Fall p) — der Deploy geht durch, aber der Sweep-Log meldet `coverage_below_threshold` bei jedem Lauf. Laut Plan **nie senken**, um eine Vorbedingung künstlich zu erfüllen. |
| **`PROVIDER_TO_BUCKET_RATE_MICRO`** | Bestand (P2), Boot-Verhalten seit P4 geändert | `"920000"` | Der Umrechnungskurs USD-Mikro-Cent → EUR-Bucket-Cent. **Seit P4 unkonditional fatal am Boot** (`assertProviderRateInBand`, Fall o) — vorher (P2/P3) nur WARN, weil der Kurs damals keinen Verbraucher hatte. Ein Zehnerpotenz-Vertipper (z. B. `920` statt `920000`) verweigert jetzt jeden Start, **unabhängig vom Stand von `COST_TRUING_BOOKING_ENABLED`**. Vor jeder Änderung dieses Werts: Wert exakt gegenprüfen, kein Deploy "auf Verdacht". |
| **`PLATFORM_ALERT_SMS_TO`** | Bestand (P5), von P4 nicht verändert, aber Teil derselben Vorbedingungskette (V5) | laut letztem P5-Report leer (`""`) — **vor dem Flip erneut im Dashboard prüfen** | Die Zielnummer für Plattform-Spend-Frühwarnung **und** Tarif-Drift-SMS aus P5. Solange dieser Wert leer bleibt, geht bei einer Fehlkalibrierung, die P4 unentdeckt durchrutschen lässt (Restrisiko 4 aus dem Plan-Pre-Mortem: "Provider-Bug mit systematisch zu niedrigen, vollständig aussehenden Records"), **keine SMS an einen Menschen** — nur ein Audit-Log-Eintrag. P5 selbst bootet damit weiterhin (nur WARN), aber V5 verlangt für P4 ausdrücklich einen **besetzten** Kanal, bevor der Flip umgelegt wird — der P4-Plan macht daraus keinen eigenen Boot-Guard, sondern eine explizite Betriebs-Vorbedingung. |

**Reihenfolge vor dem Umlegen (aus Plan-Kapitel 0, V1–V5, verbindlich):**

1. Fall A vs. Fall B (Nebenkosten-Vollständigkeit) am aktuellen Live-Beleg bestätigen — P4 ist als Fall A gebaut.
2. `COST_TRUING_REQUIRED_RECORD_TYPES` aus einem frischen Live-Beleg setzen (nicht die P3-Kandidatenliste blind übernehmen).
3. Nach einer Beobachtungsperiode: `COST_TRUING_MIN_COVERAGE_PERCENT` (80) tatsächlich erreichen — ablesbar am Sweep-Log/`coverage_below_threshold`.
4. `PLATFORM_ALERT_SMS_TO` besetzen.
5. Sicherstellen, dass PLAN-BUDGET-AXES P7 **nicht** im selben Deploy live geht.
6. Erst dann `COST_TRUING_BOOKING_ENABLED=true` setzen — und danach `PROVIDER_TO_BUCKET_RATE_MICRO` als unveränderlich behandeln, da jede künftige Änderung jetzt fatal boot-geprüft wird.

Kein Tarif-, Gate- oder Budget-Wert außerhalb der oben genannten fünf Variablen wurde durch P4 verändert.

---

## 10. Deterministisch geprüftes Ergebnis (Zusammenfassung)

- `npm test` grün, **2781/2781** (JSON-Backend, unabhängig reproduziert nach Fix-Runde r1).
- PG-Backend: 2434/2475 grün, alle 41 Fails reine `DB unerreichbar`-Spawn-Fehler (kein lokaler Postgres im Review-Sandkasten), branch-unabhängig; die vier P4-Testdateien laufen unter PG explizit 37/37 grün.
- `node --check` fehlerfrei für alle 17 geänderten/neuen `.js`-Dateien.
- `git diff --stat` bestätigt: `src/billing/metering.js`, `src/outbound-gates.js`, `src/call-finish.js` unangetastet.
- Manueller Smoke-Test am echten Prozess: Flag AUS bootet ohne neue Warnungen, `usage`-JSON vor/nach Sweep-Endpoint byte-identisch; Flag AN mit gesetzter Pflicht-Menge bootet mit sichtbarer Deckungs-WARN; Flag AN mit leerer Pflicht-Menge verweigert den Start (`exit 1`) mit der erwarteten Meldung.
- Keine neue npm-Dependency (`package.json`/Lockfile unverändert).
- Keine PII in neuen Log-/Audit-Zeilen (Korrektur-Zeile trägt nur `call.id` + zwei Beträge, keine Rufnummer, kein Tenant-Klarname).
