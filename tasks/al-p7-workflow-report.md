# Phase AL-P7 — Echtes Token-Streaming und Satz-Chunking

**Kontext:** Teil der AL-Kette (PLAN-ASSISTANT-LEAP.md). Basis: AL-P2 ist GRUEN gemessen (SSE-Framing erreicht Telnyx inkrementell, kein Header-/Flush-Problem). AL-P7 baut darauf das echte Modell-Streaming.

- **Basis:** `master` (`ab2065d`)
- **finalBranch:** `phase/al-p7-token-streaming`
- **headCommit:** `6375f1e202d5701a4adcb41e235991e639dc331e`
- **Gate:** **PASS**

---

## 1. Plan (gekuerzt)

Ziel: Der Shim-Turn (`src/telnyx-llm-shim.js`) streamt seine Antwort satzweise auf die Leitung statt auf die komplette Modellantwort zu warten — der Latenzgewinn entsteht durch inkrementelle `res.write`-Aufrufe (AL-P2 hat bewiesen, dass das ohne Header-/Flush-Aenderung bei Telnyx ankommt).

**Tragender Entwurfsentscheid (Abnahmekriterium 3, strukturell statt gehofft):** Gestreamt wird eine Modellrunde **nur dann**, wenn ihr Werkzeugsatz **ausschliesslich** aus Seiteneffekt-Werkzeugen besteht (`isSideEffectOnlyTool` fuer jeden Eintrag von `agentTools(call)`). Aus dem bestehenden Loop-Code folgt daraus: jede Runde, die ueberhaupt Text emittiert, ist zwangslaeufig die terminale Runde des Turns. `get_consult` (informationsliefernd, kann `speech` durch nachfolgende Runden ueberschrieben/ersetzt werden) ist damit automatisch ausgeschlossen, und ein *kuenftiges* informationsliederndes Werkzeug schaltet Streaming fail-closed selbst ab (G27) — niemand muss daran denken.

**Zusaetzlicher Riegel (Defense-in-Depth):** nach `content_block_start`/`tool_use` haelt der Chunker nur noch (statt zu verwerfen); der Rest geht am Rundenende als letzter Chunk raus — kein stiller Textverlust.

**Zweite Invariante (testbar):** `shapeForSpeech(chunks.join(...)) === shapeForSpeech(rohtext)`.

### Neue Dateien
- `src/speech-shape.js` — `shapedCore` als gemeinsamer Kern; `shapeForSpeech` (Turn-Ende, byte-identisch zum Bestand) und `shapeChunkForSpeech` (chunk-sicher, kein terminaler Punkt, kein Komma-Abraeumen).
- `src/speech-chunker.js` — `makeSentenceChunker({ onChunk })`: zerlegt Token-Strom in sprechbare Saetze, `MIN_SENTENCE_CHARS=12` gegen Abkuerzungen/Ordnungszahlen, bewusst OHNE Laengen-Notbremse.

### Edits (Kernpunkte)
- `src/config.js` — neues Flag `shimTokenStreaming` (`TELNYX_SHIM_TOKEN_STREAMING`, Default `false`), an allen 4 Pflichtorten (`config.js`, `.env.example`, `render.yaml`, `test/helpers.js BASE_ENV`).
- `src/llm.js` — neuer Abbruchgrund `STREAM_ABORTED`; `attemptReachedProvider` wandert aus `precall-briefing.js` hierher (G5, geteilt mit AL-P9); `runResilient` als EIN resilienter Rahmen fuer `complete` UND neues `completeStream`; eigene Wanduhr (`AbortSignal.timeout(streamBudgetMs)`), da der SDK-Timeout bei `stream:true` nur die Zeit bis zu den Antwort-Headern deckt (empirisch am SDK-Quellcode nachgewiesen); Retry verboten, sobald ein Fragment den Seam verlassen hat.
- `src/claude.js` — `streamSinkFor` (Arming-Entscheid), `completeRound` (ein Modell-Aufruf inkl. der EINEN Verbrauchsbuchung, im Abrissfall pessimistisch geschaetzt aus Prompt-Laenge + `TURN_MAX_TOKENS=300`), `agentTurn` bekommt drittes Objekt-Argument `{ onSpeechChunk }`.
- `src/llm-usage.js` — `estimatedAbortUsage` (geteilt mit AL-P9/precall-briefing.js).
- `src/precall-briefing.js` — nur Entdopplung (lokale Kopien geloescht, Import aus `llm.js`/`llm-usage.js`), kein Verhaltenswechsel.
- `src/telnyx-llm-shim.js` — `makeStreamingResponse` als EINE Quelle fuer beide SSE-Kadenzen; `respond()` als EINE Antwort-Schreibstelle (ersetzt 4 duplizierte `writeCompletion`-Aufrufe); Sink wird an `agentTurn` durchgereicht; `streamChunks` additiv in `turn_ok`-Log.
- `src/boot.js` — Banner-Zeile `tokenStreamingBannerLine`, byte-identisch (leer) wenn Flag aus.

