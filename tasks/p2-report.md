# Phase P2 — Detailbericht

**Titel:** withStoreLock-Reentrancy strukturell absichern (AsyncLocalStorage-Guard)
**Gate:** PASS
**finalBranch:** `phase/cc-p2-store-reentrancy`
**Basis:** `master`
**headCommit (Worktree):** `94df97f0296419cbc529666b8817be0ebfcdbe17`

---

## 1. Ausgangslage / Ziel

`withStoreLock` (`src/store.js`) ist die einzige, backend-unabhaengige Store-Lock-Fassade (json UND pg identisch betroffen). Die Kern-Mechanik ist `makeChainMutex()` aus `src/chain-mutex.js` (`chain = chain.then(run, run)` — ein gescheiterter Lauf vergiftet die Kette nicht, das ist Grundlage fuer T2 und wird nicht angefasst).

Bislang war die Regel "ein `withStoreLock`-Body darf NIE erneut `withStoreLock` aufrufen" nur als Kommentar (Konvention) dokumentiert — ein echter verschachtelter Aufruf haette die Kette prozessweit zum Deadlock gebracht (chain1 adoptiert chain2, chain2 wartet auf chain1 → Zirkelschluss), der alle folgenden Call-/Budget-/Transkript-Writes still einfriert. P2 macht diese Invariante strukturell hart: ein `node:async_hooks`-`AsyncLocalStorage`-Guard wirft synchron, sobald ein verschachtelter Aufruf erkannt wird, statt still zu haengen.

Kein bestehender `AsyncLocalStorage`-Import im Repo vor P2. Das Safety-Review von P1 enthielt keine offene P2-Auflage (P2 lief unabhaengig).

## 2. Plan (gekuerzt)

### Grounding

- Caller-Audit (Pre-Mortem C) ueber alle heutigen `withStoreLock`-Aufrufer bestaetigt: `release-reconcile.js`, `wiring/web-login.js`, `telephony/call-finish.js`, `telephony/outbound-gates.js`, `worker/provisioning-orchestrator.js` (3x), `routes/api-onboard.js` — jeder awaitet oder catcht, **keiner verschachtelt**. `billing/webhook.js` nutzt bewusst `makeKeyedChainMutex` statt `store.withStoreLock` (eigener Kommentar dokumentiert die HARD-RULE). Folgerung: der Guard feuert bei keinem heutigen Aufrufer — kein Verhaltenswechsel fuer den Live-Betrieb.

### Geplante Edits in `src/store.js`

1. Import `AsyncLocalStorage` aus `node:async_hooks` (Node-Built-in, keine neue npm-Dependency).
2. Modul-lokal: `const storeLockContext = new AsyncLocalStorage();` + `const REENTRANCY_MARKER = Symbol("store-lock-active");` (benannte Konstante/Sentinel, kein Magic Literal).
3. `withStoreLock(fn)`:
   - wirft **synchron**, wenn `storeLockContext.getStore()` bereits gesetzt ist (bevor ein weiterer `.then` an die Kette gehaengt wird — sonst reiht sich der innere Lauf hinter dem aeusseren ein, auf den er wartet → Deadlock);
   - sonst: `runStoreExclusive(() => storeLockContext.run(REENTRANCY_MARKER, fn))` — der Marker wird erst gesetzt, wenn der Lauf tatsaechlich innerhalb der Kette startet, nicht schon bei der Registrierung, damit ein legitimer **nachrueckender** (nicht verschachtelter) Aufruf den Marker nicht erbt.
   - HARD-RULE-Kommentar aktualisiert: von "nur Konvention/Deadlock-Warnung" auf "strukturell erzwungen", inkl. Begruendung gegen ein simples Modul-Boolean-Flag (wuerde legitime nebenlaeufige, nicht verschachtelte Aufrufe faelschlich abweisen).

### Neue Testdatei `test/store-lock-reentrancy.test.js` (geplant, T1-T4)

- **T1**: direkter verschachtelter Aufruf → synchroner `reentrant`-Throw, kein Deadlock (mit Watchdog statt `node:test`-Timeout, damit ein Deadlock als eigene sprechende Meldung statt Suite-Timeout sichtbar wird).
- **T2**: nach gescheitertem Nest laeuft ein folgender, unabhaengiger `withStoreLock`-Aufruf normal weiter (kein prozessweites Einfrieren, Regression-Schutz fuer die `chain-mutex.js`-Recovery).
- **T3**: zwei parallele, **nicht** verschachtelte Aufrufe laufen beide erfolgreich und seriell durch (`maxConcurrent === 1`, feste Reihenfolge) — der gefaehrlichste False-Positive-Fall (Guard darf legitime Nebenlaeufigkeit nicht abweisen).
- **T4**: Reentrancy wird auch ueber eine `await`-Schicht im Body hinweg erkannt (nur mit `AsyncLocalStorage` moeglich, ein synchron zurueckgesetztes Flag wuerde das durchlassen).

