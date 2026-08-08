# B3 — Spezifikation: die Werkzeug-Schleife neutralisieren

Auftrag: `PLAN-ANBIETER-PORT.md` Teil 2, Phase B3. Vertrag: `src/llm/ports.js` (B2, gemergt
`50ba426`, **bindend**). Vorher-Werte: `tasks/b3-vorher-werte.md` (erhoben 2026-08-08).

**Regel dieser Spec: nur Gemessenes.** Jede Aussage ueber den Bestand traegt einen Beleg
(Datei + Symbol; Zeilennummern nur, wo sie in dieser Session selbst nachgeschlagen wurden).
Was nicht belegt ist, steht unter "Weisse Flecken" und nennt, wer es beantwortet.

**Stand des Repos beim Schreiben dieser Spec:** `master` = `5f296ef`, Arbeitsbaum sauber.
Suite-Stand `4007/4007, Exit 0` ist der bei B2 am selben Commit gemessene Wert
(`tasks/todo.md`, Abschnitt B2) — in dieser Spec **nicht neu gemessen**.

---

## 0. Bindende Entscheidungen dieser Phase

| # | Entscheidung | Kurzbegruendung (Beleg in Abschnitt 3/4) |
|---|---|---|
| **E1** | **Der PORT normalisiert.** `complete`/`completeStream` liefern `LlmTurn`; `claude.js` liest `text`/`toolCalls`/`usage` und reicht `providerTurn` opak zurueck. Die Anthropic-Kenntnis zieht vollstaendig in `src/llm/adapters/anthropic.js`. | B2 hat es bereits entschieden (`LlmTurn.providerTurn` ist gemergt). Die verlustfreie Ruecktrage ist **nur** so konstruktiv erreichbar, nicht durch eine Uebersetzung ueber eine fremde Zwischenform. Abschnitt 4. |
| **E2** | **Die Abnahme ist die BYTE-GLEICHHEIT des ausgehenden Anfrage-Bodys**, nicht ein Urteil ueber Gespraechsqualitaet. | 36 Testdateien haengen den Anthropic-Client per `ANTHROPIC_BASE_URL` an einen lokalen HTTP-Mock; 15 davon pruefen den Anfrage-Body. Der Draht ist damit messbar, mechanisch und falsifizierbar. Abschnitt 3.5. |
| **E3** | **B3 wird in zwei getrennt abgenommenen Schnitten gefahren: B3a (Antwortseite) und B3b (Anfrageseite).** Beide stehen VOR B5; der Schnitt trennt die Abnahmen, nicht die Notwendigkeit. | Abschnitt 6. |
| **E4** | **Die gebuchten Cent-Betraege aendern sich in B3 um NULL.** `llm-usage.js` bekommt die neutrale Verbrauchsform und rechnet daraus exakt dieselbe Zahl wie heute. Die Raten je Token-Sorte sind **B4**. | Absolute Regel 1. Ein Umbau, der Neutralisierung UND Buchungsbetrag zugleich aendert, macht einen spaeteren Fehler nicht mehr zuordenbar. |
| **E5** | **`precall-briefing.js` bleibt am Port, aber die Recherche-Suchzahl wandert auf die opake Ruecktrage** (`PrecallResearchProvider.searchCount` bekommt `providerTurn` statt `usage`). | Ohne diese Aenderung liefert `searchCount` gegen eine neutrale `usage` immer `null` -> der Aufrufer bucht **jedes Briefing** mit dem pessimistischen Deckel. Das ist ein stiller Geldpfad-Defekt. Abschnitt 5.6. |
| **E6** | **`LlmRequest` bekommt EIN neutrales Feld dazu: `cachePrefix` (Boolean, Default false).** Vertragsergaenzung zu B2, mit heutigem Aufrufer. | Ohne sie ist E2 unerreichbar: heute traegt **nur** `agentTurn` `cache_control`, `summarizeCall` und `fetchPrecallBriefing` nicht. Eine adapter-interne Faustregel wuerde deren Draht-Body veraendern. Abschnitt 5.3. **Braucht Lead-Bestaetigung, weil B2 gemergt und bindend ist.** |
| **E7** | **Zwei Metrik-Schluessel behalten ihre Anthropic-Namen** (`cache_creation_input_tokens`, `cache_read_input_tokens` in `metrics.llmCall`). Der Seam bildet sie aus der neutralen Verbrauchsform. | `test/llm.test.js` und `test/l0-metrics.test.js` pinnen den Payload-Schluesselsatz woertlich. Ein Rename ist eine eigene Entscheidung, kein Seiteneffekt von B3. Bewusst akzeptierte Abweichung von Bedingung (c), Abschnitt 5.5. |
| **E8** | **Vor dem Nachher-Bench werden zwei Szenarien der Basismessung NEU erhoben** (`d3-fremde-recherche`, `d3-nachschlag-auftrag`). | 8 von 80 Baseline-Laeufen sind **keine Messung**, sondern an einem erschoepften Anthropic-Guthaben gestorben. Abschnitt 3.6. |

---

## 1. Was B3 ist — und was die Frage genau lautet

Der Plan formuliert die Frage so: *"wo liegt die Grenze — normalisiert der Port, oder bekommt
`claude.js` eine neutrale Form?"* Am Code zerfaellt sie in drei unabhaengige Teilfragen, die
getrennt zu beantworten sind:

1. **Antwortseite** — wer uebersetzt `content`-Bloecke in "Text + Werkzeugaufrufe + Verbrauch"?
2. **Ruecktrage** — in welcher Form geht die Antwort einer Runde in die naechste Anfrage zurueck,
   ohne Information zu verlieren?
3. **Anfrageseite** — wer baut `system`/`messages`/`tools`/`tool_choice` in Anbieter-Form?

B2 hat 1. und 2. bereits entschieden (`LlmTurn` mit `text`/`toolCalls`/`usage` und der opaken
`providerTurn`). Offen war 3. — B2 typisiert `system`/`messages`/`tools` als `*` mit dem Zusatz
*"innere Form ist NICHT Teil dieses Vertrags"* und benennt das selbst als **die Kante, an der
der Vertrag reisst, wenn B3 sie nicht schliesst** (`tasks/todo.md`, B2-Befund 2).

---

## 2. Vorbedingungen

- `src/llm/ports.js` ist auf `master` (B2). Diese Spec aendert ihn an **genau einer** Stelle (E6)
  und beschreibt eine zweite Praezisierung (E5, betrifft `src/research/ports.js`, nicht `llm/ports.js`).
- `tasks/b3-vorher-werte.md` existiert. **Er wird nicht neu gemessen** — bis auf die zwei
  Szenarien aus E8, deren Baseline nachweislich unbrauchbar ist.
- Kein DeepSeek-Adapter, keine Preistabelle, keine Provider-Auswahl in dieser Phase.

---

## 3. Der am Code gepruefte Bestand

### 3.1 Der Seam und seine vier Aufrufstellen

`src/llm.js` (380 Zeilen) importiert das Anthropic-SDK direkt (`:19`) und konstruiert den
Client (`:252`). Er exportiert `createLlmClient`, das `{complete, completeStream}` liefert
(`:379`).

**Es gibt genau vier Aufrufstellen, in zwei Client-Instanzen** (gegruept ueber
`createLlmClient|llm\.complete|completeStream` in `src/`):

| Aufrufstelle | Instanz | Art |
|---|---|---|
| `claude.js` `completeRound` -> `llm.complete(params)` (`:793`) | `claude.js:34` | Gespraechsrunde, nicht gestreamt |
| `claude.js` `completeRound` -> `llm.completeStream({...})` (`:799`) | dieselbe | Gespraechsrunde, gestreamt — **der Live-Sprechpfad** |
| `claude.js` `summarizeCall` -> `llm.complete({...})` (`:1275`) | dieselbe | Nachbereitung, kein Sprechpfad |
| `precall-briefing.js` -> `briefingLlm.complete({...})` (`:283`) | `precall-briefing.js:117` | vor dem Waehlen, eigener Breaker |

Die zweite Instanz ist Absicht und dokumentiert (`precall-briefing.js:111-116`): *"ein
Briefing-Ausfall darf den prozessweiten Gespraechs-Breaker NICHT in open kippen"*. **Diese
Trennung bleibt in B3 unangetastet.**

Weitere Konsumenten des Seams, die KEINE Modellrunde fahren, aber seine Exporte lesen:

- `src/routes/voice.js:33` — `degradedSpeechFor`
- `src/telnyx-llm-shim.js:14` — `degradedSpeechFor`, `isProviderBillingError` (`:905`)
- `src/claude.js:3`, `src/precall-briefing.js:27` — `attemptReachedProvider`

### 3.2 Die Beruehrungspunkte mit Anbieter-Markup — gezaehlt, nicht geschaetzt

Reproduzierbar (Kommentarzeilen herausgefiltert):

```
grep -nE '(resp\.content|resp\.usage|resp\.stop_reason|type: *"tool_result"|tool_use_id|input_schema|cache_control|max_tokens|tool_choice)' src/claude.js | grep -v ':\s*//'
```

**`src/claude.js`: 20 Code-Zeilen, gruppiert in 9 Stellen.**

| # | Stelle | Zeilen | Was daran Anbieter-fest ist |
|---|---|---|---|
| 1 | `toolDefs`, `getConsultToolDef`, `lookUpToolDef` | 459, 472, 490, 525 | Schluessel `input_schema` (OpenAI: `function.parameters`) |
| 2 | `toolsWithCacheControl` + Anfrage | 554, 1001 | `cache_control` (Anthropic-only) |
| 3 | Anfrage-Deckel | 1000, 1279 | `max_tokens` (Vertrag: `maxTokens`) |
| 4 | System-Blockform | 1001 | `[{type:"text", text, cache_control}]` vs. String bei `summarizeCall` (`:1282`) — **zwei verschiedene Formen in derselben Datei** |
| 5 | Verbrauch | 794, 804, 1291 | `resp.usage` in Anthropic-Feldnamen |
| 6 | Textextraktion | 1023, 1295, 1298 | `resp.content.filter/find(b => b.type === "text")` |
| 7 | Werkzeugaufrufe | 1032 | `resp.content.filter(b => b.type === "tool_use")` |
| 8 | **Die Ruecktrage** | 1122 | `{ role: "assistant", content: resp.content }` |
| 9 | Werkzeug-Ergebnisse | 1130, 1131, 1135, 1136 | `type:"tool_result"` + `tool_use_id`, alle Ergebnisse in EINER `user`-Nachricht (OpenAI: N Nachrichten `role:"tool"`) |