### Tests (Plan sah ~27 vor)
4 neue Testdateien: `test/al-p7-speech-chunker.test.js`, `test/al-p7-llm-stream.test.js`, `test/al-p7-turn-streaming.test.js`, `test/al-p7-shim-stream-wire.test.js`. Angepasst (begruendet): `test/config-shape.test.js`, `test/config-namespaces-helper.js`, `test/helpers.js`.

### Ausdruecklich NICHT Teil dieser Phase
Kein Denk-Signal/Fuelltext vor Werkzeugaufrufen (AL-P7b), kein `voiceControl.speak`-Nebenkanal, kein Streaming im Budget-Engine-Pfad, keine neue Dependency/Route/Deploy, kein Push nach `upstream`.

---

## 2. Impl-Zusammenfassung

Vollstaendig umgesetzt und committet (`6375f1e` auf `phase/al-p7-token-streaming`, Basis `master`/`ab2065d`). Alles haengt an `TELNYX_SHIM_TOKEN_STREAMING` (Default AUS): aus heisst byte-identisches Bestandsverhalten — `agentTurn` bekommt keinen Abnehmer, `llm.js` streamt nicht, die SSE-Antwort bleibt EIN content-Chunk. Rollback ist ein Flag-Flip.

**Die drei harten Zusagen, strukturell statt gehofft:**
1. **Kein widersprochener Satz** (Abnahme 3): `streamSinkFor` armiert nur Runden mit ausschliesslich Seiteneffekt-Werkzeugen; jede Text-emittierende Runde ist damit beweisbar terminal. Test AL-P7-15/20 (get_consult-Fixture) belegt es.
2. **Geld** (Regel 1): genau EINE `bookTokenUsage`-Buchung je LLM-Aufruf, im Abrissfall pessimistisch (Prompt-Laenge + `TURN_MAX_TOKENS=300`), nie 0, nie zwei Belege. Tests AL-P7-17/18/23.
3. **Kein doppelt gesprochener Halbsatz**: Retry verboten sobald ein Fragment den Seam verlassen hat; eigene Wanduhr aus der AL-P6-Restfrist (`stream-aborted`), weil der SDK-Timeout nur die Header deckt. Test AL-P7-9/19.

**Verifikation:** `node --check` auf allen 9 geaenderten/neuen Quelldateien gruen. `npm test`: 3649/3649, fail 0 (33 neue Tests, nicht 27 wie geplant — s. Deviations). `npm run test:gates`: 126/129, 3 rot — identisch zur Baseline (kein Regress durch AL-P7, per Gegenprobe auf `ab2065d` bestaetigt). Byte-Identitaets-Gegenprobe (telnyx-llm-shim, telnyx-shim-endcall, al-p1/p4/p6/p14, shape-for-speech, llm, cq-p8-briefing) lief gruen ohne dass eine dieser Dateien angefasst wurde.

**Smoke:** Zwei Server-Starts (Flag aus / Flag an) auf freien Ports gegen Temp-`DATA_DIR`, beide erfolgreich; Flag an zeigt Boot-Banner-Zeile, Auth-/Korrelations-Gates greifen weiterhin fail-closed vor jedem Byte. Ein vollstaendiger Streaming-Turn ist lokal nicht smoke-bar (braucht aktiven Call + echtes Anthropic) — dafuer die Integrationstests gegen den lokalen SSE-Mock.

### Deviations (vom Plan-Text)