### Pre-Mortem A-D (aus dem Plan)

- **A (false-positive):** groesste Regressionsgefahr; adressiert durch `AsyncLocalStorage` statt Modul-Flag + T3 + bestehende Concurrency-Guards (`outbound-budget-concurrency`, `store-integrity`).
- **B (Guard feuert nicht):** T1+T4 mit Watchdog falsifizieren das (rot statt Suite-Timeout).
- **C (Throw → unhandled rejection):** Caller-Audit zeigt, alle heutigen Aufrufer awaiten/catchen — ein kuenftiger Nest-Throw waelzt sich als Rejection der aeusseren, ohnehin behandelten Kette um.
- **D (pg-Pfad):** Guard sitzt auf der Fassade, identisch fuer json und pg.

### Scope-Abgrenzung (Plan)

Nur `src/store.js` (zwei Edits) + neue `test/store-lock-reentrancy.test.js`. Keine Aenderung an Safety-Gates, Disclosure, Auth, an anderen Callern, an `chain-mutex.js`/`single-flight.js`, keine neue npm-Dependency, keine anderen Phasen. Geplanter Blast-Radius: zwei Dateien.

## 3. Implementierung — Zusammenfassung

Exakt gemaess Plan umgesetzt, Branch `phase/cc-p2-store-reentrancy` von `master` abgezweigt.

- **`src/store.js`**: Import von `AsyncLocalStorage` aus `node:async_hooks`; modul-lokale `storeLockContext` + `REENTRANCY_MARKER` (Symbol); `withStoreLock` wirft synchron bei erkannter Reentrancy (`storeLockContext.getStore()` gesetzt), bevor an `runStoreExclusive` gehaengt wird — sonst laeuft `fn` ueber `storeLockContext.run(REENTRANCY_MARKER, fn)` innerhalb der bestehenden Chain-Mutex-Kette.
- **`chain-mutex.js` und `single-flight.js` unangetastet** — `git diff --name-only` dagegen bestaetigt leer.
- **Neue Datei `test/store-lock-reentrancy.test.js`** mit T1-T4 wie geplant, inkl. Watchdog-Timer (1000ms) statt `node:test`-Timeout.

### Ergebnisse

- `node --check src/store.js` → exit 0.
- `node --check test/store-lock-reentrancy.test.js` → exit 0.
- Neue Tests T1-T4 isoliert gruen.
- Regression-Guards `store-integrity.test.js` + `outbound-budget-concurrency.test.js` gruen.
- Volle Suite: **2318 pass / 0 fail** (kein Skip).
- `grep -rn "withStoreLock" src/` bestaetigt identische Aufruf-Callsites wie im Ist-Zustand (`release-reconcile.js`, `wiring/web-login.js`, `telephony/call-finish.js`, `telephony/outbound-gates.js`, `worker/provisioning-orchestrator.js` 3x, `routes/api-onboard.js`) — kein neuer ungeawaiteter/ungecatchter Aufrufer.
- Smoke-Test: Server mit `SKIP_TWILIO_SIGNATURE_CHECK=true` + Dummy-Env-Werten (kein `.env` im frischen Worktree) + per `scripts/bootstrap-tenant.js` geseedter Nummer erfolgreich gestartet, `GET /healthz` → HTTP 200 `{"ok":true}`.
- `node_modules`-Symlink nach Abschluss entfernt, nicht committet.
- Commit `94df97f` auf `phase/cc-p2-store-reentrancy` (2 Dateien: `src/store.js` + `test/store-lock-reentrancy.test.js`), **nicht** auf `master` gemergt (Merge-Entscheidung liegt beim Lead/Orchestrator gemaess Lean-Phasen-Workflow).

### Deviations

**Keine.** (`deviations: []` im Impl-Report)

### Clean-Code-Selbstcheck (Impl)

