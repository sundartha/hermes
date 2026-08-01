# AL-D2 — Warum das Denk-Signal in keinem Turn gefeuert hat

> Liefergegenstand der Phase AL-D2 (Spec: `tasks/al-d2-spec.md`, §3.3). **Nicht** zu
> verwechseln mit `tasks/al-d2-report.md` (Workflow-Prozessbericht). Alles hier steht am
> Code oder an einer gelaufenen Messung; wo etwas nicht entscheidbar ist, steht es als
> offen. Diese Phase hat **kein** Verhalten geaendert.

---

## 0. Antwort in drei Saetzen

1. **Das Denk-Signal hat KEINEN Defekt — es hatte in keinem der 21 Live-Turns etwas zu
   ueberbruecken.** In 18 Turns sperrt bereits die allererste Bedingung (`B3`: die Runde
   lieferte gar kein `tool_use`), in 3 Turns die Ausstiegs-Bedingung `B5`.
2. **Die Praemisse der Uebergabe ist falsch.** `tasks/al-handover-2026-08-01.md` §4 nennt
   eine Zeit-Schwelle ("`agentTurn`-Median, ~1,3 s") und schliesst daraus "es haette
   mehrfach feuern muessen". Diese Schwelle existiert im Code nicht; AL-P7b hat sie als
   bewusste Abweichung **E3** durch eine **strukturelle** Schwelle ersetzt.
3. **In seiner heutigen Bauform kann das Denk-Signal die vom Owner gehoerten Pausen
   strukturell nicht erreichen.** Es deckt ausschliesslich Werkzeug-Wartezeit ab; die
   Pausen lagen saemtlich in der ersten Modellrunde eines werkzeuglosen Turns. Herleitung
   in §3.

---

## 1. Die Bedingungskette am Code (B1..B7)

Die Nummerierung ist die Berichtssprache der Spec. **Der Code prueft in einer anderen
Reihenfolge** — und weil immer die **erste** greifende Bedingung sperrt, ist genau diese
Reihenfolge fuer die Zuordnung je Turn-Klasse entscheidend. Der Kopfkommentar von
`speakBridge` sagt es selbst: *"Fail-closed in dieser Reihenfolge: Einmal-Riegel, Flag,
Abnehmer, Inhalt."*

Tatsaechliche Pruefreihenfolge: **B3 → B4 → B5 → B7 → B1 → B2 → B6**.

| # | Bedingung | Datei · Symbol |
|---|---|---|
| **B3** | Die Runde lieferte >= 1 `tool_use`-Block | `src/claude.js`, `agentTurn`: `const toolUses = resp.content.filter(...)` gefolgt von `if (!toolUses.length) break;` — steht **vor** allem anderen |
| **B4** | Kein **angenommenes** `get_consult` | `src/claude.js`, `agentTurn`: `const consult = decideConsultRequest(call, toolUses); if (consult?.accepted) { ... break; }`; Entscheider: `src/consult/in-call.js`, `decideConsultRequest` |
| **B5** | `loopContinues === true` | `src/claude.js`, `agentTurn`: `const loopContinues = !(speech && (endCall \|\| suppressedEndCall \|\| sideEffectOnlyRound));` — kurzschliesst die Bruecke in `const bridgeText = loopContinues && thinkingSignal.speakBridge(speech);` |
| **B7** | Einmal-pro-Turn-Riegel | `src/thinking-signal.js`, `makeThinkingSignal`: `if (spoken \|\| ...) return "";` |
| **B1** | `config.voice.thinkingSignalEnabled === true` | `src/thinking-signal.js`, `speakBridge`: `!enabled`; gesetzt in `src/claude.js`, `agentTurn`: `makeThinkingSignal({ onSpeechChunk, enabled: config.voice.thinkingSignalEnabled })` |
| **B2** | Es gibt einen Abnehmer (`onSpeechChunk`) | `src/thinking-signal.js`, `speakBridge`: `!onSpeechChunk`; Quelle: `src/telnyx-llm-shim.js`, `agentTurn(call, callerText, wire ? { onSpeechChunk: wire.writeChunk } : {})` mit `const wire = wantsStream && config.telnyx.telnyxAssistant.shimTokenStreaming ? makeStreamingResponse(res, model) : null` |
| **B6** | `bridgeSpeechFrom(...)` liefert nicht-leer | `src/thinking-signal.js`, `speakBridge`: `const bridge = bridgeSpeechFrom(roundText); if (!bridge) return "";` |

