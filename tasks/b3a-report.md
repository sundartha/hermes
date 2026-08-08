# Phase B3a — Detailbericht: Antwortseite der Werkzeug-Schleife neutralisieren

Basis: `master` = `7462e20`. finalBranch = `phase/b3a-antwortseite-neutral`, HEAD `ca44fb5`.

**Gate = PASS** (Safety FREIGABE mit einer Auflage + Vorbehalt; Clean-Code PASS ohne S1/S2).

## Kern der Phase

`src/llm.js` wird reiner Seam (Breaker/Retry/Backoff/Metrik/Wanduhr); alles Anthropic-Wissen zieht nach `src/llm/adapters/anthropic.js`. `claude.js` und `precall-briefing.js` lesen ab sofort `LlmTurn` (`text`/`toolCalls`/`usage`/`providerTurn`/`stopReason`) statt einer Anthropic-Antwort; `llm-usage.js` nimmt `LlmTokenUsage` und rechnet dieselbe Zahl. Der ausgehende HTTP-Body bleibt byte-identisch — inklusive Schluessel-Reihenfolge. Das ist die Abnahme, nicht die Hoffnung.

Die Anfrageseite (`system`/`tools`/`toolChoice`/`maxTokens`/`cachePrefix` neutral, `bridge.js`-Nachzug, 1-zu-N-Abbildung fuer OpenAI) bleibt B3b. `src/llm/ports.js` wurde in B3a NICHT angefasst.

---

## Grenztabelle B3a/B3b (aus dem Plan, vollstaendig)

### Konstrukte

| # | Marker / Konstrukt | Datei (Symbol) | B3a | Grund |
|---|---|---|---|---|
| K1 | `resp.content.filter(type==="text")` | `claude.js` `agentTurn` (:1023), `summarizeCall` (:1295,:1298) | faellt | Antwortseite. -> `turn.text` |
| K2 | `resp.content.filter(type==="tool_use")` | `claude.js` `agentTurn` (:1032) | faellt | Antwortseite. -> `turn.toolCalls` |
| K3 | `resp.usage` | `claude.js` `completeRound` (:794,:804), `summarizeCall` (:1291) | faellt | Antwortseite. -> `turn.usage` (`LlmTokenUsage`) |
| K4 | `resp.usage` | `precall-briefing.js` `fetchPrecallBriefing` (:307,:308) | faellt | dito; :308 wird `turn.providerTurn` (E5) |
| K5 | `resp.stop_reason` | `precall-briefing.js` (:315) | faellt | Antwortseite. -> `turn.stopReason` |
| K6 | `resp.content.find(type==="tool_use")` | `precall-briefing.js` `briefingInput` (:201) | faellt | Antwortseite. -> `turn.toolCalls.find(...)` |
| K7 | Ruecktrage `{role:"assistant", content: resp.content}` | `claude.js` `agentTurn` (:1122) | faellt | `claude.js` darf `providerTurn` nicht lesen — ohne diesen Schnitt ist die Antwortseite nicht neutralisierbar |
| K8 | `type:"tool_result"` + `tool_use_id` | `claude.js` `agentTurn` (:1130,:1131,:1135,:1136) | faellt | steht im selben `messages = [...]`-Statement wie K7; ein halber Schnitt liesse Anthropic-Vokabular an der Ruecktrage stehen. Adapter macht 1-zu-1-Abbildung; 1-zu-N (OpenAI) ist B3b/B5 |
| K9 | Stream-Ereignisse `content_block_start`, `content_block.type`, `content_block_delta`/`text_delta` | `llm.js` `completeStream` (:354-363), `isTextDelta` (:236-238) | faellt | Antwortseite, zieht in den Adapter |
| K10 | `stream.finalMessage()` | `llm.js` (:365) | faellt | dito |
| K11 | `import Anthropic`, `Anthropic.APIConnectionError`, `Anthropic.APIUserAbortError`, `CREDIT_EXHAUSTED_MARKER`, `BILLING_ERROR_TYPE`, `RETRYABLE_STATUS`, `TRANSIENT_CODES`, `PREMATURE_CLOSE_MESSAGE` | `llm.js` (:19,:23-39,:87,:94,:134,:367) | faellt | `LlmErrorClassification` gehoert dem Adapter |
| K12 | `metricsExtra(callId, resp.usage)` liest cache-Felder | `llm.js` (:224-232,:312) | bleibt als Schluesselname, Quelle wechselt | E7: Schluesselnamen bleiben (2 Bestandstests pinnen sie woertlich), gebildet aus `LlmTokenUsage` |
| K13 | `searchCount(usage)` -> `searchCount(providerTurn)` | `research/ports.js`, `research/adapters/anthropic-web-search.js`, `precall-briefing.js` `searchesToBook` | faellt (= wird umgestellt) | E5, Geldpfad `addResearchFeeCostCents` |
| K14 | `input_schema` in den Werkzeug-Definitionen | `claude.js` (:459,:472,:490,:525), `precall-briefing.js` (:60) | bleibt bis B3b | Anfrageseite. Wechsel auf `parameters` zieht `bridge.js` `realtimeTools` zwingend mit |
| K15 | `cache_control` / `CACHE_CONTROL_EPHEMERAL` / `toolsWithCacheControl` | `claude.js` (:543,:550-556,:554,:1001) | bleibt bis B3b | Anfrageseite. Verlangt `LlmRequest.cachePrefix` (E6) |
| K16 | `max_tokens` | `claude.js` (:1000,:1279), `precall-briefing.js` (:285) | bleibt bis B3b | Anfrageseite (`maxTokens`) |
| K17 | `tool_choice` | `precall-briefing.js` (:235,:236,:289) | bleibt bis B3b | Anfrageseite (`toolChoice`, dreiwertig) |
| K18 | `system` als Blockliste vs. String | `claude.js` (:1001,:1282), `precall-briefing.js` (:287) | bleibt bis B3b | Anfrageseite; haengt an K15 |
| K19 | Verlauf `{role, content:<String>}` | `claude.js` (:877-880,:888-899,:906-910) | bleibt bis B3b | bereits in beiden Anbieterwelten gueltig; Adapter reicht ihn unveraendert durch |
| K20 | `LlmProvider.limits` | `llm/adapters/anthropic.js` | kommt nicht | wuerde nur `config.llm`-Zahlen zurueckspiegeln — Indirektion ohne Mehrwert (S4). Sinn erst mit zweitem Adapter (B5) |
| K21 | Registry / `LLM_PROVIDER` | — | kommt nicht | eine Tabelle mit einem Eintrag ist Indirektion ohne Mehrwert. B5 |
| K22 | `bridge.js` | — | unberuehrt | haengt nur an K14 |
| K23 | `telnyx-llm-shim.js` | — | unberuehrt, Diff leer | importiert `degradedSpeechFor` + `isProviderBillingError` aus `llm.js`, beide Exporte bleiben unter demselben Namen bestehen |