- **G25** (Magic Numbers): `WATCHDOG_MS` als benannte Konstante im Test; `REENTRANCY_MARKER` als benanntes Symbol statt String-Literal.
- **G12** (ungenutzte Imports): keine — `AsyncLocalStorage` wird direkt verwendet.
- **F1** (Argumente): `withStoreLock` behaelt exakt 1 Argument.
- **N7** (Nebeneffekte im Namen): Semantik unveraendert, Wurf ist Teil der dokumentierten HARD-RULE, nicht versteckt.
- **P15** (Lazy-Init-Antipattern): `storeLockContext` ist Modul-Top-Level-Konstruktion, keine Laufzeit-Lazy-Init.
- **C5/G9** (toter/auskommentierter Code): keiner eingefuehrt.
- **C2** (bruechige Datei:Zeile-Kommentare): keine Zeilenverweise in neuen Kommentaren, nur konzeptionelle Beschreibung.
- **P13/P14** (Tests): Build-Operate-Check-Struktur je Test, ein Konzept pro Test (T1-T4 klar getrennt).
- **P12 F.I.R.S.T.**: keine echten Netz/DB/Uhr-Abhaengigkeiten (Watchdog nutzt `setTimeout` nur als Deadlock-Deadline), Tests unabhaengig.
- Keine neue npm-Dependency (`node:async_hooks` ist Node-Built-in). Kommentare deutsch ohne Umlaute, wie Bestand.

## 4. Safety-Urteil (final)

**APPROVED.**

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true
- `blockers`: keine
- `concerns`: keine

**Unabhaengiger Testlauf** (frischer `review-p2`-Worktree, Node v26):

- `node --check src/store.js` → 0.
- Gezielter Lauf `store-lock-reentrancy` (T1-T4) + `store-integrity` + `outbound-budget-concurrency` = **14/14 gruen** (beide Pflicht-Regression-Guards gruen, kein False-Positive-Guard).
- Volle Suite `npm test` = **2318 pass / 0 fail**, deckt json UND pg ab (pglite `-pg.test.js`).
- Vier zusaetzliche adversarielle Checks:
  - **A1**: verketteter Aufruf nach aufgeloestem Lock → OK (Marker wird nicht vererbt).
  - **A2**: 20 gleichzeitige nicht-verschachtelte Aufrufe → `maxConcurrent = 1`, 0 Fails (kein False Positive).
  - **A3**: Reentrant-Throw-Stacktrace zeigt auf die schuldige Aufrufer-Zeile.
  - **A4**: `setImmediate` innerhalb eines gehaltenen Locks geplant → wirft korrekt `reentrant` (transitive Verschachtelung erkannt, laut + synchron, kein stiller Deadlock).

**Begruendung (Kurzfassung):** P2 implementiert die Reentrancy-HARD-RULE strukturell exakt wie spezifiziert (modul-lokale `storeLockContext`, synchroner Eintritts-Throw mit Stack auf die aufrufende Zeile, `runStoreExclusive(() => storeLockContext.run(MARKER, fn))`) — **kein** Modul-Boolean. Scope ist eng: nur `src/store.js` `withStoreLock` + neue Testdatei; `chain-mutex.js`/`single-flight.js`-Diffs leer; keine neue npm-Dependency (`node:async_hooks` ist Built-in). Kein False Positive bei legitimer Nebenlaeufigkeit oder verkettet-nach-Aufloesung (T3 + A1/A2 bestaetigen serialisierten Erfolg); Reentrancy wird transitiv ueber `await`- und `setImmediate`-Grenzen erkannt (T4 + A4). Kein heutiger Aufrufer verschachtelt `withStoreLock` (grep bestaetigt: Store-Ops locken sich nicht selbst — nur Kommentare in `state-ops`/`json`; `billing/webhook.js` vermeidet Verschachtelung explizit), verhaltensidentisch fuer alle heutigen Aufrufer, bestaetigt durch die volle gruene Integrationssuite. Absolute Regeln intakt: Safety-Gates, `disclosureSentence`, Auth/`safeEqual` unangetastet (nicht im Diff); die Fehlermeldung ist statisch, ohne Secret-/State-Interpolation, kein neues Logging; keine Audio-/MCP-Oberflaeche beruehrt. DoD vollstaendig erfuellt.

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — `blocker: false`