**`src/precall-briefing.js`: 9 Code-Zeilen, 6 Stellen** — `input_schema` (`:60`),
`resp.content.find(... type==="tool_use" ...)` (`:201`), `tool_choice` (`:235`, `:236`, `:289`),
`max_tokens` (`:285`), `resp.usage` (`:307`, `:308`), `resp.stop_reason` (`:315`).

**`src/llm-usage.js`: 3 Stellen** — `inputTokensOf` liest `input_tokens` +
`cache_creation_input_tokens` + `cache_read_input_tokens` (`:21-27`); `billedTokens` liest
`usage.output_tokens` (`:60`); `estimatedAbortUsage` **erzeugt** eine Anthropic-geformte
`usage` (`:96-101`), Kommentar dort woertlich: *"Form wie eine Anthropic-usage"*.

**`src/llm.js`: der ganze Rest** — `metricsExtra` (`:224-232`), `isTextDelta` (`:236-238`),
die Stream-Ereignisse `content_block_start`/`content_block.type === "tool_use"|"text"`
(`:354-359`), `stream.finalMessage()` (`:365`), `Anthropic.APIConnectionError` (`:134`),
`Anthropic.APIUserAbortError` (`:367`), der Guthaben-Textmarker `CREDIT_EXHAUSTED_MARKER`
(`:94`). **Das ist kuenftig legitimes Adapter-Wissen** — es zieht um, es verschwindet nicht.

Der Plan nennt "13 Beruehrungspunkte in `claude.js`". Meine Zaehlung liefert 9 Stellen /
20 Zeilen — dieselbe Groessenordnung, andere Granularitaet. Massgeblich ist der Grep oben.

### 3.3 W1 beantwortet: was der Shim heute uebersetzt

**Belegt:** `grep -c 'tool_calls' src/telnyx-llm-shim.js` = **0** (in dieser Session
nachgeprueft; der Bezeichner kommt in der Datei nicht vor).

**Eingangsseite** (was der Shim aus dem Telnyx-Request liest) — `src/telnyx-llm-shim.js`:

| Symbol | Was es tut |
|---|---|
| `messagesArray(body)` (`:85`) | Array-Guard auf `body.messages`, sonst `[]` |
| `lastUserText(body)` (`:93-100`) | sucht **rueckwaerts** die letzte Nachricht mit `role === "user"` und **String**-Content und liefert genau diesen String |
| `callControlIdFromForwardedMetadata` (`:77`) | Korrelation ueber `extra_metadata.call_control_id` — nichts mit Nachrichtenform |
| `boundedRole`/`roleCounts`/`lastMessageRole`/`lastUserContentShape` (`:117-152`) | PII-freie Form-Diagnose fuer den Log (Zaehler, Typnamen, Laengen) |

Der Kommentar bei `lastUserText` (`:90-92`) sagt die Absicht woertlich: *"Der Shim nutzt NUR
die neueste Aeusserung als callerText; die Gespraechs-Historie lebt im Store (call.transcript,
agentTurn baut sie frisch) — kein Vertrauen in die vom Provider gespiegelte messages-Kette."*

**Das ist keine Uebersetzung, das ist eine Reduktion:** ein OpenAI-Payload wird auf **einen
String** eingedampft. Es gibt keine Rollen-Abbildung, keine Werkzeug-Abbildung, keine
Verlaufs-Abbildung.

**Ausgangsseite** (was der Shim an Telnyx zurueckschreibt) — `completionEnvelope` (`:216`),
`streamChunk` (`:231`), `makeStreamingResponse` (`:242`), `writeStreamingCompletion` (`:294`),
`writeJsonCompletion` (`:300`), `writeCompletion` (`:312`). Alle sechs nehmen **einen String**
und rendern daraus die OpenAI-Draht-Huelle. Kein einziger erzeugt `tool_calls`.

**Antwort auf W1: NEIN, nichts davon ist fuer die Ausgangsseite eines LLM-Adapters
wiederverwendbar.** Der Grund ist strukturell, nicht zufaellig — **die Rolle ist invertiert**:

| | Shim (heute) | LLM-Adapter (B5) |
|---|---|---|
| Rolle | **Server**: empfaengt OpenAI-Requests, antwortet OpenAI | **Client**: sendet OpenAI-Requests, liest OpenAI-Antworten |
| `messages[]` | **liest** (und wirft weg) | **schreibt** (Verlauf inkl. Werkzeug-Ergebnisse) |
| `tools[]` | beruehrt es nie | **schreibt** es |
| `choices[].delta` | **schreibt** es | **liest** es |
| `tool_calls` | kommt nicht vor | **die Kernaufgabe** |

Die einzige echte Ueberschneidung sind fuenf Draht-Literale (`chat.completion.chunk`,
`"stop"`, `"assistant"`, `data: [DONE]`, `choices[0].delta.content`). Sie zwischen einem
Ingress- und einem Egress-Modul zu teilen, koppelte zwei Module mit **entgegengesetzter**
Rolle ueber fuenf Strings ohne gemeinsame Invariante. **Empfehlung: nicht teilen.**

Wiederverwendbar ist das **Muster**, nicht der Code: genau eine Grenzfunktion je Richtung,
fail-closed bei unbekannter Form (`asObject` `:55`, `boundedRole` `:117-120`,
`lastUserContentShape` `:141-152`).

### 3.4 Was bereits neutral ist — und deshalb nicht angefasst wird

Drei Befunde, die den Umbau kleiner machen als erwartet:

1. **Die beiden Werkzeug-Entscheider lesen schon die neutrale Form.**
   `decideConsultRequest(call, toolUses)` (`src/consult/in-call.js:122`) und
   `performLookupRequest({call, toolUses, ...})` (`src/research/in-call.js:93`) dokumentieren
   ihren Parameter beide als `Array<{name: string, input?: object}>` (`:118` bzw. `:89`) und
   lesen ausschliesslich `tu.name` und `tu.input?.…` (`:123`/`:137`, `:94`/`:103`). Das ist
   `LlmToolCall` **minus `id`** — ein Vertrag, den die neutrale Form erfuellt.
   **-> Null Aenderung in beiden Dateien.**

2. **Der Verlauf ist schon neutral.** `agentTurn` baut ihn als
   `{role: "assistant"|"user", content: <String>}` (`claude.js:877-880`). Diese Form nehmen
   beide Anbieterwelten unveraendert an.

3. **Das Haus uebersetzt Werkzeug-Schemata bereits an genau einer Stelle je Konsument.**
   `realtimeTools` (`src/bridge.js:78-83`) bildet `toolDefs()`-Eintraege auf die
   Realtime-Form ab, inkl. `parameters: t.input_schema` (`:83`). Der Kommentar darueber
   (`:73`) nennt es: *"Claude-Tool-Schema (input_schema) -> Realtime-Function-Schema
   (parameters)"*. **Das ist der Praezedenzfall fuer E1** — und zugleich ein **Caller, der
   mitgeaendert werden MUSS**, sobald `toolDefs()` den Schluessel wechselt (Abschnitt 5.3).

### 3.5 Wie die Testsuite den LLM anbindet — der entscheidende Hebel

**36 Testdateien** setzen `process.env.ANTHROPIC_BASE_URL` auf einen lokal gestarteten
`node:http`-Server und lassen das echte SDK dagegen laufen (z. B.
`test/al-p4-side-effect-tool-loop.test.js:66`, `test/l3-prompt-caching.test.js`,
`test/llm-message-chain-language.test.js`). Die Mocks antworten mit **vollstaendigen
Anthropic-Messages** (`{id, type, role, model, content:[…], stop_reason, usage}`).

**Folge, und das ist der wichtigste Satz dieser Spec:** solange der Adapter denselben
HTTP-Body sendet und dieselbe HTTP-Antwort verarbeitet, bleiben **alle 36 Dateien unveraendert
gruen** — sie testen dann den Adapter statt `llm.js` direkt, ohne eine Zeile Aenderung. Der
Umbau ist damit gegen einen Bestandstest-Korpus messbar, den niemand anfassen muss.

**15 Dateien pruefen zusaetzlich den ausgehenden Request-Body** (`bodies.push`/`lastBody`):
`al-d1-cause-diagnostics`, `al-d2-thinking-signal-diagnostics`, `al-p10b-lookup`,
`al-p14-in-call-consult`, `al-p17-first-round-audible`, `al-p4-side-effect-tool-loop`,
`al-p6-turn-deadline-budget`, `al-p7-turn-streaming`, `al-p7b-turn-bridge`,
`gq-p1-agent-turn-abort`, `gq-p2-consult-deadline`, `gq-p8-consult-arrival-marker`,
`l3-prompt-caching`, `llm-message-chain-language`, `prompt-en-call-e2e`.

Die schaerfsten Pins, einzeln nachgesehen:

| Test | Was er festnagelt |
|---|---|
| `test/l3-prompt-caching.test.js` | System-Block-**Form** inkl. `cache_control`, `cache_control` **nur** am letzten Tool, Tool-Inhalt byte-identisch, und dass das Budget-Gate die Cache-Token mitzaehlt |
| `test/al-p10-precall-research.test.js:150-166` | `tools.length`, `tools[0].name`, `deepEqual(tools[1], {type:"web_search_20250305", name:"web_search", max_uses})`, `deepEqual(tool_choice, {type:"tool", name:"hintergrund"})` bzw. `{type:"any"}` |
| `test/cq-p8-briefing.test.js:365` | `lastRequest.tools[0].input_schema.properties.open_questions` |
| `test/al-p7-llm-stream.test.js:107,160` | **`assert.deepEqual(resp, FINAL)`** — der Rueckgabewert von `completeStream` ist heute *exakt* die Anthropic-Endnachricht |
| `test/llm.test.js:242-274` | Metrik-Payload traegt `cache_creation_input_tokens`/`cache_read_input_tokens`, und traegt sie **nicht**, wenn sie fehlen |
| `test/l0-metrics.test.js:60-68` | derselbe Payload-Schluesselsatz, woertlich |

