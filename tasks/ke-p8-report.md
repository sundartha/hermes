# Phase KE-P8 — Bruchpunkt-Wächter

- **Gate:** PASS
- **finalBranch:** `phase/ke-p8-waechter`
- **Basis:** `master`
- **headCommit:** `93d3a2eb1931a98e11963ce716f2cefc0aa17bb3`

---

## 1. Was geändert wurde

Umfang laut Plan: **1 Produktionsdatei, 6 Stellen** (`src/billing/cost-truing.js`) + **1 Testdatei** (`test/cost-truing-observe.test.js`), sonst nichts. Kein Edit an `voice.js`, `ports.js`, `boot.js`, `config.js`, Store, Schema — keine neue Env-Variable, keine neue Dependency, kein `.env.example`/`render.yaml`/`BASE_ENV`-Edit. Geldpfad (`anchoredSessionIds`, `assignCostRecords`, `toCostRecord`, `via_`-Zähler, `bookablePool`, `refundProven`) und Query (`filter[record_type]`, `page[size]`, `page[number]`) unangetastet.

**`src/billing/cost-truing.js` — sechs Stellen, im Plan als Edit A–F bezeichnet:**

- **Edit A** — dritter Befund-Code in `COST_TRUING_FINDING`: `REQUESTS_ABOVE_THRESHOLD: "requests_above_threshold"`, mit Kommentar „dritter Code auf DEMSELBEN Kanal — kein eigener Alarmweg, keine SMS-Klasse (PM-7)".
- **Edit B** — neue benannte Konstante `SWEEP_REQUESTS_WARN_THRESHOLD = 1440`, mit vollständigem Herleitungs-Kommentar (36 Minuten reiner Abrufzeit bei gemessenen 40 Telnyx-Anfragen/Minutenfenster; bewusst **nicht** aus dem Telnyx-Adapter importiert — Billing kennt keinen Provider, DIP; bewusst **keine** Env-Variable — eine hochdrehbare Warnschwelle wäre die an ihre eigene Verletzung angepasste Sicherung).
- **Edit C** — der bestehende `emitFinding(code, coveragePercent, nowMs)` wird verallgemeinert zu `emitFinding(code, detail, nowMs)` (generischer Kanal: entprellen → `console.warn` → `audit`), und eine neue `emitCoverageFinding(code, coveragePercent, nowMs)` übernimmt die alte Deckungs-Formulierung. Das zusammengesetzte Log-/Audit-Format bleibt **byte-identisch**: `grund=<code> deckung=…% schwelle=…% sweeps=…`.
- **Edit D** — die zwei Bestands-Aufrufer in `reportCoverage` (`COVERAGE_BELOW_THRESHOLD`, `COVERAGE_STALLED`) rufen jetzt `emitCoverageFinding` statt `emitFinding`; Argumente unverändert.
- **Edit E** — neue Funktion `reportFetchVolume(fetchTally, nowMs)`, direkt unter `logSweepLine`: meldet, wenn `fetchTally.requests` die Schwelle überschreitet, über denselben `emitFinding`-Kanal (`detail = "anfragen=… schwelle=…"`). Keine zweite Log-Zeile, dieselbe Datenquelle (`fetchTally`) wie die Sweep-Zeile (`anfragen=`).
- **Edit F** — Aufruf im Sweep: `reportFetchVolume(fetchTally, nowMs);` direkt nach `logSweepLine(...)`, vor `reportCoverage(...)`.

**`test/cost-truing-observe.test.js`** — zwei neue Tests, angehängt hinter `(j3)`, keine neuen Helfer (Wiederverwendung von `fakeCostRecordAdapter`, `auditSpy`, `collectLogSpies`, `fakeMessaging`, `PII_PHONE`, Harness-Stubs):

