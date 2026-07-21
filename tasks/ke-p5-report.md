# Phasenbericht KE-P5 — `since` aus den Kandidaten ableiten

**Gate: PASS**
**finalBranch:** `phase/ke-p5-since`
**Basis:** `master` (KE-P0–P4 gemergt, `1687f0f`)
**headCommit:** `8019b60d876226570fa5bf2e22590b34a839068c`

---

## 1. Was geändert wurde

Kern der Änderung: `fetchCostRecordPools(candidates)` bestimmt seit KE-P5 **einmal je Sweep**, **vor** der Provider-Schleife und rein synchron (kein zusätzliches Netz-`await`, PM-5-Auflage bleibt gewahrt), eine Zeitschranke `since` aus dem **ältesten** Kandidaten (`endedAt`) minus einer 1‑Stunden-Marge und reicht sie an `fetchCostRecordPool({ since })` durch. Ohne Kandidaten bzw. ohne brauchbaren `endedAt` bleibt `since` `undefined` (kein Beleg geht verloren, nur mehr Anfragen). Ein unbrauchbarer `endedAt` fällt aus der Minimum-Bildung heraus statt als `NaN` bis in `new Date(NaN).toISOString()` durchzuschlagen (würde werfen, Sweep bräche mitten in der Kandidatenliste ab).

**Geänderte/erzeugte Dateien:**

- `src/billing/cost-truing.js` — Kern-Change:
  - neu: `endedAtMs(call)` — **eine** Parse-Stelle für `isTruingCandidate` UND `poolSinceFor` (löst eine G5-Duplizierung: vorher zwei separate `Date.parse`-Ausdrücke)
  - neu: `POOL_SINCE_MARGIN_MS = 60 * MS_PER_MINUTE` — modul-lokale benannte Konstante (kein Env, kein Operator-Knopf), hergeleitet aus `MAX_CALL_DURATION_S` (`config.js`, hart gedeckelt auf max 300 s) × 12 + Reserve für Uhr-Versatz
  - neu: `poolSinceFor(candidates)` — bildet das Minimum über `endedAtMs`, liefert `undefined` bei leerer/ungültiger Menge
  - `isTruingCandidate` nutzt jetzt `endedAtMs(call)` statt eigenem `Date.parse`
  - `fetchCostRecordPoolFor(provider, since)` — neuer zweiter Parameter, reicht `since` an `control.fetchCostRecordPool({ since })` durch (bleibt bei 2 Argumenten, ≤3, F1 ok)
  - `fetchCostRecordPools(candidates)` — bestimmt `since` einmal via `poolSinceFor(candidates)` vor der Schleife, übergibt es an jeden `fetchCostRecordPoolFor`-Aufruf