1. **PLAN-BEFEHL UNGUELTIG** (`STORE_BACKEND=pg PGLITE=1 npm test`): dieser Modus existiert im Repo nicht (kein PGLITE-Schalter in package.json/config.js/pg.js). Gegenprobe: derselbe Befehl scheitert identisch an einer von AL-P7 unberuehrten Datei (`test/store-purge.test.js`). Die pg-Abdeckung laeuft ueber die pglite-Testdateien innerhalb von `npm test`.
2. **Riegel-Semantik gehaertet**: Plan-Skizze haette Text-Deltas NACH einem `tool_use`-Block verworfen — das widerspraeche der eigenen Zusage "kein stiller Textverlust". Umgesetzt: Halten-Variante, `toolUseStarted()` schaltet nur die eager-Ausgabe ab, `flushRemainder()` gibt den Rest vollstaendig aus.
3. **speech-chunker, zwei notwendige Ergaenzungen** (beide testbelegt): (a) Chunks ab dem zweiten tragen ihr Trennzeichen selbst (fuehrendes Leerzeichen) — Invariante lautet `shapeForSpeech(chunks.join(''))` statt `join(' ')`. (b) Kein Schnitt unmittelbar vor Aufzaehlungs-Markern bzw. solange nach Satzende nur Whitespace kam, da `shapeForSpeech` `'- '` am Zeilenanfang anders behandelt als `' - '` im Satz.
4. **Degradations-Weiche in telnyx-llm-shim.js**: Plan wollte "offen vs. gerissen" allein ueber `res.headersSent` unterscheiden — das funktioniert im Streaming-Fall nicht (headersSent ist nach dem role-Chunk in beiden Faellen true; gemessen: zweiter `finish()`-Aufruf schrieb in den kaputten Socket, T1-Szenario). Umgesetzt: eigenes `broken`-Flag am Strom, `finish()` beschraenkt sich danach auf `res.end()`. T1 bleibt unveraendert gruen.
5. **Benannte Rest-Divergenz (kein Fix, bewusst)**: `withRetry` koppelt "retrybar" mit "zaehlt fuer den Breaker". Nach dem ersten gestreamten Fragment (`retryable=false`) meldet ein transienter Abriss dem Circuit-Breaker keinen Fehlversuch mehr. Eingriff in `withRetry` haette auch den Nicht-Stream-Pfad veraendert (ausserhalb der Phase) — im Code kommentiert.
6. **Testzahl**: 33 statt der geplanten ~27 Tests (zusaetzliche Grenzfaelle: leerer/whitespace-Input, Aufzaehlungs-Marker-Riegel, Fugen-Leerzeichen, Breaker-open ohne openStream-Aufruf, Loop-Guard neben Budget-/Rate-Gate).
7. **AL-P7-19 (Wanduhr)** liegt im Seam-Test statt im Turn-Integrationstest, um echte Sekunden Testlaufzeit zu vermeiden.
8. **Werkzeug-Drift**: `prettier` meldet 7 Dateien inkl. unberuehrter Bestandsdateien als unformatiert (Versions-Drift, kein neuer Verstoss); `eslint` laeuft im Worktree gar nicht (`@eslint/js` fehlt, vorbestehend).
9. **Worktree-Basis**: Worktree lag beim Start auf `origin/master` (`3bc5f43`, KS-Kette); lokales `master` = `ab2065d` = die im Plan genannte Basis. Wie beauftragt von `master` gebrancht — die beiden Staende sind divergent, wichtig fuer den Merge-Zielbranch (lokales `master`, nicht `origin/master`).
10. Symlink-Reparatur `node_modules` (nicht committet, gitignored, Gegenprobe: 0 `node_modules`-Pfade im Commit).

---

## 3. Safety-Urteil

**Verdict: PASS (mit Auflagen fuer den Live-Flip).** `approved: true`, alle Kernpruefungen intakt: `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`, `testsPassIndependently` — alle `true`. **Keine Blocker.**

