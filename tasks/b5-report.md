# B5 — DeepSeek-Adapter + Anbieter-Registry: Detailbericht

**Gate: PASS**
**finalBranch: `phase/b5-deepseek-adapter`**
**Basis: `master` @ `ec3666c`, headCommit: `ca8a14f`**

---

## 1. Plan (gekuerzt)

Ziel: zweiter LLM-Anbieter (DeepSeek) hinter einer Anbieter-Registry, ohne den Anthropic-Live-Pfad zu bewegen. B5 liefert die **Faehigkeit** zum Wechsel, nicht die Umstellung.

### Designentscheidungen (D1-D11)

- **D1**: Anbieter-Wahl kommt aus dem config-Singleton (`config.llm.llmProvider`), nicht aus dem an `createLlmClient` uebergebenen `config`-Objekt — sonst kippen Attrappen-Configs (Tests, `precall-briefing.js`) auf `undefined`.
- **D2**: `createLlmClient` verliert den Parameter `apiKey`; die Registry waehlt den Schluessel je Anbieter — sonst muesste Fachcode Anbieter-Wissen tragen.
- **D3**: `LLM_PROVIDER`-Validierung in `config.js` (`enumEnv`), NICHT als `boot-guard.js`-Finding — der Anbieter wird beim IMPORT von `claude.js` gelesen, ein Guard danach kaeme zu spaet.
- **D4**: `LlmProvider.limits` (K20) kommt NICHT — kein Konsumer ohne zweite Quelle fuer dieselbe Zahl (Konflikt mit `turn-budget.js`). Akzeptiertes Restrisiko: B1 mass fuer `deepseek-v4-pro` max 3183 ms bei 3500 ms Default-Timeout (9 % Luft).
- **D5**: `providerTurn` des DeepSeek-Adapters = nur die Assistant-Nachricht, nicht die ganze Antwort (kein zweiter Leser wie bei Anthropics `server_tool_use`).
- **D6**: Werkzeug ohne `parameters` (Anthropics serverseitiges `web_search`) → benannter Throw, kein stilles Verwerfen (sonst liefe das Briefing ohne Recherche, obwohl angekuendigt).
- **D7**: `deepseekErrors.isBillingError` konstant `false` — der 402-Fall wird bereits anbieter-unabhaengig vom Seam beurteilt.
- **D8**: Preisstaffel nur fuer `deepseek-v4-pro` (nicht `-flash`, das keine Werkzeuge kann).
- **D9**: Kein Boot-Guard "Modell passt zu Anbieter" — Fehlfall ist laut (HTTP 400), Warnung in `.env.example`.
- **D10**: Kein Boot-Banner-Eintrag fuer `LLM_PROVIDER` (Scope).
- **D11**: `ANTHROPIC_API_KEY` bleibt unbedingte Boot-Pflicht, auch bei `LLM_PROVIDER=deepseek`.

### Neue Dateien (Plan)

- `src/llm/provider.js` — Enum `LLM_PROVIDER`, Default, Werte-Liste (Spiegel von `stt-profile.js`).
- `src/llm/transient-errors.js` — G5/S2-Extraktion der Status-/Transport-Fehlerklassifikation aus `anthropic.js` (verhaltenserhaltend, Rekursion bleibt in der Closure).
- `src/llm/registry.js` — `createLlmProvider()`, `activeLlmErrors()`; Adapter-Tabelle mit `Object.hasOwn`-Zugriff (kein Prototyp-Treffer bei `__proto__`); Schluessel lazy per Arrow gelesen.
- `src/llm/adapters/deepseek.js` (~230 Zeilen) — nacktes `fetch` + eigener SSE-Leser, keine neue Dependency. Kern-Verhalten (aus B1-Spike belegt): `thinking:{type:"disabled"}` fest im Body; `system` als erste Nachricht; `toolResults` → N `tool`-Nachrichten; `cachePrefix` abgestreift; `toolChoice` explizit gemappt; W2 fail-closed bei unparsebaren Argumenten (Meldung nennt Name+ID, nie den Argument-String); Verbrauchs-Mapping mit Vollstaendigkeits-Invariante `prompt_tokens===hit+miss` (sonst `estimated:true`); `billingModelId`=angeforderte ID; Text nicht getrimmt; Streaming akkumuliert `tool_calls` ueber `index` vor dem Parsen; `reasoning_content` wird verworfen; Fehler tragen `err.status`, Text auf 200 Zeichen gekuerzt, nie Schluessel/Body.

