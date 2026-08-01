# AL-P17 — Die erste Modellrunde hoerbar machen (Umsetzung + Abnahme)

**Basis:** `master` @ `1941471`. **Spec:** `tasks/al-p17-spec.md` (autoritativ),
Owner-Entscheidungen O-D1-A / O-D1-B vom 2026-08-01.
**Nicht zu verwechseln mit** `tasks/al-p17-report.md` (Workflow-Prozessbericht).

---

## 0. Antwort in drei Saetzen

**Was jetzt anders klingt:** in der dominanten Live-Turn-Klasse (Text ohne Werkzeug, 18
von 21 Turns) geht der erste FERTIGE Satz auf die Leitung, sobald er fertig ist, statt am
Ende der ganzen Modellrunde — am echten Shim-Draht gemessen: vorher **1** content-Delta am
Ende, nachher **2**, das erste davon der erste Satz.
**Was gleich bleibt:** derselbe Text, dieselbe Reihenfolge, dieselbe Kostenbuchung (genau
ein Beleg je Modellrunde), dieselben Safety-Notaus, dieselbe Offenlegung — und kein Satz
geht doppelt raus (Doppelrede-Riegel E2).
**Was offen bleibt:** K4 (`look_up` OHNE fuehrenden Text ⇒ weiterhin Stille waehrend der
Suche), D-3 (Prompt am Tool-Entscheidungspunkt), die Naht zwischen letztem Chunk und
`wire.finish`-Tail im Abrissfall, und `shapeForSpeech` laeuft weiterhin NACH dem Streamen.

---

## 1. Die Draht-Reihenfolge vorher/nachher

Alle Zahlen sind gemessene `contentPieces`-Arrays (die `delta.content`-Fragmente des
SSE-Stroms in Schreibreihenfolge), nicht Prosa.

### 1.1 Am ECHTEN Server-Prozess (Smoke, identisches Skript, nur `src/claude.js` +
`src/speech-chunker.js` getauscht)

Klasse K1 (Text ohne Werkzeug), Live-Werkzeugsatz (`look_up` + `get_consult` angeboten),
Modelltext `"Guten Tag, hier ist Hermes. Wie kann ich Ihnen heute weiterhelfen?"`:

| Stand | `stream` an Anthropic | content-Deltas auf dem Shim-Draht |
|---|---|---|
| `master` @ `1941471` | **nicht gesetzt** (Bestandspfad) | `["Guten Tag, hier ist Hermes. Wie kann ich Ihnen heute weiterhelfen?"]` — **1**, am Ende |
| dieser Zweig | `true` | `["Guten Tag, hier ist Hermes.", " Wie kann ich Ihnen heute weiterhelfen?"]` — **2**, das erste ist der erste Satz |

### 1.2 Je Klasse, als Test-Assertion (Beleg-ID in Klammern)

| Klasse | vorher (`master`) | nachher | Beleg |
|---|---|---|---|
| K1 — Text ohne Werkzeug, einsaetzig | `[NUR_TEXT]`, `streamArmedRounds 0`, `stream != true` | `[NUR_TEXT]`, `streamArmedRounds 1`, `stream === true` | AL-D2-1 |
| K1 — Text ohne Werkzeug, zweisaetzig | (auf `master` nicht gepinnt; s. 1.1) | `[ERSTER_SATZ, " " + ZWEITER_SATZ]` | AL-P17-1 |
| „Text + `look_up`" | `["Einen Moment, das schaue ich nach. ", "Donnerstag um neun Uhr passt."]` — Sprecher: **Bruecke**, `thinkingSignal true` | `["Einen Moment, das schaue ich nach.", " Donnerstag um neun Uhr passt."]` — Sprecher: **Satz-Chunker**, `thinkingSignal false`, `streamArmedRounds 2` | AL-D2-3, AL-P17-2 |
| „Text + `get_consult`" (angenommen) | `[consultFillerSpeech]` | `["Ich frage kurz nach."]` — der Modellsatz, GENAU EIN Haltesatz | AL-D2-6, AL-P17-3a |
| „`get_consult` OHNE Text" | `[consultFillerSpeech]` | `[consultFillerSpeech]` — **unveraendert** | AL-P17-3b |
| K4 — `look_up` OHNE fuehrenden Text | `[ANTWORT]` (Stille waehrend der Suche) | `[ANTWORT]` — **unveraendert offen** | AL-D2-4 |

**Geerbte Grenze, nicht neu behauptet:** „frueher auf dem Draht" ist nicht dasselbe wie
„frueher von Telnyx gesprochen". Dass Telnyx SSE inkrementell konsumiert, ist die
AL-P2-Messung; diese Phase misst den DRAHT und erbt jene Messung, sie wiederholt sie nicht.

