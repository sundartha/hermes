# Phase G4 — Reprompt-Verschlankung (Tempo-Politur)

**Gate: PASS**
**finalBranch: `phase/g4-reprompt-cleanup`**
**headCommit: `275967cf28a8ea49ac2ff0a52d0cfbba9700e4ae`**
**Tests: 734/734 (Baseline 733 + 1 neuer), 0 fail**

## Scope

G4 = Tempo-Politur am No-Speech-Reprompt im `/voice/turn`-Pfad. Der Reprompt wird auf eine knappe Rueckfrage gekuerzt, um TTS-Sekunden im Wiederholpfad zu sparen.

**Bewusst NICHT angefasst (explizite Auftrags-Einschraenkung):**
- `[turn-recv]` / `[turn-ok]`-Diagnose-Logs bleiben — die G2/G3-Live-Gates sind noch nicht gruen (geparkt), die Logs bleiben als Diskriminator.
- `redirectD` bleibt im Direktiven-Array (kein Offline-Beleg, separates Live-Gate).
- Der Log-Cleanup-Teil aus PLAN-CONVERSATION-QUALITY.md §3 G4 ist damit **nicht** Teil dieser Phase. Realer Blast-Radius: eine inline-String-Zeile in `src/server.js`.

## Plan (gekuerzt)

Verifizierter Ausgangsbefund (master):
- Der No-Speech-Reprompt steht **inline** in `server.js`, exakt einmal — im `/voice/turn`-Handler, No-Speech-Zweig (`!heard && call.transcript.some(t => t.role === "caller")`):
  `followupTurnDirectives(call, "Entschuldigung, ich habe Sie nicht verstanden. Koennen Sie das wiederholen?")`.
- Die anderen gesprochenen Turn-Texte sind bereits benannte Modul-Konstanten (`LLM_DEGRADED_SPEECH`, `TURN_ERROR_SPEECH`, G25). Der Reprompt war die einzige verbliebene Inline-Ausnahme.
- Kein Test pinnt den alten Wortlaut; der No-Speech-Zweig hatte bislang keinen dedizierten Test.

**Design-Entscheidung:** Den verschlankten Reprompt als benannte Modul-Konstante `NO_SPEECH_REPROMPT_SPEECH` einfuehren — exakt parallel zu `LLM_DEGRADED_SPEECH`/`TURN_ERROR_SPEECH` (G11 Konsistenz, G25 keine Magic-Strings, G10 Deklaration nahe Verwendung). Kein Flag, kein config-Var: der Text ist nicht owner-tunebar (anders als G3s `STT_SPEECH_TIMEOUT_SEC`), gehoert also als Konstante in `server.js`, nicht in `config.js` (G35 gilt nur fuer konfigurierbare Daten).

**Wortlaut:** Zwei Saetze -> eine knappe Rueckfrage. Von `"Entschuldigung, ich habe Sie nicht verstanden. Koennen Sie das wiederholen?"` auf `"Entschuldigung, koennen Sie das bitte wiederholen?"`. Die fuehrende "ich habe Sie nicht verstanden"-Floskel faellt; bleibt hoeflich und eindeutig.

**Edits (`src/server.js`):**
- Edit A: Konstante `NO_SPEECH_REPROMPT_SPEECH` im bestehenden Konstanten-Block nach `TURN_ERROR_SPEECH` deklarieren (mit deutschem Kommentar ohne Umlaute, der die G4/Kosten-Begruendung nennt).
- Edit B: No-Speech-Zweig auf die Konstante umstellen (`followupTurnDirectives(call, NO_SPEECH_REPROMPT_SPEECH)`).

Verhaltens-Diff = nur der gesprochene Text (kuerzer); Direktiven-Struktur (`Gather`+`Redirect`, festes `speechTimeout`, kein `Hangup`) byte-identisch.

**Test:** Neue Datei `test/g4-no-speech-reprompt.test.js` (Offline-Spawn ueber `test/helpers.js`). POST `/voice/turn` mit leerem `SpeechResult` gegen einen aktiven Telnyx-Call, dessen Transcript bereits eine `caller`-Zeile traegt -> erwartet 200, knapper Reprompt im `<Say>`, `<Gather>` vorhanden, **kein** `<Hangup>`.

**Pre-Mortem:**
- Reprompt zu knapp/unverstaendlich -> Mitigation: bleibt vollstaendige hoefliche Frage, Final-Tuning ist geparktes Live-Gate.
- Versehentlich Logs/redirectD/Hangup mitgeaendert -> Mitigation: reiner String-Tausch, Negativ-Greps + Test `doesNotMatch(/<Hangup/)`.
- Konstante faelschlich in config.js (BDUF-Seam) -> bewusst verworfen, Text nicht owner-konfigurierbar.

## Impl-Zusammenfassung

