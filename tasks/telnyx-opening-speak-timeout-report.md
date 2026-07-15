# Report: Phase telnyx-opening-speak-timeout

**Datum:** 2026-07-15
**Gate:** BLOCKED
**finalBranch:** `phase/telnyx-opening-speak-timeout-fix3`
**Plan/Quelle:** `PLAN-TELNYX-AI-ASSISTANT-NO-AUDIO.md` (Befund 2), Spec `tasks/telnyx-opening-speak-timeout-spec.md`

## Kontext

Befund 2 aus `PLAN-TELNYX-AI-ASSISTANT-NO-AUDIO.md`: Telnyx' Speak-Command kann
verstummen, **ohne je ein `call.speak.started/ended/failed` zu emittieren**
(Live-Test Call 2/3, 2026-07-14, per Telnyx-API `list_call_events` bestaetigt —
das Event wurde nachweislich nie generiert, kein Zustellproblem unsererseits).
`src/telnyx-call-control-ingest.js` reagiert nur auf
ANSWERED/SPEAK_ENDED/SPEAK_FAILED/HANGUP — faellt keines dieser Events, haengt
der Opening-Speak-Node bis zum manuellen Hangup in absoluter Stille (kein
Timeout, kein Retry, kein Log-Signal).

Ziel der Phase: Opening-Speak-Timeout-Guard — nach `onAnswered` einen per-Call
Watchdog-Timer armieren; feuert er nach `config.telnyxOpeningSpeakTimeoutS`
Sekunden ohne echtes Terminal-Event, wird **dieselbe `onSpeakFailed`-Funktion**
aufgerufen wie bei einem echten `call.speak.failed` (G5, kein zweiter
Fehlerpfad → Azure-Retry falls Assistant-Config frei, sonst Fail-Safe). Befund 1
(Media-Bridging) ist NICHT Teil dieser Phase.

## Plan (gekuerzt)

**Root Cause / Fix-Idee:** Zweite Ein-Zweck-State-Map `openingSpeakTimers`
(analog `openingRetryUsed`) im Ingest-Modul. `armOpeningSpeakTimeout(call,
callControlId)` wird am Ende von `onAnswered` aufgerufen, raeumt vorher einen
evtl. laufenden Timer ab (nie zwei Timer je Call) und setzt einen neuen via
injizierbarem `setTimer` (Default `defaultSetTimer` mit `.unref()`, Muster
`telnyx-conversation-watchdog.js`). Feuert der Timer, ruft er
`onSpeakFailed(call, callControlId)` — byte-identisch zum echten
Fehlerereignis. `clearOpeningSpeakTimer(callId)` wird idempotent aus
`onSpeakEnded`, `onSpeakFailed` und `onHangup` aufgerufen.

**Config:** neue Konstante `telnyxOpeningSpeakTimeoutS` in `src/config.js`
(`numEnv`, Fallback 45s, `min:10`/`max:120` — Sprechdauer Call 1 war 16.57s,
45s laesst Spielraum ohne bei einem echten Stall endlos zu warten; `min:10`
verhindert ein lautlos inertes Abschalten des Guards, P9-CFG1-Footgun-Muster).
`config` wird lazy in `armOpeningSpeakTimeout` gelesen (nicht im Factory-Body),
damit `telnyx-stab-p9-watchdog.test.js` (konstruiert Ingest ohne `config`,
trifft nie `onAnswered`) unveraendert gruen bleibt.

**Clean-Code-Entscheidungen laut Plan:** kein neues Modul, keine neue
Dependency; `MS_PER_SECOND`-Konstante lokal (G25); `defaultSetTimer`
bewusst als Micro-Duplizierung zum Watchdog-Idiom akzeptiert und begruendet
(4-Zeilen-Muster existiert bereits 2x im Repo, ein Shared-Modul fuer einen
Consumer waere S4-Ueberabstraktion).

