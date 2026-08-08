# B2 — Der LLM-Port-Vertrag: was ein Sprachmodell-Anbieter koennen muss

Spezifikation fuer **eine** Phase. Plan: `PLAN-ANBIETER-PORT.md`, Teil 2 (Track B), Phase B2.
Faktenbasis: `tasks/b1-report.md` (Messlauf 2026-08-08, 90 Aufrufe). Bindend:
`tasks/todo.md`, Abschnitt "OWNER-ENTSCHEIDUNG 2026-08-08".

**B2 liefert genau eine neue Datei: `src/llm/ports.js`** — reine JSDoc-Typdefs plus
`export {};`, nach dem Vorbild `src/telephony/ports.js:1-3,280`. Kein Adapter, keine
Registry, kein Preis-Eintrag, kein Boot-Guard, keine Aenderung an `src/llm.js`,
`src/llm-usage.js`, `src/claude.js`, `src/config.js` oder `src/store/state-ops.js`.
Die Datei aendert kein Verhalten — sie legt fest, wogegen B3, B4 und B5 gebaut werden.

---

## 1. Die bindende Owner-Entscheidung, und was sie fuer die Sprache dieses Vertrags heisst

> *"ich will dass die echten kosten abgebucht werden keine [...] annahmen"* (2026-08-08)

Daraus folgt, bereits entschieden und hier **nicht neu aufgerollt**:

1. **Raten je Token-Sorte** (Cache-Treffer / Cache-Fehltreffer / Ausgabe) statt einer
   pauschalen Eingabe-Rate. `inputTokensOf` (`src/llm-usage.js:21-27`) faltet drei Sorten
   auf eine Rate und liegt gemessen um Faktor **5,1x** (flash) bzw. **6,0x** (pro) daneben;
   Cache-Treffer sind der Normalfall (11 von 13 Aufrufen je Modell), nicht die Ausnahme.
2. **Taegliche Perioden-Gegenprobe** gegen `GET /user/balance`. Je Anruf ausgeschlossen
   (Aufloesung 0,01 USD, Verzug ~2 min, 90 Aufrufe fuer einen Schritt).
3. **Modellwahl flash vs. pro ist vertagt bis B5.** Dieser Vertrag legt sich nicht fest.

**"Echte Kosten" heisst nicht: ein Kostenfeld des Anbieters.** Ein solches Feld existiert
nicht — B1 hat alle 90 Antworten **rekursiv** auf Schluessel abgesucht und ausschliesslich
Token-Zaehler gefunden. Es heisst:

> anbieter-gemeldete Token-Zahlen **je Sorte** (beide Summengleichungen halten, 0 Verletzungen
> bei 88 Aufrufen) **mal veroeffentlichte Rate** = reine Arithmetik, **plus** die
> Perioden-Gegenprobe als Beleg, dass die Rate stimmt.

Wer diesen Satz spaeter verliert, baut entweder ein Feld nach, das es nicht gibt, oder haelt
die Preisliste faelschlich fuer gemessen. **Beide Haelften gehoeren zusammen: die Arithmetik
ist exakt, die Rate ist die einzige verbleibende Annahme, und genau sie prueft die
Gegenprobe.** Der Anbieter kuendigt zudem eine deutliche Preiserhoehung an
(`tasks/b1-report.md`, Abschnitt 6) — die Rate ist ein Momentwert, kein Vertrag.

---

## 2. Der Bestand, den der Vertrag abbilden muss

Jede Zeile am Code geprueft, nicht aus der Vorarbeit uebernommen.

| Stelle | Was dort heute gilt |
|---|---|
| `src/llm.js:19,252-256` | Der Seam importiert das Anthropic-SDK direkt; Timeout **3500 ms je Versuch** (`config.js:240`), **maxRetries: 0** am SDK, manueller Retry darueber |
| `src/llm.js:194-210` `withRetry` + `:157-188` Breaker | Retry-Schleife, Voll-Jitter-Backoff (`config.js:245,247`), Circuit-Breaker — **anbieter-unabhaengige Infrastruktur** |
| `src/llm.js:131-144` `isTransient` | 408/409/429 und `>= 500` transient; klassifiziert u. a. ueber `err instanceof Anthropic.APIConnectionError` (`:134`) — **anbieter-fest** |
| `src/llm.js:108-114` `isProviderBillingError` | 402 ODER `err.type === "billing_error"` ODER Textmarke `credit balance is too low` — die Textmarke ist ausdruecklich als fragil dokumentiert (`:88-94`) |
| `src/llm.js:99-102` `providerStatusOf` | liest `err.providerStatus ?? err.status` — bereits neutral |
| `src/llm.js:123-125` `attemptReachedProvider` | "der Versuch war nachweislich auf der Leitung" — Grundlage jeder Schaetzbuchung |
| `src/llm.js:332-334` `complete` | streift `callId` ab, sonst reicht es `params` unveraendert ans SDK |
| `src/llm.js:347-377` `completeStream` | Sink-Vertrag `pushText`/`toolUseStarted` (`:338-341`); **Retry verboten, sobald das erste Fragment den Seam verlassen hat** (`:375`), mit der bewusst dokumentierten Folge, dass der Breaker danach nicht mehr gefuettert wird (`:344-346`) |
| `src/llm.js:356-359` | Fugenzeichen zwischen zwei Textbloecken haelt den gestreamten Text **byte-identisch** zu `textParts.join(" ")` in `claude.js:1025` |
| `src/llm.js:263-266` | Wanduhr des Streams via `AbortSignal.timeout(budgetMs)` — **Aufrufer-Wert**, nicht Anbieter-Wert |
| **`src/llm-usage.js:21-27` `inputTokensOf`** | summiert `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` zu **EINER** Zahl; Kommentar: *"fail-safe: NIE weniger als ohne Caching"* |
| `src/llm-usage.js:59-61` `billedTokens` | `{inputTokens, outputTokens, model}`; Modell ist die **angeforderte** ID, nicht `resp.model` — begruendet (`:55-58`) |
| `src/llm-usage.js:70-74` `bookTokenUsage` | dieselbe Zahl auf **zwei** Achsen: Budget-Gate (`store.trackUsage`, Regel 1) UND Stripe-Ledger (`meterAiTokens`) |
| `src/llm-usage.js:76-84` `bookEstimatedTokenUsage` | Schaetzung geht **nur** auf die Budget-Achse — "eine Schaetzung ist kein Kundenbeleg" |
| `src/llm-usage.js:86-101` `estimatedAbortUsage` | pessimistische Obergrenze aus Prompt-Laenge und Ausgabe-Deckel; liefert nur `input_tokens`/`output_tokens` (die fehlenden Cache-Felder vertraegt `inputTokensOf`) |
| `src/store/state-ops.js:2248-2254` `tokenCostUsd` | **eine** `inPerMTok`, **eine** `outPerMTok` — die Struktur, die eine aufgeschluesselte Meldung heute nicht aufnehmen koennte |
| `src/store/state-ops.js:2240-2242` `priceForModel` | unbekanntes Modell -> `mostExpensivePrice` (`:2219-2229`), also die teuerste **hinterlegte** Rate |
| `src/store/state-ops.js:2524` `trackUsage` / `:2978` `recordUsageEvent` | Bucket kennt genau zwei Zaehler (`defaults.js:566-567`); der Ledger bucht `quantity = inputTokens + outputTokens` (`llm-usage.js:42`) |
| `src/config.js:1426-1429` `modelPricesUsd` | genau zwei Eintraege, beide Anthropic, je zwei Raten |
| `src/boot.js:121-132` `warnUnpricedModels` | **nur WARN, ausdruecklich kein `exit(1)`** — begruendet: *"ein Boot-Refusal tauschte hier ein Kostenproblem gegen einen Totalausfall der Telefonie"* |