### Zwei Korrekturen an der Spec-Tabelle

1. **Reihenfolge** (s. o.). Die Spec listet B1..B7 aufsteigend; das ist nicht die
   Auswertungsreihenfolge.
2. **B6 ist nicht "fuehrender Text im selben Antwort-Block", sondern "der aktuelle Wert von
   `speech` ist nicht leer".** `speakBridge` bekommt `speech` uebergeben, und `speech` wird
   in `agentTurn` nur ueberschrieben, *wenn* die Runde Text hatte
   (`if (textParts.length) { speech = ...; }`). Hatte sie keinen, traegt `speech` noch den
   Wert einer **frueheren** Runde. Praktisch faellt das mit der Spec-Formulierung zusammen
   (Runde 0 startet mit `speech = ""`, und ab Runde 1 ist B7 gezogen, sobald je gebrueckt
   wurde) — die Formulierung im Bericht steht trotzdem am Code.

### Zwei Nebenbefunde, die fuer die Aussagekraft zaehlen

- **B5 und B6 sind gegenlaeufig gekoppelt.** `loopContinues` enthaelt `speech &&`. Eine
  Runde **ohne** Text passiert B5 immer (weil `speech` leer ist) und scheitert dann
  garantiert an B6. Eine Runde **mit** Text und nur Seiteneffekt-Werkzeugen scheitert an
  B5. Es gibt keinen Zustand, in dem beide gleichzeitig sperren — genau darum ist die
  Mutationsprobe M1 an B5 selektiv (§7).
- **B2 und die Armierung von AL-P7 haben dieselbe Wurzel.** `streamSinkFor`
  (`src/claude.js`) steigt ebenfalls bei `!onSpeechChunk` aus. Ohne `wire` sind **beide**
  Streaming-Faehigkeiten still. Deshalb ist das neue Log-Feld `speechWireOpen` (§8) das
  fehlende Instrument fuer D-1 **und** D-2.

### Die Zeit-Schwelle existiert im Code nicht