**Pre-Mortem (Auszug):** Timeout zu kurz → doppelte Offenlegungs-Audio
(entschaerft durch 45s ≫ 16.57s + `min:10`-Clamp); `config` fehlt in Prod →
Crash bei `answered` (entschaerft durch `server.js`-Edit + `node --check` +
Bestandstests, die ebenfalls crashen wuerden); Timer-Callback wirft
(Azure-Retry-Netzfehler) → unhandled rejection (entschaerft durch `.catch()`);
Regel 2 (Offenlegung) — Timeout re-spricht denselben `openingText`, startet
NIE den Assistant ohne gehoerte Offenlegung; Regel 1 (Safety-Gates) — Timeout
loest keinen Call/keine SMS/kein Geld aus, nur Speak auf bereits aktivem Call
oder Fail-Safe-Log.

**Blast-Radius laut Plan:** `src/config.js` (+1 Konstante),
`src/telnyx-call-control-ingest.js` (+Map, +2 Helper, +`defaultSetTimer`/
`MS_PER_SECOND`, je 1 Clear-Zeile in `onSpeakEnded`/`onSpeakFailed`/`onHangup`,
1 Arm-Zeile in `onAnswered`), `src/server.js` (+`config,` im Ingest-Deps-
Objekt), `.env.example` (+1 Env-Eintrag, dokumentierter Sandbox-Caveat: Datei
per `danger-guard.sh` fuer Read/Bash gesperrt), `test/helpers.js` (+1
BASE_ENV-Pin), `test/telnyx-event-ingest-machine.test.js` (+5 neue Tests),
`test/telnyx-p8-opening-contract.test.js` (Wiring, keine neuen Faelle). Keine
neue npm-Dependency, `bridge.js`/`telnyx-conversation-watchdog.js` unberuehrt.

## Implementierung — Zusammenfassung

Umsetzung exakt gemaess Plan. Watchdog-Timer
(`config.telnyxOpeningSpeakTimeoutS`, Default 45s/min 10/max 120) wird nach
`onAnswered` armiert; feuert er ohne `speak.ended`/`speak.failed`, ruft er
dieselbe `onSpeakFailed`-Funktion wie bei einem echten `call.speak.failed`
(Azure-Retry oder Fail-Safe, G5 — kein zweiter Fehlerpfad). Timer wird bei
`speak.ended`/`speak.failed`/`hangup` idempotent geloescht.
`defaultSetTimer`(`.unref()`) + `setTimer`/`clearTimer` als injizierbare
Defaults (Muster `telnyx-conversation-watchdog.js`).

**Blast-Radius wie geplant:** `src/config.js`, `src/telnyx-call-control-ingest.js`,
`src/server.js`, `test/helpers.js`,
`test/telnyx-event-ingest-machine.test.js` (+5 Tests, 25→30),
`test/telnyx-p8-opening-contract.test.js` (Wiring, 3 Tests unveraendert
gruen). Sibling-Suiten `telnyx-stab-p9-watchdog` (10) und `telnyx-speak-events`
(9) byte-identisch gruen.

**Verifikation laut Implementierungsschritt:** `node --check` auf allen 3
geaenderten Source-Dateien sauber. `npm test`: 2192/2192 gruen, 0 fail
(Netto-Delta +5 wie erwartet, absolute Zahl driftet erwartungsgemaess ggue.
Plan-Schaetzung 2189→2194 — Plan selbst weist auf "Counts rotten" hin).
Smoke: Server bootet mit `TELNYX_OPENING_SPEAK_TIMEOUT_S=20` im Env,
`/healthz` → 200 (kein echter Live-Call ausgeloest).

### Deviations

