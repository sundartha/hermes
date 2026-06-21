# A3 — `bridge.js`: `handleOpenAiEvent` extrahieren (Delta-2)

> Strategie-Dokument (PURE ANALYSE, kein Code, nichts implementiert). Verifiziert
> am Code-Stand von `src/bridge.js`, `src/telephony/registry.js`,
> `src/telephony/media-events.js`, `src/telephony/adapters/twilio/media.js`,
> `src/claude.js` und `src/store.js` am 2026-06-21. Liefert Ziel, Architektur-
> Skizze, Pre-Mortem, phasierten Plan und Test-Strategie. Reihenfolge laut Auftrag:
> ZUERST Charakterisierungs-Test, DANN Extraktion.
>
> Einstufung: NORMAL, aber HEIKLE STELLE (Barge-in, Call-Ende, `disclosureSentence`
> mittelbar betroffen). Realtime-Engine ist derzeit DORMANT (`VOICE_ENGINE=realtime`
> ist nicht der aktive Default) — niedrige Prioritaet, aber die Tests muessen
> reproduzierbar OHNE echte Telefonie und OHNE echtes OpenAI laufen.

---

## 1. Ziel & Akzeptanzkriterien

### Ziel
Der inline in `src/bridge.js` liegende OpenAI-Realtime-Event-Handler — der Callback
in `openaiWs.on("message", (buf) => {...})` innerhalb von `connectOpenAI()` — soll
testbar herausgezogen werden. Heute ist er eine **Closure ohne Unit-Naht**: der
gesamte `switch (ev.type)` haengt an per-Verbindung mutablem State (`call`,
`streamRef`, `openaiWs`, `activeResponse`, `hangupTimer`) und an Helfern aus dem
`wss.on("connection", ...)`-Scope (`log`, `hangup`, `media`, `providerWs`). Genau
das macht ihn unprüfbar und damit gefaehrlich zu aendern — und genau deshalb wird
er gezogen.

### Akzeptanzkriterien (messbar)
1. **Byte-identische Frame-Ausgabe.** Fuer eine fixe Event-Sequenz erzeugt der
   extrahierte Handler exakt dieselben `providerWs.send(...)`- und
   `openaiWs.send(...)`-Argumente (gleiche JSON-Strings, gleiche Reihenfolge) wie
   heute. Das wird durch den Charakterisierungs-Test (Phase 1) festgenagelt, der
   VOR dem Refactoring gegen den heutigen Handler gruen ist und danach unveraendert
   gruen bleibt.
2. **`npm test` gruen** (gesamte `node:test`-Suite, ohne Netz, ohne `.env`).
3. **Handler eigenstaendig testbar.** Nach der Extraktion ist der Handler ohne
   Server-Spawn, ohne `wss.handleUpgrade`, ohne echte WebSockets aufrufbar
   (Fake/Mock-Sockets reichen). Damit faellt die heutige Luecke aus
   `bridge-hardening.test.js` (AC1 war "im gespawnten Server nicht injizierbar")
   weg.
4. **Blast-Radius klein.** Einziger beruehrter Produktionsfile in der
   Extraktionsphase: `src/bridge.js` (plus optional eine neue, vom Handler
   importierte Datei). KEINE Aenderung an `connectOpenAI`s `open`-Handler, an
   `providerWs.on("message")`, an `finalize`/`hangup`-Logik, an den Adaptern oder
   an `claude.js`/`store.js`.
5. **Verhaltens-erhaltend, flag-off byte-identisch.** Da Realtime DORMANT ist, ist
   der Pfad im Normalbetrieb ohnehin nicht aktiv; im aktiven Fall
   (`VOICE_ENGINE=realtime`) muss der Smoke-Test (echter Anruf, Pflicht-Gate fuer
   HEIKLE STELLE) unveraendertes Verhalten zeigen.

### Was NICHT Ziel ist
- Keine funktionale Aenderung am Barge-in, Call-Ende, Tool-Loop oder den
  Transkripten.
- Kein Anfassen des `open`-Handlers (dort lebt die `disclosureSentence`-
  Verdrahtung — siehe Abs. 3.5).
- Keine Erweiterung auf Telnyx-spezifische Frame-Logik (die liegt bereits hinter
  Port 4, `mediaTransport`).

---

## 2. Architektur-Skizze (code-grounded)

### 2.1 Heutige Struktur von `attachMediaBridge` / `connectOpenAI` / Handler

