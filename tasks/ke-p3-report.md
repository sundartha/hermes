# Phase KE-P3 — Paginierung ohne geratene Filternamen + `inference` nicht abrufen

- **Gate:** PASS
- **finalBranch:** `phase/ke-p3-pagination`
- **Basis:** `master`

---

## 1. Was geändert wurde

**Geänderte Dateien:**
- `src/telephony/adapters/telnyx/voice.js`
- `src/telephony/ports.js` (nur JSDoc)
- `test/telnyx-cost-records.test.js`
- `test/cost-truing-pool.test.js`

**Keine neuen Dateien.** Keine neue Env-Variable (daher keine Änderung an `config.js`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV). `src/billing/cost-truing.js` bewusst **nicht** angefasst — die Durchgriffs-Übersetzung `complete:false -> ok:false` in `bookablePool()` existiert dort bereits und wird von dieser Phase nur erstmals erreichbar gemacht.

**Kern der Änderung** (`voice.js`):

- `fetchCostRecordPage(recordType)` → `fetchCostRecordPage(recordType, pageNumber)`: sendet jetzt zusätzlich `page[number]`. Erlaubte Query-Parameter bleiben ausschließlich `filter[record_type]`, `page[size]`, `page[number]` — nie ein geratener Zeitfilter.
- `isSinglePageResult` wurde durch `isLastPage(records, meta, pageNumber)` ersetzt (autoritativ `meta.total_pages` aus der Antwort statt Vergleich gegen die selbst angeforderte Seitengröße); `SINGLE_PAGE_TOTAL` entfernt.
- Neue Seitenschleife `fetchRecordTypePages(recordType, sinceMs)`: blättert je Typ aufsteigend ab Seite 1, bis (a) die letzte Seite laut `meta.total_pages` erreicht ist, (b) eine **ganze** Seite nachweislich vor `since` liegt (`isPageBeforeSince`, nie der erste Beleg — Sortierung ist für 6 von 7 Typen unbelegt), oder (c) die Seitenobergrenze `MAX_PAGES_PER_RECORD_TYPE = 10` (benannte Konstante, Mess-/Herleitungskommentar) greift → dann `complete:false`.
- Neue Tabelle `COST_RECORD_TIME_FIELDS` (exportiert, gekoppelt an `ASSIGNABLE_COST_RECORD_TYPES`): trägt die je Typ **gemessenen** Zeitfeldnamen (drei Namensfamilien ohne Schnittmenge). Ausschließlich für die Seitenschleife — die Zuordnungslogik (`RECORD_TIMESTAMP_FIELDS`, `anchoredSessionIds`, `assignmentOutcome`, `toCostRecord`) bleibt unverändert.
- `fetchAllCostRecords()` → `fetchAllCostRecords(sinceMs)`, iteriert jetzt über `ASSIGNABLE_COST_RECORD_TYPES` statt `COST_RECORD_TYPES` → `inference` wird nicht mehr abgerufen (6 statt 7 Anfragen je Sweep-Runde).
- Neue Helfer `newestRecordTimestampMs`, `isPageBeforeSince`, `parseSinceMs`.
- Port-Methode `fetchCostRecordPool({ since } = {})`: `since` ist ab dieser Phase wirksam, bindet aber ausschließlich die Seitenschleife — nie die Query, nie den Pool-Inhalt.
- `ports.js`: JSDoc an `VoiceCostRecordPoolParams`, `fetchCostRecordPool`-Beschreibung und `VoiceCostRecordPool.complete` entsprechend nachgezogen.

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl:**
```
node --test test/telnyx-cost-records.test.js test/cost-truing-pool.test.js
```
(gegen unveränderte `src/`, Stand master `e387e73`)

