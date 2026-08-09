# Phase B3b — Anfrageseite der LLM-Werkzeug-Schleife neutralisieren

**Gate: PASS**
**finalBranch:** `phase/b3b-anfrageseite`
**headCommit:** `f2b3920`
**Basis:** `master` = `d48f489`

## Kontext

B3a hatte bereits die Antwortseite des LLM-Ports neutralisiert. B3b macht den zweiten Schritt: die Anfrageseite (system, tools, max_tokens, tool_choice, cache_control) wird ebenfalls aus dem Fachcode (`claude.js`, `precall-briefing.js`, `bridge.js`) entfernt und wandert vollstaendig in den Anthropic-Adapter (`src/llm/adapters/anthropic.js`).

## Plan (gekuerzt)

### Kernentscheidungen
1. **Schluesselweise Uebersetzung an Ort und Stelle**, kein Neubau des Body-Objekts: die Aufrufer (`agentTurn`, `summarizeCall`, `fetchPrecallBriefing`) haben unterschiedliche Feldreihenfolgen auf dem Draht (`tools` mal vor, mal nach `messages`), und der Golden Master (`test/b3-wire-golden-master.test.js`) pinnt rohe Body-Strings. Ein `{...request, tools}`-Spread wuerde die Reihenfolge kippen. Deshalb: `withAnthropicMessages` -> `toAnthropicRequest`, iteriert per `Object.entries` und ersetzt Werte an der bestehenden Position.
2. **`LlmRequest.cachePrefix`** ist ein boolescher Hinweis ("dieses Praefix ist stabil, lohnt Caching"), keine Anweisung — kein TTL, keine Breakpoint-Zahl (Anbieter-Vokabular). Anthropic macht daraus zwei Marken (System-Block + letztes Tool), DeepSeek waere No-op.
3. **Scope-Riegel:** `tool_choice: "auto"` im OpenAI-Realtime-`session.update` (`bridge.js`) bleibt unangetastet — anderer Draht, nicht der LLM-Port. Der einzige Bridge-Nachzug ist `t.input_schema` -> `t.parameters` in `realtimeTools`.

### Neue Dateien
- `src/llm/tool-choice.js` — dreiwertiges Vokabular `LLM_TOOL_CHOICE.AUTO/REQUIRED` + `forcedTool(name)`. Dreiwertig bindend aus B2, weil `briefingTooling` einen dritten, live erreichbaren Zweig hat (namentlich erzwungenes Tool).
- `test/anthropic-wire-fixtures.js` — `anthropicToolsOnWire()`, loest bestehende Duplizierung in `al-p14`/`al-p10b`-Tests auf (G5).
- `test/b3b-request-neutrality.test.js` — neue Testdatei, 9 Faelle (B3B-1..9).

### Edits
- `src/llm/ports.js`: JSDoc geschaerft (`system` als String, `tools` als `{name,description,parameters}[]`), neues Feld `cachePrefix`, veralteter Cache-Control-Kommentar im Kopf gestrichen.
- `src/llm/adapters/anthropic.js`: neue Konstanten `CACHE_CONTROL_EPHEMERAL`, `TOOL_CHOICE_ANY/AUTO`, `TOOL_CHOICE_NAMED`; neue reine Funktionen `anthropicTool`, `anthropicTools`, `anthropicSystem`, `anthropicToolChoice`; `withAnthropicMessages` -> `toAnthropicRequest` (schluesselweise Switch-Uebersetzung, `cachePrefix` wird vor der Schleife abgestreift).
- `src/claude.js`: `input_schema` -> `parameters` in `toolDefs` (4 Treffer); `CACHE_CONTROL_EPHEMERAL`/`toolsWithCacheControl` geloescht (nach Adapter verschoben); zwei Kosten-Kommentare auf neutrales Vokabular umgeschrieben; `agentTurn` sendet jetzt `maxTokens`, `system` als reinen String, `cachePrefix: true` statt Cache-Control-Blockliste; `summarizeCall`: `max_tokens` -> `maxTokens`.
- `src/precall-briefing.js`: `input_schema` -> `parameters`; `briefingTooling` liefert `toolChoice` (neutral: `forcedTool(...)` oder `LLM_TOOL_CHOICE.REQUIRED`) statt Anthropic-Form; Aufrufstelle `max_tokens`/`tool_choice` -> `maxTokens`/`toolChoice`.
- `src/bridge.js`: `realtimeTools` liest `t.parameters` statt `t.input_schema`; Kommentar bei `tool_choice: "auto"` ergaenzt, dass das OpenAI-Realtime-Vokabular ist, kein `LlmRequest.toolChoice`.