### Marker, die B3a bewusst stehen laesst (Lead-Auflage)

| Datei | Marker | Zeilen (Bestand) | Anzahl | Grund |
|---|---|---|---|---|
| `src/claude.js` | `input_schema` | 459, 472, 490, 525 | 4 | K14 — Anfrageseite |
| `src/claude.js` | `cache_control` | 554, 1001 | 2 | K15 — braucht E6 |
| `src/claude.js` | `max_tokens` | 1000, 1279 | 2 | K16 — Anfrageseite |
| `src/precall-briefing.js` | `input_schema` | 60 | 1 | K14 |
| `src/precall-briefing.js` | `tool_choice` | 235, 236, 289 | 3 | K17 |
| `src/precall-briefing.js` | `max_tokens` | 285 | 1 | K16 |
| `src/research/adapters/anthropic-web-search.js` | `server_tool_use`, `web_search_20250305` | 12, 26 | 2 | benannte Ausnahme Spec 5.5: anbieter-spezifisch ist der Zweck der Datei, der Aufrufer reicht durch, liest nicht |

ANTWORT-Marker (`resp.content`, `resp.usage`, `resp.stop_reason`, `tool_use`, `tool_result`, `tool_use_id`, `content_block`, `@anthropic-ai`) gehen in `claude.js`, `precall-briefing.js`, `llm.js` auf **0** — inklusive `tool_result`/`tool_use_id` (K8). Kein einziger Antwort-Marker bleibt stehen.

---

## Abnahmepunkte A1-A5, A9 — Urteil und Kommando

### A1 — Syntax
```
node --check src/llm.js && node --check src/llm/adapters/anthropic.js && \
node --check src/llm/messages.js && node --check src/claude.js && \
node --check src/precall-briefing.js && node --check src/llm-usage.js && \
node --check src/research/adapters/anthropic-web-search.js
npx prettier --check src/llm.js src/llm/adapters/anthropic.js src/llm/messages.js \
  src/claude.js src/precall-briefing.js src/llm-usage.js
```
Urteil: **PASS.** Erwartet keine Ausgabe / "All matched files use Prettier code style!", Exit 0. Nebenbefund (deviation): prettier war auf `master` fuer `src/claude.js` und `src/llm.js` bereits rot (Bestandsdefekt); zur Erfuellung von A1 wurden beide Dateien jetzt prettier-konform gemacht, das erzeugt fuenf reine Formatierungs-Hunks ohne B3a-Bezug.