**Wörtliche Ausgabe:**
```
telnyx-cost-records.test.js: tests 68 / pass 51 / fail 17 (u.a. alle P3-Faelle). Beispiele:
✖ (P3-1) Seitenschleife sammelt ALLE Seiten eines Typs (212 Belege, letzte Seite kurz)
  AssertionError: pageNumbersFor(calls,"call-control") -> actual [1], expected [1,2,3,4,5]
✖ (P3-9) abgerufene Typenmenge ist GENAU ASSIGNABLE_COST_RECORD_TYPES - inference wird nie angefragt
  actual: Set(7){ ...,'inference',... } vs expected: Set(6){...} (inference wurde mitgeholt)
✖ (P3-10) ... nie einen Zeitfilter
  AssertionError: 7 !== 6 (calls.length; page[number] wurde nie gesendet)
✖ (P3-2) Seitenobergrenze erreicht -> complete:false
  AssertionError: pool.complete -> actual false erwartet, TATSAECHLICH ok:false/page_truncated statt complete:false (Seitenschleife fehlte komplett)
✖ (P3-5)/(P3-6)/(P3-7)/(P3-8): pageNumbersFor -> actual [0] bzw. [1] statt [1,2]/[1,2,3] (since wirkungslos, keine Seitenschleife)
✖ Belegabruf: fragt jeden record_type aus ASSIGNABLE_COST_RECORD_TYPES ab: calls.length 7 !== 6
(11 weitere gleichartige Fehlschlaege, u.a. Log-Zeilen-Format-Tests)

cost-truing-pool.test.js: tests 7 / pass 6 / fail 1
✖ (P2-1) Sweep holt die Belege EINMAL je Sweep, nicht je Kandidat
  AssertionError: 7 !== 6 (fetchCalls.length gegen ASSIGNABLE_COST_RECORD_TYPES.length)

Kombiniert: 18 rote Tests vor dem Fix, exakt die in Plan §6 vorhergesagte Menge (P3-1,2,2b,2c,4,5,6,7,8,9,10,11) plus die durch die Zaehl-Konstante ASSIGNABLE_COST_RECORD_TYPES.length beeinfluss­ten Bestandstests. Nach den E1-E8-Edits: beide Dateien 75/75 pass, 0 fail.
```

Zusätzlich wurde der rote Zustand vor der Implementierung mit einer read-only-Probe gegen den echten Adapter auf master falsifizierbar gemacht (`scratchpad/probe-ke-p3.mjs`, kein Repo-Schreibzugriff, kein Netz):

```
(1) 3-Seiten-Fixture -> {"ok":false,"reason":"page_truncated"}
    call-control-Anfragen: 1
(2) abgefragte Typen: ["sip-trunking","call-control","speech-to-text","text-to-speech","recording","inference","ai-voice-assistant"]
    COST_RECORD_TYPES= 7  ASSIGNABLE= 6
(3) Query-Keys: ["filter[record_type]","page[size]"]
(4) mit since -> Anfragen: 7 Keys: ["filter[record_type]","page[size]"]
(5) total_pages=99 -> {"ok":false,"reason":"page_truncated"} Anfragen: 1
```

Das heißt heute: eine 3-seitige Menge liefert 0 verwertbare Belege statt 112 (P3-1 rot), `inference` wird mitgeholt (P3-9 rot), `page[number]` wird nie gesendet (P3-10 rot), `since` ist wirkungslos (P3-4/5/6/7/8 rot), die Seitenobergrenze existiert nicht (P3-2 rot, heute `ok:false` statt `complete:false`).

**Der schärfste Einzelbeleg** (ein Befehl, ein Wert): (P3-9) — heute 7 Anfragen inkl. `inference`, danach exakt 6.

---

## 3. Der grüne Lauf danach + Suite-Zahl

**Zielgerichtet:**
```
node --check src/telephony/adapters/telnyx/voice.js && node --check src/telephony/ports.js
(kein Output = OK)

node --test test/telnyx-cost-records.test.js test/cost-truing-pool.test.js
tests 75 / pass 75 / fail 0 - darunter namentlich P3-1, P3-2, P3-2b, P3-2c, P3-4..P3-11
(telnyx-cost-records.test.js) sowie P3-3 (cost-truing-pool.test.js), alle gruen.
```

