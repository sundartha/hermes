# AL-P6 — Turn-Deadline und Budget-Pruefung pro Runde

**Status:** Gate = **PASS** (Safety-Review approved, Clean-Code-Audit PASS, keine S1/S2)
**finalBranch:** `phase/al-p6-turn-budget`
**Basis:** `master` (`3e78160`, sauber) · **Bahn A** (Hub `src/claude.js`, sequenziell nach AL-P4)
**Head-Commit (Worktree):** `e919bae`

---

## 1. Ausgangsbefund (aus dem Code, nicht angenommen)

- `agentTurn` faehrt eine feste Schleife `for (let i = 0; i < 4; i++)` und bucht in **jeder** Runde `bookTokenUsage(...)`.
- Zwischen Runde 1 und 4 prueft **niemand** ein Budget.
- `agentTurn` hat genau zwei Aufrufer: `src/telnyx-llm-shim.js` und `src/routes/voice.js` (`/voice/turn`). `src/bridge.js` ruft `agentTurn` **nicht**.
- Shim: Budget-Gate steht in Schritt 6 **vor** `agentTurn` (Grund-Token `budget_tenant`/`budget_global`, dann Ansage + `terminateCall`).
- Budget-Engine: `/voice/incoming` hat das Gate, **`/voice/turn` hat gar keines** — jeder Folge-Turn lief ungeprueft.
- `src/turn-budget.js` rechnete nur **eine** `llm.complete`-Kette (11 250 ms mit Defaults) gegen `PROVIDER_WEBHOOK_HARDCUT_MS = 15 000`.
- Vier Runden ergeben rechnerisch 48 500 ms — ueber dem Dead-Air-Watchdog (Default/Live 45 s), der den Call dann toetet.
- Zwei Achsen, unterschiedliche Reichweite (zentrale Design-Entscheidung):
  - **Geld** (Regel 1): ab der **ersten** Runde — ein erschoepfter Cap darf keinen Token mehr kosten.
  - **Zeit**: erst ab der **zweiten** Runde — die erste laeuft immer (fail-safe Richtung Bestand); eine zu knappe Frist darf den Agenten nie stumm schalten.

---

## 2. Plan (gekuerzt)

### 2.1 Neue Datei `src/budget-gate.js`
EINE Quelle (G5) fuer "welche Budget-Achse sperrt gerade?": `BUDGET_AXIS` (TENANT/GLOBAL), `blockingBudgetAxis({store, billing, tenantId})`, `isBudgetAxis(reason)`. Reine Query, kein IO, kein Log. Nicht injizierbar als Ergebnis — Aufrufer reichen nur ihren Store/ihre Config durch.

Keine weitere neue Datei, keine neue npm-Dependency, **keine neue Env-Variable**.

### 2.2 `src/turn-budget.js` — reale Mehr-Runden-Rechnung
- `turnOverheadMs(synthTimeoutMs)` entdoppelt Synthese+Netzreserve (vorher dreifach implizit gerechnet).
- `MAX_TOOL_ROUNDS_PER_TURN = 4` — geteilte Konstante fuer Schleife und Boot-Waechter, bewusst kein Env-Knopf (Kosten-/Latenz-Invariante, kein Betriebswert).
- `turnLoopDeadlineMs(synthTimeoutMs)` = `PROVIDER_WEBHOOK_HARDCUT_MS - turnOverheadMs`, nie negativ.
- `roundFitsDeadline({elapsedMs, deadlineMs, requestTimeoutMs})` — Massstab ist EIN llm.complete-Versuch, nicht die volle Retry-Kette.
- `enforcedTurnWorstCaseMs(...)` — Worst-Case-Turndauer unter der Frist.
- `deadAirOverrun(...)` — `null` wenn Watchdog haelt, sonst `{worstCaseMs, limitMs, overrunMs}`.
- Kontrollzahlen (Auslieferung): `chain=11250`, `deadline=11500`, `worstCase=22750 <= 45000` → Boot-Guard bleibt still.

