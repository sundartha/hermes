# Phase `dead-air-speech` — Detailbericht

**Gate:** BLOCKED
**finalBranch:** `phase/dead-air-speech-impl-fix2`

---

## Plan (gekürzt)

**Basis:** `master` @ `3de1677`. Spec: `tasks/dead-air-speech-fix-spec.md` (autoritativ). `PLAN-MULTI-TENANT-TELNYX.md` existiert im Repo nicht — als Umbrella wurde stattdessen `PLAN-SECURITY.md` (Abschnitt zum verzögerten Hangup, afix-p3) herangezogen.

**Problem:** Der Dead-Air-Watchdog kannte bisher nur den Anrufer als Lebenszeichen (`observeTurn` läuft nur bei eingehendem Shim-Request) und maß damit "Anrufer schweigt" statt "Leitung tot" — lange Agentenantworten wurden mitten im Satz gekappt (Live-Beleg: Anruf endete nach 86 s, `hangup_source=caller`).

**Entwurfsentscheidung (Kern):** Zwei Umsetzungen möglich, gewählt wurde **(B)**:
- (A) Beim Antworten sofort neu armieren (`deadAirMs + Sprechdauer`) — verworfen, weil es Spec-Verifikation 4 ("kurze Antworten byte-identisch") verletzt und zwei Bestandstests bricht (E4, T5b).
- **(B, gewählt):** Der Wächter vertagt sich beim Feuern, statt vorher länger zu warten. `observeTurn` armiert unverändert `deadAirMs`. Ein Turn mit Sprechtext hinterlegt nur einen **absoluten Zeitstempel** `speechEndsAtMs = now() + min(Schätzung, Deckel)`. Feuert der Dead-Air-Timer, prüft er: steht laut Schätzung noch Sprechzeit aus?
  - nein → terminiert exakt wie im Bestand, strukturell identisch mit Verifikation 4.
  - ja → vertagt sich **einmalig** um `Restsprechzeit + deadAirMs`.
- Kein Aufaddieren möglich (Auflage 4): Zustand ist absoluter Zeitstempel, kein Summand — ein zweiter Turn ersetzt ihn statt zu addieren.
- Preis: Watchdog braucht eine Uhr — `now = Date.now` injiziert (DI-Konvention wie `metrics.js`, `billing/cost-truing.js`).
- Geprüft: kein Bestandstest trifft die Vertagung ungewollt (E1/E1b/E2/E5/T5 laufen über `endCall=true`, E4/T5b feuern nie, T8/T9 räumen vorher, K0-6/afix-p3 sprechen den Watchdog direkt an).

**Edits (Kern):**
- `src/telnyx-conversation-watchdog.js`: Kalibrierung auf EINE Quelle entduplifiziert (`FAREWELL_*` → `SPEECH_*`/`estimatedSpeechMs`/`calibrationFor`), neuer Deckel `SPEECH_EXTENSION_MAX_MS = 90_000` (hergeleitet aus `TURN_MAX_TOKENS`≈300 → ~1200 Zeichen → ~78 s bei 65 ms/Zeichen, +Reserve), injizierte Uhr `now`, neue Zustandsfelder `speechEndsAtMs`/`speechExtendedMs`, neue Operation `noteAgentSpeech(callId, {speechChars, language})`, neuer Vertagungs-Zweig `extendForSpeech` in `onDeadAir`, eigener Log-Kanal `speech_extend` (bewusst NICHT als Substring von `dead_air`, um die Abnahme-Grep-Prüfung nicht falsch triggern zu lassen).
- `src/telnyx-llm-shim.js`: Variable `farewellChars` → `spokenChars` (jetzt zwei Verbraucher), Aufruf `watchdog.noteAgentSpeech(...)` nach jedem Turn — Basis ist `turn.speech.length` (was gesprochen wird), NICHT das, was `respond()` bei bereits gestreamten Turns abgibt (`""`). Verdrängte Turns (`superseded`) melden 0.
- `PLAN-SECURITY.md`: neuer Abweichungspunkt hinter `afix-p3` (Sprech-Verlängerung, Kosten-Effekt max. 90 s/Call, hart gedeckelt, keine Env-Var).
- Tests: `test/helpers.js`/`gq-p4-shim-failure-streak.test.js` (Watchdog-Doubles um `noteAgentSpeech` ergänzt), `test/telnyx-shim-harness.js` (`fakeClock`, `now`-Durchreichung), sechs neue Tests T12–T17 in `test/telnyx-stab-p9-watchdog.test.js` (Defektfall, Rückversicherung, kein Aufaddieren, kurze Antwort byte-identisch, Deckel greift, kein Text → keine Verlängerung).
- Bestandstest T3: Plan sagte, er müsse angepasst werden (Spec-Annahme) — Prüfung ergab, das trifft nicht zu (T3 armiert ohne Sprechtext, bleibt unverändert grün).