**Volle Suite:**
```
npm test
tests 2889 / pass 2889 / fail 0
```

- Referenz vor der Phase (im Plan selbst gemessen, nicht die veraltete Spec-Zahl 2861): **2879 pass / 0 fail**.
- Nach der Phase: **2889 pass / 0 fail** (Wachstum +10).
- Der Plan hatte als Zielwert 2890 genannt (§7.C); die tatsächlich erreichte Zahl ist 2889. Laut IMPL ist das ein nachgewiesener Rechenfehler in der Plan-eigenen Kurzformel ("13 neue − 1 gelöscht − 1 ersetzt, netto +11"), die der eigenen Tabelle in Plan §5.4 widerspricht (dort stehen 3 "ersetzt"-Fälle + 1 "gelöscht"-Fall = 4 Entfernungen statt 2). Verifiziert per Skript-Zählung der `test()`-Aufrufe je Datei: `telnyx-cost-records.test.js` 38→47 (+9), `cost-truing-pool.test.js` 6→7 (+1), Summe +10 = 2889. Keine zusätzlichen Tests erfunden, um künstlich auf 2890 zu kommen (Detail siehe Abschnitt 6, Deviations).

**Unabhängig im Safety-Review nachgemessen** (eigener Worktree-Lauf): `npm test` → tests 2889, pass 2888, fail 1. Der eine rote Test war `test/disclosure-outbound.test.js` mit `TypeError: fetch failed / connect ETIMEDOUT 127.0.0.1` — bekannter Voll-Last-Flake (Seed-vor-Boot-/Spawn-Race, siehe Memory `suite-flake-p5-gate-proof`). Isoliert gelaufen: `node --test test/disclosure-outbound.test.js` → 1/1 pass. Nach Flake-Protokoll nicht echt rot, nichts daran repariert.

**Referenz aus dem Auftrag (Spec-Zahl):** 2861/0 — diese Zahl stammt laut Plan von vor KE-P1/P2 und wurde durch die eigene Vor-Ort-Messung (2879/0) ersetzt.

---

## 4. Abnahmekriterium der Phase mit Beleg

Plan §7 (deterministisches Abnahmekriterium, ersetzt das laut Plan §0 veraltete Spec-Grep):

**A · Struktur:**
```
$ grep -c 'q.set("page\[number\]"' src/telephony/adapters/telnyx/voice.js
1   (rot war 0, gruen erwartet 1 -> ERFUELLT)

$ grep -n 'for (const recordType of' src/telephony/adapters/telnyx/voice.js
489:  for (const recordType of ASSIGNABLE_COST_RECORD_TYPES) {
   (rot war "... of COST_RECORD_TYPES) {" -> ERFUELLT)

$ grep -c 'page_truncated' src/telephony/adapters/telnyx/voice.js
0   (rot war 3, gruen erwartet 0 -> ERFUELLT)
```

**B · Verhalten:**
```
$ node --check src/telephony/adapters/telnyx/voice.js && node --check src/telephony/ports.js
(kein Output = OK)

$ node --test test/telnyx-cost-records.test.js test/cost-truing-pool.test.js
tests 75 / pass 75 / fail 0 - darunter namentlich P3-1, P3-2, P3-2b, P3-2c, P3-4..P3-11
(telnyx-cost-records.test.js) sowie P3-3 (cost-truing-pool.test.js), alle gruen. ERFUELLT.
```

**C · Suite:**
```
$ npm test
tests 2889 / pass 2889 / fail 0
```
Referenz vor der Phase (selbst gemessen): 2879 pass / 0 fail. Testzahl gewachsen (2879 → 2889, +10), fail bleibt 0 → ERFÜLLT im Sinn des Kriteriums ("fail 0, tests darf nur wachsen"). Abweichung von der Plan-Zielzahl 2890 s. oben/Abschnitt 6.