**Unabhaengige Nachpruefung** (frischer Worktree, Branch `review-al-p7` aus `phase/al-p7-token-streaming`): Basis bestaetigt (`master`/`ab2065d` ist Vorfahr von HEAD, kein stale base). `npm test`: 3669/3669 (korrigiert 3649/3649), 181,8s. Postgres-Backend (`pglite`, 14 Dateien): 74/74. `test:gates`: 126/129, 3 rot — Gegenprobe auf `ab2065d` liefert exakt dieselben 3 IDs, also kein Regress. `node --check` auf allen 9 Dateien OK. Kein `package.json`/`package-lock`-Diff. Keine verwaisten Serverprozesse.

**Konkrete Feststellungen:**
- Safety-Gates (Existenz-404, Bearer/safeEqual, ccid-Korrelation, Loop-Guard, Rate-Gate, Budget-Achse) stehen unveraendert VOR `agentTurn`, `makeStreamingResponse` schreibt lazy (erst bei `writeChunk`/`finish`). Kostendecke wird eher gestaerkt (genau eine Buchung auch im Abrissfall, vorher: gar keine).
- Offenlegung unberuehrt (`src/bridge.js` null Diff, `disclosureSentence` im Diff nicht vorhanden).
- Auth fail-closed: kein neuer Endpunkt, `wire` entsteht erst nach Bearer-/ccid-Gate.
- Secrets sauber (nur Test-Dummies im Diff).
- Scope: 19 Dateien, alle AL-P7-bezogen, keine neue Dependency, Env-Var an allen 4 Pflichtorten.

**Concerns (keine Blocker, dokumentierte Risiken):**
1. **Wanduhr pro VERSUCH statt pro Turn** (`src/llm.js`): `AbortSignal.timeout(budgetMs)` wird bei jedem Retry neu erzeugt. Ein transienter Abriss VOR dem ersten Textfragment ist weiterhin retrybar → Worst Case `(llmMaxRetries+1) × turnLoopDeadlineMs` ≈ 34,5s gegenueber ~11,25s im Nicht-Stream-Pfad (der bewusst auf den 15s-Hardcut abgestimmt ist). `turn-budget.js` rechnet weiterhin mit `llmRequestTimeoutMs` und ist fuer den Streaming-Pfad blind. **Auflage vor Live-Flip.**
2. **Ueberbuchung landet auf der Kundenrechnung**: `estimatedAbortUsage` bucht im Abrissfall `output_tokens=300` auf BEIDE Achsen (Live-Budget + append-only Stripe-usage_event ohne Korrekturkante). Ist die dokumentierte Spec-Entscheidung, aber echtes Geld — gehoert in die Owner-Risikoliste.
3. `attemptReachedProvider` von `reason === RETRIES_EXHAUSTED` auf `reason !== CIRCUIT_OPEN` geweitet, jetzt geteilt mit `precall-briefing.js`. Heute verhaltensgleich, aber nicht durch einen Test gegen einen kuenftigen vierten Reason gepinnt.
4. Gesprochener Text und Transkript koennen kosmetisch auseinanderlaufen (kein Schlusspunkt im gesprochenen Draht-Text) — im Code dokumentiert, rein prosodisch.
5. Abweichung vom Buchstaben der Spec ("nur letzte Schleifenrunde streamt" → tatsaechlich "nur Runden mit ausschliesslich Seiteneffekt-Werkzeugen im verfuegbaren Satz"): der staerkere, ueberhaupt implementierbare Riegel; haelt an allen erreichbaren Pfaden, aber tragende, nicht-triviale Logik.
6. eslint/prettier in diesem Checkout nicht lauffaehig — an den Clean-Code-Auditor delegiert.

---

## 4. Clean-Code-Audit (S1–S4)

**Verdict: PASS.** `blocker: false`.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (nicht blockierend):** 1 Fund — `src/llm.js runResilient()`: bei `LLM_UNAVAILABLE_REASON.STREAM_ABORTED` klassifiziert `runResilient` das Ergebnis ueber `isTransient(err)` als "non-transient" im Metrik-Outcome, obwohl es weder ein 4xx/Auth-Fehler noch Retries-erschoepft ist — irrefuehrendes Label fuer diesen dritten Fall, falls die Metrik spaeter zur Fehlerdiagnose genutzt wird. Optionaler Fix: eigenen Metrik-Outcome-Wert `stream-aborted` einfuehren.
- **S4:** keine.

