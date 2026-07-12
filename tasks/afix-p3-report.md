# Phase afix-p3: Farewell-Hangup im Watchdog

**Status:** Gate = PASS
**finalBranch:** `phase/afix-p3-farewell-hangup-fix2`
**headCommit:** `0de3074013f576a6a840526960d594ebd3d3037c`
**Basis:** `master` (HEAD `bed694e`)
**Fixt:** RCA R4 (turn_ok mit `end_call` 08:25:23.850 -> Telnyx-Hangup 08:25:23.931 = 81 ms; die TTS-Wiedergabe des Abschieds hatte nicht mal begonnen)
**Autoritativ:** `tasks/assistant-fix-spec.md` §P3 + "Gemeinsame Leitplanken"; Umbrella `PLAN-ASSISTANT-CONVERSATION-FIX.md` §P3

---

## 1. Plan (gekuerzt)

### Design-Kern — vier Kernfragen

**(a) Suspendierung des Dead-Air-Timers, kein Doppel-Feuern.**
Der Watchdog-State bekommt ein zweites Timer-Feld. `scheduleFarewellHangup` loescht den Dead-Air-Timer physisch (kein "nur nicht erneuert") und stellt keinen neuen. Aufgehoben wird die Suspendierung ausschliesslich durch `observeTurn` (naechster Turn = Gespraech laeuft weiter). Ohne diese Suspendierung koennte bei `TELNYX_DEAD_AIR_TIMEOUT_S=5` der Dead-Air-Timer mitten im Abschied feuern (praeemptiver Hangup + irrefuehrendes `dead_air`-Log).

**(b) Genau EIN terminate pro Call**, ueber vier Wege, serialisiert durch den `states`-Map-Eintrag (Node kooperativ single-threaded):
1. Farewell-Timer feuert -> `states.delete(callId)` **vor** dem `terminate` (one-shot, Muster von `onDeadAir`); ein spaeter eintreffender `call.hangup` laeuft in `clear()` ins Leere.
2. `observeTurn` waehrend des Delays -> `clearFarewellTimer` -> kein terminate.
3. `clear(callId)` (externer Hangup, jede Quelle) -> loescht beide Timer -> externer Hangup gewinnt immer.
4. Zweiter `scheduleFarewellHangup` fuer denselben Call -> ersetzt den Timer (idempotent wie `arm`), nie zwei parallele Terminierungen.

**(c) `speechChars`.** Quelle ist `turn.speech` (exakt der Completion-Content). Gelesen ueber neuen Guard `speechTextOf(turn)` — ersetzt die bisherige Inline-Duplizierung in `messagesTurnShape` (G5, eine Quelle). Leerer/fehlender Text -> `length === 0` -> `delayMs = FAREWELL_MIN_MS = 3000` (nie 0, nie sofortiger Hangup). `farewellDelayMs` haertet zusaetzlich gegen `NaN`/negativ ab, da `setTimeout(fn, NaN)` sofort feuert — genau der Defekt, den P3 behebt.

**(d) Notaus bleibt sofortig.** Loop-Guard und Mid-Call-Budget-Kill rufen unveraendert `await terminateCall(call.id)`. Kein loser `setTimeout` ausserhalb des Watchdogs.

### Geplante Aenderungen

**`src/telnyx-conversation-watchdog.js` (Kern)**
- Modul-Kopfkommentar: "Zwei Achsen" -> "Drei Achsen, EIN per-callId-Zustand" (dritte Achse = Farewell-Hangup).
- Neue, bewusst NICHT konfigurierbare Modul-Konstanten (keine neue Env-Var):
  `FAREWELL_BASE_MS=1500`, `FAREWELL_MS_PER_CHAR=70`, `FAREWELL_MIN_MS=3000`, `FAREWELL_MAX_MS=12_000`.
- Neue reine Funktion `farewellDelayMs(speechChars)`: `clamp(1500 + chars*70, 3000, 12000)`, mit `Number.isFinite`-Guard.
- State erweitert auf `{ deadAirTimer, farewellTimer, emptyStreak }` (statt einem `timer`-Feld), symmetrische Loescher `clearDeadAirTimer`/`clearFarewellTimer`, `restartDeadAirTimer` (vorher `restartTimer`).
- Neue oeffentliche API `scheduleFarewellHangup(callId, speechChars)`: loescht Dead-Air-Timer, ersetzt Farewell-Timer, liefert `{ delayMs }` zurueck (fuer PII-freies Logging beim Aufrufer).
- `onFarewellDue(callId)`: one-shot — State vor `terminate` loeschen, `Promise.resolve(terminate(callId)).catch(() => {})` (keine unhandled rejection im Timer-Callback).
- `observeTurn`: neue Zeile `clearFarewellTimer(s)` vor `restartDeadAirTimer` (neuer Turn cancelt einen laufenden Abschied).
- `clear(callId)`: loescht jetzt beide Timer.
- Rueckgabe der Factory erweitert um `scheduleFarewellHangup`. Keine Export der Konstanten (G8, minimale Oberflaeche).

