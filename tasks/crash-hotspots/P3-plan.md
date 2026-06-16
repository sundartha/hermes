# P3 — Realtime-Audio-Haertung (OT-2)

## Orchestrierung (Parallelisierung)

| Feld | Wert |
|---|---|
| Phase | P3 — Realtime-Audio-Haertung (OT-2) |
| Prerequisite | **P0 merged to master** (der globale Guard ist der Backstop; die quellseitigen Guards hier sind der eigentliche Fix) |
| Parallel-safe mit | **P1, P2** (DISJUNKTE Files — `bridge.js` + `telephony/adapters/twilio/media.js`, KEIN `server.js` → sauberste Parallelisierung der ganzen Reihe) |
| Conflict-Files | keine (kein `server.js`) |
| Empfohlener Branch | `feat/crash-p3-audio-hardening` |
| Severity | **Critical** |
| Verifikation gesamt | `npm test` gruen (neue Unit-Tests offline) + **manueller Real-Call-Smoke-Test** (HEIKLE STELLE, nicht testbar) |

> **Warum P0 zwingend zuerst:** Falls hier wider Erwarten ein Pfad ungeguarded bleibt, faengt der P0-`uncaughtException`-Handler den Prozess-Tod ab. P3 macht aus "Backstop faengt es spaet" ein "der Throw entsteht gar nicht erst" — quellseitig, im Audio-Hot-Path. Beides zusammen ist Defense-in-Depth.

> **WICHTIG — HEIKLE STELLE (CLAUDE.md):** `bridge.js` enthaelt zwei mit `HEIKLE STELLE` markierte Abschnitte: Barge-in (`bridge.js:136-143`) und Call-Ende (`hangup`/`finalize`, `bridge.js:67-89`). Die hier spezifizierten Edits sind **rein additiv und verhaltens-erhaltend**: ein aeusserer `try/catch` und `readyState`-Vorbedingungen aendern den Happy-Path NICHT — sie verhindern nur, dass ein Throw aus dem Handler entkommt bzw. ein `send` auf einen bereits schliessenden Socket geht. Keine Logik-Umstellung, keine geaenderte Reihenfolge, keine neuen Timer.

---

## Korrektur Pfad-Angabe (vor Beginn lesen)

Die ursspruengliche Aufgabenstellung nennt `src/adapters/twilio/media.js`. Dieser Pfad existiert **nicht**. Der reale Pfad ist:

```
src/telephony/adapters/twilio/media.js
```

Der Twilio-Adapter wird von `bridge.js` ueber die Registry geladen (`mediaTransport(provider)` aus `src/telephony/registry.js:36`), nicht per Direktimport. Der Telnyx-Pendant (`src/telephony/adapters/telnyx/media.js`) ist der bereits gehaertete Referenz-Adapter (nutzt durchgaengig `?.`).

---

## Problem

`VOICE_ENGINE=realtime` bruckt Twilio/Telnyx-Media-Streams gegen die OpenAI-Realtime-API (`bridge.js`). Drei Crash-Klassen im Audio-Hot-Path, alle Critical, alle koennen den **ganzen Prozess** killen (ein Node-Prozess bedient ALLE gleichzeitigen Calls):

**Teil A — WS-`message`-Handler ohne aeusseres try/catch.** Beide Handler fangen nur den `JSON.parse` ab, nicht den `switch`-Body danach:
- `bridge.js:119` (OpenAI-Seite): der `switch` (123-180) ruft `store.addTranscript`, `execTool`, `media.buildMediaFrame` u.a. Ein Throw aus `execTool` (z.B. `book_appointment` → `new Date(input.start)` / `store.*`) oder ein unerwartetes Event entkommt zum `ws`-Emitter → unhandled → Prozess-Crash.
- `bridge.js:193` (Provider-Seite): der `switch` (198-231) ruft `media.parseMediaFrame`, `store.getCall`, `store.markAnswered`, `connectOpenAI`. Throw entkommt zum Emitter → Crash.