**Was KEIN Bestandstest prueft — und genau das ist die Gefahrenstelle:**

`grep -rn 'tool_use_id|tool_result' test/` liefert ausschliesslich Treffer in
`test/llm-message-chain-language.test.js` und `test/e2e-06-en-purity-aggregate.test.js`, und
dort nur als **Text-Suche nach deutschen Konstanten** im Nachrichtenverlauf
(`messageChainContains`, `:104`), nicht als Formpruefung. **Die STRUKTUR der Ruecktrage
(`{role:"assistant", content: resp.content}`) und der `tool_result`-Bloecke ist von keinem
Test festgenagelt.** Ein Adapter, der die Ruecktrage still verkuerzt, faellt heute durch
kein Netz.

**-> B3 braucht einen neuen Test.** Abnahme A3, Abschnitt 7.

### 3.6 Befund am Vorher-Wert: 8 von 80 Baseline-Laeufen sind keine Messung

Beim Nachrechnen der Basismessung (`data/convo-bench/baseline-shim-2026-08-08/`, 81 Dateien =
80 Berichte + `summary.json`) gemessen:

```
ended_via-Verteilung: agent_hangup 62, turn_cap 10, persona_error 8
```

Alle **8** `persona_error`-Laeufe tragen woertlich
`"Your credit balance is too low to access the Anthropic API"` in `persona_error` **und** in
`judge.error`:

| Szenario | Laeufe | davon verwertbar |
|---|---|---|
| `d3-fremde-recherche` | 5 | **0** |
| `d3-nachschlag-auftrag` | 5 | **2** |

**Konsequenzen, die in `tasks/b3-vorher-werte.md` heute anders stehen:**

- *"`d3-fremde-recherche` 50/50 Checks = 100 %"* ist ein Artefakt: die Laeufe haben
  `checks_passed 10/10` auf einem Gespraech, das nach 2 Turns am Guthaben starb.
  *"kein Werkzeug, 0/5"* ist deshalb **kein Befund ueber die Werkzeugwahl**.
- *"ohne Urteil 5"* bzw. *"ohne Urteil 3"* ist nicht Judge-Schweigen, sondern **HTTP 400 des
  Judge-Aufrufs aus demselben Grund**.
- `cost_estimate_usd.total_usd` ist bei 7 der 8 Laeufe `0` — die Gesamtkosten 1,8761 USD sind
  also die Kosten von **72** vollstaendigen Gespraechen, nicht von 80.

**Unabhaengige Gegenrechnung der Werkzeug-Tabelle** (aus `metrics.turns[].tools`, nicht aus
dem Transkript): `end_call` 62/80, `take_message` 25/80, `get_consult` 5/80, `look_up` 3/80 —
**exakt die Zahlen aus `tasks/b3-vorher-werte.md`**. Die Tabelle stimmt; nur ihre Deutung fuer
die zwei d3-Szenarien traegt nicht.

**-> E8:** die Vorher-Werte fuer `d3-fremde-recherche` und `d3-nachschlag-auftrag` werden VOR
dem Umbau neu erhoben (je 5 Laeufe, geschaetzt ~0,26 USD), als Nachtrag in
`tasks/b3-vorher-werte.md`. Und: **vor jedem Bench-Lauf wird das Anthropic-Guthaben
geprueft** — sonst wiederholt sich derselbe Ausfall und 2 USD Messung sind weg.

---

## 4. Die Architektur-Entscheidung, am Code begruendet

Der Plan **empfiehlt** "der Port normalisiert" mit dem Argument *"`claude.js` hat 1311 Zeilen
und 13 Beruehrungspunkte; ein Umbau dort ist ein Umbau am Live-Sprechpfad"*. Diese Begruendung
ist **unvollstaendig**: sie legt nahe, `claude.js` bliebe unveraendert. Das ist falsch — bei
jeder Variante, die die Antwortseite neutralisiert, aendert sich `claude.js`. Die Frage ist
nicht **ob**, sondern **wie oft** und **in welcher Richtung**.

### Die drei tatsaechlich verfuegbaren Varianten

**V1 — Neutraler Port, Aufrufer lernen die neutrale Form.** (Das ist, was `src/llm/ports.js`
woertlich beschreibt.)
`LlmTurn{text, toolCalls, usage, providerTurn, stopReason}`; `claude.js` liest neutral.

- Blast-Radius `claude.js`: 9 Stellen / 20 Zeilen, **einmalig**.
- Blast-Radius `precall-briefing.js`: 6 Stellen / 9 Zeilen.
- `llm.js` -> Seam + `adapters/anthropic.js`.
- Bestandstests: 36 Draht-Dateien **unveraendert**; 2 Seam-Unit-Dateien brechen an
  `assert.deepEqual(resp, FINAL)` (`al-p7-llm-stream.test.js:107,160`) und sind anzupassen.
- Ruecktrage: **verlustfrei by construction** — der Adapter reicht seine eigene Antwort
  unveraendert an sich selbst zurueck.

**V2 — Der Aufrufer normalisiert** (`claude.js` traegt je Anbieter eine Uebersetzung).

- Verstoesst frontal gegen B2-Bedingung (a) "genau EINE Uebersetzungsstelle je Anbieter":
  die Uebersetzung entstuende **zweimal** (`claude.js` und `precall-briefing.js`).
- Setzt Anbieter-Fallunterscheidungen in den Live-Sprechpfad — genau dorthin, wo sie laut
  Absolute Regel 1 am wenigsten hingehoeren.
- **Verworfen.**

**V3 — Anthropic-Form als Hausform; der Fremdadapter uebersetzt NACH Anthropic-Form.**

Das ist die einzige Variante mit **null** Aenderung in `claude.js`, und sie muss ernsthaft
geprueft werden, weil "null Aenderung am Live-Pfad" ein starkes Argument ist.

- **Dagegen 1 (entscheidend): die Ruecktrage wird zur Rundreise.** Der Verlauf muesste
  OpenAI -> Anthropic -> OpenAI wandern. Jede Rundreise durch eine fremde Zwischenform ist
  genau der Ort, an dem Information leise verschwindet (Werkzeug-ID-Format, Reihenfolge
  mehrerer `tool_calls`, anbieter-eigene Zusatzfelder). `providerTurn` existiert in B2
  ausdruecklich, um diese Rundreise zu vermeiden.
- **Dagegen 2: der Adapter muesste Anthropic-IDs erfinden.** OpenAI-`tool_call.id` und
  Anthropic-`tool_use.id` haben verschiedene Formate; auf dem Rueckweg muesste die Zuordnung
  wieder aufgeloest werden — eine selbstgebaute Korrelationsschicht ohne Not.
- **Dagegen 3: der Vertrag ist gemergt.** `LlmTurn.text`/`toolCalls`/`providerTurn` stehen in
  `src/llm/ports.js` auf `master`. V3 macht `providerTurn` bedeutungslos und `text`/`toolCalls`
  zu Duplikaten der `content`-Liste. B3 waere dann eine Rueckabwicklung von B2, nicht seine
  Umsetzung.
- **Dagegen 4: eine Anbieterform als Hausform ist genau die Kopplung, die der Track abbauen
  soll.** Ein Feature, das sich nicht in Anthropic-Bloecke abbilden laesst, waere strukturell
  unerreichbar.
- **Dafuer:** null Diff im Live-Sprechpfad; alle 36 Draht-Tests bleiben gruen ohne jede
  Ueberlegung.

### Entscheidung: **V1** (= E1)

Und der Preis von V3 wird dabei **eingeloest statt bezahlt**: der Grund, aus dem V3 attraktiv
wirkt ("keine Aenderung am Draht"), gilt bei V1 genauso — denn V1 aendert den **ausgehenden
HTTP-Body nicht**. Der Anthropic-Adapter baut byte-identisch dasselbe, was `claude.js` heute
baut. **Das ist keine Hoffnung, das ist eine Abnahmebedingung (E2)** und mit den 15
body-pruefenden Bestandstests plus einem neuen Golden-Master messbar.

V1 verlegt die Aenderung dorthin, wo sie ueberpruefbar ist (der Body), statt dorthin, wo sie
unsichtbar ist (eine Uebersetzungs-Rundreise im Adapter).

---

## 5. Der Entwurf

### 5.1 Dateien

| Datei | Aenderung |
|---|---|
| `src/llm/ports.js` | **+1 Feld** `LlmRequest.cachePrefix` (E6). Sonst unveraendert. |
| `src/llm/adapters/anthropic.js` | **neu** — das gesamte Anthropic-Wissen: SDK-Konstruktion, Anfrage-Bau (`system`/`messages`/`tools`/`tool_choice`/`max_tokens`/`cache_control`), Antwort-Lesen (`content`-Bloecke, `usage`), Stream-Ereignisse, Fehlerklassifikation (`isTransient`, `isBillingError`), `limits`. |
| `src/llm.js` | wird **reiner Seam**: Breaker, Retry, Backoff, Wanduhr, Metrik, `LlmUnavailableError`, `attemptReachedProvider`, `degradedSpeechFor`. Kein `import Anthropic`. |
| `src/claude.js` | 9 Stellen auf die neutrale Form; `cache_control` und `CACHE_CONTROL_EPHEMERAL` **entfallen ersatzlos** (zieht in den Adapter). |
| `src/precall-briefing.js` | 6 Stellen; `tool_choice`-Literale -> `toolChoice: {tool: NAME}` / `"required"`. |
| `src/llm-usage.js` | nimmt `LlmTokenUsage` entgegen; **Rechenergebnis unveraendert** (E4). |
| `src/bridge.js` | `realtimeTools` (`:78-83`) zieht den Schluesselwechsel `input_schema` -> `parameters` nach. |
| `src/research/ports.js` + `adapters/anthropic-web-search.js` | `searchCount(providerTurn)` statt `searchCount(usage)` (E5). |
| `test/…` | 2 Seam-Unit-Dateien angepasst; **1 neue Golden-Master-Datei**; die 15 body-pruefenden Bestandsdateien **unveraendert**. |