**`src/telnyx-llm-shim.js` (minimal)**
- Neuer Guard `speechTextOf(turn)`, ersetzt Inline-Duplikat in `messagesTurnShape` (G5).
- Neuer PII-freier Log-Marker `logShimFarewell({callId, delayMs})` -> `[telnyx-shim] farewell_scheduled {...}`.
- Schritt 7: `endCall`/`farewellChars` werden **vor** `writeCompletion` gesetzt (Draht-Repraesentation `content: turn.speech` bleibt byte-identisch), damit auch ein Catch-Durchfall nach erfolgreichem `agentTurn` (T5-Szenario) den Hangup weiter plant.
- Schritt 8 (der eigentliche Fix): `if (endCall) { const { delayMs } = watchdog.scheduleFarewellHangup(call.id, farewellChars); logShimFarewell(...); }` statt bisher `if (endCall) await terminateCall(call.id);`.
- C2-Pflege: Doc-Kommentar an `terminateCall` aktualisiert (end_call laeuft jetzt ueber `scheduleFarewellHangup`); `terminateCall` bleibt genutzt (Loop-Guard, Budget-Kill) — kein toter Code.
- Nicht angefasst: `src/server.js`, `src/config.js`, `.env.example`, `render.yaml`, `src/telephony/*`, `src/claude.js`, `src/telnyx-inbound.js` (byte-identisch), `src/telnyx-call-control-ingest.js`.

**Tests**
- `test/telnyx-shim-harness.js`: `fakeTimers()`/`makeTestWatchdog()` aus `telnyx-stab-p9-watchdog.test.js` hierher verschoben (drei Testdateien teilen sie jetzt), plus neue `pendingDelays()` (offene Timer-Delays in Stell-Reihenfolge — einzige Moeglichkeit, "Dead-Air suspendiert" zu beweisen, da reine Hangup-Zaehlung das nicht zeigen kann).
- Neu `test/telnyx-afix-p3-farewell.test.js`: F1-F8 auf Watchdog-Ebene (echter Watchdog + echter `makeCallControlTerminator`, Fake-Timer, kein Netz/Spawn). Erwartungswerte bewusst hart kodiert (Test-Orakel).
- `test/telnyx-shim-endcall.test.js`: auf neuen Kontrakt gezogen (echter Watchdog statt `noopWatchdog`), E1/E1b/E2/E4/E5/T5/T5b.
- `test/telnyx-stab-p9-watchdog.test.js`: T1-T9 unveraendert gruen (Regressionsbeweis "Notaus bleibt sofortig"), nur T10 auf den neuen Farewell-Kontrakt gezogen.
- `test/helpers.js`: `noopWatchdog` um `scheduleFarewellHangup: () => ({ delayMs: 0 })` ergaenzt.

**Doku**
- `PLAN-SECURITY.md`, Abschnitt "C-TELNYX": neuer Bullet zur bewussten Abweichung (verzoegerter Hangup, Kosten-Effekt bis 12s, hart gedeckelt, Backstop-Kette, akzeptiertes Restrisiko Prozess-Restart mid-Delay).

**Pre-Mortem (Plan-Ebene)**
- Kunde redet waehrend des Abschieds weiter -> `observeTurn` cancelt (F3).
- Dead-Air terminiert mitten im Abschied -> physische Suspendierung (F2).
- Doppel-Hangup / irrefuehrendes `dead_air`-Log -> one-shot-Delete + `clear` loescht beide Timer + zweiter `schedule` ersetzt (F4/F8).
- 12s-Delay Kosten-Explosion -> harter Deckel, ~0,2 min/Call, Budget-Gates unveraendert.
- NaN-Delay -> `Number.isFinite`-Guard + `FAREWELL_MIN_MS`, getestet (F5).
- Blast-Radius: 2 Produktionsdateien, 4 Testdateien + 1 neue, 1 Doku-Datei. Keine neue Env-Var, keine neue Dependency, kein `server.js`-Eingriff, Inbound byte-identisch, Flag `TELNYX_AI_ASSISTANT_ENABLED` aus -> Pfad in Produktion inaktiv (404).