### Die vier Aufrufer und was sie an der Anbieterform anfassen

| Aufrufer | Was er heute an Anthropic-Form liest/schreibt |
|---|---|
| `src/claude.js` `agentTurn` | Request `{model, max_tokens, system:[{type,text,cache_control}], tools, messages}` (`:998-1005`); Antwort `resp.content` gefiltert nach `type==="text"` (`:1023`) und `type==="tool_use"` (`:1032`); **`resp.content` wandert unveraendert als `{role:"assistant", content}` in die naechste Anfrage zurueck** (`:1122`); Werkzeug-Ergebnis als `{type:"tool_result", tool_use_id, content}` (`:1125-1139`) |
| `src/claude.js` `summarizeCall` | `llm.complete` ohne Werkzeuge (`:1275`), liest `resp.content` |
| `src/precall-briefing.js` | eigene Client-Instanz mit **eigenem Timeout** (`:117-126`); `tool_choice: {type:"any"}` (`:236`); liest `resp.content` nach `tool_use` mit festem Namen (`:200-202`); liest `resp.stop_reason` — **nur fuer eine Logzeile** (`:315`) |
| `src/telnyx-llm-shim.js` | ruft `agentTurn` mit `onSpeechChunk` (`:820-823`) und schreibt jedes Fragment sofort als OpenAI-SSE-Chunk auf die Leitung (`:799-803`, `:242-288`). **Gegruept: die Datei enthaelt an keiner Stelle `tool_calls`** — sie uebersetzt heute nur die Eingangsseite |

`src/routes/voice.js:33` und `src/telnyx-llm-shim.js:14` nutzen nur
`degradedSpeechFor`/`isProviderBillingError`, keine Nachrichtenform.

### Die Vorbilder im Haus

- `src/telephony/ports.js` — reine Typdefs, **keine Laufzeit-Logik** (`:280` ist die einzige
  Anweisung). Zwei uebertragbare Regeln stehen dort woertlich: eine Groesse, die eine
  **Provider-Eigenschaft** ist, wird bewusst **kein Parameter**, *"damit kein Aufrufer sie
  versehentlich unterbietet"* (`:29-32`); und Waehrungsumrechnung ist *"ausdruecklich NICHT
  Teil dieses Ports"* (`:81-83`).
- `src/telephony/registry.js:65-88,93-98` — eine ADAPTERS-Tabelle, `pick()` wirft fail-closed;
  `:103-117` `CAPABILITY`/`providerSupports` als **zweite** Tabelle fuer Ja/Nein-Metadaten.
- `src/research/ports.js:16-18` — `searchCount(usage) => number|null`, *"null = unbekannt
  (Anbieter meldet den Zaehler nicht) -> der Aufrufer bucht pessimistisch"*. Das ist der
  Praezedenzfall fuer "unbekannt ist ein eigener Zustand, nicht 0".

---

## 3. Der Vertrag

Datei: **`src/llm/ports.js`**. Aufbau, Ton und Umfang wie `src/telephony/ports.js`:
Kopfkommentar, Typdefs, `export {};`. Deutsche Kommentare ohne Umlaute.

### 3.1 Faehigkeiten — jede mit heutigem Aufrufer

Nichts ohne Aufrufer. Die Spalte "fehlt sie" sagt, was passiert, wenn ein Adapter die
Faehigkeit nicht erbringt — **jede Antwort ist fail-closed oder boot-sichtbar, keine ist
eine Laufzeit-Ueberraschung**.

| # | Faehigkeit | Heutiger Aufrufer (Beleg) | Pflicht? | Fehlt sie beim Adapter |
|---|---|---|---|---|
| F1 | Vervollstaendigung mit Werkzeugen | `claude.js:1006` (`completeRound`) ueber `agentTurn`; `precall-briefing.js:283-290` | Pflicht | Registrierung schlaegt beim Boot fehl (Muster `pick`, `telephony/registry.js:93-98`). Ein Adapter ohne `complete` ist kein LLM-Adapter |
| F2 | Streaming-Deltas | `claude.js:799-803` -> Sink -> `telnyx-llm-shim.js:799-803` (Live-Sprechpfad) | Pflicht | Der Adapter **muss** die Luecke als Faehigkeits-Flag deklarieren, das **beim Boot** gelesen wird (Muster `providerSupports`, `registry.js:103-117`). Der Seam faellt dann fuer den ganzen Prozess auf F1 zurueck: Latenz wie vor AL-P7, aber nie Stille mitten im Anruf |
| F3 | Verbrauchsmeldung: Tokens **aufgeschluesselt** + Buchungs-ID | `llm-usage.js:70-74` ueber `claude.js:790-791`, `precall-briefing.js:307` | Pflicht | Nicht abwaehlbar. Meldet der Anbieter nichts, liefert der Adapter eine **markierte Schaetzung** (Abschnitt 4.4) — nie 0, nie ein fehlendes Feld (Regel 1) |
| F4 | Fehlerklassifikation transient vs. endgueltig | `llm.js:131-144` ueber `withRetry` (`:194-210`), `llm.js:108-114` ueber `telnyx-llm-shim.js:14` | Pflicht | Ohne Klassifikation gilt **alles als endgueltig**: kein Retry, sofortige Degradation. Das ist die sichere Richtung — die Gegenrichtung waere ein Retry-Sturm mit doppeltem Token-Verbrauch |
| F5 | Abbruch/Timeout je Versuch | `llm.js:252-256` (`config.js:240`), Sonderfall `precall-briefing.js:117-126` | Pflicht | **Boot-Refusal.** Kein globaler Vorgabewert: 3500 ms sind fuer `deepseek-v4-pro` gemessen zu knapp (Max **3183 ms**, 9 % Luft, **ohne Last**). Ein stillschweigend geerbter falscher Wert ist genau der Fehler, den diese Phase verhindert |

**Nicht in dieser Tabelle und damit nicht im Vertrag:** siehe Abschnitt 5.

### 3.2 Die Typdefs, in nahezu endgueltiger Form

Der Implementierer von B2 schreibt diese Bloecke aus, er erfindet sie nicht neu. Formulierung
darf geschliffen werden; **Feldbestand und Zusicherungen sind bindend.**