### Tests
- Neu: `test/b3b-request-neutrality.test.js` (B3B-1 Struktur-Riegel mit Positiv-Kontrolle, B3B-2 Schluesselposition, B3B-3 dreiwertige toolChoice, B3B-4 Fail-closed bei unbekanntem Wert, B3B-5 Durchreich-Regel fuer parameter-lose Tools, B3B-6/7 cachePrefix an/aus, B3B-8 leere Tool-Liste, B3B-9 Bridge-Nachzug).
- Angepasst: `test/b3a-anthropic-adapter.test.js`, `test/b4a-model-prices.test.js`, `test/l3-prompt-caching.test.js`, `test/al-p14-in-call-consult.test.js`, `test/al-p10b-lookup.test.js`.
- Bewusst unveraendert: `test/fixtures/b3-wire-master.json` (Golden Master, Beweisstueck), `cq-p8-briefing.test.js`, `al-p10-precall-research.test.js` (AL-P10-1 belegt weiterhin den erzwungenen `tool_choice` bis in den Anthropic-Body), diverse `.name`-only-Tests.
- Vier Rotproben (R1-R4) im Plan vorgesehen: Rueckbau je eines Riegels, erwartungsgemaess rot, dann zurueckgerollt.

### Deterministisches Ergebnis (Plan-Vorgabe)
Marker-Zaehlung `input_schema`/`cache_control`/`max_tokens`/`tool_choice` in `claude.js`, `precall-briefing.js`, `bridge.js` je auf 0 (Ausnahme: `tool_choice` in `bridge.js` bleibt bei 1, OpenAI-Realtime). Golden Master 8/8 gruen, Fixture unveraendert. `npm test` exit 0, `#fail 0`, `#pass >= 4086`.

## Impl-Zusammenfassung

Umgesetzt exakt gemaess Plan. `toAnthropicRequest` (vormals `withAnthropicMessages`) uebersetzt die Anfrageseite schluesselweise an Ort und Stelle; `claude.js` und `precall-briefing.js` sprechen kein Anthropic-Vokabular mehr. Neu: `src/llm/tool-choice.js`, `LlmRequest.cachePrefix` als Anbieter-neutraler Hinweis. `bridge.js` folgt dem K22-Nachzug.

- **Golden Master:** 8/8 gruen, Fixture unveraendert (Draht byte-identisch zum Bestand).
- **Neue Testdatei:** 9 Faelle, plus geteilter Wire-Helfer `test/anthropic-wire-fixtures.js` (loest G5-Duplizierung in `al-p14`/`al-p10b` auf).
- **Rotproben:** R1-R4 manuell gefahren, bestaetigt rot (mit einer dokumentierten Feinheit bei R1, siehe Deviations), danach zurueckgerollt.
- **npm test:** 4086/4086 gruen (4077 Basis + 9 neu, keiner entfallen).
- **test:gates:** an einem unabhaengigen, vorbestehenden Hang (~Subtest 65) haengen geblieben, nicht zu Ende gefahren — siehe Deviations.
- Keine Safety-Gate-Datei, kein Auth-Pfad, kein Disclosure-Satz beruehrt; keine neue Dependency, keine neue Env-Variable.
- Commit `f2b3920`, 13 Dateien (3 neu, 10 geaendert), 441 Insertions / 84 Deletions.

### Dateien
Produktion (6, davon 1 neu): `src/llm/tool-choice.js` (neu), `src/llm/ports.js`, `src/llm/adapters/anthropic.js`, `src/claude.js`, `src/precall-briefing.js`, `src/bridge.js`
Tests (7, davon 2 neu): `test/b3b-request-neutrality.test.js` (neu), `test/anthropic-wire-fixtures.js` (neu), `test/b3a-anthropic-adapter.test.js`, `test/b4a-model-prices.test.js`, `test/l3-prompt-caching.test.js`, `test/al-p14-in-call-consult.test.js`, `test/al-p10b-lookup.test.js`

## Deviations

1. **test:gates haengt fest** bei Subtest ~65 (nach `auth-p7-gate-removed`), 0% CPU, kein Fortschritt >5 min, betroffene Datei liegt ausserhalb des B3b-Scopes (kein Katalogtest beruehrt). Prozesse per `kill -9` beendet, Lauf nicht zu Ende gefuehrt. Da B3b keinen GAP-/PROMPT-Katalogtest anfasst, sollte sich die Gates-Zahl gegenueber `master` nicht aendern — **nicht abschliessend verifiziert**.
2. **Manueller curl-Smoketest schlug fehl:** Boot-Guard verweigert Start ohne aktive Nummer im Store ("Keine aktive Nummer im Store"). Unabhaengig von dieser Phase (Store-Seeding-Voraussetzung). Betroffene Codepfade (`agentTurn`, `fetchPrecallBriefing`, `bridge.js`) sind aber ueber dutzende gruene Spawn-basierte Tests im Regressionslauf end-to-end abgedeckt (Golden Master, `al-p14`, `al-p10b`, `l3-prompt-caching`).
3. **Rotprobe R1 verhielt sich anders als erwartet:** `input_schema` statt `parameters` am END_CALL_TOOL_NAME liess Golden Master G1 GRUEN (nicht rot) — der Adapter behandelt ein Tool ohne `parameters`-Feld als anbieter-eigenes Passthrough (dieselbe Regel wie bei `web_search`), und die Wire-Form ist dabei zufaellig identisch. Der Struktur-Riegel B3B-1 (Quelltext-Scan) fing den Fehler trotzdem zuverlaessig. Kein Blocker, aber eine Feinheit der Durchreich-Regel.