> Der P2-Diff (`src/store.js` + `test/store-lock-reentrancy.test.js`, 34+/100+ Zeilen) haertet die bereits vorher als HARD-RULE dokumentierte Store-Lock-Reentrancy-Invariante strukturell ab (AsyncLocalStorage-Marker statt reiner Konvention). Analyse der zugrundeliegenden Ketten-Mechanik (`chain-mutex.js`) bestaetigt: ein echter verschachtelter `withStoreLock`-Aufruf haette vor diesem Diff tatsaechlich prozessweit deadlocked (chain1 adoptiert chain2, chain2 wartet auf chain1 → Zirkelschluss) — die neue synchrone Pruefung verhindert das nachweisbar, bevor der zweite `.then` an die Kette gehaengt wird. Volle Suite (2318/2318, 0 Fail) lief gruen gegen den exakten Commit `94df97f` in einem isolierten Worktree, inkl. der 4 neuen Tests. Keine S1/S2-Befunde. Kein Blocker.

### S1-S4-Befunde

| Stufe | Befunde |
|---|---|
| **S1** (Blocker) | keine |
| **S2** (Blocker) | keine |
| **S3** | keine |
| **S4** | keine |

### Pass-Notes (positiv, kein Flag)

1. **G27 "Struktur > Konvention"** wird durch diesen Diff explizit umgesetzt — vorher stand die Reentrancy-Regel nur als Kommentar (Disziplin), jetzt erzwingt Code sie strukturell (Symbol-Sentinel + `AsyncLocalStorage`).
2. **P16-Nebenlaeufigkeit sauber:** kein geteilter mutierbarer Boolean/Flag (haette parallele, nicht-verschachtelte Aufrufe faelschlich abgewiesen — False Positive), sondern korrekt an EINE Ausfuehrungs-Kette gebundener Marker; der Kommentar begruendet exakt, warum kein Modul-Flag verwendet wird.
3. **Testabdeckung** trifft alle vier relevanten Faelle: T1 direkte Verschachtelung, T2 Recovery nach Reentrant-Fehler (kein Freeze danach), T3 echte Parallelitaet ohne Verschachtelung (der gefaehrlichste False-Positive-Fall, explizit benannt), T4 transitiv ueber eine `await`-Schicht. Build-Operate-Check (P13) sauber, ein Konzept pro Test (P14), F.I.R.S.T. eingehalten (Watchdog gegen echtes Haengenbleiben statt Suite-Timeout, `tempDataDir` statt `data/store.json`).
4. **G5:** `tempDataDir`-Helper wiederverwendet statt dupliziert, konsistent mit `outbound-budget-concurrency.test.js`.
5. Kommentare praezise, ohne Umlaute (Repo-Konvention eingehalten), kein Auskommentiertes, keine Autoren-/Datums-Metadaten.
6. Reale Aufrufstelle (`webhook.js`) hat die Nicht-Verschachtelung bereits **vor** diesem Diff bewusst dokumentiert vermieden — der neue Guard bricht daher keinen bestehenden Live-Pfad (durch vollen Suite-Lauf verifiziert, nicht nur behauptet).

### Top-Todos (optional, kein Muss-Fix)

- Kein Muss-Fix noetig. Optional (rein kosmetisch, kein Flag): der Throw-Pfad in `withStoreLock` koennte per JSDoc am Export explizit als "wirft synchron bei Reentrancy" markiert werden, falls spaeter weitere Caller ausserhalb von async-Funktionen entstehen sollten.
- Bei kuenftigen neuen `withStoreLock`-Callern (v.a. tief verschachtelte Provisioning-/Webhook-Ketten) den bestehenden `webhook.js`-Kommentar-Praezedenzfall als Vorlage nehmen: explizit dokumentieren, warum NICHT genestet wird, statt sich auf den Runtime-Throw als einzige Absicherung zu verlassen.

## 6. Fix-Runden

**Keine.** Der Diff wurde im ersten Anlauf approved (Safety: APPROVED ohne Blocker/Concerns; Clean-Code: PASS ohne S1/S2). Der `=== FIXES ===`-Abschnitt der Quelle ist leer — es waren keine Nacharbeiten noetig.

## 7. Ergebnis

| Kriterium | Status |
|---|---|
| Gate | **PASS** |
| Safety-Review | APPROVED, keine Blocker, keine Concerns |
| Clean-Code-Audit | PASS, S1-S4 alle leer |
| Tests | 2318/2318 gruen (inkl. 4 neue T1-T4) |
| Diff-Blast-Radius | 2 Dateien (`src/store.js`, `test/store-lock-reentrancy.test.js`) |
| `chain-mutex.js`/`single-flight.js` | unveraendert (verifiziert) |
| Neue npm-Dependency | keine (`node:async_hooks` Built-in) |
| Merge auf `master` | **noch offen** — liegt beim Lead/Orchestrator |