- `src/telephony/adapters/telnyx/voice.js` — nur Kommentar (C2): Kopfkommentar von `fetchCostRecordPool` aktualisiert (Tempus „wird gesetzt" statt „wird erst ab KE-P5 gesetzt")
- `src/telephony/ports.js` — nur JSDoc (C2): Kommentarzeile zu `since` aktualisiert
- `test/cost-truing-harness.js` — geteilte Test-Bausteine ergänzt (G5, verhindert S2-Duplikat zwischen den beiden Testdateien): `stubCountingFetch`, `measuredSipTrunkingRecord`, `foreignSipTrunkingPage`, `MEASURED_PAGE_SIZE`, `NEVER_LAST_PAGE_TOTAL`, Köder-Konstante `BAIT_LEG_ID`
- `test/cost-truing-pool.test.js` — nutzt jetzt den geteilten Stub aus dem Harness (lokale Kopie von `stubCountingFetch` gelöscht); Test `(P3-3)` auf `nowMs` als Beleg-Zeitstempel umgestellt (PM-P5-c: sonst würde `since` die eigene Zusage dieses Tests — „Seitenobergrenze beendet die Schleife" — unbemerkt aushebeln)
- `test/cost-truing-since.test.js` **(neu)** — einzige neue Produktiv-/Testdatei, 5 Tests `(P5-1)`–`(P5-5)`; bewusst als eigene Datei angelegt (PM-P5-d: die modul-globale Drossel des Telnyx-Adapters erlaubt 30 Anfragen je realer UTC-Minute pro Testprozess; `cost-truing-pool.test.js` verbraucht bereits 17, die neuen anfragezählenden Tests kämen sonst in eine gemeinsame Datei an die 30 heran)

Zuordnungslogik (`anchoredSessionIds`, `assignmentOutcome`, `toCostRecord`, `via_`-Zähler, Sweep-Log-Format) wurde **nicht** berührt (Spec A3). Kein neuer Query-Parameter (A4) — `since` bindet ausschließlich die Seitenschleife des Adapters, nie die Query.

Abweichung vom wörtlichen Plantext (dokumentiert): die im Plan gezeigte lokale Konstante `MS_PER_MINUTE = 60*1000` innerhalb von `cost-truing-since.test.js` wurde weggelassen, da sie im Testcode nirgends verwendet wird (toter Code, clean-code G9/G12). Alle Zeitwerte im Test sind bewusst Literale (`P5_NOW`, `EXPECTED_SINCE`). Alle anderen Test-/Quelltext-Änderungen sind byte-identisch zum Plan.

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl** (`redBeforeGreenCommand`):

```
NODE_ENV=test node --test test/cost-truing-since.test.js
(nach den Test-Edits/neuer Testdatei aus Spec 3.4/3.5/4, VOR den src/-Edits aus 3.1-3.3)
```

**Woertliche Ausgabe** (`redBeforeGreenOutput`):

```
(P5-1) undefined !== '2026-07-21T07:00:00.000Z';
(P5-2) undefined !== '2026-07-21T07:00:00.000Z';
(P5-4) 10 !== 6;
(P5-3) und (P5-5) bereits gruen (Bestandseigenschaft bzw. Mutationsschutz).
Summary: tests 5, pass 2, fail 3
```

Ergänzend aus dem Plan-Abschnitt „Rot vor Grün" (identisch dokumentierter Lauf mit ausformulierten Assertion-Meldungen, mit der Wegwerf-Sonde am unveränderten `master` verifiziert):

```
✖ (P5-1) `since` kommt vom AELTESTEN Kandidaten minus Marge …
    AssertionError: Expected values to be strictly equal:
    undefined !== '2026-07-21T07:00:00.000Z'
✖ (P5-2) ein unbrauchbarer endedAt zieht die Schranke NICHT ins Bodenlose
    AssertionError: undefined !== '2026-07-21T07:00:00.000Z'
✖ (P5-4) EIN 3 h alter Kandidat -> genau eine Anfrage je Typ …
    AssertionError: 10 !== 6
✔ (P5-3) …        (Bestandseigenschaft, bewusst schon gruen)
✔ (P5-5) …        (Mutationsschutz, bewusst schon gruen)
ℹ pass 2   ℹ fail 3
```

Gemessene Belege dafür aus der Wegwerf-Sonde: `IST-POOL-PARAMS: [null]` (= `undefined`, kein `since`), `IST-ANFRAGEN: 10` bei Seiten `1..10` (die Seitenobergrenze eines einzelnen Typs, ohne dass `since` je griff), `IST-LEER: 0 fetch` bei leerer Kandidatenliste (Bestandsverhalten, bereits vor dem Fix korrekt).

Die Safety-Prüfung hat diesen Rot-Zustand **selbst reproduziert** (nicht nur geglaubt): `git checkout master -- src/billing/cost-truing.js` im eigenen Review-Worktree, danach derselbe Testlauf — 3 von 5 rot mit exakt denselben Zahlen (`(P5-1)`/`(P5-2)` `since` = `undefined` statt `2026-07-21T07:00:00.000Z`, `(P5-4)` 10 statt 6 Anfragen, weil `sip-trunking` auf `master` die Seitenobergrenze reißt und den ganzen Abruf als unvollständig abbricht). Danach wiederhergestellt, Worktree byte-sauber.

---

## 3. Der grüne Lauf danach + Suite-Zahl

```
$ NODE_ENV=test node --test test/cost-truing-since.test.js
ℹ tests 5   ℹ pass 5   ℹ fail 0

$ NODE_ENV=test node --test test/cost-truing-pool.test.js
ℹ tests 7   ℹ pass 7   ℹ fail 0        # (P3-3) prueft weiter die SEITENOBERGRENZE

$ node --check src/billing/cost-truing.js && node --check src/telephony/adapters/telnyx/voice.js \
  && node --check src/telephony/ports.js
(OK)

$ npm test
ℹ tests 2906   ℹ pass 2906   ℹ fail 0   # gemessene Basis 2901 + 5 neue
```

Suite-Zahl gegen Referenz 2861/0 (aus dem Plan-Kopf zitiert): die im Plan selbst dokumentierte **eigene Vorab-Messung** am unveränderten `master` ergab bereits 2901/0 (Referenz 2861 ist überholt, da KE-P0–P4 zwischenzeitlich Tests gebracht haben — ein erster Lauf zeigte 1 Fehler in `test/f1-geo-onboard.test.js`, isoliert grün (6/6) bestätigt als bekannter Voll-Last-Flake, zweiter Voll-Lauf 2901/0). Nach KE-P5: **2906/2906** (2901 Basis + 5 neue Tests aus `cost-truing-since.test.js`).

Die Safety-Prüfung hat die volle Suite **unabhängig selbst ausgeführt** auf `review-ke-p5` (= `phase/ke-p5-since`): 2906 pass / 0 fail / 0 skipped, Dauer 98,9 s, kein roter Test, Flake-Protokoll nicht nötig. Zusätzlich isoliert: `node --test test/cost-truing-since.test.js test/cost-truing-pool.test.js test/telnyx-cost-records.test.js` → 85/85. Auch die Clean-Code-Prüfung hat die volle Suite eigenständig nachgezogen (aus `git archive`-Checkout, Lehre „git-show-Blob-Falle" beachtet): 2906/2906 grün.

---

## 4. Abnahmekriterium der Phase mit Beleg

Deterministisches Abnahmekriterium aus dem Plan (Abschnitt 6):

```
$ NODE_ENV=test node --test test/cost-truing-since.test.js
ℹ tests 5   ℹ pass 5   ℹ fail 0

$ NODE_ENV=test node --test test/cost-truing-pool.test.js
ℹ tests 7   ℹ pass 7   ℹ fail 0        # (P3-3) prueft weiter die SEITENOBERGRENZE

$ node --check src/billing/cost-truing.js && node --check src/telephony/adapters/telnyx/voice.js \
  && node --check src/telephony/ports.js

$ npm test
ℹ tests 2906   ℹ pass 2906   ℹ fail 0   # gemessene Basis 2901 + 5 neue
```

**`acceptanceEvidence` (Impl-Report, wörtlich):**

> NODE_ENV=test node --test test/cost-truing-since.test.js -> tests 5 pass 5 fail 0. NODE_ENV=test node --test test/cost-truing-pool.test.js -> tests 7 pass 7 fail 0 (P3-3 prueft weiter die Seitenobergrenze, nicht since). node --check auf allen 3 geaenderten src-Dateien -> OK. npm test -> tests 2906 pass 2906 fail 0 (Basis 2901 + 5 neue, kein Flake, sauberer Lauf). Zusaetzlich cost-truing-observe.test.js + cost-truing-booking.test.js (nutzen dieselbe Harness) isoliert nachgezogen: 34/34 gruen.

Zusätzliche Kernzusagen als Beleg (aus dem Plan, mit rot/grün-Zahlen belegt):

- rot heute = **10** Anfragen für einen einzigen 3 h alten Kandidaten (Seiten 1–10 eines Typs, danach bricht der Pool als unvollständig ab);
- grün = **6** Anfragen = `ASSIGNABLE_COST_RECORD_TYPES.length`, Pool `complete:true`;
- leere Kandidatenliste = **0** Anfragen, 0 Schreibzugriffe, 0 Versuche (belegt durch `(P5-3)`, bereits vor dem Fix wahr/erhalten).

Die Safety-Prüfung bestätigt das Abnahmekriterium unabhängig als erfüllt: leere Kandidatenliste → 0 fetch (`P5-3`, inkl. `writes=0` und `attempts=0`); ein 3 h alter Kandidat → exakt 6 Anfragen, Seite 1 je Typ, `page[number]` gepinnt auf `["1"]`.

---

## 5. Safety-Urteil

**Verdikt: FREIGABE** für KE-P5 (Branch `phase/ke-p5-since`, ein Commit `8019b60`, 6 Dateien, +307/-46).

Kernaussagen aus dem Safety-Review (final):

- `approved: true`, `testsPassIndependently: true` (2906), `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, `moneyPathFailClosed: true`, `fixturesHonest: true`, `redBeforeGreenProven: true`, `noGuessedQueryParam: true`. Keine `blockers`.
- Rot-vor-Grün **selbst nachgewiesen** (nicht geglaubt), s. Abschnitt 2 oben.
- **Fixture-Ehrlichkeit** — der Punkt, an dem frühere Ketten laut Notiz zweimal starben — durch **drei Code-Mutationen** falsifiziert, jede einzeln angewandt und zurückgenommen:
  1. `ANCHOR_ID_FIELD` `"call_control_id"` → `"telnyx_leg_id"` (= der Köder): `(P5-5)` wird ROT — genau die Falle von LCT-FIX-1 würde auffliegen.
  2. `SESSION_ID_FIELDS` → `["nope_session_id"]` (Session-Weg gekappt): `(P5-5)` wird ROT mit `actual 0 vs expected 4010000` — wörtlich die Katastrophe „Kosten = 0", der Test fängt sie.
  3. `POOL_SINCE_MARGIN_MS` 60 min → 1 min: `(P5-5)` ROT mit „Seite 2 wurde geholt — eine zu knappe Marge hätte hier abgebrochen", `measured=0`; zusätzlich `P5-1`/`P5-2` fallen. Die Marge ist echt gepinnt, nicht dekorativ.
- Fixtures gegen Spec A1 geprüft (sip-trunking-Form korrekt: `started_at`/`finished_at`, `call_control_id`+`telnyx_session_id`, `cost` als String, `meta` mit `page_size:50`); Null-Zwilling vorhanden **in der schwierigen Reihenfolge** (erster Beleg = Null-Zwilling trägt den Anker, zweiter Beleg trägt das Geld und kommt nur über die Session herein — ein „nimm den ersten Treffer"-Fehler fiele sofort auf); Summe exakt geprüft (4.010.000 Mikro-Cent) plus Buchung 100 → 84.
- Geldpfad: Zuordnungslogik unangetastet (`anchoredSessionIds`/`toCostRecord`/`assignCostRecords` mit null Änderungen im Diff, ebenso `via_`-Zähler); `since` bindet ausschließlich die Seitenschleife, nie die Query, nie den Pool-Inhalt. Asymmetrie erhalten: kein Anker → `records=[]` → `classifyRecords()` liefert `null` → `truedSource=unavailable`, keine Buchung; `ok:false`/`complete:false` lassen weiterhin alle Kandidaten `unavailable`. Kein Pfad erzeugt „Kosten = 0" oder eine Erstattung auf Teilmenge.
- Kein geratener Query-Parameter: grep über `src/`+`test/` zeigt im Belegabruf ausschließlich `filter[record_type]`, `page[size]`, `page[number]`.
- Marge sachlich verifiziert: `config.js:779` klemmt `MAX_CALL_DURATION_S` tatsächlich hart auf max 300 s; Herleitung (12-facher Abstand) stimmt.
- Scope/Regeln eingehalten: keine neue Env-Var, keine Dependency, kein `package.json`, kein `render.yaml`, kein Deploy, kein Netz im Test (`global.fetch` gestubbt), keine schreibenden Telnyx-Aufrufe. Safety-Gates, Offenlegungssatz, Auth/Signaturprüfung unberührt.
- Harness-Hinweis (Betriebsdetail, kein Befund): der vorgegebene Befehl `ln -s "./node_modules" node_modules` erzeugte einen selbstreferenziellen Symlink, `npm test` brach still ab (Exit 194). Der Reviewer hat den Link auf das echte `node_modules`-Verzeichnis umgehängt; `node_modules` ist gitignored, der Worktree danach byte-sauber (`git status` leer).

**Concerns (kein Blocker):**

1. Spec KE-P5 fordert bei leerer Kandidatenliste ein No-op „ohne Befund". Der Sweep läuft weiterhin durch `reportCoverage()`/`reportTariffDrift()`, ein `coverage_below_threshold`-Befund kann also auch ohne Kandidaten feuern — unverändertes Bestandsverhalten (`master` identisch); eine Unterdrückung wäre fail-open an einer geldrelevanten Sonde, der Reviewer wertet den Spec-Wortlaut hier als der fail-closed-Regel nachgeordnet. `(P5-3)` prüft nur `fetch=0`/`writes=0`/`attempts=0`, pinnt „kein Befund" **nicht** — diese Hälfte der Zusage ist unbelegt, Owner-Entscheid offen.
2. KE-P5 schaltet das in KE-P3 benannte Restrisiko („eine ganze Seite vor `since` beendet die Schleife") erstmals produktiv scharf. Die Analyse entlastet: Belege eines Kandidaten liegen bei ≥ `endedAt`−300 s, also ≥ `since`+55 min — eine Seite mit Kandidaten-Beleg kann nie vollständig vor `since` liegen. Ein aufsteigend sortierter Pflicht-Typ (`call-control`) bräche nach Seite 1 ab → Pflicht-Typ fehlt → `incomplete` → keine Rückerstattung (fail-closed). Verlust setzt eine pathologisch nicht-monotone Provider-Sortierung voraus. Für die Live-Verifikation (KE-P7) trotzdem explizit beobachten.
3. `poolSinceFor`: der Zweig `oldestMs===null → undefined` ist produktiv unerreichbar (`isTruingCandidate` lässt nur endliche `endedAt` durch; leere Liste = gar kein Abruf). Als Schutz gegen `new Date(NaN).toISOString()` verteidigungsfähig und kommentiert, aber kein Test beobachtet den `undefined`-Wert am Adapter direkt. Minor, kein Blocker.
4. `(P5-5)` ist vor **und** nach der Änderung grün — vom Autor offen im Kommentar gelegt und der Rot-vor-Grün-Pflicht `P5-1`/`P5-2`/`P5-4` zugewiesen. `(P5-5)` ist stattdessen der Mutationsschutz der Marge; der Reviewer hat seine Wirksamkeit selbst über die drei Mutationen oben nachgewiesen.

---

## 6. Clean-Code-Audit (S1–S4)

**Verdikt: PASS.** `s1: []`, `s2: []`, `s3: []`, `s4: []`, `blocker: false`.

> PASS. Phase KE-P5 (`since` aus dem ältesten Kandidaten-endedAt minus 1h-Marge ableiten) ist sauber umgesetzt und deckt sich exakt mit `tasks/kosten-endspiel/impl-spec.md`. Keine S1/S2/S3/S4-Flags. Alle 4 Design-Regeln (P1) erfüllt: Tests grün (12/12 neue+angepasste Tests, volle Suite 2906/2906), keine Duplizierung (im Gegenteil: G5 wird an zwei Stellen aktiv repariert), präzise Namen/Kommentare, minimale Struktur (2 kleine Funktionen: `endedAtMs` 4 Zeilen, `poolSinceFor` 8 Zeilen).

Hervorgehobene Positiv-Punkte aus `passNotes`:

1. `endedAtMs()` ersetzt zwei vorher separat gepflegte `Date.parse`-Ausdrücke (`isTruingCandidate` + neu `poolSinceFor`) durch **eine** Parse-Stelle — explizit als G5-Fix benannt, im Diff verifiziert (nur noch 1× `Date.parse` im ganzen File).
2. `test/cost-truing-harness.js` konsolidiert `stubCountingFetch` + `measuredSipTrunkingRecord`/`-Page`, die sonst in zwei Testdateien separat gestanden hätten — echte Vermeidung von Test-Duplizierung (alte lokale Kopien in `cost-truing-pool.test.js` wurden gelöscht, nicht nur ergänzt).
3. Der bestehende `P3-3`-Test wurde korrekt nachgezogen (Beleg-Zeitstempel auf `nowMs` verschoben), sonst hätte die neue `since`-Schranke die Zusage dieses Tests unbemerkt ersetzt — sauber begründet und per Testlauf bestätigt.
4. `P5-1` nutzt einen von Hand vorgerechneten Literal-Erwartungswert (`EXPECTED_SINCE`) statt die Prüfformel zurückzurechnen (vermeidet die D3-Falle); von Hand nachgerechnet und korrekt (18:00 − 600 min = 08:00, minus 1 h Marge = 07:00).
5. `POOL_SINCE_MARGIN_MS` ist eine benannte Konstante mit einem der ausführlichsten Herleitungs-Kommentare im Diff (Asymmetrie-Risiko explizit benannt, Herleitung 12× `MAX_CALL_DURATION_S` nachgerechnet und korrekt: 300 s×12 = 3600 s = 1 h; stimmt mit `config.js`-max-Clamp überein).
6. Verifiziert: `DETAIL_RECORDS_BUDGET_PER_MINUTE = 40−10 = 30` — der Kommentar „30 Anfragen je realer UTC-Minute" im neuen Testfile ist korrekt (nicht mit dem rohen Provider-Limit 40 verwechselt).
7. Keine Umlaut-Verstöße (grep bestätigt: 0 Treffer), keine brüchigen Datei:Zeile-Verweise, kein toter/auskommentierter Code, kein TODO/FIXME/`.only`/`.skip`.
8. Implementierung deckt sich 1:1 mit `impl-spec.md` KE-P5. Nur Kommentar-Only-Änderungen in `voice.js`/`ports.js` (Tempus-Anpassung), beide jetzt korrekt.

`topTodos`:
- Kein Blocker vorhanden — Phase kann gemergt werden.
- Optional/kosmetisch (keine echte Flag, nur Beobachtung): `parseSinceMs` (telnyx/voice.js, unverändert seit KE-P3) und das neue `endedAtMs` (cost-truing.js) sind strukturell sehr ähnliche 2-Zeiler (Date.parse + Finite-Check) in unterschiedlichen Schichten — bewusst NICHT geteilt, weil eine Domänen-Datei (billing) sonst in eine providerspezifische Adapter-Datei greifen müsste (wäre G13-künstliche Kopplung); daher nicht als S2 geflaggt.

---

## 7. Fix-Runden

Keine. `=== FIXES ===` im Quellmaterial ist leer — die Phase wurde beim ersten Durchlauf ohne notwendige Nachbesserung freigegeben (PASS direkt).

---

## 8. Offene Punkte / Deviations

**Deviation (dokumentiert im Impl-Report):**

- Die im Plan gezeigte lokale Konstante `MS_PER_MINUTE = 60*1000` in `cost-truing-since.test.js` (Abschnitt 4 des Plans) wurde weggelassen: im gezeigten Testcode nirgends verwendet → toter Code, verstößt gegen clean-code G9 (kein toter Code)/G12 (keine ungenutzten Symbole). Alle Zeitwerte im Test sind bewusst Literale (`P5_NOW`, `EXPECTED_SINCE`), keine Stelle braucht die Konstante.

**Offene Punkte für den Phasenbericht (aus Plan Abschnitt 8, hier explizit NICHT umgesetzt):**

1. **U4 wird durch KE-P5 scharf** (PM-P5-b): Der Abbruch „ganze Seite vor `since`" ist ab jetzt produktiv erreichbar; die Sortierreihenfolge ist für 6 von 7 Belegtypen UNBELEGT. Gehört als Messauflage (je Typ 2 Seiten, Monotonie auf dem typeigenen Zeitfeld) bzw. als Abnahmepunkt `vollstaendig=true` in die KE-P7-Checkliste (`tasks/ke-DEPLOY-CHECKLIST.md`). Deckt sich mit Safety-Concern 2 oben — dort als entlastet analysiert, aber für die Live-Verifikation explizit weiter zu beobachten.
2. **Drossel-Budget je Testdatei** (30 Anfragen/UTC-Minute, PM-P5-d): `cost-truing-pool.test.js` steht nach dieser Phase bei 17 Anfragen, `cost-truing-since.test.js` bei 13 — wer dort weitere anfragezählende Tests ergänzt, muss die Summe prüfen.
3. Aus den Safety-Concerns zusätzlich offen (kein Blocker, aber Owner-Entscheid ausstehend): ob die Spec-Zusage „No-op ohne Befund" bei leerer Kandidatenliste auch das Ausbleiben von `coverage_below_threshold`-Befunden meint (aktuell unverändertes Bestandsverhalten, `(P5-3)` pinnt das nicht) — s. Abschnitt 5, Concern 1.

**Ausdrücklich NICHT in dieser Phase** (aus Plan Abschnitt 7, zur Vollständigkeit): Sweep-Log-Felder `anfragen=/seiten=/pool=/vollstaendig=` (P6), `COST_TRUING_DELAY_MINUTES`/`SWEEP_INTERVAL` (P6b), Bruchpunkt-Wächter (P8), `isPageBeforeSince`/Zuordnungslogik/`via_`-Zähler (A3, unverändert), neue Env-Variable, `render.yaml`/`.env.example`/`BASE_ENV`, Deploy, `tasks/ke-DEPLOY-CHECKLIST.md`.
