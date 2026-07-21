# Phase KE-P4 — Drossel am gemessenen UTC-Minutenfenster

- **Gate:** PASS
- **finalBranch:** `phase/ke-p4-drossel-fix2`
- **Basis:** `master`

---

## 1. Was geändert wurde

**Neue Dateien:**
- `src/telephony/adapters/telnyx/rate-limit.js` — `createMinuteWindowThrottle({ budget, now, sleep })`: Drossel am FIXEN UTC-Minutenfenster (`Math.floor(now / 60_000) * 60_000`), kennt kein HTTP, kein Telnyx-Feld, keine `config`; Uhr und Warten injizierbar (Produktions-Default: echte Uhr, echter Timer ohne `unref()`). Zwei Methoden: `reserveSlot()` (reserviert genau eine Anfrage, wartet höchstens einmal bis zur nächsten vollen Minute, wenn das Budget im Fenster erschöpft ist) und `waitForWindowReset(hintMs)` (Nachlauf nach einer Kontingent-Ablehnung, deckelt einen Provider-Hinweis auf höchstens ein Fenster). Budget muss positive Ganzzahl sein, sonst Wurf beim Modulladen (keine abgeschaltete Sicherung).
- `test/telnyx-cost-throttle.test.js` — 7 reine Offline-Unit-Tests der Drossel (P4-T1…P4-T7), kein Netz, kein echter Timer.
- `test/fake-clock.js` (im Fix r1 nachgezogen) — gemeinsamer Sprung-Uhr-Helfer (`jumpClock`), ersetzt zwei byte-identische Kopien in den beiden Testdateien.