**Spec-Ebene (impl-spec.md KE-P3, grün-Kriterium):** "3 Seiten liefert Records; Seitenobergrenze liefert complete:false; ein Test zählt 6 statt 7 Abrufe je Seitenrunde und weist die abgerufene Typenmenge exakt nach" — alle drei Teilzusagen sind durch P3-1/P3-2/P3-9 belegt (P3-1 nutzt bewusst die gemessene 212er-Form statt der illustrativen 50/50/12 — vom Plan selbst vorab als einzige zulässige Spec-Abweichung begründet).

---

## 5. Safety-Urteil, Clean-Code-Audit, Fix-Runden, offene Punkte/Deviations

### Safety-Urteil

**Verdikt: FREIGABE (approved: true).**

Kernpunkte aus dem Safety-Review:
- Ein Commit (`44abe60`), vier Dateien, keine Änderung an `src/billing/`, `boot-guard.js`, `boot.js`, `config.js` oder `package.json` (selbst geprüft, 0 Zeilen Diff), keine neue Dependency, keine neue Env-Variable, kein Netz im Test.
- **Geldpfad:** Zuordnungslogik byte-identisch geblieben (`anchoredSessionIds`/`assignmentOutcome`/`toCostRecord` kein einziges Mal im Diff). `complete:false` propagiert unverändert über `bookablePool()` → `ok:false` → alle Kandidaten UNAVAILABLE, `actualCostMicroCents` null, `usage` unverändert (im Voll-Sweep-Test verifiziert). `since` filtert den Pool nicht, bindet nur die Blättertiefe; Belege ohne gemessenes Zeitfeld gelten als innerhalb (konservativ).
- **Query:** ausschließlich `filter[record_type]`, `page[size]=50`, `page[number]` gehen hinaus (P3-10 pinnt die Schlüsselmenge exakt, verbietet Zeitfilter-Keys). Bemerkenswert: die Vermessung zeigt, dass `filter[started_at][gte]` auf `sip-trunking` sogar funktioniert (200/4 Treffer) — die Umsetzung hat es trotzdem nicht benutzt, weil der Feldname je Typ abweicht und ein falscher Name still 0 Treffer liefert.
- **Fixtures:** gegen Spec A1 geprüft (`meta {total_results:212,total_pages:5,page_size:50}`, letzte Seite 12 Belege aus gemessenen Zahlen berechnet), Null-Zwillinge in beiden Richtungen, Köder-Pflicht erfüllt (Mutationsprobe: Anker auf `telnyx_leg_id` umgestellt → 13 Tests rot).
- **Eigener unabhängiger Testlauf:** 2889 tests / 2888 pass / 1 fail (bekannter ETIMEDOUT-Flake, isoliert grün) — `redBeforeGreenProven: true`, `noGuessedQueryParam: true`, `moneyPathFailClosed: true`, `fixturesHonest: true`.
- **Mutationsproben** (angewandt, gemessen, zurückgesetzt): Zeitfeld-Vertauschung → P3-7/P3-8 rot; `every`→`some` in `isPageBeforeSince` → P3-4/P3-5 rot; Anker-Feld auf `telnyx_leg_id` → 13 Tests rot; Abrufliste auf `COST_RECORD_TYPES` → 7 Tests rot; `page[number]` fest auf 1 → 7 Tests rot; `complete:false`-Weitergabe entfernt → P3-2/P3-2b rot (aber P3-3 blieb grün, siehe Concerns).

**Blockers:** keine.