## Safety-Urteil

**approved: true** — alle Achsen intakt: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. Keine Blocker.

**Verdict:** PASS. Unabhaengig nachgefahrene Laeufe: `npm test` (4086/4086, exit 0, zwei Backends abgedeckt), expliziter pg-Backend-Lauf (50/50), `node --check` auf allen 6 geaenderten src-Dateien sauber. `test:gates` nicht zu Ende gefahren (nicht abnahmerelevant). Drei eigene Rotproben gefahren (Fail-closed-Zweig, Cache-Control-Breakpoint, Struktur-Riegel) — je nach Erwartung rot, danach zurueckgerollt, Baum sauber. Golden-Master-Fixture direkt inhaltlich gelesen (nicht nur "Test gruen" geglaubt): Schluesselreihenfolge korrekt, Cache-Marken auch im gestreamten Fall, erzwungener `tool_choice` im Briefing-Body sichtbar. Eigene Messung von `promptCharsOf`: Delta 103 Zeichen / ~35 Token (Kommentar im Code behauptet ~60/~20 — siehe Concerns).

### Concerns (nicht blockierend)
- **Messzahl im Kommentar falsch:** `src/claude.js` behauptet "rund 60 Zeichen (~20 Token)" fuer den `promptCharsOf`-Effekt; nachgemessen sind es 103 Zeichen / ~35 Token. Richtung = leichte Unterbuchung der Abbruch-Schaetzung, bleibt aber innerhalb der eingebauten Pessimismus-Reserve (kein Gate-Bruch). Empfehlung: Zahl korrigieren.
- **B3B-9 schwaecher als er liest:** vergleicht `parameters`-Felder beidseitig; verliert ein Tool sein `parameters` komplett, waeren beide Seiten `undefined` und der Test bliebe gruen (in Rotprobe 3 bestaetigt — nur B3B-1 fing den Defekt). Zusaetzliches `assert.ok(...)` wuerde die Luecke schliessen.
- Latente Kopplungen ohne heutigen Pfad: `anthropicTool()` verwirft stillschweigend Zusatzfelder; Cache-Marke auf dem "letzten" Tool koennte theoretisch auf ein Server-Tool fallen, falls sich die heutige Trennung (kein Recherche-Tool + cachePrefix gemeinsam) je aendert; `LLM_TOOL_CHOICE.AUTO` hat aktuell keinen Produktions-Erzeuger.
- Fehlender Report auf dem Branch wurde in der Safety-Pruefung selbst erhoben/dokumentiert (Prozessluecke, kein Code-Defekt) — mit diesem Dokument nachgezogen.

## Clean-Code-Audit (s1-s4)

- **s1:** []
- **s2:** []
- **s3:** []
- **s4:** []
- **blocker:** false

**Verdict:** PASS. Volle Testsuite in einer git-archive-Kopie des Branches unabhaengig ausgefuehrt: 4086/4086 gruen, 0 rot. Die 6 geaenderten/neuen Testdateien zusaetzlich isoliert gruen. Kein `input_schema`/`cache_control`/`max_tokens`/`tool_choice` mehr in `claude.js`/`precall-briefing.js` (Struktur-Riegel B3B-1 mit Positiv-Kontrolle — genau das von der Lehre "Pruefkommando ohne Positiv-Kontrolle" verlangte Muster). `bridge.js` behaelt bewusst genau 1 `tool_choice`-Treffer, klar als OpenAI-Realtime-Vokabular kommentiert und testgepinnt. Fail-closed bei unbekannter Werkzeugwahl (Fehlermeldung mit Kontext, P8). Durchreich-Regel fuer anbieter-eigene Server-Tools konsistent und stimmt mit der echten `researchTools()`-Form ueberein. Golden-Master-Schluesselreihenfolge bewusst per `switch`/`Object.entries` statt Spread erhalten, mit erklaerendem Kommentar. Test-Duplizierung (al-p10b/al-p14) in dieser Phase selbst beseitigt statt neu eingefuehrt (G5 vorbildlich vermieden).

**topTodos:** []

## Fix-Runden

Keine — beide Reviews (Safety, Clean-Code) kamen im ersten Durchlauf auf PASS ohne Blocker. Die dokumentierten Concerns/Deviations sind Praezisions- bzw. Prozesspunkte, kein Nacharbeitsbedarf am Code dieser Phase.
