# Befund Toolwahl-1: der ausgehende Draht zum DeepSeek-Anbieter

Spur: Kommen `look_up`/`get_consult` vollstaendig beim Modell an, ist der Aufruf
strukturell moeglich? Stand 2026-08-11, `LLM_PROVIDER=deepseek`, `deepseek-v4-pro`.

**Kernaussage: der Draht ist sauber und NICHT die Ursache von AL-D3.** Mit live-treuem
Werkzeugsatz und unveraendertem Systemprompt feuert das Modell `get_consult` 5/5, sobald
die Gegenstelle die Entscheidung ausdruecklich verlangt. Der Ausfall haengt am
Gespraechsinhalt, nicht an Serialisierung, `tool_choice` oder `thinking`.

Messwerkzeuge (Scratchpad, KEIN Produktivcode geaendert): `probe-deepseek-draht.mjs`,
`probe-round2-isolieren.mjs`, `probe-timeout-latenz.mjs`, `probe-consult-ab-thinking.mjs`
unter `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/8af6ee0c-29a2-449c-85e3-918b3b13e6ee/scratchpad/`.
Sie rufen den echten Adapter mit echtem `systemPrompt(call)` und echten `toolDefs()`.

## 1. Serialisierung — VOLLSTAENDIG, verlustfrei

`deepseekTool` (`src/llm/adapters/deepseek.js:231-240`) bildet auf
`{type:"function", function:{name, description, parameters}}` ab. Keine Kuerzung, keine
Schema-Filterung. Reihenfolge = `agentTools`-Reihenfolge (`.map`, `deepseek.js:267`;
`claude.js:507-517`). REAL erzeugter Body (`body-live-EXPLIZIT.json`):

```
Schluessel in Reihenfolge: model | max_tokens | tools | messages | thinking
  function/end_call     desc=332  params={"type":"object","properties":{"reason":{...}},"required":[]}
  function/take_message desc=1119 params={"type":"object","properties":{"message":{...}},"required":["message"]}
  function/get_consult  desc=823  params={"type":"object","properties":{"question":{...}},"required":["question"]}
```

823 Zeichen = byte-genau `localeFor("de").prompt.tools.getConsultDescription`; auch die
Parameter-Beschreibung steht auf dem Draht. **Kein Verlust.** Einzige Verwerfungsstelle
waere ein Werkzeug OHNE `parameters` — das wirft benannt (`deepseek.js:231-235`),
verschwindet nicht still; irrelevant (`RESEARCH_ENABLED=false`, alle drei Werkzeuge
tragen ein Schema).

## 2. `tool_choice` im normalen Turn — das FELD FEHLT

`agentTurn` baut die Anfrage OHNE `toolChoice` (`claude.js:999-1009`). `toDeepseekBody`
setzt `out.tool_choice` nur im `case "toolChoice"` (`deepseek.js:269-271`) — nie betreten.
Am realen Body belegt: Schluessel fehlt. BEABSICHTIGT (`src/llm/tool-choice.js:7-9`:
fehlendes Feld = Anbieter-Default, bei der OpenAI-kompatiblen API `auto`). Einziger
Erzeuger eines `toolChoice` ist das Precall-Briefing (`precall-briefing.js:230/233/296`).

## 3. `thinking:{"type":"disabled"}` — auch im normalen Turn, PAUSCHAL

`out.thinking = THINKING_DISABLED` steht UNBEDINGT am Ende von `toDeepseekBody`
(`deepseek.js:282`), ohne Verzweigung auf `toolChoice`, und `toDeepseekBody` bedient BEIDE
Betriebsarten (`:438` complete, `:455` completeStream). Konstante eingefroren (`:36`), kein
Env-Knopf; `grep thinking src/llm/` liefert genau diese eine Setz-Stelle.

**Trennfrage: heute NICHT moeglich.** Der Adapter schaltet pauschal ab; "Thinking AN,
solange `tool_choice` nicht erzwingt" existiert nicht und braeuchte eine Code-Aenderung.

**Kausalitaet — WIDERLEGT, nicht nur unbestaetigt.** A/B auf genau dieser Variablen (sonst
byte-identisch, beide Arme roher POST), Satz `end_call|take_message|get_consult`,
unveraenderter Systemprompt, n=5:

| Szenario | Arm | `get_consult` | p50 | max |
|---|---|---|---|---|
| EXPLIZIT (Entscheidung woertlich verlangt) | thinking AUS (prod) | **5/5** | 2078 ms | 2517 ms |
| EXPLIZIT | thinking AN (Feld weg) | 4/5 | 5062 ms | 11191 ms |
| IMPLIZIT (Entscheidung noetig, nicht eingefordert) | thinking AUS (prod) | 0/5 | 1674 ms | 1807 ms |
| IMPLIZIT | thinking AN | 0/5 | 6992 ms | 7067 ms |

Thinking AN ist strikt SCHLECHTER: der EXPLIZIT-Fehlschlag und alle fuenf IMPLIZIT-Laeufe
enden mit `finish_reason:"length"` — 1000-1150 Zeichen `reasoning_content` fressen
`max_tokens:300` auf (`TURN_MAX_TOKENS`, `claude.js:719`), die Antwort ist LEER: kein Text,
kein Werkzeug. Zudem liegt der Median (5062/6992 ms) weit ueber
`LLM_REQUEST_TIMEOUT_MS=3500` (`config.js:430`) — Thinking anzuschalten fuehre live jeden
Turn in den Abbruch.