**Concerns (Safety-Review):**
1. **(P3-3) nicht trennscharf:** der Test bleibt grün, wenn man die `complete:false`-Weitergabe aus `fetchAllCostRecords` entfernt, weil die Kandidaten-Anker in den Fixture-Belegen nie vorkommen — es gäbe auch mit vollständigem Pool nichts zu buchen, "unavailable" ist trivial. Die Zusage selbst ist trotzdem gedeckt (P3-2 pinnt `complete:false` am Port, P2-4 pinnt die Übersetzungskette). Ehrliche Fassung wäre: den Fixture-Belegen die Anker der Kandidaten geben.
2. **Aufweichung der KE-P1-Regel** "volle Seite ohne brauchbares meta = fail-closed": ab P3 wird stattdessen weitergeblättert; eine kurze Folgeseite erklärt die Menge als vollständig (Test P3-2c). Im Normalfall mehr Wissen; im Drift-Fall (kein meta UND kaputte Paginierung) kann eine Untermenge jetzt als vollständig gelten, wo vorher `ok:false` stand. Restrisiko bewusst, aber neu.
3. **Keine Duplikat-Erkennung über Seiten hinweg:** ignorierte der Provider `page[number]` und lieferte Seite 1 mehrfach (bei `meta.total_pages>1`), würden dieselben Belege mehrfach summiert → zu hohe Ist-Kosten → Nachforderung zulasten des Kunden (fail-open in die andere Geldrichtung). Nur durch Messung gedeckt (`tasks/kosten-endspiel/telnyx-api-vermessung.md`), nicht durch Code.
4. **Deploy-Reihenfolge:** Anfragen je Sweep steigen von 7 auf bis zu 60 (6 Typen × `MAX_PAGES_PER_RECORD_TYPE=10`) — ohne Drossel (kommt erst KE-P4) und ohne `since` (kommt erst KE-P5). Folgen: (a) ein 429 lässt alle Kandidaten einen Versuch verbrauchen; (b) wächst ein Typ kontoweit über 500 Belege, liefert jeder Sweep `complete:false` und die Ist-Kosten-Zuordnung steht dauerhaft still. **KE-P3 nicht allein deployen.**
5. **Log-Formatwechsel als Nebenwirkung:** `rejected={}` statt `rejected={"session_unresolved":1}`, weil `inference` nicht mehr abgerufen wird. Die `via_`-Zähler selbst sind unverändert; Konsumenten der `rejected`-Map (`tasks/lct-DEPLOY-CHECKLIST.md`) sollten es wissen.
6. **Umgebungs-Hinweis (kein Code-Befund):** das im Auftrag vorgegebene `ln -s "./node_modules" node_modules` erzeugt im Worktree eine Symlink-Schleife; `npm test` terminiert dann mit Exit 0 ohne einen Test auszuführen. Ein Agent, der nur den Exit-Code prüft, meldet fälschlich "grün".

### Clean-Code-Audit (S1–S4)

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (empfohlen, kein Blocker):**
  - `src/telephony/adapters/telnyx/voice.js` · `newestRecordTimestampMs` (neu, Seitenschleife) und `withinRecordWindow`/`RECORD_TIMESTAMP_FIELDS` (Bestand, Call-Fensterfilter) wiederholen dasselbe Mikro-Idiom `Date.parse(...)` + `Number.isNaN`-Check + String-Guard. Trennung ist bewusst begründet (zwei verschiedene Fragen, unterschiedliche Feldquellen, unterschiedliche Aggregation) — deshalb kein hartes G5, aber ein gemeinsamer Mini-Helfer `parseTimestampMs(value)` würde die Parse-Idiomatik bündeln.
- **S4 (Hinweis):**
  - `MAX_PAGES_PER_RECORD_TYPE=10` ist sauber benannt und ausführlich hergeleitet, liegt aber als lokale Konstante in einer Adapter-Datei statt in `config.js` (G35 verlangt grundsätzlich Top-Level-Konfigurationswerte dort). Konsistent mit bestehendem Muster im selben File (`COST_RECORDS_PAGE_SIZE` etc. sind ebenfalls lokale Protokollkonstanten). Bei KE-P4 (Rate-Limit-Drossel, 40 Anfragen/Minute) sollte dieselbe Frage nochmal bewusst entschieden werden.

