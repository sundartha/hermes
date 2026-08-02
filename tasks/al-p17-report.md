# Workflow-Prozessbericht — Phase AL-P17

**Titel:** Die erste Modellrunde hörbar machen (Befund D-1)
**Gate:** PASS
**finalBranch:** `phase/al-p17-streaming-armierung`
**headCommit:** `ac91bbe21e5723cf992863850928039faf9eb66c`

---

## 1. Plan (gekürzt)

Basis `master` @ `1941471`. Gelesen: `tasks/al-p17-spec.md` (autoritativ), `tasks/al-d2-diagnose.md` §1/§3/§5, `tasks/al-p7b-workflow-report.md` §2.2 (E3), `.claude/refs/clean-code.md`, dazu `src/claude.js`, `src/thinking-signal.js`, `src/speech-chunker.js`, `src/llm.js`, `src/consult/in-call.js`, `src/telnyx-llm-shim.js`, `src/turn-budget.js`, `src/routes/voice.js`, `src/bridge.js`.

**Zuschnitt-Befund:** `get_consult` muss in die Allowlist, sonst ist der Kernbeweis (§5.1 der Spec) unerreichbar — der Live-Werkzeugsatz enthält `look_up` UND `get_consult`. Das ist nur zulässig, weil **E3 die Vorbedingung für E1s Aufnahme von `get_consult` ist**: E3 entfernt genau die Eigenschaft, die `get_consult` bis dahin "textersetzend" machte (`speech = consult.speech`).

**Drei Änderungen + eine Korrektheitsbedingung:**
- **E1** — `STREAM_SAFE_TOOL_NAMES`: Allowlist (nicht Denylist) aller vier heute bekannten Werkzeuge (`end_call`, `take_message`, `look_up`, `get_consult`) in `src/claude.js`, direkt neben `SIDE_EFFECT_ONLY_TOOL_NAMES`. Ein fünftes, unbekanntes Werkzeug schaltet das Streamen fail-closed ab (G27). `streamSinkFor` armiert nur, wenn JEDES angebotene Werkzeug in dieser Menge liegt.
- **E1b (nicht optional)** — Runden-Trennzeichen im Satz-Chunker: `streamSinkFor`/`makeSentenceChunker` bekommen einen neuen Parameter `continuesStream`. Ohne ihn klebt im neuen Zweirunden-Normalfall die zweite Runde ohne Leerzeichen an die erste ("...schaue ich nach.Donnerstag..."). Gelöst an der einen Stelle, an der die Trennzeichen-Regel schon lebt (dieselbe Wurzel wie `BRIDGE_TAIL_SEPARATOR`).
- **E2** — Doppelrede-Riegel: `loopContinues && !speechStreamed && thinkingSignal.speakBridge(speech)`. Verhindert, dass die Denk-Signal-Brücke denselben Text ein zweites Mal auf den Draht schreibt, wenn schon gestreamt wurde.
- **E3 (O-D1-B)** — `if (!speechStreamed) speech = consult.speech;`. Der deterministische Consult-Füller spricht nur noch, wenn dieser Turn noch nichts gesprochen hat — ausdrückliche Abweichung von der AL-P14-Zusage "der Haltesatz ist LLM-frei", als Owner-Entscheidung im Code-Kommentar festgehalten.

**Zwei benannte Zweitfolgen:** (a) das Denk-Signal (AL-P7b) wird im heutigen Werkzeugsatz strukturell stumm, weil E1 fast jede Runde armiert und E2 dann greift; (b) `thinkingSignalSpoken` behält die Lesart "die Brücken-Funktion hat gesprochen" (mechanismus-, nicht turn-bezogen) und wird in Live-Turns dauerhaft `false` — Live-Diskriminator ist `streamArmedRounds`/`streamChunks`.