### 2.3 `src/claude.js` — Frist + Budget-Riegel im Loop
- Neue Imports: `MAX_TOOL_ROUNDS_PER_TURN`, `roundFitsDeadline`, `turnLoopDeadlineMs`, `blockingBudgetAxis`.
- `TURN_STOP_DEADLINE = "deadline"` als Zeit-Grund-Token.
- `roundStopReason({call, roundIndex, elapsedMs, deadlineMs})`: prueft zuerst die Budget-Achse (ab Runde 0), dann ab Runde 1 die Zeit-Frist.
- `logTurnStop(...)`: unconditional `console.warn("[turn] abbruch grund=... call=... runden=...")`, PII-frei.
- Loop-Kopf: `loopStartedAt`, `deadlineMs = turnLoopDeadlineMs(...)`, Schleife nutzt `MAX_TOOL_ROUNDS_PER_TURN` statt Magic `4`, prueft `stopReason` vor jeder Runde und bricht ab.
- Bestehender AL-P4-Ausstieg am Schleifenende bleibt woertlich unveraendert.
- Rueckgabe additiv um `stopReason` erweitert; `speech` bleibt garantiert nicht-leer.

### 2.4 `src/telnyx-llm-shim.js` — Notaus entdoppelt
- Neuer geteilter Helfer `killCallForBudget(reason)`: Log + Ansage (`budgetExhaustedHangup`) + `terminateCall`.
- Schritt 6 nutzt jetzt `blockingBudgetAxis` statt Inline-Logik (byte-identisches Verhalten).
- Schritt 7 (neu): wenn `agentTurn` mit `isBudgetAxis(turn.stopReason)` abgebrochen hat, greift derselbe Notaus. Der Zeit-Grund (`deadline`) fuehrt NICHT dorthin — das Gespraech laeuft normal weiter.

### 2.5 `src/routes/voice.js` — Reaktion der Budget-Engine
- Neuer Helfer `budgetHangupOutcome(turn, call)`: liefert bei Budget-Abbruch denselben Satz + `endCall: true` wie der Inbound-Gate-Pfad.
- Turn-Ausgang: `capFarewellOutcome(call) ?? budgetHangupOutcome(modelOutcome, call) ?? modelOutcome` (Max-Dauer-Abschied gewinnt weiter zuerst).

### 2.6 `src/boot.js` — zweiter Waechter
- `warnTurnOutlivesDeadAir(config)`: nur aktiv wenn `telnyxAssistant.enabled`; vergleicht `enforcedTurnWorstCaseMs` gegen `TELNYX_DEAD_AIR_TIMEOUT_S`; WARN, kein `exit(1)`.
- Bestehender `warnTurnBudgetOverrun` bleibt unveraendert (misst einen anderen Vertrag).

### 2.7 `src/config.js` — nur Kommentar-Erweiterung, kein neuer Key.

### 2.8 `PLAN-SECURITY.md` — neuer Abschnitt `AL-P6-TURNBUDGET` mit Loch-Beschreibung, Fix, benannter Folge (D7/`usage_korrupt` beendet jetzt auch laufende Budget-Engine-Calls) und expliziten Nicht-Zielen.

### 2.9 Tests (Plan)
- `test/turn-budget.test.js` erweitert (reine Arithmetik + 2 Boot-Subtests).
- `test/al-p6-turn-deadline-budget.test.js` (neu, 6 Faelle: Frist greift, Nicht-Regression, Tenant-Achse, Runde-0-Gate, Geld-vor-Zeit, Plattform-Achse).
- `test/al-p6-engine-reactions.test.js` (neu, Shim-Reaktion + Budget-Engine-Spawn-Reaktion, je mit Negativkontrolle).

### 2.10 Blast-Radius / Nicht-Ziele
Beruehrt: 1 neue Datei, 5 Quelldateien, 1 Kommentar, 1 Doku, 3 Testdateien.
Nicht beruehrt: `src/bridge.js`, `src/llm.js`, `src/llm-usage.js`, `store/*`, i18n-Texte, `metrics.logTurn`/`turn_ok`-Payload, `warnTurnBudgetOverrun`, `/voice/incoming`-Gate, `OPENING_GOAL_MAX_CHARS` (AL-P5), Streaming (AL-P7).