**Teil B — `openaiWs.send(...)` ohne `readyState`-Guard.** Drei Sends feuern genau waehrend der HEIKLE-STELLE-Races (Barge-in, Call-Ende), wenn der Socket schon schliessen kann. `send` auf einen CLOSING/CLOSED-Socket wirft:
- `bridge.js:141` — Barge-in `response.cancel` (HEIKLE STELLE 1).
- `bridge.js:167` — Tool-Result `function_call_output`.
- `bridge.js:171` — Follow-up `response.create`.

Der Inbound-Audio-Pfad (`bridge.js:225`) macht es bereits richtig: `if (openaiWs?.readyState === WebSocket.OPEN)`. Genau dieses Muster fehlt an den drei Stellen.

**Teil C — Twilio-Adapter dereft `msg.start` ohne `?.`.** `twilio/media.js:14-15`: `msg.start.streamSid` und `msg.start.customParameters?.call_id` greifen auf `msg.start` ohne Optional-Chaining zu. Ein malformter `start`-Frame ohne `.start`-Objekt → `TypeError: Cannot read properties of undefined` → entkommt (mangels Teil A) zum Emitter → Crash. Der Telnyx-Adapter (`telnyx/media.js:16,19-22`) nutzt durchgaengig `msg.start?.` — das ist das Zielmuster.

---

## Soll-Zustand (Akzeptanzkriterien)

**AC1.** Der OpenAI-WS-`message`-Handler (`bridge.js:119`) hat einen aeusseren `try/catch` um den gesamten `switch`-Body. Ein Throw aus `store`/`execTool`/Event-Verarbeitung wird gefangen, **secret-frei** geloggt (`[bridge] message handler:` + `e.message`), und entkommt NICHT zum Emitter. Der Call degradiert (ein verlorenes Event), der Prozess ueberlebt.

**AC2.** Der Provider-WS-`message`-Handler (`bridge.js:193`) hat denselben aeusseren `try/catch` um seinen `switch`-Body. Gleiche Log-/Degrade-/Survive-Semantik.

**AC3.** `openaiWs.send(...)` an `bridge.js:141`, `:167`, `:171` feuert nur, wenn `openaiWs?.readyState === WebSocket.OPEN`. Das spiegelt exakt den Guard von `bridge.js:225`. Bei nicht-OPEN-Socket wird der Send still uebersprungen (kein Throw) — das ist korrekt, weil der Socket dann ohnehin gerade stirbt.

**AC4.** `twilio/media.js` dereft `msg.start` nur via `?.` (`msg.start?.streamSid`, `msg.start?.customParameters?.call_id`, `msg.start?.callSid`). Ein `start`-Frame ohne `.start`-Objekt liefert ein wohlgeformtes neutrales Frame mit `undefined`-Feldern statt zu werfen. Verhalten fuer **wohlgeformte** Frames bleibt byte-identisch (Charakterisierungs-Test pinnt das).

**AC5.** Happy-Path verhaltens-erhaltend: bestehende Tests (`media-transport.test.js`, `media-token.test.js`) bleiben gruen. Kein geaendertes Frame-Format, keine geaenderte Barge-in-/Call-Ende-Reihenfolge, keine neuen/verschobenen Timer.

**AC6.** Neue Unit-Tests decken AC1-AC4 offline ab (s.u.). Da Live-Audio/Barge-in nicht automatisiert testbar ist, ist zusaetzlich der **manuelle Real-Call-Smoke-Test** (s.u.) Pflicht-Bestandteil der Abnahme.

---

## Lokalisierung (verifiziert 2026-06-16, Zeilen am Ist-Stand zitiert)

| Datei | Stelle | Aenderung |
|---|---|---|
| `src/bridge.js` | 119-181 | aeusserer `try/catch` um den OpenAI-`message`-`switch`-Body (AC1) |
| `src/bridge.js` | 193-232 | aeusserer `try/catch` um den Provider-`message`-`switch`-Body (AC2) |
| `src/bridge.js` | 141 | `readyState`-Guard vor Barge-in-`response.cancel` (AC3) |
| `src/bridge.js` | 167-171 | `readyState`-Guard vor Tool-Result + Follow-up-`response.create` (AC3) |
| `src/telephony/adapters/twilio/media.js` | 13-17 | `msg.start` → `msg.start?.` (AC4) |
| `test/media-transport.test.js` | Ende | T-P3-04 anfuegen (malformter Twilio-`start`-Frame) |
| `test/bridge-hardening.test.js` | **NEU** | T-P3-01..03, 05 (Handler-/send-Guard-Unit-Tests, offline) |

