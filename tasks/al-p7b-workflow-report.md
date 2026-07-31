# Phase AL-P7b — Das Denk-Signal (Weg A)

**Gate:** PASS
**finalBranch:** `phase/al-p7b-denk-signal-fix1`
**Basis:** `master` @ `ee6a868`
**Flag:** `THINKING_SIGNAL_ENABLED`, Default **aus**

---

## 1. Ziel der Phase

Der Agent soll, waehrend er auf ein Werkzeugergebnis wartet (z.B. eine Suche), einen kurzen,
zum Gespraech passenden Ueberbrueckungssatz sprechen — statt den Anrufer auf eine tote Leitung
warten zu lassen. Gewaehlt: **Weg A** — der Ueberbrueckungssatz ist der **fuehrende Text des
Modells im selben Antwort-Block** wie der Werkzeugaufruf (kein zusaetzlicher Modell-Roundtrip,
kein eigener Sprechkanal, kein Locale-Fuellsatz-Katalog).

---

## 2. Plan (gekuerzt)

### 2.1 Ausgangsbefund (gemessen)

- `streamSinkFor` armiert den Satz-Chunker nur, wenn die Runde ausschliesslich
  Seiteneffekt-Werkzeuge enthaelt — genau die Runden mit Wartezeit (informationsliefernde
  Werkzeuge) streamen heute **nichts**.
- Der Shim leitete „schon gesprochen" bisher aus der **Chunk-ZAHL** ab
  (`chunkCount() > 0`) — dieses Kriterium bricht, sobald ein Ueberbrueckungssatz existiert:
  ein Chunk waere dann die Bruecke, die Antwort steht noch aus → `respond("")` →
  **die Antwort geht lautlos verloren**. Erster Pflicht-Fix der Phase.
- `endCall`/`suppressedEndCall` wurden bisher erst **im** tool_result-Mapping gesetzt, also
  nach `execTool` — fuer eine Bruecke **vor** der Werkzeugausfuehrung muss diese Entscheidung
  vorgezogen werden.

### 2.2 Design-Entscheidungen

- **E1** — Die Bruecke geht **nicht** ueber den Token-Chunker, sondern aus `resp.content` der
  fertigen Runde, **nach** der Runde aber **vor** `execTool`. Begruendung: bei
  `toolUseStarted()` ist das Werkzeug noch unbekannt (z.B. `get_consult` wuerde sonst doppelt
  ueberbrueckt); der Sicherheitsriegel in `streamSinkFor` bleibt unangetastet;
  `speech-chunker.js`/`llm.js` bleiben unveraendert (Bestandstests bleiben gruen).
- **E2** — „Bruecke wird immer zu Ende gesprochen" ist strukturell erfuellt: Bruecke und
  Antwort sind zwei Deltas **desselben** SSE-Stroms in dieser Reihenfolge — kein zweiter
  Sprechkanal kann die Bruecke unterbrechen. Weg B (mit `speak.ended`-Warteschlange) entfaellt
  vollstaendig.