```
LlmTokenUsage — Verbrauch EINER Antwort, aufgeschluesselt nach PREISKLASSE (nicht nach
  Anbieter-Feldnamen). Vier Zahlen, ein Kennzeichen, eine ID. Alle Felder Pflicht.

  inputUncachedTokens   Eingabe-Token zur vollen Eingabe-Rate
  inputCacheWriteTokens Eingabe-Token zur Cache-SCHREIB-Rate
  inputCacheReadTokens  Eingabe-Token zur Cache-LESE-Rate
  outputTokens          Ausgabe-Token
  estimated             false = vom Anbieter gemeldet; true = pessimistische Obergrenze
  billingModelId        die ID, unter deren Preisstaffel gebucht wird
```

- Eine Sorte ist **eine Preisklasse**, keine Anbieter-Spalte. Deshalb traegt sie beide Welten
  ohne Luege (Abbildung: Abschnitt 4.2).
- **0 heisst "keine Token dieser Preisklasse", nie "unbekannt".** Unbekanntes wird ueber
  `estimated: true` gemeldet, nicht ueber eine 0 (Praezedenz `research/ports.js:16-18`).
- `billingModelId` gehoert in denselben Bericht wie die Zahlen — der Plan nennt beides
  ausdruecklich als **eine** Faehigkeit, und `billedTokens` (`llm-usage.js:59-61`) fuehrt sie
  heute schon zusammen. **Je Adapter begruendet:** fuer DeepSeek ist es die angeforderte ID
  (B1/M6: 0 Abweichungen bei 88 Aufrufen), fuer Anthropic bleibt es die angeforderte ID aus
  dem dokumentierten Grund (`llm-usage.js:55-58`). Der Vertrag verlangt die Begruendung im
  Adapter-Kommentar, nicht eine bestimmte Wahl.
- **Erweiterungsregel:** eine neue Sorte kommt hinzu, wenn ein Anbieter eine eigene
  **Rate** dafuer hat — nie, weil er ein weiteres Feld meldet. Konkret: `reasoning_tokens`
  bekommen **keine** Sorte, weil sie in `completion_tokens` enthalten sind (B1/M8,
  rechnerisch belegt: 293 + 64 = 357). Ein Anbieter, der Denk-Token separat bepreist,
  braucht eine neue Sorte und damit eine Vertragsaenderung — er darf sie nicht in
  `outputTokens` verstecken.

```
LlmToolCall — ein vom Modell angeforderter Werkzeugaufruf.
  id     Korrelations-ID, geht unveraendert an das Ergebnis zurueck
  name   Werkzeugname
  input  bereits GEPARSTE Argumente als Objekt
```

- Aufrufer: `claude.js:1032` liest `name`/`id`/`input`, `precall-briefing.js:200-202` liest
  `name`/`input`.
- **Das Parsen gehoert in den Adapter.** DeepSeek liefert `function.arguments` als
  JSON-String (B1/M7, Feldpfad `choices[0].message.tool_calls[0].function.name`, im Stream
  ueber `delta` akkumuliert), Anthropic ein Objekt. Der Aufrufer darf diesen Unterschied nie
  sehen.
- **Offen, ausdruecklich nicht hier entschieden:** was bei unparsebaren Argumenten passiert.
  B1 hat den Fall nie beobachtet; eine Regel ohne Beobachtung waere geraten. Die Frage geht
  an B5 (erster Adapter, der wirklich parst). Bestandsschutz besteht: `claude.js:829` liest
  `toolUse.input || {}`.

```
LlmToolResult — das Ergebnis EINES Werkzeugs, zurueck an das Modell.
  toolCallId  die id aus LlmToolCall
  text        Ergebnistext
```

Zwei Felder genuegen: `claude.js:1125-1139` baut heute genau `{tool_use_id, content}`, und
die OpenAI-Form `{role:"tool", tool_call_id, content}` traegt dieselben zwei Angaben
(`PLAN-ANBIETER-PORT.md` 1.4). Diese Kante ist **entscheidbar** und wird hier entschieden.

```
LlmTurn — Ergebnis EINER Modellrunde.
  text          zusammengesetzter Antworttext
  toolCalls     LlmToolCall[]
  usage         LlmTokenUsage
  providerTurn  OPAK - siehe unten
  stopReason    string|null, reine Diagnose
```

- `text`: **Zusicherung** — die ueber den Sink gelieferten Fragmente ergeben aneinandergereiht
  exakt `text`. Das ist heute schon so und ist der Grund fuer das Fugenzeichen in
  `llm.js:356-359` gegen `claude.js:1025`. Ein Adapter, der das bricht, laesst den Anrufer
  etwas anderes hoeren, als im Transkript steht.
- `providerTurn`: **der Aufrufer reicht diesen Wert unveraendert in die naechste Anfrage
  zurueck und liest ihn nie.** Heute ist das `resp.content` (`claude.js:1122`). Siehe
  Abschnitt 6 — das ist der Mechanismus, mit dem B2 die Werkzeug-Schleife vorsieht, ohne B3
  vorwegzunehmen.
- `stopReason`: einziger Leser ist eine Logzeile (`precall-briefing.js:315`). **Kein Verhalten
  haengt daran** — gegruept, `claude.js` liest `stop_reason` nirgends. Deshalb `string|null`
  ohne Enum: ein Enum ohne verhaltensrelevanten Leser waere Vorratshaltung.

```
LlmStreamSink — der Abnehmer der Fragmente (vom Aufrufer gestellt).
  pushText(delta)   jedes Text-Fragment in Reihenfolge
  toolUseStarted()  ein Werkzeug-Block hat begonnen
```

Unveraendert aus `llm.js:338-341`. Der Port kennt weder Saetze noch SSE — die Satzbildung
liegt beim Aufrufer (`claude.js:763-769`), das Draht-Framing beim Shim
(`telnyx-llm-shim.js:242-288`).

```
LlmRequest — was ein Aufrufer uebergibt.
  model         Modell-ID (claude.js:953, :1271, precall-briefing.js:284)
  maxTokens     Ausgabe-Deckel (claude.js:1000, :1279)
  system        Systemanweisung
  messages      Gespraechsverlauf  <- innere Form: B3
  tools         Werkzeugangebot    <- innere Form: B3
  toolChoice    "auto" | "required" (heute nur precall-briefing.js:236 nutzt "required")
  callId        Bench-/Metrik-Korrelation, KEIN Anbieter-Feld (llm.js:329-333)
  streamBudgetMs  nur completeStream: Restfrist des Turns (claude.js:1009)
```

- `toolChoice` ist eine echte Faehigkeit mit Aufrufer und steht deshalb im Vertrag. Neutrale
  Werte, weil beide Welten sie kennen: Anthropic `{type:"any"}` (`precall-briefing.js:236`),
  DeepSeek `"required"` (B1, Doku-Stand `tasks/b1-spec.md` Abschnitt 4).
- **`streamBudgetMs` bleibt Aufrufer-Parameter** (es ist die Restfrist des Anrufs), waehrend
  der **Per-Versuch-Timeout Adapter-Eigenschaft** ist und nicht uebergeben wird — genau die
  Trennung aus `telephony/ports.js:29-32`. Zwei Uhren, zwei Besitzer; beide existieren heute
  (`llm.js:254` gegen `llm.js:263-266`).

```
LlmErrorClassification — was der Adapter zur Fehlerbeurteilung beitraegt.
  isTransient(err)      -> boolean
  isBillingError(err)   -> boolean
```

