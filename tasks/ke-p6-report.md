# 1. Phase KE-P6 — Boot-Guard-Kopplung · ElevenLabs-Zeichen je Tenant · Sweep-Log

**Gate: PASS**
**finalBranch:** `phase/ke-p6-observability-fix1`
**Basis:** `master` (`1555def`, KE-P0–P5 gemergt)
**headCommit:** `7b2c8c1` (Erstimplementierung) + `b136cd3` (Fix-Runde r1, s. Abschnitt 6.3)

Drei Änderungen laut Plan (`tasks/kosten-endspiel/impl-spec.md` KE-P6):

1. **Boot-Guard-Kopplung** — war am Arbeitsbaum bereits intakt (`boot.js` und `voice.js` lesen dieselbe exportierte Konstante `ASSIGNABLE_COST_RECORD_TYPES`); die Phase liefert dafür einen echten Kopplungstest statt reiner Produktionslogik.
2. **ElevenLabs-Zeichen je Tenant** — der zugeordnete `text-to-speech`-Beleg (Provider `elevenlabs`) trägt `number_of_characters` fortan bis in eine neue Tenant-Zeile (`usage.tts_characters`) durch.
3. **Sweep-Log** — die Log-Zeile `[cost-truing] sweep …` bekommt vier neue Felder (`anfragen=`/`seiten=`/`pool=`/`vollstaendig=`) hinter den Bestandsfeldern, macht den Belegabruf selbst messbar.

---

## 2. Was geändert wurde

Kern der Änderung je Teilaufgabe (aus dem Impl-Report):