---

## 2. Implementierungs-Zusammenfassung

Phase exakt gemaess Plan umgesetzt.

- **`src/telnyx-conversation-watchdog.js`**: dritte Achse `scheduleFarewellHangup`. `end_call` terminiert nicht mehr sofort, sondern nach `clamp(1500ms + Zeichen*70ms, 3000ms, 12000ms)`. Waehrend der Verzoegerung ist der Dead-Air-Timer physisch suspendiert (ersetzt, nicht nur pausiert). `observeTurn` cancelt den Farewell bei einem neuen Turn. `clear()` (externer Hangup) gewinnt immer. Genau EIN terminate pro Call (one-shot `state.delete`).
- **`src/telnyx-llm-shim.js`**: neuer `speechTextOf`-Guard (G5, ersetzt Inline-Duplikat in `messagesTurnShape`); Schritt 8 ruft jetzt `watchdog.scheduleFarewellHangup` statt `terminateCall`; neuer `farewell_scheduled`-Log (PII-frei).
- **Test-Infrastruktur**: `fakeTimers`/`makeTestWatchdog`/`pendingDelays` aus `telnyx-stab-p9-watchdog.test.js` in `telnyx-shim-harness.js` verschoben (G5) und von drei Testdateien geteilt.
- **Neue/angepasste Tests**: `test/telnyx-afix-p3-farewell.test.js` (F1-F8, neu), `test/telnyx-shim-endcall.test.js` (E1 angepasst, E1b neu, E2/E4/E5/T5/T5b auf Farewell-Kontrakt gezogen), `test/telnyx-stab-p9-watchdog.test.js` (T10 angepasst, Fake-Timer-Harness jetzt importiert statt lokal definiert), `test/telnyx-shim-harness.js` (neue Exporte), `test/helpers.js` (`noopWatchdog` komplettiert).
- **`PLAN-SECURITY.md`**: C-TELNYX-Abschnitt um den neuen Bullet erweitert.

### Deviations
Keine (`deviations: []`).

### Ergebnis-Kennzahlen
- `node --check` auf allen 7 geaenderten/neuen Dateien: PASS
- `npm test`: 2131 Tests, 2131 pass, 0 fail
- `committed: true`

### Geaenderte/neue Dateien (im Impl-Worktree)
- Neu: `test/telnyx-afix-p3-farewell.test.js`
- Editiert: `src/telnyx-conversation-watchdog.js`, `src/telnyx-llm-shim.js`, `test/telnyx-shim-harness.js`, `test/telnyx-stab-p9-watchdog.test.js`, `test/telnyx-shim-endcall.test.js`, `test/helpers.js`, `PLAN-SECURITY.md`

### Smoke-Test
Kein echter Anruf/Netz-Call durchgefuehrt (Plan: best-effort, Unit-Tests reichen). Adapter-Verhalten (Watchdog -> `makeCallControlTerminator` -> `voiceControl.endCallViaCallControl`) end-to-end per Unit-Test (F1, E1, T5, T10) mit echten Factories gegen Fake-Store/-VoiceControl/-Timer bewiesen — keine Mocks der Kernlogik. `server.js` unangetastet, Flag `TELNYX_AI_ASSISTANT_ENABLED` bleibt aus -> Pfad in Produktion inaktiv (404). `smokePass: true`.

---

## 3. Safety-Urteil

**Verdict: APPROVED**

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, `blockers: []`.

**Unabhaengiger Test-Nachweis:** Fresh Worktree, node_modules symlinked, Branch `review-afix-p3-r2` aus `phase/afix-p3-farewell-hangup-fix2`. Voller `npm test`: 2131/2131 pass, 0 fail, exit 0 (~71s). Isoliert: `telnyx-afix-p3-farewell.test.js` + `telnyx-shim-endcall.test.js` + `telnyx-stab-p9-watchdog.test.js` + `telnyx-p6-midcall-budget-kill.test.js` -> 30/30 pass. `node --check` auf beiden Kern-Dateien gruen. Keine Netz-/Spawn-Abhaengigkeit in den P3-Tests.

**Pruefpunkte (a)-(g), alle erfuellt:**