**Begruendung:** Flag-Default AUS = byte-identischer Bestandspfad (durch Test + vollen Testlauf belegt). `llm.completeStream` teilt sich den Resilienz-Rahmen mit `complete()` ueber `runResilient` (G5-konform). Retry-Verbot nach erstem gesendeten Fragment korrekt verdrahtet und getestet. Budget-Buchung fail-safe Richtung Ueberbuchung (nie 0, nie doppelt). Draht-Layer verhindert Doppelrede, T1-Riegel bleibt auch im Streaming-Fall bestehen. Die Verschiebung von `estimatedAbortUsage`/`attemptReachedProvider` in `llm.js`/`llm-usage.js` beseitigt sogar eine vorbestehende Duplizierung (G5-Verbesserung). Volle Testsuite gruen (3649/3649, exit 0), alle 4 neuen AL-P7-Testdateien gruen, `node --check` fehlerfrei auf allen geaenderten/neuen Dateien.

**Top-TODOs (fuer spaeter, nicht blockierend):**
1. Vor dem Flip `TELNYX_SHIM_TOKEN_STREAMING=true`: die Live-Abnahmen AL-P7-B/C/D (Latenz-Messung, Widerspruchs-Probe per Ohr, Barge-in-Probe) gemaess `tasks/al-testcall-checklist.md` tatsaechlich durchfuehren — der Code-Review deckt nur die Struktur ab, nicht die Live-Erfahrung.
2. Optional (S3): dritten Metrik-Outcome `stream-aborted` statt `non-transient` fuer `LLM_UNAVAILABLE_REASON.STREAM_ABORTED` einfuehren.

---

## 5. Fix-Runden

**Keine.** Beide Reviews (Safety und Clean-Code) kamen im ersten Durchlauf auf PASS ohne Blocker; es waren keine Fix-Runden noetig. Die einzigen offenen Punkte sind Owner-Auflagen fuer den Live-Flip (Auflage 1 aus dem Safety-Review: Wanduhr pro Versuch statt pro Turn) sowie zwei nicht-blockierende TODOs aus dem Clean-Code-Audit.

---

## 6. Owner-Aufgaben (aus `tasks/al-testcall-checklist.md`, alle offen)

| Phase | Zu tun | Erfolgskriterium |
|---|---|---|
| AL-P7 | `TELNYX_SHIM_TOKEN_STREAMING=true` im Render-Dashboard setzen (in `tasks/al-env-changes.md` protokollieren) | Boot-Banner zeigt `Token-Streaming: AKTIV`; `turn_ok` traegt `streamChunks > 0` |
| AL-P7 | Abnahme 1: ≥5 gescriptete Anrufe, `node scripts/telnyx-call-latency.mjs <conversation-id>` | Median `end_user_perceived_latency_ms` sinkt gegen AL-P1-Baseline um ≥300ms; sonst Flag zurueck auf `false` |
| AL-P7 | Abnahme 3: Aufnahmen der 5 Anrufe durchhoeren | kein Fall "Satz gesprochen, danach widersprach das Werkzeugergebnis" |
| AL-P7 | Abnahme 4 (Barge-in): Owner faellt mit echtem Satz ins Wort / sagt nur "mhm" | Ins-Wort-fallen stoppt sofort, "mhm" nicht; reisst die Probe → Flag zurueck auf `false` |

Zusaetzlich (aus dem Safety-Review, vor dem Live-Flip zu klaeren): die Wanduhr-Bemessung pro Retry-Versuch (Concern 1) entweder fixen oder explizit als akzeptiertes Risiko protokollieren.

---

## 7. Betroffene Dateien

**Neu:**
- `src/speech-shape.js`, `src/speech-chunker.js`
- `test/al-p7-speech-chunker.test.js`, `test/al-p7-llm-stream.test.js`, `test/al-p7-turn-streaming.test.js`, `test/al-p7-shim-stream-wire.test.js`

**Editiert:**
- `src/llm.js`, `src/llm-usage.js`, `src/claude.js`, `src/precall-briefing.js`, `src/telnyx-llm-shim.js`, `src/config.js`, `src/boot.js`
- `.env.example`, `render.yaml`
- `test/helpers.js`, `test/config-shape.test.js`, `test/config-namespaces-helper.js`
- `tasks/al-testcall-checklist.md`