**Erwartetes Ergebnis:** `npm test` grün, 4138 (Bestand) + 6 neue = 4144, keine neue Env-Var/Dependency/Route.

---

## Impl-Zusammenfassung

- **headCommit:** `75c072054c899f72163ac0b71bfdf15aaf536dc7`
- `node --check` grün auf allen geänderten src-Dateien; `npm test`: 4144 pass, 0 fail (Bestand 4138 + 6 neue T12–T17).
- Umsetzung exakt gemäß Plan (Entwurf B). `noteAgentSpeech` hinterlegt geschätztes Sprechende als absoluten Zeitstempel; `extendForSpeech` vertagt einmalig; Kalibrierungstabelle auf eine Quelle entduplifiziert; neuer Deckel `SPEECH_EXTENSION_MAX_MS=90s`.
- `src/telnyx-llm-shim.js` ruft `noteAgentSpeech` nach jedem Turn auf; `farewellChars` → `spokenChars` umbenannt.
- `PLAN-SECURITY.md` um den geforderten Abweichungspunkt ergänzt.
- Sechs neue Tests T12–T17; Rot-Beleg für T12 manuell verifiziert (Aufruf entfernt → rot, restauriert → grün) und nicht committet.
- Bestandstests E4/T5b/T3/K0/Farewell liefen unverändert grün (fokussierter Lauf 37/37).
- Committed auf `phase/dead-air-speech-impl` (75c0720), working tree danach clean.

### Deviations

- **Smoke-Test nicht erfolgreich:** lokaler Server verweigert Boot in frischem leerem `DATA_DIR` mit "Keine aktive Nummer im Store" (Boot-Guard, unabhängig von dieser Phase — braucht `npm run bootstrap-tenant` zum Seeden). `smokePass=false`, kein Blocker (kein Zusammenhang mit den geänderten Dateien, `/voice`-Route selbst nicht erreicht).

---

## Safety-Urteil (final)

**approved: true** — alle Einzelkriterien (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended) erfüllt.

**Unabhängiger Testlauf:** frischer Worktree, `master` bestätigt als Vorfahr (`git merge-base --is-ancestor`). 3 Commits (75c0720, 679dc5c, 2f4da1d), 8 Dateien, +519/-24. `npm test` zweimal unabhängig: 4147/4147/0 (Bestand 4138 + 9 = T12–T20, inkl. zweier Fix-Runden), kein Flake. Zweites Backend (pg/pglite) separat: 145/145 grün. Isolierter Regressionslauf der phasennahen Dateien: 49/49 grün. `node --check` grün.