- **(a) Laenger offen:** Ja, aber hart gedeckelt (max. +12s, `FAREWELL_MAX_MS`, keine Env-Var). Farewell-Timer ist selbst ein terminate, kein Aufschub ins Offene. Backstop-Kette verifiziert: Farewell-Cap -> Dead-Air-Watchdog (bei jedem `observeTurn` re-armiert) -> in-Prozess Max-Dauer-Cap (`server.js:1800 armMaxDurationTimer`, nach Restart via `reattachActiveCall` re-armiert) -> provider-seitiges `time_limit_secs` -> Budget-Gates. In `PLAN-SECURITY.md` dokumentiert.
- **(b) Genau EIN terminate** in allen 5 Pfaden nachgewiesen (`terminateOnce` one-shot, `observeTurn` cancelt vor Re-Arm, `clear()` gewinnt immer, Loop-Guard/Budget-Kill laufen nach `observeTurn`, zweiter `scheduleFarewellHangup` ersetzt (F8)). Keine unhandled rejection (`Promise.resolve(terminate(...)).catch(() => {})`, Test E5).
- **(c) Notaus sofortig:** Loop-Guard/Budget-Kill rufen unveraendert `await terminateCall`, Tests T8/T9 belegen weiterhin sofortigen Hangup.
- **(d) Dead-Air Re-Arm:** `observeTurn` ruft unbedingt `restartDeadAirTimer` nach `clearNamedTimer(farewell)`; kein Zustand mit beiden Timern null waehrend der Call lebt; bewiesen durch F3 und T10 via `pendingDelays()`.
- **(e) Kein loser `setTimeout`:** einziger `setTimeout` ist der praeexistente `defaultSetTimer`-Seam.
- **(f) Keine Gate-Aenderung:** Diff beruehrt weder `safeEqual`/Bearer-Gate, ccid-Korrelation, Call-Resolve, Rate-Limiter, Budget-Checks noch Signaturpruefung. `src/config.js`, `.env.example`, `package.json` unveraendert. `src/telnyx-inbound.js` byte-identisch. Offenlegungs-/Opening-Anker unangetastet.
- **(g) Logs PII-frei:** `farewell_scheduled` traegt nur `{callId, delayMs}`.

**Concerns (alle nicht blockierend):**
1. Kein Retry-Backstop bei fehlgeschlagenem Call-Control-Hangup (State wird vor `terminate` geloescht, Fehler geschluckt) — praeexistent, spec-mandatiert, identisch zum alten Pfad, keine P3-Regression.
2. Prozess-Restart mid-Delay verliert den Farewell-Timer — in `PLAN-SECURITY.md` als akzeptiertes Restrisiko dokumentiert, Backstop-Kette greift.
3. `delayMs` im `farewell_scheduled`-Log ist ein geklammerter Laengen-Proxy (kein Inhalt, kein PII-Leak), Spec verlangt genau `{callId, delayMs}`.
4. Ueberlappende Shim-Turns (Turn A `end_call=true`, spaeter aufloesender Turn B mit `end_call=false`, dessen `observeTurn` vor dem Scheduling lag): Farewell wird nicht gecancelt, terminiert nach 3-12s. Bounded, terminierend, kein Kosten-Risiko (im Altcode haette A sofort aufgelegt).
5. Max-Dauer-Cap-Timer und Farewell-Timer sind unabhaengige Achsen; im Extremfall beide feuern -> zwei Hangup-API-Aufrufe auf denselben Call. Provider-seitig idempotent, Fehler geschluckt; dieselbe Klasse bestand bereits zwischen Max-Dauer-Cap und Dead-Air-Timer.

Zusaetzlich positiv vermerkt: Deduplizierung statt Kopieren (`terminateOnce` als gemeinsamer Kern von `onDeadAir`/`onFarewellDue`, `clearNamedTimer`, `speechTextOf` als eine Quelle, geteilte Fake-Timer-Harness). Bestandstests angepasst statt dupliziert, ohne aufgeweicht zu werden (T8/T9 pruefen weiterhin sofortiges Terminate; T10 prueft jetzt Suspendierung + kein Doppel-Hangup).

---

## 4. Clean-Code-Audit (finale Runde)

**Verdict: PASS** (`blocker: false`)