- **(1) Boot-Guard-Kopplung:** reine Test-Arbeit, kein Produktionscode-Edit. Neuer Test `(P6-1)` in `test/telnyx-cost-records.test.js` leitet die abgerufene Typenmenge aus **echten** (gestubbten) HTTP-Anfragen ab und hält sie gegen `costTruingBookingFindings()` — das kann eine spätere Entkopplung falsifizieren, im Gegensatz zu einer Assertion, die auf beiden Seiten dieselbe Konstante zweimal einsetzt. Gegenstück `(n4)` in `test/cost-truing-booking-guard.test.js` bootet den **echten** Server mit der vollen zuordenbaren Typenmenge als Pflicht-Menge.
- **(2) ElevenLabs-Zeichen je Tenant:** neue Funktion `elevenLabsCharactersOf(raw)` in `src/telephony/adapters/telnyx/voice.js` (nur `record_type === "text-to-speech"` und `provider === "elevenlabs"`, sonst `null` — nie `0` als Ersatz für „nicht gemessen"); `toCostRecord` bekommt das zusätzliche Ausgabefeld `ttsCharacters` (keine neue Ablehnungsquelle, die vier Prüfschritte davor bleiben byte-identisch). `fetchCostRecordPool` stempelt zusätzlich `requests`/`pages` eines Abrufs über einen neuen internen Kontext `poolRun` (`createPoolFetchRun`). In `src/billing/cost-truing.js`: neue Helferin `sumIntegerField()` löst eine G5-Duplizierung auf (vorher zwei parallele `reduce`-Ausdrücke für `billedSecTotal`/eine neue Summe), neue Buchungsfunktion `bookTtsCharactersFor(call, measured)` (No-op bei `ttsCharacters <= 0`, sonst `store.recordTenantTtsCharacters(...)`, Riegel gegen Doppelbuchung ist ausschließlich `costTruedAt`). Neue additive Spalte `usage.tts_characters BIGINT NOT NULL DEFAULT 0` (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, erbt bestehende RLS `tenant_isolation`) mit Wrapper-Parity in beiden Backends: `src/store/state-ops.js` (`recordTenantTtsCharacters`), `src/store/json.js` und `src/store/pg.js` (Fassaden + `rowToUsage` + `flushUsage`-Spaltenliste), Re-Export in `src/store.js`, neues Feld `ttsCharacters: 0` in `src/store/defaults.js` (`emptyUsage()`).
- **(3) Sweep-Log:** neue Helferinnen in `src/billing/cost-truing.js` — `poolFetchStats(pool)` liest Abruf-Kennzahlen (`requests`, `pages`, `records`, `incomplete`) **vor** der Buchbarkeits-Übersetzung `bookablePool` (damit erscheinen die Anfragen im Log auch bei `complete:false`); `NO_POOL_FETCH`/`emptyFetchTally`/`addPoolFetchStats` bilanzieren über alle Provider je Sweep; `fetchCostRecordPools` liefert jetzt `{ pools, fetchTally }` statt nur `pools`; `logSweepLine(...)` bündelt die eine Log-Zeile (Bestandsfelder + Reihenfolge unverändert, vier neue Felder hinten angehängt). Rückgabewert der HTTP-Antwortform `POST /api/billing/cost-truing/sweep` bewusst **unverändert** (Scope, `test/api-cost-truing-sweep.test.js` pinnt neun Felder).

**Geänderte Dateien (`filesEdited`):** `src/telephony/adapters/telnyx/voice.js`, `src/telephony/ports.js`, `src/billing/cost-truing.js`, `src/store/defaults.js`, `src/db/schema.sql`, `src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/store.js`, `test/telnyx-cost-records.test.js`, `test/cost-truing-booking-guard.test.js`, `test/tts-quota-counter.test.js`, `test/store-pg.test.js`, `test/store-pg-tenant-budget.test.js`, `test/cost-truing-harness.js`.

**Neue Dateien (`filesCreated`):** `test/cost-truing-sweep-log.test.js`, `test/cost-truing-tts-characters.test.js`.

Diff-Umfang laut Safety-Review: 9 Src-Dateien + 8 Testdateien, 740 Zeilen (Erstimplementierung `7b2c8c1`) — deckt sich exakt mit den drei Spec-Änderungen, keine Scope-Überschreitung.

**Geldpfad unangetastet:** `anchoredSessionIds`, `assignmentOutcome`, `matchesAnchor`, `recordSessionRefs`, `withinRecordWindow`, `bookablePool`, `refundProven`, das Vollständigkeits-Prädikat in `classifyRecords`, `logCostRecordsOk`/die `via_`-Zähler — kein inhaltlicher Edit. Query (`filter[record_type]`, `page[size]`, `page[number]`) byte-identisch, kein neuer/geratener Parameter. Keine neue Env-Variable, keine neue Dependency, keine Änderung an `config.js`/`.env.example`/`render.yaml`/`BASE_ENV`.

**Deviations aus dem Impl-Report (Nacharbeit gegenüber der Plan-Skizze, keine inhaltliche Abweichung):**

1. `test/cost-truing-harness.js` musste um eine `recordTenantTtsCharacters`-Methode im Stub-Store erweitert werden (Delegation an die echte `state-ops`-Funktion, Muster der Nachbarmethoden) — ohne sie wäre jeder Sweep-Test mit zugeordnetem TTS-Beleg mit `TypeError` gescheitert.
2. Reihenfolge-Korrektur in `cost-truing.js`: die Plan-Skizze hätte `NO_POOL_FETCH` **nach** `NO_COST_RECORDS` platziert, `NO_COST_RECORDS` referenziert aber `NO_POOL_FETCH` in seinem Initializer — in der Plan-Reihenfolge ein Temporal-Dead-Zone-`ReferenceError` beim ersten Aufruf von `makeCostTruing()`. Block vor `NO_COST_RECORDS` verschoben, inhaltlich identisch.
3. Testfixtur-Korrektur `(P6-2)`/`(P6-3)`/`(P6-4)`: die Plan-Skizze übergibt Fixtures als bloßes Objekt an `stubFetchByRecordType`, die Helferin erwartet aber ein Array je `record_type` (Bestandskonvention). Fix: Werte in Arrays gewrappt.
4. Testfixtur-Korrektur in `cost-truing-tts-characters.test.js`: ein synthetischer `created_at`-Wert auf den TTS-Belegen kollidierte mit dem (auf echten Formen wirkungslosen) Fensterfilter, weil `call.startedAt` real zur Testlaufzeit gestempelt wird. Fix: `created_at` weggelassen (Muster der Bestandsfixture).

---

## 3. DER ROTE LAUF VOR DEM FIX

**Befehl** (`redBeforeGreenCommand`, wörtlich):

```
node --test test/cost-truing-sweep-log.test.js  (vor der Produktionscode-Aenderung; Test war neu geschrieben, Fixture-Design siehe Bericht)
```

**Ausgabe** (`redBeforeGreenOutput`, wörtlich):

```
✖ (P6-8) Sweep-Log traegt anfragen/seiten/pool/vollstaendig HINTER den Bestandsfeldern
  AssertionError: Expected values to be strictly equal:
  + actual:   '[cost-truing] sweep trigger=manual kandidaten=2 gemessen=0 unvollstaendig=2 ohne_schaetzung=0 unbestimmt=0 uebersprungen=0'
  - expected: '[cost-truing] sweep trigger=manual kandidaten=2 gemessen=0 unvollstaendig=2 ohne_schaetzung=0 unbestimmt=0 uebersprungen=0 anfragen=6 seiten=6 pool=1 vollstaendig=true'
✖ (P6-9) 0 Kandidaten -> 0 Anfragen, aber die Zeile erscheint: Input did not match /kandidaten=0 .* anfragen=0 seiten=0 pool=0 vollstaendig=true/
✖ (P6-10) unvollstaendiger Pool -> vollstaendig=false: Input did not match / vollstaendig=false/
✖ (P6-11) 429 mit Wiederholung: TypeError: Cannot read properties of null (reading '1')
tests 4 / pass 0 / fail 4
Zusaetzlich rot vor der Aenderung (isoliert bestaetigt): test/cost-truing-tts-characters.test.js (3/3 rot, "0 !== 238" bzw. TypeError "store.recordTenantTtsCharacters is not a function"), test/tts-quota-counter.test.js (Modul-Ladefehler: "does not provide an export named 'recordTenantTtsCharacters'"), test/store-pg.test.js + test/store-pg-tenant-budget.test.js (deepEqual-Diff: emptyUsage()-Bucket ohne ttsCharacters-Feld), test/telnyx-cost-records.test.js (P6-2)/(P6-3) (ttsCharacters undefined statt 238/null).
```

Zur Einordnung: Plan-Abschnitt 5 sieht fünf Rot-Belege R1–R5 vor (`(P6-8)` Sweep-Log-Format, `(P6-5)` Zeichen am richtigen Tenant, `(P6-2)` Adapter-Feld, `(t4)` pg-Spalte — alle **rot** vor der Änderung; `(P6-1)` Kopplungs-Pin — bewusst bereits **grün**, weil Änderung 1 als reine Test-Arbeit die bestehende, intakte Kopplung nur pint). Der oben zitierte `redBeforeGreenOutput`-Block deckt R1 vollständig ab (4/4 rot in `cost-truing-sweep-log.test.js`) und listet zusätzlich die isolierten Rot-Belege für R2–R4 (`cost-truing-tts-characters.test.js`, `tts-quota-counter.test.js`, `store-pg.test.js`/`store-pg-tenant-budget.test.js`, `telnyx-cost-records.test.js`).

Der finale Safety-Review hat diesen Rot-Zustand **unabhängig selbst reproduziert** (nicht nur geglaubt), via `git checkout master -- src/billing/cost-truing.js src/telephony/adapters/telnyx/voice.js` im eigenen Review-Worktree (kein `git stash`): `cost-truing-sweep-log.test.js` 4/4 rot, `cost-truing-tts-characters.test.js` `P6-5`+`P6-6` rot, `telnyx-cost-records.test.js` `P6-2`/`P6-3a`/`P6-3b`/`P6-3c` rot (4 fail / 75 pass) — `P6-1` und `P6-4` erwartungsgemäß auch auf `master` grün (reine Regressionspins). Danach wiederhergestellt.

---

## 4. Der grüne Lauf danach + Suite-Zahl

Aus dem Impl-Report (`acceptanceEvidence`, unmittelbar nach der Produktionscode-Änderung):

```
Befehl A: node --test test/cost-truing-sweep-log.test.js -> pass 4 / fail 0.
Gepinnte Zeile (P6-8) exakt wie im Plan vorhergesagt:
"[cost-truing] sweep trigger=manual kandidaten=2 gemessen=0 unvollstaendig=2 ohne_schaetzung=0
 unbestimmt=0 uebersprungen=0 anfragen=6 seiten=6 pool=1 vollstaendig=true"
anfragen deckt sich mit der Laenge der fetch-Aufrufliste (Assertion im Test).

Befehl B: node --test test/cost-truing-tts-characters.test.js test/tts-quota-counter.test.js
-> pass 23 / fail 0 (davon (P6-5)/(P6-6)/(P6-7) sowie (t1)-(t4)). Tenant A traegt 238, Tenant B 17,
zweiter Sweep aendert beide nicht (costTruedAt-Riegel), unvollstaendiger Pool bucht 0 Zeichen.

Befehl C: node --test test/telnyx-cost-records.test.js test/cost-truing-booking-guard.test.js
-> pass 90 / fail 0. (P6-1) leitet die abgerufene Typenmenge (6 Typen) aus echten HTTP-Anfragen ab,
alle 6 sind als Pflicht-Typ zulaessig, der nicht abgerufene Typ (inference) wird fatal abgelehnt;
(n4) bootet mit allen 6 als Pflicht-Menge (Server-Exit 0, /healthz 200, kein "Start abgebrochen").

Befehl D (Gesamtsuite): npm test -> pass 2922 / fail 0 (Referenz 2861/0, gewachsen).
Ein isolierter Voll-Last-Flake in test/w5-abo-allowlist-gate.test.js (ConnectTimeoutError,
unabhaengig von dieser Phase) trat in einem von zwei vollstaendigen Laeufen auf und war isoliert
(node --test test/w5-abo-allowlist-gate.test.js) 7/7 gruen - Flake-Protokoll A5 erfuellt,
kein echter Rot-Befund.

Syntax: node --check auf allen 9 geaenderten Produktionsdateien + 8 Testdateien -> ALL_SYNTAX_OK.
```

**Nach der Fix-Runde r1** (Branch `phase/ke-p6-observability-fix1`, Commit `b136cd3` oben auf `7b2c8c1`) hat der finale Safety-Review die volle Suite **unabhängig erneut** ausgeführt (eigener Worktree, Branch `review-ke-p6-r1`):

```
npm test -> tests 2924 / pass 2924 / fail 0 / cancelled 0, Exit 0, 82,5 s
(Referenz 2861 -> +63, nur gewachsen)
```

Zusätzlich isoliert (alle 7 geänderten Testdateien zusammen): **158/158 grün**. Die Clean-Code-Prüfung (final) hat unabhängig davon 297 direkt betroffene Tests (neue/geänderte + Nachbar-Suiten, u. a. `api-cost-truing-sweep`, `api-state-usage-axis`, `boot-guard`, `store-pg-billing-idempotent`, `store-pg-drain-flushes`, `voice-play-tts`) gegen den echten Branch-Stand (`git archive`) laufen lassen: **297 grün, 0 rot**.

Die Differenz 2922 (Impl, vor Fix r1) → 2924 (Safety, nach Fix r1) erklärt sich aus der Fix-Runde: `P6-3` wurde von einem gebündelten Test in drei isolierte Fälle `P6-3a`/`P6-3b`/`P6-3c` aufgeteilt (netto +2 Tests, s. Abschnitt 6.3).

---

## 5. Abnahmekriterium der Phase mit Beleg

Deterministisches Abnahmekriterium aus dem Plan (Abschnitt 6 `impl-spec.md`):

- **Befehl A** — `node --test test/cost-truing-sweep-log.test.js`: rot heute (`AssertionError`, Ist-Zeile endet nach `uebersprungen=0`); grün = `pass 4 / fail 0`, gepinnte Zeile deckt sich mit der Länge der `fetch`-Aufrufliste.
- **Befehl B** — `node --test test/cost-truing-tts-characters.test.js test/tts-quota-counter.test.js`: rot heute (`TypeError: store.recordTenantTtsCharacters is not a function` bzw. `column "tts_characters" does not exist`); grün = `fail 0`, Tenant A trägt 238, Tenant B 17, zweiter Sweep ändert beide nicht.
- **Befehl C** — `node --test test/telnyx-cost-records.test.js test/cost-truing-booking-guard.test.js`: grün = `fail 0`; `(P6-1)` leitet 6 abgerufene Typen aus echten Anfragen ab, alle 6 als Pflicht-Typ zulässig, `inference` fatal abgelehnt; `(n4)` bootet mit allen 6 als Pflicht-Menge.
- **Befehl D** — `npm test`: grün = `fail 0`, Testzahl > 2861 (Referenz A5, darf nur wachsen). Flake-Protokoll A5: ein roter Test gilt erst als echt rot, wenn er isoliert ebenfalls rot ist.

**Beleg (`acceptanceEvidence`, Impl-Report, wörtlich zitiert):** s. Abschnitt 4 oben — alle vier Befehle wurden ausgeführt und lieferten exakt die im Plan vorhergesagten Zahlen/Zeilen (Befehl A: 4/4 grün, gepinnte Log-Zeile mit `anfragen=6 seiten=6 pool=1 vollstaendig=true`; Befehl B: 23/23 grün; Befehl C: 90/90 grün; Befehl D: 2922/0, isolierter Flake in `w5-abo-allowlist-gate.test.js` per Flake-Protokoll entkräftet).

Der finale Safety-Review bestätigt das Abnahmekriterium **unabhängig als erfüllt**, inklusive sieben einzeln angewandter und zurückgenommener Mutationstests am wiederhergestellten HEAD (jede prüft, dass ein konkreter Wächter tatsächlich falsifizierbar ist):

1. `number_of_characters` → `characters`: `P6-2`/`P6-5`/`P6-6` rot.
2. `record_type`-Wächter entfernt: `P6-3c` rot.
3. `provider`-Wächter entfernt: `P6-3a` rot (beide Wächter damit unabhängig voneinander falsifizierbar — genau der Blocker aus Fix-Runde r1 ist behoben).
4. `ANCHOR_ID_FIELD` `call_control_id` → `telnyx_leg_id`: `P6-5`/`P6-6` rot.
5. `telnyx_leg_id`/`call_leg_id` in `SESSION_ID_FIELDS` aufgenommen: `P6-5` rot (der Köder `BAIT_LEG_ID` beißt wirklich).
6. Tenant-Routing hart auf `tenant_tts_a` verdrahtet: `P6-5` rot.
7. `bookablePool` fail-open (`complete:false` durchgereicht): `P2-4` in `cost-truing-pool.test.js` rot — der Geldpfad-Riegel ist nach der Verschiebung weiter bewacht.

---

## 6. Safety-Urteil, Clean-Code-Audit, Fix-Runden, offene Punkte/Deviations

### 6.1 Safety-Urteil

**Verdikt: FREIGABE** (`approved: true`).

Feld-Zusammenfassung aus dem finalen Safety-Review: `testsPassIndependently: true` (2924), `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `moneyPathFailClosed: true`, `fixturesHonest: true`, `redBeforeGreenProven: true`, `noGuessedQueryParam: true`, `scopeRespected: true`, `behaviorAsIntended: true`. **Keine Blocker.**

Kernaussagen aus dem Verdikt-Text:

- **Geldpfad:** Die Zuordnung ist *verschoben*, nicht verändert — `anchoredSessionIds`, `assignmentOutcome` und `toCostRecord` sind im Diff unangetastet; `toCostRecord` bekommt allein das Feld `ttsCharacters` angehängt, das nachweislich keine Ablehnungsquelle ist (steht hinter allen vier Reject-Zweigen). `bookablePool`, `refundProven`, `classifyRecords` und die `via_`-Zähler in `logCostRecordsOk` sind unverändert; `requests`/`pages`/`records`/`incomplete` sind reine Telemetrie, von keiner Geld-Entscheidung gelesen. `sumIntegerField` ist zur bisherigen `billedSec`-Reduktion semantisch identisch. `ok:false` erzeugt weiterhin `measured=null`, nie „Kosten 0".
- **Fixtures:** gegen Spec A1 geprüft und ehrlich — korrekte Feldformen, Köder-Pflicht erfüllt (`BAIT_LEG_ID`, in Mutation 5 wirksam bewiesen), Null-Zwillinge in `P6-5` vorhanden und in der Summe geprüft (4.226.660 bzw. 5.337.000 Mikro-Cent), Fehlbuchungs-Falle (fremde Session mit 9999 Zeichen) landet bei keinem der beiden Tenants.
- **Query:** unverändert, ausschließlich `filter[record_type]`, `page[size]`, `page[number]`.
- **Rest:** keine neue Env-Variable, keine npm-Dependency, kein Deploy/Netz/echter Anruf. Die DB-Änderung ist eine additive Spalte (keine neue Tabelle, keine neue RLS-Policy — bestehende `tenant_isolation` trägt sie); beide Backends real getestet (`t3` json-Reload, `t4` PGlite-Rundlauf inkl. Re-Init aus der Spalte). Doppelzählung ist über `costTruedAt` geriegelt und in `P6-6` gepinnt. `usage.ttsCharacters` hat laut grep keine Konsumenten außerhalb des Stores und fällt nicht durch die Whitelist-Projektion `usageView` — kein Leck nach `/api/state`. Safety-Gates, Offenlegungssatz, Auth und Signaturprüfung sind vom Diff nicht berührt; die neue Log-Zeile trägt nur Zähler (kein Key, keine Rufnummer, keine Session-/Leg-ID).

**Concerns (kein Blocker, für Folgephasen/Deploy-Checkliste festzuhalten):**

1. `P6-7` (`test/cost-truing-tts-characters.test.js:167`) ist **nicht tragend**: die Fixture enthält ausschließlich fremde `sip-trunking`-Belege (kein Anker, kein zugeordneter TTS-Beleg); der Test bleibt auch bei einer fail-open-Mutation von `bookablePool` grün. Der echte Riegel für diese Eigenschaft ist `P2-4` in `test/cost-truing-pool.test.js`. Empfehlung: Fixture um einen Anker- + zugeordneten ElevenLabs-Beleg ergänzen.
2. `src/billing/cost-truing.js:479` bucht die TTS-Zeichen auch dann, wenn `measured.source === "incomplete"` (Pflicht-Typ-Menge unvollständig, Pool aber `complete`). Da `costTruedAt` den Call danach schließt, ist eine Unterzählung dauerhaft. Kein Geldpfad-Risiko (kein Gate/Meter/Projektion liest `usage.ttsCharacters`), weicht aber vom wörtlichen Spec-Wortlaut „dieselbe fail-closed-Asymmetrie" ab — als bewusste Entscheidung festzuhalten.
3. `vollstaendig=true` steht auch bei 0 Kandidaten (0 Abrufe) und bei einem reinen Twilio-Sweep (`NO_POOL_FETCH`, `incomplete:false`). Im Code kommentiert und durch `P6-9` gepinnt, aber **KE-P8 muss auf `anfragen` schwellen, nicht auf `vollstaendig`** — sonst liest der Bruchpunkt-Wächter „alles gut" für einen Sweep, der nie abgerufen hat.
4. Harness-Falle (kein Code-Defekt): der vorgegebene Schritt `ln -s ./node_modules node_modules` erzeugt im Worktree einen selbstreferenziellen Symlink; `npm test` bricht dann sofort mit Exit 194 ab. Der Reviewer hat den Link auf das `node_modules` des Haupt-Repos umgehängt.

### 6.2 Clean-Code-Audit (S1–S4)

**Verdikt: PASS.** `s1: []`, `s2: []`, `blocker: false`.

**s3** (Kann-Verbesserung):
> `src/billing/cost-truing.js` (`nonNegativeCount` vs. `sumIntegerField`) — zwei fast identische Guards (`Number.isSafeInteger(n) && n>=0 ? n : 0` bzw. `...&& r[field]>0 ? r[field] : 0`) im selben Modul, unterschiedliche Grenze (`>=` vs. `>`) und unterschiedlicher Zweck (Telemetrie-Zähler vs. Provider-Mengenfeld) rechtfertigen getrennte Funktionen; kein Blocker, nur eine mögliche weitere G5-Verdichtung, falls ein drittes Vorkommen dazukommt.

**s4** (Stil):
> `src/billing/cost-truing.js:trueOneCall` — `if (measured) bookCorrectionFor(...); if (measured) bookTtsCharactersFor(...);` zwei aufeinanderfolgende Zeilen mit identischer Bedingung ließen sich zu einem Block zusammenfassen; rein kosmetisch, ändert nichts an Lesbarkeit oder Korrektheit.

**Verdikt-Text (final, wörtlich zusammengefasst):** Diff KE-P6 (`7b2c8c1` + `b136cd3`, `master..phase/ke-p6-observability-fix1`) deckt sich exakt mit der Spec, keine Scope-Überschreitung. Alle 297 direkt betroffenen Tests (neue + Nachbar-Suiten, inkl. pg-Migrations-Idempotenz und `api-state`-Whitelist) laufen isoliert grün gegen den echten Branch-Stand.

Hervorgehobene Positiv-Punkte (`passNotes`): `sumIntegerField()` vereinheitlicht `billedSecTotal`/`ttsCharacters` (löst genau den Duplizierungs-Fehlertyp, den der Auftrag als Risiko benennt); G13-Grenzfall (zwei Konstanten mit demselben String `"elevenlabs"`) bewusst **nicht** vereinheitlicht, mit begründetem Kommentar (zwei unabhängige Provider-Verträge, die getrennt driften können) — korrekte, begründete Ausnahme; keine Magic Numbers ohne Konstante; keine Umlaute im Diff; keine brüchigen Datei:Zeile-Verweise; kein auskommentierter Code, kein TODO/FIXME/`.skip`/`.only`/`eslint-disable`; `ttsCharacters` grep-verifiziert nur in den erwarteten 6 Dateien, kein Leak in die `/api/state`-Projektion; Schema-Migration idempotent und erbt RLS korrekt; `fetchCostRecordPool` liefert `requests`/`pages` jetzt auch im Fehlerpfad — mit Test `P6-10` explizit bewiesen.

`topTodos`: kein Pflicht-To-do vor Merge. Optional: `bookCorrectionFor`/`bookTtsCharactersFor` unter einem `if (measured) { … }`-Block bündeln (S4); bei einem dritten Vorkommen des „safe-int-else-0"-Guards eine gemeinsame Helferin erwägen (S3, aktuell keine echte Duplikation).

### 6.3 Fix-Runden

**Eine Fix-Runde (r1).** Aus dem Quellmaterial (`=== FIXES ===`, wörtlich, Text bricht ab):

> r1: Einziger genannter Blocker behoben: P6-3 in test/telnyx-cost-records.test.js war ein einzelner Test mit zwei gebuendelten Bedingungen (chars:"viele", provider:"aws-polly"), sodass er gruen blieb, wenn man in elevenLabsCharactersOf (src/telephony/adapters/telnyx/voice.js:370-373) NUR den Provider-Wae[…]

Ergänzend aus dem finalen Clean-Code-Audit, das die abgeschlossene Fix-Runde bestätigt: der D3-artige Fixture-Fehler in `P6-3` (`chars:"viele"` + `provider:"aws-polly"` in **einem** Beleg, beide Wächter einzeln entfernbar ohne roten Test) wurde in Commit `b136cd3` korrekt in drei isolierte Fälle aufgeteilt — `P6-3a` (Provider-Check), `P6-3b` (Parser), `P6-3c` (`record_type`-Check) —, jeder pinnt genau einen Wächter, Mutationstest im Commit dokumentiert. Der finale Safety-Review hat diese Trennung eigenständig über zwei separate Mutationen (Provider-Wächter entfernt → `P6-3a` rot; `record_type`-Wächter entfernt → `P6-3c` rot) verifiziert — beide Wächter sind seither unabhängig voneinander falsifizierbar.

Nach dieser Fix-Runde: finaler Stand `approved: true`, Clean-Code `blocker: false`, keine weiteren Runden nötig.

### 6.4 Offene Punkte / Deviations

**Deviations (dokumentiert im Impl-Report, s. auch Abschnitt 2):** Test-Harness-Nacharbeit (`recordTenantTtsCharacters` im Stub-Store), TDZ-Reihenfolge-Korrektur (`NO_POOL_FETCH` vor `NO_COST_RECORDS`), zwei Testfixtur-Korrekturen (Array-Wrapping in `stubFetchByRecordType`, `created_at` auf TTS-Belegen weggelassen) — alle inhaltlich identisch zur Plan-Zusage, nur technische Korrekturen.

**Aus den Safety-Concerns offen für Folgephasen (kein Blocker, s. 6.1):**

1. `P6-7` ist nicht tragend — Fixture sollte um Anker + zugeordneten ElevenLabs-Beleg ergänzt werden, damit der Test seine eigene Aussage falsifizieren kann.
2. TTS-Zeichen werden auch bei `measured.source === "incomplete"` gebucht (dauerhafte Unterzählung möglich, kein Geldpfad-Risiko) — Abweichung vom wörtlichen Spec-Wortlaut, als bewusste Entscheidung im Deploy-Kontext festzuhalten.
3. `vollstaendig=true` bei 0 Kandidaten/reinem Twilio-Sweep ist by design so gepinnt (`P6-9`) — **KE-P8 muss den Bruchpunkt-Wächter auf `anfragen` schwellen, nicht auf `vollstaendig`**, sonst blind im genau dem Störfall, den der Wächter fangen soll.

**Ausdrücklich nicht Teil dieser Phase** (aus Plan Abschnitt 7, zur Vollständigkeit): `COST_TRUING_SWEEP_INTERVAL_MS`/`COST_TRUING_DELAY_MINUTES` (KE-P6B), Bruchpunkt-Schwelle 1.440 (KE-P8), API-/Dashboard-Sichtbarkeit des Tenant-Zählers, Rückbau des `ai-voice-assistant`-Pfads, Belegtabelle/Wasserstand.

**Bewusste Risiken aus dem Plan (Abschnitt 7), vom Safety-Review bestätigt/eingeordnet:**

- `poolRun` ist ein veränderlicher Kontext durch die Abrufkette, trägt ausschließlich Telemetrie — bewusst gegen einen größeren Blast-Radius im Geldpfad abgewogen.
- Der Tenant-Zeichenzähler ist eine Lebenszeit-Summe ohne Zyklus/Warnschwelle (kein zweiter `platformTtsUsage`-Mechanismus) — ein späterer Kontingent-Bedarf je Tenant ist eine eigene Phase.