`attachMediaBridge(httpServer, onCallEnded)` baut einen `WebSocketServer({
noServer: true })` und haengt im `upgrade`-Handler den Provider an
(`providerFromMediaPath`). Im `wss.on("connection", (providerWs, _req, provider)
=> {...})`-Callback lebt der **per-Verbindung-Scope**:

- `const media = mediaTransport(provider)` — der Port-4-Adapter (Twilio/Telnyx).
- Mutable State: `let call`, `let streamRef`, `let openaiWs`,
  `let activeResponse = false`, `let endTimer`, `let hangupTimer`, `let closed`.
- Helfer-Closures: `log(...)`, `hangup(reason)`, `finalize(status)`,
  `connectOpenAI()`.

`connectOpenAI()` oeffnet `openaiWs` (auswaerts: `wss://api.openai.com/v1/realtime`)
und registriert drei Listener: `open` (session.update + erster `response.create`
mit dem Opener-Text), `message` (der zu extrahierende Handler), `close`/`error`
(beide rufen `hangup(...)`).

Der **Handler** selbst:

```
openaiWs.on("message", (buf) => {
  let ev;
  try { ev = JSON.parse(buf.toString()); } catch { return; }   // innerer JSON-Guard
  try {                                                          // OT-2: aeusserer Crash-Guard
    switch (ev.type) {
      case "response.audio.delta":
      case "response.output_audio.delta":   ... providerWs.send(media.buildMediaFrame(...))
      case "response.created":              activeResponse = true
      case "input_audio_buffer.speech_started":  // Barge-in (HEIKLE STELLE 1)
      case "conversation.item.input_audio_transcription.completed": store.addTranscript(... "caller" ...)
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":               store.addTranscript(... "agent" ...)
      case "response.done": { activeResponse = false; ... end_call -> setTimeout(hangup, 2500) (HEIKLE STELLE 2) ... }
      case "error":                         console.error(...)
    }
  } catch (e) { console.error("[bridge] openai message handler:", e?.message || String(e)); }
});
```

Die genaue, am Code verifizierte Liste der Abhaengigkeiten des Handlers:

| Abhaengigkeit | Art | gelesen | geschrieben (mutiert) |
|---|---|---|---|
| `ev` (geparstes Event) | Argument | ja | — |
| `streamRef` | per-Verbindung State | ja (Audio-Delta, Barge-in) | nein (wird im Provider-Handler gesetzt) |
| `openaiWs` | per-Verbindung State | ja (`canSend`, `.send`) | nein |
| `providerWs` | per-Verbindung State | ja (`.send`) | nein |
| `activeResponse` | per-Verbindung State | ja (Barge-in-Guard) | **ja** (`response.created` -> true; `response.done` -> false) |
| `hangupTimer` | per-Verbindung State | nein | **ja** (`end_call` -> `setTimeout`) |
| `media` | per-Verbindung (Adapter) | ja (`buildMediaFrame`, `clearPlayback`) | nein |
| `call` | per-Verbindung State | ja (`call.id` fuer `store.addTranscript`) | nein |
| `log` | Closure-Helfer | (heute im Handler nicht direkt genutzt) | — |
| `hangup` | Closure-Helfer | ja (im `setTimeout`-Callback) | — |
| `store` | Modul-Import | ja (`addTranscript`) | — (Seiteneffekt) |
| `execTool` | Modul-Import | ja (Tool-Pfad) | — (Seiteneffekt) |
| `canSend` | bereits exportiert | ja (3 Send-Guards) | — |

**Kernproblem:** `activeResponse` und `hangupTimer` werden im Handler **mutiert**.
Man kann sie deshalb nicht als Wert hereinreichen — der Schreibzugriff muss zum
selben State-Slot zurueckwirken, den der naechste Event-Aufruf liest, und den der
Barge-in-Pfad liest. `hangupTimer` muss ausserdem fuer `finalize()`
(`clearTimeout(hangupTimer)`) sichtbar bleiben.

### 2.2 Optionen fuer die Ziel-Signatur

**Option A — `handleOpenAiEvent(ev, ctx)` mit mutablem `ctx`-State-Objekt.**
Der per-Verbindung-Scope wird in EIN Objekt gebuendelt, das der Handler liest und
in das er zurueckschreibt. Statt loser `let`-Variablen haelt der `connection`-
Scope ein `state`-Objekt (oder reicht `this`-aehnlich ein `ctx`):