- **E3 (bewusste Abweichung vom Plan-Wortlaut)** — Statt eines Zeit-Schwellwerts
  („~1,3 s") wird die Schwelle **strukturell**: die Bruecke feuert genau dann, wenn der
  Tool-Loop nach dieser Runde weiterlaeuft (mindestens zwei Roundtrips), hoechstens einmal pro
  Turn. Ein Timer waere gegen `finish()` des SSE-Stroms geraced und ohne Fake-Timer nicht
  deterministisch testbar.
- **E4** — `speechStreamed` (neues Feld an der Turn-Rueckgabe) ersetzt die Chunk-Zahl-Inferenz
  im Shim als Pflicht-Fix.
- **E5 (bewusste Nicht-Umsetzung)** — Kein In-Flight-Riegel gegen „Nachhaken in die eigene
  Wartezeit" (Telnyx' `USER_IDLE_REPLY_SECS`): unvermessen, ob Telnyx waehrend eines offenen
  Zuges einen zweiten Request stellt. Stattdessen Messpunkt in
  `tasks/al-testcall-checklist.md` — erst messen, dann ggf. eigene Mini-Phase.
- Bench-Check „keine Suchankuendigung" nur als Prompt-Verbot + Fixture-Test, kein
  deterministischer Bench-Check (i18n-Katalog-Flaeche ausserhalb Scope).
- `src/i18n/locales.js` bleibt unangetastet — auf Weg A ist der Locale-Fuellsatz-Katalog nicht
  die Quelle.

### 2.3 Pre-Mortem (Auszug)

| Szenario | Riegel |
|---|---|
| Antwort verschwindet (Chunk-Zahl-Falle) | E4, fail-safe `=== true` |
| Doppelrede | `speechStreamed=true` bei Brueckenausgabe |
| Doppel-Ueberbrueckung bei `get_consult` | Bruecke nur bei `loopContinues`, Consult bricht vorher ab |
| Dauergeplapper | Einmal-pro-Turn-Riegel + nur bei weiterlaufendem Loop |
| Suchankuendigung | Prompt-Verbot, 3 Sprachen, Fixture-Test |
| Kosten laufen weg | kein zusaetzlicher Modell-Roundtrip, Budget-Gates unberuehrt |
| Prompt-Regression bei Flag aus | `filter(Boolean)`-Muster, byte-identisch gepinnt |
| Schalter unbemerkt scharf | Boot-Banner-Zeile |

### 2.4 Umfang

Neue Datei `src/thinking-signal.js` (reine Funktion, kein IO). Edits an `src/config.js`,
`src/claude.js` (Import, Prompt-Sektion, Turn-Zustand, drei `speech`-Zuweisungen,
Schleifenausstieg mit vorgezogener end_call-Entscheidung, Rueckgabe), `src/telnyx-llm-shim.js`
(Doppelrede-Entscheidung, Turn-Diagnose-Log), `src/boot.js` (Banner), Prompt-Bundles
de/en/fr, `.env.example`, `render.yaml`, `test/helpers.js`. 4 neue Testdateien
(`al-p7b-thinking-signal`, `al-p7b-prompt`, `al-p7b-turn-bridge`, `al-p7b-shim-bridge`,
19 Tests AL-P7b-1..19) + notwendige Anpassungen an `test/config-namespaces.test.js` und
`test/al-p7-shim-stream-wire.test.js`.

Bewusst **nicht** angefasst: `PLAN-SECURITY.md`, `README.md` (keine Route/Secret/Gate-
Aenderung), `speech-chunker.js`, `llm.js`, `streamSinkFor`, `src/i18n/locales.js`.

---

## 3. Impl-Zusammenfassung

Umgesetzt exakt gemaess Plan:

- `src/thinking-signal.js` (neu) — `bridgeSpeechFrom(roundText)` (shape + Wortgrenzen-Kappung
  bei `THINKING_SIGNAL_MAX_CHARS=120`) und `makeThinkingSignal({ onSpeechChunk, enabled })` mit
  Einmal-pro-Turn-Latch (`speakBridge`, `spoken()`).
- `src/claude.js` — Prompt-Sektion `thinkingSignalRules(p)` hinter `boundaryRules`; Turn-Zustand
  `speechStreamed` + `thinkingSignal`-Instanz vor der Schleife; die end_call-Entscheidung wurde
  aus dem tool_result-Mapping **vor** `execTool` gezogen (`loopContinues` als benannter
  Ausdruck), dort wird die Bruecke gesprochen; additive Rueckgabefelder `speechStreamed`,
  `thinkingSignalSpoken`.
- `src/telnyx-llm-shim.js` — Doppelrede-Entscheidung liest jetzt `turn.speechStreamed === true`
  statt `chunkCount() > 0` (fail-safe Richtung: fehlendes Feld ⇒ Text wird gesprochen); neue
  Boolean-Spalte `thinkingSignal` im `turn_ok`-Log.
- `src/boot.js` — `thinkingSignalBannerLine`, analog zu `tokenStreamingBannerLine`.
- Prompt-Block `thinkingSignal` in `de.js`/`en.js`/`fr.js` (Verbot, den Nachschau-/Recherche-
  Vorgang oder eine Quelle zu nennen).
- `THINKING_SIGNAL_ENABLED` zentral in `config.js` (Namespace `voice`, Default `false`),
  `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV.

**Testergebnis (Impl-Agent):** 3688/3688 gruen (Basis 3649 + 19 neue).
**HEAD:** `730927b`.

### Deviations

1. **E3** (im Plan als bewusste Abweichung deklariert): Schwelle strukturell statt zeitlich —
   in `tasks/assistant-leap-chain.md` nachgetragen.
2. **E5** (im Plan als Nicht-Umsetzung deklariert): kein Idle-Nachhak-Riegel — Messpunkt statt
   Code, in `tasks/al-testcall-checklist.md`.
3. `tasks/al-chain-state.md` **nicht** angefasst — laut Plan explizit Lead-Aufgabe „nach dem
   Merge", dieser Worktree hat noch nicht gemergt.
4. Testfixtures fuer `al-p7b-turn-bridge.test.js` nutzen `armConsult()`, um `streamSinkFor`
   fuer die betroffene Runde gezielt auf `null` zu setzen — noetig, damit Bruecke und
   Bestands-Chunker-Streaming isoliert beobachtbar sind (nicht Zeile-fuer-Zeile im Plan
   vorgeschrieben, aber notwendig).
5. `test/al-p7-shim-stream-wire.test.js`: der `agentTurn`-Double musste so korrigiert werden,
   dass `speechStreamed` nur `true` ist, wenn tatsaechlich ein `onSpeechChunk`-Abnehmer
   durchgereicht wurde (spiegelt echtes Verhalten) — ohne diese Korrektur haette der Flag-AUS-
   Test faelschlich `respond('')` statt der vollen Antwort ausgeloest. Keine Assertion
   abgeschwaecht, nur der Double korrigiert.

---

## 4. Safety-Urteil (final, unabhaengiger Review-Lauf)

**Verdict: PASS (approved, 5 Concerns, 0 Blocker)**

Eigenstaendig gefahren im frischen Worktree auf `review-al-p7b-r1` (= finaler Branch, Basis
`ee6a868` == master HEAD, kein stale base).

- **Regression** (`npm test`): exit 0, korrigiert 3671/3671, 0 fail, 103,0 s.
- **Gates** (`npm run test:gates`): exit 0, korrigiert 126/129, 3 rote sind bekannter,
  phasenfremder Bestand (GAP-05, GAP-15×2 — deckt sich mit dokumentierter Baseline).
- `node --check` gruen fuer alle geaenderten Kern-Dateien; kein package.json/-lock-Diff ⇒
  keine neue Dependency.

**Gate-Bestaetigungen:** SAFETY-GATES intakt (kein Gate-File im Diff, keine neue
Route/Auslöser), OFFENLEGUNG intakt (`disclosureSentence` nicht im Diff, Prompt-Block sitzt
strukturell dahinter), AUTH FAIL-CLOSED intakt, keine Secrets geleakt (nur Boolean geloggt),
SCOPE sauber (20 Dateien, keine neue Dependency), Verhalten wie spezifiziert (Flag-aus
byte-identisch rekonstruktiv geprueft, Einmal-Riegel gepinnt, Doppelsprech-Exklusivitaet
gegen `sideEffectOnlyRound` selbst nachgerechnet, fail-safe-Richtung `=== true` belegt).

**Concerns (kein Blocker):**

1. Prompt-Regel verbietet dem Agenten, einen Nachschau-/Recherche-Vorgang oder eine Quelle zu
   nennen — bei direkter Nachfrage des Anrufers driftet das Richtung Falschaussage. Bewusste
   Owner-Entscheidung (O8), hinter Default-AUS-Flag, `disclosureSentence` selbst unberuehrt —
   ausdruecklich dem Owner vor Flip vorzulegen.
2. Kappungsfall (nur bei Flag AN): liefert eine Runde > 120 Zeichen fuehrenden Text und keine
   Folge-Runde mehr Text, hoert der Anrufer nur die gekappte Fassung. Bewusst so entschieden
   (Transkript == Leitung), mit AL-P7b-20 gepinnt.
3. Transkript-Luecke: der real gesprochene Brueckensatz landet nicht in
   `store.addTranscript`, DSGVO-Export oder Summary — Vollstaendigkeits-, kein
   Sicherheitsdefekt.
4. E5-Restunsicherheit bleibt bis zur Testanruf-Messung offen.
5. Kosmetik: Test-IDs AL-P7b-15/16 sind in zwei Dateien doppelt vergeben (kein Lauf-Effekt).

**Merge-Empfehlung:** mergebar; Flag bleibt Default `false`, Flip erst nach Testanruf-
Checkliste (inkl. E5-Messung) im Render-Dashboard.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS — keine Blocker (S1/S2 leer)**

- **S1 (Blocker):** keine.
- **S2:** keine.
- **S3:** keine.
- **S4:** keine.

**Notizen:** G31 (verborgene zeitliche Kopplung) aktiv adressiert — end_call-Entscheidung
bewusst vor das tool_result-Mapping gezogen, als ein benannter Ausdruck `loopContinues`
(G5/G19) gebuendelt, wortlautgleich zum Vorgaenger. Der in der ersten Fix-Runde behobene
Korrektheitsbug (Kappungsfall, s.u.) ist jetzt durch Test AL-P7b-20 explizit gepinnt. Neuer
Seam `thinking-signal.js` ist reine Funktion/Closure ohne IO, vollstaendige Grenzfall-
Abdeckung. Fail-safe-Default im Shim korrekt begruendet. Alle Flags Default AUS, Prompt bei
ausgeschaltetem Flag byte-identisch. Nachziehpflichten (Banner, `.env.example`, `render.yaml`,
Namespace-Zaehltest, BASE_ENV) vollstaendig erfuellt.

**topTodos:**
1. Kein Blocker offen — Owner-Abnahme laut Checkliste bleibt vor Flag-Flip in Render faellig
   (Prozess, kein Code-Befund).
2. Prompt-Regel (Nachschau-/Quellen-Verbot) dem Owner ggf. explizit zur Bestaetigung vorlegen.

---

## 6. Fix-Runden

**Runde 1 (r1):** ein S1-Blocker behoben — `claude.js:876` / `thinking-signal.js`.
`speakBridge()` lieferte zuvor ein reines Boolean; ein `true`-Ergebnis markierte
`speechStreamed = true` fuer den **vollen** Rundentext, obwohl auf der Leitung nur
`bridgeSpeechFrom(...)` (auf `THINKING_SIGNAL_MAX_CHARS = 120` Zeichen gekappt) stand — bei
Kappung wich `turn.speech` damit vom tatsaechlich Gesprochenen ab. Fix zieht `turn.speech` auf
den tatsaechlich gesprochenen (ggf. gekappten) Text; mit eigenem 167-Zeichen-Fixture-Test
(AL-P7b-20) gepinnt, statt das vorhandene 34-Zeichen-Bestandsfixture wiederzuverwenden.

Nach diesem Fix: finaler Branch `phase/al-p7b-denk-signal-fix1`, Safety- und Clean-Code-Review
beide PASS, wie oben dokumentiert.
