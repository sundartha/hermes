# Phase KE-P2 — Abruf aus der Kandidatenschleife ziehen (Pool + assignCostRecords)

- **Gate:** PASS
- **finalBranch:** `phase/ke-p2-pool`
- **Basis:** `master` (echter Stand `d6a821a`, KE-P0 und KE-P1 bereits gemergt)
- **headCommit (Phase):** `f192087a40f7534d30f9570293569a7859c16138`

---

## 1. Was geändert wurde

Kernidee (D1 des Plans): Der Telnyx-Belegabruf ist **schleifeninvariant** (die Query kennt nur `filter[record_type]` + `page[size]`, kein `legId`, kein Zeitfenster) — er wurde deshalb aus der Buchungsschleife herausgezogen. `getVoiceCostRecords({legId, startedAt, endedAt})` ist in zwei Methoden aufgetrennt:

- **`fetchCostRecordPool()`** — holt die rohen Belege EINMAL je Sweep und Provider, vor der Kandidatenschleife.
- **`assignCostRecords(pool, {legId, startedAt, endedAt})`** — ordnet die Belege EINES Pools synchron (kein Netz-await) genau einem Call zu; die Zuordnungslogik selbst (`recordSessionRefs`, `matchesAnchor`, `anchoredSessionIds`, `assignmentOutcome`, `withinRecordWindow`, `toCostRecord`, `formatAssignmentRoutes`, `logCostRecordsOk`, `SESSION_ID_FIELDS`, `ANCHOR_ID_FIELD`, `RECORD_TIMESTAMP_FIELDS`) wurde **byte-identisch verschoben, nicht verändert** — einzige Änderung im Rumpf: `fetched.raw` → `pool.raw`.

**Geänderte Produktivdateien:**