- **`.env.example`-Eintrag (Plan-Punkt D) NICHT gesetzt.** `danger-guard.sh` +
  Directory-Deny sperren den Pfad in der Sandbox fuer Read UND Bash (vom Plan
  selbst als bekannter Caveat dokumentiert, nicht selbst verursacht). Die
  Konvention `src/config.js` ↔ `.env.example` ist dadurch aktuell NICHT
  synchron — manueller Nachtrag noetig: Zeile
  `TELNYX_OPENING_SPEAK_TIMEOUT_S=45` nach dem
  `TELNYX_DEAD_AIR_TIMEOUT_S`-Eintrag einfuegen. Wurde in Fix-Runde 3 in der
  finalen Clean-Code-Review erneut als S3-Konventions-Luecke bestaetigt.
- **Absolute Test-Zahl weicht leicht von der Plan-Schaetzung ab** (2192 statt
  2189-2194 erwartet) — laut Plan selbst erwartungsgemaeß ("Counts rotten"),
  das Netto-Delta von +5 (tatsaechlich hinzugefuegte Tests) stimmt exakt.

## Safety-Urteil (final)

| Kriterium | Ergebnis |
|---|---|
| `approved` | true |
| `testsPassIndependently` | true |
| `safetyGatesIntact` | true |
| `disclosureIntact` | true |
| `authFailClosedIntact` | true |
| `noSecretsLeaked` | true |
| `scopeRespected` | true |
| `behaviorAsIntended` | true |
| `blockers` | keine |

**Unabhaengiger Test-Lauf:** vollstaendiger `npm test`-Selbstlauf — 2196
gruen / 0 fail / 0 skipped (7 Suiten, ~87.5s), deckt beide Backends ab (JSON
Default + PG via pglite in-process ueber die dedizierten `*-pg.test.js`-
Dateien). Gezielter Re-Run der geaenderten Telnyx-Testdateien
(`telnyx-event-ingest-machine`, `telnyx-stab-p9-watchdog`,
`telnyx-p8-opening-contract`): 47/47 gruen. `node --check` sauber auf allen
geaenderten `src/`-Dateien.

**Concerns (non-blocking auf der Safety-Achse):**

1. Neue Env-Variable `TELNYX_OPENING_SPEAK_TIMEOUT_S` fehlt in
   `.env.example`, obwohl das Pendant `TELNYX_DEAD_AIR_TIMEOUT_S` dort
   dokumentiert ist (CLAUDE.md-Pflicht) — sicherer Default (45s) heisst kein
   Safety-/Kosten-/Security-Impact, sollte aber vom Clean-Code-Reviewer/Lead
   nachgezogen werden.
2. Info (kein Defekt): naiver `git diff master..branch` zeigt `apps/web/*`-
   Churn — das ist Master-Divergenz-Rauschen (Merge-Base `66c45e5`, Master
   bei `daca1d4`), der Branch selbst hat keine `apps/web`-Dateien angefasst
   (per `git diff master...branch`, Drei-Punkt, bestaetigt).
3. Info (sichere Verfeinerung): `onSpeakFailed` gated jetzt zusaetzlich auf
   frischen Store-Status `active` vor einem Retry — betrifft auch den echten
   `call.speak.failed`-Eventpfad (vorher unbedingt). Ueberspringt Retries nur
   bei bereits terminierten Calls (kein legitimer Retry verloren), strikt
   sicherer; von einem aktualisierten `onHangup`-Test abgedeckt.

**Verdict:** APPROVED auf der Safety-/Verhaltens-Achse. Alle sechs
Pflicht-Checks bestehen, unabhaengiger Test-Lauf gruen (2196/2196, beide
Backends via pglite). Guard korrekt gescoped (nur Telnyx Call-Control, keine
neue npm-Dependency, keine `apps/web`-Aenderungen durch den Branch), beruehrt
kein Safety-Gate, laesst die feste Offenlegung (`claude.js`/`bridge.js`)
unveraendert (staerkt sie faktisch — Assistant startet nie beim Timeout, jedes
Re-Speak traegt die Offenlegung zuerst), Auth bleibt fail-closed (keine
neuen/geaenderten Endpunkte), keine Secrets-Lecks. Footgun-resistent: `numEnv`
`min:10` erzwingt Boot-Refusal unter der Untergrenze, Clamp ueber 120 — der
Guard kann nicht lautlos deaktiviert werden.