- `src/server.js`: Reprompt vom Zwei-Satz-Text auf `"Entschuldigung, koennen Sie das bitte wiederholen?"` gekuerzt und als benannte Konstante `NO_SPEECH_REPROMPT_SPEECH` eingefuehrt (neben `LLM_DEGRADED_SPEECH`/`TURN_ERROR_SPEECH`). Diff +6/-1.
- Neu: `test/g4-no-speech-reprompt.test.js` (Offline-Spawn-Smoke: Say + Gather, kein Hangup).
- `node --check src/server.js` gruen; `npm test` 734/734.
- Verifiziert unberuehrt: `[turn-recv]`/`[turn-ok]` (6 Treffer unveraendert), `redirectD` (2 Treffer unveraendert), alter Wortlaut ("ich habe Sie nicht verstanden") 0 Treffer.
- `node_modules`-Symlink nicht committet. Committed `275967c`.

**Deviations:** keine.

## Safety-Urteil

**APPROVED.** G4 ist minimal und exakt im Scope: der No-Speech-Reprompt wird in die benannte Konstante ausgelagert und auf eine knappe Rueckfrage verkuerzt (reine UX/Tempo-Politur, kein Safety-Gate). Diff = nur `src/server.js` (+6/-1) + 1 neue Testdatei.

- `testsPassIndependently: true` — json-Backend (Standard `npm test`): 734/734 pass, 0 fail, 6 suites, ~29s, selbst ausgefuehrt. Die pglite-getriebenen pg-Pfade laufen als eigene `*-pg.test.js` im Standardlauf und sind gruen.
- `safetyGatesIntact / disclosureIntact / authFailClosedIntact / noSecretsLeaked / scopeRespected / behaviorAsIntended: true`.
- Verifiziert unberuehrt: `disclosureSentence` (claude.js+bridge.js diff leer), `numberGateError`/Allowlist/Denylist/Land/Budget/Max-Dauer/Signaturpruefung, `/voice/outbound` LLM-frei, de-DE, `safeEqual`/Auth. Keine neue npm-Dependency (package.json/-lock unveraendert).
- Der No-Speech-Zweig bleibt ein gueltiger Folge-Turn (Say + Gather, KEIN Hangup) — Test deckt genau das ab.

**Blocker:** keine.

**Concern (kein Blocker):** pg-Backend liess sich im Worktree nicht gegen eine echte DB testen (keine Verbindung; `STORE_BACKEND=pg npm test` schlaegt rein umgebungsbedingt fehl — Env-Override zwingt json-Spawn-Tests gegen ein unerreichbares Postgres, kein Code-Regress). Die pg-Code-Pfade sind durch die pglite `*-pg.test.js` im json-Standardlauf abgedeckt und gruen; der Diff beruehrt keinen Store-Code.

## Clean-Code-Audit

**Verdict: PASS** (kein S1/S2/S3/S4-FLAG, `blocker: false`).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine. Keine Duplizierung — der String wurde in eine benannte Konstante zentralisiert; das scheinbare zweite No-Speech-Literal existiert NUR auf master, NICHT auf dem Branch (per `git show` falsifiziert).
- **S3:**
  - G16/G25 (PASS, kein FLAG) — Reprompt korrekt aus Inline-Literal in benannte Konstante `NO_SPEECH_REPROMPT_SPEECH` gehoben, analog `LLM_DEGRADED_SPEECH`/`TURN_ERROR_SPEECH`.
  - G10/G35 (PASS) — Konstante bei den anderen gesprochenen Texten und nahe ihrer einzigen Verwendung deklariert; auf Modul-Top-Level, nicht in der Low-Level-Funktion vergraben.
  - Kein-Befund-Hinweis: zweiter No-Speech-String nur auf master, Branch nutzt durchgaengig die eine Konstante via `followupTurnDirectives` — keine S2-Duplizierung.
- **S4:**
  - F1/F4/G30 (PASS) — keine neue Funktion, keine Argument-Aufblaehung, kein toter Code; reine Konstanten-Extraktion + String-Tausch.
  - G24/Konventionen (PASS) — Kommentar deutsch ohne Umlaute, ESM-Stil, benennt die G4/Kosten-Begruendung. Test folgt dem etablierten Spawn-Harness-Muster (startServer/seedState/seedCall), analog g3-speech-timeout.

**passNotes:** Minimaler, sauberer Diff (6 Zeilen src + 36 Zeilen Test). P1 (T-Regel) erfuellt — neues Verhalten durch offline Spawn-Test abgedeckt, der gegen die echte Branch-Version gruen laeuft. P2 (Duplizierung) keine. Naming-Parity, deutsche Kommentare ohne Umlaute und dokumentierter G4/Kosten-Grund vorbildlich. Test prueft genau ein Konzept (P14), drei klare Build-Operate-Check-Schritte (P13), inkl. Negativ-Assertion (kein Hangup) als Grenzfall (T5).

**topTodos:** Keine. Branch ist merge-fertig.

## Fix-Runden

Keine (0 Fix-Runden). Safety und Clean-Code beide PASS im Erstdurchlauf; keine S1/S2/S3/S4-FLAGs.