**SAFETY-GATES:** unberührt — Diff berührt nur Watchdog, Shim, neue `log-line.js`-Hilfsdatei, `PLAN-SECURITY.md`, vier Testdateien. `git diff master HEAD` auf `claude.js`/`bridge.js`/`telephony`/`config.js`/`route-policy.js`/`server.js` ist leer. Dead-Air-Watchdog ist Kosten-Notaus, kein gelistetes Absolut-Gate; wird nicht entfernt, nicht per Default umgangen — nur einmalig vertagt, hart gedeckelt (`SPEECH_EXTENSION_MAX_MS=90_000`, keine Env-Var). Nicht-Kumulativität rechnerisch nachgewiesen (nicht nur getestet): `extendedMs = min(remaining + deadAirMs, 90_000)`, `noteAgentSpeech` klammert `spokenMs` bereits auf 90_000 → `remaining` beim Feuern strikt < 90_000 → zweites Feuern terminiert garantiert.

**Runde-1-Blocker (echt behoben):** `extendForSpeech` klammerte `extendedMs` ursprünglich nicht — Turn-Latenz zwischen `observeTurn` und `noteAgentSpeech` hätte den Deckel überschreiten können (Test T18 fällt ohne Fix auf 90500 statt 90000).

**Runde-2-Blocker (echt behoben):** `noteAgentSpeech` nutzte `states.get()` statt `ensureState()` und legte nach `clear()` keinen State mehr an → Zustands-Leck (T19) und geerbte Verlängerung bei `callId`-Wiederverwendung (T20).

**OFFENLEGUNG/AUTH/SECRETS/SCOPE:** `claude.js`/`bridge.js` byte-unverändert; disclosureSentence unangetastet. Kein neuer Endpunkt/keine neue Route. Keine neue Dependency. Logzeilen PII-frei (nur callId, turnSeq, Millisekunden). Einzige Scope-Grenzüberschreitung: 7-Zeilen-Datei `src/utils/log-line.js` (G5-Dedup, verhaltensidentisch, als Concern vermerkt, nicht als Blocker).

**Concerns (nicht blockierend):**
- Doku-Drift: Kommentar an `watchdog.js:62` nannte noch `FAREWELL_FALLBACK_CALIBRATION` statt `SPEECH_FALLBACK_CALIBRATION`.
- `PLAN-SECURITY.md`-Formulierung "höchstens 90 s je Call" ist für Dauer-Reconnect-Fälle zu stark (Deckel gilt pro Dead-Air-Feuern, nicht strikt pro Call) — Nachschärfung empfohlen.
- `now = Date.now` ist Wanduhr, kein monotoner Zähler — theoretisches NTP-Rücksprung-Risiko, von bestehenden Backstops (Max-Dauer-Cap, Kostendecke, `time_limit_secs`) aufgefangen.
- Degradierter Fehlerpfad (catch, ohne `giveUp`) ruft `noteAgentSpeech` nicht auf — Texte dort kurz, Effekt vernachlässigbar, aber Regel nicht ausnahmslos.
- Spec-Prämisse zu Bestandstest T3 war falsch (T3 musste nicht angepasst werden) — im Report festzuhalten statt zu verschweigen.

**Verdict:** FREIGABE (Safety-Seite).

---

## Clean-Code-Audit (final)

**blocker: true — Gesamt-Verdict FAIL wegen S1.**

### S1 (Blocker)

**DAS-1 (Korrektheit, G2-Verstoß):** `src/telnyx-conversation-watchdog.js:194-197` (`restartDeadAirTimer`), `268-284` (`observeTurn`), `256-263` (`extendForSpeech`). `s.speechExtendedMs` wird ausschließlich in `extendForSpeech` gesetzt und **nirgends zurückgesetzt** — weder in `restartDeadAirTimer` noch in `observeTurn`/`arm`, obwohl der Kommentar explizit sagt "0 = es gab keine [Vertagung]".