**Nicht angefasst:** `src/thinking-signal.js`, `src/llm.js`, `src/consult/in-call.js`, `src/telnyx-llm-shim.js`, `src/config.js`, `.env.example`, `render.yaml`, `src/i18n/**`, `src/bridge.js`, `src/routes/voice.js`. Kein neues Flag, keine neue Env-Variable, keine neue Dependency. Rückweg bleibt `TELNYX_SHIM_TOKEN_STREAMING`.

**Caller-Prüfung:** nur der Shim-Pfad (`makeTelnyxLlmShim` → `agentTurn` mit `onSpeechChunk`) ist betroffen. Budget-Engine (`routes/voice.js`, ohne drittes Argument) und Realtime-Bridge (nutzt `agentTurn` nie) sind byte-identisch.

Geplant: 6 neue Tests (`AL-P17-1`…`AL-P17-6`), 11 angepasste Bestandsassertionen über `AL-P7-20`, `AL-D1-2/3`, `AL-D2-1/3/6`, `AL-P7b-8/10/11/12/20`, Mutationsproben M1–M4, Pre-Mortem zum Abriss-Pfad und zu den Safety-Notaus.

---

## 2. Implementierungs-Zusammenfassung

Vollständig gemäß Plan umgesetzt, committet als `ac91bbe`.

**Produktivdateien (2):** `src/claude.js`, `src/speech-chunker.js`.

**Neue Testdatei:** `test/al-p17-first-round-audible.test.js` mit `AL-P17-1` (Kernbeweis, mehrere Deltas, erstes = erster fertiger Satz), `AL-P17-2` (E2-Riegel + E1b-Wortgrenze, Egress-Negativbeweis), `AL-P17-3a`/`3b` (E3 beide Richtungen), `AL-P17-4` (E1 fail-closed gegen exportiertes `streamSinkFor`, einzige Stelle, die eine `every→some`-Mutation fängt), `AL-P17-6` (Offenlegung aktiv geprüft: `disclosureSentence` läuft strukturell nie über den Shim-Draht). `AL-P17-5` (Kostenbuchung: 2 Runden → 2 Belege) liegt bewusst in der Bestandsdatei `test/al-p7-turn-streaming.test.js` (dort leben `bookingSnapshot`/`bookingDelta` schon, keine zweite Ledger-Fixture).

**Angepasste Bestandsdateien (5):** `test/al-p7-turn-streaming.test.js`, `test/al-p7b-turn-bridge.test.js`, `test/al-d1-cause-diagnostics.test.js`, `test/al-d2-thinking-signal-diagnostics.test.js`, `test/al-p10b-lookup.test.js`. Jede kippende Assertion einzeln mit "Zusage vorher / Zusage jetzt / warum" begründet, keine gelöscht oder stillschweigend abgeschwächt (mehrere sogar verschärft, z. B. `AL-P7b-12` zählt jetzt jeden Satz per Split genau einmal). Zwei Dateien (`al-p7b-turn-bridge.test.js`, `al-p10b-lookup.test.js`) brauchten zusätzlich einen SSE-Zweig im Anthropic-Mock aus dem geteilten `test/anthropic-sse-fixtures.js` (kein zweiter SSE-Renderer, G5) — reine Infrastruktur, keine Assertion berührt.

**Lieferbestandteil `tasks/al-p17-diagnose.md`** (im Worktree geschrieben und mitcommittet — separater Liefergegenstand, hier nicht wiederholt): Draht-Reihenfolge vorher/nachher je Klasse, Bewertung des Abriss-Pfads, Safety-Notaus-Tabelle, Offenlegungsnachweis, Assertionstabelle, Mutationstabelle, offene Punkte.

### Deviations