### A2 — Regressionssuite
```
npm test
git diff --stat master..<branch> -- test/
```
Urteil: **PASS.** `fail 0`, Exit 0, `pass = 4026` (Baseline 4007 + 19 neue Tests: 8 Golden-Master + 10 Adapter-Unit + 1 AL-P7-18). Genau fuenf Eintraege in `test/` (alle begruendet): `al-p7-llm-stream.test.js`, `llm.test.js`, `kv-p1-cost-ledger-map.test.js`, neu `b3-wire-golden-master.test.js` + `fixtures/b3-wire-master.json`, neu `b3a-anthropic-adapter.test.js`.

### A3 — Byte-Gleichheit (Kernabnahme)
```
node --test test/b3-wire-golden-master.test.js
```
Urteil: **PASS.** `pass 8, fail 0`, Exit 0. Von der Safety-Review UNABHAENGIG bestaetigt: dasselbe Fixture ist gleichzeitig gegen `master`s Produktionscode und gegen den Branch gruen (roher Body-String verglichen, nicht deepEqual). Rotproben siehe eigener Abschnitt unten.

### A4 — Bestandspins am Draht unberuehrt
```
node --test test/l3-prompt-caching.test.js test/llm-message-chain-language.test.js \
  test/al-p10-precall-research.test.js test/cq-p8-briefing.test.js \
  test/al-p4-side-effect-tool-loop.test.js test/al-p7-turn-streaming.test.js \
  test/al-p17-first-round-audible.test.js test/l0-metrics.test.js \
  test/telnyx-shim-route.test.js test/llm-sdk-learning.test.js
git diff --stat master..<branch> -- <dieselben 10 Dateien>
git diff --stat master..<branch> -- src/telnyx-llm-shim.js src/bridge.js \
  src/consult/in-call.js src/research/in-call.js src/llm/ports.js
```
Urteil: **PASS.** Erster Befehl `fail 0`, Exit 0 (Safety-Review: 67/67 gruen inkl. Ergaenzungen). Zweiter/dritter Befehl leere Ausgabe. `test/al-p10-precall-research.test.js` unveraendert ist der Beweis, dass E5 die Recherche-Gebuehr nicht verschoben hat.

### A5 — Kein Anbieter-Markup mehr im Aufrufer, mit Positiv-Kontrolle
Kommando: das im Plan angegebene `node -e '...'` (ANTWORT/VOLL-Regex ueber die fuenf Kern-Dateien).

Gemessenes Ergebnis:
```
src/claude.js               antwort 0   voll 8
src/precall-briefing.js     antwort 0   voll 6
src/llm.js                  antwort 0   voll 0
src/llm/messages.js         antwort 0   voll 0
src/llm/adapters/anthropic.js  antwort 9   voll 9
```
Urteil: **PASS mit dokumentierter Zaehl-Korrektur.** ANTWORT-Spalte der ersten vier Dateien = 0, Positiv-Kontrolle im Adapter = 9 (Ausdruck misst nachweislich etwas). Abweichung von der Planzahl bei `precall-briefing.js`: Plan erwartete VOLL 5, gemessen 6 — kein Zuschnittsfehler, sondern Zaehlfehler im Plan (Zeile `tool_choice: tooling.tool_choice` matcht den Marker zweimal). Gegenprobe gegen `master` mit demselben Ausdruck: `claude.js` antwort 13/voll 21 -> Anfrageseite 8; `precall-briefing.js` antwort 5/voll 11 -> Anfrageseite 6. Nach B3a: 8 bzw. 6 — die Anfrageseite ist EXAKT unveraendert.

### A9 — Smoke
```
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start
curl -s -o /dev/null -w '%{http_code}\n' localhost:3999/healthz
```
Urteil: **PASS, aber ueber Ersatzweg.** Der Worktree hat keine `.env`; `npm start` scheiterte am Boot-Guard (fehlend: `ANTHROPIC_API_KEY`/`PUBLIC_URL`, dann leeres `COST_TRUING_REQUIRED_RECORD_TYPES`) — korrektes fail-closed-Bestandsverhalten, kein B3a-Befund. Mit explizitem Minimal-Env (`ANTHROPIC_API_KEY`/`CLAUDE_MODEL`/`PUBLIC_URL`/`MAX_BUDGET_EUR`/`COST_TRUING_REQUIRED_RECORD_TYPES` + Temp-`DATA_DIR`) bootet der Server ohne Guard-Refusal, `/healthz` = 200. Die Safety-Review fuhr zusaetzlich unabhaengig ueber die Bestands-Spawn-Naht (`test/helpers.js startServer`, `PORT=0`, `BASE_ENV`): `/healthz` -> 200 `{ok:true}`, `POST /voice/incoming` -> 200 mit TeXML `<Response>`.