- Der **Seam behaelt** Breaker, Retry-Schleife, `attemptReachedProvider`,
  `LlmUnavailableError` und `degradedSpeechFor` (`llm.js:48-76,123-125,157-210`). Ein Adapter,
  der seinen eigenen Breaker mitbringt, ist die Duplizierung, die dieses Repo bestraft (S2).
- Der **Adapter liefert nur die Klassifikation**, weil genau dort das Anbieter-Wissen sitzt:
  `err instanceof Anthropic.APIConnectionError` (`llm.js:134`) ist nicht uebertragbar; die
  Textmarke `credit balance is too low` (`llm.js:94`) ist eine Anthropic-Eigenheit, waehrend
  DeepSeek 402 meldet. Statuscodes sind weitgehend uebertragbar (B1: 401 und **400** — nicht
  422 — gemessen; 402/429/503 dokumentiert).

```
LlmProvider — das Port-Objekt.
  complete(request)        -> Promise<LlmTurn>
  completeStream(request, sink) -> Promise<LlmTurn>
  errors                   -> LlmErrorClassification
  limits                   -> {requestTimeoutMs, maxRetries, backoffMs}
```

**Zusicherung ueber alle Methoden:** jede erfolgreiche Antwort — gestreamt oder nicht —
traegt ein vollstaendiges `LlmTokenUsage`. **Wie** ein Adapter das erreicht, ist seine Sache;
fuer DeepSeek heisst es `stream_options.include_usage` erzwingen. B1 hat gemessen, dass das
Flag dort **nicht noetig** waere (alle 16 Kombinationen lieferten `usage`) — **trotzdem
erzwingen**: die Doku verlangt es, undokumentiertes Verhalten ist keine Zusage, Regel 1 haengt
daran, und das Erzwingen kostet nichts.

---

## 4. Die Verbrauchsform — das Herzstueck

### 4.1 Welche Sorten der Vertrag kennt

Vier, definiert ueber die **Preisklasse**, nicht ueber Anbieter-Feldnamen:
`inputUncachedTokens`, `inputCacheWriteTokens`, `inputCacheReadTokens`, `outputTokens`.

Warum nicht weniger: DeepSeeks Spreizung zwischen Treffer und Fehltreffer ist laut Preisseite
Faktor 50 (`v4-flash`) bzw. 120 (`v4-pro`) — eine gemeinsame Eingabe-Zahl kann das nicht
tragen. Warum nicht mehr: Anthropics Cache-Schreiben ist eine **eigene** Rate, DeepSeeks
nicht; wer beide auf zwei Sorten zwaenge, muesste eine der beiden Welten verbiegen.

### 4.2 Abbildung je Anbieter — jedes B1-Feld ist zugeordnet

| Sorte | Anthropic (`llm-usage.js:21-27`, `llm.js:227-230`) | DeepSeek (B1/M1, gemessen) |
|---|---|---|
| `inputUncachedTokens` | `input_tokens` | `prompt_cache_miss_tokens` |
| `inputCacheWriteTokens` | `cache_creation_input_tokens` | **0** — der Anbieter hat keine eigene Schreib-Rate; der Schreibvorgang steckt bereits in `prompt_cache_miss_tokens` und ist dort bepreist |
| `inputCacheReadTokens` | `cache_read_input_tokens` | `prompt_cache_hit_tokens` |
| `outputTokens` | `output_tokens` | `completion_tokens` (`reasoning_tokens` **enthalten**, B1/M8) |

Felder, die der Vertrag **bewusst nicht liest**, mit Grund — damit spaeter niemand meint, sie
seien uebersehen worden:

| Feld | Grund |
|---|---|
| `prompt_tokens` (DeepSeek) | ableitbar als `hit + miss`; wird nur als **Pruefsumme** benutzt (4.3), nicht als Quelle |
| `total_tokens` (DeepSeek) | ableitbar; zweite Quelle fuer dieselbe Tatsache waere Duplizierung |
| `prompt_tokens_details.cached_tokens` (DeepSeek, **undokumentiert**) | spiegelt `prompt_cache_hit_tokens` (B1: in allen Stichproben wertgleich). Zwei Felder fuer eine Tatsache, und das undokumentierte ist die schwaechere Zusage |
| `completion_tokens_details.reasoning_tokens` (DeepSeek) | enthalten, nicht additiv (B1/M8) — Addieren waere Doppelzaehlung |

### 4.3 Was aus der Zusicherung *"fail-safe: NIE weniger als ohne Caching"* wird

**Sie faellt als Normalfall-Regel und kehrt als Notfall-Regel zurueck.** Begruendung in vier
Schritten:

1. Die Zusicherung war nie ein Wert an sich, sondern die **Kompensation eines Strukturmangels**:
   `tokenCostUsd` kennt genau eine Eingabe-Rate (`state-ops.js:2248-2254`), also war Summieren
   die einzige konservative Wahl. Mit Raten je Sorte gibt es nichts mehr zu kompensieren — die
   Rechnung ist dann exakt, weder zu hoch noch zu niedrig.
2. Sie ist auf einer der beiden Achsen sogar **schaedlich**: Ueberbuchung ist auf dem Gate
   sicher, auf dem **Kundenbeleg** (`meterAiTokens` -> Stripe) ein Abrechnungsdefekt. Bei
   Cache-Treffern als Normalfall (11 von 13) waere pauschal-teuer kein Polster, sondern ein
   systematischer Fehler auf **jeder** Rechnung.
3. An ihre Stelle tritt die **Vollstaendigkeits-Invariante**: jedes vom Anbieter gemeldete
   Token landet in **genau einer** Sorte — keins faellt weg, keins zaehlt doppelt. Fuer
   DeepSeek ist sie pruefbar (`uncached + cacheWrite + cacheRead == prompt_tokens`,
   B1: **0 Verletzungen bei 88 Aufrufen**). Fuer Anthropic gibt es kein Summenfeld, gegen das
   man pruefen koennte — dort **ist** die Summe die Definition. Diese Asymmetrie steht so im
   Vertrag, statt sie zu verschweigen.
4. Die fail-safe-Richtung bleibt genau dort, wo sie noch gebraucht wird — im **Unbekannt-Fall**
   (4.4). Das ist die Notfall-Regel: **verletzt eine Antwort die Pruefsumme oder fehlt eine
   Zahl, bildet der Adapter alle Eingabe-Token auf `inputUncachedTokens` ab (die teuerste
   Eingabeklasse) und setzt `estimated: true`.** Genau das alte Verhalten — aber als Ausnahme
   mit Kennzeichen, nicht als stiller Normalfall.

### 4.4 Der Unbekannt-Fall und die zwei Achsen

`estimated: true` bedeutet: die Zahlen sind eine **pessimistische Obergrenze**, kein
Anbieter-Bericht. Auslöser sind heute schon bekannt: abgebrochener Aufruf mit
`attemptReachedProvider` (`llm.js:123-125`), abgerissener Stream (`claude.js:806-812`),
fehlendes `usage` trotz erzwungenem Flag.

