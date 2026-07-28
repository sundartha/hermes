# Phase AL-P9 — Vorab-Briefing anschalten und verbreitern

**Status:** Gate = PASS
**finalBranch:** `phase/al-p9-briefing`
**headCommit:** `6249608a2d9d1de7828f69209bbe590a7b08c1b5` (auf `phase/al-p9-briefing-impl`, siehe Branch-Hinweis unten)
**Basis:** `master` = `5bb7668`

---

## 1. Plan (gekürzt)

**Autoritative Spec:** `tasks/assistant-leap-chain.md` §9 „AL-P9" + `PLAN-ASSISTANT-LEAP.md` `#### Phase 9`.

**Befund am Code (vor der Phase):**
- `fetchPrecallBriefing` buchte Kosten erst **nach** erfolgreichem `await`; der `catch`-Block behauptete „vor jeder Antwort gescheitert, also NICHTS verbraucht" — stimmt nur für `CIRCUIT_OPEN`, nicht für Timeouts.
- Timeout im SDK → `APIConnectionTimeoutError` → `isTransient=true` → `LlmUnavailableError("retries-exhausted")`; Breaker-open wirft **vor** `create()` → `"circuit-open"`. Beide Gründe existierten nur als Roh-Strings.
- `bookTokenUsage` bucht beide Achsen (Budget-Gate `store.trackUsage` + Stripe-Ledger `meterAiTokens`).
- `assistantContextSection` rendert feldweise explizit — ein fünftes Kontextfeld erreicht den Telefon-Prompt nicht automatisch.
- `context` wird als Ganzes serialisiert (kein Spaltenschema) → keine Migration nötig.
- `PRECALL_BRIEFING_ENABLED` stand bereits an allen vier Orten → keine neue Env-Variable in dieser Phase.
- **Bench-Lücke (neuer Befund):** `scripts/convo-bench/runner.mjs` seedet den Call direkt und ruft `fetchPrecallBriefing` nie auf (meidet `POST /api/calls` bewusst als Sicherheitsargument aus AL-P8). Der geforderte 5/5-Blindtest ist damit heute nicht fahrbar.

**Scope drin:** (1) Kostenbuchung im Abbruchpfad + Korrektur des irreführenden Kommentars; (2) `open_questions` als fünftes Briefing-Ausgabefeld inkl. Validierung; (3) Tests; (4) Abnahme-Einträge in `tasks/al-testcall-checklist.md`.
**Scope draußen:** Flag anschalten (Owner), Render-Env, `contextReceivedMeta`/MCP-Output-Vertrag, Bench-Erweiterung, Recherche (AL-P10), neue Route/Dependency/Env-Var.

**Design-Entscheidungen:**
- **D1** — Nur buchen, was nachweislich auf der Leitung war: `RETRIES_EXHAUSTED` → buchen, `CIRCUIT_OPEN` → nicht buchen (kein Request raus), nicht-transiente 4xx → nicht buchen (sonst zieht eine Fehlkonfiguration still Budget ab, bis Outbound einfriert).
- **D2** — Schätzung geht NUR auf die Budget-Achse (`trackUsage`), NICHT auf den Stripe-Ledger (`meterAiTokens`): eine Schätzung für eine nie gelieferte Leistung gehört nicht auf die Kundenrechnung. Eigene benannte Funktion (`bookEstimatedTokenUsage`) statt Boolean-Flag.
- **D3** — `open_questions` läuft durch denselben Validierer wie `key_facts` (eine Quelle). MCP-`place_call`-Schema wird NICHT erweitert.
- **D4** — `open_questions` erreicht den Telefon-Agenten NICHT (Eingabe für spätere Recherche-Phase, nicht Sprechstoff für Haiku); Byte-Identität des `systemPrompt` wird getestet.

**Edits laut Plan:** `src/llm.js` (Export `LLM_UNAVAILABLE_REASON`), `src/llm-usage.js` (neue `bookEstimatedTokenUsage`), `src/precall-briefing.js` (Kernedit: Schätzung + Buchung im `catch`, fünftes Tool-Feld `open_questions`), `src/routes/_validation.js` (Validierung `open_questions`), `.env.example` (Kommentarzeile). Keine neuen Dateien.

**Deterministisch prüfbares Ergebnis (§8 des Plans):** `node --check` über die vier Dateien; zielgerichteter Testlauf; `npm test`; `npm run test:gates` unverändert (3 rote); `git diff --stat` nur auf die genannten Dateien begrenzt; Flag-aus bleibt kostenlos (B10/B11).

---

## 2. Implementierungs-Zusammenfassung