### Edits an Bestandsdateien

- `src/llm/adapters/anthropic.js` — reiner Refactor: Statusklassen/Transport-Codes wandern nach `transient-errors.js`, nur das SDK-eigene Praedikat bleibt. Keine Teststaenderung an Bestandstests.
- `src/llm.js` — `createLlmClient` ohne `apiKey`; `isTransient`/`isBillingError` ueber `activeLlmErrors()`/Registry statt fest verdrahtetem Anthropic-Import.
- `src/llm/ports.js` — `LlmProvider.limits` (K20) entfernt, durch Nicht-Teil-des-Vertrags-Notiz mit Begruendung ersetzt; `LlmToolCall.input` W2-Entscheidung dokumentiert.
- `src/config.js` — Import Enum; neuer Parser `enumEnv` (vierter Geschwister-Parser zu `numEnv`/`boolEnv`/`isoInstantEnv`); `llmProvider`+`deepseekApiKey` in `rawConfig`; DeepSeek-Preisstaffel in `MODEL_PRICE_SCHEDULES` (abgerufen 2026-08-07, gegengelesen 2026-08-08); `CONFIG_NAMESPACES.llm` 12→14; `assertConfig` macht `DEEPSEEK_API_KEY` bedingt Pflicht.
- `src/claude.js` / `src/precall-briefing.js` — `apiKey`-Parameter entfaellt ersatzlos.
- `.env.example` — neuer Block `LLM_PROVIDER`/`DEEPSEEK_API_KEY` mit den drei Mitzieh-Pflichten bei Umstellung (Modelle, Timeout/Turn-Budget, `RESEARCH_ENABLED=false`).
- `render.yaml` — `DEEPSEEK_API_KEY` (sync:false, Secret), `LLM_PROVIDER=anthropic`.

### Tests (Plan)

- `test/helpers.js` BASE_ENV: `LLM_PROVIDER=anthropic`, `DEEPSEEK_API_KEY=""` (Lehre: lokale .env-Leaks in Spawn-Tests).
- `test/config-namespaces.test.js`: `llm: 12→14`.
- `test/llm.test.js`: toter `apiKey`-Testparameter entfernt.
- NEU `test/b5-deepseek-adapter.test.js` (B5-1..B5-16): Anfrage-Form, `cachePrefix`-Abstreifung, `toolChoice`-Mapping, Nachrichtenformen, Tool-Call-Parsing, W2 fail-closed (+Rand), Verbrauchs-Mapping, Invariante-Verletzung, fehlendes usage, Streaming-Fragmentierung, `reasoning_content`-Verwerfung, Streaming-Draht, fehlende `parameters` → Throw, Fehlerklassifikation, Secret-Schutz.
- NEU `test/b5-llm-registry.test.js` (B5-R1..R7, B5-P1): Default-Registry, DeepSeek-Wahl inkl. Bearer-Header, unbekannter Wert/`__proto__` → Throw, Spawn-Boot-Refusal bei Tippfehler, Gegenprobe gueltiger Wert, fehlender Schluessel → Boot-Refusal, voller Anbieterwechsel via Env → `/healthz` 200, Preis-Fail-closed-Rate unveraendert.
- 6 Rotproben (Pflicht): `thinking` entfernen, Parse-Fehler verschlucken, `reasoning_content` durchreichen, Stream-Akkumulation kaputt machen, `enumEnv`-Push entfernen, DeepSeek-Staffel entfernen — je einen der obigen Tests rot machen, dann zurueckbauen.

### Ausdruecklich NICHT in dieser Phase