**Der Vertrag entscheidet NICHT, auf welche Achse eine Schaetzung gebucht wird.** Er stellt
nur sicher, dass sie **erkennbar** ist. Die Entscheidung bleibt beim Aufrufer, und sie ist
heute bewusst **nicht** einheitlich:

- `claude.js:781-785` bucht die Abriss-Schaetzung auf **beide** Achsen — begruendet: ein Teil
  des Textes wurde bereits gesprochen, die Leistung ist erbracht.
- `precall-briefing.js:253-256` bucht **nur** die Budget-Achse — begruendet: der Kunde hat nie
  ein Ergebnis gesehen, ein Beleg waere ein Phantom (`llm-usage.js:76-84`).

Ein Vertrag, der diese Unterscheidung an sich zieht, wuerde eine der beiden Begruendungen
loeschen. Er liefert das Kennzeichen; die Politik bleibt oben.

**Folge fuer `estimatedAbortUsage` (`llm-usage.js:86-101`), gehoert nach B4:** die Schaetzung
muss die neue Form liefern — alles nach `inputUncachedTokens`, `outputTokens` auf den harten
Deckel, `estimated: true`. Heute liefert sie zwei Anthropic-Feldnamen.

### 4.5 Wie `modelPricesUsd` danach aussieht, und der Migrationspfad

Der Vertrag liest keine Preise (Abschnitt 5). Aber die Form der Preistabelle ist die direkte
**Vertragsfolge** der aufgeschluesselten Meldung und wird deshalb hier festgeschrieben, damit
B4 nicht einen Vier-Sorten-Bericht in eine Zwei-Raten-Tabelle kippt:

```
je Modell-ID:
  inPerMTok           volle Eingabe-Rate        -> inputUncachedTokens
  cacheWritePerMTok   Cache-Schreib-Rate        -> inputCacheWriteTokens
  cacheReadPerMTok    Cache-Lese-Rate           -> inputCacheReadTokens
  outPerMTok          Ausgabe-Rate              -> outputTokens
  asOf                Abrufdatum der Rate
  source              URL der Preisquelle
```

**Vier Raten sind Pflicht je Eintrag, kein Feld ist optional.** Die naheliegende Alternative —
neue Raten additiv-optional, fehlend faellt auf `inPerMTok` zurueck — ist **verworfen**: sie
laesst genau den Eintrag, den jemand vergisst, still im alten, falschen Verhalten weiterlaufen,
und nichts wird rot. Dieses Repo hat den Fall schon einmal bezahlt (additiv-nullable ohne
Backfill: alle Bestandsnummern ohne `monthlyCostCents`).

`asOf`/`source` sind kein Schmuck: die Anbieterseite kuendigt eine deutliche Erhoehung an, und
eine Rate ohne Datum ist in einem Jahr nicht mehr pruefbar (Pre-Mortem 6).

**Migrationspfad fuer die zwei Anthropic-Eintraege — benannt, nicht offengelassen:**

1. **In EINEM Commit** (B4): Form-Aenderung **und** vollstaendige Werte fuer
   `claude-haiku-4-5` und `claude-sonnet-5`. Kein Zwischenzustand, in dem ein Eintrag drei
   Raten hat.