---

## Rotprobe des Golden-Masters — woertlich

Alle drei Rotproben wurden ausgefuehrt und einzeln zurueckgenommen. Basis: `node --test test/b3-wire-golden-master.test.js` (ohne Sabotage: pass 8, fail 0).

```
--- S-1: verkuerzte Ruecktrage (src/llm/adapters/anthropic.js, anthropicMessage) ---
Sabotage: `content: blocksOf(message.providerTurn)` -> `content: [blocksOf(message.providerTurn)[0]]`
Kommando: node --test test/b3-wire-golden-master.test.js
Ausgabe:
  ✔ B3-WIRE-1 (G1)  ✔ B3-WIRE-2 (G2)  ✖ B3-WIRE-3 (G3)  ✔ B3-WIRE-4 (G4)
  ✔ B3-WIRE-5 (G5)  ✔ B3-WIRE-6 (G6)  ✔ B3-WIRE-7 (G7)  ✔ B3-WIRE-8 (G8)
  ℹ pass 7   ℹ fail 1
  ✖ failing tests: B3-WIRE-3 (G3): agentTurn, zwei Werkzeuge in EINER Runde
ABWEICHUNG: der Plan erwartete G2 UND G3. G2 wird NICHT rot, weil seine erste Runde nur
EINEN content-Block traegt - `content[0]` ist dort verlustfrei. Pre-Mortem-Risiko R1
(still verkuerzte Ruecktrage) ist damit belegt gefangen, aber von G3 allein.
Zuruecknahme: Datei aus der Sicherungskopie wiederhergestellt.

--- S-2: fehlendes tool_use_id (src/llm/adapters/anthropic.js, toolResultBlock) ---
Sabotage: Zeile `tool_use_id: result.toolCallId,` geloescht
Kommando: node --test test/b3-wire-golden-master.test.js
Ausgabe:
  ✔ G1  ✖ G2  ✖ G3  ✖ G4  ✔ G5  ✔ G6  ✔ G7  ✔ G8
  ℹ pass 5   ℹ fail 3
  ✖ failing tests: B3-WIRE-2 (G2), B3-WIRE-3 (G3), B3-WIRE-4 (G4)
Wie geplant (G2/G3) plus zusaetzlich G4 - jedes Szenario mit Werkzeug-Ergebnis faellt.
Zuruecknahme: Datei aus der Sicherungskopie wiederhergestellt.

--- S-3: Schluessel-Reihenfolge (src/llm/adapters/anthropic.js, withAnthropicMessages) ---
(a) Fassung AUS DEM PLAN, ausgefuehrt:
    `return { ...request, messages: request.messages.map(anthropicMessage) };`
    Ausgabe: ℹ pass 8  ℹ fail 0  -> NICHT ROT.
    Grund, am Verhalten belegt: ein Spread mit anschliessendem Ueberschreiben eines
    BEREITS VORHANDENEN Schluessels laesst dessen Position in der Einfuegereihenfolge
    unveraendert. Der Body war weiterhin byte-identisch. Die Plan-Sabotage ist keine.
(b) Wirksame Fassung, ausgefuehrt:
    `const { messages, ...rest } = request;
     return { ...rest, messages: messages.map(anthropicMessage) };`   (messages ans Ende)
    Kommando: node --test test/b3-wire-golden-master.test.js
    Ausgabe:
      ✔ G1  ✔ G2  ✔ G3  ✔ G4  ✔ G5  ✔ G6  ✖ G7  ✖ G8
      ℹ pass 6   ℹ fail 2
      ✖ failing tests: B3-WIRE-7 (G7), B3-WIRE-8 (G8)
    Genau die zwei Szenarien, deren Anfrage messages NICHT als letztes Feld traegt
    (model, max_tokens, system, messages, tools, tool_choice). Damit ist bewiesen, dass
    der Test BYTES vergleicht und nicht nur Struktur - ein deepEqual haette (b) nicht
    bemerkt.
Zuruecknahme: Datei aus der Sicherungskopie wiederhergestellt.

--- Nach allen Zuruecknahmen ---
node --test test/b3-wire-golden-master.test.js -> ℹ pass 8  ℹ fail 0
Das Fixture test/fixtures/b3-wire-master.json wurde zu KEINEM Zeitpunkt nach der
Aufnahme veraendert (aufgenommen im Commit 42a2fe5, vor jeder Produktionsaenderung).
```