Keine S1/S2-Verstoesse. Der Diff loest die im Auftrag benannten Risiken sauber: Farewell-/Dead-Air-Timer sind keine zwei parallelen Timer-Verwaltungen (`clearNamedTimer` + `terminateOnce` buendeln die gemeinsame Logik ueber den Feldnamen), alle vier genannten Magic Numbers (1500/70/3000/12000) sind benannte Konstanten (`FAREWELL_BASE_MS`/`FAREWELL_MS_PER_CHAR`/`FAREWELL_MIN_MS`/`FAREWELL_MAX_MS`). Keine Umlaute in Kommentaren (grep ueber vollen Diff: 0 Treffer). `node --check` auf allen 7 Dateien gruen; volle Suite (2131 Tests, davon 27 fuer diese Phase) gruen in der Schwester-Worktree.

**S1 (Blocker):** keine
**S2 (Blocker):** keine

**S3 (nicht blockierend):**
- G16/G25 · `PLAN-SECURITY.md:173` · Tippfehler "Budget-Gates (global n Tenant, pro Shim-Turn)" — vermutlich "global UND Tenant" gemeint. Fix: Formulierung korrigieren (reine Doku).
- G11 (Konsistenz) · `test/telnyx-stab-p9-watchdog.test.js:328` · Erwarteter Delay als nackte Zahl `[3000]` assertet (kein Import moeglich, `FAREWELL_MIN_MS` nicht exportiert) — ohne den Begleitkommentar, den `telnyx-afix-p3-farewell.test.js` fuer hart kodierte Erwartungswerte hat. Fix (optional): denselben Ein-Zeiler-Kommentar an T10 ergaenzen.

**S4:** keine

**Top-TODOs (offen, nicht blockierend):**
1. Tippfehler `PLAN-SECURITY.md:173` ("global n Tenant") klarstellen.
2. Optional: Kommentar zur hart kodierten 3000 in T10 (`telnyx-stab-p9-watchdog.test.js`) ergaenzen, analog zur Begruendung in `telnyx-afix-p3-farewell.test.js`.

**Pass-Notes (positiv hervorgehoben):**
1. S2-Risiko aus dem Auftrag aktiv entschaerft — `clearNamedTimer(s, timerField)` + `terminateOnce(callId, timerField, {onBeforeTerminate})` sind der gemeinsame Kern fuer Dead-Air- und Farewell-Timer (State-Objekt mit zwei benannten Feldern, keine zwei Maps/Klassen).
2. Alle vier Magic Numbers als benannte, kommentierte Modul-Konstanten mit klarer Herleitung (~14 Zeichen/s + Anlauf, hart geklammert).
3. `farewellDelayMs()` faengt NaN/negative Laengen explizit ab, mit Kommentar, warum (`setTimeout(NaN)` feuert sofort — der urspruengliche Bug).
4. PII: einziger neuer Log (`farewell_scheduled`) traegt nur `callId`+`delayMs`, per eigenem Test (E1b) verifiziert.
5. Testfabrik-Duplizierung vermieden: `fakeTimers()`/`makeTestWatchdog()` verschoben statt kopiert (eine Quelle fuer 3 Testdateien).
6. Kommentare konsequent auf Deutsch ohne Umlaute (0 Treffer im Diff).
7. `PLAN-SECURITY.md` dokumentiert die bewusste Kosten-/Risikoabweichung exakt nach CLAUDE.md-Vorgabe.
8. Volle Suite 2131/2131 gruen, keine Regression.

---

## 5. Fix-Runden

**Runde 1 (r1):** G5/S2-Blocker in `src/telnyx-conversation-watchdog.js` behoben — die vier strukturell identischen Hilfsfunktionspaare (`clearDeadAirTimer`/`clearFarewellTimer` und `onDeadAir`/`onFarewellDue`) auf zwei gemeinsame Helfer reduziert: `clearNamedTimer(s, timerField)` ersetzt beide Clear-Funktionen (generisch ueber das Timer-Feld), ein gemeinsamer `terminateOnce`-Kern buendelt die one-shot-Terminierungslogik.

**Runde 2 (r2):** Einziger Blocker (G5/G12: `DEAD_AIR_TEST_MS` exportiert, aber ungenutzt — 4 Assertions duplizierten stattdessen den nackten Wert `30_000`) behoben. `DEAD_AIR_TEST_MS` wird jetzt in `test/telnyx-afix-p3-farewell.test.js` (F2, F3) und `test/telnyx-shim-endcall.test.js` (E4, T5b) importiert und in den 4 betroffenen Assertions verwendet statt des nackten Literals.

Nach Runde 2: Gate = PASS, keine weiteren Blocker.