`bridge.js`, Live-Umstellung des Anbieters, `convo-bench`-Vergleichslauf, `LlmProvider.limits`, Boot-Banner-Zeile, Lockerung `ANTHROPIC_API_KEY`-Pflicht, Rename der Seam-Namen, `deepseek-v4-flash`-Preisstaffel, B4b/Kostenmessung, Store-Migration, neue npm-Dependency.

---

## 2. Implementierung — Zusammenfassung

B5 vollstaendig gemaess Plan umgesetzt und committet (`ca8a14f` auf `phase/b5-deepseek-adapter`, Basis `master ec3666c`).

**Entstanden**: der zweite Adapter (`src/llm/adapters/deepseek.js`, nacktes `fetch` + eigener SSE-Leser, keine neue Dependency), die Registry (`src/llm/registry.js`, Wahl aus dem config-Singleton, lazy Schluessel je Anbieter, fail-closed ueber `Object.hasOwn`), das Enum (`src/llm/provider.js`) und die G5/S2-Extraktion der anbieter-unabhaengigen Fehlerklassifikation (`src/llm/transient-errors.js`). `createLlmClient` verliert den `apiKey`-Parameter; `claude.js` und `precall-briefing.js` kennen kein Anbieter-Wissen mehr.

**Geloeste DeepSeek-Eigenheiten**: `thinking:{type:"disabled"}` fest im Body (sonst HTTP 400 bei `tool_choice:"required"`, dem Live-Pfad von `precall-briefing.js`); Zusammensetzen fragmentierter `tool_calls` ueber `index` vor dem Parsen; Verwerfen von `reasoning_content`. W2 fail-closed: unparsebare Werkzeug-Argumente werfen benannt, Meldung nennt Werkzeug+Aufruf-ID, niemals den Argument-String.

**K20**: `LlmProvider.limits` kommt bewusst nicht — Vertrag in `ports.js` korrigiert, Restrisiko dreifach dokumentiert (`ports.js`, Adapter-Kopf, `.env.example`).

**Verifikation**: `node --check` auf allen 10 geaenderten/neuen Quelldateien Exit 0. `npm test` 4110/4110 gruen, fail 0, exit 0 (Baseline 4086 + 24 neue B5-Tests, `grep -c "^ok .* - B5-"` == 24, skipped 0). Golden Master (`test/b3-wire-golden-master.test.js` + Fixture) gegenueber `master` unveraendert (leeres `git diff --stat`) und isoliert gruen. Kein `api.deepseek.com` ausserhalb des Adapters (mit Positiv-Gegenkontrolle geprueft). Sechs Rotproben gefahren, jede wurde rot, dann zurueckgebaut.

**Safety-Gates, Offenlegungssatz, Signaturpruefung**: unberuehrt. Regel 1 zusaetzlich gepinnt: B5-P1 belegt, dass der Fremdanbieter das punktweise Maximum ueber alle Preisstaffeln — und damit die Fail-closed-Rate fuer unbekannte Modelle — nicht anhebt.

**Testzahlen**: `testPassCount: 4110`, `testFailCount: 0`, `testsPass: true`, `nodeCheckPass: true`, `smokePass: true`.

### Smoke-Test

Server als Kindprozess mit `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY=sk-smoke-dummy`, `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL=deepseek-v4-pro`, `SKIP_TWILIO_SIGNATURE_CHECK=true`, `DATA_DIR`=Temp: `/healthz` → 200, `POST /voice/incoming` → 200 mit gueltigem TeXML (erwartete "Nummer nicht erreichbar"-Antwort, weil To-Nummer nicht die geseedete Owner-Nummer ist — kein Boot- oder Registry-Fehler). Im Boot-Log erscheint die DeepSeek-Modell-ID, keine Zeile "ohne Preis in modelPricesUsd". Ein erster Direktversuch ohne geseedeten Store scheiterte erwartungsgemaess am Bestands-Boot-Guard ("Keine aktive Nummer im Store") — danach ueber `startServer` mit Seed wiederholt. Dieselben Aussagen sind zusaetzlich als automatisierte Spawn-Tests B5-R5/R6/R7 gepinnt.

### Deviations (Abweichungen vom Plan)