Unabhaengig davon hat die Safety-Review eigene Rotproben gefahren (Sabotage A: Schluesselreihenfolge im `tool_result`-Block getauscht -> G2/G3/G4 rot, 5/8 pass; Sabotage B: `cache_control` am letzten Tool weggelassen -> G1-G5 rot, 3/8 pass), beide zurueckgenommen, danach 8/8 gruen.

---

## Liste der bis B3b stehengelassenen Marker

1. `src/claude.js` · `input_schema` (4x: 459, 472, 490, 525 in `toolDefs`/`getConsultToolDef`/`lookUpToolDef`) · K14, Anfrageseite. Wechsel auf `parameters` zieht `bridge.js realtimeTools` zwingend mit — genau der Nachzug, den B3a bewusst nicht oeffnet.
2. `src/claude.js` · `cache_control` (2x: 554 `toolsWithCacheControl`, 1012 System-Block in `agentTurn`; dazu Konstante `CACHE_CONTROL_EPHEMERAL`) · K15, Anfrageseite. Braucht `LlmRequest.cachePrefix` (E6); eine adapter-interne Faustregel wuerde den Body von `summarizeCall`/`fetchPrecallBriefing` veraendern.
3. `src/claude.js` · `max_tokens` (2x: 1011 `agentTurn`, 1290 `summarizeCall`) · K16, Anfrageseite (-> `maxTokens`).
4. `src/claude.js` · `system` als Blockliste statt String (1012) · K18, Anfrageseite; haengt an `cache_control`/K15.
5. `src/claude.js` · Verlauf `{role, content:<String>}` (`history` in `agentTurn`) · K19: bereits in beiden Anbieterwelten gueltig, Adapter reicht ihn unveraendert durch. Wird erst mit B3b neutralisiert.
6. `src/precall-briefing.js` · `input_schema` (1x: 60, `briefingTool`) · K14, Anfrageseite.
7. `src/precall-briefing.js` · `tool_choice` (235, 236 `briefingTooling`, 298 an der Anfrage; Regex-Ausdruck zaehlt 298 doppelt) · K17, Anfrageseite. Dreiwertig (auto/required/namentlich erzwungenes Werkzeug) — der dritte Zweig ist live erreichbar.
8. `src/precall-briefing.js` · `max_tokens` (1x: 294) · K16, Anfrageseite.
9. `src/research/adapters/anthropic-web-search.js` · `web_search_20250305` (12), `server_tool_use` (28) · benannte Ausnahme Spec 5.5: anbieter-spezifisch IST der Zweck dieser Datei. Aufrufer (`precall-briefing.js searchesToBook`) reicht Rohform durch, liest sie nicht.
10. `src/llm/ports.js` · KEIN Edit in B3a, insbesondere kein `cachePrefix` · Lead-Auflage: was B3a nicht braucht, gehoert nach B3b.
11. `src/bridge.js`, `src/telnyx-llm-shim.js`, `src/consult/in-call.js`, `src/research/in-call.js` · unberuehrt, Diff leer (A4 geprueft) · `bridge.js` haengt nur an K14; der Shim importiert `degradedSpeechFor`/`isProviderBillingError` unter demselben Namen fort.
12. Bewusst nicht gebaut: Registry/`LLM_PROVIDER` (B5), `LlmProvider.limits` (B5), Preisstaffel je Token-Sorte (B4), Umbenennung der zwei Metrik-Schluessel `cache_creation_input_tokens`/`cache_read_input_tokens` (E7 — zwei Bestandstests pinnen sie woertlich).

---

## E5-Geldpfad-Urteil

**Intakt, aktiv nachgewiesen.** `searchCount` liest jetzt die opake Ruecktrage (`turn.providerTurn`) statt der neutralen Verbrauchsform — ohne diese Umstellung buchte JEDES Briefing den harten Deckel auf `addResearchFeeCostCents`, weil die neutrale `LlmTokenUsage` bewusst nur vier Token-Sorten kennt und keinen serverseitigen Such-Zaehler.

