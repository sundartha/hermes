# Befund: Angebots-Gate fuer `look_up` / `get_consult`

Spur: nur ob die Werkzeuge im angebotenen `tools`-Array stehen — keine Modellwahl.

## 1. Bedingungen fuer `look_up` im Array

Quelle: `src/claude.js:507-517` (`agentTools`) ruft `lookupAvailableFor(call)` aus
`src/research/in-call.js:72` -> `lookupProviderFor(call)` (Zeilen 60-69). ALLE Bedingungen
UND-verknuepft, Reihenfolge bindend (Flag zuerst, fail-closed):

1. `config.research.lookupEnabled === true` (Env `LOOKUP_ENABLED`) — `in-call.js:61`
2. `config.tenancy.assistantContextEnabled === true` (Env `ASSISTANT_CONTEXT_ENABLED`) — `in-call.js:62`
3. `config.voice.voiceEngine !== VOICE_ENGINE.REALTIME` (nur Budget-Engine bietet es an) — `in-call.js:63`
4. `call.direction === "outbound"` — `in-call.js:64`
5. `call.status === "active"` — `in-call.js:65`
6. `callLookups(call) < LOOKUP_MAX_PER_CALL` (=2, `in-call.js:24`) — `in-call.js:66`
7. Provider-Aufloesung `inCallSearchProvider({tenantAllows})` in `src/research/registry.js:53-56`:
   - `config.research.lookupEnabled` nochmal (Registry-Ebene) UND `tenantAllows`
   - `tenantAllows = store.resolveProfile(call.tenantId)?.allowLookup === true` (Per-Tenant-Recht, `in-call.js:68`, Default in `src/store/defaults.js:950`/`963`)
   - `config.research.exaApiKey` muss gesetzt sein (`registry.js:55`)

Fehlt EINE Bedingung -> `lookupProviderFor` liefert `null` -> `look_up` fehlt im Array,
Bestand byte-identisch (Kommentar `in-call.js:35-38`).

## 2. Bedingungen fuer `get_consult` im Array

Quelle: `src/claude.js:509` ruft `consultAvailableFor(call)` aus `src/consult/in-call.js:87-97`:

1. `config.tenancy.inCallConsultEnabled === true` (Env `IN_CALL_CONSULT_ENABLED`)
2. `consultAllowedFor(store.resolveProfile(call.tenantId))` (`src/consult/gate.js:23`, prueft u.a. `profile.allowConsult === true`)
3. `call.direction === "outbound"`
4. `call.status === "active"`
5. `callAnswered(call)` (`answeredAt` gesetzt, `in-call.js:51-53`)
6. `consultClientIsPolling(call, nowMs)` — MCP-Client muss INNERHALB `CONSULT_POLL_FRESH_MS` gepollt haben (`in-call.js:62-64`)
7. `inCallConsults(call).length < MAX_IN_CALL_CONSULTS_PER_CALL` (=1, `in-call.js:47`)