1. **Ketten-Nachtrag `tasks/al-chain-state.md`** (O-D1-A/O-D1-B) ist **nicht** im Worktree erfolgt — laut Präzedenz AL-P7b ist das eine Lead-Aufgabe nach dem Merge. Ausdrücklich als offener Punkt ausgewiesen.
2. `AL-P7b-9` und `AL-P7b-13` wurden über die Planvorhersage hinaus angefasst — nur Name/Kommentar, keine Assertion. Grund: Kommentare behaupteten Sachverhalte, die seit E1 nicht mehr stimmen (`armConsult` disarmiert `streamSinkFor` nicht mehr; Sprecher ist jetzt der Chunker statt der Brücke).
3. In `test/al-p7b-turn-bridge.test.js` wurden lokale Fixture-Kopien (`text`/`toolUse`/`reply`/`jsonMessage`/`MOCK_USAGE`) durch Importe aus `test/anthropic-sse-fixtures.js` ersetzt (G5/S2, byte-identische Werte).
4. Das Fixture von `AL-P17-1` weicht bewusst vom Planbeispiel ab (65 statt 54 Zeichen), damit die Halbierung nachweislich mitten im zweiten Satz liegt statt exakt auf der Satzgrenze.
5. Mutationsprobe M1b fiel breiter aus als vorhergesagt (zusätzlich `AL-P17-3a`, `AL-P17-4`, `AL-D2-6` rot) — Ursache erklärt: `look_up` ist in den Consult-Fixtures mitangeboten, ein disarmiertes `look_up` disarmiert die ganze Runde und schiebt E3 in den Füller-Arm.
6. Smoke-Skript brauchte vier Telnyx-Dummy-Pflichtwerte, weil der Boot-Guard bei `TELNYX_AI_ASSISTANT_ENABLED=true` sonst fail-closed verweigert — kein echter Telnyx-Aufruf, nur die Shim-Route wurde angefasst.

### Verifikation (Umsetzer)

- `node --check` auf allen 8 geänderten/neuen `.js`-Dateien grün.
- Roter Zwischenlauf mitgeschnitten (17 rote IDs) als Beleg, dass Bestandstests wirklich gekippt sind, nicht vorauseilend angepasst.
- `npm test`: 3731/3731 grün, 0 rot.
- `npm run test:gates`: unverändert 3 rot (GAP-05, GAP-15 zweimal) — dokumentierte Baseline.
- 6 Mutationsproben (M1, M1b, M1c, M2, M3, M4), jede selektiv rot, jede zurückgenommen; finaler Diff enthält keine Mutation (per `git diff` + gezieltem `grep` verifiziert).
- Smoke am echten Serverprozess (kein echter Anruf, Anthropic zeigt auf lokalen SSE-Mock) mit Vorher/Nachher-Gegenmessung: master = 1 Delta am Ende, dieser Zweig = 2 Deltas, erstes ist der erste fertige Satz.

---

## 3. Safety-Urteil

**Verdict: PASS — freigegeben.**

Unabhängig geprüft in eigenem Worktree/Branch (`review-al-p17`, 1 Commit über `master`). Eigene Läufe: `npm test` zweimal sauber 3731/3731 grün (ein früherer dritter Lauf mit 1 nicht mitgeschnittenem Fehler, in zwei Folgeläufen nicht reproduzierbar — konsistent mit bekanntem Volllast-Flake, aber nicht positiv belegt). `npm run test:gates` exakt Baseline (3 rot). `node --check` grün.

**Eigene Mutationsproben** (nicht nur nachgelesen, selbst gefahren):
- **M-A** (Allowlist-Beweis, erfundenes Werkzeug direkt in `toolDefs()` gehängt statt nur im Einheitstest): `streamArmedRounds` fällt von 1 auf 0, Rückfall auf Brücke + Consult-Füller — fail-closed empirisch belegt.
- **M-B** (`!speechStreamed` aus der Brücken-Zeile entfernt): derselbe Satz stand wörtlich zweimal auf dem Draht; 6 Tests rot — E2-Riegel real getestet.
- **M-C** (E3 zurückgedreht): `AL-P17-3a`/`AL-D2-6`/`AL-P7b-10` rot, `AL-P17-3b` bleibt grün — E3 ist nachweislich richtungsselektiv.