### Teil C — `twilio/media.js` Vorher/Nachher (verifiziert :13-17)

```js
// Vorher (Zeile 13-17)
    case "start":
      return {
        event: MEDIA_EVENT.START,
        streamRef: msg.start.streamSid,                       // <-- wirft, wenn msg.start fehlt
        callId: msg.start.customParameters?.call_id,          // <-- dito (msg.start ohne ?.)
        streamToken: msg.start.customParameters?.stream_token || "",
        providerCallRef: msg.start.callSid,
      };

// Nachher (spiegelt telnyx/media.js:16-22)
    case "start":
      return {
        event: MEDIA_EVENT.START,
        streamRef: msg.start?.streamSid,
        callId: msg.start?.customParameters?.call_id,
        streamToken: msg.start?.customParameters?.stream_token || "",
        providerCallRef: msg.start?.callSid,
      };
```

> Minimaler Eingriff: nur `?.` auf `msg.start` ergaenzen. `.customParameters?.` trug das `?.` schon — die Luecke ist ausschliesslich der `msg.start`-Deref. Fuer wohlgeformte Frames identisches Ergebnis.

### Teil B — `bridge.js` send-Guards (verifiziert :141, :167, :171; Referenz :225)

```js
// :141 Vorher
            if (activeResponse) openaiWs.send(JSON.stringify({ type: "response.cancel" }));
// :141 Nachher
            if (activeResponse && openaiWs?.readyState === WebSocket.OPEN)
              openaiWs.send(JSON.stringify({ type: "response.cancel" }));

// :167-171 Vorher
                const result = execTool(call, item.name, args);
                openaiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: { type: "function_call_output", call_id: item.call_id, output: String(result) },
                }));
                openaiWs.send(JSON.stringify({ type: "response.create" }));
// :167-171 Nachher
                const result = execTool(call, item.name, args);
                if (openaiWs?.readyState === WebSocket.OPEN) {
                  openaiWs.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: { type: "function_call_output", call_id: item.call_id, output: String(result) },
                  }));
                  openaiWs.send(JSON.stringify({ type: "response.create" }));
                }
```

> Referenz `bridge.js:225` (Inbound-Audio, bereits korrekt): `if (openaiWs?.readyState === WebSocket.OPEN) openaiWs.send(...)`. Die `WebSocket`-Konstante ist in `bridge.js:5` importiert — kein neuer Import noetig.

### Teil A — `bridge.js` aeussere Handler-try/catch (verifiziert :119-181, :193-232)

```js
// OpenAI-Handler (:119) — Struktur Nachher (Body unveraendert, nur umschlossen)
      openaiWs.on("message", (buf) => {
        let ev;
        try { ev = JSON.parse(buf.toString()); } catch { return; }   // inner-catch BLEIBT
        try {
          switch (ev.type) {
            /* ... 123-180 komplett unveraendert ... */
          }
        } catch (e) {
          // OT-2: kein Throw aus dem Handler darf zum ws-Emitter entkommen (Prozess-Crash).
          // Secret-frei: nur e.message. Call degradiert (ein Event verloren), Prozess lebt.
          console.error("[bridge] openai message handler:", e?.message || String(e));
        }
      });

// Provider-Handler (:193) — analog
      providerWs.on("message", (buf) => {
        let raw;
        try { raw = JSON.parse(buf.toString()); } catch { return; }  // inner-catch BLEIBT
        try {
          const frame = media.parseMediaFrame(raw);
          switch (frame.event) {
            /* ... 198-231 komplett unveraendert ... */
          }
        } catch (e) {
          console.error("[bridge] provider message handler:", e?.message || String(e));
        }
      });
```

> **Verhaltens-Erhaltung kritisch:** Der bestehende innere `JSON.parse`-`catch` mit `return` bleibt UNVERAENDERT — er filtert Nicht-JSON-Frames wie bisher (kein Log-Spam). Der neue aeussere `try` umschliesst NUR den `switch`. `return providerWs.close()` innerhalb des `switch` (z.B. `:202`, `:211`) funktioniert weiter (verlaesst den Handler regulaer, loest keinen catch aus). Keine Zeile im `switch`-Body wird umgeschrieben.