```
handleOpenAiEvent(ev, ctx)
// ctx = { providerWs, openaiWs, media, call, streamRef,
//         state /* { activeResponse, hangupTimer } */,
//         hangup, scheduleHangup, store-/exec-Hooks ... }
```

- `activeResponse` wird zu `ctx.state.activeResponse` (Lesen UND Schreiben gehen
  in dasselbe Objekt -> kein Desync).
- `hangupTimer` wird zu `ctx.state.hangupTimer`; `finalize()` liest weiterhin
  `state.hangupTimer` fuer `clearTimeout`.
- **Pro:** kleinster Eingriff in `connectOpenAI` (statt `let activeResponse` ein
  `state.activeResponse`); ein einziges Argument (`ev`) + ein `ctx`-Objekt =
  clean-code-konform (<=3 Argumente, zusammengehoeriges wird ein Objekt, F1/G19).
  Trivial zu testen: Test baut ein `ctx` mit Fake-Sockets und ruft den Handler je
  Event auf.
- **Contra:** `ctx` ist breit (viele Felder); der Aufrufer muss es korrekt
  zusammenbauen. Mitigation: `ctx` wird EINMAL in `connectOpenAI` gebaut, nicht pro
  Event.

**Option B — Handler-Factory `createOpenAiEventHandler({...})`.**
Eine Factory bekommt die Abhaengigkeiten einmal und gibt die `(buf)`- bzw.
`(ev)`-Funktion zurueck, die den State in ihrer eigenen Closure kapselt:

```
const onMessage = createOpenAiEventHandler({ providerWs, getOpenaiWs, media, call, ... });
openaiWs.on("message", onMessage);
```

- **Pro:** Der State (`activeResponse`, `hangupTimer`) lebt sauber in der Closure
  der Factory, der Handler-Body bleibt nah an heute. Sehr testfreundlich (Factory
  einmal mit Fakes aufrufen, dann Events einspeisen).
- **Contra (entscheidend):** `openaiWs` selbst wird in `connectOpenAI` ERST nach
  dem Factory-Aufruf zugewiesen (`openaiWs = new WebSocket(...)` und die Listener
  haengen daran). Wuerde die Factory `openaiWs` als Wert kapseln, waere es zum
  Zeitpunkt des Factory-Aufrufs ggf. noch `null` -> man braucht einen Getter
  (`getOpenaiWs`) oder die Reihenfolge muss umgestellt werden. Ausserdem muss
  `finalize()` an `hangupTimer` herankommen — bei reiner Closure-Kapselung braucht
  es dafuer entweder einen zusaetzlichen Rueckgabewert (z.B. ein Handle mit
  `cancelPendingHangup()`) oder `hangupTimer` bleibt doch im connection-Scope. Das
  erhoeht den Eingriff in `connectOpenAI`/`finalize` und damit den Blast-Radius.

### 2.3 Empfehlung

**Option A: `handleOpenAiEvent(ev, ctx)` mit `ctx` als per-Verbindung State-Holder.**

Begruendung gegen B: Der mutable State ist NICHT rein lokal zum Handler —
`hangupTimer` wird auch von `finalize()` (Cleanup) gelesen und `openaiWs` wird erst
nach dem Listener-Aufbau zugewiesen. Ein gemeinsames `state`/`ctx`-Objekt im
connection-Scope haelt genau eine Quelle der Wahrheit fuer `activeResponse` und
`hangupTimer`, die Handler UND `finalize` teilen — ohne Getter-Indirektion und ohne
die Zuweisungsreihenfolge anzufassen. Das ist der kleinste, am wenigsten
race-anfaellige Eingriff.

Konkrete clean-code-Leitplanken fuer die Umsetzung (NICHT von uns implementiert):
- **`ev`** bleibt erstes Argument, **`ctx`** zweites — zwei Argumente, kein F1-
  Verstoss; alle zusammengehoerenden Werte reisen im `ctx`-Objekt (G19/F1).
- **`2500`** (Call-Ende-Puffer) wird eine benannte Konstante, z.B.
  `END_CALL_HANGUP_DELAY_MS = 2500` auf Modul-Top-Level (G25/G35). Heute ist es
  eine Magic-Number direkt im `setTimeout`.
- **`activeResponse`** lebt in `ctx.state.activeResponse` — an genau einer Stelle
  deklariert, an drei Stellen gelesen/geschrieben (`response.created`,
  `input_audio_buffer.speech_started`, `response.done`), KEINE Kopie.