**Keine Registry in B3.** Es gibt genau einen Adapter; die Auswahl (`LLM_PROVIDER`, Tabelle
nach Muster `telephony/registry.js`) ist **B5**. Eine Tabelle mit einem Eintrag und ohne
zweiten Kandidaten waere Indirektion ohne Mehrwert (Clean Code S4).

### 5.2 Antwortseite — `LlmTurn`

Der Adapter baut aus der Anthropic-Antwort:

| Feld | Quelle heute | Wo die Logik hinwandert |
|---|---|---|
| `text` | `claude.js:1023` — `content.filter(type==="text").map(b=>b.text).join(" ").trim()` | Adapter. Die **Fuge `" "`** ist bindend: `llm.js:359` schiebt zwischen zwei Textbloecken genau dieses Zeichen in den Sink, damit gestreamter und zusammengesetzter Text identisch sind (`LlmTurn.text`-Zusicherung in `ports.js`). |
| `toolCalls` | `claude.js:1032` — `content.filter(type==="tool_use")` | Adapter, als `{id, name, input}`. `input` ist bei Anthropic bereits ein Objekt; die JSON-String-Variante ist DeepSeek-Sache (B5). |
| `usage` | `resp.usage` | Adapter -> `LlmTokenUsage`: `inputUncachedTokens = input_tokens`, `inputCacheWriteTokens = cache_creation_input_tokens ?? 0`, `inputCacheReadTokens = cache_read_input_tokens ?? 0`, `outputTokens = output_tokens`, `estimated = false`, `billingModelId = <angeforderte ID>`. Die angeforderte ID ist die belegte Entscheidung (`llm-usage.js:55-58`, B1: 0/88 Abweichungen). |
| `providerTurn` | `claude.js:1122` — `resp.content` | Adapter. **Traegt die GANZE Anbieter-Antwort**, nicht nur `content` — B2 laesst die innere Form ausdruecklich offen, und E5 braucht `usage.server_tool_use`. Der Adapter zieht `content` selbst heraus, wenn er die Ruecktrage in die naechste Anfrage einbaut. |
| `stopReason` | `resp.stop_reason` | Adapter, unveraendert durchgereicht (reine Diagnose). |

`claude.js` danach:

```
const textParts …            ->  if (turn.text) { speech = turn.text; speechStreamed = Boolean(sink); }
const toolUses = …           ->  const toolCalls = turn.toolCalls;
bookReal(resp.usage)         ->  bookReal(turn.usage)
resp.content.find(type text) ->  turn.text            (summarizeCall, 2 Stellen)
```

**`summarizeCall` wird mitgezogen, obwohl es kein Sprechpfad ist.** Grund: sonst bliebe in
derselben Datei ein zweiter Leser von `resp.content` stehen — die Bedingung (c) waere
teilweise erfuellt, was schlechter ist als offen abgelehnt (ein halb neutralisiertes
`claude.js` laedt den naechsten Leser ein, das Muster zu kopieren).

### 5.3 Anfrageseite — `system` / `messages` / `tools` / `toolChoice` / `cachePrefix`

**`tools` — neutrale Werkzeug-Definition.**

```
LlmToolDef = { name: string, description: string, parameters: object /* JSON-Schema */ }
```

Adapter Anthropic: `{name, description, input_schema: parameters}`.
Adapter OpenAI (B5): `{type:"function", function:{name, description, parameters}}`.
**Praezedenz im Haus:** `bridge.js:78-83` macht die zweite Abbildung heute schon.

Betroffen: `toolDefs` (`claude.js:447`), `getConsultToolDef` (`:485`), `lookUpToolDef`
(`:520`), `briefingTool` (`precall-briefing.js:55`) — reiner Schluesselwechsel.
**Pflicht-Nachzug: `bridge.js:83`** (`parameters: t.input_schema` -> `parameters: t.parameters`).
`agentToolNames` (`claude.js:538`) liest nur `.name` und bleibt unberuehrt.

**`system` — ein String.** Heute drei verschiedene Formen: Blockliste mit `cache_control`
(`claude.js:1001`), nackter String (`claude.js:1282`), nackter String
(`precall-briefing.js:287`). Neutral: **immer ein String**. Der Adapter entscheidet die
Draht-Form.

**`cachePrefix` (E6) — warum ein zusaetzliches Feld unvermeidlich ist.** Wuerde der Adapter
Caching-Marker nach einer eigenen Faustregel setzen, aenderte sich der Body von
`summarizeCall` und `fetchPrecallBriefing` (beide haben heute **kein** `cache_control`) — E2
waere verletzt. Die Regel "wer bekommt Caching" ist heute Aufrufer-Wissen und hat genau einen
Nutzer (`agentTurn`). Also: `cachePrefix: true` nur dort.

- Anthropic-Adapter bei `true`: System-Block als `[{type:"text", text, cache_control:
  {type:"ephemeral"}}]` **und** `cache_control` am letzten Tool — byte-identisch zu heute
  (`toolsWithCacheControl`, `claude.js:550-556`), damit `test/l3-prompt-caching.test.js`
  **unveraendert** gruen bleibt.
- Anthropic-Adapter bei `false`: `system` als String, keine Marker — byte-identisch zu heute.
- DeepSeek-Adapter (B5): **No-op mit Beleg**, kein Stub. B1 hat `prompt_cache_hit_tokens`
  ohne jeden client-seitigen Marker gemessen; der Cache ist dort automatisch.

B2 hatte Cache-Steuerung mit *"Vorratshaltung ohne zweiten Aufrufer"* ausgeschlossen. B3
misst am Code: es gibt einen Aufrufer **und** einen zweiten Anbieter mit belegter Semantik.
**Das ist eine begruendete Vertragsergaenzung, keine Umgehung — sie braucht dennoch die
ausdrueckliche Bestaetigung des Leads, weil `src/llm/ports.js` gemergt und bindend ist.**

**`messages` — die neutrale Kette (der Kern von B3).**

```
LlmMessage =
  | { role: "user",      text: string }        // Anrufer-Zeile / Steuermarker
  | { role: "assistant", text: string }        // Agent-Zeile aus dem Store-Transkript
  | { role: "assistant", providerTurn: * }     // Ruecktrage EINER Modellrunde (opak)
  | { role: "toolResults", results: LlmToolResult[] }
```

Abbildung im Anthropic-Adapter:

| neutral | Anthropic |
|---|---|
| `{role:"user"\|"assistant", text}` | `{role, content: text}` — byte-identisch zu `claude.js:877-880` |
| `{role:"assistant", providerTurn}` | `{role:"assistant", content: providerTurn.content}` — byte-identisch zu `claude.js:1122` |
| `{role:"toolResults", results}` | **EINE** `{role:"user", content: results.map(r => ({type:"tool_result", tool_use_id: r.toolCallId, content: r.text}))}` — byte-identisch zu `claude.js:1123-1140` |

Abbildung im OpenAI-Adapter (B5, hier nur zum Beleg, dass die Form traegt):
`providerTurn` = die gespeicherte `choices[0].message` **verbatim**;
`{role:"toolResults"}` = **N** Nachrichten `{role:"tool", tool_call_id, content}`.

**Die 1-zu-N-Asymmetrie ist der eigentliche Grund, warum `messages` neutral werden muss.**
Ein Aufrufer, der eine Anthropic-Nachricht baut, kann sie nicht anbieter-neutral machen —
die Anzahl der Nachrichten haengt vom Anbieter ab.

**`toolChoice`.** `{type:"tool", name}` -> `{tool: name}`; `{type:"any"}` -> `"required"`.
Der dreiwertige Vertrag aus B2-Befund 1 wird damit erstmals benutzt. `agentTurn` setzt
`toolChoice` **nicht** (heute kein `tool_choice` im Turn-Body) — das bleibt so.

**`maxTokens`.** `max_tokens` -> `maxTokens` an allen drei Anfragestellen; der Adapter
uebersetzt zurueck.

### 5.4 Die Ruecktrage im Tool-Loop

Vorher (`claude.js:1120-1141`):

```js
messages = [...messages,
  { role: "assistant", content: resp.content },
  { role: "user", content: toolUses.map(tu => ({ type:"tool_result", tool_use_id: tu.id, content: … })) }];
```

Nachher:

```js
messages = [...messages,
  { role: "assistant", providerTurn: turn.providerTurn },
  { role: "toolResults", results: toolCalls.map(tc => ({ toolCallId: tc.id, text: … })) }];
```

Die Ergebnistext-Herkunft bleibt **unveraendert**: `endCallWaitInstruction(call)` beim
unterdrueckten `end_call`, sonst `toolResultText({call, toolUse, consult, lookup})`
(`claude.js:826-830`). Nur die Huelle wechselt.

### 5.5 Die drei B2-Bedingungen — wie B3 sie einloest

**(a) Genau EINE Uebersetzungsstelle je Anbieter.**
Erfuellt. Nach dem Umbau existiert Anthropic-Markup ausschliesslich in
`src/llm/adapters/anthropic.js`. Abnahme A5 misst es mit Positiv-Kontrolle.
**Eine benannte Ausnahme:** `src/research/adapters/anthropic-web-search.js` bleibt
Anthropic-spezifisch — das ist sein Zweck und steht in seinem Namen.