- `src/llm.js`: `LLM_UNAVAILABLE_REASON` (`CIRCUIT_OPEN`, `RETRIES_EXHAUSTED`) als EINE Quelle statt Roh-Strings an den `throw`-Stellen.
- `src/llm-usage.js`: neue `bookEstimatedTokenUsage({tenantId, usage, model})` — bucht nur `store.trackUsage`, kein Stripe-Meter.
- `src/precall-briefing.js`:
  - Neue Konstante `BRIEFING_ESTIMATE_CHARS_PER_TOKEN = 3` (pessimistische Zeichen-je-Token-Annahme).
  - `estimatedAbortUsage(promptChars)` liefert `{input_tokens, output_tokens: BRIEFING_MAX_TOKENS}`.
  - `bookAbortedAttempt({err, tenantId, promptChars})` bucht nur bei `RETRIES_EXHAUSTED`, loggt Grund + Token-Schätzung (kein Prompt-Inhalt, keine PII).
  - `fetchPrecallBriefing` ruft im `catch` `bookAbortedAttempt` auf, korrigierter Kommentar (die alte „nichts verbraucht"-Annahme gilt nur für `circuit-open`).
  - Fünftes Tool-Feld `open_questions` (String-Array) im `briefingTool`-Schema, ohne Zahl in der Beschreibung; System-Prompt-Zeile ergänzt.
- `src/routes/_validation.js`: `CONTEXT_LIST_LIMITS`-Muster erweitert, `open_questions` (maxItems 10, maxLen 300) im selben Validierungspfad wie `key_facts`; `CONTEXT_FIELDS` um `open_questions` ergänzt.
- `.env.example`: zwei Kommentarzeilen unter `PRECALL_BRIEFING_TIMEOUT_MS` (Timeout ist nicht kostenlos).
- Tests: AL-P9-1..7 in `test/cq-p8-briefing.test.js`, BR1 in `test/cq-p8-briefing-breaker.test.js` um zwei Kostenzusicherungen erweitert, AL-P9-8 in `test/assistant-context-render.test.js`, AL-P9-9 in `test/assistant-context-http.test.js`.
- `tasks/al-testcall-checklist.md`: sechs neue AL-P9-Einträge (Bench-Lücke, Flag-Freigabe, Blindtest, Hörtest, `open_questions`-Quote), als offen markiert.

**Testergebnis:** `npm test` 3446/3446 grün, `npm run test:gates` exakt die dokumentierten 3 roten (GAP-05, GAP-15 ×2), kein neues Rot. `node --check` über alle vier geänderten `src/`-Dateien fehlerfrei.

### Deviations vom Plan

- **Branch-Name:** Geplant war `phase/al-p9-briefing` (`git checkout -b phase/al-p9-briefing master`). Dieser Name war zum Zeitpunkt der Umsetzung bereits in einem anderen, parallel laufenden Worktree ausgecheckt — Artefakt eines per TaskStop abgebrochenen ersten AL-P9-Laufs, auf einer älteren, unvollständigen Basis (`11ccd39`, VOR dem AL-P5-Merge). Git verbietet denselben Branchnamen in zwei Worktrees gleichzeitig. Stattdessen wurde `phase/al-p9-briefing-impl` von der aktuellen `master`-Spitze (`5bb7668`) erstellt — vollständig gemäß Plan umgesetzt. Der alte/parallele Branch wurde nicht angefasst.
  - **Branch-Identität ist die zentrale Merge-Warnung** (siehe Safety-Urteil unten): geprüft und freigegeben ist ausschließlich `6249608` auf `phase/al-p9-briefing-impl`. Der gleichnamige `phase/al-p9-briefing` (`4d3e02c`) ist ein veralteter, divergenter Baum (34 Dateien Unterschied, fehlt u.a. die gesamte AL-P5-Arbeit) und darf nicht gemergt werden.

---

## 3. Safety-Urteil (final)

**approved: true** — alle Kernflags grün: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. Keine Blocker.

**Verdict-Kern:** PASS für `6249608` auf `phase/al-p9-briefing-impl` — MIT Merge-Warnung zur Branch-Identität (s.o.).

- **Scope:** sauber, genau 10 Dateien im Diff, keine neue Dependency, keine neue Env-Var/BASE_ENV-Drift, kein Gate-Code berührt.
- **Regel 1 (Safety-Gates):** gestärkt, nicht nur intakt — schließt genau das Loch, das die Spezifikation als Vorbedingung nennt (Abbruchpfad buchte bisher 0 trotz nachweislich gesendetem Versuch). Keine Gate-Zeilen im Diff berührt; Boot-Guard-Eingaben unverändert.
- **Regel 2 (Offenlegung):** `git diff master..branch -- src/claude.js src/bridge.js src/locales.js` liefert 0 Zeilen.
- **Regel 3 (Auth fail-closed):** keine neue Route/Handler; Erweiterung eines bereits authentifizierten, validierten Bodys um ein gedeckeltes Feld.
- **Regel 4/5 (Secrets/Audio):** `console.warn` trägt nur Grund-Enum + zwei Token-Zahlen, kein Prompt-Inhalt/Secret/PII; kein Audio-Pfad berührt.
- **Verhalten wie spezifiziert:** Flag aus → byte-identisch zum Bestand; `open_questions` erreicht den gesprochenen Prompt nachweislich nicht (grep + AL-P9-8 Byte-Gleichheits-Test); über MCP nicht erreichbar (fehlt im zod-Schema von `place_call`).

**Concerns (keine Blocker):**
1. Branch-Identitäts-Warnung (siehe oben) — vor Merge lesen.
2. `estimatedAbortUsage` rechnet Input-Token nur aus `system.length + userText.length`, das Tool-Schema (~1,9 kB) fließt bei Anthropic aber ins Input-Token mit ein — gemessen ~500 geschätzt vs. ~830 real. Regel 1 hält trotzdem (nie 0), Geldwirkung ~0,1 ct/Abbruch; Kommentar „PESSIMISTISCHE Obergrenze" ist in diesem Punkt überzogen.
3. Bewusste Überbuchung bei transienten 5xx/429 (~1,2 ct, evtl. ohne dass Anthropic überhaupt generiert hat) — begrenzt durch den eigenen Breaker, Richtung gewollt und dokumentiert.
4. `bookEstimatedTokenUsage` umgeht `meterAiTokens` bewusst → Stripe-Ledger unterzählt bei Abbrüchen (Umsatzverlust, kein Schutzverlust) — sauber begründet, gehört bei Flag-AN in die Geld-Doku.
5. `prettier --check` warnt bei vier Dateien — als Bestands-Drift verifiziert (identisch auf `5bb7668`), keine neue Schuld; neue Zeile in `precall-briefing.js` ist trotzdem überlang.
6. `npm run lint` läuft im Worktree nicht (`eslint` keine Dependency) — nicht durch die Phase verursacht.
7. Abnahme der Phase ist heute nicht automatisierbar (Bench-Lücke, s.o.) — code-fertig, NICHT abgenommen; korrekt als Owner-Arbeit geparkt.

**Unabhängiger Testlauf:** frischer Worktree, `npm test` 3446/3446 grün (0 `not ok`), alle 9 neuen AL-P9-Tests einzeln bestätigt im Regressionslauf (kein Katalog-Präfix-Abrutscher). `npm run test:gates`: 126/129, dieselben 3 roten wie auf `master` direkt (Gegenprobe gefahren) → keine Gate-Regression. Beide-Backends-Hinweis: pg-Vollsuite offline konstruktionsbedingt nicht möglich, aber Diff berührt keinen Store-Pfad; relevante pg-Tests liefen grün mit.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS — keine Blocker.**

- **S1:** keine.
- **S2:** keine.
- **S3:** eine Fundstelle — `src/precall-briefing.js` (Abbruch-Erkennungsfunktion, dort `tokensLikelyConsumed()`/negierte Bedingung): doppelte Verneinung (`!(err instanceof ... && ...)`), liest sich schwerer als eine positiv formulierte `isCircuitOpen(err)`-Hilfsfunktion mit invertiertem Aufruf am Call-Site. Kein Blocker, gut kommentiert, leichter Lesbarkeits-Abzug.
- **S4:** keine.

**passNotes:** Kostenbuchung sauber über eine Buchungsstelle geführt (G5, kein Doppelpfad) für Erfolgs- und Abbruchpfad. `LLM_UNAVAILABLE_REASON` als eine Quelle statt neuer Magic Strings. Limit-Objekt für `open_questions` wiederverwendet das `key_facts`-Muster statt eines zweiten identischen Objekts (S2 sauber). `open_questions` bewusst noch ohne Konsument in `claude.js` — laut Plan explizit als Eingabe für eine spätere Phase angelegt, keine vergessene Verdrahtung. Testabdeckung dicht (B13-B16 pinnen Abbruch-Buchungspfad deterministisch/laengen-monoton/nie-0, BR1 belegt zusätzlich, dass nur der offene Breaker ungebucht bleibt). Isolierter Testlauf 25/25 grün; ein Fehlschlag im ersten Vollsuite-Lauf verschwand im zweiten sauberen Lauf — deckt sich mit dem bekannten vorbestehenden Suite-Flake (Seed-vor-Boot-Race), keine echte Regression.

**Bemerkter Nebenbefund (dokumentiert, kein Blocker):** Der Diff enthält parallel einen vollständigen Revert von AL-P5 (`OPENING_GOAL_MAX_CHARS` 75→160, `user_idle_reply_secs` 2→4, `BENCH_MAX_OPENING_CHARS` entfernt) — in `tasks/al-chain-state.md` als bewusste Prozessentscheidung dokumentiert (AL-P5 wurde zurückgesetzt, AL-P9 läuft neu auf dem dadurch veränderten master), kein stiller/unbegründeter Verhaltenswechsel.

**topTodos:**
1. Keine Blocker — merge-fähig aus Clean-Code-Sicht.
2. Optional/kosmetisch: negierte Bedingung als positiv formulierte `isCircuitOpen()`-Hilfsfunktion umschreiben (S3, kein Muss).
3. Fachlich (nicht Clean-Code, außerhalb der Phase): Bench-Lücke für `open_questions`-Blindtest ist bereits in `tasks/al-testcall-checklist.md` dokumentiert.

---

## 5. Fix-Runden

Keine. Beide Reviews (Safety, Clean-Code) kamen im ersten Durchlauf zu PASS ohne Blocker; alle offenen Punkte stehen als Concerns/S3-Hinweis, keiner rechtfertigte eine Fix-Runde.