---

## 3. Implementierung — Zusammenfassung

- **Head-Commit:** `e919bae` (Basis `master` `3e78160`)
- `node --check` auf allen 7 beruehrten Quelldateien: gruen
- Gezielter Testlauf der 12 Plan-relevanten Dateien: **145 pass / 0 fail**
- `npm test` (volle Regression): **3385 pass / 0 fail**
- `npm run test:gates`: 3 rot — identisch zum dokumentierten master-Stand (kein neuer roter Test)
- Smoke: Server-Spawn (Temp-`DATA_DIR`, `SKIP_TWILIO_SIGNATURE_CHECK`) — `/healthz` 200, `POST /voice/outbound` rendert Gather (200); **keine** der beiden Boot-Warnungen (Turn-Budget, Dead-Air) bei ausgelieferter Konfiguration; Spawn-Test deckt zusaetzlich die echte `/voice/turn`-Route ab (TeXML mit `budgetExhaustedHangup` + `<Hangup>`, genau 1 Anthropic-Request). Verwaiste Testserver danach gekillt.

### Neue/geaenderte Dateien
- Neu: `src/budget-gate.js`, `test/al-p6-turn-deadline-budget.test.js`, `test/al-p6-engine-reactions.test.js`
- Geaendert: `src/turn-budget.js`, `src/claude.js`, `src/telnyx-llm-shim.js`, `src/routes/voice.js`, `src/boot.js`, `src/config.js` (Kommentar), `PLAN-SECURITY.md`, `test/turn-budget.test.js`

### Tests (Inhalt)
- `test/al-p6-turn-deadline-budget.test.js` (6 Tests): Frist greift / normale Latenz bindet nicht / Tenant-Achse mitten im Turn / Runde 0 gegated / Geld schlaegt Zeit / Plattform-Achse.
- `test/al-p6-engine-reactions.test.js` (5 Tests): Shim `budget_tenant`+`budget_global` → Ansage+Call-Control-Hangup, `deadline` → kein Hangup; Budget-Engine-Spawn: Cap gerissen → `budgetExhaustedHangup`+`<Hangup>` bei genau 1 Anthropic-Request, Nicht-Regression Gather.
- `test/turn-budget.test.js` erweitert: `MAX_TOOL_ROUNDS_PER_TURN`, `turnLoopDeadlineMs` (inkl. Nie-negativ-Rand), `roundFitsDeadline`-Grenze inklusiv, `enforcedTurnWorstCaseMs` 22750 vs. 48500 ohne Frist, `deadAirOverrun` null/Befund, 3 Boot-Subtests fuer `warnTurnOutlivesDeadAir`.

### Deviations (Plan vs. Umsetzung)
1. **AL-P6-10 (Budget-Engine-Spawn):** Plan nannte "fette usage, die 3000 ct reisst"; gemessen wurde, dass `test/helpers.js` `DEFAULT_TENANT_BUDGET_CENTS=0` (Sentinel) setzt → effektiver Tenant-Cap ist der Plattform-Cap 3000 ct. Mit urspruenglich 20 Mio. Token (1840 ct) riss der Cap erst nach zwei Runden; im Test stehen jetzt 40 Mio. Token (3680 ct), damit eine Runde reicht — genau 1 Anthropic-Request bleibt die Zusage. Kein Verhaltens-, nur ein Fixture-Unterschied; Grund-Token bleibt `budget_tenant`.
2. Test-IDs 4/5/6 der neuen Seam-Datei sind gegenueber dem Plan umsortiert (Frist, Nicht-Regression, Tenant-Achse, Runde-0-Gate, Geld-vor-Zeit, Plattform-Achse), damit der prozessweite Plattform-Topf nicht nachfolgende Tests derselben Datei "verseucht". Inhaltlich alle sechs Faelle abgedeckt.
3. **AL-P6-6** (Geld schlaegt Zeit) ist schaerfer gebaut als skizziert: Runde 0 laeuft regulaer, Runde 1 reisst Cap UND Frist gleichzeitig — beweist damit die Reihenfolge der beiden Achsen statt nur den Geld-Zweig.
4. eslint/prettier konnten in diesem Checkout nicht laufen (Toolchain nicht installiert, `npx` scheitert in der Sandbox). Kein Repo-Hook haengt daran; Stil wurde am Bestand ausgerichtet.
5. `npm run test:gates`: 3 rote Tests — identisch zum dokumentierten master-Stand, aber in dieser Session nicht selbst gegen master gegengemessen (Zeit/Prozess-Last).