- **(j4)** „1.500 Anfragen je Sweep → genau ein Befund je Entprellfenster (Log + Audit, keine SMS)": zwei Sweeps innerhalb des Entprellfensters (500 ms bei `costAlertDebounceMs: 1000`), Pool-Stub `{ ok: true, raw: [], complete: true, requests: 1500, pages: 30 }`. Prüft: genau ein Audit-Befund mit Detail `grund=requests_above_threshold anfragen=1500 schwelle=1440`, genau eine passende Log-Zeile, `messaging.calls.length === 0` (kein neuer Alarmweg), keine PII (`PII_PHONE`) im Detail.
- **(j5)** „1.440 Anfragen sind die Schwelle, erst 1.441 überschreiten sie": frische `makeCostTruing`-Instanz je Fall (eigene Entprell-Map), `requests: 1440` → 0 Befunde, `requests: 1441` → 1 Befund.

Gestubbt wird bewusst am **Port** (`VoiceCostRecordPool`, `raw: []`), nicht am Telnyx-Adapter — 1441 echte HTTP-Anfragen müssten sonst durch die Drossel (30/min), also durch ~48 simulierte Minuten. Dass `fetchTally.requests` echte HTTP-Anfragen zählt und keine zweite Buchhaltung ist, ist bereits unabhängig durch `(P6-8)` in `test/cost-truing-sweep-log.test.js` gegen den echten Adapter mit zählendem `fetch`-Stub gepinnt.

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl** (isoliert, ausgeführt VOR den Produktionscode-Edits A–F, direkt nach dem Anhängen der Tests j4/j5):

```
NODE_ENV=test node --test test/cost-truing-observe.test.js
```

**Wörtliche Ausgabe:**

```
✖ (j4) 1.500 Anfragen je Sweep -> genau ein Befund je Entprellfenster (Log + Audit, keine SMS)
  AssertionError [ERR_ASSERTION]: zwei Sweeps im Entprellfenster -> genau ein Befund
  0 !== 1
✖ (j5) 1.440 Anfragen sind die Schwelle, erst 1.441 ueberschreiten sie
  AssertionError [ERR_ASSERTION]: eine Anfrage darueber meldet
  0 !== 1
ℹ tests 25
ℹ pass 23
ℹ fail 2
```

„Exakt wie im Plan (Kap. 4) vorhergesagt." — die Planvorhersage lautete wörtlich `ℹ tests 25 / ℹ pass 23 / ℹ fail 2`, mit genau (j4) und (j5) als Fehlschläge.

Zusätzlich unabhängig vom Safety-Reviewer nachgestellt (kein `git stash`, sondern `git checkout master -- src/billing/cost-truing.js`): `node --test test/cost-truing-observe.test.js` → `25 tests / 23 pass / 2 fail`, deckungsgleich mit der Commit-Message; danach zurückgesetzt → `25/25`.

---

## 3. Der grüne Lauf danach

```
NODE_ENV=test node --test test/cost-truing-observe.test.js
→ ℹ tests 25 / ℹ pass 25 / ℹ fail 0
```

**Voll-Suite:**

- `testsPass: true`
- `testPassCount: 2932`, `testFailCount: 0`
- Referenz laut Auftrag: **2861/0** → gewachsen auf **2932/0** (Plan-Header nannte 2930 als selbst gemessenen Ausgangswert auf `master`=`fc6decc`; die Zahl ist um genau die 2 neuen Tests (j4/j5) gewachsen, Laufzeit 82,3 s).
- Vom Safety-Reviewer unabhängig in frischem Worktree bestätigt: `npm test` → `tests 2932 / pass 2932 / fail 0 / skipped 0`, Exit 0, 123 s, kein Flake-Fall aufgetreten.
- Vom Clean-Code-Auditor bestätigt: isoliert 25/25 grün inkl. j4/j5; volle Suite auf dem Phasen-Branch 2932/2932 grün; `master`-Baseline zum Vergleich 2929/2930 (der eine Fail ist der dokumentierte vorbestehende Voll-Last-Flake/Seed-vor-Boot-Race, nicht dieser Phase zuzurechnen).

---

## 4. Abnahmekriterium der Phase (mit Beleg)

Alle 6 Kriterien aus Plan Kap. 5 geprüft, ausgeführt **nach** den Edits:

1. **rot heute** (vor Edits, s. Abschnitt 2): `tests 25 / pass 23 / fail 2` (j4, j5 mit `0 !== 1`) — exakt getroffen.
2. **grün**: `NODE_ENV=test node --test test/cost-truing-observe.test.js` → `ℹ tests 25 / ℹ pass 25 / ℹ fail 0`.
3. **Syntax**: `node --check src/billing/cost-truing.js` → keine Ausgabe, Exit 0.
4. **Suite**: `npm test` (== `NODE_ENV=test node --test "test/*.test.js"`) → `ℹ tests 2932 / ℹ pass 2932 / ℹ fail 0` (Basis 2930/0 wie im Plan gemessen; Zahl gewachsen um genau die 2 neuen Tests, Laufzeit 82,3 s).
5. **Kanal-Beweis**: `grep -n "sendBootstrapAlertSms\|sendDriftAlertSms" src/billing/cost-truing.js` → genau 2 Treffer (Zeile 29 Import, Zeile 513–514 `sendDriftAlertSms`/dessen Aufruf des Imports) — unverändert 2, keiner im neuen `reportFetchVolume`-Pfad.
6. **Geldpfad-Beweis**: `git diff master --stat` → `src/billing/cost-truing.js | 62 +++++++++++++++++++++++++++-----` und `test/cost-truing-observe.test.js | 77 ++++++++++++++++++++++++++++++++++++++++`, genau 2 Dateien, 131 insertions(+), 8 deletions(-).

---

## 5. Safety-Urteil