- **`canSend`** ist bereits exportiert und bleibt der einzige Send-Guard; der
  Handler ruft `canSend(ctx.openaiWs)` exakt an den drei heutigen Call-Sites
  (Barge-in-`cancel`, `function_call_output`, Follow-up-`response.create`).
- **`hangup`** wird als `ctx.hangup` (oder `ctx.scheduleHangup`) hereingereicht,
  damit der `setTimeout`-Callback verhaltens-identisch `hangup("end_call von KI")`
  ruft.
- Verschachtelung: der `response.done`-Case ist heute am tiefsten (switch -> for ->
  if -> if `canSend`); beim Ziehen darf die Tiefe nicht ueber den Richtwert (4)
  steigen — der Tool-Pfad laesst sich in einen kleinen `handleResponseDone(ev,
  ctx)`-Teilschritt zerlegen, aber NUR wenn das Verhalten byte-identisch bleibt.

### 2.4 Wie der mutable `activeResponse`-State sauber gefuehrt wird

`connectOpenAI` (bzw. der connection-Scope) ersetzt die heutigen losen
`let activeResponse`/`let hangupTimer` durch ein gemeinsames `state`-Objekt:

- `response.created` -> `state.activeResponse = true`
- `input_audio_buffer.speech_started` -> liest `state.activeResponse` (Barge-in-
  Guard) und ruft bei `true && canSend(ctx.openaiWs)` zuerst `response.cancel`,
  DANN `clearPlayback` (Reihenfolge unten als Absolute Regel).
- `response.done` -> `state.activeResponse = false`.
- `finalize()` liest weiterhin `state.hangupTimer` fuer `clearTimeout`.

Da Handler und `finalize` dasselbe Objekt referenzieren, gibt es keine Wert-Kopie,
die desynchronisieren koennte (Pre-Mortem 3.4).

---

## 3. Pre-Mortem-Risiken

Annahme: ein Jahr spaeter ist die Extraktion schiefgegangen. Was ist passiert?

### 3.1 Call-Ende kaputt (HEIKLE STELLE 2, `setTimeout(hangup, 2500)`)
**Szenario:** Der 2500ms-Puffer geht verloren oder feuert falsch — die KI sagt
"Auf Wiederhoeren", aber der Anruf wird abgeschnitten (zu frueh) oder haengt fest
(`hangupTimer` nie gesetzt). Geld-/UX-Schaden, ungewolltes Verhalten gegenueber
echten Menschen.
**Gegenmittel:** `2500` als benannte Konstante mit unveraendertem Wert; der
Charakterisierungs-Test prueft den `end_call`-Pfad mit einem **gefakten Timer**
(`node:test` Mock-Timers oder ein injizierbarer `scheduleHangup`-Hook in `ctx`),
sodass das Test ohne 2,5s Wartezeit verifiziert, dass `hangup("end_call von KI")`
GENAU EINMAL und mit dem richtigen Reason geplant wird. `finalize()` muss
`state.hangupTimer` weiterhin clearen.

### 3.2 Barge-in-Race (HEIKLE STELLE 1, Reihenfolge cancel VOR clearPlayback)
**Szenario:** Beim Ziehen wird die Reihenfolge vertauscht oder ein Guard faellt
weg — die KI redet ueber den Anrufer hinweg (Provider puffert weiter), weil
`clearPlayback` vor `cancel` oder gar nicht lief; oder `cancel` feuert auf einen
schliessenden Socket und wirft.
**Gegenmittel:** ABSOLUTE REGEL — Reihenfolge bleibt: (1) `if (activeResponse &&
canSend(openaiWs)) openaiWs.send({type:"response.cancel"})`, DANN (2) `if
(streamRef) providerWs.send(media.clearPlayback({streamRef}))`. Der
Charakterisierungs-Test pinnt die exakte Aufruf-Reihenfolge (eine geordnete Liste
aller `.send`-Calls mit Ziel-Socket) und deckt beide Sub-Faelle ab:
`activeResponse=true`/`canSend=true` (beide Sends) und `canSend=false` (nur
`clearPlayback`, kein `cancel`).