Der IMPLIZIT-Arm reproduziert den Live-Befund exakt und in BEIDEN Zustaenden: das Modell
entscheidet selbst statt zu fragen ("Donnerstag um siebzehn Uhr passt gut — den nehme ich
gerne."). Prompt-/Beschreibungs-Frage, keine Draht-Frage.

## 4. SSE-Rekonstruktion und Verlustpfade

Fragmente werden ueber `index` gebuendelt (`deepseek.js:310-321`), sortiert (`:370-372`),
dann EINMAL geparst (`:128-133`). Argument-Parsing fail-closed (`:106-124`): unparsebar ->
benannter Throw, `isTransient=false` (`:65` ueber `transient-errors.js:37-51`) -> kein
Retry, sofortige Degradation.

**Timeout-Pfad, gemessen** (`probe-timeout-latenz.mjs`, n=10 je Reihe, Timeout 3500 ms):
Turn MIT Werkzeug 10/10 gefeuert, 0 Abbrueche, min 1177 / p50 1795 / max 2547 ms; Turn OHNE
Werkzeug p50 1876 / max 2382 ms. Ein Werkzeug-Turn ist also NICHT systematisch langsamer.
Bei erzwungenem Timeout (300 ms) wirft `armedSignal` (`deepseek.js:390-396`)
`name=TimeoutError code=23 status=undefined` -> `isTransient=false` (Code ist eine ZAHL,
`TRANSIENT_CODES` haelt Strings, `transient-errors.js:23-30`). Folge: **kein Retry**, kein
`LlmUnavailableError`, Durchfall als nicht-transient (`llm.js:275-286`) ->
`turnErrorSpeech` (`llm.js:55-57`).

Eine zu langsame Antwort MIT Werkzeugaufruf wird also **ersatzlos verworfen**, NICHT "als
reiner Text neu versucht" — hinterlaesst aber eine Fehlerzeile (`outcome=non-transient`).
Da die Forensik tagesweit 0 Fehler/0 Retries zeigt, ist der Pfad live nicht eingetreten:
**Hypothese verworfen.**

### Stiller Verlustpfad: ja, ein anderer — heute schlafend, aber scharf

Die aus dem SSE-Strom rekonstruierten `tool_calls` tragen **kein `type:"function"`**:
`mergeToolCallFragment` legt `{id, function:{name, arguments}}` an (`deepseek.js:313`) und
liest `fragment.type` nie. Diese Form geht als `providerTurn` (`:187-191`) in die NAECHSTE
Anfrage zurueck (`claude.js:1129-1131`). Drei-Arm-Isolation, live:

```
R2 nonstream      : OK    (providerTurn traegt index UND type:"function")
R2 stream         : FEHLER status=400 "messages[3]: missing field `type`"
R2 stream + type  : OK    (einzige Aenderung: type:"function" nachgeruestet)
```

Reichweite: nur der Stream-Pfad, also nur der Shim (`telnyx-llm-shim.js:905` ist der
EINZIGE Erzeuger von `onSpeechChunk`; sonst liefert `streamSinkFor` null,
`claude.js:757-758`) und nur fuer Werkzeuge mit zweiter Runde: `get_consult` bricht vorher
ab (`claude.js:1048-1062`), `look_up` nicht — dessen Runde 2 liefe in den 400er. Da
`look_up` live wegen `allowLookup:false` nicht angeboten wird, ist der Defekt heute
unerreichbar, zieht aber scharf, sobald das Profilrecht gesetzt wird. Kein Test deckt ihn:
`test/b5-deepseek-adapter.test.js:196-218` prueft die Ruecktrage nur mit einem
HANDGEBAUTEN `rawToolCall`, nie mit einer aus dem Strom rekonstruierten.

## 5. Live-Probe — LIEF (Schluessel lag in `.env`)

4 Skripte, ~70 echte Anfragen an `api.deepseek.com`, Cent-Betraege. Ergebnis siehe
Tabelle. Zusaetzlich in `probe-deepseek-draht.mjs` (mit `look_up` im Satz): `look_up` 3/3
in Arm A, 3/3 in Arm B (`tool_choice:"required"`), 3/3 im Stream-Arm.

**Arm B ist der strukturelle Positiv-Beleg:** Werkzeugangebot und Schema werden vom
Anbieter angenommen und sind ausfuehrbar. Ein Gate, das immer ablehnt, besteht jeden
Negativ-Test — hier gibt es die andere Haelfte.

Nebenbefund, NICHT diese Spur: mit `thinking` AUS lieferte das Modell in 10/10
Werkzeug-Runden `content:""` — KEINEN begleitenden Ueberbrueckungssatz, obwohl die
`lookUpDescription` ihn im selben Zug verlangt. Mit Thinking AN kam er ("Einen Moment
bitte."). Der Anrufer hoert im Werkzeug-Zug also Stille, sofern nicht das Denk-Signal
(`thinking-signal.js`) einspringt.

## Fazit

- Werkzeuge kommen vollstaendig an (Name, Beschreibung, Schema, Reihenfolge). BELEGT.
- `tool_choice` fehlt im normalen Turn (Anbieter-Default `auto`). BELEGT am realen Body.
- Thinking pauschal aus, keine Trennung nach `tool_choice`. BELEGT. Als Ursache
  WIDERLEGT: Thinking AN feuert nicht besser, ist langsamer als der Deckel und verliert
  Antworten an `finish_reason:"length"`.
- Kein Verlustpfad im Live-Verkehr; Timeout-/Retry-Hypothesen gemessen und verworfen. Der
  eine reale Verlustpfad (fehlendes `type` in der Stream-Ruecktrage) ist ein Blindgaenger.
- Die Wurzel von AL-D3 liegt NICHT auf dieser Spur, sondern in der Entscheidung des
  Modells bei nicht ausdruecklich eingeforderten Rueckfragen — Spur "Angebot"/"Prompt".