Konkretes Fehlszenario: Turn 1 löst `extendForSpeech` aus (`speechExtendedMs=65500`). Anrufer meldet sich mit neuem Turn, bevor der verlängerte Timer feuert → Timer wird normal ersetzt, `speechExtendedMs` bleibt bei 65500. Turn 2 ist kurz, keine neue Verlängerung nötig. Feuert der Dead-Air-Timer später wirklich (Leitung tot, ohne aktive Vertagung für dieses Feuern), trägt das `dead_air`-Log trotzdem `speechExtendedMs:65500` — eine Vertagung, die für DIESE Terminierung nie stattfand. Genau das Feld, das laut Spec/Kommentar zur Forensik dienen soll (gleicher Anlass wie der Vorfall vom 10.08., der die `hangup_cause`-Nachbesserung motivierte), lügt damit im Diagnosefall.

Terminierungslogik/Sicherheits-Notaus selbst ist **nicht** betroffen (`remainingSpeechMs` wird bei jedem Feuern frisch aus `speechEndsAtMs` berechnet) — reiner Diagnose-Log-Defekt, kein Kosten-/Safety-Bug.

**Empfohlener Fix:** `speechExtendedMs` bei jedem echten Lebenszeichen zurücksetzen (z.B. in `restartDeadAirTimer()` direkt nach `clearNamedTimer`), plus Regressionstest für "Verlängerung → normaler Turn → späteres echtes dead_air" (fehlte in T12–T20).

### S2
Keine Funde.

### S3
- G5/Test-Duplikation (klein, bewusst kommentiert): `SPEECH_EXTENSION_MAX_MS_EXPECTED` (90_000) und `LONG_SPEECH_MS` (65_500) in `test/telnyx-stab-p9-watchdog.test.js` dupliziert statt importiert — Konstante nicht exportiert, Kommentar begründet es. Legitimes Black-Box-Testmuster, kein echter Fund.

### S4
Keine Funde — Anzahl/Struktur der neuen Funktionen (`calibrationFor`, `estimatedSpeechMs`, `extendForSpeech`, `noteAgentSpeech`, `formatLogLine`) knapp, jede mit klarem Einzelzweck.

**passNotes:** Diff zeigt sichtbare Selbstkorrektur über zwei Review-Runden (Turn-Latenz-Deckelbug, `ensureState`-vs-`states.get`-Leak — beide bereits gefixt und mit T18–T20 getestet). Deterministische Zeitsteuerung (injizierbares `now`, `fakeClock`), Magic Numbers sauber benannt und hergeleitet, G5-Duplikation zwischen Shim und Watchdog in `utils/log-line.js` aufgelöst, alle Watchdog-Test-Doubles konsistent ergänzt, Safety-Gates unangetastet.

---

## Fix-Runden

**r1:** Beide Review-Blocker behoben, minimal, mit Regressionstest. S1 (Korrektheit/Sicherheit): `extendForSpeech()` klammerte `extendedMs` (= `remainingSpeechMs + deadAirMs`) nicht — bei Turn-Latenz zwischen Dead-Air-Armierung (`observeTurn`) und `noteAgentSpeech` konnte der Deckel `SPEECH_EXTENSION_MAX_MS` überschritten werden. Gefixt via `Math.min`.

**r2:** Beide Review-Blocker (Wächter-Zustand-Leck + davon abhängige unverdiente Sprech-Verlängerung) behoben in `src/telnyx-conversation-watchdog.js`: `noteAgentSpeech()` nutzt jetzt `states.get(callId)` statt `ensureState(callId)` und kehrt früh zurück, wenn kein State existiert (bereits terminal geräumt) — verhindert Zustands-Leck und geerbte Verlängerung bei `callId`-Wiederverwendung.

**Nach r1+r2:** Safety- und CleanCode-Reviews liefen final erneut — Safety FREIGABE, CleanCode **FAIL** wegen des oben beschriebenen S1-Fundes (`speechExtendedMs` wird nie zurückgesetzt, stale Diagnosewert im `dead_air`-Log). Dieser Fund ist über r1/r2 hinaus **nicht** behoben worden — daher Gate=BLOCKED trotz Safety-Freigabe.