---

## 2. Die Aenderungen am Code

Zwei Produktivdateien, `src/claude.js` und `src/speech-chunker.js`.

### E1 — `streamSinkFor`: die Allowlist der STROM-SICHEREN Werkzeuge

Bedingung 2 lautete: *jedes angebotene Werkzeug ist ein Seiteneffekt-Werkzeug*. Sie sperrte
live in JEDEM Turn, weil `look_up` an keiner Frische-Bedingung haengt und damit immer im
angebotenen Satz liegt (gemessen: AL-D1-2). Neu: *jedes angebotene Werkzeug ist bekannt und
STROM-SICHER* — strom-sicher heisst „kann einen bereits GESPROCHENEN Rundentext nicht mehr
ersetzen".

`STREAM_SAFE_TOOL_NAMES` steht direkt neben `SIDE_EFFECT_ONLY_TOOL_NAMES` (EINE Stelle je
Zugehoerigkeit, G5). `isSideEffectOnlyTool` ist **unveraendert** und behaelt seinen einzigen
Zweck (Schleifenausstieg, `sideEffectOnlyRound`) — die zwei Zugehoerigkeiten werden nicht
vermischt.

**Warum `get_consult` drinsteht, und warum das ohne E3 falsch waere:** die EINZIGE
Eigenschaft, die `get_consult` textersetzend machte, war `speech = consult.speech`. Genau
das unterbleibt seit E3, wenn bereits gestreamt wurde. **E3 ist die Vorbedingung von E1** —
beide gehoeren zusammen oder gar nicht. Ohne `get_consult` in der Liste waere der
Kernbeweis unerreichbar: der Live-Werkzeugsatz enthaelt `look_up` UND `get_consult`, ein
gesperrtes `get_consult` haette die Armierung bei 0 gelassen.

**ALLOWLIST, nicht Denylist.** Eine Regel „sperre bei `get_consult`" faellt bei jedem
kuenftigen Werkzeug fail-open. Hier schaltet ein unbekanntes Werkzeug das Streamen von
selbst ab (G27). `STREAM_SAFE_TOOL_NAMES` wird ausdruecklich **nicht** aus
`toolDefs()`/`agentTools()` abgeleitet — eine abgeleitete Liste waere genau die
fail-open-Regel. Beleg: AL-P17-4 (erfundenes Werkzeug `zeitreise_buchen` ⇒ `null`).

### E1b — das Runden-Trennzeichen (nicht optional, Korrektheitsbedingung von E1)

`streamSinkFor` erzeugt je Runde eine NEUE `makeSentenceChunker`-Instanz; deren `emit`
setzte das Trennzeichen nur ab dem ZWEITEN Chunk **derselben Instanz**. Bis AL-P17 war das
folgenlos, weil armierte Runden praktisch immer den Turn beendeten. Nach E1 ist der
Zweirunden-Fall der Normalfall:

```
"Einen Moment, das schaue ich nach." + "Donnerstag um neun Uhr passt."
 -> "...schaue ich nach.Donnerstag um neun Uhr passt."     <- hoerbarer Aussprachefehler
```

Dieselbe Wurzel und dieselbe Loesung wie `BRIDGE_TAIL_SEPARATOR` in
`src/thinking-signal.js`. Geloest an der EINEN Stelle, an der die Trennzeichen-Regel schon
lebt (G5): `makeSentenceChunker({ onChunk, continuesStream })`, Default `false` =
Bestandsverhalten. Der Turn fuehrt den Zustand `wireHasSpeech` (gesetzt aus
`sink.chunkCount() > 0` — der Chunker gibt kein leeres Fragment aus, die Zahl ist die
ehrliche Auskunft). Die Bruecke setzt das Flag bewusst NICHT: sie liefert ihre Wortgrenze
selbst mit. Belege: AL-P17-2, AL-D2-3, AL-P7b-8/-11/-12.

### E2 — Doppelrede-Riegel

Bis AL-P17 garantierte `sideEffectOnlyRound` die Ausschliesslichkeit von Streaming und
Bruecke: eine armierte Runde war nie eine, die den Loop fortsetzt. **Mit E1 faellt diese
Garantie** — eine Runde mit Text + `look_up` streamt ihren Text UND liefe in `speakBridge`,
das denselben Satz ein ZWEITES Mal auf dieselbe Leitung schriebe.

```js
const bridgeText = loopContinues && !speechStreamed && thinkingSignal.speakBridge(speech);
```