---

## 4. Safety-Urteil (final)

**Verdict: FREIGABE (approved).** Alle vier absoluten Regeln eingehalten; Regel 1 wird **verschaerft**, nicht aufgeweicht.

- `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`
- Unabhaengiger Review-Worktree (`review-al-p6` aus `phase/al-p6-turn-budget`), Basis frisch bestaetigt (`git merge-base --is-ancestor master ...` = true, genau 1 Commit `e919bae`).
- **JSON-Backend:** Lauf 1: 3385/3384/1 fail — roter Test `T-P0-05` (Boot-Guard) isoliert lief 14/14 gruen; Lauf 2 (voller Lauf) 3385/3385/0 fail. Bewertung: bekannter Voll-Last-Flake (repo-dokumentiertes Gate-Protokoll: rot zaehlt nur, wenn isoliert rot), keine AL-P6-Regression — der Test beruehrt keine der geaenderten Dateien.
- **PG-Backend:** 129/129 pass, inkl. Verifikation, dass `pg.js` dieselben reinen ops-Praedikate wie `json.js` nutzt — Verhalten backend-identisch.
- **test:gates:** 129/126/3 fail — deckungsgleich mit dokumentiertem Bestand (GAP-05, GAP-15 x2), kein Bezug zu AL-P6.
- Partitionierung geprueft: alle neuen `AL-`-Tests landen im Regressionslauf (kein stiller Abrutsch in den Gates-Lauf).
- Eigene Zahlen-Nachrechnung gegen ausgelieferte `render.yaml`-Werte bestaetigt: Gutfall unveraendert, Boot-Waechter still, Gegenprobe ohne Frist reproduziert die 48 500-ms-Zahl, die die Phase schliesst.
- Callergrep bestaetigt: `agentTurn` hat produktiv genau zwei Aufrufer; `src/bridge.js` ruft `agentTurn` nicht — Realtime-Pfad unberuehrt.

### Concerns (keine Blocker)
1. Prettier: `src/turn-budget.js` und `test/al-p6-engine-reactions.test.js` sind neu unformatiert (repo-weit ohnehin schon rot, kein Gate) — 2 zusaetzliche vermeidbare Verstoesse.
2. Konfig-Klippe ohne eigenen Waechter: bei `ELEVENLABS_SYNTH_TIMEOUT_MS` nahe dem Max (10000) wuerde `turnLoopDeadlineMs` auf ~3500 fallen und praktisch nie eine zweite Runde erlauben. Auslieferungswert (2000) ist unkritisch; kein Waechter fuer diesen Extremfall.
3. `warnTurnOutlivesDeadAir` gated auf `telnyxAssistant.enabled` — fuer die Budget-Engine (Twilio) gibt es keine entsprechende Warnung; ein Turn kann dort weiterhin bis 22 750 ms brauchen (besser als Bestand 48 500 ms, aber Hardcut nicht garantiert).
4. Transkript-Kosmetik: bricht der Loop in Runde 0 an einer Geld-Achse ab, schreibt `agentTurn` weiterhin den Locale-Fallbacksatz ins Transkript, waehrend der Anrufer `budgetExhaustedHangup` hoert (Bestandsmuster von `capFarewellOutcome`, kein neuer Defekt).
5. Bewusst akzeptierte, dokumentierte Verhaltensausweitung: `budgetExceeded` sperrt fail-closed auch bei korruptem Usage-Bucket (D7/`usage_korrupt`) — beendet jetzt auch einen laufenden Budget-Engine-Call, bisher nur Shim + Inbound. Richtung fail-closed, Gruende im Log unterscheidbar.
6. eslint liess sich im Worktree nicht ausfuehren (`@eslint/js` fehlt im geteilten `node_modules`) — Lint-Achse nicht unabhaengig verifiziert; `node --check` gruen, `npm test` deckt Verhalten ab.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — keine S1/S2-Befunde, kein Blocker.