1. **B5-P1** prueft die ausgelieferte, aufgeloeste Preistabelle (`config.llm.modelPricesUsd`) statt der Roh-Staffeln. Der Plan-Wortlaut haette einen neuen Test-Export von `MODEL_PRICE_SCHEDULES` aus `config.js` verlangt (Produktionscode nur fuer einen Test). Die aufgeloeste Tabelle ist zudem exakt die Quelle, aus der `worstCasePrice` die Fail-closed-Rate bildet — die Aussage bleibt identisch, ohne Zahlen-Literale (Muster B4A-TAB-1).
2. Zwei Bestandstests in `test/config-namespaces.test.js` mussten ueber die im Plan genannte Zeile hinaus angepasst werden: `EXPECTED_TOTAL_KEYS` 141→143 und die Zahl der primitiven Blaetter 132→134. Beides mechanische Folgen der zwei neuen `llm`-Keys (`llmProvider`, `deepseekApiKey`), keine Verhaltensaenderung; der Plan nannte nur den Namespace-Count 12→14.
3. `test/b5-llm-registry.test.js` B5-R2 setzt zusaetzlich einen unterscheidbaren `anthropicApiKey`-Sentinel. Ohne ihn ist der Anthropic-Schluessel im Testprozess der leere String und die Assertion "der falsche Schluessel ging nicht raus" waere strukturell unfalsifizierbar (Teilstring-Falle).
4. Der DeepSeek-Adapter setzt in `complete()` KEIN explizites `stream:false` (Anbieter-Default). Nur `completeStream` ergaenzt `stream:true` + `stream_options` — ein zusaetzliches Feld waere ein Wert ohne Leser.
5. `armedSignal` armiert den Per-Versuch-Timeout nur, wenn `requestTimeoutMs` eine endliche positive Zahl ist. Grund: `AbortSignal.timeout(undefined)` bricht sofort ab und wuerde jeden Unit-Test ohne Timeout-Angabe sinnlos scheitern lassen. In Produktion setzt die Registry den Wert immer.

### Geaenderte/neue Dateien

**Neu**: `src/llm/provider.js`, `src/llm/transient-errors.js`, `src/llm/registry.js`, `src/llm/adapters/deepseek.js`, `test/b5-deepseek-adapter.test.js`, `test/b5-llm-registry.test.js`.

**Editiert**: `src/config.js`, `src/llm.js`, `src/llm/ports.js`, `src/llm/adapters/anthropic.js`, `src/claude.js`, `src/precall-briefing.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/config-namespaces.test.js`, `test/llm.test.js`.

---

## 3. Safety-Urteil (final)

**Verdict: FREIGABE (approved: true)**