Positiv-Kontrolle (Safety-Review, selbst gefahren): `searchesToBook` auf `turn.usage` zurueckgedreht -> `test/al-p10-precall-research.test.js` `AL-P10-7` ("Zaehler=0 -> keine Gebuehr") wird ROT, weil die Buchung auf den Deckel faellt. Die Umstellung ist damit nachweislich lasttragend, die Buchung nachweislich nicht verschoben. `test/al-p10-precall-research.test.js` bleibt im A4-Leerdiff unveraendert und ist 12/12 gruen — das ist der Beweis, dass die Ist-Zahl-Buchung in allen drei Richtungen (Zaehler vorhanden, Zaehler=0, Zaehler fehlend) haelt.

**Auflage der Safety-Review (nicht blockierend, vor Merge zu erledigen):** `src/llm/ports.js:123` behauptet weiterhin, `providerTurn` sei "die Anthropic-content-Liste". Das stimmt seit `ca44fb5` nicht mehr — es ist die GANZE Antwort (`providerTurn: resp` in `toLlmTurn`), weil E5 daraus `usage.server_tool_use` liest. Wer `ports.js` woertlich nimmt und `providerTurn` auf die content-Liste zurueckschneidet, kippt die Recherche-Gebuehr still auf den Deckel. Entschaerft dadurch, dass `AL-P10-7` diesen Rueckbau rot faengt (selbst nachgemessen) — aber die Vertragszeile sollte vor dem Merge nachgezogen werden, analog zur E6-Auflage.

---

## Impl-Zusammenfassung

B3a ist umgesetzt, gruen und committet (HEAD `ca44fb5`, Branch `phase/b3a-antwortseite-neutral`, Basis `master 7462e20`). Die Antwortseite der Werkzeug-Schleife ist neutral: `claude.js` und `precall-briefing.js` lesen `LlmTurn` (text/toolCalls/usage/providerTurn/stopReason), `llm-usage.js` nimmt `LlmTokenUsage` entgegen und rechnet dieselbe Zahl (E4), das gesamte Anthropic-Wissen der Antwortseite liegt in `src/llm/adapters/anthropic.js`. `src/llm.js` ist reiner Seam — kein `import Anthropic` mehr; der Stream-Abbruch wird an der EIGENEN Wanduhr erkannt (`deadline.aborted`) statt am Anbieter-Fehlertyp, der Retry-Riegel sitzt als `guardedSink` im Seam, `providerStatusOf` ist nicht mehr exportiert (kein Konsument).

Zahlen: `npm test` Exit 0, pass 4026 (roh 4046), fail 0 — Baseline 4007 plus genau die 19 neuen Tests (8 Golden-Master + 10 Adapter-Unit + 1 AL-P7-18). Zwei aufeinanderfolgende volle Laeufe gruen.

### Deviations (bewusste Abweichungen vom Plan)

- S-3 ging NICHT rot wie geplant. Die Plan-Sabotage (`{...request, messages}`) ist wirkungslos: ein Spread mit anschliessendem Ueberschreiben eines bereits vorhandenen Schluessels laesst dessen Position unveraendert. Ersetzt durch die wirksame Fassung (`messages` destrukturieren, ans Ende haengen): G7+G8 rot.
- S-1 machte nur G3 rot, nicht G2+G3 wie geplant — G2s erste Runde traegt genau einen content-Block, `content[0]` ist dort verlustfrei.
- `AL-P7-14` musste ueber die drei im Plan genannten Aenderungen hinaus angepasst werden: der Seam erkennt den Stream-Abbruch nach B3a an der eigenen Wanduhr (`deadline.aborted`) statt am Anbieter-Fehlertyp; Test laesst den Fake-Stream jetzt real ueber eine kurz gestellte Frist hinauslaufen (`pauseMs`).
- A5-VOLL-Zahl fuer `precall-briefing.js` ist 6, nicht die geplante 5 (Zaehlfehler im Plan, siehe A5 oben).
- prettier war auf `master` fuer `claude.js`/`llm.js` bereits rot (Bestandsdefekt); zur Erfuellung von A1 wurden beide normalisiert, in Testdateien wurde die Normalisierung dagegen zurueckgenommen, damit deren Diff nur inhaltliche Aenderungen zeigt.
- Golden-Master G2 nutzt `take_message` OHNE begleitenden Text (mit Text wuerde der Turn nach einem Roundtrip enden und die Ruecktrage ginge nie auf den Draht). Analog G4: `end_call` ohne Text.
- G4 nutzt als Anrufer-Text einen 1-Zeichen-Blip (`callerSubstanceMinLen` = 2), sonst waere `end_call` nicht unterdrueckt worden.
- Golden-Master-Determinismus: `mock.timers.enable({apis:['Date']})` trug, die Plan-Kontingenz (deepEqual + Schluessel-Listen) wurde NICHT gezogen — es laeuft die Primaerform (rohe Body-Strings). Seed-Zeitstempel mussten auf denselben Zeitpunkt wie die eingefrorene Uhr gesetzt werden, sonst greift die Tenant-Kostendecke.
- Ein erster voller `npm test`-Lauf meldete 1 fail, dessen Name nicht gesichert wurde; zwei folgende volle Laeufe waren gruen. Als OFFEN zu behandeln, nicht als bekannten Flake abgehakt.
- A9-Smoke brauchte explizites Minimal-Env (siehe A9 oben) — Guard-Wirkung, kein B3a-Befund.
- D1-D6 (siehe Safety-Urteil unten) sind bewusste, dokumentierte Verhaltensdeltas.