### 3.3 OT-2-Crash-Guards weg (aeusserer try/catch um den switch)
**Szenario:** Beim Ziehen geht der aeussere `try/catch` (OT-2, P3) verloren oder
wandert an die falsche Stelle. Ein Throw aus `store.addTranscript`/`execTool`/
Event-Verarbeitung entkommt zum ws-Emitter -> `uncaughtException` -> EIN
Node-Prozess bedient ALLE Calls -> Prozess-Crash, alle laufenden Anrufe sterben.
**Gegenmittel:** ABSOLUTE REGEL — der aeussere `try/catch` (mit `console.error(
"[bridge] openai message handler:", e?.message || String(e))`) UND der innere
`JSON.parse`-`catch` bleiben erhalten. Entscheidung im Plan festhalten: Wandert der
JSON-Parse mit in den extrahierten Handler (`(buf)`-Signatur) oder bleibt er im
duennen Listener (`(ev)`-Signatur)? Empfehlung: Listener bleibt
`(buf) => { try parse; handleOpenAiEvent(ev, ctx); }` — so bleibt der innere Guard
am Frame-Eingang und der extrahierte Handler bekommt schon das geparste `ev`
(testfreundlich, keine Buffer-Mocks noetig). Der aeussere Crash-Guard kann dann
ENTWEDER im Listener um den `handleOpenAiEvent`-Aufruf liegen (Verhalten exakt
wie heute, da heute ebenfalls der gesamte switch umschlossen ist) — DAS ist
verhaltens-erhaltend und vorzuziehen. Der bestehende Test
`bridge-hardening.test.js` ("malformter Frame erreicht den P0-Backstop nicht")
bleibt als System-Regression bestehen.

### 3.4 `activeResponse`-Desync
**Szenario:** Der Handler bekommt `activeResponse` als Wert kopiert; Schreibzugriff
landet im Kopie-Slot, der naechste Event liest den alten Wert -> Barge-in feuert
nie (`activeResponse` immer false) oder feuert immer.
**Gegenmittel:** Option A — `activeResponse` lebt als Feld in einem geteilten
`ctx.state`-Objekt, kein Wert-Pass. Test: Sequenz `response.created` ->
`speech_started` muss `cancel` ausloesen; Sequenz `response.done` ->
`speech_started` darf KEIN `cancel` ausloesen (Guard auf `activeResponse=false`).

### 3.5 `disclosureSentence`-Verdrahtung beschaedigt
**Szenario:** Beim Ziehen wird versehentlich der `open`-Handler angefasst — der
Offenlegungssatz (Absolute Regel 2, fest verdrahtet als allererster Satz bei
Outbound) verschwindet oder wird optional. Compliance-/rechtliches Risiko.
**Gegenmittel:** Die `disclosureSentence`-Logik lebt AUSSCHLIESSLICH im
`open`-Handler von `connectOpenAI` (`const opener = call.direction === "outbound"
? ... disclosureSentence(call) ... : ...`), NICHT im message-Handler. Diese
Aufgabe fasst den `open`-Handler NICHT an — explizit als Nicht-Ziel (Abs. 1)
deklariert. Der message-Handler hat keinen Bezug zu `disclosureSentence`.

### 3.6 Dormant-Engine-Regression unbemerkt
**Szenario:** Realtime ist DORMANT; ein Bruch faellt nicht auf, weil im Normalbetrieb
nichts den Pfad triggert. Erst beim naechsten realen Realtime-Anruf bricht es.
**Gegenmittel:** Die Charakterisierungs-Tests laufen vollstaendig offline (kein
Server-Spawn noetig, keine echte Telefonie, kein OpenAI) und sind damit immer Teil
von `npm test` — sie schuetzen den dormant Pfad. Zusaetzlich bleibt der manuelle
Real-Call-Smoke das Pflicht-Gate fuer die HEIKLE STELLE vor einem Merge mit
aktivem `VOICE_ENGINE=realtime`.

### 3.7 Tool-Pfad-Seiteneffekt verschoben (`execTool` unter/ueber `canSend`)
**Szenario:** Heute laeuft `execTool` IMMER (Seiteneffekt, z.B. Kalender schreiben),
nur die beiden Sends (`function_call_output` + `response.create`) stehen unter dem
`canSend`-Guard. Beim Umbau koennte `execTool` faelschlich unter den Guard rutschen
-> ein Tool wird im Call-Ende-Race nicht ausgefuehrt.
**Gegenmittel:** ABSOLUTE REGEL — `const result = execTool(call, item.name, args)`
laeuft unbedingt; nur `if (canSend(openaiWs)) { send function_call_output; send
response.create; }`. Der Test fuer den Tool-Pfad assertet beides getrennt:
`execTool` wurde aufgerufen (Spy) UND bei `canSend=false` wurden KEINE Sends
ausgeloest.

---

## 4. Phasenplan