---

## Test-Cases (Given / When / Then)

Muster aus `test/media-transport.test.js` (reine Adapter-Unit-Tests, offline, kein Server-Spawn) und `test/media-token.test.js` (WS gegen gespawnten Server). Die neuen Handler-/send-Guard-Tests laufen **offline ohne echten Socket** — `openaiWs` wird durch ein Fake mit steuerbarem `readyState` + zaehlbarem `send` ersetzt. Wo die Handler-Logik nicht ohne groesseren Seam isolierbar ist, wird die invariante Eigenschaft getestet (s. Hinweis unten).

### T-P3-01: malformter Twilio-`start`-Frame -> kein Throw, wohlgeformtes Frame

**Given:** `twilioMedia.parseMediaFrame({ event: "start" })` (KEIN `.start`-Objekt)

**When:** aufgerufen

**Then:** kein Throw; Rueckgabe `{ event: "start", streamRef: undefined, callId: undefined, streamToken: "", providerCallRef: undefined }`

*(Datei: `test/media-transport.test.js` anfuegen. Spiegelt den bestehenden Telnyx-`dynamic_variables`-Test, der `providerCallRef: undefined` bereits asserted.)*

### T-P3-02: wohlgeformter Twilio-`start`-Frame -> byte-identisch (Regression)

**Given:** der bestehende `start`-Frame aus `media-transport.test.js:18-30`

**When:** nach dem `?.`-Edit erneut geparst

**Then:** identisches Ergebnis wie heute (`streamRef: "MZ1"`, `callId: "c1"`, `streamToken: "t1"`, `providerCallRef: "CA1"`)

*(Bestehender Test deckt das ab — er MUSS nach dem Edit gruen bleiben. Kein neuer Test noetig, hier nur als Abnahme-Gate gelistet.)*

### T-P3-03: send-Guard ueberspringt Send auf nicht-OPEN-Socket

**Given:** ein Fake-WS `{ readyState: 2 /* CLOSING */, send: spy }` und die Guard-Bedingung `fake?.readyState === WebSocket.OPEN`

**When:** die Guard-Bedingung ausgewertet (extrahierte reine Vorbedingung `canSend(ws)` oder Inline-Assert im Test)

**Then:** `false` → `send`-Spy NICHT aufgerufen. Mit `{ readyState: 1 /* OPEN */ }` → `true` → Send erlaubt.

*(Hinweis Test-Seam: Damit die `readyState`-Vorbedingung ohne echten Socket pruefbar ist, wird sie als winzige reine Helper-Funktion `export function canSend(ws) { return ws?.readyState === WebSocket.OPEN; }` in `bridge.js` exportiert; die drei Call-Sites :141/:167/:171 nutzen `canSend(openaiWs)`, der Inbound-Pfad :225 wird zur Konsistenz ebenfalls darauf umgestellt. Das vermeidet sowohl Magic-Number `1` als auch einen schwer testbaren Inline-Ausdruck. Alternative ohne Export: Test gegen `WebSocket.OPEN === 1` als dokumentierte Konstanten-Invariante — schwaecher, daher Helper bevorzugt.)*

### T-P3-04: OpenAI-Handler mit werfendem `execTool` -> gefangen, Prozess ueberlebt

**Given:** ein `response.done`-Event mit `function_call`, dessen `execTool` wirft (Fake/Stub, der throwt)

**When:** der OpenAI-`message`-Handler dieses Event verarbeitet

**Then:** kein Throw entkommt; `console.error` mit `[bridge] openai message handler` aufgerufen; der Test-Prozess laeuft weiter.