**Verdikt Clean-Code:** PASS ohne Blocker. Seitenschleife sauber eingeführt (`page[number]`, aufsteigend, `meta.total_pages`-autoritativ), kein Zeitfilter als Query-Parameter, alle neuen Konstanten benannt mit Mess-/Herleitungskommentar, `COST_RECORD_TIME_FIELDS` sauber von `RECORD_TIMESTAMP_FIELDS` getrennt und testgekoppelt (G27), keine Umlaut-Verstöße, keine toten Referenzen, Tests kein D3-Fixture-Zirkel (P3-7/P3-8 echter Köder-Test, P3-4/P3-5 pinnen die Regel in beide Richtungen, P3-2/P3-2b/P3-3 belegen die Seitenobergrenze End-to-End). Volle Suite 2889/2889 grün, `node --check` sauber, betroffene Testdateien isoliert erneut grün (75/75).

**topTodos (Clean-Code):**
1. Bei KE-P4 bewusst entscheiden, ob `MAX_PAGES_PER_RECORD_TYPE`/die 40-Anfragen-Zahl Adapter-lokale Protokollkonstante bleibt oder nach `config.js` wandert.
2. Optional: gemeinsamen `parseTimestampMs`-Mini-Helfer für die zwei separaten Timestamp-Parse-Stellen erwägen (rein Ausdrucksstärke, keine funktionale Änderung nötig).

### Fix-Runden

FIXES-Abschnitt der Quelle ist leer — keine Fix-Runde nach dem initialen dualen Review nötig; das Ergebnis stand bereits im ersten Durchlauf auf PASS/FREIGABE.

Ein interner Nach-Audit vor dem Commit (laut IMPL-Deviations) fand, dass eine explizite Plan-Anweisung (`FIRST_RECORD_TYPE` auf `ASSIGNABLE_COST_RECORD_TYPES[0]` umstellen) im ersten Durchgang nicht mit-editiert war; wurde vor dem Commit nachgezogen — keine bleibende Abweichung.

### Offene Punkte / Deviations

1. **Testzahl-Ziel:** Plan §7.C nennt 2890 als Zielwert; tatsächlich erreicht sind 2889. Root Cause geprüft: die Plan-eigene Kurzformel widerspricht der eigenen Tabelle in Plan §5.4 (4 Entfernungen statt der unterstellten 2). Jede Zeile aus §5.2/§5.3/§5.4 wurde exakt wie spezifiziert umgesetzt (verifiziert per Diff und Skript-Zählung). Die Differenz zu 2890 ist ein Rechenfehler in der Plan-Zusammenfassung, kein Implementierungsfehler.
2. **Fixture-Größe in P3-1:** bewusst die gemessene Form `{total_results:212,total_pages:5,page_size:50}` statt der im Spec-Text illustrativ genannten "3 Seiten 50/50/12" — vom Plan selbst vorab als einzige zulässige Spec-Abweichung begründet (A2 Fixture-Disziplin: Fixtures spiegeln nur gemessene Antwortformen).
3. **Nachgezogene Plan-Anweisung** (`FIRST_RECORD_TYPE`) — s. Fix-Runden oben, vor Commit behoben.
4. **Aus dem Safety-Review als offen markiert (nicht blockierend, aber für Folgephasen/Deploy relevant):** P3-3 nicht trennscharf; Aufweichung der fail-closed-Regel bei fehlendem `meta`; keine Duplikat-Erkennung über Seiten; Deploy-Reihenfolge (KE-P3 nicht allein deployen, erst mit KE-P4/KE-P5 zusammen); Log-Formatwechsel `rejected`-Map.
5. **Kein Deploy in dieser Phase** (A6) — die Pre-Mortem-Auflage aus dem Plan (KE-P3 nicht ohne Drossel/`since` ausliefern) bleibt für die Deploy-Checkliste vorzumerken.