## Clean-Code-Audit (final)

| Kategorie | Findings |
|---|---|
| S1 | 1 — RACE (P16/G26, PLAUSIBLE): `onSpeakFailed`-Retry-Zweig prueft `freshCall`-Status nur EINMAL vor dem Retry-`await sendOpeningSpeak(...)`; danach folgt vor dem erneuten `armOpeningSpeakTimeout(...)` kein Re-Check. Laeuft waehrend des `await` parallel ein echter `hangup`/`cancel_call`/`terminateCappedCall`, wird (a) ein Speak-Retry an eine bereits beendete `callControlId` abgesetzt und (b) ein verwaister Timer fuer einen toten Call neu armiert. Blast-Radius klein (Speak laeuft ins Leere, Timer heilt sich beim naechsten Feuern ueber denselben `freshCall`-Guard selbst und raeumt sich ab), aber ein reales TOCTOU-Fenster, das der Guard eigentlich schliessen sollte. Fix-Vorschlag: nach dem `await` erneut `store.getCall(call.id)?.status === "active"` pruefen, bevor `armOpeningSpeakTimeout` erneut aufgerufen wird. |
| S2 | 2 — (a) `test/telnyx-p8-opening-contract.test.js` `driveAnswered()` baut das `fakeTimers()`+`config`/`setTimer`/`clearTimer`-Bundle lokal von Hand nach, statt das in DERSELBEN Phase zentralisierte `ingestTimeoutDeps()` (aus `test/telnyx-shim-harness.js`) zu nutzen — diese dritte Stelle blieb unmigriert. (b) `MS_PER_SECOND = 1000` in `src/telnyx-call-control-ingest.js` dupliziert eine byte-identische Konstante aus `src/telnyx-conversation-watchdog.js`, obwohl mit `src/utils/timer.js` in genau dieser Phase bereits ein gemeinsames Modul fuer Cross-File-Timer-Belange entstanden ist (der eigene Kommentar verweist sogar auf das Sibling, statt es zu importieren). |
| S3 | 1 — `TELNYX_OPENING_SPEAK_TIMEOUT_S` fehlt komplett in `.env.example`, obwohl strukturgleiche Nachbar-Vars (`TELNYX_DEAD_AIR_TIMEOUT_S`, `TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS`) dort dokumentiert sind — verstoesst gegen die CLAUDE.md-Konvention "Env-Variablen immer in `src/config.js` zentralisieren UND in `.env.example` dokumentieren". |
| S4 | keine |
| `blocker` | **true** |

**Verdict (final Review, Quelle des Gate-Status):** "Solide Phase mit sauberer
Historie (3 Review-Blocker-Runden haben reale Vorgaenger-Bugs bereits
behoben: stale-call-Retries, fehlender config-DI-TypeError, byte-identische
Fail-Safe-Zweige). 2196/2196 Tests gruen inkl. 9 neuer dedizierter
Timeout-Guard-Tests, keine toten Sicherungen, kein Money-Float, keine
Secrets-Lecks, kein auskommentierter Code. Aber: ein reales (wenn auch
schmales, selbstheilendes) Race-Fenster im Retry-Zweig von `onSpeakFailed`
(S1), zwei kleine, vermeidbare Duplizierungen (S2) und eine Doku-Luecke gegen
die eigene CLAUDE.md-Konvention (S3). Kein fundamentales
Architekturproblem — vor Merge aber die S1/S2-Punkte nachziehen."