---

## Safety-Urteil

**FREIGABE mit einer Auflage und einem ausdruecklichen Vorbehalt.**

Die Kernabnahme haelt, staerker belegt als verlangt: dasselbe Golden-Master-Fixture ist gleichzeitig gegen `master`s Produktionscode UND gegen den Branch gruen (roher Body-String verglichen). Der Draht ist byte-identisch. Der Test ist nachweislich kein Papiertiger — zweimal selbst rot gesehen (tool_result-Schluesselreihenfolge, weggelassenes `cache_control`) und danach wieder gruen. Die sieben Pins sind unberuehrt (leerer Diff) und gruen. Die Suite ist 4026/4026, Exit 0. E5 ist die sauberste Stelle des Diffs — `AL-P10-7` wird rot, sobald man die Umstellung zurueckdreht.

**Auflage (vor Merge):** `src/llm/ports.js:123` korrigieren — `providerTurn` ist nicht mehr "die Anthropic-content-Liste", sondern die ganze Antwort (siehe E5-Abschnitt oben).

**Vorbehalt:** `markersLeftDocumented = false` ist KEIN Blocker, sondern eine Zustaendigkeitsgrenze — der Safety-Reviewer konnte aus seinem Worktree nicht sehen, ob Plan und Report des Impl-Agenten die 13 Marker namentlich fuehren (dieser Bericht tut es, siehe Abschnitt "Liste der bis B3b stehengelassenen Marker").

Drei Concerns, ausdruecklich NICHT als Blocker gezaehlt, aber benannt:
- **D2** (Live-Sprechpfad): `src/claude.js:1037` prueft jetzt `if (turn.text)` statt `if (textParts.length)`. Eine Runde mit vorhandenem, aber leerem/nur-Whitespace-Textblock setzte frueher `speech=""` (und `speechStreamed`), jetzt bleibt der zuletzt gesprochene Text stehen. Sicherere Richtung (kein Blanking mitten im Turn), aber ungepinnt.
- **D4** (`summarizeCall`): liest jetzt `turn.text` = alle Textbloecke mit `" "` verbunden statt nur des ersten Blocks. Bei genau einem Textblock identisch; praktisch unerreichbar, da `summarizeCall` keine Werkzeuge anbietet.
- **D5** (Geldpfad-Nebenwirkung, Richtung sicher): `promptCharsOf` misst jetzt die neutrale Nachrichtenkette (opake Ruecktrage traegt mehr Zeichen als vorher die Anthropic-Bloecke); die pessimistische Abriss-Schaetzung `estimatedAbortUsage` faellt ab Runde 2 minimal HOEHER aus. Ueberbuchung ist die etablierte Fehlerrichtung (Regel 1), trotzdem verschiebt sich eine auf die Tenant-Kostenachse gebuchte Zahl.

Weitere Concerns: Metrik-Drift ohne Test (Cache-Zaehler nur bei Wert>0 gemeldet, D3); Fehlerklassifikation im Stream-Pfad geaendert (`deadline.aborted` statt `Anthropic.APIUserAbortError`, gedeckt durch umgebauten `AL-P7-14`); Kommentar-Irrtum im Adapter zu `{...request, messages}` (siehe S-3 oben, schadet nicht, Begruendung traegt aber nicht); zwei von vier Volllaeufen hatten isolierte, bekannte Spawn-Race-Flakes (`headers.test.js`, `owner-number-seed.test.js`), beide ohne Bezug zum LLM-Seam.

---

## Clean-Code-Audit (S1-S4)

**Verdict: PASS** — keine S1/S2-Befunde. Der Diff neutralisiert sauber die Antwortseite des LLM-Seams hinter dem in B2 gelegten Port-Vertrag. Genau EINE Uebersetzungsstelle je Anbieter (`src/llm/adapters/anthropic.js`), per grep verifiziert — keine zweite Karte im Baum. Golden-Master mit tatsaechlich aufgezeichnetem Fixture, lief gruen. Volle Suite lokal nachgefahren: 4046/4046 (bzw. 4026/4026 nach i18n-Katalog-Abzug), 0 fail.