**Bestätigt:** Allowlist statt Denylist, kein Doppelrede-Fall, Offenlegung strukturell unberührt (Shim-Turn beginnt nach `ai_assistant_start`, nur Shim reicht `onSpeechChunk` durch), alle Notaus (Budget-Gate vor Turn, In-Turn-Budget-Abbruch, Loop-Guard, Rate-Gate) bleiben hörbar — `respond`/`wire.finish` schreiben eigenen Text und lesen `speechStreamed` nicht. Kostenbuchung unverändert (ein Beleg je Modellrunde, `completeRound` unberührt). Keine Bestandsassertion stillschweigend abgeschwächt.

**Concerns (kein Blocker, an den Lead weitergegeben):**
- Abriss-Naht ohne Wortgrenze am `wire.finish`-Tail (Vorbestand seit AL-P7, jetzt häufiger) — akzeptiertes Risiko, im Diagnose-Dokument benannt.
- **Vom Bericht nicht benannt, vom Safety-Prüfer nachgetragen:** bei Stream-Abriss propagiert der Fehler, bevor `store.addTranscript` erreicht wird — bereits gesprochene Sätze landen in keinem Transkript/keiner Summary/keinem DSGVO-Export.
- `THINKING_SIGNAL_ENABLED` wird live praktisch wirkungslos (E2 greift fast immer) — Owner-Entscheidung fällig: behalten oder mit D-3 beerdigen.
- `THINKING_SIGNAL_MAX_CHARS`-Kappung (120 Zeichen) wirkt auf dem Streaming-Pfad nicht mehr — dokumentierte, aber echte Lockerung einer UX-Sicherung.
- `turn.speech` trägt bei mehreren gestreamten Runden nur die letzte Runde, der Draht alle (formgleich zum Bestand, aber jetzt Normalfall statt Ausnahme).
- E1b ist strukturell eine vierte Codeänderung neben E1/E2/E3 — als in-scope beurteilt (Korrektheitsbedingung, Default = Bestand, gepinnt).
- `streamSinkFor` ist neu exportiert (API-Oberfläche wächst) — begründet und präzedenzgleich zu `isSideEffectOnlyTool`.

---

## 4. Clean-Code-Audit (S1–S4)

**Verdict: PASS.** Keine S1/S2-Befunde (kein Blocker).

**S1:** keine.
**S2:** keine.

**S3 (2 Hinweise):**
1. `bridgeText`-Ausdruck in `src/claude.js` verkettet `loopContinues && !speechStreamed && thinkingSignal.speakBridge(speech)` roh statt den E2-Riegel als eigenen benannten Ausdruck (`canBridge`) zu ziehen (G28).
2. E3-Riegel (`if (!speechStreamed) speech = consult.speech;`) ist eine reine Inline-Negation ohne eigenen Namen; bei drei parallelen Riegeln wäre eine einheitliche Benennung stärker — rein kosmetisch, Kommentar trägt die Absicht bereits vollständig.

**S4 (Trendbeobachtung, kein Fix nötig):** `agentTurn` wächst mit dieser Phase auf ca. 340 Zeilen (netto ~30 zusätzliche, größtenteils dichte Kommentierung). Kandidat für eine spätere Aufräum-Phase (Consult-/Bridge-/Loop-Continues-Block in eigene Funktion ziehen), kein Blocker.

**Bestätigt geprüft:** `STREAM_SAFE_TOOL_NAMES` steht an genau einer Stelle (kein G5-Duplikat), E1 als benannte Allowlist + Prädikat gekapselt, E3 sauber an einer Stelle, Testfixtures pro Szenario wirklich unterscheidbar, Fail-closed-Pfad direkt gegen exportiertes `streamSinkFor` bewiesen.

---

## 5. Fix-Runden

Keine — die finale Safety- und Clean-Code-Bewertung war bereits im ersten Durchlauf PASS. Die S3-Hinweise und Concerns wurden als optionale Folgearbeit vermerkt, nicht als Blocker zurückgespielt; es gab keinen Fix-Zyklus zwischen Audit und Merge-Freigabe.