**(b) Verlustfreie Ruecktrage.**
Erfuellt **konstruktiv**, nicht durch Sorgfalt: `providerTurn` ist die Antwort des Adapters
an sich selbst. Es gibt keine Uebersetzung, die etwas verlieren koennte. Abnahme A3 belegt
es am Draht: die zweite Anfrage eines mehrrundigen Tool-Loops ist byte-identisch zu heute.

**(c) Kein Anbieter-Markup im Aufrufer.**
Erfuellt fuer `claude.js` — vollstaendig, mit Abnahme A5 als Riegel.
**Zwei benannte, begruendete Abweichungen:**

1. **`metrics.llmCall` behaelt die Schluessel `cache_creation_input_tokens` /
   `cache_read_input_tokens` (E7).** Der Seam bildet sie aus der neutralen Verbrauchsform.
   Grund: `test/llm.test.js:242-274` und `test/l0-metrics.test.js:60-68` pinnen den
   Schluesselsatz woertlich; ein Rename ist eine eigene Entscheidung mit eigener Abnahme.
   Es haengt **kein Verhalten** daran — es sind Log-Schluessel.
2. **`src/research/adapters/anthropic-web-search.js` liest weiter eine Anbieter-Rohform**,
   ab B3 ueber `providerTurn` statt ueber `usage` (E5, Abschnitt 5.6). Der Aufrufer
   (`precall-briefing.js`) **liest sie nicht** — er reicht sie durch. Das ist die Semantik
   einer opaken Ruecktrage, nicht ihr Bruch.

### 5.6 Der Sonderfall, der Geld kostet: die Recherche-Suchzahl (E5)

`searchesToBook(provider, resp.usage)` (`precall-briefing.js:242-245`, Aufruf `:308` und im
Fehlerpfad `:303`) fragt
`anthropicWebSearch.searchCount(usage) = usage?.server_tool_use?.web_search_requests ?? null`
(`research/adapters/anthropic-web-search.js`). `null` bedeutet vertraglich "unbekannt" und
der Aufrufer bucht dann `config.research.researchMaxUses` — den **harten Deckel**.

**Ohne Gegenmassnahme baut B3 hier einen stillen Geldpfad-Defekt:** `LlmTokenUsage` traegt
`server_tool_use` nicht (B2 hat den Verbrauchs-Vertrag bewusst auf vier Token-Sorten
begrenzt). `searchCount` bekaeme ein Objekt ohne das Feld, liefert `null`, und **jedes**
Briefing bucht ab da den Deckel statt der Ist-Zahl. Die Buchung geht auf
`addResearchFeeCostCents` — dieselbe Tenant-Achse wie die Kostendecke.

**Massnahme (E5):** `PrecallResearchProvider.searchCount` nimmt kuenftig die **opake
Ruecktrage** statt der Verbrauchsform:

```
searchCount(providerTurn: *) : number|null
```

- `anthropic-web-search.js`: `providerTurn?.usage?.server_tool_use?.web_search_requests ?? null`
- `precall-briefing.js`: `searchesToBook(provider, turn.providerTurn)` — reicht durch, liest nicht.
- Fehlerpfad (`:303`) uebergibt weiterhin `undefined`; die `?.`-Kette bleibt wurf-frei.
- Fail-safe-Richtung unveraendert: unbekannt -> Deckel -> **ueberbuchen, nie unterbuchen**
  (Regel 1).

**Abnahme dieser Massnahme ist Teil von A3**: `test/al-p10-precall-research.test.js:206-226`
prueft heute schon beide Richtungen (`web_search_requests: 1` -> eine Gebuehr;
`0` -> keine; fehlend -> Deckel). **Diese Datei bleibt unveraendert** und ist damit der Beweis,
dass die Umstellung die Buchung nicht verschoben hat.

**Alternative, falls der Lead E5 ablehnt:** `precall-briefing.js` bleibt ganz vom Port fern
und behaelt einen Anthropic-nahen Client. Kleinere Vertragsflaeche, aber ein zweiter Leser
der Rohform bleibt dauerhaft stehen und der Seam braucht zwei Einstiegspunkte. **Empfehlung:
E5.**

### 5.7 Fehlerklassifikation und Seam-Exporte

Nach `src/llm/ports.js` (`LlmErrorClassification`) gehen `isTransient` und `isBillingError`
in den Adapter; Breaker, Retry, Backoff, `attemptReachedProvider`, der Unavailable-Typ und
die Degradations-Wahl bleiben im Seam.

**Zwei Importpfade duerfen dabei NICHT brechen** (beide im Live-Pfad):

- `src/telnyx-llm-shim.js:14` importiert `degradedSpeechFor` **und** `isProviderBillingError`
  aus `./llm.js` (`:905` ruft es im Catch). -> `llm.js` behaelt einen Export
  `isProviderBillingError(err)`, der an die Klassifikation des aktiven Adapters delegiert.
  Der Shim aendert sich **nicht**.
- `src/routes/voice.js:33` importiert `degradedSpeechFor`. -> bleibt im Seam.

`providerStatusOf` hat ausserhalb von `llm.js` **keinen** Konsumenten (gegruept ueber `src/`,
`test/`, `scripts/`) und wandert als Adapter-Interna mit; der Export entfaellt, wenn kein
Test ihn haelt (sonst bleibt er stehen — das entscheidet die Suite, nicht diese Spec).

---

## 6. Zuschnitt: muss B3 vollstaendig vor B5 stehen?

**Die strategische Lage, unbeschoenigt:** ohne zweiten Adapter ist B3 ein Umbau am
Live-Sprechpfad ohne unmittelbaren Nutzen. Das ist Pre-Mortem-Risiko Nr. 1 des ganzen Plans,
und die Frage danach ist berechtigt.

### Antwort auf die gestellte Frage

**Nein, es gibt keinen kleineren B3, der B5 traegt.** Am Code geprueft:

- Die **Antwortseite** ohne die **Anfrageseite** traegt keinen DeepSeek-Adapter — er bekaeme
  `input_schema`-Werkzeuge, eine Anthropic-System-Blockliste und eine `tool_result`-Nachricht,
  die er in N `role:"tool"`-Nachrichten zerlegen muesste, ohne zu wissen, dass er darf.
- Die **Anfrageseite** ohne die **Antwortseite** ist sinnlos: die Ruecktrage ist Teil der
  Anfrage und entsteht aus der Antwort.
- Die **Ruecktrage** ist der Kern beider und nicht aufteilbar.

**Aber der Schnitt der ABNAHMEN ist teilbar, und das senkt den Blast-Radius echt** (= E3):

| Schnitt | Inhalt | Abnahme |
|---|---|---|
| **B3a** | `llm.js` -> Seam + Adapter; `LlmTurn`/`LlmTokenUsage`; `claude.js` + `precall-briefing.js` lesen neutral; `llm-usage.js` nimmt die neutrale Form; E5. **Der Anfrage-Body wird weiterhin vom Adapter aus den heutigen Anthropic-Strukturen gebaut** (der Adapter nimmt `system`/`messages`/`tools` zunaechst unveraendert entgegen — `ports.js` erlaubt das, sie sind `*`). | A1-A5 + A9. **Kein Bench noetig**: der ausgehende Body ist unveraendert und das ist beweisbar. |
| **B3b** | `system`/`messages`/`tools`/`toolChoice`/`maxTokens`/`cachePrefix` neutral; `bridge.js`-Nachzug; die 1-zu-N-Abbildung der Werkzeug-Ergebnisse. | A1-A5 + A6-A8 (Bench) + A9. |

Warum diese Grenze und keine andere: **B3a aendert den Draht nachweislich nicht** (der Adapter
bekommt dieselben Strukturen und sendet dasselbe), **B3b aendert, WER den Draht baut**. Zwei
Diffs mit je eigener Abnahme statt einem grossen — und wenn nach B3a etwas bricht, ist die
Ursache im Antwort-Lesen, nicht in einer von zwei Baustellen.

### Empfehlung an den Lead: ein Spike VOR B3b

Das Pre-Mortem-Risiko "neutralisiert, aber nie ein zweiter Adapter" laesst sich billig
entschaerfen, **bevor** der teure Teil beginnt:

> Nach B3a, vor B3b: ein **Wegwerf-Spike auf eigenem Branch, der NIE gemergt wird**, der mit
> `scripts/deepseek-b1-messung.mjs` als Bauteil und einer handgeschriebenen Uebersetzung
> **einen** mehrrundigen Werkzeug-Loop gegen `deepseek-v4-pro` faehrt (Text -> `tool_calls`
> -> `role:"tool"` -> Text). Ziel: **W8 beantworten** ("traegt das Modell das Gespraech
> ueberhaupt?" — B1 konnte das mit `max_tokens: 64` nicht messen).

Kosten: Stunden, ein paar Cent API, **null Risiko am Live-Pfad** (nichts wird gemergt).
Nutzen: die Go/No-Go-Entscheidung fuer B3b faellt mit Daten statt mit Hoffnung. Faellt sie
negativ aus, war B3a trotzdem kein Verlust — die neutrale Antwortseite ist die Vorbedingung
fuer B4 (Raten je Token-Sorte brauchen die aufgeschluesselte Verbrauchsform).

**Das ist eine Empfehlung, keine Planaenderung.** Die Reihenfolge entscheidet der Lead.

---

## 7. Abnahme — jeder Punkt ein Kommando mit erwarteter Ausgabe

Alle Kommandos aus dem Repo-Wurzelverzeichnis.

### A1 — Syntax

```
node --check src/llm.js && node --check src/llm/adapters/anthropic.js && \
node --check src/claude.js && node --check src/precall-briefing.js && \
node --check src/llm-usage.js && node --check src/bridge.js && \
node --check src/research/adapters/anthropic-web-search.js
```
**Erwartet:** keine Ausgabe, Exit 0.

### A2 — Regressionssuite

```
npm test
```
**Erwartet:** `fail 0`, Exit 0, und `pass` **>= 4007** (Ausgangsstand am selben Commit laut
`tasks/todo.md`). Ein SINKEN der Zahl ist ein Blocker, auch bei `fail 0` — dann sind Tests
verschwunden statt gruen zu sein.

Zusaetzlich, weil zwei Seam-Unit-Dateien angepasst werden:
```
git diff --stat master..<branch> -- test/
```
**Erwartet:** genau drei Eintraege — `test/al-p7-llm-stream.test.js` (die zwei
`assert.deepEqual(resp, FINAL)` bei `:107`/`:160` lesen jetzt `LlmTurn`), ggf.
`test/llm.test.js`, und **eine neue Datei** (A3). **Jede weitere geaenderte Testdatei ist
begruendungspflichtig** — sie waere ein Hinweis, dass der Draht sich doch verschoben hat.

### A3 — Die Kernabnahme: Byte-Gleichheit des ausgehenden Anfrage-Bodys

**Neu: `test/b3-wire-golden-master.test.js`.** Naht wie
`test/al-p4-side-effect-tool-loop.test.js` (lokaler `node:http`-Mock,
`ANTHROPIC_BASE_URL` + `DATA_DIR` vor dem ersten config-Import). Er nimmt **jeden** ausgehenden
Request-Body auf und vergleicht ihn `deepEqual` gegen ein Fixture.

Abgedeckte Szenarien (die Menge ist der Punkt — jede erreichbare Anfrageform genau einmal):

| # | Ablauf | Was er allein absichert |
|---|---|---|
| G1 | `agentTurn`, eine Runde, nur Text | System-Blockform + `cache_control` + Tool-Liste + Verlauf |
| G2 | `agentTurn`, zwei Runden: Text + `take_message` -> `tool_result` -> Text | **Die Ruecktrage** und die `tool_result`-Nachricht — heute von KEINEM Test geprueft (3.5) |
| G3 | `agentTurn`, zwei Werkzeuge in EINER Runde | Reihenfolge und Vollstaendigkeit der `tool_result`-Bloecke |
| G4 | `agentTurn`, unterdruecktes `end_call` | `endCallWaitInstruction` als `tool_result`-Inhalt |
| G5 | `agentTurn` gestreamt (`onSpeechChunk` gesetzt) | Der Live-Sprechpfad-Body |
| G6 | `summarizeCall` | System als **String**, **kein** `cache_control` |
| G7 | `fetchPrecallBriefing` ohne Recherche-Anbieter | `tool_choice: {type:"tool", name:"hintergrund"}`, ein Werkzeug |
| G8 | `fetchPrecallBriefing` mit Recherche-Anbieter | `tool_choice: {type:"any"}`, zwei Werkzeuge inkl. `web_search_20250305` |

**Fixture-Erzeugung (Reihenfolge ist bindend):**
1. **Auf `master`, VOR jeder Produktionsaenderung**, den Test mit einem `RECORD=1`-Zweig
   fahren, der die Bodies nach `test/fixtures/b3-wire-master.json` schreibt.
2. Fixture im selben Branch committen.
3. Erst danach die Produktionsaenderung.

**Erwartet:** `node --test test/b3-wire-golden-master.test.js` -> `pass 8, fail 0`, Exit 0.

**Pflicht-Gegenprobe (Lehre `Ein Pruefkommando ohne Positiv-Kontrolle kann still 0 melden`,
`tasks/lessons.md`):** der Test MUSS **einmal rot gesehen** werden, bevor man ihm glaubt.
Konkret: im Adapter `cache_control` am letzten Tool weglassen -> Test rot; Aenderung
zuruecknehmen -> Test gruen. **Beides wird im Report protokolliert.** Ein Golden-Master, der
nie rot war, ist von einem Golden-Master ohne Vergleich nicht zu unterscheiden.

### A4 — Die Bestandspins am Draht sind unberuehrt

```
node --test test/l3-prompt-caching.test.js test/llm-message-chain-language.test.js \
  test/al-p10-precall-research.test.js test/cq-p8-briefing.test.js \
  test/al-p4-side-effect-tool-loop.test.js test/al-p7-turn-streaming.test.js \
  test/l0-metrics.test.js
git diff --stat master..<branch> -- test/l3-prompt-caching.test.js \
  test/llm-message-chain-language.test.js test/al-p10-precall-research.test.js \
  test/cq-p8-briefing.test.js test/al-p4-side-effect-tool-loop.test.js \
  test/al-p7-turn-streaming.test.js test/l0-metrics.test.js
```
**Erwartet:** erster Befehl `fail 0`, Exit 0. Zweiter Befehl **leere Ausgabe** — diese sieben
Dateien pinnen den Draht und die Buchung; wurden sie angefasst, ist die Aussage "der Draht ist
unveraendert" nicht mehr durch sie gedeckt.

### A5 — Kein Anbieter-Markup mehr im Aufrufer, MIT Positiv-Kontrolle

```
node -e '
const fs=require("fs");
const RE=/resp\.content|resp\.usage|resp\.stop_reason|tool_use|tool_result|tool_use_id|input_schema|cache_control|max_tokens|tool_choice|tool_calls|content_block|@anthropic-ai/g;
for (const f of ["src/claude.js","src/precall-briefing.js","src/llm.js","src/llm/adapters/anthropic.js"]) {
  const src=fs.readFileSync(f,"utf8").replace(/\/\*[\s\S]*?\*\//g,"")
    .split("\n").filter(l=>!/^\s*\/\//.test(l)).join("\n");
  console.log(f, (src.match(RE)||[]).length);
}'
```
**Erwartet, in dieser Reihenfolge:**
```
src/claude.js 0
src/precall-briefing.js 0
src/llm.js 0
src/llm/adapters/anthropic.js <deutlich > 0>
```
Die letzte Zeile ist die **Positiv-Kontrolle**: liefert sie ebenfalls 0, ist nicht das
Markup verschwunden, sondern der Ausdruck defekt (genau der B2-Befund).

### A6 — Nachher-Bench: identischer Treiber, identische Konfiguration

**Vorbedingung 1 (E8, VOR dem Umbau):** die zwei Szenarien mit unbrauchbarer Baseline neu
erheben, auf **`master`**, in einen eigenen Ordner:
```
for S in d3-fremde-recherche d3-nachschlag-auftrag; do
  node --env-file=.env scripts/convo-bench.mjs run --scenario "$S" --repeat 5 \
    --max-turns 10 --provider telnyx --driver shim \
    --label baseline-shim-nachtrag --out data/convo-bench/baseline-shim-nachtrag-2026-08-XX
done
```
**Erwartet:** 10 Berichte, **kein** `ended_via=persona_error`, geschaetzt ~0,26 USD.
Ergebnis als Nachtrag in `tasks/b3-vorher-werte.md`.

**Vorbedingung 2:** Anthropic-Guthaben pruefen. Ein Lauf, der am Guthaben stirbt, ist keine
Messung — er sieht nur so aus (3.6).

**Der Nachher-Lauf** (nach B3b, auf dem Phasen-Branch), szenarienweise, **nie `--all`**
(ein kaputtes Szenario beendet sonst den GESAMTEN Lauf, `tasks/b3-vorher-werte.md`), alle in
EIN `--out`:

```
OUT=data/convo-bench/b3-nachher-shim-2026-08-XX
for S in friseur-voll stt-noise rueckfrage-notausgang d3-consult-verlangt \
         zweiter-anruf-gedaechtnis unerfuellbare-recherche d3-nachschlag-auftrag \
         spaeter-nochmal termin-duenn mandat-innerhalb partner-knapp personenwechsel \
         kauderwelsch-erstantwort mandat-ausserhalb anrufbeantworter d3-fremde-recherche; do
  node --env-file=.env scripts/convo-bench.mjs run --scenario "$S" --repeat 5 \
    --max-turns 10 --provider telnyx --driver shim \
    --label b3-nachher --out "$OUT"
done
```

Die Konfiguration ist damit deckungsgleich mit der Baseline (belegt aus
`baseline-shim-2026-08-08/*.json` `meta`: `provider telnyx`, `driver shim`,
`agent_model claude-haiku-4-5`, `persona_model claude-haiku-4-5`,
`judge_model claude-sonnet-5`). `--persona-model`/`--judge-model` sind die CLI-Defaults
(`scripts/convo-bench/persona.mjs`, `scripts/convo-bench/judge.mjs`) und werden bewusst
NICHT gesetzt — ein gesetzter Wert waere eine zweite Quelle fuer dieselbe Tatsache.

`inbound-nachricht` und `hold-warteschleife` bleiben aussen vor (auf `shim` nicht lauffaehig,
belegt in `tasks/b3-vorher-werte.md`) — dieselbe Menge wie die Baseline.

**Erwartete Kosten des Nachher-Laufs: ~2,1 USD.** Rechnung: die Baseline kostete 1,8761 USD,
davon entfielen 8 Laeufe auf abgebrochene Gespraeche mit zusammen 0,0359 USD -> 1,8402 USD
fuer 72 vollstaendige Gespraeche = **0,0256 USD je Gespraech**; 80 vollstaendige Gespraeche
= **2,05 USD**. Plus ~0,26 USD fuer die Nachmessung aus E8. **Gesamt ~2,3 USD.**
Laufzeit: die Baseline lief ~45-60 min.

### A7 — Werkzeug-Quoten aus `metrics.turns[].tools`, nicht aus dem Transkript

```
node -e '
const fs=require("fs"); const d=process.argv[1];
const files=fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="summary.json");
const per={}; let total={};
for (const f of files) {
  const r=JSON.parse(fs.readFileSync(d+"/"+f));
  const s=r.meta.scenario; per[s]=per[s]||{runs:0,valid:0,toolRuns:{}};
  per[s].runs++; if (r.ended_via!=="persona_error") per[s].valid++;
  const seen=new Set();
  for (const t of r.metrics.turns||[]) for (const n of t.tools||[]) seen.add(n);
  for (const n of seen) { per[s].toolRuns[n]=(per[s].toolRuns[n]||0)+1; total[n]=(total[n]||0)+1; }
}
for (const [s,v] of Object.entries(per))
  console.log(s.padEnd(28),"runs",v.runs,"gueltig",v.valid,JSON.stringify(v.toolRuns));
console.log("GESAMT (Laeufe mit Werkzeug, n=80):",JSON.stringify(total));
' "$OUT"
```

**Vorher-Werte, gegen die verglichen wird** (in dieser Session aus den Rohberichten
nachgerechnet und mit `tasks/b3-vorher-werte.md` deckungsgleich):

| Werkzeug | Vorher (Laeufe mit mindestens einem Aufruf, n=80) |
|---|---|
| `end_call` | **62** |
| `take_message` | **25** |
| `get_consult` | **5** (alle in `d3-consult-verlangt`, dort 5/5) |
| `look_up` | **3** (alle in `d3-nachschlag-auftrag`) |

### A8 — Was als Regression gilt (und was bei n=5 nur Rauschen ist)

**Vorbemerkung, ehrlich:** haelt A3 (Byte-Gleichheit), kann der Bench per Konstruktion nichts
Neues finden — der Anbieter sieht exakt dieselbe Anfrage. Der Bench ist die **zweite** Sicherung
gegen genau den Fall, dass A3 eine erreichbare Anfrageform uebersehen hat. Er ist Pflicht
(`PLAN-ANBIETER-PORT.md` B3), aber er ist **nicht** die primaere Evidenz.

**Harter Blocker, unabhaengig von n** — jeder einzelne Punkt stoppt den Merge:

| Beobachtung | Warum das kein Rauschen sein kann |
|---|---|
| ein `ended_via`-Wert, den die Baseline nicht kennt (ausser `persona_error` mit Guthaben-Ursache) | technischer Ausfall, keine Modellvarianz |
| irgendein Bericht mit `speechEmpty`/leerem Agent-Text, wo die Baseline Text hatte | genau der Live-Pfad-Bruch aus dem Pre-Mortem |
| `get_consult` faellt in `d3-consult-verlangt` unter **3/5** (Vorher 5/5) | bei p=0,9 hat "hoechstens 2 von 5" eine Wahrscheinlichkeit < 0,9 % |
| ein Werkzeug feuert **0/80**, das vorher gefeuert hat | strukturell, nicht statistisch |
| `roundtrips` je Turn im Median steigt | die Schleife laeuft anders — genau der Gegenstand der Phase |

**Aggregat-Schwelle (2 Standardabweichungen der Binomialverteilung, n=80):**

| Zaehler | Vorher | sd = sqrt(n·p·(1-p)) | Signalgrenze (±2 sd) |
|---|---|---|---|
| `end_call` | 62/80 (p=0,775) | 3,73 | **ausserhalb 54-70 = Signal** |
| `take_message` | 25/80 (p=0,3125) | 4,15 | **ausserhalb 17-33 = Signal** |

**Je Szenario bei n=5:** eine Differenz von **±1** ist Rauschen und wird nicht kommentiert.
**±2** loest eine **Wiederholung genau dieses Szenarios** mit weiteren 5 Laeufen aus (Kosten
~0,13 USD) — erst die Zusammenfuehrung ueber 10 Laeufe entscheidet. **5/5 -> 0/5 oder
0/5 -> 5/5** ist bei jedem plausiblen p ein Signal und ein Blocker.

**Checks und Judge:** die Baseline hat 5 Szenarien mit `fail`-Mehrheit beim Judge
(`spaeter-nochmal` 5/5, `rueckfrage-notausgang` 4/5, `mandat-ausserhalb` 4/5,
`unerfuellbare-recherche` 3/5, `d3-consult-verlangt` 2/5). Diese Werte sind **Bestandsbefunde,
nicht das Ziel dieser Phase**. B3 wird daran gemessen, dass sie sich **nicht verschlechtern**,
nicht daran, dass sie besser werden. Judge-Urteile sind bei n=5 die schwaechste Groesse im
Satz und begruenden allein **keinen** Blocker.

### A9 — Smoke

```
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start
curl -s localhost:3999/healthz
```
**Erwartet:** Boot ohne Guard-Refusal, `/healthz` antwortet 200.
Der Shim-Pfad ist durch `test/telnyx-shim-route.test.js` und
`test/al-p8-bench-shim-gates.test.js` (beide mit `ANTHROPIC_BASE_URL`-Mock) in A2 abgedeckt.

**Was A1-A9 NICHT abnehmen:** einen echten Anruf. Der gehoert zu **B5**
(`PLAN-ANBIETER-PORT.md`: *"ein Provider-Ausbau ohne echten Anruf ist nicht abgenommen"*).
B3 aendert den ausgehenden Anfrage-Body nicht — deshalb ist ein echter Anruf hier keine
zusaetzliche Aussage, sondern nur zusaetzliche Kosten. **Wenn der Owner dennoch einen will,
gehoert er nach B3b und vor B5**, und er prueft genau eine Sache: dass der Live-Shim-Pfad
spricht.

---

## 8. Pre-Mortem — ein Jahr spaeter war B3 falsch

### R1 — "Die Ruecktrage verlor Information, und die Gespraeche wurden unmerklich schlechter."

*Wie es passiert:* der Adapter reicht statt der vollstaendigen Anbieter-Antwort nur einen
Teil zurueck (etwa nur den ersten Textblock, oder `tool_use`-Bloecke ohne `id`). Das Modell
sieht ab Runde 2 einen verkuerzten Verlauf. Nichts stuerzt ab; die Antworten werden nur
etwas schlechter, ueber Monate, unattributierbar.

*Warum das heute durchginge:* **kein Bestandstest prueft die Struktur der Ruecktrage** —
belegt in 3.5 (`grep -rn 'tool_use_id|tool_result' test/` findet nur Text-Suchen nach
deutschen Konstanten).

*Gegenmassnahme IN DIESER PHASE:*
1. **Konstruktiv:** `providerTurn` ist opak und wird nie uebersetzt (E1/V1). Es gibt keine
   Abbildung, die etwas weglassen koennte. Das ist das eigentliche Gegengift.
2. **Messbar:** Golden-Master G2/G3/G4 (A3) vergleicht die **zweite** Anfrage eines
   mehrrundigen Loops `deepEqual` gegen ein auf `master` aufgenommenes Fixture.
3. **Bewiesen scharf:** die Pflicht-Gegenprobe in A3 — der Test muss einmal rot gewesen sein.

### R2 — "Der Live-Sprechpfad brach, und Anrufer hoerten Stille."

*Wie es passiert:* der Adapter verarbeitet die Stream-Ereignisse anders — `text_delta` kommt
nicht mehr am Sink an, oder die Fuge zwischen zwei Textbloecken (`llm.js:359`, ein
Leerzeichen) verschwindet. Der Shim schickt dann eine leere Completion, der Anrufer hoert
nichts. Oder: der Retry-Riegel nach dem ersten Fragment geht verloren und derselbe Satz wird
zweimal gesprochen.

*Gegenmassnahme:*
1. **Der Retry-Riegel bleibt im SEAM, nicht im Adapter** — so schreibt es `ports.js`
   (`completeStream`: *"Der Merker dafuer und die Retry-Entscheidung bleiben im SEAM"*). Das
   Merken von `forwardedText` (`llm.js:348`, `:361`, `:375`) wandert **nicht** mit.
2. **Die Text-Zusicherung ist Vertragstext**: die gestreamten Fragmente ergeben aneinander-
   gereiht EXAKT `LlmTurn.text` (`ports.js`, `LlmTurn.text`). Die Fuge `" "` bei mehreren
   Textbloecken ist deshalb ein Pflicht-Testfall.
3. **Bestandsabdeckung, unveraendert zu halten:** `test/al-p7-llm-stream.test.js` (Sink-Reihenfolge,
   Retry-Verbot nach dem ersten Fragment, `STREAM_ABORTED`), `test/al-p7-turn-streaming.test.js`,
   `test/al-p17-first-round-audible.test.js`, `test/telnyx-shim-route.test.js`. Golden-Master G5
   deckt den gestreamten Body ab.
4. **A9** faehrt den Server wirklich hoch.

### R3 — "`get_consult`/`look_up` feuern anders als vorher, und niemand sah es."

*Wie es passiert:* die Werkzeug-Definitionen aendern beim Schluesselwechsel
`input_schema` -> `parameters` unbemerkt ihre Reihenfolge, ihren Inhalt oder verlieren die
`required`-Liste. Oder `agentTools` haengt den `cache_control`-Breakpoint nicht mehr ans
letzte Tool und der Tool-Block-Cache faellt in jedem Turn — teurer, und der Prompt-Praefix
wechselt.

*Gegenmassnahme:*
1. **Golden-Master G1/G7/G8** vergleichen die vollstaendige `tools`-Liste `deepEqual`,
   inklusive Reihenfolge und `cache_control`-Position.
2. **`test/l3-prompt-caching.test.js` bleibt unveraendert** (A4) — es prueft genau
   "`cache_control` nur am letzten Tool, Tool-Inhalt byte-identisch".
3. **A7** zaehlt die Werkzeug-Quoten aus `metrics.turns[].tools` gegen die Vorher-Zahlen,
   mit den Schwellen aus A8. `get_consult` unter 3/5 ist ein Blocker.
4. **E8** stellt sicher, dass die Vergleichsbasis fuer `look_up` (`d3-nachschlag-auftrag`)
   ueberhaupt existiert — heute sind 3 von 5 Baseline-Laeufen unbrauchbar.
5. **`bridge.js:83` ist ein benannter Pflicht-Nachzug** (5.3) — genau die Klasse "stille
   Bedeutungsumkehr an einem uebersehenen Leser", die C-P1/C-P1b schon einmal gekostet hat.

### R4 — "Die Neutralisierung wurde gebaut, aber nie ein zweiter Adapter. Der Umbau am Live-Pfad war umsonst."

*Wie es passiert:* B3 landet, DeepSeek stellt sich als untauglich heraus (W8 ist bis heute
unbeantwortet: B1 konnte Qualitaet mit `max_tokens: 64` nicht messen), und der Live-Pfad
traegt dauerhaft eine Abstraktion mit genau einem Nutzer.

*Gegenmassnahme:*
1. **Der Spike VOR B3b** (Abschnitt 6): W8 wird mit Daten beantwortet, bevor die
   Anfrageseite umgebaut wird. Ein Wegwerf-Branch, null Live-Pfad-Risiko.
2. **B3a hat eigenstaendigen Wert, auch ohne jeden zweiten Adapter:** die aufgeschluesselte
   Verbrauchsform (`LlmTokenUsage` mit vier Sorten) ist die **Vorbedingung fuer B4** — und
   B4 ist die Owner-Entscheidung vom 2026-08-08 (*"ich will dass die echten kosten abgebucht
   werden"*), die unabhaengig von DeepSeek gilt. Heute faltet `inputTokensOf`
   (`llm-usage.js:21-27`) drei Sorten auf eine Rate; ohne B3a kann B4 das nicht auftrennen.
3. **Ehrlich benannt:** faellt der Spike negativ aus, ist **B3b** (die Anfrageseite) das
   Stueck, das man dann NICHT bauen muss. Der Schnitt aus E3 existiert genau dafuer.

### R5 — "Die Recherche-Gebuehr wurde ein Jahr lang mit dem Deckel gebucht."

*Wie es passiert:* `searchCount` bekommt die neutrale `usage`, findet `server_tool_use` nicht,
liefert `null`, und der Aufrufer bucht `researchMaxUses` — bei **jedem** Briefing. Es gibt
keinen Alarm: die fail-safe-Richtung ist "ueberbuchen", also sieht alles korrekt aus, nur
teurer.

*Gegenmassnahme:* **E5** (5.6) plus die Tatsache, dass
`test/al-p10-precall-research.test.js:206-226` beide Richtungen heute schon prueft und in
dieser Phase **unveraendert** bleiben muss (A4). Bleibt es gruen, ist die Buchung nicht
verschoben.

### R6 — "Der Bench-Nachher-Lauf sagte 'unveraendert', aber er hat nie stattgefunden."

*Wie es passiert:* das Anthropic-Guthaben ist leer, die Laeufe sterben mit
`ended_via=persona_error`, die Checks melden trotzdem `10/10` und der Judge schweigt. Genau
das ist der Basismessung am 2026-08-08 in 8 von 80 Laeufen passiert (3.6) — und es stand als
"100 % Checks" in der Vorher-Tabelle.

*Gegenmassnahme:* **A6 Vorbedingung 2** (Guthaben pruefen) und **A7 zaehlt `gueltig` je
Szenario mit** (`ended_via !== "persona_error"`). Ein Nachher-Lauf mit `gueltig < 5` in
irgendeinem Szenario ist **kein Ergebnis**, sondern eine Wiederholung. Die leere Menge ist
ein eigener Fall (`tasks/lessons.md`, B1).

---

## 9. Weisse Flecken — was am Bestand NICHT zu klaeren war

| # | Offen | Warum es hier nicht entscheidbar ist | Wer beantwortet es |
|---|---|---|---|
| **B3-W1** | Ist die Vertragsergaenzung `LlmRequest.cachePrefix` (E6) genehmigt? | `src/llm/ports.js` ist gemergt und bindend. Ein Impl-Agent darf einen bindenden Vertrag nicht eigenmaechtig erweitern. | **Lead**, vor Beginn von B3b |
| **B3-W2** | Ist E5 (`searchCount` liest `providerTurn`) genehmigt, oder soll `precall-briefing.js` ganz vom Port fernbleiben? | Beruehrt einen Geldpfad (`addResearchFeeCostCents`) und aendert einen zweiten Port (`research/ports.js`). | **Lead** |
| **B3-W3** | Bleibt `LlmTurn.providerTurn` bei "Anthropic-content-Liste" oder wird es "die ganze Anbieter-Antwort"? | B2 laesst die innere Form ausdruecklich offen; E5 verlangt die groessere Fassung. Beides ist vertragskonform — es ist eine Wahl, keine Ableitung. | **Lead**, gemeinsam mit B3-W2 |
| **B3-W4** | Wie verhaelt sich DeepSeek bei Werkzeugen **zusammen mit** Streaming? | `PLAN-ANBIETER-PORT.md` 1.4: *"in der Doku nicht beantwortet"*. B1 hat es nicht geschlossen (nur ein Block streamte, und der fuhr ein Modell). **Diese Frage bestimmt, ob die neutrale Sink-Semantik traegt.** | **B5** — oder der Spike aus Abschnitt 6 |
| **B3-W5** | Tragen `deepseek-v4-flash`/`-pro` das Gespraech ueberhaupt? (= W8 aus B2) | B1 fuhr mit `max_tokens: 64`, Antworten abgeschnitten. Praezedenz B-7: dokumentierte Faehigkeit, gemessen 97 % Wortfehlerrate. | **B5**, bzw. der Spike |
| **B3-W6** | Was passiert bei unparsebaren Werkzeug-Argumenten? (= W2 aus B2) | Der Fall wurde nie beobachtet; eine Regel ohne Beobachtung waere geraten. Bei Anthropic ist `input` bereits ein Objekt — der Fall ist in B3 **strukturell unerreichbar**. | **B5** (erster Adapter, der wirklich JSON parst) |
| **B3-W7** | Sinkt der Anteil der Prompt-Cache-Treffer, wenn `cache_control` vom Aufrufer in den Adapter wandert? | Byte-Gleichheit des Bodys (A3) sichert die **Form**. Ob die Trefferquote im Live-Verkehr gleich bleibt, ist eine Laufzeitgroesse und in keinem Test messbar. Richtung ist klar (identischer Body -> identischer Praefix), Groesse ungemessen. | **Betrieb**, am Live-Log nach dem Deploy (`metricsExtra`-Zaehler) |
| **B3-W8** | Bleibt `providerStatusOf` exportiert? | Ausserhalb `src/llm.js` gibt es keinen Konsumenten in `src/`, `test/`, `scripts/`. Ob ein Test ihn direkt importiert, entscheidet der rote/gruene Lauf, nicht diese Spec. | **Impl-Agent**, an `npm test` |
| **B3-W9** | Warum lief das Anthropic-Guthaben waehrend der Basismessung leer, und ist es jetzt aufgefuellt? | Am Repo nicht feststellbar; der Kontostand steht nur in der Anbieter-Konsole. Der Vorfall vom 2026-08-04 (GQ-P4) hat denselben Fingerabdruck. | **Owner**, vor A6 |
| **B3-W10** | Steht `npm run lint` wieder? | `@eslint/js` fehlt installiert; `npx eslint src/llm.js` bricht identisch ab (B2-Befund 3, Bestandsdefekt). B3 kann sich nicht darauf stuetzen. | **eigene Aufgabe**, nicht B3. Abdeckung liefern `node --check` + `prettier --check`. |

---

## 10. Nicht-Ziele und Abgrenzung

**Nicht in B3, weil es B4 gehoert:**
- Preisstaffel je Token-Sorte (`inPerMTok`/`cacheWritePerMTok`/`cacheReadPerMTok`/`outPerMTok`
  + `asOf` + `source`), Anthropics Raten je Sorte (W3 aus B2: stehen im Repo **nirgends**).
- Boot-Abbruch bei unbekanntem Modell (Abnahmekriterium 1 des Plans).
- Die Frage, ob alle Anbieter in EINE `modelPricesUsd`-Tabelle gehoeren (W4).
- Store-/Schema-Aufschluesselung (`emptyUsage` hat 2 Zaehler, `usage_event.quantity` ist eine
  Summe — W5).
- Die taegliche Perioden-Gegenprobe gegen `GET /user/balance` und ihr fehlender Traeger (W7).
- **Der gefaehrlichste Schritt der ganzen Kette ist B4, nicht B3:** sobald Anthropic vier
  Raten hat, wird `cache_read_input_tokens` nicht mehr zur vollen Eingabe-Rate gebucht — der
  **live gebuchte Betrag SINKT**, das Budget-Gate greift spaeter, es schuetzt weniger.
  **B3 aendert die gebuchte Zahl um NULL (E4).**

**Nicht in B3, weil es B5 gehoert:**
- Der DeepSeek-Adapter selbst.
- Die Provider-Auswahl: `LLM_PROVIDER`-Env, Registry-Tabelle nach Muster
  `src/telephony/registry.js`, Flag mit Env-Rueckfall, `config.js`-Namensraum-Liste (`:1512`)
  und `BASE_ENV` in `test/helpers.js` (bekannte Drift-Falle).
- Die Modellwahl `deepseek-v4-flash` vs. `-pro` (Owner-Entscheidung vom 2026-08-08:
  ausdruecklich **bis B5 vertagt**).
- Der echte Anruf als Abnahme.
- Faehigkeits-Flags (`providerSupports`-Muster) fuer einen Adapter ohne Streaming.

**Nicht in B3, Punkt:**
- `src/bridge.js` jenseits des Ein-Zeilen-Nachzugs in `realtimeTools`. Die Realtime-Engine
  spricht mit OpenAI Realtime, nicht ueber diesen Port; sie traegt `HEIKLE STELLE`-Marken.
- Der Telnyx-Shim. Er ist Konsument von `agentTurn`, nicht des LLM-Ports; W1 (3.3) belegt,
  dass er nichts beitraegt und nichts uebernimmt. **Sein Diff in dieser Phase ist leer.**
- Prompt-Texte, Werkzeug-Beschreibungen, Locale-Bundles, `systemPrompt`-Aufbau. Der
  Systemprompt-**Inhalt** bleibt byte-identisch (A3 G1 misst es).
- Die offenen Gespraechsqualitaets-Befunde aus `tasks/b3-vorher-werte.md`
  (`turn_count_within_budget` in 7 Szenarien, `no_invented_promise`, die doppelte
  `take_message`-Verschiebung von AL-D3). **Das sind Bestandsbefunde. B3 darf sie nicht
  verschlechtern und wird nicht daran gemessen, sie zu verbessern.**
- Metrik-Schluessel umbenennen (E7).
- `npm run lint` reparieren (B3-W10).