**Geänderte Dateien:**
- `src/telephony/adapters/telnyx/voice.js`:
  - Neue Konstanten `DETAIL_RECORDS_LIMIT_PER_MINUTE=40`, `DETAIL_RECORDS_RESERVE_PER_MINUTE=10`, `DETAIL_RECORDS_BUDGET_PER_MINUTE=30`, `RATE_LIMITED_STATUS=429`, `RATE_LIMIT_RESET_HEADER="x-ratelimit-reset"`, `MS_PER_SECOND`, jeweils mit Mess-/Herleitungskommentar (Plan F1, 2026-07-21, `/v2/detail_records`).
  - Modul-globale, prozessweite Drossel `detailRecordsThrottle = createMinuteWindowThrottle({ budget: DETAIL_RECORDS_BUDGET_PER_MINUTE })` — gilt ausschließlich für den Belegabruf, nicht für Origination/Assistant-Start/speak/Nummernkauf.
  - `fetchCostRecordPage(recordType, pageNumber)` in zwei Funktionen aufgeteilt: `attemptCostRecordPage(recordType, pageNumber, throttle)` (ein HTTP-Versuch, reserviert vorher einen Drossel-Slot, liest `x-ratelimit-reset` **vor** `assertTelnyxOk` aus dem Response-Header, weil die Antwort nach dem Wurf nicht mehr erreichbar ist) und `fetchCostRecordPage(recordType, pageNumber, throttle)` (genau EINE Wiederholung nach 429, danach fail-closed `{ok:false, reason:"provider_error"}` — bewusst keine Wiederholungsschleife gegen ein Kontingent).
  - `throttle` als Bucket-Brigade-Parameter durch `fetchRecordTypePages` und `fetchAllCostRecords` durchgereicht.
  - Port-Methode `fetchCostRecordPool({ since, throttle = detailRecordsThrottle } = {})`: `throttle` ist Konstruktions-Parameter mit Produktions-Default (Muster `src/llm.js`); der einzige produktive Aufrufer `cost-truing.js` ruft weiterhin argumentlos auf und bekommt damit immer die echte Drossel.
  - Kommentar-Referenz in `parseSinceMs` von `fetchCostRecordPage` auf `attemptCostRecordPage` nachgezogen.
  - Fix r2: `DETAIL_RECORDS_LIMIT_PER_MINUTE`, `DETAIL_RECORDS_RESERVE_PER_MINUTE`, `DETAIL_RECORDS_BUDGET_PER_MINUTE` zusätzlich exportiert (rein additiv). *(Quelle bricht an dieser Stelle wörtlich ab: „... exportiert (rein additiv, keine" — der Rest des Fix-r2-Eintrags liegt nicht vor.)*
- `src/telephony/ports.js` — nur JSDoc: `throttle`-Property am Typedef `VoiceCostRecordPoolParams` dokumentiert (Default = prozessweite Drossel, produktive Aufrufer setzen sie nie), Hinweis ergänzt, dass der Abruf gedrosselt ist und bis zur nächsten vollen Minute blockieren kann. Kein Verhalten geändert.
- `test/telnyx-cost-records.test.js`:
  - `testThrottle`/`fetchPool`-Injektion eingeführt, alle 10 direkten `fetchCostRecordPool(...)`-Aufrufstellen auf `fetchPool(...)` umgestellt (Assertions unverändert).
  - `stubFetchPages` bekommt optionale Uhr (`atMs` je Call), `stubFetchFailure` bekommt Header (`Headers`-Objekt) — faithful double, weil eine echte Antwort immer Header trägt.
  - Bestandstest „429 loggt Provider-Status und Telnyx-Code" bewusst verhaltensgeändert auf `ATTEMPTS_PER_RATE_LIMITED_PAGE=2` (429 wird jetzt genau einmal wiederholt, also zwei Log-Zeilen statt einer).
  - 3 neue Tests: (P4-1) Budget/Fenstergrenze + kein Belegverlust, (P4-2) 429-Retry mit Provider-Hinweis, (P4-3) 429-Retry ohne Header (eigene Uhr).
  - Laut Safety-Review zusätzlich (P4-R1/P4-R2, Fix r2): pinnen die reale exportierte Produktionskonstante und die modul-globale Default-Drossel (via `node:test`-Mock-Timer statt Wanduhr), statt nur eine test-lokale Kopie zu spiegeln.

**Unangetastet:** `src/billing/cost-truing.js`, `config.js`, `.env.example`, `render.yaml`, `test/helpers.js` (keine neue Env-Variable), die Zuordnungslogik (`anchoredSessionIds`, `assignmentOutcome`, `toCostRecord`, `matchesAnchor`, `withinRecordWindow`, `logCostRecordsOk`, `formatAssignmentRoutes`) und alle `via_`-Zähler.

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl:**
```
NODE_ENV=test node --test test/telnyx-cost-throttle.test.js test/telnyx-cost-records.test.js
```
(ausgeführt NACH Schritt 1 — neues Modul + Drossel-Tests — und Schritt 2 — Testdatei-Änderungen aus Plan §4.2 —, aber VOR den `voice.js`/`ports.js`-Edits aus Plan §2/§3)

**Wörtliche Ausgabe:**
```
tests 78 / pass 74 / fail 4

Fehlschlaege (woertlich):

✖ Belegabruf: 429 loggt Provider-Status und Telnyx-Code (Fehlerpfad sichtbar)
  AssertionError: Expected values to be strictly deep-equal:
  actual:   [ '[telnyx/voice] getVoiceCostRecords fehler typ=sip-trunking status=429 code=10011' ]
  expected: [ '...typ=sip-trunking status=429 code=10011', '...typ=sip-trunking status=429 code=10011' ]
  (nur EIN Log-Eintrag statt der geforderten ZWEI - keine Wiederholung nach 429)

✖ (P4-1) hoechstens 30 Anfragen je fixem UTC-Minutenfenster - und kein Beleg geht verloren
  AssertionError: kein Fenster ueber dem Budget (gesehen: 36)
  actual: false, expected: true
  (alle 36 Anfragen liefen ungebremst in einem einzigen simulierten Minutenfenster)

✖ (P4-2) 429 -> GENAU ein Wiederholungsversuch mit dem Wartehinweis des Providers, danach ok:false
  AssertionError: ein Versuch + genau eine Wiederholung
  1 !== 2
  (keine Wiederholung nach 429 - fetchCostRecordPool ignorierte den throttle-Parameter komplett)

✖ (P4-3) 429 ohne x-ratelimit-reset -> Wartezeit bis zur naechsten vollen Minute aus der eigenen Uhr
  AssertionError: Expected values to be strictly equal: 0 !== 30000
  (keine Wartezeit, da kein Wiederholungsversuch stattfand)

Exakt die vier vom Plan (Abschnitt 6, "ROT") vorhergesagten Fehlschlaege - Anzahl und Ursache stimmen ueberein.
```

---

## 3. Der grüne Lauf danach + Suite-Zahl

**Zielgerichtet (nach den `voice.js`/`ports.js`-Edits):**
```
NODE_ENV=test node --test test/telnyx-cost-throttle.test.js test/telnyx-cost-records.test.js
tests 78 / pass 78 / fail 0
(7 neue Drossel-Tests + 68 Bestand + 3 neue P4-Tests)
```

**Volle Suite (IMPL, Stand `e853be7`):**
```
headCommit: e853be7bed69445674ca0f147e45da22591d4ad2
node --check: pass
npm test: tests 2899 / pass 2899 / fail 0
```
Laut IMPL ist die echte lokale Baseline auf `master d635f49` **2889** (nicht die im Auftrag genannte, laut IMPL leicht veraltete Referenz **2861/0**) — per separatem Worktree-Vergleich verifiziert. Die Zahl wächst in jedem Fall (2889 → 2899).

**Unabhängig im Safety-Review nachgemessen** (eigener Worktree, Branch `review-ke-p4-r2` = `phase/ke-p4-drossel-fix2`, HEAD `6b94183`):
- Lauf 1 `npm test`: tests 2901 / pass 2900 / fail 1. Roter Test: `T-P3-12` in `test/boot-failclosed.test.js` (404 !== 200) — bekannter Seed-vor-Boot-Race (Flake-Protokoll). Isoliert: `node --test test/boot-failclosed.test.js` → 11/11 grün. Kein Test angefasst.
- Lauf 2 `npm test` (Arbeitskopie sauber): tests 2901 / pass 2901 / fail 0 / duration 82 s. Referenz 2861 → +40, nur gewachsen.
- Isoliert: `node --test test/telnyx-cost-throttle.test.js test/telnyx-cost-records.test.js` → 80/80.

---

## 4. Abnahmekriterium der Phase mit Beleg

Spec KE-P4 grün-Kriterium: „Test mit injizierter Uhr: 100 angeforderte Seiten → höchstens 30 fetch je simulierter Minute; ein 429-Fixture → genau ein Wiederholungsversuch, danach ok:false." Die Plan-Umsetzung nutzt 36 statt 100 angeforderte Seiten — bewusst unter der Seitenobergrenze `MAX_PAGES_PER_RECORD_TYPE=10` (Plan §4.2(e)) —, beweist aber denselben Sachverhalt: mehr als das Budget, deutlich unter der Obergrenze.

**Befehl:**
```
NODE_ENV=test node --test --test-name-pattern="P4-1|P4-2|P4-3" test/telnyx-cost-records.test.js
```

**Ausgabe:**
```
✔ (P4-1) hoechstens 30 Anfragen je fixem UTC-Minutenfenster - und kein Beleg geht verloren (2.64ms)
✔ (P4-2) 429 -> GENAU ein Wiederholungsversuch mit dem Wartehinweis des Providers, danach ok:false (0.46ms)
✔ (P4-3) 429 ohne x-ratelimit-reset -> Wartezeit bis zur naechsten vollen Minute aus der eigenen Uhr (0.09ms)
tests 3 / pass 3 / fail 0
```

**Beleg im Detail:**
- (P4-1): 36 angeforderte Seiten verteilen sich exakt auf `[30, 6]` Anfragen je simuliertem Minutenfenster (`perMinute` deepEqual `[BUDGET_PER_MINUTE, THROTTLE_REQUEST_COUNT-BUDGET_PER_MINUTE]`), die Pause endet exakt auf einer `:00`-Grenze (`clock.now()%60000===0`, beweist FIX statt gleitend), und alle 1800 Belege (inkl. aller 36 Null-Zwillinge) kommen im Pool an — die Drossel bremst, verliert aber nichts.
- (P4-2)/(P4-3): ein 429 löst GENAU EINEN Wiederholungsversuch aus (`calls.length===2`, dieselbe Seite wird erneut angefordert, kein Beleg wird übersprungen), die Wartezeit kommt aus `x-ratelimit-reset` (17 s) bzw. mangels Header aus der eigenen Uhr (30 s bis `:00`), danach steht `ok:false`/`reason:"provider_error"` — keine Wiederholungsschleife.

---

## 5. Safety-Urteil, Clean-Code-Audit, Fix-Runden, offene Punkte/Deviations

### Safety-Urteil

**Verdikt: FREIGABE (`approved: true`).**

- `testsPassIndependently: true` (testPassCount 2901), `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `moneyPathFailClosed: true`, `fixturesHonest: true`, `redBeforeGreenProven: true`, `noGuessedQueryParam: true`, `scopeRespected: true`, `behaviorAsIntended: true`. **Blockers: keine.**
- **Geldpfad** (selbst nachgelesen, nicht nur diffgelesen): `anchoredSessionIds`, `assignmentOutcome`, `toCostRecord`, `matchesAnchor`, `recordSessionRefs`, `withinRecordWindow`, `logCostRecordsOk`, `formatAssignmentRoutes` tragen keinen einzigen Diff-Hunk — die Zuordnung ist nur verschoben, nicht verändert. Fehlerpfad liefert unverändert `{ok:false, reason:"provider_error"}`; (P4-2) pinnt zusätzlich `pool.raw === undefined` („ok:false ist NIE die leere Menge"). `bookablePool` in `cost-truing.js` unberührt. Der produktive Aufrufer `control.fetchCostRecordPool()` übergibt kein `throttle`-Argument und greift also immer auf die produktive Drossel — seit Runde 2 durch (P4-R2) getestet.
- **429-Wiederholung:** genau EINE, danach fail-closed. Keine Wiederholungsschleife; der erste endgültig gescheiterte Seitenabruf bricht Typ UND Pool ab (`fetchRecordTypePages` → `fetchAllCostRecords`) — höchstens EIN Wartevorgang je Sweep aus dem 429-Pfad. Wartehinweis wird VOR `assertTelnyxOk` gelesen, über denselben strengen `parseNonNegativeInteger` geparst, auf [0, 60 s] gedeckelt (P4-T6).
- **Query:** keine einzige geänderte Zeile. `grep filter[` über die Telnyx-Adapter zeigt auf `/v2/detail_records` ausschließlich `filter[record_type]` (+ `page[size]`, `page[number]`); weitere Treffer liegen in `numbers.js` an einem anderen Endpunkt. (P3-10) pinnt das weiter.
- **Secrets/PII:** keine neue Log-Zeile, Header-Wert wird nie geloggt (nur zur Wartezeit verrechnet), `logCostRecordsFailure` unverändert. Kein Netz, kein echter Anruf, kein schreibender Telnyx-Aufruf, kein Deploy, keine Render-Env-Änderung.
- **Gates/Disclosure/Auth:** Diff berührt keine Zeile mit Offenlegung, Denylist/Land/Stundenlimit, `MAX_BUDGET`, `safeEqual`, Signaturprüfung oder Auth-Middleware (gezielt gegrept, 0 Treffer). Drossel gilt ausdrücklich nur für den Belegabruf — Origination, Assistant-Start, speak, Nummernkauf laufen NICHT durch sie.
- **Scope:** 6 Dateien (`rate-limit.js` neu, `voice.js`, `ports.js`-JSDoc, `fake-clock.js` neu, 2 Testdateien). Keine neue npm-Dependency, keine neue Env-Variable → `config.js`, `.env.example`, `render.yaml`, `test/helpers.js` unberührt.
- **Mutationsproben** (jede einzeln, danach zurückgesetzt):
  - A) `RATE_LIMIT_RESET_HEADER` `"x-ratelimit-reset"` → `"retry-after"`: (P4-2) rot — Header-Feldname wirklich gepinnt.
  - B) `DETAIL_RECORDS_RESERVE_PER_MINUTE` 10 → 0: (P4-R1) und (P4-R2) rot.
  - C) `reserveSlot()` als No-op (Live-Zustand vor KE-P4): (P4-1), (P4-R2), (P4-T2), (P4-T3) rot — auch die modul-globale, produktiv verdrahtete Drossel.
  - D) Wiederholung nach 429 entfernt: (P4-2), (P4-3) und der KE-P0-429-Log-Test rot.
  - E) Köder-Gegenprobe `ANCHOR_ID_FIELD` `"call_control_id"` → `"telnyx_leg_id"`: 13 Zuordnungstests rot.
- **ROT-VOR-GRÜN selbst erzeugt** (kein `git stash` — `git checkout master -- src/telephony/adapters/telnyx/voice.js`): 6 Tests fallen (5 neu + 1 angepasst: (P4-1), (P4-2), (P4-3), (P4-R1), (P4-R2), „Belegabruf: 429 loggt Provider-Status und Telnyx-Code"), 67 pass / 6 fail. Danach zurückgesetzt.
- `node --check` auf alle 5 geänderten/neuen JS-Dateien grün. eslint/prettier nicht ausführbar (`@eslint/js` fehlt im `node_modules` des Repos, auch auf `master` so) — kein Lint-Nachweis.

**Concerns (nicht blockierend, alle in der sicheren Richtung — rot statt still grün):**
1. Überzogene Köder-Behauptung im Kommentar zu `throttledPages` in (P4-1): behauptet, falsche Verwendung von `telnyx_leg_id`/`call_leg_id` mache die Erwartungen falsch — gemessen falsch, Mutation E lässt (P4-1) grün, weil (P4-1) keine Zuordnung ausführt. Die echte Köder-Wirkung sitzt im KE-P2-Äquivalenztest, der unter Mutation E rot wird. Fixture-Daten selbst ehrlich; Satz sollte korrigiert werden, weil genau diese Kommentarklasse die Kette laut Safety-Review „zweimal getötet" hat.
2. Erfundenes Feld in der (P4-1)-Fixture: `extraFields: { call_sec: 60 }` auf allen 6 zuordenbaren Typen gelegt, obwohl Spec A1 `call_sec` nur in der sip-trunking-Familie belegt. Folgenlos (Code liest es nirgends), verstößt aber gegen A2 „nichts hinzuerfinden".
3. Inkohärente `meta` in der (P4-R2)-Fixture `wiringPages`: `page_size 50` und `total_results = pageCount*50`, jede Seite trägt aber genau 1 Record — kann Telnyx nie liefern. Im Kommentar offen als „Seiten NUR für die Drossel-Mechanik" benannt; Inkohärenz wirkt nur fail-safe.
4. Flake-Risiko in (P4-R2): mockt nur `setTimeout`, `Date.now` bleibt real — die modul-globale Drossel hängt am echten UTC-Minutenfenster. Kreuzt die reale Minutengrenze während der ~30 gestubbten fetches (grob 1e-5 Wahrscheinlichkeit), fällt `assert calls.length === 30`. Sehr klein, sichere Richtung, aber neuer wanduhr-abhängiger Test in einer Suite mit bereits einem Voll-Last-Flake.
5. Sweep-Dauer/Timer-Haftung: `timerSleep` setzt bewusst kein `unref()`. Ein Sweep kann jetzt 6 Typen × bis zu 10 Seiten = 60 Anfragen bei 30/min bedeuten, also ~1–2 min blockieren, plus im 429-Fall bis zu 60 s Nachlauf. `sweepRunning`-Riegel in `cost-truing.js` (Zeile 90/421-429) verhindert Überlappung — geprüft, Zusage stimmt. Bei SIGTERM/Deploy hält ein offener 60-s-Timer aber den Prozess — für die Deploy-Checkliste notieren.
6. Zeitversatz über die Seitenschleife (neu geweitet): Typen werden jetzt bis zu ~2 min auseinandergeholt. `sip-trunking` (Anker-Typ) läuft zuerst — ein erst danach eintreffender zweiter sip-trunking-Beleg fiele aus der Summe (fail-open-Richtung). Praktisch gedeckt durch `COST_TRUING_DELAY_MINUTES` (180, ab KE-P6B 30) gegen gemessene ≤133 s bis zur Wertrichtigkeit (Plan F3) — bei KE-P6B beim Absenken auf 30 min nochmal bewusst gegen die Drossel-Laufzeit rechnen.
7. Formatierung: `voice.js:540/541` überschreiten `printWidth 100` (`.prettierrc.json`). Kosmetik; kein Lint-Nachweis möglich (s.o.) — Sache des Clean-Code-Auditors.

**Empfehlung des Safety-Reviews:** der erste Concern (falsche Köder-Behauptung in P4-1) sollte vor dem Merge als Einzeiler im Kommentar korrigiert werden, blockiert die Phase aber nicht.

### Clean-Code-Audit (S1–S4)

- **S1:** keine.
- **S2:** keine.
- **S4:**
  1. `G5(minor)` · `test/telnyx-cost-throttle.test.js` + `test/telnyx-cost-records.test.js` · `throttleWith`/`testThrottle` sind ein trivialer 1-Zeilen-Wrapper um `createMinuteWindowThrottle({budget, now: clock.now, sleep: clock.sleep})`, strukturell fast identisch in beiden Dateien. Optional in `test/fake-clock.js` als gemeinsame `createThrottle(clock, budget)` bündeln; bei dieser Trivialität (1 Zeile, unterschiedliche Aufrufsignatur je Datei) vertretbar, so zu belassen (Vorrang Lesbarkeit).
  2. `T5(sehr gering)` · `src/telephony/adapters/telnyx/rate-limit.js` · der Guard `Number.isInteger(budget) && budget>=1` ist nur mit `budget=0` getestet (P4-T7), nicht mit negativem oder Float-Budget (z. B. -5, 2.5). Optional einen zweiten Grenzfall ergänzen; Risiko gering, da Codepfad identisch zu `budget=0`.

**Verdikt Clean-Code: PASS, kein Blocker.** S1 und S2 leer. Der Diff (`e853be7` + zwei Review-Fix-Runden, 6 Dateien, +493/-29) führt die Drossel für `/v2/detail_records` sauber ein: `rate-limit.js` ist eine unabhängige, injizierbare Einheit (Uhr+Timer als Parameter, P4/P15), `voice.js` verdrahtet sie mit Produktions-Default und wirft weiterhin nie (Port-Vertrag gehalten), `ports.js`-JSDoc ist aktuell. Alle neuen Konstanten (40/10/30, 429, 1000 ms) sind benannt, mit Mess-Provenienz kommentiert, keine Magic Numbers. Keine echten Umlaute, keine Datei:Zeile-Verweise, kein auskommentierter Code, keine abgeschalteten Sicherungen. Rate-Limit-Hint-Parsing nutzt den bestehenden strikten Parser (`parseNonNegativeInteger`) statt einer neuen Kopie (G5 vermieden). Konkurrenz ist explizit als eigene Verantwortlichkeit benannt und im Code durch strikt sequenzielle `for/await`-Schleifen abgesichert (keine `Promise.all` über Typen/Seiten) — der verbleibende Cross-Prozess-Fall ist als akzeptiertes Risiko mit Reserve-Puffer dokumentiert, nicht verschwiegen. Eigener Worktree-Merge + `npm test`: 2901/2901 grün, 0 fail, keine hängenden Tests. Der Runde-2-Fix hat einen echten D3-Fehler behoben: (P4-R1)/(P4-R2) pinnen jetzt die reale exportierte Produktionskonstante und die modul-globale Default-Drossel (via `node:test`-Mock-Timer statt Wanduhr), statt nur eine test-lokale Kopie zu spiegeln — genau die Lücke, die „Reserve 10→0" und eine wirkungslose Drossel bei grüner Suite unentdeckt gelassen hätte.

**passNotes (Clean-Code):**
1. Injizierbare Uhr/Timer statt echtem `setTimeout` in allen Mechanik-Tests (F.I.R.S.T. Fast/Repeatable) — nur EIN bewusster Mock-Timer-Test (P4-R2) für die Produktions-Verdrahtung, klar begründet.
2. Früherer G5-Verstoß aus Review-Runde 1 (zwei byte-identische `jumpClock`-Kopien) ist in fix2 behoben — `test/fake-clock.js` ist jetzt die eine Quelle, im Kommentar selbst dokumentiert.
3. Retry-Semantik ist bewusst GENAU EINMAL (kein Warteschleifen-gegen-Kontingent-Antipattern, das live 184/224 Anfragen verbrannt hat) und per Test belegt (P4-2/P4-3, `ATTEMPTS_PER_RATE_LIMITED_PAGE=2`).
4. Rückgabeformen bleiben unverändert kompatibel (`{ok,raw,lastPage}` bzw. `{ok:false,reason}`) — der Zwei-Feld-Umschlag `{page,rateLimit}` verlässt `attemptCostRecordPage` nie nach außen.
5. Fixtures nutzen weiterhin den Köder/Null-Zwilling-Mechanismus aus LCT-FIX-1 statt neuer, ungeprüft-plausibler Annahmen.
6. `config.js` bleibt unberührt — Provider-gemessene Konstanten (40/10) folgen demselben Lokale-Konstante-Muster wie die bereits bestehenden `MAX_PAGES_PER_RECORD_TYPE`/`COST_RECORDS_PAGE_SIZE` in derselben Datei (G24 Konsistenz).

**topTodos (Clean-Code):**
1. Kein echter Blocker offen — optional: die beiden trivialen `throttleWith`/`testThrottle`-Wrapper in `fake-clock.js` bündeln, falls eine dritte Testdatei denselben Bedarf bekommt (S4).
2. Beobachten statt jetzt handeln: Cross-Prozess-Konkurrenz um dasselbe Telnyx-Kontingent (Plan U5, unbelegt) ist nur durch die 10er-Reserve abgefedert, nicht hart ausgeschlossen — relevant, sobald mehrere Sweep-Prozesse denselben Key nutzen.
3. Optional: `rate-limit.js`-Guard zusätzlich mit negativem/Float-Budget testen (identischer Codepfad wie `budget=0`, daher niedrige Priorität).

### Fix-Runden

- **r1:** Einziger gemeldeter Blocker (G5, S2 Duplizierung) behoben: die Sprung-Uhr (`jumpClock`) war in `test/telnyx-cost-throttle.test.js` und `test/telnyx-cost-records.test.js` byte-identisch dupliziert (nur der Default-Parametertyp unterschied sich, ISO-String vs. ms). Neuer geteilter Helper `test/fake-clock.js`.
- **r2:** Branch `phase/ke-p4-drossel-fix2` von `phase/ke-p4-drossel-fix1`, Fix-Commit `6b94183`. Behoben (S1, einziger genannter Blocker): `src/telephony/adapters/telnyx/voice.js` — `DETAIL_RECORDS_LIMIT_PER_MINUTE`, `DETAIL_RECORDS_RESERVE_PER_MINUTE`, `DETAIL_RECORDS_BUDGET_PER_MINUTE` exportiert (rein additiv, keine …). *(Die Quelle bricht an dieser Stelle wörtlich ab — der Rest des r2-Eintrags liegt nicht vor. Aus dem Clean-Code-Verdikt geht hervor, dass dieser Export den (P4-R1)/(P4-R2)-Tests erlaubt, die reale Produktionskonstante statt einer test-lokalen Kopie zu pinnen.)*

### Offene Punkte / Deviations

- `deviations: []` laut IMPL — keine gemeldeten Abweichungen vom Plan.
- Referenz-Suitezahl im Auftrag (2861/0) ist laut IMPL veraltet; die selbst gemessene Baseline auf `master d635f49` ist 2889/0. In jedem Fall gilt: die Zahl wächst (2889 → 2899 laut IMPL, 2901 laut unabhängigem Safety-Review-Lauf), `fail 0`.
- Aus dem Safety-Review als nicht-blockierend, aber vormerkenswert markiert (siehe Concerns oben): Köder-Kommentar in (P4-1) sollte vor Merge korrigiert werden; erfundenes `call_sec`-Feld in der (P4-1)-Fixture; inkohärente `meta` in (P4-R2)-Fixture `wiringPages`; sehr kleines Wanduhr-Flake-Risiko in (P4-R2); fehlendes `unref()` auf dem Sweep-Timer (Deploy-Checkliste); Zeitversatz über die Seitenschleife gegen `COST_TRUING_DELAY_MINUTES` bei KE-P6B nochmal rechnen; zwei Zeilen in `voice.js` über `printWidth 100` (kein Lint-Nachweis möglich, da `@eslint/js` im Repo fehlt).
- Aus dem Clean-Code-Audit als S4 (kein Blocker) offen: `throttleWith`/`testThrottle`-Duplikat optional bündeln; Guard-Test für negatives/Float-Budget optional ergänzen.