In `src/thinking-signal.js` und im gesamten Bruecken-Zweig von `agentTurn` gibt es keinen
Vergleich gegen `elapsedMs` o. Ae. fuer das Denk-Signal. Die einzigen Zeitgroessen im
Tool-Loop (`roundStopReason`, `roundFitsDeadline`, `turnLoopDeadlineMs`) steuern **Abbruch**
und **Armierung**, nicht die Bruecke. `PLAN-ASSISTANT-LEAP.md` (Phase 7b, "Startwert:
`agentTurn`-Median aus Phase 1, also ~1,3 s") ist durch **E3** ersetzt
(`tasks/al-p7b-workflow-report.md` §2.2): die Bruecke feuert genau dann, wenn der Tool-Loop
nach dieser Runde weiterlaeuft. Begruendung damals: ein Timer waere gegen `finish()` des
SSE-Stroms geraced und ohne Fake-Timer nicht deterministisch testbar.

**Folge:** eine Latenz von 2,4 s in einem werkzeuglosen Turn ist unter der heutigen Bauform
**kein** Fall, in dem das Signal "haette feuern muessen".

---

## 2. Die Antwort pro Turn-Klasse  [Spec §3.3 (1)]

Alle sechs Klassen sind offline gegen den Shim-Harness gefahren
(`test/al-d2-thinking-signal-diagnostics.test.js`, POST auf die Shim-Route mit
`stream:true` wie Telnyx live, gegen den **echten** `agentTurn` und einen lokalen
Anthropic-Mock). Konfiguration = Live-Konfiguration: `THINKING_SIGNAL_ENABLED=true`,
Token-Streaming an, Werkzeugsatz mit `look_up` **und** `get_consult`.

| Klasse | Szenario | Sperrende Bedingung | Live-Anteil | Test-ID | Defekt? |
|---|---|---|---|---|---|
| **K1** | Text **ohne** Werkzeug | **B3** (`if (!toolUses.length) break;`) | **18 / 21** | AL-D2-1 | nein — es gab nichts zu ueberbruecken |
| **K2** | `take_message` **plus** Text | **B5** (`sideEffectOnlyRound` bei vorhandenem `speech`) | **3 / 21** | AL-D2-2 | nein — der Turn endet mit dieser Runde |
| **K3** | `look_up` **mit** fuehrendem Text (Positivkontrolle) | keine — die Bruecke **feuert** | 0 / 21 | AL-D2-3 | — (Positivkontrolle) |
| **K4** | `look_up` **ohne** fuehrenden Text | **B6** (`bridgeSpeechFrom("")` = leer) | 0 / 21 | AL-D2-4 | **ja** — s. §5 |
| **K5** | wie K3, aber **ohne** Sprechkanal | **B2** (`wire === null`) | unbekannt (s. §6) | AL-D2-5 | nein — fail-closed by design |
| **K6** | angenommenes `get_consult` | **B4** (`consult?.accepted` steigt vorher aus) | 0 / 21 | AL-D2-6 | nein — es spricht ein **anderer** Sprecher (`consultFillerSpeech`), keine Stille |

**Gemessen, nicht behauptet** (Auszug aus den Assertions):

- **K1** (AL-D2-1): `turn.thinkingSignalSpoken === false`, `turn.roundtrips === 1`,
  `turn.streamArmedRounds === 0`, genau **eine** Anthropic-Anfrage, und diese ohne
  `stream:true`. Auf dem SSE-Draht liegt genau **ein** content-Delta (die fertige
  Antwort, am Ende). **In der dominanten Live-Klasse sind also BEIDE Mechanismen still** —
  das Denk-Signal (AL-P7b) und das Token-Streaming (AL-P7).
- **K2** (AL-D2-2): `roundtrips === 1` beweist, dass der **Ausstieg** griff (`loopContinues`
  war `false`), nicht B6. `toolNames === ["take_message"]`.
- **K3** (AL-D2-3): `thinkingSignalSpoken === true`, und auf dem Draht stehen genau zwei
  content-Deltas in dieser Reihenfolge: `["Einen Moment, das schaue ich nach. ",
  "Donnerstag um neun Uhr passt."]` — die Bruecke an Position 0. Zusaetzlich: `role`-Delta
  zuerst, **ein** Envelope (`id`), `finish_reason: "stop"`, `data: [DONE]` am Ende, zwei
  Modellrunden. Der `turn_ok`-Log traegt `"thinkingSignal":true` und `"speechWireOpen":true`.
- **K4** (AL-D2-4): `roundtrips === 2` — der Loop lief weiter, B5 hat **nicht** gesperrt —
  und trotzdem `thinkingSignalSpoken === false`; auf dem Draht liegt **nur** die Antwort.
- **K5** (AL-D2-5): identische Modell-Skript-Vorgabe wie K3, einziger Unterschied ist der
  Kanal (`telnyxShimTokenStreaming: false`). Ergebnis: `thinkingSignalSpoken === false`,
  `streamArmedRounds === 0`, `turn_ok` traegt `"speechWireOpen":false`.
- **K6** (AL-D2-6): `turn.speech === localeFor("de").consultFillerSpeech`,
  `speechStreamed === false`, `roundtrips`-Beleg: genau **eine** Anthropic-Anfrage.

**Egress-Negativbeweis:** `look_up` wird in K3/K4 bewusst **ohne** `query`-Feld gerufen.
`performLookupRequest` (`src/research/in-call.js`) ruft
`sanitizeLookupQuery(requested.input?.query, call)`; `typeof undefined !== "string"` liefert
`null`, also `logLookupBlocked` + Ablehnung — **vor** `store.countCallLookup`, **vor**
`bookLookupSearchFee` und **vor** `provider.searchFacts`. Die Tests assertieren die Zeile
`[lookup] verworfen grund=egress`. Es hat in keinem Test eine Suchanfrage den Prozess
verlassen, und kein Kontingent wurde verbraucht.

---

## 3. REICHWEITE — der eigentliche Wert der Phase  [Spec §3.3 (2)]

> **Frage:** Kann das Denk-Signal in seiner heutigen Bauform (Weg A, Schwelle E3) die vom
> Owner gehoerten Pausen ueberhaupt erreichen?
>
> **Antwort: NEIN.** Es kann sie strukturell nicht erreichen.

Herleitung ausschliesslich am Code:

1. **Wo die Bruecke im Zeitstrahl sitzt.** `thinkingSignal.speakBridge(speech)` wird in
   `agentTurn` aufgerufen **nach** `completeRound` der Runde *i* und **vor**
   `performLookupRequest` sowie vor `completeRound` der Runde *i+1*. Sie ueberbrueckt damit
   genau: die Werkzeug-Ausfuehrung (`LOOKUP_TIMEOUT_MS = 2500`, `src/research/in-call.js`)
   plus die naechste Modellrunde. Sie kann per Konstruktion **die erste Modellrunde des
   Turns nicht ueberbruecken** — ihr Text *ist* das Ergebnis genau dieser Runde.
2. **Was ein werkzeugloser Turn ist.** In 18 von 21 Live-Turns gab es kein `tool_use`. Der
   Code bricht dort bei `if (!toolUses.length) break;` ab: **eine** Modellrunde, deren Text
   die fertige Antwort ist. Die gesamte gemessene Turn-Latenz (0,9–3,0 s) ist die Dauer
   genau dieser einen Runde. Es gibt darin nichts zu ueberbruecken — und der Code erreicht
   `speakBridge` nie. **AL-D2-1 misst genau das am Draht nach.**
3. **Das einzige Mittel, das diese Latenz adressieren koennte, ist ein anderes.** Fuer die
   erste Runde gibt es im Repo genau einen Mechanismus: `streamSinkFor` (AL-P7,
   `src/claude.js`), der den Satz-Chunker armiert und den ersten fertigen Satz sofort auf
   den Draht legt. Er liefert heute in **jeder** Runde `null`, weil
   `tools.every((t) => isSideEffectOnlyTool(t.name))` scheitert, sobald `look_up` im
   Werkzeugsatz liegt — und `lookupAvailableFor` (`src/research/in-call.js`) haengt an
   **keiner** Frische-Bedingung, das Werkzeug liegt also in jedem Turn im Satz (AL-D1,
   `test/al-d1-cause-diagnostics.test.js`, AL-D1-2). AL-D2-1 belegt beides in derselben
   Klasse: `streamArmedRounds === 0` **und** `thinkingSignalSpoken === false`.
4. **Schlussfolgerung.** Das Denk-Signal deckt **ausschliesslich Werkzeug-Wartezeit** ab.
   Werkzeug-Wartezeit kam live in **0 von 21** Turns vor (`get_consult` und `look_up` wurden
   nie gewaehlt — das ist der Gegenstand von D-3). Die Pausen des Owners lagen deshalb
   saemtlich in der ersten Modellrunde — also **dort, wo das Denk-Signal per Bauform nicht
   hinreicht**.

**Ehrliche Grenze dieser Messung:** bewiesen ist "die Bruecke liegt **auf dem Draht** vor
der Antwort" (AL-D2-3, Array-Position in `res.chunks`). Dass Telnyx sie deshalb auch
**frueher spricht**, ist die separat gemessene AL-P2-Eigenschaft (inkrementeller
SSE-Konsum) und nicht Gegenstand dieses Tests.

---

## 4. Konsequenz fuer die Reihenfolge in der Uebergabe  [Spec §3.3 (3)]

Die Begruendung in `tasks/al-handover-2026-08-01.md`, Abschnitt 4, Punkt 1 — *"D-2 zuerst
… die einzige Faehigkeit, die die vom Owner gehoerten Pausen **direkt** adressiert"* — ist
**widerlegt**. Sie adressiert diese Pausen gar nicht.

- Es gibt an D-2 **nichts zu fixen**. Das Denk-Signal verhaelt sich in allen sechs
  gemessenen Klassen exakt wie gebaut.
- Die Phase, die die Owner-Pausen adressiert, ist **D-1** (Armierungsregel in
  `streamSinkFor`) — die einzige Faehigkeit, die in einem **werkzeuglosen** Turn ueberhaupt
  wirken kann.
- **D-3** (Prompt am Tool-Entscheidungspunkt) ist die Vorbedingung dafuer, dass D-2
  jemals einen Anwendungsfall bekommt: solange kein Werkzeug gewaehlt wird, gibt es keine
  Werkzeug-Wartezeit zu ueberbruecken.

Sinnvolle Reihenfolge daraus: **D-1 (Owner-Design-Entscheidung) → D-3 → dann erst
D-2/K4.** Diese Phase entscheidet die Reihenfolge nicht; sie legt dem Owner den Befund vor.

---

## 5. Der K4-Befund: ein eigenstaendiger, heute schon lebender Defekt  [Spec §3.3 (4)]

**Befund.** Ruft das Modell `look_up` **ohne** fuehrenden Text, ist `speech` in dieser Runde
leer. B5 sperrt nicht (`loopContinues` ist `true`, weil `speech` falsy ist), aber B6 sperrt:
`bridgeSpeechFrom("")` liefert `""`. Der Anrufer hoert die volle Suchdauer
(bis `LOOKUP_TIMEOUT_MS = 2500` ms) **plus** die Folgerunde als tote Leitung — **obwohl das
Denk-Signal aktiv ist**. Gemessen in AL-D2-4: `roundtrips === 2`,
`thinkingSignalSpoken === false`, auf dem Draht nur die Antwort.

**Warum das zaehlt.** Dieser Fall ueberlebt jeden D-3-Fix und wird durch ihn sogar **erst
scharf**: D-3 bringt `look_up` ueberhaupt erst zum Feuern.

**Vorschlag (KEIN Fix in dieser Phase).** Die Kopplung gehoert in D-3 an den
Tool-Entscheidungspunkt: die `look_up`-Tool-Description (`lookUpToolDef` in `src/claude.js`,
Text aus `loc.prompt.tools.lookUpDescription`) muss einen kurzen fuehrenden Satz
**verlangen** — enge Verbote am Entscheidungspunkt (Repo-Lehre `call-quality-chain`). Die
Bruecken-Mechanik in `src/thinking-signal.js` soll **nicht** aufgeweicht werden: ein
generischer Ersatzsatz waere wieder Weg B (ersatzlos entfallen) und stuende ausserhalb von
Gespraechssprache und Kontext.

---

## 6. Was offen bleibt und warum  [Spec §3.3 (5)]

- **B2 ist fuer die zwei Live-Anrufe rueckwirkend nicht entscheidbar.** In beiden Anrufen
  steht `"streamChunks":0`, und dieses Feld trennt "kein Kanal" nicht von "Kanal offen,
  nichts gesendet". Entschieden wird es beim **naechsten** Testanruf ueber das neue Feld
  `speechWireOpen` (§8). **Wichtig:** die Reichweite-Aussage in §3 haengt **nicht** an B2 —
  fuer die 18 werkzeuglosen Turns sperrt bereits B3, lange vor B2.
- **Die 3 `take_message`-Turns: B5 oder B6?** Das ist **ohne neue Instrumentierung** aus den
  vorhandenen Render-Logs entscheidbar: `"roundtrips":1` ⇒ B5 sperrte (die Runde hatte
  Text), `"roundtrips":2` ⇒ B6 sperrte (die Runde hatte keinen). Ein Log-Griff, kein Code.
  Diese Phase hat die Live-Logs nicht erneut gezogen; die Zuordnung "B5" in der Tabelle
  von §2 stuetzt sich auf die Spec-Angabe "`take_message` **plus** Text" und auf die
  Reproduktion AL-D2-2.
- **Nicht Gegenstand dieser Phase:** ob Telnyx die frueher geschriebene Bruecke auch
  frueher **spricht** (AL-P2-Eigenschaft), sowie D-5 (STT) und D-6 (Eroeffnung).
- **Nicht dupliziert:** B1 (Flag aus ⇒ keine Bruecke) ist durch `AL-P7b-11`
  (`test/al-p7b-turn-bridge.test.js`) bereits gepinnt; ein weiterer Test waere
  G5-Duplizierung.

---

## 7. Mutationsproben

Beleg, dass die Tests wirklich an der **behaupteten** Bedingung haengen und nicht an etwas
anderem. Ablauf je Probe: mutieren → `node --test test/al-d2-thinking-signal-diagnostics.test.js`
→ rote IDs notieren → `git checkout -- <datei>` bzw. Ruecknahme der Textersetzung. **Der
finale Diff enthaelt keine Mutation** (nachgeprueft: `git diff` zeigt nur die eine
additive Zeile in `src/telnyx-llm-shim.js`; die Suite ist nach der Ruecknahme wieder
vollstaendig gruen).

| # | Behauptete Bedingung | Mutation | Erwartet | **Beobachtet** |
|---|---|---|---|---|
| **M1** | **B5** | `src/claude.js`: `const loopContinues = true;` (statt des Ausdrucks) | AL-D2-2 rot, alle anderen gruen | **exakt so**: nur AL-D2-2 rot (`thinkingSignalSpoken` wurde `true` statt `false`), 7 von 8 gruen. K1 blieb gruen — dort sperrt B3, **vor** `loopContinues`; K3 gruen; K6 gruen (B4 steigt vorher aus) |
| **M2** | **B2** | `src/telnyx-llm-shim.js`: `const wire = makeStreamingResponse(res, model);` (Bedingung entfernt) | AL-D2-5 und AL-D2-8 rot, Rest gruen | **exakt so**: AL-D2-5 + AL-D2-8 rot, 6 von 8 gruen. K1/K2/K4/K6 blieben gruen — sie haengen nicht am Kanal |
| **M3** | **B6** | `src/thinking-signal.js`: `bridgeSpeechFrom` gibt konstant `"X "` zurueck | AL-D2-4 rot; AL-D2-3 als **erwartete Nebenwirkung** rot (anderer Brueckentext); K1/K2 gruen | **exakt so**: AL-D2-3 + AL-D2-4 rot, 6 von 8 gruen. AL-D2-1, AL-D2-2, AL-D2-5, AL-D2-6 blieben gruen |

M1 ist die von der Spec verlangte Pflichtprobe. M2 und M3 schliessen die zwei weiteren
Bedingungen, an denen die Aussagekraft der Phase haengt.

---

## 8. Was diese Phase geaendert hat

**Genau eine additive Zeile Produktivcode** — ein Boolean in der `turn_ok`-Zeile des Shims
(`src/telnyx-llm-shim.js`, im `logShimTurnOk({...})`-Literal des Erfolgspfads):

```js
speechWireOpen: wire !== null,
```

- **Warum:** `streamChunks: 0` allein kann "kein Kanal" nicht von "Kanal offen, aber nichts
  gesendet" trennen. Genau diese Mehrdeutigkeit blieb nach den zwei Live-Anrufen stehen.
  An diesem Kanal haengen **beide** Streaming-Faehigkeiten (D-1 und D-2) — eine Faehigkeit,
  deren Voraussetzung man nicht messen kann, kann man auch nicht abnehmen.
- **Auflagen:** rein additiv · fail-safe (`wire` ist eine `const` im Scope, entweder `null`
  oder das Stream-Objekt — der Ausdruck kann nicht werfen) · PII-frei (ein Boolean, kein
  Text) · **keine** neue Env-Variable · **keine** neue Zahl/Konstante · **keine** Migration ·
  **keine** Dependency · **eine** Schreibstelle · steht unmittelbar **vor** `streamChunks`,
  weil es dessen Voraussetzung ist.
- **Negativ gepinnt:** AL-D2-7 weist nach, dass die Zeile weder den gesprochenen Satz noch
  den Anrufer-Text traegt. AL-D2-8 pinnt den zweiten Disjunkt der `wire`-Bedingung
  (`stream:false` im Body bei eingeschaltetem Flag ⇒ `speechWireOpen:false`).
- `turnDiagnostics` bleibt **unangetastet** — es sieht `wire` nicht, ein drittes Argument
  waere unnoetige Kopplung (F1).

**Sonst nichts.** `git diff master --stat` (ohne die beiden Berichts-Dateien):

```
 src/telnyx-llm-shim.js                        |   7 +
 test/al-d2-thinking-signal-diagnostics.test.js| neu
```

Insbesondere: **keine** Zeile in `src/claude.js`, **keine** Zeile in
`src/thinking-signal.js`, keine Gate-/Offenlegungs-/Auth-/Geldpfad-Datei, kein
`package.json`/`package-lock.json`-Diff, **kein** Bestandstest geaendert.

**Verifikation:** `npm test` gruen (3724 Tests, 0 rot, inkl. AL-D2-1..8);
`npm run test:gates` unveraendert bei der dokumentierten Baseline (3 rot: GAP-05, GAP-15
zweimal); `node --check` gruen fuer `src/telnyx-llm-shim.js` und
`test/al-d2-thinking-signal-diagnostics.test.js`.

---

## Anhang: Notiz fuer den Clean-Code-Audit (S3)

Die Anthropic-Mock-Bausteine (`text`, `toolUse`, `reply`, `jsonMessage`, `sseEvent`,
`writeSse`, `UNWANTED_EXTRA_ROUNDTRIP_MARKER`) sind aus
`test/al-d1-cause-diagnostics.test.js` **wortgleich uebernommen**. Das ist bewusst:
Testfixture-Rohstoff, kein Produktivcode. Eine Extraktion in eine gemeinsame Datei ist
**nicht** Teil dieser Phase (Scope) — `test/helpers.js` scheidet als Ort aus, weil es
praktisch jede Testdatei als allererstes importiert und ein dort gezogener
`config.js`-Import den `test-base-env-drift`-Bug fuer die gesamte Suite reproduzieren
wuerde (s. Kopfkommentar in `test/config-namespaces-helper.js`). Der Umbau bleibt eine
eigene, spaetere Entscheidung.