`config.tenancy.inCallConsultEnabled` haengt selbst zusaetzlich an `CONSULT_ENABLED`
(Kommentar `src/config.js:1336-1343`: "Wirkt NUR als Schnittmenge mit CONSULT_ENABLED,
ASSISTANT_CONTEXT_ENABLED und ... allowConsult") — UNBELEGT im Code selbst als
Programm-Constraint (kein `config.tenancy.consultEnabled`-Read in `in-call.js`), nur als
Betriebs-Empfehlung im Kommentar. D.h. `IN_CALL_CONSULT_ENABLED=true` bei
`CONSULT_ENABLED=false` wuerde `get_consult` laut Code trotzdem anbieten (nicht getestet,
da lokale .env beide auf Default/false stehen hat).

## 2b. RESEARCH_ENABLED-Verdikt (Kernfrage)

**RESEARCH_ENABLED schaltet `look_up` NICHT ab. Getrenntes Flag `LOOKUP_ENABLED`.**

Beleg Code-Trennung:
- `src/config.js:493` `researchEnabled: boolEnv("RESEARCH_ENABLED", ...)`
- `src/config.js:518` `lookupEnabled: boolEnv("LOOKUP_ENABLED", ...)` — eigener Env-Key, eigenes Config-Feld, Kommentar Zeile 513-515: "EIGENER Schalter neben RESEARCH_ENABLED, weil die Exposition eine andere ist"
- `src/research/registry.js:40` `precallResearchProvider` liest `config.research.researchEnabled` (Vorab-Briefing, Anthropic web_search)
- `src/research/registry.js:54` `inCallSearchProvider` liest `config.research.lookupEnabled` (In-Call, Exa) — ANDERE Zeile, ANDERES Feld
- `src/research/in-call.js:61` `lookupProviderFor` prueft ausschliesslich `config.research.lookupEnabled`; `config.research.researchEnabled` kommt in dieser Datei NIRGENDS vor (grep bestaetigt: kein Treffer)

Direkter Beleg aus der lokalen `.env:44`: Kommentar unmittelbar ueber `RESEARCH_ENABLED=false`
lautet woertlich: *"Der In-Call-Nachschlag (LOOKUP_*, Exa) ist NICHT betroffen - eigenes
Werkzeug."* — deckt sich mit dem Code.

**Aber (wichtige Praezisierung):** In der AKTUELLEN lokalen `.env` steht `LOOKUP_ENABLED`
gar nicht gesetzt (grep negativ) -> Default-Fallback aus `config.js:518` greift:
`{ fallback: false }`. `look_up` ist also **ebenfalls aus** — nicht wegen
`RESEARCH_ENABLED=false`, sondern weil `LOOKUP_ENABLED` seinen eigenen Default (false)
traegt und nie auf `true` gesetzt wurde. Zwei unabhaengige Ursachen, gleiches Symptom.

## 3. Ist-Werte

Lokale `.env` (nur Flag-Namen/Werte, keine Secrets):
- `VOICE_ENGINE=budget` (Zeile 17)
- `LLM_PROVIDER=deepseek` (Zeile 38)
- `RESEARCH_ENABLED=false` (Zeile 45)
- `LOOKUP_ENABLED` — NICHT gesetzt -> Default `false` (`config.js:518`)
- `ASSISTANT_CONTEXT_ENABLED` — NICHT gesetzt -> Default `true` (`config.js:1318-1320`)
- `CONSULT_ENABLED` — NICHT gesetzt -> Default `false` (`config.js:1335`)
- `IN_CALL_CONSULT_ENABLED` — NICHT gesetzt -> Default `false` (`config.js:1344-1346`)
- `EXA_API_KEY` — NICHT gesetzt (grep negativ) -> leer -> `registry.js:55` fail-closed

`.env.example` (Referenzwerte, alle default AUS ausser `assistantContextEnabled`):
`ASSISTANT_CONTEXT_ENABLED=true` (314), `RESEARCH_ENABLED=false` (344),
`LOOKUP_ENABLED=false` (358), `EXA_API_KEY=` leer (367), `CONSULT_ENABLED=false` (376),
`IN_CALL_CONSULT_ENABLED=false` (388), `VOICE_ENGINE=budget` (790).

**Folge fuer den Live-Befund:** Bei diesem Ist-Stand fehlen BEIDE Werkzeuge im Array aus
JEWEILS EIGENEM Grund — `look_up` mangels `LOOKUP_ENABLED=true` (+ fehlendem `EXA_API_KEY`),
`get_consult` mangels `IN_CALL_CONSULT_ENABLED=true`. Das ist unabhaengig von
`LLM_PROVIDER=deepseek`.

## 4. Aendert sich der Werkzeugsatz waehrend eines Gespraechs?

Ja, JEDE Runde neu, nicht nur pro Turn: `agentTools(call)` wird INNERHALB der
Tool-Loop-Schleife aufgerufen, einmal je Runde (`src/claude.js:988`, Schleife ab `:963`,
bis zu `MAX_TOOL_ROUNDS_PER_TURN=4`, `src/turn-budget.js:53`), nicht einmal je Turn.

- `look_up` kann MITTEN im Gespraech verschwinden: `callLookups(call) >= LOOKUP_MAX_PER_CALL`
  (`in-call.js:66`) — Kommentar `claude.js:510-514`: "Erschoepftes Kontingent laesst das
  Werkzeug aus dem tools-Array des NAECHSTEN Zuges verschwinden". Zaehler wird sofort nach
  Ausloesen erhoeht (`store.countCallLookup`, `in-call.js:110`), noch VOR der Antwort.
- `get_consult` kann verschwinden, sobald `inCallConsults(call).length` das Kontingent
  (=1) erreicht, oder wenn `consultClientIsPolling` false wird (kein frischer MCP-Poll
  mehr, `in-call.js:63`) — reine Wanduhr-Bedingung, kann zwischen zwei Turns kippen ohne
  Zutun des Anrufers.
- Angenommenes `get_consult` beendet den Turn sofort (`claude.js:1047-1062`, `break`) —
  innerhalb DESSELBEN Turns kommt es also nicht zu einer zweiten Runde mit verschwundenem
  `get_consult`; das Verschwinden zeigt sich erst im naechsten Turn.

## 5. Reihenfolge im Array

`src/claude.js:507-517` (`agentTools`): Basis `toolDefs(call.language)` liefert
`[end_call, take_message]` (`claude.js:449-480`, `take_message` an Index 1). Danach wird
`get_consult` gepusht (Zeile 509, wenn verfuegbar), zuletzt `look_up` (Zeile 515, wenn
verfuegbar). Feste Reihenfolge, wenn alle vier stehen:
**`[end_call, take_message, get_consult, look_up]`** — `take_message` liegt IMMER vor
`get_consult`/`look_up`.

## 6. Laufzeit-Beleg `offeredToolNames`

Ja. `src/claude.js:949` `offeredTools = new Set()`, gefuellt in JEDER Runde
(`claude.js:989`: `for (const tool of tools) offeredTools.add(tool.name)` — Union ueber
alle Runden des Turns). Rueckgabe ueber `turnTelemetry()` (`claude.js:1167-1173`,
Feld `offeredToolNames: [...offeredTools]`), an zwei Ausgaengen verwendet (`:1190`, `:1230`).

Sichtbarkeit: `src/telnyx-llm-shim.js` (Budget-Engine-Shim) liest das Feld in
`turnDiagnostics` (`:193`) und schreibt es **unconditional** (kein Feature-Flag) via
`console.log(formatShimLine("turn_ok", payload))` (`logShimTurnOk`, Definition `:348`,
Aufruf mit `...turnDiagnostics(turn, callerText)` bei `:931-950`). `console.log` geht auf
stdout und ist damit in Render-Logs sichtbar (Kommentar `telnyx-llm-shim.js:173-177`
bestaetigt ausdruecklich: fruehere Turn-Fakten waren "im Prod-Log stumm", `turn_ok` ist die
Ergaenzung, die das behebt).

## UNBELEGT

- Ob `IN_CALL_CONSULT_ENABLED=true` bei gleichzeitig `CONSULT_ENABLED=false` in der Praxis
  je vorkam / getestet wurde — Code liest in `consult/in-call.js` `consultEnabled` nicht,
  die Kopplung steht nur im Kommentar.
- Ob DeepSeek als Modell selbst (nach Erhalt des korrekten Arrays) `look_up`/`get_consult`
  seltener AUFRUFT als Anthropic — ausdruecklich Modellwahl, nicht Teil dieser Spur.