**PassNotes (Auszug):** Config-Validierung (`numEnv`, min 10/max 120,
fail-closed via `fatalConfigErrors`) korrekt verdrahtet; BASE_ENV-Ergaenzung
verhindert Baseline-Drift; Extraktion von `defaultSetTimer` nach
`src/utils/timer.js` loeste eine VORHANDENE Duplikation sauber auf (keine
verwaisten Referenzen, grep bestaetigt); bewusste Trennung von
Opening-Speak-Timer und Conversation-Watchdog (unterschiedliche
Timing-/Terminierungssemantik) im Code begruendet, keine kuenstliche
Kopplung; Tests folgen durchgehend Build-Operate-Check, ein Konzept pro Test,
Grenzfaelle (Config fehlt, zweiter Retry-Timer feuert erneut, stale Call)
explizit abgedeckt.

**topTodos:**

1. Race-Fix in `onSpeakFailed`: Call-Status nach dem Retry-`await` erneut
   pruefen, bevor der Timer erneut armiert wird (S1).
2. `.env.example` um `TELNYX_OPENING_SPEAK_TIMEOUT_S` ergaenzen
   (Konventions-Luecke, CLAUDE.md-Pflicht).
3. Beide S2-Duplizierungen aufraeumen: `ingestTimeoutDeps()` auch in
   `telnyx-p8-opening-contract.test.js` nutzen, `MS_PER_SECOND` aus
   `utils/timer.js` statt lokal duplizieren.

## Fix-Runden

Drei Runden Review-Blocker wurden auf dem Ast
`phase/telnyx-opening-speak-timeout` bearbeitet (jeweils eigener
Fix-Branch/Commit, Basis der vorherigen Runde):

1. **Runde 1** (`phase/telnyx-opening-speak-timeout-fix1`, Commit
   `3d0975e`): Beide gemeldeten Review-Blocker der urspruenglichen Phase
   behoben. `onSpeakFailed`'s Event-Retry-Zweig (`call.speak.failed` → Retry
   mit Azure-Stimme) armiert seither ebenfalls `armOpeningSpeakTimeout(call,
   ...)` erneut, statt den Watchdog nach dem ersten Fehlschlag stillschweigend
   inaktiv zu lassen.
2. **Runde 2** (`phase/telnyx-opening-speak-timeout-fix2`, Commit `2542cf0`):
   Einziger gemeldeter Blocker `afix-timeout-caller-gap` (S1
   Korrektheit/Sicherheit + S2 Duplizierung) behoben — reiner Test-Fix in
   `test/telnyx-stab-p9-watchdog.test.js`, keine Prod-Code-Aenderung.
3. **Runde 3** (`phase/telnyx-opening-speak-timeout-fix3`, Commit `61ac221`):
   Beide Review-Blocker behoben, minimal, kein Scope-Drift.
   `AFIX-TIMEOUT-STALE-CALL` (S1, Korrektheit/Sicherheit): `onSpeakFailed`
   liest `store.getCall(call.id)` jetzt frisch und ist No-op bei
   `status !== "active"` — verhindert Retries auf bereits terminierte Calls.

**Aktueller Stand / warum Gate=BLOCKED:** Die oben dokumentierte finale
Clean-Code-Review (`blocker: true`, S1 Race + 2× S2 Duplizierung + S3
Doku-Luecke) ist der Stand, gegen den Fix-Runde 3 antritt — die Quelldaten
belegen die drei Fix-Commits (`3d0975e`/`2542cf0`/`61ac221`) auf dem Ast, aber
**keine anschliessende, bestaetigte finale PASS-Review** auf
`phase/telnyx-opening-speak-timeout-fix3`. Der Gate-Status bleibt daher
BLOCKED, bis ein erneuter dualer Review-Durchlauf (Safety + Clean-Code) auf
`fix3` ein PASS ohne S1/S2-Blocker bestaetigt. Naechste Schritte vor Merge:
die drei `topTodos` (Race-Fix, `.env.example`-Nachtrag, S2-Deduplizierung)
verifizieren und den finalen Review erneut fahren.
