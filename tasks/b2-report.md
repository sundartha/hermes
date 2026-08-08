# Phase B2 — Detailbericht

## Titel
Der LLM-Port-Vertrag: was ein Sprachmodell-Anbieter koennen muss

## Ergebnis
- Gate: **PASS**
- finalBranch: `phase/b2-llm-port-vertrag-fix2`
- Neue Datei: `src/llm/ports.js` (233 Zeilen, reine JSDoc-Typdefs, einzige Anweisung `export {};`)
- Vorbilder: `src/telephony/ports.js`, `src/research/ports.js`

---

## 1. GROUNDING-LISTE (Spec -> Code -> Symbol)

Vollstaendig aus dem Plan uebernommen, weil sie die Zeilenbelege der Abnahme traegt.

### 1.1 Spec-Tabelle 2 — Bestand, den der Vertrag abbilden muss

| Spec-Angabe | am Code gefunden | tatsaechliches Symbol / Inhalt an der Stelle |
|---|---|---|
| `llm.js:19` SDK-Import | ja | `import Anthropic from "@anthropic-ai/sdk";` |
| `llm.js:252-256` `new Anthropic({timeout, maxRetries:0})` | ja | `252 const sdk = new Anthropic({` · `254 timeout: config.llm.llmRequestTimeoutMs` · `255 maxRetries: 0` |
| `config.js:240` Timeout 3500 ms je Versuch | ja, mit Zeilen-Nuance | `240 llmRequestTimeoutMs: numEnv("LLM_REQUEST_TIMEOUT_MS", …, {` — Wert `fallback: 3500` steht in 241 |
| `llm.js:194-210` `withRetry` | ja | `194 export async function withRetry(fn, {max, baseMs, jitter, retryable, sleep, random}, breaker)` … endet 210 |
| `llm.js:157-188` Breaker | ja | `157 function makeBreaker({threshold, windowMs, cooldownMs}, now)` … endet 188 |
| `config.js:245,247` Backoff-Parameter | ja | `245 llmMaxRetries: numEnv("LLM_MAX_RETRIES", …{fallback: 2})` · `247 llmBackoffMs: numEnv("LLM_BACKOFF_MS", …{fallback: 250})` |
| `llm.js:131-144` `isTransient` | ja | `131 export function isTransient(err)` … `143 return false;` `144 }` |
| `llm.js:134` `err instanceof Anthropic.APIConnectionError` | ja | exakt diese Zeile |
| `llm.js:108-114` `isProviderBillingError` | ja | `108 export function isProviderBillingError(err)`; 402-Zweig 110, `err.type === BILLING_ERROR_TYPE` 111, Textmarke 113 |
| `llm.js:88-94` Textmarke als fragil dokumentiert | ja | 88-93 Kommentar „FRAGIL, bewusst und eng gefasst …", `94 const CREDIT_EXHAUSTED_MARKER = "credit balance is too low";` |
| `llm.js:99-102` `providerStatusOf` liest `err.providerStatus ?? err.status` | ja | `99 export function providerStatusOf(err)` · `100 const status = err && (err.providerStatus ?? err.status);` |
| `llm.js:123-125` `attemptReachedProvider` | ja | `123 export function attemptReachedProvider(err)`; Kommentar 116-122 „der Versuch war nachweislich auf der Leitung" |
| `llm.js:332-334` `complete` streift `callId` ab | ja | `332 async function complete({ callId, ...params } = {})` · `333 return runResilient({callId, attempt: () => create(params), retryable: isTransient})` |
| `llm.js:347-377` `completeStream` | ja | `347 async function completeStream({callId, sink, streamBudgetMs, ...params} = {})` … endet 377 |
| `llm.js:338-341` Sink-Vertrag `pushText`/`toolUseStarted` | ja, Bereich zu weit | Sink-Zeilen sind 338-339; 340 Leerkommentar, 341 beginnt „NEUE RESILIENZ-SEMANTIK" |
| `llm.js:375` Retry-Verbot nach erstem Fragment | ja | `375 retryable: (err) => !forwardedText && isTransient(err),` |
| `llm.js:344-346` Breaker wird nicht mehr gefuettert | ja | Kommentar 343-346 „meldet dem Breaker keinen Fehlversuch" |
| `llm.js:356-359` Fugenzeichen | ja | Kommentar 356-358, Code `359 else if (event.content_block.type === "text" && textBlocks++ > 0) sink.pushText(" ");` |
| `claude.js:1025` `textParts.join(" ")` | ja | `1025 speech = textParts.join(" ").trim();` |
| `llm.js:263-266` `AbortSignal.timeout(budgetMs)` | ja | `263 const openStream = (params, budgetMs) =>` … `265 signal: AbortSignal.timeout(budgetMs),` |
| `llm-usage.js:21-27` `inputTokensOf` faltet drei Sorten | ja | `21 function inputTokensOf(usage)` summiert `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; Kommentar 19 „fail-safe: NIE weniger als ohne Caching" |
| `llm-usage.js:59-61` `billedTokens` | ja | `59 function billedTokens(usage, model)` -> `{inputTokens, outputTokens, model}` |
| `llm-usage.js:55-58` Begruendung „angeforderte ID" | ja | Kommentar 55-58 „Modell-Quelle ist die ANGEFORDERTE ID … NICHT resp.model" |
| `llm-usage.js:70-74` `bookTokenUsage` auf zwei Achsen | ja | `70 export function bookTokenUsage(...)`, `72 store.trackUsage(...)`, `73 meterAiTokens(...)` |
| `llm-usage.js:76-84` `bookEstimatedTokenUsage` nur Budget-Achse | ja | Kommentar 76-81, `82 export function bookEstimatedTokenUsage(...)`, `83 store.trackUsage(...)` — kein `meterAiTokens` |
| `llm-usage.js:86-101` `estimatedAbortUsage` | ja | `88 const ESTIMATE_CHARS_PER_TOKEN = 3`, `96 export function estimatedAbortUsage({promptChars, maxTokens})` -> nur `input_tokens`/`output_tokens` |
| `llm-usage.js:42` Ledger-`quantity` = Summe | ja | `42 quantity: tokens.inputTokens + tokens.outputTokens,` |
| `state-ops.js:2248-2254` `tokenCostUsd` mit einer In-/Out-Rate | ja | `2248 function tokenCostUsd(tokens, cfg)`; nur `price.inPerMTok` (2251) und `price.outPerMTok` (2252) |
| `state-ops.js:2240-2242` `priceForModel` | ja | `2240 function priceForModel(model, prices)` -> `Object.hasOwn(...) ? prices[model] : mostExpensivePrice(prices)` |
| `state-ops.js:2219-2229` `mostExpensivePrice` | ja | `2219 function mostExpensivePrice(prices)` |
| `state-ops.js:2524` `trackUsage` | ja | `2524 export function trackUsage(s, tenantId, tokens, cfg, nowIso)` |
| `state-ops.js:2978` `recordUsageEvent` | ja | `2978 export function recordUsageEvent(` |
| `defaults.js:566-567` Bucket kennt zwei Zaehler | ja | `566 inputTokens: 0,` · `567 outputTokens: 0,` in `emptyUsage()` |
| `config.js:1426-1429` `modelPricesUsd`, zwei Eintraege je zwei Raten | ja | `1427 "claude-haiku-4-5": {inPerMTok: 1.0, outPerMTok: 5.0}` · `1428 "claude-sonnet-5": {inPerMTok: 3.0, outPerMTok: 15.0}` |
| `boot.js:121-132` `warnUnpricedModels`, nur WARN | ja | Kommentar 121-124 „NUR WARN, kein exit(1)"; `125 function warnUnpricedModels(config)`, endet 132; kein `process.exit` |
| `claude.js:998-1005` Request-Form | ja | `998 const params = {` · `999 model` · `1000 max_tokens` · `1001 system:[...cache_control:CACHE_CONTROL_EPHEMERAL]` · `1002 tools` · `1003 messages` · `1004 callId: call.id` (in Spec-Aufzaehlung nicht genannt, im Bereich enthalten) |
| `claude.js:1023` Textfilter | ja | `resp.content.filter((b) => b.type === "text")` |
| `claude.js:1032` `tool_use`-Filter | ja | `const toolUses = resp.content.filter((b) => b.type === "tool_use");` |
| `claude.js:1122` Ruecktrage `resp.content` unveraendert | ja | `1122 { role: "assistant", content: resp.content },` |
| `claude.js:1125-1139` `{type:"tool_result", tool_use_id, content}` | ja | 1130-1132 und 1134-1138, beide Zweige |
| `claude.js:1275` `summarizeCall` ruft `llm.complete` ohne Werkzeuge | ja | `1275 const resp = await llm.complete({` — kein `tools`, kein `tool_choice` |
| `precall-briefing.js:117-126` eigene Client-Instanz mit eigenem Timeout | ja | `117 const briefingLlm = createLlmClient({` · `121 llmRequestTimeoutMs: config.llm.briefingTimeoutMs` |
| `precall-briefing.js:236` `tool_choice:{type:"any"}` | ja | `236 return {tools:[briefingTool, ...provider.researchTools()], tool_choice:{type:"any"}};` |
| `precall-briefing.js:200-202` liest `name`/`input` aus `tool_use` | ja | `200 function briefingInput(resp)` · `201 resp.content.find((b) => b.type === "tool_use" && b.name === BRIEFING_TOOL_NAME)?.input` |
| `precall-briefing.js:315` `stop_reason` nur fuer eine Logzeile | ja | `315 \`max=${config.research.researchMaxUses}, stop=${resp.stop_reason})\`` — einziges `resp.stop_reason` in `src/` |
| `telnyx-llm-shim.js:820-823` `agentTurn` mit `onSpeechChunk` | ja | `820 const turn = await agentTurn(call, callerText, {` · `821 onSpeechChunk: speakChunk,` |
| `telnyx-llm-shim.js:799-803` Fragment sofort auf die Leitung | ja | `799 const speakChunk = wire ? (text) => { if (!inFlight.signal.aborted) wire.writeChunk(text); } : null;` |
| `telnyx-llm-shim.js:242-288` SSE-Framing | ja | `242 function makeStreamingResponse(res, model)` … endet 288 |
| „die Datei enthaelt an keiner Stelle `tool_calls`" | ja | `grep -c "tool_calls" src/telnyx-llm-shim.js` -> 0 |
| `routes/voice.js:33` nutzt nur `degradedSpeechFor` | ja | `33 import { degradedSpeechFor } from "../llm.js";` |
| `telnyx-llm-shim.js:14` nutzt `degradedSpeechFor`/`isProviderBillingError` | ja | `14 import { degradedSpeechFor, isProviderBillingError } from "./llm.js";` |
| `telephony/ports.js:280` einzige Anweisung | ja | `280 export {};` — comment-stripped ist der Dateirest exakt `"export {};"` (maschinell verifiziert) |
| `telephony/ports.js:29-32` KLINGELfrist kein Parameter | ja, Bereich um 1 zu weit | Zitat in 30-32; 29 leere Kommentarzeile |
| `telephony/ports.js:81-83` „NICHT EUR … ausdruecklich NICHT Teil dieses Ports" | ja | Zitat in 82, innerhalb des Bereichs |
| `telephony/registry.js:65-88` ADAPTERS-Tabelle | ja | `65 const ADAPTERS = Object.freeze({` … `88 });` |
| `telephony/registry.js:93-98` `pick()` fail-closed | ja | `93 function pick(port, provider)` · `96 throw new Error(...)` |
| `telephony/registry.js:103-117` `CAPABILITY`/`providerSupports` | ja | `103 export const CAPABILITY`, `108 PROVIDER_CAPABILITIES`, `115 export function providerSupports(provider, capability)` |
| `research/ports.js:16-18` `searchCount` „null = unbekannt" | ja | `16 @property {(usage) => number|null} searchCount` · 18 „null = unbekannt … -> der Aufrufer bucht pessimistisch." |
| `llm.js:227-230` Anthropic-Cache-Felder (4.2) | ja | `227/229` lesen `usage.cache_creation_input_tokens` bzw. `usage.cache_read_input_tokens` in `metricsExtra` |
| `llm.js:48-76` Seam-Besitz (Reason-Enum, Fehlertyp, Degradation) | ja | `48 LLM_UNAVAILABLE_REASON`, `60 class LlmUnavailableError`, `74 export function degradedSpeechFor(err, locale)` |
| `test/llm.test.js:238-244` Fixture 5/20/100/7 | ja, Bereich um 1 verschoben | `usage`-Objekt liegt in 239-244; 238 ist `id:"x"`. Werte bestaetigt |

### 1.2 Spec-Tabelle 3.1 — die fuenf Faehigkeiten mit ihrem heutigen Aufrufer

| # | Spec-Beleg | gefunden | tatsaechliches Symbol |
|---|---|---|---|
| F1 | `claude.js:1006` (`completeRound`) | ja | `1006 const resp = await completeRound({` — Funktion `789 async function completeRound({call, params, stream})`, ruft `793 llm.complete(params)` |
| F1 | `precall-briefing.js:283-290` | ja | `283 resp = await briefingLlm.complete({` mit model/max_tokens/system/messages/tools/tool_choice |
| F2 | `claude.js:799-803` | ja | `799 const resp = await llm.completeStream({ …, sink: stream.sink, streamBudgetMs: stream.budgetMs })` |
| F2 | `telnyx-llm-shim.js:799-803` | ja | `speakChunk` -> `wire.writeChunk(text)` |
| F3 | `llm-usage.js:70-74` | ja | `bookTokenUsage` |
| F3 | `claude.js:790-791` | ja | `790 const bookReal = (usage) =>` · `791 bookTokenUsage({tenantId: call.tenantId, callId: call.id, usage, model: params.model});` |
| F3 | `precall-briefing.js:307` | ja | `307 bookTokenUsage({tenantId, callId: null, usage: resp.usage, model: config.llm.briefingModel});` |
| F4 | `llm.js:131-144` ueber `withRetry` (:194-210) | ja | `isTransient` als `retryable` in `runResilient` durchgereicht (`301 retryable,` / `333`) |
| F4 | `llm.js:108-114` ueber `telnyx-llm-shim.js:14` | ja | Import bestaetigt |
| F5 | `llm.js:252-256` (`config.js:240`) | ja | s.o. |
| F5 | Sonderfall `precall-briefing.js:117-126` | ja | eigener `briefingTimeoutMs`, `BRIEFING_MAX_RETRIES` |

**Ergebnis Plan-Grounding: 0 falsche Belege.** Fuenf Bereichsangaben um 1-2 Zeilen zu weit/eng, keine Aussage dadurch veraendert. Nach bindender Lead-Entscheidung wandert keine dieser Zeilennummern in `src/llm/ports.js`.

---

## 2. Die acht Abnahmepunkte einzeln mit Urteil

1. **Genau eine neue Datei, rein additiv** — PASS. `git diff --stat master phase/b2-llm-port-vertrag-fix2` -> ` src/llm/ports.js | 233 +++...` / 1 file changed, 233 insertions(+), 0 deletions(-); `git diff --name-status` -> genau `A src/llm/ports.js`.
2. **Syntaktisch gueltig** — PASS. `node --check src/llm/ports.js` -> Exit 0.
3. **Keine Laufzeit-Logik** — PASS. Der im Plan dokumentierte Spec-Grep war defekt (BEFUND 2, `\|` in ERE ist literal, kein Alternations-Operator; Kontrolllauf gegen `telephony/ports.js` lieferte 0 Treffer statt der erwarteten 23). Ersatzkommando (Kommentare entfernen, Rest muss exakt `"export {};"` sein) liefert `"export {};"` / exit=0. Lese-Grep zeigt 6 Treffer, alle innerhalb von JSDoc-`@property`-Zeilen.
4. **Jede Faehigkeit nennt einen echten Aufrufer** — PASS. Alle genannten Symbole (agentTurn, summarizeCall, briefingInput, fetchPrecallBriefing, briefingTooling, telnyx-llm-shim.js, providerSupports, VoiceCostRecord, CallControlOriginateParams, PrecallResearchProvider.searchCount, usdToEur, Seam-Retry-Verbot, isBillingError, stopReason-Abgrenzung) per grep im Bestand verifiziert, keins fehlt.
5. **Alle sieben B1-Usage-Felder zugeordnet oder begruendet ungelesen** — PASS. prompt_cache_miss_tokens -> inputUncachedTokens; prompt_cache_hit_tokens -> inputCacheReadTokens; completion_tokens -> outputTokens; prompt_tokens und total_tokens bewusst ungelesen (ableitbare Pruefsummen); prompt_tokens_details.cached_tokens bewusst ungelesen (undokumentiert, schwaechere Zusage); completion_tokens_details.reasoning_tokens bewusst ungelesen (in completion_tokens bereits enthalten, Erweiterungsregel verbietet Verstecken in outputTokens).
6. **Papier-Durchlauf DeepSeek** — PASS. 99 + 0 + 3200 = 3299 == prompt_tokens; inputCacheWriteTokens=0 ausdruecklich begruendet (kein eigener Schreibsatz beim Anbieter); Vollstaendigkeits-Invariante und Notfall-Zweig mitdefiniert. Einschraenkung (Safety-Concern, kein Blocker): die zugrundeliegende Rohzeile aus `data/evidence/deepseek-probe/...` ist gitignored und nicht im Repo pruefbar — nur die Abbildung der zitierten Zahlen wurde verifiziert.
7. **Papier-Durchlauf Anthropic** — PASS. Fixture `test/llm.test.js:238-243` traegt woertlich input_tokens:5, output_tokens:7, cache_creation_input_tokens:20, cache_read_input_tokens:100 — vollstaendig am Repo verifiziert, vier Zahlen auf vier Sorten ohne Faltung.
8. **Keine Secrets/PII** — PASS. Grep nach sk-/api_key/secret/bearer/Telefonnummern/E-Mail liefert keine Ausgabe, exit 1 wie erwartet.

---

## 3. Impl-Zusammenfassung

`src/llm/ports.js` neu geschrieben (finale Fassung nach Fix-Runden 233 Zeilen, reine JSDoc-Typdefs + `export {};`), Vorbild `src/telephony/ports.js`. Enthaelt:

- `LlmTokenUsage` — sechs Pflichtfelder inkl. `billingModelId`, mit Vollstaendigkeits-Invariante und Notfall-Regel bei Pruefsummen-Verletzung
- `LlmToolCall` / `LlmToolResult`
- `LlmTurn` — inkl. opaker `providerTurn`-Ruecktrage und expliziter Abgrenzung des Feldes `stopReason` (Anbieter-Abbruchgrund) vom gleichnamigen lokalen `stopReason` in `claude.js` (Schleifen-Abbruchentscheidung)
- `LlmStreamSink`
- `LlmRequest` — `toolChoice` bewusst DREIWERTIG `"auto"|"required"|{tool:string}` gemaess BEFUND 1 des Plans, weil `precall-briefing.js briefingTooling` heute live einen namentlich erzwungenen Werkzeug-Zwang nutzt, den ein zweiwertiges Feld nicht ausdruecken koennte
- `LlmErrorClassification`
- `LlmProvider` — `complete`/`completeStream` Pflicht, `limits` ohne Vorgabewert (Boot-Verweigerung bei Fehlen ist B4/B5-Arbeit)

Belegform bindend nach Lead-Vorgabe: jeder Aufrufer als Datei+Symbolname, keine Zeilennummern (siehe Abweichung unten).

### deviations
`[]` — keine Abweichung vom Plan.

### specDeviationsFound
`[]` — keine neue Spec-Diskrepanz gefunden, die nicht bereits im Plan (BEFUND 1-5) dokumentiert war.

npm test: 4027/4027 gruen, 0 rot (Impl-Lauf). Safety-Review unabhaengig nachgefahren: 4027/4027 (json-Backend) + 45/45 (pg-Backend isoliert), beide gruen.

---

## 4. Dokumentierte ABWEICHUNG: Symbolnamen statt Zeile:Datei

**Ausdruecklich als Abweichung festgehalten:** die Vertragsdatei `src/llm/ports.js` nennt Aufrufer mit Symbolnamen (z.B. `claude.js agentTurn`, `precall-briefing.js briefingInput`) statt im sonst ueblichen Muster `datei.js:zeile`.

**Grund (Lead-Entscheidung):**
- `src/telephony/ports.js` — das Vorbild fuer diese Vertragsdatei — fuehrt gemessen **NULL** Zeilenverweise auf Aufrufer.
- `clean-code.md` Regel **C2** verbietet fragile Zeilen-Kommentare.
- Ein Symbolname ist grepbar und bricht **sichtbar** (ein umbenanntes oder verschobenes Symbol erzeugt sofort einen Fehlschlag beim Nachschlagen), waehrend eine Zeilennummer bei jeder Umformatierung stillschweigend veraltet und niemand merkt, dass der Beleg nicht mehr stimmt.

Diese Abweichung wurde von allen drei Review-Instanzen bestaetigt und NICHT als Befund gewertet:
- Safety-Review: „dass Aufrufer per Symbolname statt Zeilennummer genannt werden, habe ich auftragsgemaess NICHT als Befund gewertet; die Verifikation lief ueber grep nach dem Symbol und war fuer jedes Symbol erfolgreich."
- Clean-Code-Audit: „Aufrufer werden wie angewiesen per Symbolname … statt Zeilennummer genannt — kein Befund (C2-konform per Vorgabe)."

---

## 5. Safety-Urteil

**approved: true / verdict: PASS**

Wesentliche Ergebnisse:
- `testsPassIndependently: true` — unabhaengig im frischen Worktree gefahren (nicht nur die Impl-Zahlen uebernommen). Lauf 1 (json-Backend): 4027/4027 gruen, 97,7 s. Lauf 2 (pg-Backend isoliert, pglite): 45/45 gruen, 19,4 s. Zusaetzlich `npx prettier --check` gruen, `merge-base` zeigt keinen Stale-Base.
- `onlyOneNewFile`, `noRuntimeLogic`, `everyCapabilityHasCaller`, `everyUsageFieldAccountedFor`, `paperRunDeepseekHolds`, `paperRunAnthropicHolds`, `behaviorUnchanged`, `disclosureIntact`, `safetyGatesIntact`, `scopeRespected`, `noSecretsLeaked`, `nodeCheckPass` — alle **true**.
- **blockers: []**
- **Verhalten unveraendert:** `git diff master review-b2-r2 -- ':(exclude)src/llm/ports.js'` -> LEER. Kein Bestandscode geaendert. Damit sind Absolute Regeln 1-7 des Projekts trivial unberuehrt (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer, Telnyx-Ed25519-Pruefung fail-closed, SKIP_TWILIO_SIGNATURE_CHECK, disclosureSentence, Auth fail-closed, Secrets, Audio-nie-durch-MCP): der Diff fuegt eine reine, von nichts importierte JSDoc-Datei hinzu.

**Concerns (keine Blocker):**
1. Groesste offene Kante des Vertrags (bewusst nach B3 verschoben, Spec Abschnitt 10/W1): `LlmRequest.system/messages/tools` sind als `*` typisiert mit ausdruecklichem Zusatz „innere Form ist NICHT Teil dieses Vertrags" — an dieser Kante ist der Port heute noch nicht anbieter-neutral; ein zweiter Adapter bekaeme Anthropic-geformte Strukturen durchgereicht. Kein Scope-Verstoss, aber die Stelle, an der der Vertrag am ehesten reisst, wenn B3 sie nicht schliesst.
2. Der DeepSeek-Papier-Durchlauf stuetzt sich auf eine gitignored, im Repo nicht vorhandene Rohdatei — nur die Abbildung der zitierten Zahlen war pruefbar, nicht die Messung selbst. Der Anthropic-Durchlauf ist dagegen vollstaendig am Repo verifiziert.
3. `npx eslint src/llm/ports.js` brach im Review-Worktree an der ESM-Modulaufloesung ueber den node_modules-Symlink ab — Umgebungsartefakt des Worktree-Setups, kein Codebefund. `node --check` (Exit 0) und `prettier --check` (gruen) decken die Datei ab; sollte im Hauptcheckout einmal nachgezogen werden.

---

## 6. Clean-Code-Audit (finaler Stand, s1-s4)

**verdict: PASS** — alle vier Kategorien leer.

- **s1**: `[]`
- **s2**: `[]`
- **s3**: `[]`
- **s4**: `[]`
- **blocker: false**

Begruendung: `src/llm/ports.js` (233 Zeilen, ausschliesslich JSDoc-Typedefs, `export {}` als einzige Laufzeitzeile) ist eine reine Vertragsdatei ohne Verhalten — Regeln, die Laufzeitlogik voraussetzen (F1-F4, G2-G3, G6-G9, G14-G18, G23, G27-G36), sind nicht anwendbar mangels Code. Geprueft wurden alle im Diff sichtbaren Kategorien (C, G-textuell, N, P4/P7/P26-Geist) sowie Stilvergleich mit dem Vorbild `telephony/ports.js`.

Keine Flags in irgendeiner Kategorie:
- Ton/Aufbau/Kommentardichte deckungsgleich mit dem Vorbild (reine JSDoc-Bloecke, Deutsch ohne Umlaute, Praezedenzfall-Verweise auf Nachbar-Ports). Die ausfuehrliche „Bewusst NICHT Teil dieses Vertrags"-Praeambel folgt demselben Muster wie `VoiceCostRecord` — keine G11/G24-Abweichung, da erklaertermassen Lead-Entscheidung fuer eine Vertragsphase.
- Sachliche Referenzen stichprobenartig gegen den tatsaechlichen Code verifiziert und korrekt (`telephony/ports.js` VoiceCostRecord, `research/ports.js` PrecallResearchProvider.searchCount, `config.js` usdToEur).
- C1-C5: keine Autoren-/Datums-Metadaten, keine ueberholten/redundanten Kommentare, kein auskommentierter Code.
- N1-N7: konsistente Llm-Praefix-Konvention, keine kryptischen Namen, N7 explizit adressiert (estimated-Feld statt Get-Namen).
- G25/G26 (Geist): keine nackten Zahlen, keine Geld-Fliesskommas (Token statt Geld ausdruecklich ausgeschlossen, mit Begruendung).
- Fehlender Test: kein S1 in dieser Phase — reine Vertragsphase ohne Verhalten, erwartungskonform.

topTodos: „Kein Handlungsbedarf — Phase B2 ist im Rahmen des Katalogs sauber."

---

## 7. Fix-Runden

**Runde 1** — Blocker S2 behoben: die Besitzverhaeltnis-Begruendung fuer Circuit-Breaker/Retry/Backoff/„auf der Leitung"-Praedikat/Unavailable-Fehlertyp/Degradations-Wahl stand doppelt und wortnah sowohl im Datei-Kopfkommentar als auch im JSDoc von `LlmErrorClassification` (Duplizierung). Fix: die volle Begruendung bleibt an einer Stelle, die andere verweist darauf.

**Runde 2** — Zwei Blocker behoben, ausschliesslich in `src/llm/ports.js`: die vier `LlmTokenUsage`-Property-Kommentare nannten die konkreten Anbieter-Feldnamen (Anthropic/DeepSeek) nicht durchgaengig. Fix: jeder der vier Kommentare nennt jetzt sowohl den Anthropic- als auch den DeepSeek-Feldnamen (`input_tokens`/`prompt_cache_miss_tokens`, `cache_creation_input_tokens`/„0, kein eigener Schreibsatz", `cache_read_input_tokens`/`prompt_cache_hit_tokens`, `output_tokens`/`completion_tokens`).

Nach Runde 2: finalBranch `phase/b2-llm-port-vertrag-fix2`, HEAD durch Safety unabhaengig auf `62f3dfc` (review-b2-r2) verifiziert, Gate PASS.