Jede Phase nennt die beruehrten Dateien und ist explizit als parallelisierbar
(ja/nein) markiert. **Phase 1 (Charakterisierungs-Test) ist verbindlich die erste
Phase** — kein Produktionscode-Eingriff davor.

### Phase 1 — Charakterisierungs-Test gegen den HEUTIGEN Handler (Golden Output)
- **Dateien:** neue Testdatei `test/bridge-openai-event.test.js`. KEINE
  Produktionsaenderung.
- **Inhalt:** Integrations-Charakterisierung ueber `attachMediaBridge` mit
  Fake-WebSockets (Detail in Abs. 5). Speist eine fixe OpenAI-Event-Sequenz ein und
  zeichnet ALLE `providerWs.send`/`openaiWs.send`-Aufrufe als geordnete Golden-Liste
  auf. Deckt alle heiklen Pfade ab (Szenarien in Abs. 5).
- **Parallelisierbar: NEIN.** Muss zuerst stehen und gegen den unveraenderten
  Handler gruen sein; er ist das Sicherheitsnetz fuer alle Folgephasen. Innerhalb
  der Phase koennen die einzelnen Szenario-Tests aber parallel von mehreren
  Personen geschrieben werden (gemeinsames Test-Harness zuerst).

### Phase 2 — Minimaler Seam: Handler exportieren, `state`-Objekt einfuehren
- **Dateien:** `src/bridge.js` (einziger Produktionsfile).
- **Inhalt:** `let activeResponse`/`let hangupTimer` werden zu einem gemeinsamen
  `state`-Objekt im connection-Scope; `2500` wird benannte Konstante; der
  message-Handler ruft `handleOpenAiEvent(ev, ctx)` (neue, im selben File
  definierte und exportierte Funktion). `connectOpenAI` baut `ctx` einmal. Innerer
  JSON-Guard + aeusserer Crash-Guard bleiben (Abs. 3.3). Verhalten byte-identisch.
- **Parallelisierbar: NEIN** (haengt strikt an Phase 1 als Gruen-Gate; aendert
  denselben File-Bereich, den Folgephasen lesen).
- **Begruendung:** Der Golden-Test aus Phase 1 muss danach UNVERAENDERT gruen sein.
  Dieser kleine Schritt schafft die Naht, ohne den Body umzuschreiben.

### Phase 3 — Echte Unit-Tests gegen den exportierten Handler
- **Dateien:** `test/bridge-openai-event.test.js` (erweitern) oder neue
  `test/openai-event-handler.test.js`.
- **Inhalt:** Dieselben Szenarien wie Phase 1, aber jetzt OHNE
  `attachMediaBridge`/`upgrade` — direkter Aufruf `handleOpenAiEvent(ev, ctx)` mit
  einem handgebauten `ctx` (Fake-Sockets, Spy auf `store.addTranscript`/`execTool`,
  Fake-Timer/`scheduleHangup`). Schliesst die AC1-Luecke aus
  `bridge-hardening.test.js`.
- **Parallelisierbar: JA** gegenueber Phase 4 (beide haengen nur an Phase 2; die
  Unit-Tests aendern keinen Produktionscode, die Detail-Decomposition in Phase 4
  betrifft nur die innere Struktur des Handlers — solange der Golden-Test aus
  Phase 1 weiter gruen ist).

### Phase 4 — (OPTIONAL) innere Decomposition des `response.done`-Cases
- **Dateien:** `src/bridge.js`.
- **Inhalt:** Den tiefsten Case (`response.done` -> for -> if -> if `canSend`) in
  einen kleinen Teilschritt (`handleResponseDone(ev, ctx)` / `handleToolCall(...)`)
  zerlegen, um Verschachtelung zu senken (Richtwert 4). NUR wenn byte-identisch.
- **Parallelisierbar: JA** gegenueber Phase 3 — beide bauen auf der Phase-2-Naht
  auf, beruehren aber unterschiedliche Artefakte (Phase 3 Tests, Phase 4
  Produktion). Wenn beide gleichzeitig laufen, dient der Phase-1-Golden-Test als
  gemeinsames Gruen-Gate.
- **Begruendung:** Bewusst letzte, OPTIONALE Phase (S4-Prioritaet: Anzahl
  Methoden). Sie ist nur Lesbarkeit; bricht das Risiko nichts ab, kann sie
  entfallen. (Vorrang Lesbarkeit aus clean-code: nicht zerlegen, wenn es unklarer
  wird.)

---

## 5. Test-Strategie (Charakterisierungs-Test ZUERST)