*(Hinweis Test-Seam: Der `message`-Handler ist heute eine Closure in `attachMediaBridge` ohne Export — nicht direkt isolierbar. Zwei zulaessige Wege, in Praeferenz-Reihenfolge:*
*(a) **Bevorzugt, minimal-invasiv:** Den `switch`-Rumpf in eine benannte, exportierte reine-genug Funktion `handleOpenAiEvent(ev, ctx)` ziehen (`ctx` = `{ call, streamRef, providerWs, openaiWs, media, setActiveResponse, scheduleHangup, ... }`); der Handler wird zu `try { handleOpenAiEvent(ev, ctx); } catch (e) { console.error(...) }`. Dann ist der werfende-`execTool`-Fall direkt unit-testbar. ACHTUNG: Das ist ein groesserer Eingriff in eine HEIKLE STELLE — nur durchfuehren, wenn der Extract strikt verhaltens-erhaltend bleibt (Charakterisierungs-Test der Frame-Ausgabe VOR dem Extract schreiben).*
*(b) **Fallback, kleiner:** Den try/catch ohne Extract einbauen (AC1/AC2) und T-P3-04 als WS-Integrationstest gegen den gespawnten Server fahren (Muster `media-token.test.js`): ein praepariertes Event ueber den echten Socket schicken und assert, dass der Server-Prozess danach noch antwortet. Schwerer praezise zu treffen, aber kein Refactor der HEIKLEN STELLE.*
*→ **Entscheidung Jonas/Reviewer:** (a) liefert echte Unit-Coverage zum Preis eines Extracts in der HEIKLEN STELLE; (b) haelt den Eingriff minimal. Default-Empfehlung: **(b)** fuer diese Phase — minimal-invasiv hat in `bridge.js` Vorrang; den Extract (a) separat in P4 (Decomposition) ziehen, wo Charakterisierungs-Tests ohnehin Thema sind.)*

### T-P3-05: Provider-Handler mit werfendem `store.getCall` -> gefangen

**Given:** ein `start`-Frame, dessen `store.getCall` wirft (Stub)

**When:** der Provider-`message`-Handler verarbeitet das Frame

**Then:** kein Throw entkommt; `console.error` mit `[bridge] provider message handler`; Prozess lebt.

*(Gleiche Seam-Entscheidung wie T-P3-04 — bei Weg (b) als Integrationstest.)*

---

## Manueller Smoke-Test (PFLICHT — HEIKLE STELLE, nicht automatisierbar)

Live-Audio, Barge-in-Timing und Socket-Race-Conditions sind durch `node:test` **nicht** abgedeckt. Die folgende Checkliste ist Pflicht-Bestandteil der Abnahme und MUSS gegen einen echten Call (Render-Deploy oder lokal mit echten Twilio-Credentials, `VOICE_ENGINE=realtime`) durchgefuehrt werden. Kosten beachten (echte Telefonie).

Vorbereitung: Server-Log live mitlesen (`[bridge]`-Zeilen). Es darf in KEINEM Szenario ein `[guard] uncaughtException` (P0-Backstop) erscheinen — taucht es auf, ist ein Pfad ungeguarded geblieben.

1. **Barge-in mitten im Satz.** Anruf annehmen lassen, KI sprechen lassen, **waehrend** die KI redet dazwischenreden.
   - Erwartet: KI stoppt sofort (Barge-in), keine Doppel-Stimme, Gespraech laeuft weiter. Kein Crash, kein `uncaughtException`.

2. **`end_call`-Verabschiedung.** Gespraech so fuehren, dass die KI `end_call` ausloest (Ziel erreicht).
   - Erwartet: KI spricht den Abschiedssatz vollstaendig (2,5s-Puffer, `bridge.js:164`), DANN legt der Call auf. Kein abgeschnittener Satz, kein Crash.

3. **Anrufer legt waehrend KI-Sprache auf.** Waehrend die KI spricht, von der Gegenseite auflegen.
   - Erwartet: Server raeumt sauber ab (`finalize`), Call-Record wird `completed`, keine spaeten `send`-Fehler im Log (genau das, was der `readyState`-Guard verhindert). Kein Crash.

4. **Tool-Aufruf waehrend des Gespraechs.** Termin buchen / Nachricht hinterlassen lassen (loest `execTool` + Tool-Result-`send` aus, `bridge.js:166-171`).
   - Erwartet: Tool-Ergebnis fliesst zurueck, KI antwortet darauf. Kein Crash bei normalem Verlauf; bei einem unmittelbar danach auflegenden Anrufer kein `send`-Fehler.

5. **Normaler Inbound + normaler Outbound (Regression).** Je ein vollstaendiges, unauffaelliges Gespraech beide Richtungen.
   - Erwartet: Offenlegungssatz bei Outbound als allererster Satz (Rule 2), Transkripte landen im Call-Record, Audio sauber. Keine Verhaltensaenderung gegenueber vor P3.