- **S1:** keine.
- **S2:** keine.
- **S3:**
  - G11/G24 (Hausstil-Abweichung) · `src/llm/adapters/anthropic.js` · Telnyx-Hausvorbild trennt Belange in kleine Einzeldateien (errors.js, media.js, voice.js, ...); der neue Adapter buendelt Fehlerklassifikation + Antwort-Uebersetzung + Nachrichten-Uebersetzung + SDK-Factory in einer 244-Zeilen-Datei. Sauber mit Abschnitts-Kommentaren gegliedert, daher kein S2 — bei genau einem Anbieter vertretbar, bei Anbieter #2 (B4/B5) faellig. Fix dann: entlang der Sektionsgrenzen splitten.
  - G25 (Magic Number, sehr klein) · `test/al-p7-llm-stream.test.js` `BREAK_OFF_AFTER_MS`/`STREAM_BUDGET_MS` · bereits als benannte Konstanten eingefuehrt, kein Verstoss, nur zur Vollstaendigkeit notiert (PASS).
- **S4:**
  - Kein weiterer S4-Befund; Kommentardichte (~88 Kommentarzeilen auf 244) hoch, aber inhaltlich dicht und begruendungspflichtig (Preis-/Vertragslogik) — kein Muell.
  - `metricsExtra` in `src/llm.js` meldet Cache-Zaehler jetzt nur bei Wert>0 (vorher bei `!==undefined`) — dokumentiert begruendet, durch T-I13-2/3 abgedeckt, bewusste getestete Verhaltensaenderung.

Top-Todos: bei B4/B5-Adapter `src/llm/adapters/anthropic.js` entlang der Sektionen splitten (Hausstil-Angleichung); sonst mergen — Vertrag, Tests und Golden-Master sind vollstaendig und gruen.

---

## Fix-Runden

Keine separate Fix-Runde noetig — der FIXES-Abschnitt der Kette ist leer. Die einzige Korrektur innerhalb der Rotproben-Ausfuehrung selbst war der Ersatz von S-3 durch eine wirksame Sabotage-Fassung (dokumentiert oben unter Deviations und Rotprobe).

---

## Was fuer B3b OFFEN bleibt

1. **Anfrageseite neutralisieren:** `input_schema` -> `parameters` (inkl. `bridge.js realtimeTools`-Nachzug), `cache_control`/`CACHE_CONTROL_EPHEMERAL` -> `LlmRequest.cachePrefix` (E6), `max_tokens` -> `maxTokens`, `tool_choice` -> `toolChoice` (dreiwertig), `system` als Blockliste vs. String, Verlauf `{role, content:<String>}` (K19).
2. `src/llm/ports.js` bekommt in B3b sein erstes Edit — insbesondere `cachePrefix` (E6) und die Korrektur des `providerTurn`-Kommentars (Safety-Auflage aus diesem Bericht, siehe E5-Geldpfad-Urteil).
3. Die 1-zu-N-Abbildung der Werkzeug-Ergebnisse fuer OpenAI-artige Anbieter (heute Anthropic 1-zu-1 im Adapter, K8).
4. `bridge.js`-Nachzug fuer `realtimeTools`, ausgeloest durch den `input_schema`->`parameters`-Wechsel.
5. Registry/`LLM_PROVIDER` und `LlmProvider.limits` bleiben B5 (zweiter Adapter), nicht B3b.
6. Preisstaffel je Token-Sorte (B4), Umbenennung der Metrik-Schluessel `cache_creation_input_tokens`/`cache_read_input_tokens` (E7) — beide ausdruecklich nicht B3a/B3b in diesem Zuschnitt.

**Wichtig: die Abnahme von B3b selbst haengt am leeren Anthropic-Guthaben.** Bereits B3a konnte A6/A7/A8 (Bench), keinen `convo-bench`, keinen echten Anruf und keinen Aufruf gegen die echte Anthropic-API fahren — das Guthaben ist leer (gemessen 2026-08-08, HTTP 400). Die gesamte B3a-Suite lief offline gegen lokale Mocks. Dieselbe Einschraenkung gilt fuer B3b: sobald dessen Abnahme einen echten Anthropic-Aufruf braucht (z.B. um die Anfrageseiten-Neutralisierung gegen die echte API zu pruefen, nicht nur gegen Mocks), ist sie blockiert, bis das Guthaben aufgefuellt ist.