### 5.1 Henne-Ei-Problem benennen
`bridge.js` hat heute KEINEN Unit-Seam fuer den OpenAI-Handler: alles ist Closure
ueber connection-Scope-State, `openaiWs` waehlt auswaerts (`wss://api.openai.com`).
Genau das stellt `bridge-hardening.test.js` fest: AC1 ist "im gespawnten Server
nicht injizierbar" und bewusst nach der Decomposition verschoben. Folge: Bevor man
sicher refactored, braucht man einen Test, der OHNE Seam an die Frame-Ausgabe
herankommt. Das geht ueber `attachMediaBridge` mit Fake-Sockets.

### 5.2 Option (a): Integrations-Charakterisierung via `attachMediaBridge`
**Idee:** `attachMediaBridge(httpServer, onCallEnded)` mit einem Fake-`httpServer`
(EventEmitter, der `upgrade` und `connection` faehig ist) aufrufen, dann
`wss.emit("connection", fakeProviderWs, fakeReq, PROVIDER.TWILIO)`. Der
`providerWs.on("message")`-Pfad spielt den `start`-Frame ein (gueltige `call_id` +
`stream_token` -> `store.getCall`/`safeEqual`/`markAnswered` mit einem
vorbereiteten Store-Call), wodurch `connectOpenAI()` laeuft. Der echte `openaiWs`
darf NICHT nach aussen w_aehlen — deshalb wird `WebSocket` so gestubbt/gemockt, dass
`new WebSocket(...)` einen Fake liefert, dessen `open` man manuell feuert und in
den man `message`-Events einspeist. Alle `fakeProviderWs.send`- und
`fakeOpenaiWs.send`-Aufrufe werden als geordnete Liste aufgezeichnet (Golden
Output). `canSend` haengt nur an `readyState === WebSocket.OPEN` — der Fake setzt
`readyState` passend.

**Hinweis Realitaet:** Da `connectOpenAI` `new WebSocket(...)` direkt erzeugt, ist
diese Variante ohne Naht etwas sperrig (WebSocket-Konstruktor mocken). Sie ist als
Brueckentest brauchbar, aber Option (b) ist der saubere Zielzustand.

### 5.3 Option (b): minimaler Seam-Schritt, sofort durch denselben Golden-Test gedeckt
**Idee:** In Phase 2 wird der Handler exportiert (`handleOpenAiEvent(ev, ctx)`).
Der Golden-Test aus Phase 1 (egal ob via 5.2 geschrieben oder direkt als
Handler-Aufruf vorbereitet) bleibt UNVERAENDERT gruen — er ist die
Charakterisierung. Danach koennen die Szenarien in Phase 3 direkt gegen
`handleOpenAiEvent(ev, ctx)` laufen: `ctx` baut man mit zwei Fake-Sockets
(`{ readyState, send: spy }`), einem Fake-`media` (oder dem echten `twilioMedia` —
rein, offline), einem `state`-Objekt, Spies auf `store.addTranscript`/`execTool`
und einem Fake-`hangup`/`scheduleHangup`. Kein Server-Spawn, kein Netz.

**Empfehlung:** Phase 1 schreibt den Golden-Test bevorzugt schon so, dass er den
Handler-Aufruf charakterisiert (5.3-Form), notfalls ueber 5.2 als Integrations-
Bruecke. Wichtig ist die Invariante: derselbe Test ist VOR und NACH der Extraktion
gruen.

### 5.4 Test-Szenarien (decken die heiklen Pfade ab)
Alle mit `node:test` + `node:assert/strict`, offline, kein echtes OpenAI/Telefonie.

1. **Audio-Delta-Durchreichung, BEIDE Schema-Varianten.**
   `{type:"response.audio.delta", delta:"AAA"}` und
   `{type:"response.output_audio.delta", delta:"AAA"}` (beta + GA) ->
   `providerWs.send(JSON.stringify(media.buildMediaFrame({payload:"AAA",
   streamRef})))`. Edge: ohne `streamRef` oder ohne `delta` -> KEIN Send.
2. **Barge-in, Reihenfolge.** `response.created` (-> `activeResponse=true`), dann
   `input_audio_buffer.speech_started`: assertet geordnet erst
   `openaiWs.send({type:"response.cancel"})`, DANN
   `providerWs.send(clearPlayback)`. Sub-Fall `activeResponse=false` -> KEIN
   `cancel`. Sub-Fall `canSend(openaiWs)=false` (Socket nicht OPEN) -> KEIN
   `cancel`, aber `clearPlayback` (Guard nur auf `streamRef`).