---

## Verifikation

```
node --check src/bridge.js
node --check src/telephony/adapters/twilio/media.js
npm test                              # alle Tests gruen (Bestand + neue offline-Tests)

# gezielt die Audio-/Adapter-Tests:
node --test test/media-transport.test.js test/media-token.test.js test/bridge-hardening.test.js
```

Erwartetes Ergebnis: 0 Failures. Bestehende Charakterisierungs-Tests (Frame byte-identisch) unveraendert gruen — beweist Verhaltens-Erhaltung. Danach **manueller Smoke-Test** (oben) als zweites, nicht verhandelbares Gate.

---

## Risiken / Pre-Mortem (1 Jahr in der Zukunft, P3 war falsch)

- **Ein Guard schluckt einen noetigen Fehler still.** Der aeussere `try/catch` koennte einen Throw fangen, der eigentlich auf einen echten Bug hinweist, und ihn als harmlose "ein Event verloren"-Degradierung tarnen. Mitigation: **lautes, eindeutiges `[bridge] ... message handler:`-Logging** (kein leeres `catch {}` — das ist das aus der Analyse benannte OT-4-Anti-Pattern). Bei wiederkehrenden Handler-Logs im Betrieb ist das ein Bug-Signal, kein Rauschen. NIE den catch-Body leer lassen.

- **Der try/catch aendert das Barge-in-Timing.** Ein `try` ist in V8 praktisch latenzfrei, aber falls der Extract-Weg (a) gewaehlt wird, koennte eine umgestellte Reihenfolge das Barge-in subtil verschieben (HEIKLE STELLE 1). Mitigation: **Default-Weg (b) — kein Extract in dieser Phase.** Falls (a): Charakterisierungs-Test der Frame-Ausgabe VOR dem Extract; Smoke-Test Szenario 1 ist das Abnahme-Gate.

- **`readyState`-Guard ueberspringt einen Send, der haette durchgehen sollen.** Falls `readyState` in einem Edge kurz nicht OPEN ist, obwohl der Socket gleich wieder sendet, ginge z.B. ein Tool-Result verloren. Mitigation: Das ist exakt das Verhalten des bereits produktiven Inbound-Guards (`:225`) — wir uebernehmen eine bewaehrte Invariante, fuehren keine neue ein. Ein nicht-OPEN-Socket im Tool-Result-/Barge-in-Moment bedeutet ohnehin, dass der Call gerade endet; der Send waere ins Leere gegangen oder haette geworfen.

- **`?.` maskiert einen echten Adapter-Bug.** Wenn Twilio ploetzlich `start`-Frames ohne `.start` schickt, liefert der Adapter still `undefined`-Felder; der nachgelagerte `store.getCall(undefined)` → `call = null` → `providerWs.close()` (`bridge.js:202`) trennt die Verbindung sauber (fail-closed, bestehender Pfad). Das ist gewolltes Degradieren statt Crash — aber ein Dauer-Strom solcher Frames bliebe ohne Alarm. Mitigation: akzeptiertes Risiko fuer den Prototyp; bei Telnyx ist dasselbe `?.`-Verhalten bereits live. Bei Bedarf spaeter ein Counter/Log fuer `start`-ohne-`.start`.

- **Verhaltensaenderung gegenueber Bestand.** Vorher: malformtes Event/Frame oder Send-auf-totem-Socket = Crash (alle Calls weg). Nachher: dasselbe Event wird geloggt und uebersprungen, andere Calls laufen weiter. Das IST die beabsichtigte Aenderung — der Happy-Path bleibt byte-identisch (durch Charakterisierungs-Tests gepinnt).

- **CLAUDE.md-Gates unangetastet:** P3 fasst Allowlist/Budget/Max-Dauer/Signatur/Offenlegungssatz NICHT an. Der Offenlegungssatz-Pfad (`bridge.js:113-116`) und der `disclosureSentence`-Aufruf bleiben unveraendert; Smoke-Test Szenario 5 prueft ihn explizit. Nur Crash-Robustheit im Audio-Pfad wird geaendert.