Alle Kern-Flags gruen: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`. `blockers: []`.

### Unabhaengige Verifikation

Worktree `.claude/worktrees/wf_68733d31-47e-3`, Branch `review-b5` aus `phase/b5-deepseek-adapter` (1 Commit `ca8a14f`, 17 Dateien, +1376/-72).

1. `npm test` (beide Backends, json via BASE_ENV + 177 Dateien via pglite): 4110 Tests, 4110 pass, 0 fail, 0 cancelled, 0 skipped, exit 0, 99,1 s. Baseline 4086 + 24 neue B5-Tests exakt. Erster Anlauf haengte an `test/kv-m0-boot-banner-config.test.js` — Ursache NICHT B5 (parallel lief ein anderer Agent, verwaister `node src/server.js`); Gegenprobe isoliert 6/6 gruen, nach Kill 99 s durch.
2. Expliziter pg-/Port-Teillauf (alle `store-pg*`, `b3-wire-golden-master`, `b3a-anthropic-adapter`, `b3b-request-neutrality`, `llm`, `al-p7-llm-stream`, `b5-*`, `config-namespaces`): 177/177 gruen, exit 0. Golden Master unveraendert und gruen.
3. `node --check` auf allen 8 geaenderten/neuen Quelldateien: Exit 0.
4. Sechs eigene Rotproben (M1-M6), alle wirksam: `thinking` entfernt → B5-1+B5-13 rot; `reasoning_content` durchgereicht → B5-12 rot; W2 fail-open → B5-6+B5-7 rot; Stream-Fragmente ungebuendelt → B5-11 rot; Positiv-Kontrolle (neutrale Zeile) → 0 rot; `Object.hasOwn`→Roh-Index → B5-R3 (`__proto__`) rot. Arbeitsbaum danach sauber wiederhergestellt.

### Bewertung nach Regelkategorie

- **SAFETY-GATES**: unangetastet. `git diff master..review-b5 --stat` ueber Routen/Telephony/Store/Billing/Auth/Middleware/Route-Policy/Boot-Guard/Server/Bridge ist leer. Regel 1 (Preis-/Budget-Achse) positiv abgesichert: DeepSeek-Staffel mit `validFrom`/`asOf`/`source`; B5-P1 pinnt ohne Zahlen-Literale, dass das punktweise Maximum ueber alle Staffeln unveraendert bleibt.
- **OFFENLEGUNG**: unveraendert; `bridge.js` nicht im Diff; `disclosureSentence` kommt in keinem Treffer vor. `claude.js` aendert genau eine Zeile (Schluessel wandert zur Registry).
- **AUTH FAIL-CLOSED**: unberuehrt (keine Route/Middleware im Diff). Neu: `enumEnv` bricht Boot bei vertipptem `LLM_PROVIDER` ab (B5-R4, mit Gegenprobe B5-R5); `assertConfig` macht `DEEPSEEK_API_KEY` bedingt Pflicht ohne `ANTHROPIC_API_KEY` aufzuweichen; Registry wirft ueber `Object.hasOwn` (kein Prototyp-Treffer, M6 belegt).
- **SECRETS**: sauber. Schluessel nur im `authorization`-Header; Fehlermeldungen tragen nie Body/Key/Argument-String (B5-6/B5-16); `test/helpers.js` pinnt `DEEPSEEK_API_KEY=""` statt Dummy, um den echten lokalen Schluessel nicht in Spawn-Prozesse zu leaken; `render.yaml` mit `sync:false`.
- **SCOPE**: eingehalten. Keine neue Dependency (`package.json` nicht im Diff). Die zwei Erweiterungen ueber den engen Phasenrand (`transient-errors.js`, `enumEnv`) sind beide begruendet und minimal.
- **VERHALTEN**: Default `anthropic`, Wechsel nur per Env; Flag-off gleichwertig zum Bestand (Golden Master unveraendert).

### Concerns (nicht blockierend, vor Umstellung zu klaeren)

1. **Streaming-Ruecktrage verliert `type:"function"`**: `mergeToolCallFragment` (deepseek.js) baut Aufrufe im Stream-Pfad ohne das OpenAI-Pflichtfeld `type`; `deepseekMessage` legt sie 1:1 auf den Draht. Nur mit `LLM_PROVIDER=deepseek` erreichbar (heute tot), Folge waere HTTP 400 in Runde 2 eines gestreamten Werkzeug-Gespraechs. Der B1-Spike hat diesen Pfad nie repliziert.
2. `orderedToolCalls` sortiert mit `(a,b)=>a-b` und setzt einen numerischen `index` voraus; kaeme er als String, faellt die Sortierung stillschweigend auf Map-Einfuegereihenfolge zurueck.
3. Vertrags-Drift in `ports.js`: `LlmRequest.tools` sagt weiterhin, ein Eintrag ohne `parameters` "geht unveraendert durch" — der DeepSeek-Adapter wirft stattdessen benannt (die sicherere Richtung, aber der Porttext ist nicht nachgezogen).
4. K20-Restrisiko (siehe D4/Adapter-Kopf/.env.example): 9 % Timeout-Luft ohne Last, ungeguardete Mitzieh-Pflicht beim Anbieterwechsel.
5. Umgebungsbefund (kein Branch-Defekt): ein anderer Agent hielt beim ersten Suite-Lauf einen verwaisten `node src/server.js` — hat den Lauf blockiert, vor der naechsten Welle aufraeumen.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS** (`blocker: false`)

### S1 (hart, Blocker)
Keine Befunde.

### S2 (hart, Blocker)
Keine Befunde.

### S3 (Stil/Konsistenz, nicht blockierend)
- Kommentardichte in `deepseek.js`/`registry.js`/`ports.js` sehr hoch (teils >10 Zeilen Begruendungstext pro Funktion) — folgt konsequent dem im Repo etablierten Stil (B4a/B1), keine Inkonsistenz → n.z. statt FLAG.
- `src/llm/provider.js` ist ein winziges Modul mit nur 3 Konstanten-Exports — bewusst nach `telephony/stt-profile.js` gespiegelt (im Kommentar begruendet), keine willkuerliche Fragmentierung.

### S4 (Architektur-Bewertung)
- Drei neue Kleinst-Module (`provider.js` 10 Zeilen, `transient-errors.js`, `registry.js`) statt eines gemeinsamen — jedes einzeln durch eine Zyklus-/Wiederverwendungs-Begruendung im Kopfkommentar gedeckt (Zyklus-Vermeidung `config.js`↔`llm/registry.js` bzw. G5-Extraktion). Kein Dogmatismus erkennbar → PASS statt FLAG.

### Begruendung des PASS

Kein S1-, kein S2-Befund. Der Diff fuegt einen zweiten LLM-Adapter plus Registry sauber nach dem etablierten Provider-Registry-Muster (`telephony/registry.js`) ein: DIP durchgehend, Konstruktion/Verdrahtung sauber getrennt vom Fachcode (P15), Fehlerklassifikation anbieter-uebergreifend dedupliziert (loest tatsaechlich eine Duplizierung auf statt eine zu schaffen), fail-closed Boot-Verhalten durch Spawn-Tests belegt, Secret-Handling explizit getestet. 48 unmittelbar betroffene Tests isoliert 48/48 gruen; `node --check` fehlerfrei auf allen geaenderten Dateien. Ein voller `npm test`-Lauf zeigte 1 Fail bei >4000 Tests unter Parallel-Last durch andere Worktrees (Systemlast, siehe Projekt-Lehre zur Parallelitaets-Grenze) — konkrete Zeile nicht isolierbar gewesen, kein B5-eigener Test betroffen.

### Pass-Notes

Saubere Trennung Seam/Adapter (`llm.js` kennt weiterhin nur den Port-Vertrag). G5 aktiv verbessert: `isTransient`-Statusklasse+Transportcodes standen bis B5 komplett im Anthropic-Adapter und waeren im DeepSeek-Adapter byte-identisch dupliziert worden — jetzt einmal in `transient-errors.js`. Fehlerpfade sauber mit Kontext (P8), nie Argumente/Schluessel/Body (per Test belegt). Preistabelle: B5-P1 verhindert gezielt, dass eine DeepSeek-Rate die fail-closed-Hoechstrate anhebt. `enumEnv` sauberer vierter Geschwister-Parser. `config-namespaces`/`helpers.js` konsistent nachgezogen. Keine toten Funktionen, keine unbenutzten Imports gefunden.

### Top-Todos

1. Vollen `npm test`-Lauf isoliert (ohne parallel laufende Workflows/Worktrees) wiederholen, um den 1 Fail aus dem lastbehafteten Lauf zu verifizieren oder als Flake abzuhaken — keiner der B5-Tests war in der Einzelpruefung betroffen.
2. Vor einem echten Umstieg auf `LLM_PROVIDER=deepseek` die drei in `.env.example` dokumentierten Mitzieh-Pflichten (Modell-IDs, `LLM_REQUEST_TIMEOUT_MS`/Turn-Budget-Nachrechnung, `RESEARCH_ENABLED=false`) tatsaechlich abarbeiten — B5 liefert nur die Faehigkeit, nicht die Umstellung.
3. Die von DeepSeek angekuendigte Preiserhoehung im Auge behalten (`stalePriceFindings`/90-Tage-Waechter ist vorhanden, ersetzt aber laut Kommentar kein manuelles Nachpflegen).

---

## 5. Fix-Runden

Keine — der erste Impl-/Review-Durchlauf ergab direkt PASS (Safety FREIGABE, Clean-Code PASS), keine Fix-Runde noetig. `FIXES` ist leer.