Gelesen wird die VORHANDENE Invariante `speechStreamed` („der AKTUELLE Wert von `speech`
steht bereits auf dem Draht") — kein zweiter Zustand, keine zweite Wahrheit (G5). Der
Einmal-pro-Turn-Riegel in `thinking-signal.js` wird dabei nicht verbraucht: eine spaetere,
nicht armierte Runde darf weiterhin ueberbruecken. Beleg: AL-P17-2 (Mutationsprobe M2 macht
ihn rot).

### E3 — Consult-Fueller entfaellt bei bereits gestreamtem Text (O-D1-B)

```js
if (!speechStreamed) speech = consult.speech;
```

**Ausdruecklich:** damit gilt die AL-P14-Zusage „der Haltesatz ist LLM-frei" in GENAU
diesem einen Fall nicht mehr. Das ist eine bewusste Owner-Entscheidung, keine
Nachlaessigkeit; der Fall ohne gestreamten Text bleibt unveraendert LLM-frei (AL-P17-3b).
Die Consult-Mechanik selbst (Kontingent, Frische, Frist, Mandats-Fallback,
Paraphrase-Pflicht) ist NICHT beruehrt — nur, welcher Satz gesprochen wird; AL-P17-3a pinnt
zusaetzlich `consults.length === 1`.

`speechStreamed` braucht in diesem Zweig keine Zuweisung mehr: ohne gestreamten Text ist es
bereits `false`, mit gestreamtem Text bleibt der gesprochene Text stehen — die Invariante
haelt in beiden Armen.

### Nicht angefasst (bewusst)

`src/thinking-signal.js`, `src/llm.js`, `src/consult/in-call.js`, `src/telnyx-llm-shim.js`,
`src/config.js`, `.env.example`, `render.yaml`, `src/i18n/**`, `src/bridge.js`,
`src/routes/voice.js`, `PLAN-SECURITY.md`, `README.md`. **Keine** neue Env-Variable,
**kein** neues Flag (Rueckweg bleibt `TELNYX_SHIM_TOKEN_STREAMING`), **keine** neue
Dependency, keine Aenderung an `toolDefs`/`execTool`/`SIDE_EFFECT_ONLY_TOOL_NAMES`/
`completeRound`/`roundFitsDeadline`.

**Caller-Pruefung (beide Engines):**

| Pfad | Ruft | Wirkung |
|---|---|---|
| Shim (`src/app.js` → `makeTelnyxLlmShim` → `agentTurn`) | `agentTurn(call, text, { onSpeechChunk: wire.writeChunk })` | der **einzige** betroffene Pfad |
| Budget-Engine (`src/routes/voice.js`) | `agentTurn(call, heard \|\| null)` ohne drittes Argument | Bedingung 1 sperrt → `null` → byte-identisch; `speechStreamed` bleibt false → E2/E3 sind No-ops |
| Realtime-Bridge (`src/bridge.js`) | `toolDefs` + `execTool` + `shapeForSpeech`, **nie** `agentTurn` | vollstaendig unberuehrt |
| `makeSentenceChunker` | nur `streamSinkFor` + Tests | Default `continuesStream=false` = Bestand |

---

## 3. Zwei Zweitfolgen, die nicht verschwiegen werden

**(a) Das Denk-Signal (AL-P7b) ist im heutigen Werkzeugsatz strukturell stumm.** Nach E1
ist jede Runde mit offenem Draht armiert (alle vier bekannten Werkzeuge sind strom-sicher,
und die Frist traegt), also greift E2 immer. `speakBridge` bleibt erreichbar nur, wenn (i)
ein unbekanntes Werkzeug im ANGEBOTENEN Satz liegt (heute unmoeglich — `agentTools` bietet
nur bekannte an), (ii) die Frist NICHT mehr traegt (Bedingung 3), oder (iii) kein
Sprechkanal existiert (Budget-Engine — dort ist das Signal ohnehin ein No-op). Das ist die
logische Konsequenz von „Streaming und Bruecke sagen dasselbe, nur frueher" (O-D1-A), aber
es ist eine Verhaltensaussage ueber eine LIVE geflippte Faehigkeit und gehoert deshalb
hierher, nicht in einen Nebensatz. Der Mechanismus selbst bleibt unveraendert im Code und
in seinen Einheitstests (`al-p7b-thinking-signal.test.js`) gepinnt.

**(b) `thinkingSignalSpoken` wird in Live-Turns dauerhaft `false`.** Entschieden und im
Code an der Rueckgabe festgeschrieben: die Lesart bleibt **„die BRUECKEN-FUNKTION hat
gesprochen"** — mechanismus-bezogen, nicht turn-bezogen. Begruendung: die Alternative
(„dieser Turn hat ueberbrueckt") verlangte einen zweiten Schreiber auf dasselbe Feld und
machte den `turn_ok`-Diskriminator mehrdeutig — genau der Fehler, den AL-D2 mit
`speechWireOpen` gerade repariert hat. **Der Live-Abnahme-Diskriminator dieser Phase ist
`streamArmedRounds` (Turn) bzw. `streamChunks` (turn_ok-Zeile), nicht `thinkingSignal`.**

---

## 4. Bewertung des Abriss-Pfads (Pre-Mortem-Pflicht)

**Kette am Code:** `llm.completeStream` wirft (ein Retry ist nach dem ersten Fragment
ausgeschlossen — `retryable: (err) => !forwardedText && …`) → `completeRound` bucht **genau
einen** pessimistischen Beleg und wirft weiter → `agentTurn` propagiert → Shim-`catch` →
`if (wire && !wire.isFinished()) wire.finish(content)` haengt `degradedSpeechFor(err,
locale)` als LETZTEN Chunk an bereits Gesprochenes.

**Was der Anrufer hoert:** nur VOLLSTAENDIGE Saetze plus den Abbruchsatz. Der
unvollstaendige Rest liegt im Chunker-Puffer und wird nie ausgegeben, weil
`flushRemainder()` erst NACH `completeRound` steht und im Wurf-Fall nie erreicht wird. Es
gibt also **keinen halben Satz** auf der Leitung.

**Haeufigkeit:** steigt von „praktisch nie" (armierte Runden waren selten) auf „jeder
Abriss einer armierten Runde". Absolut bleibt der Fall selten: `llm.js` retryt VOR dem
ersten Fragment, und der Circuit-Breaker faengt die Dauerstoerung.

**Der eine reale Restmangel:** an der Nahtstelle zwischen letztem Chunk und
`wire.finish`-Tail fehlt die Wortgrenze (`"…geoeffnet." + "Entschuldigung…"`). Das ist
**kein Neuschaden dieser Phase**: `respond`/`wire.finish` schreibt den Tail seit AL-P7 roh
an, gepinnt durch AL-P7-28. E1b loest die Naht ZWISCHEN RUNDEN, nicht die zwischen Chunker
und `finish`-Tail — dort laege der Fix im Shim, also im Degradationspfad, der maximal
einfach bleiben muss.

**Urteil: akzeptiertes Risiko, ausdruecklich benannt.** Begruendung:
1. die Alternative zum Anhaengen ist Stille nach einem halben Turn — schlechter;
2. der Schaden ist ein fehlendes Leerzeichen zwischen zwei VOLLSTAENDIGEN Saetzen, keine
   falsche und keine verlorene Aussage;
3. die Kostenbuchung bleibt in BEIDEN Zweigen bei genau einem Beleg je Runde
   (`completeRound` unberuehrt — gepinnt durch AL-P7-23 und neu AL-P17-5).

Offener Kandidat fuer eine eigene Mini-Phase: die `wire.finish`-Tail-Naht.

---

## 5. Safety-Notaus bleiben hoerbar (am Code geprueft)

| Pfad | Stelle | Ergebnis |
|---|---|---|
| Budget-Gate **vor** dem Turn | Shim Schritt 6 → `killCallForBudget` | laeuft vor `agentTurn`, nichts gestreamt ⇒ `wire.finish(budgetExhaustedHangup)` ist der EINZIGE Inhalt. **hoerbar** |
| Budget-Abbruch **im** Turn | `if (isBudgetAxis(turn.stopReason)) return await killCallForBudget(...)` — steht **vor** `respond(turn.speechStreamed …)` | `killCallForBudget` ruft `respond` mit EIGENEM Text und liest `speechStreamed` **nicht**. Auch nach gestreamten Saetzen geht der Hangup-Satz als letzter Chunk raus. **hoerbar** |
| Loop-Guard | Shim Schritt 4.6, vor `agentTurn` | nichts gestreamt ⇒ `llmDegradedSpeech` ist der einzige Inhalt. **hoerbar** |
| Rate-Gate | Shim Schritt 5, vor `agentTurn` | dito. **hoerbar** |
| `terminateCall` / Watchdog | unveraendert | unberuehrt |

E2/E3 fassen `respond` nicht an; die EINZIGE Stelle, die `speechStreamed` liest, ist der
Gutfall (`respond(turn.speechStreamed === true ? "" : turn.speech)`), und die fail-safe-
Richtung (`=== true`) bleibt. **Kein Notaus kann durch diese Phase stumm werden.**

---

## 6. Offenlegung

`disclosureSentence` fliesst ausschliesslich ueber `openingText(call)`; `openingText` wird
von `src/telnyx-call-control-ingest.js` (Call-Control-`speak`) und `src/routes/voice.js`
(TeXML-Render) gerufen — **nie** aus `agentTurn`, nie durch `makeSentenceChunker`, nie
ueber `wire`. Der Diff beruehrt keine dieser Stellen. Aktiv geprueft statt angenommen:
AL-P17-6 pinnt beides — der Offenlegungssatz taucht auf dem Shim-Draht gar nicht auf, und
`openingText` beginnt byte-genau mit ihm.

---

## 7. Jede angepasste Bestandsassertion

**Regel bei der Umsetzung:** keine Assertion wurde geloescht oder abgeschwaecht. Jede
kippende Assertion steht auf dem neuen SOLL-Wert und traegt im Testkommentar „Zusage vorher
/ Zusage jetzt / warum".

### 7.1 Geaenderte Zusagen

| Datei | Test-ID | Zusage vorher | Zusage jetzt | warum das die Absicht ist |
|---|---|---|---|---|
| `al-p7-turn-streaming.test.js` | **AL-P7-20** | ein INFORMATIONSLIEFERNDES Werkzeug (`get_consult`) im angebotenen Satz sperrt das Streamen | `get_consult` ist strom-sicher und armiert; gesperrt wird nur noch bei einem UNBEKANNTEN Werkzeug | die Klasse „informationsliefernd sperrt" war die Ursache von Befund D-1. Der fail-closed-Beweis lebt jetzt genau EINMAL (AL-P17-4); AL-P7-20 pinnt an seinem Ort die geaenderte Ende-zu-Ende-Aussage. Abnahme 3 aus AL-P7 bleibt als Ganzes abgedeckt, nur auf zwei Orte verteilt |
| `al-d1-cause-diagnostics.test.js` | **AL-D1-2** | `look_up` im Satz ⇒ `streamArmedRounds 0` (Reproduktion von Befund B) | derselbe Fixture-Zustand armiert (`1`, `stream === true`, mehrere Chunks) | genau dieser Wert IST die Phase. Der Test wird nicht geloescht — er wandert vom Ursachen-Pin zum Behoben-Pin. Der historische Messwert bleibt in `tasks/al-d1-report.md` und in §1 hier |
| `al-d1-cause-diagnostics.test.js` | **AL-D1-3** | `get_consult` im Satz ⇒ `streamArmedRounds 0` | armiert — zulaessig **weil** E3 (O-D1-B) den Fueller bei gestreamtem Text entfallen laesst | ohne E3 waere die Aufnahme falsch; der Kommentar am Test nennt O-D1-B als Grund |
| `al-d1-cause-diagnostics.test.js` | Dateikopf | Zusage „(B) Reproduktion Befund B" | „(B) BEHOBEN durch AL-P17" | reine Kommentar-Nachfuehrung, damit der Dateikopf nicht luegt |
| `al-d2-thinking-signal-diagnostics.test.js` | **AL-D2-1** | in der dominanten Live-Klasse sind BEIDE Streaming-Faehigkeiten still | das Denk-Signal ist dort weiterhin still (B3 sperrt, `thinkingSignalSpoken false`, `roundtrips 1` — **woertlich unveraendert**); das Token-Streaming ist es nicht mehr | genau diese Klasse (18/21) war der Anlass der Phase. Drei Assertions umgestellt (`streamArmedRounds` 0→1, `stream` false→true, turn_ok-Zahl). `contentPieces` bleibt einteilig, weil das Fixture einsaetzig ist |
| `al-d2-thinking-signal-diagnostics.test.js` | **AL-D2-3** | der fuehrende Satz liegt auf dem Draht VOR der Antwort — gesprochen von der **Bruecke** | identische Zusage, **anderer Sprecher** (Satz-Chunker); die Bruecke schweigt (E2) | **die heikelste Anpassung der Phase.** Ohne E2 stuende derselbe Satz zweimal auf der Leitung. Assertionsbloecke 2-6 (Reihenfolge, EIN Envelope, `finish_reason`, `[DONE]`, `roundtrips 2`, Egress-Negativbeweis) bleiben woertlich; nur Block 1 wechselt, plus E1b in Block 2 (`[BRUECKE, " "+ANTWORT]` statt `["BRUECKE ", ANTWORT]`). Zusaetzlich neu gepinnt: `"streamArmedRounds":2` |
| `al-d2-thinking-signal-diagnostics.test.js` | **AL-D2-6** | es spricht ein ANDERER Sprecher (`consultFillerSpeech`), keine Stille | es spricht der MODELLSATZ, ebenfalls keine Stille (O-D1-B) | die tragende Zusage („keine Stille, kein zweiter Haltesatz") wird **verschaerft** gepinnt: zusaetzlich `contentPieces.length === 1` |
| `al-d2-thinking-signal-diagnostics.test.js` | Dateikopf | — | Nachtrag: drei Pins beschreiben jetzt den BEHOBENEN Zustand, K4 bleibt offen | Kommentar-Nachfuehrung |
| `al-p7b-turn-bridge.test.js` | **AL-P7b-8** | die Bruecke spricht den fuehrenden Text, danach die echte Antwort, genau einmal | derselbe Ablauf, Sprecher = Chunker: `[BRUECKE, " "+ANTWORT]`, `speechStreamed true`, `thinkingSignalSpoken false`, `bodies.length 2` | die eigentliche Zusage („genau einmal") wird weiterhin als ZAEHLUNG gepinnt, zusaetzlich zum `deepEqual` |
| `al-p7b-turn-bridge.test.js` | **AL-P7b-10** | ein angenommenes `get_consult` spricht seinen eigenen, LLM-freien Fueller | nur noch, wenn nichts gestreamt wurde; mit gestreamtem Text bleibt der Modellsatz | O-D1-B. Kein Doppel-Pin: AL-P17-3a/3b fahren den SHIM-DRAHT, AL-P7b-10 die TURN-RUECKGABE |
| `al-p7b-turn-bridge.test.js` | **AL-P7b-11** | Flag aus ⇒ keine Bruecke, KEIN Chunk | `THINKING_SIGNAL_ENABLED` gated die BRUECKE, nicht den Chunker: `thinkingSignalSpoken false` und `speech === ANTWORT_TEXT` bleiben woertlich, die Chunk-Erwartung wird auf die Streaming-Fassung gezogen | das Token-Streaming hat seinen eigenen Rueckweg (`TELNYX_SHIM_TOKEN_STREAMING`); eine zweite, nirgends dokumentierte Kopplung waere schlechter. Der byte-identische Flag-aus-Vergleich fuer den PROMPT liegt in `al-p7b-prompt.test.js` und bleibt unberuehrt gruen |
| `al-p7b-turn-bridge.test.js` | **AL-P7b-12** | genau EINE Bruecke ueber drei Runden | NULL Bruecken, drei gestreamte Runden | die tragende Zusage war „kein Dauergeplapper" = „kein Satz geht doppelt raus". Sie bleibt und wird **schaerfer** gepinnt: jeder der drei Rundentexte steht per `split`-Zaehlung GENAU EINMAL auf der Leitung, in Reihenfolge |
| `al-p7b-turn-bridge.test.js` | **AL-P7b-20** | bei Kappung ist `turn.speech` die GEKAPPTE Leitungsfassung | die 120-Zeichen-Kappung gehoert NUR der Bruecke (ihr Einheitstest `al-p7b-thinking-signal.test.js` pinnt sie unveraendert); auf dem Streaming-Pfad wird der Text VOLLSTAENDIG gesprochen | die Kappe ist eine Notbremse gegen eine zu LANGE Ueberbrueckung, nicht gegen eine lange Antwort. Die Kernaussage des Korrektheits-Fixes — **Transkript == Leitung** — bleibt und wird direkt als Gleichung gegen die geschriebenen Chunks gepinnt (`turn.speech === chunks.join("").trim()`), plus `turn.speech === LANGER_RUNDENTEXT` (nichts wurde still gekappt) |
| `al-p7b-turn-bridge.test.js` | **AL-P7b-13** | — (Assertions **unveraendert**) | — | nur Name und Kommentar folgen dem Sprecherwechsel („der gesprochene Rundentext" statt „die Bruecke"), damit der Testname nicht luegt. Keine Assertion angefasst |
| `al-p7b-turn-bridge.test.js` | **AL-P7b-9** | — (Assertions **unveraendert**) | — | nur der Kommentar zur `armConsult`-Vorbedingung wurde korrigiert (sie disarmiert nicht mehr) |
| `al-p7b-turn-bridge.test.js` | Dateikopf | „die beiden Mechanismen sind bewusst gegenseitig exklusiv … `armConsult` disarmiert" | exklusiv sind sie weiterhin — den Vorrang hat jetzt aber IMMER das Streaming (E2) | Kommentar-Nachfuehrung |
| `al-p10b-lookup.test.js` | **AL-P10b-7** | — (Assertions **unveraendert**) | — | nur der Kommentar: der Sprecher wechselt, die Zeitordnung haelt aus demselben Grund wie zuvor (`sink.flushRemainder()` laeuft direkt nach der Modellrunde und VOR `performLookupRequest`) |

### 7.2 Rein strukturelle Test-Infrastruktur (keine Assertion beruehrt)

Zwei Anthropic-Mocks waren JSON-only; nach E1 laufen ihre Turns in den Streamingpfad und
liefen sonst gegen eine Nicht-SSE-Antwort (`request ended without sending any chunks`).
Beide bekommen denselben zweizeiligen SSE-Zweig aus dem GETEILTEN Test-Rohstoff
`test/anthropic-sse-fixtures.js` — **kein zweiter SSE-Renderer** (G5):

- `test/al-p7b-turn-bridge.test.js`: `if (body.stream === true) return writeSse(res, scripted.blocks);`
  Zusaetzlich wurden die lokalen Kopien von `text`/`toolUse`/`reply`/`jsonMessage`/
  `MOCK_USAGE` durch die Importe aus derselben Quelle ersetzt (Duplizierung entfernt, G5).
- `test/al-p10b-lookup.test.js`: `if (body.stream === true) return writeSse(res, scripted.content);`
  `MOCK_USAGE` der geteilten Quelle ist `{10, 5}` — **identisch** zur bisherigen lokalen
  `message()`-Fixture, die Kostendifferenz-Assertionen (AL-P10b-9/-10, AL-P10c-3) bleiben
  damit unveraendert gueltig.

### 7.3 Ohne Anpassung gruen geblieben (nachgerechnet und gefahren)

AL-P7-18/19/21/22/23/24, AL-D1-1/4/5/6, AL-D2-2/4/5/7/8, AL-P7b-14, AL-P10b-1..6/8..15,
AL-P10c-1..3, sowie `al-p7b-thinking-signal.test.js`, `al-p7b-prompt.test.js`,
`al-p7b-shim-bridge.test.js`, `al-p7-shim-stream-wire.test.js`,
`al-p7-speech-chunker.test.js`, `al-p7-llm-stream.test.js`, `al-p14-in-call-consult.test.js`,
`al-p4-side-effect-tool-loop.test.js`, `al-d1-shim-diagnostics.test.js`,
`telnyx-llm-shim.test.js`.

**AL-D2-4 (K4) ist gruen — und genau das ist der Beleg, dass K4 offen bleibt.**

### 7.4 Neue Tests

| ID | Datei | Gegenstand |
|---|---|---|
| AL-P17-1 | `test/al-p17-first-round-audible.test.js` | Kernbeweis: Live-Werkzeugsatz, Text ohne Werkzeug ⇒ `streamArmedRounds 1`, mehrere Deltas, erstes = erster Satz, spec-konformer Rahmen |
| AL-P17-2 | dto. | E2 + E1b: der fuehrende Satz steht GENAU EINMAL auf dem Draht, mit Wortgrenze zur Folgerunde |
| AL-P17-3a | dto. | E3 mit gestreamtem Text: Modellsatz bleibt, kein zweiter Haltesatz, `consults.length === 1` |
| AL-P17-3b | dto. | E3 ohne gestreamten Text: Fueller unveraendert |
| AL-P17-4 | dto. | E1 fail-closed mit erfundenem Werkzeug + Positivkontrolle (faengt `every`→`some`) |
| AL-P17-6 | dto. | Offenlegung: anderer Pfad, aktiv geprueft |
| AL-P17-5 | `test/al-p7-turn-streaming.test.js` | Kostenbuchung: zwei gestreamte Runden ⇒ genau zwei Belege, exakte Token-Summen |

---

## 8. Mutationsproben

Ablauf je Probe: mutieren → `node --test test/al-p17-first-round-audible.test.js
test/al-d2-*.test.js test/al-p7-turn-streaming.test.js test/al-p7b-turn-bridge.test.js
test/al-d1-*.test.js` → rote IDs notieren → Mutation zuruecknehmen.

| # | Riegel | Mutation | erwartet | **beobachtet** |
|---|---|---|---|---|
| M1 | E1 Allowlist | `isStreamSafeTool` → `return true` | nur AL-P17-4 rot | **exakt AL-P17-4 rot**, alles andere gruen ✔ |
| M1b | E1 Aufnahme `look_up` | `LOOK_UP_TOOL_NAME` aus `STREAM_SAFE_TOOL_NAMES` streichen | AL-P17-1/-2, AL-D1-2, AL-D2-1/-3 rot | **AL-P17-1, -2, -3a, -4, AL-D1-2, AL-D2-1, -3, -6 rot**; AL-P17-3b und AL-D1-3 gruen. Breiter als erwartet, und zwar korrekt: in den Consult-Fixtures dieser Dateien ist `look_up` MIT angeboten, ein disarmiertes `look_up` disarmiert also die ganze Runde und laesst E3 in den Fueller-Arm laufen ✔ |
| M1c | Quantor | `tools.every` → `tools.some` | nur AL-P17-4 rot | **exakt AL-P17-4 rot** — belegt, dass die Positivkontrolle dort noetig ist ✔ |
| M2 | E2 | `!speechStreamed` entfernen | AL-P17-2 rot, AL-P7b-8 rot; AL-P17-1 und -3a/3b gruen | **AL-P17-2, AL-D2-3, AL-P7b-8/-12/-13/-20 rot**; AL-P17-1, -3a, -3b gruen ✔ |
| M3 | E3 | zurueck auf `speech = consult.speech; speechStreamed = false;` | AL-P17-3a, AL-D2-6, AL-P7b-10 rot; **AL-P17-3b gruen** | **exakt AL-P17-3a, AL-D2-6, AL-P7b-10 rot; AL-P17-3b gruen** — der Beweis, dass E3 richtungsselektiv ist ✔ |
| M4 | E1b | `continuesStream` in `emit` ignorieren | AL-P17-2 + AL-D2-3 rot; AL-P17-1 gruen | **AL-P17-2, AL-D2-3, AL-P7b-8/-11/-12 rot**; AL-P17-1 gruen (Ein-Runden-Fall) ✔ |

**Der finale Diff enthaelt keine Mutation.** Nachgeprueft mit `git diff` und gezieltem
`grep` (kein `return true`, kein `tools.some`, kein unbedingtes `speech = consult.speech`,
`continuesStream` in beiden Dateien vorhanden), danach die betroffenen Dateien erneut
vollstaendig gruen gefahren (62/62).

---

## 9. Was offen bleibt

1. **K4** — `look_up` OHNE fuehrenden Text: der Anrufer hoert die Werkzeug-Wartezeit
   weiterhin als Stille. Nicht-Ziel dieser Phase, gruen gepinnt in AL-D2-4.
2. **D-3** — Prompt am Tool-Entscheidungspunkt (der eigentliche Hebel gegen K4). Eigene
   Phase, hier ausdruecklich NICHT angefasst.
3. **Transkript vs. Leitung** — `shapeForSpeech` laeuft NACH dem Streamen. Geerbte
   AL-P7-Bestandsgrenze, jetzt **Normalfall statt Ausnahme**. Benannt, nicht gefixt.
4. **`wire.finish`-Tail-Naht** — im Abrissfall fehlt die Wortgrenze zwischen letztem Chunk
   und Degradationssatz (§4). Kandidat fuer eine eigene Mini-Phase im Shim.
5. **Rueckweg** — der einzige Schalter dieser Faehigkeit ist und bleibt
   `TELNYX_SHIM_TOKEN_STREAMING`. Ein zweites Flag waere ein Schalter, den niemand je
   zurueckdreht.
6. **Ketten-Nachtrag** — O-D1-A/O-D1-B gehoeren nach `tasks/al-chain-state.md`. Laut
   Praezedenz AL-P7b (Deviation 3) ist das eine **Lead-Aufgabe nach dem Merge**, nicht
   Sache des Worktrees; hier als Deviation ausgewiesen, damit sie nicht untergeht.

---

## 10. Was diese Phase geaendert hat

```
 src/claude.js                                  | 118 ++++++++++++++++---
 src/speech-chunker.js                          |  10 +-
 test/al-d1-cause-diagnostics.test.js           |  39 +++++--
 test/al-d2-thinking-signal-diagnostics.test.js |  74 +++++++++---
 test/al-p10b-lookup.test.js                    |  23 +++-
 test/al-p7-turn-streaming.test.js              |  40 ++++++-
 test/al-p7b-turn-bridge.test.js                | 151 ++++++++++++++++---------
 + test/al-p17-first-round-audible.test.js      (neu)
 + tasks/al-p17-diagnose.md                     (neu)
```

Kein `package.json`/`package-lock.json`-Diff, keine neue Dependency, keine Gate-/Auth-/
Offenlegungs-/Geldpfad-Datei, keine `.env.example`- und keine `render.yaml`-Zeile.

**Verifikation**

| Schritt | Ergebnis |
|---|---|
| `node --check` je geaenderter `.js` | gruen (`src/claude.js`, `src/speech-chunker.js`, alle sechs Testdateien) |
| Roter Zwischenlauf (vor der Testanpassung) | 17 rote IDs: AL-D1-2/-3, AL-D2-1/-3/-6, AL-P7-20, AL-P7b-8/-9/-10/-11/-12/-13/-14/-20, AL-P10b-7/-10/-11 — der Beleg, dass die Bestandstests wirklich gekippt sind und nicht vorauseilend angepasst wurden |
| `npm test` | **gruen: 3731 pass / 0 fail** |
| `npm run test:gates` | **3 rot (GAP-05, GAP-15 zweimal) — unveraenderte Baseline**, 557 pass / 560 tests |
| Mutationsproben M1/M1b/M1c/M2/M3/M4 | alle selektiv rot, alle zurueckgenommen (§8) |
| Smoke (echter Serverprozess, `/healthz` 200, Shim-Turn mit `stream:true`) | **2 content-Deltas auf dem echten Draht**, erstes = erster Satz; Gegenmessung auf `master`-Stand derselben zwei Dateien: **1 Delta am Ende**. Keine echten Anrufe, kein Netz nach draussen (Anthropic-Mock lokal) |