- `src/telephony/adapters/telnyx/voice.js` — `fetchAllCostRecords()` liefert zusätzlich `complete: true`; `getVoiceCostRecords` ist ersetzt durch `fetchCostRecordPool()` + `assignCostRecords(pool, params)`. Das Log-/Op-Token bleibt bewusst `getVoiceCostRecords` (drei String-Literale: `"getVoiceCostRecords ok"`, `"getVoiceCostRecords fehler"`, `assertTelnyxOk(res, "getVoiceCostRecords", …)`) — Begründung: an dieser Zeichenkette hängen die laufende Beobachtung der Session-Invariante und die Live-Abnahme (`tasks/lct-DEPLOY-CHECKLIST.md`); ein Rename wäre Kosmetik gegen eine geldrelevante Sonde.
- `src/billing/cost-truing.js` — neue Konstante `POOL_INCOMPLETE_REASON`; neue Funktionen `fetchCostRecordPoolFor(provider)`, `fetchCostRecordPools(candidates)` (ein Pool je vorkommendem Provider, VOR der Buchungsschleife), `bookablePool(pool)` (übersetzt `complete === false` fail-closed zu `ok:false`); `trueOneCall` verliert `async` und wird **synchron**; `sweepAllCandidates` ruft `fetchCostRecordPools(candidates)` einmal ab und iteriert danach ohne `await` über `trueOneCall(call, pools.get(call.provider), tally)`.
- `src/telephony/ports.js` — JSDoc: `VoiceCostRecordPoolParams` (inkl. `since`, in KE-P2 ohne Wirkung), `VoiceCostRecordPool` (mit `complete`), `VoiceControl.fetchCostRecordPool` / `VoiceControl.assignCostRecords` ersetzen die alte `getVoiceCostRecords`-Zeile.
- `src/server.js` — ein Kommentarwort nachgezogen (`getVoiceCostRecords` → `fetchCostRecordPool`/`assignCostRecords`).
- `tasks/lct-DEPLOY-CHECKLIST.md` — zwei Nennungen auf `assignCostRecords` (mit historischem Hinweis „bis KE-P2 `getVoiceCostRecords`") nachgezogen; das zitierte Log-Zeilen-Format bleibt unverändert.

**Neue/geänderte Testdateien:**

- `test/cost-truing-harness.js` (neu) — extrahiert die zuvor doppelt (in `cost-truing-observe.test.js` und `cost-truing-booking.test.js`) gepflegten Fixturen (`makeStubStore`, `fakeConfig`, `isoMinutesAgo`, `makeDueOutboundCall`, `fakeVoiceControl`) in eine Quelle (G5).
- `test/cost-truing-pool.test.js` (neu, 6 Tests P2-1…P2-6) — Sweep-Ebene, teils gegen den echten Telnyx-Adapter mit gezähltem `fetch`-Stub, teils gegen Fake-Adapter im neuen Port-Zuschnitt.
- `test/telnyx-cost-records.test.js` — Komposition-Helferin `fetchAndAssign()` (spiegelt die produktive Verdrahtung); ~29 Aufrufstellen und ~27 Testtitel mechanisch migriert; zwei neue Tests (Äquivalenztest „geteilter Pool" + Grenzfall `pool_missing`); die drei Log-String-Literale bewusst unverändert belassen.
- `test/cost-truing-observe.test.js` — lokale Fixturen durch Harness-Import ersetzt; 9 inline Controls durch `fakeCostRecordAdapter(recordsFor, opts)` ersetzt.
- `test/cost-truing-booking.test.js` — Harness-Import für `makeStubStore`/`fakeConfig`/`isoMinutesAgo`; `control()` auf zweigeteilten Port umgestellt; eigenes `makeDueOutboundCall` bewusst NICHT vereinheitlicht (Tarif-Drift-Fixturen).
- `test/api-cost-truing-sweep.test.js` — nur Kommentaranpassung, kein Verhaltensunterschied.

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl:**
```
node --test test/cost-truing-pool.test.js   (ausgefuehrt VOR jeder Code-Aenderung in src/, direkt nachdem test/cost-truing-pool.test.js + test/cost-truing-harness.js geschrieben waren)
```

**Wörtliche Ausgabe:**
```
6 failing tests, u.a.:
✖ (P2-1) Sweep holt die Belege EINMAL je Sweep, nicht je Kandidat (2.8095ms)
  AssertionError [ERR_ASSERTION]: EIN Abruf je Typ, unabhaengig von der Kandidatenzahl
  35 !== 7
  actual: 35, expected: 7, operator: 'strictEqual'
✖ (P2-2) EIN Pool fuer alle Kandidaten, je Call der eigene Anker (keine Quervermischung): 0 !== 2 (beide Calls durchlaufen die Zuordnung)
✖ (P2-4) unvollstaendiger Pool ...: actual null erwartet 'unavailable'
✖ (P2-5) alle Pool-Abrufe liegen VOR der ersten Zuordnung (PM-5): actual [] erwartet ['pool','assign','assign','assign']
✖ (P2-6) je Provider genau EIN Pool-Abruf ...: 0 !== 1
✖ (P2-3) ok:false-Pool -> ALLE Kandidaten unavailable ...: 3 !== 1 (kein Retry je Kandidat)
tests 6 / pass 0 / fail 6
Nach der Implementierung (src/telephony/adapters/telnyx/voice.js + src/billing/cost-truing.js): dieselbe Datei isoliert erneut ausgefuehrt -> tests 6 / pass 6 / fail 0.
```

Zur Einordnung: Der Plan (Abschnitt 5) hatte für den benannten roten Lauf (P2-1) vorab eine inhaltsgleiche Sonde auf `d6a821a` gemessen — dort quittierten fünf Log-Zeilen `getVoiceCostRecords ok records=0 …` (eine je Kandidat, je fünf vollständige 7-Typen-Abrufe) und die Assertion scheiterte mit derselben Zahl (`35 !== 7`). Die oben zitierte tatsächliche Ausgabe aus der Umsetzung bestätigt das: P2-1 fällt mit exakt der vorhergesagten Zahl, alle 6 neuen Tests sind vor der Code-Änderung rot — nicht wegen fehlender Methoden (`TypeError`), sondern inhaltlich (falsche Anzahl/Reihenfolge/Zustand).

---

## 3. Der grüne Lauf danach + Suite-Zahl

Nach der Implementierung (`src/telephony/adapters/telnyx/voice.js` + `src/billing/cost-truing.js`): dieselbe Datei isoliert erneut ausgeführt → `tests 6 / pass 6 / fail 0`.

- `testsPass`: **true**
- `testPassCount`: **2879**
- `testFailCount`: **0**
- Referenzwert war **2861/0** — die Suite wächst auf **2879/0** (nur gewachsen, nichts verloren; 18 zusätzliche Tests aus dieser Phase).
- Unabhängig im Safety-Review reproduziert (eigener Review-Worktree, `npm test` **zweimal** ausgeführt): beide Male **2879 pass / 0 fail / 0 skipped**, kein Flake.

---

## 4. Abnahmekriterium der Phase — Beleg

Alle Befehle aus Plan-Abschnitt 6, wörtlich ausgeführt:

```
$ node --check src/telephony/adapters/telnyx/voice.js && node --check src/billing/cost-truing.js && node --check src/telephony/ports.js
-> OK (keine Ausgabe = Erfolg)

$ node --test test/cost-truing-pool.test.js
-> tests 6 / pass 6 / fail 0

$ node --test test/telnyx-cost-records.test.js
-> tests 59 / pass 59 / fail 0 (Bestand + 2 neue: Aequivalenztest 'assignCostRecords: geteilter Pool ...' und Grenzfall 'assignCostRecords: ohne brauchbaren Pool -> ok:false (pool_missing) ...')

$ node --test test/cost-truing-observe.test.js test/cost-truing-booking.test.js
-> tests 34 / pass 34 / fail 0

$ npm test
-> tests 2879 / pass 2879 / fail 0 (zwei aufeinanderfolgende volle Laeufe, beide gruen; Referenz 2861/0 ist damit UEBERTROFFEN, nicht nur gehalten)
```

Strukturelle Zusatzkriterien:

```
$ grep -n "for (const call of candidates)" src/billing/cost-truing.js
-> "for (const call of candidates) trueOneCall(call, pools.get(call.provider), tally);" - KEIN await in dieser Zeile (trueOneCall ist jetzt synchron, s. Funktionssignatur 'function trueOneCall(call, { control, pool }, tally)').

$ grep -c "await" src/billing/cost-truing.js -> 10 Treffer total, davon nur 4 echte Code-Zeilen (await control.fetchCostRecordPool() in fetchCostRecordPoolFor; await fetchCostRecordPoolFor(...) in fetchCostRecordPools; await fetchCostRecordPools(candidates) und await sweepAllCandidates(trigger) in sweepAllCandidates/runCostTruingSweep) - der Rest sind Kommentare, die das Wort 'await' erwaehnen.

$ grep -n "page\[number\]\|filter\[" src/telephony/adapters/telnyx/voice.js
-> genau eine Query-Zeile 'q.set("filter[record_type]", recordType);', KEIN page[number] (das ist explizit KE-P3-Scope).

$ grep -rn --include='*.js' "getVoiceCostRecords" src/
-> nur noch in src/telephony/adapters/telnyx/voice.js: die drei Log-/Op-String-Literale ('getVoiceCostRecords fehler ...', 'getVoiceCostRecords ok ...', assertTelnyxOk(res,"getVoiceCostRecords",...)) plus zwei erklaerende Kommentare, die den Rename ausdruecklich dokumentieren. src/server.js referenziert nur noch fetchCostRecordPool/assignCostRecords.
```

**Zusätzlich (unabhängige Reproduktion im Safety-Review):** ROT-VOR-GRÜN echt nachgestellt ohne `git stash` — `git checkout master -- src/billing/cost-truing.js src/telephony/adapters/telnyx/voice.js src/telephony/ports.js` bei unveränderten neuen Tests: alle 6 Tests in `test/cost-truing-pool.test.js` fallen, P2-1 mit exakt der behaupteten Zahl `35 !== 7` — ein inhaltlicher roter Lauf gegen den echten Telnyx-Adapter, kein „Methode existiert nicht"-TypeError. Danach `git checkout HEAD -- src/` restauriert, `git status` leer.

---

## 5. Safety-Urteil

**Verdikt: FREIGABE (approved: true).**

Kernaussagen aus dem finalen Safety-Review:

- `testsPassIndependently: true`, `testPassCount: 2879`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `moneyPathFailClosed: true`, `fixturesHonest: true`, `redBeforeGreenProven: true`, `noGuessedQueryParam: true`, `scopeRespected: true`, `behaviorAsIntended: true`. **Keine Blocker.**
- KE-P2 hält die Zusage: Belegabruf aus der Kandidatenschleife gezogen (35 → 7 Anfragen bei 5 Kandidaten, am echten Adapter gemessen); Zuordnungslogik ist verschoben, nicht verändert (Diff zeigt nur `fetched.raw` → `pool.raw`).
- Neu und ausschließlich fail-closed: `bookablePool` übersetzt `complete === false` an EINER Stelle in `ok:false`, VOR der Zuordnung — der Fake in P2-4 würde vollständige Records liefern und kommt beweisbar nie an (`trace = ["pool"]`, nicht `["pool","assign"]`). `assignCostRecords` gibt bei fehlendem `pool.raw` `ok:false/pool_missing` statt einer leeren Messung.
- Versuchszähler semantisch identisch zum Bestand: ein `ok:false`-Pool verbraucht je Kandidat genau einen Versuch (P2-3 pinnt `costTruingAttempts === 1`, `costTruedAt === null`, `usage` bit-identisch via `structuredClone`-Vergleich).
- PM-5 strukturell erfüllt: `trueOneCall` ist synchron, kein Netz-`await` mehr zwischen Pool-Abruf und Buchungsschleife; P2-5 pinnt die Reihenfolge `["pool","assign","assign","assign"]`.
- Query an `/v2/detail_records` weiterhin ausschließlich `filter[record_type]` + `page[size]`, kein geratener Zeitfilter, kein `page[number]` (kommt erst KE-P3).
- Absolute Regeln eingehalten: keine Safety-Gate-, Disclosure-, Auth- oder Signaturpfade berührt; keine neuen Deps; keine neue Env-Var; kein Schema; kein Deploy; kein Netz im Test; keine schreibenden Telnyx-Aufrufe; keine Umlaute in neuen Kommentaren; Secret-Scan leer (einzige Key-artige Zeichenkette ist die Test-Attrappe `"KEYtest-secret-do-not-leak"`, Bestandsmuster).
- **Unabhängige Testausführung** im eigenen Review-Worktree (Branch `review-ke-p2` auf `phase/ke-p2-pool`, node v26.4.0): `npm test` zweimal grün (2879/0), isolierter Lauf der 4 betroffenen Dateien 99/99, `node --check` auf allen vier geänderten src-Dateien sauber. (eslint im Worktree wegen fehlendem `@eslint/js`-Symlink nicht startbar — `npm test` hängt nicht daran.)
- **Fixture-Ehrlichkeit durch gezielte Mutation bewiesen** (jede Mutation danach zurückgenommen, Endzustand git-clean): Mutation A (`ANCHOR_ID_FIELD` auf `telnyx_leg_id` — genau das Feld, das live 297/297 Belege verwarf) → 11 Tests rot inkl. Äquivalenztest. Mutation B (`SESSION_ID_FIELDS` auf die Leg-Felder) → 7 Tests rot. Mutation C (fail-open im Zuordnungs-Fallback) → 5 Tests rot, u.a. „fremde Session kommt bei keinem mit". Mutation D (`bookablePool` ohne `complete`-Prüfung) → P2-4 rot.

---

## 6. Clean-Code-Audit

**Verdikt: PASS.** Zusammenfassung: Port sauber zweigeteilt, `ports.js`-JSDoc konsistent nachgezogen, alte `getVoiceCostRecords`-Referenzen dort vollständig entfernt (bewusst als Log-/Op-Token in `voice.js` belassen, begründet); `complete:false` wird an genau einer Stelle (`bookablePool`) auf `ok:false` übersetzt; volle Suite lokal nachgestellt (2879/2879 grün, inkl. der 6 neuen P2-1..P2-6-Tests, keine D3-Tautologien gefunden); kein Umlaut-Verstoß, kein brittler Datei:Zeile-Verweis, keine Magic Numbers ohne Konstante, keine abgeschalteten Sicherungen, kein toter/auskommentierter Code. `cost-truing-harness.js` dedupliziert den vormals dreifach kopierten Test-Stub-Store sauber (G5-Verbesserung).

**S1 (Blocker):** keine.

**S2:** keine.

**S3 (Design/Robustheit, nicht blockierend):**
- `src/billing/cost-truing.js:281-284` (`bookablePool`) — `pool.complete === undefined` wird implizit als „vollständig" behandelt (nur `pool.complete === false` löst `ok:false` aus); ein fail-open-Default in einem Geldpfad, falls ein künftiger KE-P3-Adapter `complete` vergisst zu setzen. Heute unschädlich (Telnyx setzt `complete` immer explizit `true`), sollte spätestens in KE-P3 durch einen expliziten Default-false-Riegel ersetzt werden.
- G5 (weich): drei strukturell ähnliche Zwei-Methoden-Fake-Adapter (`fakeCostRecordAdapter` in `cost-truing-observe.test.js`, `fakePoolAdapter` in `cost-truing-pool.test.js`, `control()` in `cost-truing-booking.test.js`) statt einer gemeinsamen parametrisierten Fabrik in der Harness — jede Variante hat einen dokumentierten Grund (trace/seenPools nur im Pool-Test, feste records-Liste im Booking-Test), deshalb S3 statt S2.

**S4 (Stil, minor):**
- `test/cost-truing-pool.test.js` (P2-3): Kandidatenzahl `[0,1,2].map(...)` ist ein Inline-3er statt der in P2-1 eingeführten benannten `CANDIDATE_COUNT`-Konstante — keine funktionale Auswirkung, nur Stilinkonsistenz innerhalb derselben Datei.

**topTodos aus dem Audit:**
1. `bookablePool()`s Default-Verhalten bei `pool.complete === undefined` vor/mit KE-P3 explizit auf fail-closed umstellen (oder im Port-Vertrag erzwingen, dass `complete` immer gesetzt sein muss).
2. Optional: die drei Fake-Adapter-Bausteine (observe/pool/booking) zu einem parametrisierten Helfer in `cost-truing-harness.js` zusammenziehen, wenn KE-P3 einen vierten Testfall dieser Form braucht.

---

## 7. Fix-Runden

Keine — die Umsetzung erreichte PASS im ersten Anlauf (Abschnitt `FIXES` der Quelle ist leer). `deviations` in der Implementierung: `[]`.

---

## 8. Offene Punkte / Deviations

Aus den Concerns des Safety-Reviews (keiner davon merge-blockierend):

1. **Spec-Abweichung, dokumentiert, sichere Richtung (E8 des Plans):** Die Spec verlangt `fetchCostRecordPool({ since })` — „der Parameter existiert aber bereits". Der Adapter (`src/telephony/adapters/telnyx/voice.js:585`) deklariert `async fetchCostRecordPool()` **ohne** Parameter; `since` existiert nur als JSDoc-Typedef `VoiceCostRecordPoolParams` in `src/telephony/ports.js:94-100`. Begründung im Code: ein entgegengenommener, still ignorierter Zeit-Parameter im Geldpfad wäre die Fehlerklasse „falsch, aber HTTP 200". Restrisiko: der Port-Vertrag bewirbt einen Parameter, den die einzige Implementierung nicht annimmt — KE-P3/KE-P5 müssen die Signatur beim Verdrahten wirklich anfassen und dürfen sich nicht auf „geht schon durch" verlassen.
2. **Kleine Verhaltensänderung gegen die Phasenrichtung:** `master` holte je Kandidat erst NACH dem `legId`-Check. Neu wird der Pool je Provider VOR dem `legId`-Check geholt (`fetchCostRecordPools`). Existiert ein fälliger Telnyx-Kandidat ohne `twilioSid`/`callControlId`, entstehen jetzt 7 Anfragen, wo `master` 0 machte. Fail-closed-neutral (kein Geld bewegt sich, kein Versuch verbraucht — `trueOneCall` zählt weiter `skippedCalls`), aber der Fall bleibt auch nach KE-P5 bestehen, weil `since` an der Kandidatenzahl hängt, nicht an der Anker-Verfügbarkeit.
3. **Scope-Randbereich (vertretbar):** `test/cost-truing-harness.js` zieht Fixturen aus zwei Bestandsdateien heraus (G5); Diff Zeile für Zeile gegen die früheren lokalen Fassungen geprüft — Werte identisch, keine Assertion aufgeweicht, keine Fixture entschärft. `cost-truing-booking.test.js` behält bewusst sein eigenes `makeDueOutboundCall`.
4. **Kosmetisch:** `tasks/lct-DEPLOY-CHECKLIST.md` zieht nur Funktionsnamen nach; eine Zeile ist dabei unschön umbrochen. Die `via_`-Sonde und die Messaussage bleiben inhaltlich unverändert.

Zusätzlich aus dem Clean-Code-Audit als offene, nicht blockierende Empfehlung: `bookablePool`-Default bei fehlendem `complete` vor KE-P3 fail-closed schärfen (s. Abschnitt 6, S3 + topTodos).

Ausdrücklich **nicht** Teil dieser Phase (laut Plan): Seitenschleife/`page[number]`, `inference`-Verzicht, Drossel, `since`-Ableitung, Sweep-Log-Erweiterung, Boot-Guard, ElevenLabs.
