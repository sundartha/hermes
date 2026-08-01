# Phase AL-D1 — Zwei Live-Befunde: Ursache messen

**Status:** Gate = PASS
**finalBranch:** `phase/al-d1-diagnose`
**headCommit:** `6df6020`
**Basis:** `master` @ `6fe738f`
**Art der Phase:** reine Diagnose — kein Fix, wie von der Spec (`tasks/assistant-leap-chain.md`, Abschnitt „AL-D1") gefordert.

Zwei Live-Befunde aus dem ersten Ende-zu-Ende-Anruf (`call_msabz9975sph`) sollten ursaechlich geklaert werden, ohne sie zu fixen:

- **Befund A:** `get_consult` feuert nie.
- **Befund B:** Token-Streaming streamt nicht (`streamChunks:0`).

---

## 1. Plan (gekuerzt)

### 0. Liefergegenstand

Die Spec verbietet einen Fix vor dem Beleg. Der Plan liefert drei Dinge:

1. **Beweis am Code** — der naheliegendste Verdacht der Spec (geteilter Zaehler zwischen Consult #0 und In-Call-Consult) wird **falsifiziert**; fuer Befund B liegt eine vollstaendige, offline reproduzierbare Ursachenkette vor.
2. **Ein Messinstrument** — drei rein additive, PII-freie Felder in der bestehenden `[telnyx-shim] turn_ok`-Zeile (`offeredToolNames`, `streamArmedRounds`, `consultPollFresh`). Ohne sie ist eine Tatsache pro Anruf strukturell unbeobachtbar: ob `get_consult` dem Modell ueberhaupt *angeboten* wurde (nicht nur, ob es *gefeuert* wurde).
3. **Dieser Bericht** mit den Belegen plus offenen Owner-Fragen.

Kein Fix: weder `MAX_IN_CALL_CONSULTS_PER_CALL`, noch `CONSULT_POLL_FRESH_MS`, noch die Armierungsregel in `streamSinkFor` werden angefasst.

### 1. Befund B — Ursachenkette am Code vollstaendig

`streamSinkFor` (`src/claude.js`) armiert den Streaming-Sink nur, wenn der Werkzeugsatz **ausschliesslich** aus Seiteneffekt-Werkzeugen besteht (`SIDE_EFFECT_ONLY_TOOL_NAMES = end_call, take_message`). `agentTools(call)` legt zusaetzlich `get_consult` (bei `consultAvailableFor`) und `look_up` (bei `lookupAvailableFor`) in denselben Satz.

**Folgerung:** sobald `look_up` **oder** `get_consult` in einem Anruf armiert ist, ist `sink === null` in **jeder Runde jedes Turns** → `completeStream()` wird nie gerufen → `streamChunks:0`. Genau das Live-Bild.

Das ist **kein Defekt**, sondern die gepinnte Zusage von AL-P7 (`test/al-p7-turn-streaming.test.js`, `AL-P7-20`, gruen). Grund laut Code-Kommentar: Text einer nicht-armierten Runde kann noch verworfen (naechste Runde ueberschreibt `speech`) oder ersetzt werden (`get_consult` setzt den Ueberbrueckungssatz) — „gesprochen ist gesprochen".

**Zweite, unabhaengig hinreichende Ursache (noch nicht ausgeschlossen):** `roundFitsDeadline` (Bedingung 3) kippt bei `LLM_REQUEST_TIMEOUT_MS > 11500` oder grossem `ELEVENLABS_SYNTH_TIMEOUT_MS` — Konfiguration, nicht Code.

**Zusatzbefund, ohne Codeaenderung ablesbar:** das Denk-Signal (`thinkingSignal.speakBridge`) laeuft ueber denselben `onSpeechChunk` und feuert nur bei `loopContinues`. In den 9 Turns des Live-Anrufs (1–6 ohne Werkzeug, 7–9 `take_message`+Text = Ausstiegsrunden) muss `thinkingSignal` durchgehend `false` gewesen sein — am vorhandenen Live-Log verifizierbar.

### 2. Befund A — was bewiesen ist, was offen bleibt

`consultAvailableFor` ist eine Schnittmenge aus sieben Faktoren:

| # | Faktor | Status |
|---|---|---|
| 1 | `IN_CALL_CONSULT_ENABLED` | offen — Boot-Banner |
| 2 | `consultAllowedFor` (consult/context/Profil) | bewiesen true (Consult #0 lief durch) |
| 3 | `direction === outbound` | true |
| 4 | `status === active` | true |
| 5 | `callAnswered` | true |
| 6 | `clientIsPolling` | **offen — einziger zeitabhaengiger Faktor** |
| 7 | Kontingent (`inCallConsults(call).length < MAX...`) | **falsifiziert als Ursache** |

**2.1 Geteilter Zaehler widerlegt:** `isInCallConsult` (`src/store/state-ops.js`) diskriminiert ueber `askedAtMs >= answeredAtMs`. Consult #0 entsteht beim Waehlen (vor `markAnswered`), also `askedAt < answeredAt` → zaehlt **nicht** als In-Call-Consult → Kontingent bleibt bei 0/1. Bereits gepinnt durch `AL-P14-23`; jetzt zusaetzlich durch den neuen Kompositionstest `AL-D1-1` gegen Rueckfall gesichert.

**2.2 Verbleibender heisser Kandidat — Faktor 6:** `CONSULT_POLL_FRESH_MS = CONSULT_POLL_ABORT_MS = 22000 + 3000 = 25000`. `consultPolledAtMs` wird nur durch `await_call_event` (Long-Poll, haelt 22 s) gesetzt; die Frischegrenze liegt nur 3 s darueber. Bei einem MCP-Host mit vollem Modell-Zug zwischen zwei Polls koennen tote Fenster entstehen. Zwei weitere log-ablesbare Wege: **Re-Attach** (`consultPolledAtMs` ist ephemer, kein DB-Feld — Reload startet bei `undefined` → nie frisch) und **Instanzwechsel** waehrend des Anrufs.

**2.3 Nicht entscheidbar ohne Instrument:** ob `get_consult` in `agentTools` gelandet ist, steht in keinem bestehenden Log — `turn_ok` traegt nur *gefeuerte*, nicht *angebotene* Werkzeuge.

### 3. Falsifizierbare Hypothesen

H-B1 (Werkzeugsatz-Armierung ursaechlich), H-B2 (Deadline/Konfiguration ursaechlich), H-A1 (Poll-Frische), H-A2 (statischer Schalter aus), H-A3 (Werkzeug angeboten, Modell waehlte anders), H-A4 (geteiltes Kontingent — **widerlegt**).

### 4. Warum kein Fix

Befund B: Lockerung der Armierung riskiert hoerbare Doppelrede (Text wird ersetzt/ueberschrieben) — Owner-Design-Frage, kein Nebenbei-Fix. Befund A: `consultMaxPerCall` ist ohnehin nicht die Ursache; `CONSULT_POLL_FRESH_MS` blind anzuheben waere eine neue, ungemessene „Sicherung" (CLAUDE.md-Verbot). Pre-Mortem im Plan hält beide Risiken fest und entschärft sie durch Nicht-Handeln.

### 5.–9. Umsetzung (Kurzfassung)

- Neue Dateien: `test/al-d1-cause-diagnostics.test.js` (AL-D1-1…6), `test/al-d1-shim-diagnostics.test.js` (AL-D1-7…9) — Praefix `AL-D1-` faellt nicht unter `config.i18nCatalogPattern`, laeuft also im Regressionslauf `npm test`.
- `src/consult/in-call.js`: `clientIsPolling` → exportiert als `consultClientIsPolling` (reine Extraktion, kein Verhaltensunterschied — EINE Frischepruefung fuer Gate und Diagnose, G5).
- `src/claude.js`: `offeredTools` (Set, Union ueber Runden) + `streamArmedRounds` (nur inkrementiert bei `sink truthy`); additiv im Turn-Rueckgabewert als `offeredToolNames`/`streamArmedRounds`.
- `src/telnyx-llm-shim.js`: importiert `consultClientIsPolling`, misst `consultPollFresh` **vor** dem Turn (Zeitpunkt der `agentTools`-Entscheidung), schreibt alle drei Felder fail-safe in `turn_ok`.
- Keine neue Env-Variable, keine Dependency, keine Migration.

### 10. Clean-Code-Selbstpruefung

G5/S2 (eine Quelle statt Duplikat), G25/G35 (keine neue Konstante/Env), G30/G34/F1 (keine wachsenden Signaturen), N7 (Benennung), C2/C5/G9/G12 (keine toten/kommentierten Reste), P11/T-Serie (jedes neue Verhalten getestet, Mutationsproben belegen Testgriffigkeit). Absolute Regeln (Gates, Offenlegung, Auth, Secrets, Audio, Scope) unberuehrt. Blast-Radius: 3 Produktionsdateien, netto +18/−2 Zeilen Code, 2 neue Testdateien, 0 geaenderte Bestandstests.

---

## 2. Impl-Zusammenfassung

**Ergebnis:** Diagnose wie beauftragt, kein Fix.

**Befund B** — Ursache am Code belegt und offline reproduziert (`AL-D1-2` fuer `look_up`, `AL-D1-3` fuer `get_consult`), plus Positivkontrolle `AL-D1-4` (rein seiteneffekt-basierter Satz → `streamArmedRounds:1`, mehrere Chunks). Zweite Ursache (Deadline/Konfiguration) explizit offen gelassen.

**Befund A** — der von der Spec genannte „naheliegendste Verdacht" (geteilter Zaehler) ist **widerlegt**, nicht bestaetigt; `consultMaxPerCall` musste folgerichtig nicht angefasst werden. Von sieben Faktoren bleiben zwei offen (Faktor 1: Boot-Banner; Faktor 6: `consultClientIsPolling`, ephemer, ueberlebt weder Re-Attach noch Instanzwechsel). Fuer den konkreten Live-Anruf ist Befund A **nicht rueckwirkend entscheidbar** — ehrliches Teilergebnis statt Blind-Fix.

**Gebaut:** nur das additive, PII-freie Messinstrument (siehe Abschnitt 5–9 oben).

**Mutationsproben** (beide wie vorhergesagt):
1. Bedingung 2 aus `streamSinkFor` entfernt → `AL-D1-2`, `AL-D1-3` **und** Bestandstest `AL-P7-20` rot (3 fail); nach Ruecknahme gruen.
2. `streamArmedRounds` unbedingt statt `if (sink)` inkrementiert → `AL-D1-2`/`-3` rot, `AL-D1-4` bleibt gruen.

**Verifikation:** `node --check` auf allen 3 geaenderten Quelldateien gruen. Neue Tests 9/9. Betroffene Bestandsdateien (AL-P7, AL-P7-shim-stream-wire, AL-P7b, AL-P1, AL-P14, telnyx-llm-shim, telnyx-K0) 127/127, **ohne Testanpassung**. `npm test`: 3736/3736, 0 fail. `npm run test:gates`: 558 Tests, 3 rot (dokumentierter Bestand, unveraendert). Smoke: `/healthz` 200, alle fuenf Owner-Banner-Zeilen rendern.

**Deviations:**
- Kein separater Baseline-Lauf auf `master` zur "Bestand + 9"-Zusage — nur indirekt belegt (isolierte neue Dateien = exakt 9 Tests, Vollauf 3736/0).
- `test:gates` (558/3 rot) gegen `master` nicht gegengelaufen; entspricht dokumentiertem Bestand.
- `npm test` nur einmal gefahren (json + pg/pglite im selben Lauf); kein separater `STORE_BACKEND=pg`-Zweitlauf.
- Smoke brauchte zwei phasenfremde Boot-Blocker als Dummy-Env (`COST_TRUING_REQUIRED_RECORD_TYPES`, geseedete aktive Nummer) — Bestandsverhalten.
- Dieser Bericht wurde trotz der allgemeinen Subagent-Regel „keine Report-.md" geschrieben, weil der Plan ihn ausdruecklich als Phasen-Deliverable nennt.

**Offen beim Owner** (als AL-D1-M1…M4, AL-D1-O1 in `tasks/al-testcall-checklist.md` festgehalten):
1. Boot-Log des Live-Commits lesen (statische Faktoren).
2. Die 9 alten `turn_ok`-Zeilen von `call_msabz9975sph` auf `thinkingSignal` und eine `reattached`-Zeile pruefen.
3. Profil-Rechte per `psql`, falls der Anruf nicht unter `BOOTSTRAP_TENANT_ID` lief.
4. Nach Deploy des Instruments: ein weiterer Testanruf, dann die Entscheidungstabelle (Plan Abschnitt 8) anwenden.
5. Design-Entscheidung zu Befund B: Armierungsregel lockern vs. Denk-Signal ausweiten.

Solange `look_up` **oder** `get_consult` live armiert sind, ist Token-Streaming faktisch wirkungslos.

---

## 3. Safety-Urteil

**Verdict: PASS — freigegeben.**

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, keine Blocker.
- Unabhaengiger Review-Worktree (`review-al-d1` auf `6df6020`, Basis `master@6fe738f` als Vorfahr bestaetigt). Volllauf 1: 1 Fail (`test/b2-quota-gate.test.js`, vom Diff unberuehrter Geldpfad, isoliert 8/8 gruen — vorbestehender Last-Flake). Volllauf 2: 3736/3736, 0 fail. Beide Backends (json + pg via pglite) im selben Lauf.
- Eigene Mutationsproben bestaetigen die Testgriffigkeit (unbedingtes `streamArmedRounds` → 2 fail; Diskriminator-Vorzeichen gedreht → `AL-D1-1` fail).
- Code-Belege nachgeprueft: `streamSinkFor`, `isInCallConsult`, `CONSULT_POLL_FRESH_MS`-Berechnung, `AL-P7-20`-Existenz — alle bestaetigt.
- Regelpruefung: `bridge.js` byte-identisch, `disclosureSentence` unveraendert, kein Treffer in auth/middleware/gate/billing/routes/server.js/config.js/.env.example/render.yaml/BASE_ENV, kein neuer Endpunkt, kein Secret-Literal im Diff, keine neue Dependency, kein `eslint-disable`/`.only`/`.skip`.
- Leck-Pfad geprueft: neue Turn-Felder erreichen keine HTTP-Response (`routes/voice.js` destrukturiert nur `{speech, endCall}`); Log-Zeile bleibt PII-frei (Code-Konstanten + Booleans/Zahlen).

**Concerns (keine Blocker):**
1. Instrument ist unbedingte Produktionsware (kein Flag) — Nutzen der Phase haengt an einem Deploy.
2. `consultPollFresh` wird auch bei `IN_CALL_CONSULT_ENABLED=false` geloggt und ist isoliert gelesen missdeutbar (Entscheidungstabelle im Plan faengt das ab).
3. `telnyx-llm-shim.js` importiert erstmals statisch aus `consult/in-call.js` — koppelt den bisher DI-reinen Shim an ein Domaenenmodul (Design-Notiz, kein Defekt, G5-begruendet).
4. `EXA_API_KEY` in den neuen Tests nur zur Armierung von `look_up`; kein Test feuert es aktuell, aber ein spaeteres Skripten eines `look_up`-`tool_use` im Mock koennte einen echten Exa-Request ausloesen. Robusterer Riegel (Mock-BaseURL statt Key) waere sicherer.
5. Vorbestehender Last-Flake in `test/b2-quota-gate.test.js` beobachtet (Klasse „Seed-vor-Boot-Race"), nicht diesem Branch anzulasten, aber dem Lead bekannt zu machen.

---

## 4. Clean-Code-Audit

**Verdict: PASS.**

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3:** `AL-D1-5` prueft zwei Konzepte in einem Test (Union-Eigenschaft von `offeredToolNames` + PII-Freiheit/kein Gespraechstext) — beide haengen am selben Instrument, bewusst zusammen lesbar, kein Fix noetig, nur Randnotiz.
- **S4:** keine.

**passNotes:** Saubere Diagnose-Disziplin — kein Verhalten geaendert, nur Messung hinzugefuegt. Kommentare erklaeren WARUM, nicht WAS, im Repo-Stil (Deutsch, ohne Umlaute). Tests folgen P13 (Build/Operate/Check mit benannten Helfern: `armPoll`, `withAnsweredConsultZero`, `exhaustLookup`) und haben eine Positivkontrolle (`AL-D1-4`), die verhindert, dass Reproduktionstests bei totem Streaming faelschlich gruen waeren. Fail-safe-Handling konsistent mit Bestandsmuster (`toolNames`/`roundtrips`). Keine neue Env-Var, keine Migration, keine Dependency. Keine zirkulaeren Imports.

**topTodos:**
1. Keine Blocker — Phase kann als reine Diagnose gemergt werden.
2. Owner-Messschritte aus `tasks/al-testcall-checklist.md` (AL-D1-M1…M4, AL-D1-O1) vor einem Folge-Fix abarbeiten.
3. Optional/kosmetisch: `AL-D1-5` bei Gelegenheit in zwei Tests splitten (P14), keine Dringlichkeit.

---

## 5. Fix-Runden

Keine. Kein S1/S2-Blocker im Clean-Code-Audit, keine Blocker im Safety-Review — die Phase wurde ohne Fix-Runde direkt als PASS abgeschlossen.