3. **Transkript caller.** `conversation.item.input_audio_transcription.completed`
   mit `transcript:" hallo "` -> `store.addTranscript(call.id, "caller",
   "hallo")` (getrimmt; leer/whitespace -> kein Aufruf).
4. **Transkript agent, beide Varianten.** `response.audio_transcript.done` und
   `response.output_audio_transcript.done` -> `store.addTranscript(call.id,
   "agent", ...)`.
5. **Tool-Call-Pfad.** `response.done` mit einem `output`-Item
   `{type:"function_call", name:"get_calendar", arguments:"{}", call_id:"x"}`:
   assertet `execTool(call, "get_calendar", {})` wurde aufgerufen UND (bei
   `canSend=true`) zwei Sends: `conversation.item.create` mit
   `function_call_output` (`call_id:"x"`, `output:String(result)`) DANN
   `response.create`. Sub-Fall `canSend=false`: `execTool` lief, aber KEINE Sends.
   Edge: kaputtes `arguments` (kein JSON) -> `args={}`, kein Throw.
6. **end_call-Pfad (2500ms hangupTimer).** `response.done` mit Item
   `{type:"function_call", name:"end_call", ...}`: mit Fake-Timern assertet, dass
   `hangup("end_call von KI")` GENAU EINMAL nach `END_CALL_HANGUP_DELAY_MS` geplant
   wird; KEIN `execTool` und KEINE Tool-Sends fuer `end_call`.
   `state.activeResponse` ist nach `response.done` `false`.
7. **error-Case.** `{type:"error", error:{message:"x"}}` -> `console.error(
   "[bridge] OpenAI error:", "x")`, kein Throw, keine Sends.
8. **Geschlossener Socket (`canSend=false`) generell.** Bei nicht-OPEN `openaiWs`:
   Barge-in-`cancel` und Tool-Sends unterbleiben; Seiteneffekte (`execTool`,
   `addTranscript`) und `clearPlayback`/Audio-Delta-Sends an `providerWs` laufen
   wie spezifiziert.
9. **Crash-Guard (Symmetrie zu `bridge-hardening.test.js`).** Ein Event, bei dem
   `store.addTranscript` wirft (Spy wirft), darf NICHT aus `handleOpenAiEvent`
   herausfliegen — `console.error("[bridge] openai message handler:", ...)`, kein
   Re-Throw. Der innere JSON-Guard bleibt auf der Listener-Ebene (Test fuer
   Nicht-JSON-Buffer bleibt System-Ebene).

### 5.5 F.I.R.S.T.-Konformitaet
- **Fast/Repeatable:** kein Netz, kein Server-Spawn (Phase 3), kein echtes OpenAI.
  Timer ueber Fake/Mock (kein realer 2,5s-`sleep` — siehe Pre-Mortem 3.1).
- **Independent:** jedes Szenario baut sein eigenes `ctx`/`state`; kein geteilter
  veraenderlicher Modul-State zwischen Tests.
- **Self-validating:** jede Assertion auf konkrete `.send`-Argumente bzw. Spy-Calls
  (Build-Operate-Check, P13: `ctx`+`state` bauen -> Event einspeisen -> Sends
  pruefen).
- **Ein Konzept pro Test (P14):** Delta, Barge-in, Transkripte, Tool, end_call,
  error, closed-Socket, Crash-Guard je eigener Test.

---

## 6. Absolute Regeln (unantastbar bei der spaeteren Umsetzung)

1. Barge-in-Reihenfolge exakt: `response.cancel` (unter `activeResponse &&
   canSend`) VOR `clearPlayback` (unter `streamRef`).
2. Call-Ende-Puffer 2500ms erhalten (als benannte Konstante, gleicher Wert);
   `finalize()` cleart den Timer weiterhin.
3. `disclosureSentence`-Verdrahtung im `open`-Handler NICHT beruehren.
4. OT-2-Crash-Guards erhalten: aeusserer `try/catch` um den switch-Body UND innerer
   `JSON.parse`-`catch`.
5. Keine Side-Effects veraendern: `execTool` laeuft IMMER; nur die Sends stehen
   unter `canSend`.
6. `canSend`-Guards exakt an den drei heutigen Call-Sites erhalten.
7. Verhaltens-erhaltend, flag-off byte-identisch; Realtime ist DORMANT (niedrige
   Prioritaet), aber die Tests laufen reproduzierbar offline.