- **S1:** keine.
- **S2:** keine.
- **S3** (Kleinigkeiten, kein Fix zwingend):
  1. `roundFitsDeadline` (Name sagt nicht explizit, gegen welche Groesse geprueft wird — JSDoc reicht bereits, optional praezisieren).
  2. `budgetHangupOutcome(turn, call)` weicht in der Parameterreihenfolge von `capFarewellOutcome(call)` ab — kosmetische Inkonsistenz, Angleichung auf `(call, turn)` empfohlen.
- **S4:** `roundStopReason({call, roundIndex, elapsedMs, deadlineMs})` — 4 Felder in einem destrukturierten Objekt, am oberen Rand von F1, aber als EIN zusammengehoeriges Objekt uebergeben und Repo-Konvention — kein echter Verstoss.

**passNotes (Auszug):** G5 vorbildlich behandelt — `budget-gate.js` buendelt die Budget-Achsen-Logik einmalig, beide Streu-Stellen (Shim Schritt 6, `routes/voice.js`) wurden umgestellt, kein Leftover der alten Inline-Pruefung. `turnOverheadMs` vermeidet eine Drei-Stellen-Duplizierung in `turn-budget.js`. `MAX_TOOL_ROUNDS_PER_TURN` korrekt zentralisiert, bewusst ohne Env-Knopf. Geld-vor-Zeit-Reihenfolge getestet und korrekt. Alle 31 neuen/geaenderten Tests liefen gruen, volle Suite 3385/0 fail. PII-Freiheit der neuen Logzeile eingehalten. `PLAN-SECURITY.md` dokumentiert die akzeptierte Nebenwirkung transparent.

**topTodos (optional, kein Blocker):**
1. `budgetHangupOutcome(turn, call)` → `(call, turn)` fuer Konsistenz mit `capFarewellOutcome`.
2. `roundFitsDeadline` im Namen/JSDoc noch expliziter machen, dass ein EINZELNER Request-Timeout geprueft wird, nicht die volle Retry-Kette.

---

## 6. Fix-Runden

Keine — Safety-Review und Clean-Code-Audit haben die erste Umsetzung ohne Blocker (S1/S2) freigegeben. Es waren keine Fix-Runden noetig; die Concerns/S3-Befunde sind optionale Politur, kein Gate.

---

## 7. Verifikationsbefehle (aus dem Plan, Abschnitt 4)

```bash
node --check src/claude.js && node --check src/turn-budget.js && node --check src/budget-gate.js \
  && node --check src/telnyx-llm-shim.js && node --check src/routes/voice.js && node --check src/boot.js

node --test test/al-p6-turn-deadline-budget.test.js test/al-p6-engine-reactions.test.js \
  test/turn-budget.test.js test/turn-latency-budget.test.js \
  test/telnyx-p6-midcall-budget-kill.test.js test/telnyx-llm-shim.test.js \
  test/al-p4-side-effect-tool-loop.test.js test/al-p1-turn-observability.test.js \
  test/claude-turn-guard.test.js test/afix-p4-end-call-discipline.test.js \
  test/cq-p3-cap-farewell.test.js test/g4-no-speech-reprompt.test.js

npm test
npm run test:gates
```

---

## 8. Referenzen

- Kette: `tasks/assistant-leap-chain.md` (AL-P2 offen, wird hier nicht geraten)
- Sicherheitsdoku: `PLAN-SECURITY.md`, Abschnitt `AL-P6-TURNBUDGET`
- User-Memory: `assistant-leap-plan.md` (15 Phasen, O1-O9 entschieden)