**Verdikt: FREIGABE** (`approved: true`). Alle geprüften Flags positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`, `moneyPathFailClosed`, `fixturesHonest`, `redBeforeGreenProven`, `noGuessedQueryParam` — alle `true`. Keine Blocker.

Kernbegründung: `reportFetchVolume` liest **ausschließlich** `fetchTally.requests` und schreibt nichts — kein Store-Zugriff, keine Buchung, kein Einfluss auf `classifyRecords`/`refundProven`/`bookCorrectionFor`. `anchoredSessionIds`/`assignmentOutcome`/`toCostRecord` sind im Diff nicht einmal berührt (Telnyx-Adapter unverändert). Der `emitFinding`-Split ist eine reine Umformulierung — die Deckungs-Zeile ist per temporärem Vergleichstest (master vs. Branch, `deepEqual`) empirisch byte-identisch belegt (`'grund=coverage_below_threshold deckung=0% schwelle=80% sweeps=1'`). Der neue Code ist ein dritter Code auf demselben entprellten Kanal, eigener Debounce-Schlüssel, keine Kollision. Query unverändert (`grep 'filter\['` zeigt weiterhin nur `filter[record_type]` + `page[size]` + `page[number]` für `/v2/detail_records`). Fixtures honest: keine neue Provider-Beleg-Fixture, gestubbt wird am Port, `requests`/`pages` laut `ports.js:118-120` auf jeder Antwortform gesetzt. PII/Secrets: Befund trägt nur Zahlen, keine Rufnummer/Session-/Leg-ID/Key; (j4) assertiert das explizit gegen `PII_PHONE`.

**Unabhängige Verifikation (Safety-Reviewer, frischer Worktree, Branch `review-ke-p8`):** volle Suite 2932/2932/0, Exit 0, 123 s. Rot-vor-Grün selbst nachgestellt: `git checkout master -- src/billing/cost-truing.js` → `25 tests / 23 pass / 2 fail`, genau (j4) und (j5). Drei Mutationstests am Produktionscode (jeweils zurückgesetzt) bewiesen, dass die Tests wirklich beißen: (A) `fetchTally.requests` → `fetchTally.pages` lässt j4+j5 rot werden; (B) `<=` → `<` lässt j5 rot werden (Grenzfall 1440 gepinnt); (C) Entprellung ausgehebelt lässt j1+j4 rot werden. Setup-Falle dokumentiert: der vorgegebene `ln -s "./node_modules" node_modules` erzeugt einen Selbstverweis (ELOOP), erst nach Umbiegen auf den absoluten Pfad lief die Suite.

**Vier Concerns, keiner blockierend:**

1. **Erreichbarkeit (wichtigster Befund, kein Code-Defekt):** Der Wächter kann heute strukturell **nicht** feuern. `MAX_PAGES_PER_RECORD_TYPE=10` (`src/telephony/adapters/telnyx/voice.js:63`) × 6 `ASSIGNABLE_COST_RECORD_TYPES` = max. 60 Seiten je Sweep, plus höchstens eine 429-Wiederholung je Anfrage = Obergrenze ~120 Anfragen; nur Telnyx implementiert `fetchCostRecordPool`. Die Schwelle 1440 liegt eine Größenordnung darüber. Spec-konform (Spec KE-P8 fixiert 1440), aber: das operative Frühwarnsignal bei Wachstum bleibt weiterhin `vollstaendig=false` in der Sweep-Zeile (Seitenobergrenze → `complete:false` → keine Rückerstattung, also fail-closed, nicht still). Gehört in die Deploy-Checkliste/Folgephase: entweder Schwelle an die tatsächliche Obergrenze koppeln oder Wächter explizit als Platzhalter für eine später angehobene Seitenobergrenze dokumentieren.
2. **(j4) nicht-beißende Teilzusage:** `assert.equal(messaging.calls.length, 0, …)` ist eine nicht-beißende Zusage — `fakeConfig` setzt `platformAlertSmsTo:''`, `sendBootstrapAlertSms` bricht bereits am Empfänger-Riegel ab; hänge man SMS-Versand in `emitFinding`, bliebe der Test grün. Würde beißen mit `platformAlertSmsTo` gesetzt + `withBootstrapNumber(state)`. Die tragende Zusage der Phase (genau ein Befund, exakter `detail`-String) beißt dagegen nachweislich.
3. **Reihenfolge:** `reportFetchVolume(...)` läuft vor `reportCoverage(...)` (`cost-truing.js:588`). Wirft `audit()` im Volumen-Befund, entfällt zusätzlich die Deckungs-Meldung desselben Sweeps. Marginal (ein werfendes `audit()` brach den Sweep vorher an derselben Stelle ab), die risikoärmere Reihenfolge wäre hinter `reportCoverage`.
4. **Report-Ablage:** Kein `tasks/ke-p8-report.md` im Branch (P0–P6B haben je einen Report). Der Rot-Lauf war nur in der Commit-Message belegt — inhaltlich korrekt (selbst nachgestellt), aber die Ablage wich von der Kette ab. *(Mit diesem Dokument nachgezogen.)*

---

## 6. Clean-Code-Audit

**Verdikt: PASS — keine Blocker.**

- **s1:** keine Funde.
- **s2:** keine Funde.
- **s3:** keine Funde.
- **s4:** keine Funde.

Begründung: Diff (`src/billing/cost-truing.js` + `test/cost-truing-observe.test.js`) ist ein sauberer, minimaler KE-P8-Umbau: neuer Befund-Code `REQUESTS_ABOVE_THRESHOLD` auf demselben entprellten Kanal (`emitFinding`), keine neue SMS-Klasse (PM-7 eingehalten). Der bestehende `emitFinding` wurde von `coveragePercent` auf einen generischen `detail`-String verallgemeinert und in `emitCoverageFinding` (Deckungs-Format byte-identisch zum Bestand) + `reportFetchVolume` (neu) aufgeteilt — das reduziert Duplikation statt sie zu erzeugen (G5-konform, Template-Method-Stil).

Verifiziert, nicht nur gelesen: isoliert 25/25 grün inkl. j4/j5; volle Suite auf `phase/ke-p8-waechter` 2932/2932 grün, `master`-Baseline 2929/2930 (dokumentierter vorbestehender Flake, nicht diese Phase). Magic-Number-Check: `SWEEP_REQUESTS_WARN_THRESHOLD=1440` ist eine benannte Konstante mit Herleitungskommentar, gegen `PLAN-KOSTEN-ENDSPIEL.md` Kap. 3 (Betriebsschwelle = 36 min × 40 Anfragen) und gegen die echten Werte in `src/config.js` (Drossel-Budget 30/min, Sweep-Default 60 min) nachgerechnet und stimmig. Kommentare durchgehend ue/oe/ae-transliteriert, keine echten Umlaute (grep bestätigt 0 Treffer). Keine brüchigen Datei:Zeile-Verweise (Referenzen laufen über stabile Marker wie PM-6/PM-7/Plan-Kapitel). Kein toter/auskommentierter Code, keine neuen Imports/Dependencies, kein SMS-Versand im neuen Pfad (Test j4 prüft `messaging.calls.length===0` explizit), keine PII im neuen Befund-Detail (Test j4 prüft das explizit gegen `PII_PHONE`). Test j5 deckt exakt die Grenze (1440 kein Befund, 1441 ein Befund) mit frischer Entprell-Instanz je Fall.

**topTodos:** kein Blocker offen — Phase ist mergefähig. Optional/nicht blockierend: falls ein späteres Dashboard/Metrics den Schwellenwert braucht, müsste `SWEEP_REQUESTS_WARN_THRESHOLD` exportiert werden — aktuell bewusst modul-lokal und außerhalb des Phasen-Scopes, daher kein Fund.

---

## 7. Fix-Runden

**Keine.** Der Impl-Report weist `deviations: []` aus, Safety und Clean-Code kamen beide im ersten Durchlauf auf PASS/FREIGABE ohne Blocker — es waren keine Nachbesserungs-Runden nötig.

---

## 8. Offene Punkte / Deviations

- **Deviations laut Impl:** keine (`"deviations": []`), Dateien exakt wie im Plan vorgesehen (`src/billing/cost-truing.js` + `test/cost-truing-observe.test.js`, sonst nichts).
- **Offen aus den Safety-Concerns** (keiner blockierend, siehe Abschnitt 5 für Details):
  1. Erreichbarkeit der Schwelle 1440 unter der heutigen Seitenobergrenze (`MAX_PAGES_PER_RECORD_TYPE=10` × 6 Typen ≈ max. 120 Anfragen/Sweep) — gehört in Deploy-Checkliste/Folgephase.
  2. (j4)-SMS-Zusage ist mit der aktuellen Fixture-Konfiguration nicht-beißend (Empfänger-Riegel greift vor dem geprüften Pfad).
  3. Aufrufreihenfolge `reportFetchVolume` vor `reportCoverage` — risikoärmer wäre die umgekehrte Reihenfolge.
  4. Fehlender Phasenbericht im Branch zum Zeitpunkt der Reviews — mit diesem Dokument nachgezogen.
- **Aus dem Plan bewusst zurückgestellt** (Plan Kap. 6, keine Blocker dieser Phase):
  1. Schwelle als modul-lokale Konstante statt Env-Variable — Spec verlangt wörtlich „benannte Konstante mit dieser Herleitung im Kommentar"; eine Env-Variable hätte vier Stellen plus `config-namespaces`/`config-shape`-Tests berührt.
  2. Die gemessenen 40/min werden nicht aus `voice.js` importiert (Billing-Pfad bleibt provider-frei, DIP); ändert Telnyx sein Kontingent, muss 1440 von Hand neu hergeleitet werden.
  3. Die 6-h-Herleitung der Spec ist historisch (seit KE-P6B ist die Kadenz 1 h); die Zahl bleibt exakt wie in der Spec gepinnt, der Kommentar sagt beides ehrlich.
  4. Akzeptiertes Restrisiko: liefert ein Adapter kein `requests`-Feld, liest `nonNegativeCount` eine 0 und der Wächter schweigt (fail-open) — betrifft den Geldpfad nicht, dieselbe Eigenschaft wie das Sweep-Log seit P6.
  5. Nicht angefasst: Sweep-Rückgabewert (`(P5-S7)` pinnt die Schlüsselmenge), Sweep-Log-Format, `via_`-Zähler, Query-Parameter, Boot-Guard, `tasks/*DEPLOY-CHECKLIST.md` (KE-P7 ist Owner-Aktion, nicht Teil der Kette).