2. Die Sorten-Raten fuer Anthropic werden **frisch von der Preisseite abgerufen**, mit `asOf`
   und `source`. Sie werden **nicht** aus einem Multiplikator abgeleitet ("Cache-Lesen ist
   rund ein Zehntel" ist eine Faustformel aus `PLAN-ANBIETER-PORT.md` 1.2, kein Preis).
3. **Die gefaehrlichste Nebenwirkung der ganzen Kette, hier ausdruecklich benannt:** sobald
   Anthropic vier Raten hat, wird `cache_read_input_tokens` nicht mehr zur vollen Eingabe-Rate
   gebucht. **Der live gebuchte Betrag sinkt** — auf dem Kundenbeleg richtiger, auf dem
   Budget-Gate aber **spaeter greifend**, also weniger schuetzend (Regel 1). Rechnung an der
   Repo-eigenen Fixture (`test/llm.test.js:238-244`: 5 / 20 / 100 / 7): heute 125 Eingabe-Token
   zur vollen Rate, danach 5 voll + 20 Schreib + 100 Lese. Das ist **keine** Nebenwirkung, die
   nebenbei passieren darf. B4 fuehrt sie als eigenen, gemessenen Schritt aus: Vorher-/
   Nachher-Betrag an echtem Verkehr, Owner sieht die Zahl.
4. **Offen und an B4 uebergeben:** ob alle Anbieter in **eine** Tabelle gehoeren. Grund siehe
   4.6 — `mostExpensivePrice` ueber mehrere Preiswelten ist keine Obergrenze mehr.

### 4.6 `priceForModel`: Boot-Abbruch gehoert nach **B4**, nicht nach B2

**Entscheidung: B4.** Drei Gruende, der dritte ist der eigentliche.

1. **Kein Aufrufer im Port.** Der Port meldet Token und eine Buchungs-ID; Preise liest
   `tokenCostUsd` (`state-ops.js:2249`). Eine Preisregel in `ports.js` waere eine Faehigkeit
   ohne Aufrufer — genau das, was Abschnitt 5 ausschliesst.
2. **Es ist eine Verhaltensaenderung, kein Vertrag.** Ein Boot, der bisher hochkam, verweigert
   danach den Start. Das braucht einen Spawn-Test — den der Plan bereits B4 zuweist
   (*"konfiguriertes Modell ohne Preiseintrag -> Boot bricht ab"*). B2 aendert kein Verhalten.
3. **Es kehrt eine dokumentierte Owner-nahe Entscheidung um, und das muss sichtbar
   passieren.** `boot.js:121-124` sagt woertlich: *"NUR WARN, kein exit(1): ein Boot-Refusal
   tauschte hier ein Kostenproblem gegen einen Totalausfall der Telefonie."* Abnahmekriterium 1
   des Plans verlangt das Gegenteil. **B2 loest diesen Widerspruch nicht auf, es legt ihn
   offen** — samt des Arguments, das die Umkehr traegt:

> Die heutige Begruendung steht und faellt mit einer stillen Voraussetzung: dass
> `mostExpensivePrice` (`state-ops.js:2219-2229`) eine **Obergrenze** ist. Das gilt nur, solange
> alle Eintraege aus **einer** Preiswelt stammen. Heute sind beide Eintraege Anthropic, und die
> teuerste Anthropic-Rate liegt weit ueber jeder DeepSeek-Rate — die Ueberbuchung faellt
> zufaellig in die sichere Richtung. Mit mehreren Anbietern in einer Tabelle ist diese Richtung
> nicht mehr garantiert: enthaelt die Tabelle nur billige Eintraege und laeuft ein teures
> Modell, bucht der Fail-closed-Zweig **zu wenig** — und die KI-Kosten-Achse des Budget-Gates
> wird blind. Das ist der Fall, gegen den Absolute Regel 1 steht. Ab dem zweiten Anbieter ist
> der Boot-Abbruch also nicht "strenger", sondern der **Ersatz fuer eine Sicherung, die ihre
> Wirkung verliert**.

Was B2 dazu **doch** tut, weil es Vertragssache ist: `LlmTokenUsage.billingModelId` traegt die
Zusicherung, dass ein Adapter nur eine ID melden darf, fuer die eine Preisstaffel existieren
kann. Die Durchsetzung ist B4.

---

## 5. Was NICHT in den Vertrag gehoert

Alles ohne heutigen Aufrufer. Sechs naheliegende Kandidaten, jeder mit Grund:

| Draussen | Grund |
|---|---|
| **Prompt-Caching-Steuerung** (`cache_control`-Marker) | Heute setzt sie **der Aufrufer** (`claude.js:543,550-556,1001`) in Anthropic-Form. DeepSeeks Cache ist per Default an und braucht **keinen Parameter** (B1-Doku). Ein neutraler "Cache-Hinweis" haette also eine Implementierung und einen No-op — Vorratshaltung (P15). Die Marker wandern in den Adapter; das ist B3-Arbeit, keine Vertragsflaeche |
| **Preise, Waehrung, Geldbetraege** | Der Port meldet Token, nie Geld. Woertlicher Praezedenzfall am Nachbar-Port: *"NICHT EUR: die Umrechnung ist ausdruecklich NICHT Teil dieses Ports"* (`telephony/ports.js:81-83`). `usdToEur` bleibt die eine Stellschraube (`config.js:1435-1439`); eine zweite waere die Duplizierung, die dieses Repo bestraft |
| **Guthaben-/Kontostand-Abfrage** (`GET /user/balance`) | Die Perioden-Gegenprobe (Owner-Entscheidung 2) ist ein **geplanter Betriebslauf**, kein Aufruf im Gespraechspfad — B1 hat gemessen, dass sie je Anruf nichts hergibt (Aufloesung 0,01 USD, Verzug ~2 min, 90 Aufrufe fuer einen Schritt). Sie hat heute **keinen** Aufrufer, und einen Planer gibt es im Betrieb nicht |
| **Modell-Auswahl / Modell-Liste** (`GET /models`, "waehle flash oder pro") | Owner-Entscheidung 3 vertagt die Modellwahl bis B5. Die ID kommt heute direkt aus der Konfiguration (`claude.js:953,1271`, `precall-briefing.js:284`) |
| **Circuit-Breaker, Retry-Schleife, Backoff** | Anbieter-unabhaengige Infrastruktur, existiert genau einmal (`llm.js:157-210`). Ein Adapter mit eigenem Breaker waere dieselbe Logik zweimal (S2). Der Adapter liefert nur Klassifikation (F4) und seine eigenen Zahlen (F5) |
| **Embeddings, Bildeingaben, JSON-Modus, Denk-Budget, Batch-API** | Kein Aufrufer. Jede dieser Faehigkeiten waere eine Wette darauf, dass ein zweiter Adapter sie braucht — und der Pre-Mortem des Plans nennt genau diese Wette als Todesursache |

---

## 6. Abgrenzung zu B3, B4, B5 — und wie B2 die Werkzeug-Schleife vorsieht, ohne sie zu entscheiden

| Frage | Phase |
|---|---|
| Welche Faehigkeiten hat der Port, mit welchen Signaturen? | **B2** |
| Welche Token-Sorten gibt es, was heisst "unbekannt", wer entscheidet die Achse? | **B2** |
| Welche Form haben `messages` und `tools` **innen**? Normalisiert der Port, oder bekommt `claude.js` eine neutrale Form? | **B3** |
| Ist der Eingangs-Uebersetzer aus `telnyx-llm-shim.js` fuer die Ausgangsseite wiederverwendbar? | **B3** (unbelegt; gegruept enthaelt die Datei kein `tool_calls`) |
| Preisstaffel-Werte, `asOf`/`source`, Boot-Abbruch, Store-/Ledger-Kante | **B4** |
| Vorher-/Nachher-Messung des Anthropic-Betrags (4.5, Punkt 3) | **B4** |
| DeepSeek-Adapter, Timeout-Werte, Modellwahl flash/pro, Abnahme mit echtem Anruf | **B5** |
| `src/llm/registry.js` (Adapter-Tabelle, Auswahl) | **B5** — eine Tabelle entsteht mit dem zweiten Eintrag, nicht davor |

### Der Mechanismus: `providerTurn` als opake Ruecktrage

Die Werkzeug-Schleife hat heute **eine** Stelle, die sich der Neutralisierung entzieht:
`claude.js:1122` schiebt `resp.content` unveraendert als `{role:"assistant", content}` in die
naechste Anfrage zurueck. Wer diese Stelle neutralisiert, hat B3 entschieden; wer sie ignoriert,
schreibt einen Vertrag, der die Schleife nicht traegt.

**Loesung: der Vertrag benennt die Kante und versiegelt ihren Inhalt.** `LlmTurn.providerTurn`
ist ein Wert, den der Aufrufer **unveraendert zurueckreicht und nie liest**. Damit steht in B2
fest:

- **dass** es eine Ruecktrage gibt, wer sie besitzt (der Adapter) und wer sie nicht anfassen
  darf (der Aufrufer),
- **dass** die drei Dinge, die die Schleife wirklich braucht — Text, Werkzeugaufrufe,
  Verbrauch — als **neutrale** Felder daneben stehen und vom Aufrufer gelesen werden duerfen.

Offen bleibt allein, **was** hinter `providerTurn` steckt: eine Anthropic-`content`-Liste, eine
OpenAI-Nachricht oder eine normalisierte Form. Genau das ist B3s Frage, und keine Formulierung
in B2 nimmt sie vorweg. Was B2 B3 dabei mitgibt, sind drei Bedingungen, die jede Antwort
erfuellen muss:

1. **Genau eine Uebersetzungsstelle** je Anbieter (keine zweite Karte an anderer Stelle).
2. **Verlustfrei fuer die Ruecktrage**: `providerTurn` -> naechste Anfrage -> Modell sieht
   denselben Verlauf wie heute.
3. **Kein Anbieter-Markup im Aufrufer**: `type === "tool_use"`, `tool_calls`,
   `content`-Bloecke tauchen in `claude.js` nicht mehr auf — oder B3 entscheidet begruendet
   anders und schreibt es dort auf.

---

## 7. Abnahme (deterministisch)

**B2 ist eine Dokument-Phase. Gruene Tests sind hier kein Beleg** — eine Datei aus JSDoc und
`export {};` kann die Suite gar nicht roeten. `npm test` gruen beweist nur, dass B2 nichts
kaputtgemacht hat; ueber die Richtigkeit des Vertrags sagt es **nichts**. Der Beleg ist
stattdessen: **jede Behauptung des Vertrags ist gegen den Bestand oder gegen das
B1-Messprotokoll nachrechenbar** — und die Nachrechnung ist unten als Kommando oder als
Papier-Durchlauf ausgeschrieben.

| # | Punkt | Beleg-Kommando / Datei |
|---|---|---|
| 1 | Genau **eine** neue Datei, sonst nichts | `git diff --stat master..<branch>` zeigt ausschliesslich `src/llm/ports.js` (+ diese Spec) |
| 2 | Syntaktisch gueltig | `node --check src/llm/ports.js` -> Exit 0 |
| 3 | **Keine Laufzeit-Logik** | `grep -nE "function\|=>\|\bconst\b\|\blet\b" src/llm/ports.js` liefert **keine** Treffer ausserhalb von Kommentaren; die einzige Anweisung ist `export {};` (Vorbild `telephony/ports.js:280`) |
| 4 | **Jede** Faehigkeit nennt einen heutigen Aufrufer mit `datei.js:zeile` | Tabelle 3.1; jede Zitatstelle einzeln nachschlagen (`sed -n '<zeile>p' <datei>`) — enthaelt die Zeile das genannte Symbol nicht, ist der Vertrag falsch belegt |
| 5 | **Jedes** von B1 gemeldete `usage`-Feld ist entweder einer Sorte zugeordnet **oder** namentlich als "bewusst nicht gelesen" begruendet | Tabellen 4.2; Gegenliste ist `tasks/b1-report.md` Abschnitt 5 (fuenf dokumentierte Felder + `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens`). **Null unzugeordnete Felder** |
| 6 | **Papier-Durchlauf DeepSeek** an einer echten Messzeile | s. u. |
| 7 | **Papier-Durchlauf Anthropic** an der Repo-Fixture | s. u. |
| 8 | Kein Secret, keine PII in der neuen Datei | Sichtpruefung; die Datei enthaelt nur Typbeschreibungen |

### Punkt 6 — Papier-Durchlauf DeepSeek (gemessene Zeile, Block B, seq 3, `deepseek-v4-flash`)

Quelle: `data/evidence/deepseek-probe/2026-08-08T11-03-09-007Z/calls.jsonl` (gitignored).

```
usage_raw = {prompt_tokens: 3299, completion_tokens: 16, total_tokens: 3315,
             prompt_tokens_details: {cached_tokens: 3200},
             completion_tokens_details: {reasoning_tokens: 16},
             prompt_cache_hit_tokens: 3200, prompt_cache_miss_tokens: 99}
```

Abbildung nach 4.2: `inputUncachedTokens = 99`, `inputCacheWriteTokens = 0`,
`inputCacheReadTokens = 3200`, `outputTokens = 16`, `estimated = false`.
Pruefsumme (4.3): `99 + 0 + 3200 = 3299 == prompt_tokens` **haelt**.

Arithmetik mit den Doku-Raten (flash: 0,0028 / 0,14 / 0,28 USD je 1M):

```
3200/1e6 * 0,0028 =  8,96e-6
  99/1e6 * 0,14   = 13,86e-6
  16/1e6 * 0,28   =  4,48e-6
                    --------
                    27,30e-6 USD
```

Das Messprotokoll fuehrt fuer dieselbe Zeile `est_usd_from_doc_prices = 2,73e-05`. **Der
Vertrag reproduziert die gemessene Zahl exakt.**

Gegenprobe mit der heutigen Struktur (eine Eingabe-Rate; als Rate kaeme nur die
Fehltreffer-Rate 0,14 in Frage): `3299/1e6 * 0,14 + 4,48e-6 = 466,3e-6 USD` — **Faktor 17,1**
gegenueber 27,3e-6. *Zur Einordnung: das ist der Wert dieser einzelnen Zeile; die 5,1x aus
`tasks/b1-report.md` sind der Durchschnitt ueber den ganzen Cache-Block inklusive des kalten
ersten Aufrufs und der Kontrollen. Beide Zahlen widersprechen sich nicht.*

**Falsifikation:** liesse sich ein Feld nicht abbilden, oder ginge die Pruefsumme nicht auf,
waere der Vertrag widerlegt. Genau dafuer steht dieser Punkt in der Abnahme.

### Punkt 7 — Papier-Durchlauf Anthropic (Repo-Fixture, `test/llm.test.js:238-244`)

```
usage = {input_tokens: 5, output_tokens: 7,
         cache_creation_input_tokens: 20, cache_read_input_tokens: 100}
```

Abbildung: `inputUncachedTokens = 5`, `inputCacheWriteTokens = 20`,
`inputCacheReadTokens = 100`, `outputTokens = 7`, `estimated = false`.
Heutige Faltung `inputTokensOf`: `5 + 20 + 100 = 125` — dieselbe Gesamtmenge, nur verteilt.

**Keine Geldzahl in diesem Durchlauf**, und das ist Absicht: die Anthropic-Sorten-Raten sind
noch nicht abgerufen. Sie mit einem Multiplikator zu schaetzen waere genau die Annahme, die die
Owner-Entscheidung ausschliesst. Abrufen mit `asOf`/`source` ist B4 (4.5).

**Ausdruecklich nicht Teil der Abnahme:** eine Implementierung, ein Adapter, ein Preiseintrag,
ein Test. Und keine Empfehlung zur Modellwahl.

---

## 8. Pre-Mortem

Ein Jahr spaeter: der Vertrag war falsch geschnitten. Was ist passiert?

| # | Szenario | Gegenmassnahme **in dieser Phase** |
|---|---|---|
| 1 | **Der Vertrag wurde breit gebaut, und niemand hat je einen zweiten Adapter geschrieben.** (Pre-Mortem des Plans) | Die Aufrufer-Spalte in 3.1 ist Pflicht, und Abschnitt 5 listet sechs Faehigkeiten, die **draussen** bleiben. Der Vertrag hat fuenf Faehigkeiten, nicht fuenfzehn |
| 2 | **Die Aufschluesselung starb an der Store-Kante.** Der Port meldete vier Sorten, `bookTokenUsage` faltete sie sofort wieder zusammen, weil der Bucket zwei Zaehler hat (`defaults.js:566-567`) und der Ledger `quantity = input + output` bucht (`llm-usage.js:42`). Die Rechnung war wieder um Faktor 5-6 falsch — diesmal aber mit einem Vertrag, der das Gegenteil behauptete | Die vier Sorten sind **Pflichtfelder** des Berichts, kein optionales Extra; eine Faltung auf zwei Zahlen verletzt die Vollstaendigkeits-Invariante messbar. Zusaetzlich benennt 4.5/6 die Store- und Ledger-Kante als **B4-Pflichtaufgabe mit Namen**, statt sie als "ergibt sich" stehen zu lassen |
| 3 | **Der Live-Sprechpfad fiel aus.** Ein Adapter konnte nicht streamen; das merkte erst der Anrufer, als er Sekunden lang Stille hoerte, bis der Dead-Air-Watchdog griff | F2 ist **Pflicht**, nicht `[optional]` wie manche Methode am Telefonie-Port. Kann ein Adapter es wirklich nicht, deklariert er es als Faehigkeits-Flag, das **beim Boot** gelesen wird (`registry.js:103-117`), und der Seam faellt fuer den ganzen Prozess auf F1 zurueck: schlechtere Latenz, nie Stille mitten im Anruf |
| 4 | **Retry nach dem ersten Fragment.** Ein neuer Adapter brachte seine eigene Stream-Schleife mit; nach einem transienten Abriss lief der Versuch erneut, und der Anrufer hoerte die halbe Antwort zweimal | Die Regel steht als **bindende Invariante des Ports** in `ports.js`, samt Besitzverhaeltnis: `forwardedText` und die Retry-Entscheidung bleiben im **Seam** (`llm.js:375`), der Adapter liefert ausschliesslich die Klassifikation (F4). Mitdokumentiert wird die bewusste Kehrseite (`llm.js:344-346`): nach dem ersten Fragment wird der Breaker nicht mehr gefuettert |
| 5 | **Die zwei Achsen liefen auseinander.** Das Gate bekam die Schaetzung, der Kundenbeleg nichts — oder umgekehrt —, und einen Monat lang fiel es niemandem auf | `estimated` ist Pflichtfeld; **nur** dieses Kennzeichen darf die Achsen-Wahl steuern, und die Wahl bleibt beim Aufrufer, wo heute zwei **verschieden begruendete** Entscheidungen stehen (`claude.js:781-785` gegen `llm-usage.js:76-84`). Ein Vertrag, der sie vereinheitlicht, loescht eine der beiden Begruendungen |
| 6 | **Die Preisaenderung kam, und niemand sah sie.** Die angekuendigte Erhoehung trat ein; die Tabelle trug weiter die Raten vom 2026-08-08, jede Rechnung seither war falsch und das Gate zeigte in die unsichere Richtung | `asOf` und `source` sind **Pflichtfelder jedes Preiseintrags** (4.5) — eine Rate ohne Datum ist nicht pruefbar. Die Perioden-Gegenprobe (Owner-Entscheidung 2) bekommt in B4 einen Schwellenwert; **was** sie vergleicht, legt B2 fest: Guthaben-Delta einer Periode gegen die **Arithmetik-Summe derselben Periode** |
| 7 | **Der Timeout wurde geerbt.** Der DeepSeek-Adapter uebernahm stillschweigend die 3500 ms des Seams. Unter Last schnitt der Timeout lebende Anfragen ab: Token entstanden, Antworten kamen nie, `attemptReachedProvider` buchte jedes Mal eine Schaetzung, das Budget brannte ohne eine einzige Antwort | F5 macht den Per-Versuch-Timeout zur **Adapter-Eigenschaft ohne Vorgabewert**; fehlt er, verweigert der Boot. Praezedenz: die KLINGELfrist am Telefonie-Port (`telephony/ports.js:29-32`). Gemessene Begruendung liegt bei: `pro` erreicht **3183 ms** ohne Last, 9 % Luft — und das dokumentierte Offenhalten wartender Anfragen (bis 10 min) ist genau die Falle |
| 8 | **Die Buchungs-ID wurde zur Anzeige-ID.** Irgendwer stellte fuer DeepSeek auf `resp.model` um; die Preistabelle war auf angeforderte IDs geschluesselt, jeder Turn lief in den Fail-closed-Zweig, und das Budget war systematisch zu frueh erschoepft | `billingModelId` ist **Teil des Verbrauchsberichts**, nicht ein Nebenfeld, und der Vertrag verlangt die **Begruendung je Adapter** im Adapter-Kommentar. Gemessene Grundlage fuer DeepSeek: 0 Abweichungen bei 88 Aufrufen (B1/M6) |

---

## 9. Weisse Flecken — was am Bestand nicht zu klaeren war

Ehrlich benannt, statt geraten. Jeder Punkt nennt, wer ihn beantworten muss.

| # | Offen | Wer beantwortet es, und womit |
|---|---|---|
| W1 | **Ob der Eingangs-Uebersetzer des Shims fuer die Ausgangsseite taugt.** Gegruept enthaelt `src/telnyx-llm-shim.js` **kein** `tool_calls` — es uebersetzt heute nur eingehende OpenAI-Nachrichten. Ob daraus etwas wiederverwendbar ist, ist unbelegt | **B3**, erste Frage (so bereits im Plan) |
| W2 | **Was bei unparsebaren Werkzeug-Argumenten passiert.** B1 hat den Fall nie beobachtet; eine Regel ohne Beobachtung waere geraten | **B5** (erster Adapter, der wirklich parst) |
| W3 | **Anthropics Raten je Token-Sorte.** Im Repo steht keine Zahl; `PLAN-ANBIETER-PORT.md` 1.2 nennt nur die Faustformel "rund ein Zehntel". Eine Faustformel ist kein Preis | **B4**: frisch abrufen, mit `asOf` und `source` |
| W4 | **Ob alle Anbieter in EINE `modelPricesUsd`-Tabelle gehoeren.** `mostExpensivePrice` ist nur innerhalb einer Preiswelt eine Obergrenze (4.6). Ob die Antwort "Tabelle je Anbieter" oder "Fallback ersatzlos streichen, weil der Boot ohnehin abbricht" lautet, entscheidet der Code, den B4 vor sich hat | **B4** |
| W5 | **Wie weit die Aufschluesselung in den Store reichen muss.** Der Bucket kennt zwei Zaehler (`defaults.js:566-567`), `usage_event.quantity` ist eine Summe (`llm-usage.js:42`). Ob vier Zaehler noetig sind oder nur die **Preisrechnung** aufgeschluesselt laufen muss, waehrend die Zaehler Summen bleiben, ist ohne den Ledger-/Schema-Kontext nicht entscheidbar — und beruehrt `src/db/schema.sql` | **B4** |
| W6 | **Ob der Betrag-Rueckgang bei Anthropic (4.5, Punkt 3) das Gate praktisch schwaecht.** Die Richtung ist klar, die Groesse nicht: sie haengt am realen Cache-Treffer-Anteil im Live-Verkehr, und der ist im Repo nirgends gemessen (`llm.js:224-232` emittiert die Zaehler nur als Metrik) | **B4**, Vorher-/Nachher-Messung an echtem Verkehr |
| W7 | **Der Perioden-Gegenprobe fehlt ein Traeger.** Owner-Entscheidung 2 verlangt einen taeglichen Lauf; einen Planer gibt es im Betrieb nicht (Render-Tarif ohne Cron). Ob das ein Skript, ein Boot-Hook oder Handarbeit wird, ist eine Betriebsfrage, keine Vertragsfrage | **B4** oder eine eigene Phase |
| W8 | **Ob `deepseek-v4-flash`/`-pro` das Gespraech ueberhaupt tragen.** B1 kann darueber nichts sagen (`max_tokens` war 64, Antworten abgeschnitten). Praezedenz B-7: dokumentierte Deutsch-Unterstuetzung, gemessen 97 % Wortfehlerrate | **B5** (`npm run convo-bench`, n >= 5, plus echter Anruf) |

---

## 10. Nicht-Ziele

- **Keine Implementierung.** Kein Adapter, keine Registry, kein Preiseintrag, kein Boot-Guard.
- **Keine Aenderung an bestehendem Code** — auch keine "kleine" Umbenennung in `llm-usage.js`.
- **Keine Entscheidung ueber die Werkzeug-Schleifen-Form** (B3) und keine ueber Modelle (B5).
- **Kein `config`-Key, kein `.env.example`-Eintrag, kein `BASE_ENV`-Eintrag.** Die
  Konfigurationsflaeche entsteht mit dem Adapter, nicht mit dem Vertrag.
- **Keine Empfehlung**, ob DeepSeek genommen wird. Der Vertrag ist das Ziel, nicht der eine
  Anbieter (O-5).
