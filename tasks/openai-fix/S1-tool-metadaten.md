# Schnitt S1: Tool-Metadaten - Annotations und Beschreibungen
Blocker: P0-1 (Kategorie A) | dazu D3-Befunde PP-D3-01 (P0/B), PP-D3-06 (P0/B), PP-D3-02 (P1/B), PP-D3-03 (P1/C), PP-D3-07/08 (P1/B, = P0-1), PP-D3-10 (P2/C, title als Nebeneffekt mit erledigt) | Anforderungs-IDs: N-01, N-02, N-03, N-06, N-07, W-07, W-09 (00-mcp-spec.md)

## Ist-Zustand

**Annotations (P0-1 / PP-D3-07/08).** Kein Werkzeug traegt `annotations`. Beleg:
`grep -rn "readOnlyHint\|destructiveHint\|openWorldHint\|idempotentHint\|annotations" src/` = 0
Treffer. 12 Registrierungen in `src/mcp-tools.js`, zwei Wege:
- **10 Tools** ueber den lokalen `uiTool(name, config, handler)`-Helfer (`src/mcp-tools.js:655`,
  ruft `server.registerTool(name, config, wrapHandler(handler))`): place_call (:665),
  await_call_event (:858, nur bei `consultAllowed`), answer_consult (:892, dito),
  get_call_status (:998), get_transcript (:1014), get_my_number (:1068), list_calls (:1095),
  check_inbox (:1125), get_calendar (:1172, nur bei `allowCalendar`), get_agent_status (:1209).
  `registerTool`s Config-Typ traegt `annotations?: ToolAnnotations` bereits
  (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:143-150`) - reine
  Ergaenzung im Config-Objekt, keine SDK-Grenze.
- **2 Tools** ueber den lokalen `tool(name, desc, schema, handler)`-Helfer (`src/mcp-tools.js:650`,
  ruft `server.tool(name, desc, schema, wrapHandler(handler))` - 4 Positionsargumente): cancel_call
  (:1057), list_action_items (:1149). Owner-Auflage am Code (Kommentar :1052-1054, "TEIL C,
  Owner-Auflage 15.08.2026, registerTools darf NICHT wachsen"): diese zwei bleiben auf dem
  Legacy-`tool()`-Pfad, keine Migration auf `registerTool`. Die SDK-Implementierung von
  `server.tool()` (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:657-695`)
  parst ihre Restargumente variadisch und akzeptiert Annotations als eigenstaendiges Objekt
  zwischen Schema und Callback (`tool(name, description, paramsSchema, annotations, cb)`,
  Zeilen 668-692 dort) - geprueft durch Lesen der Parser-Logik, kein SDK-Upgrade noetig.
  `ToolAnnotationsSchema` (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:2361-2367`)
  hat genau die Felder `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint` - alle optional, keine weiteren.
- Soll-Tabelle je Tool (Werte, Begruendung) steht bereits in
  `tasks/openai-audit/03-tool-semantik-annotations.md` PP-D3-08 - hier nicht dupliziert,
  siehe Abschnitt "Aenderungen".

**Beschreibungen (PP-D3-01/02/03/06).**
- `PLACE_CALL_DESCRIPTION` (`src/mcp-tools.js:529`, Modul-Ebene, byte-identisch in
  `placeCallDescription(consultLoop)` verwendet, `:539-540`): "...Returns a call_id
  immediately and shows a live card that updates itself (status, duration, transcript,
  result). You do NOT need to poll - if no live update arrives, get_call_status remains
  available as a fallback." Diese Zusage ist UNBEDINGT - sie haengt nicht an
  `enableWidgetUi(WIDGET_CALL)` (:791, im Handler-Config gespreadet). `src/ui/registry.js:23-33`
  haelt fest: fuer einen echten ChatGPT-Host bleibt "die live-aktualisierende Karte selbst
  (Self-Poll, ...) STUMM", weil kein per-Host-Capability-Gate mehr existiert (siehe
  Modulkommentar dort) - das Widget-`_meta` wird unabhaengig von echter Host-Faehigkeit
  angehaengt, sobald `config.tenancy.mcpUiEnabled` an ist. Die Beschreibung kann diese
  Luecke deshalb NICHT durch eine Bedingung auf `enableWidgetUi(...)` schliessen (das
  waere am Ist-Zustand vorbei geplant) - sie muss stattdessen aufhoeren, etwas zuzusagen,
  das der Server nicht messen kann. Kein Kostensatz vorhanden (PP-D3-03).
- `PLACE_CALL_CONSULT_LOOP` (:538, angehaengt bei `consultAllowed`): "...keep calling it
  until it returns event=\"done\"...". Bei aktivem Kanal stehen beide Saetze nebeneinander
  in EINER Beschreibung (PP-D3-06) - "you do NOT need to poll" gegen "keep calling ...
  REPEATEDLY".
- `get_transcript`-Beschreibung (inline im Config-Objekt, `src/mcp-tools.js:1017-1019`):
  "For data protection reasons the raw transcript is not kept after the summary (data
  minimisation) and is NOT returned...". Widerspruch zu `diagnostic`-Feldbeschreibung
  (:818, `place_call`-Schema): "The server keeps the raw transcript of a call to the
  user's OWN verified number for a limited period on its own...". Quelle der echten Regel:
  `src/diagnostic-retention.js` (`diagnosticRetentionEnabled`/`callerDeclined`).
- `get_call_status`-Beschreibung (inline, :1002): "The live card from place_call normally
  updates itself; this tool remains available as a manual fallback..." - echot dieselbe
  Ueberzusage in schwaecherer Form; bleibt nach einer Korrektur von PLACE_CALL_DESCRIPTION
  allein stehen und wuerde der neuen, ehrlichen place_call-Aussage sonst widersprechen.

**Tests, die heute genau diese Texte/Metadaten festhalten (und deshalb angefasst werden
muessen):**
- `test/p15-mcp-tool-descriptions-en.test.js` - `EXPECTED_MARKERS` pinnt Anzahl UND
  Reihenfolge der GROSSSCHRIFT-Marker je Beschreibungspfad (`place_call: ["NOT"]`,
  `get_transcript: ["NOT"]`, `get_call_status: []`). Faengt BEIDE Registrierwege
  (`captureDescriptions()`, :39-60).
- `test/gq-b1-briefing-openness.test.js` - `PLACE_CALL_BUDGET_CHARS`/
  `PLACE_CALL_WITH_CONSULT_BUDGET_CHARS` (Obergrenzen, kein exakter Pin) + die Invariante
  "looped beginnt mit plain" (`loopSuffixOf`, GQ-B1-02/03/04).
- `test/al-p13-consult-channel.test.js` AL-P13-36 - dieselbe startsWith-Invariante,
  strukturell (kein Content-Pin gegen einen alten String).
- Fuer Annotations existiert HEUTE gar kein Test (Beleg: 0 Treffer fuer
  `readOnlyHint`/`destructiveHint`/`openWorldHint`/`idempotentHint` in `test/*.test.js`) -
  das ist der Wegdrift, den dieser Schnitt schliesst (siehe "Aenderungen", neuer Test).

## Soll-Zustand

1. Alle 12 Tools liefern in `tools/list` ein `annotations`-Objekt mit exakt den Feldern aus
   der Tabelle unten (kein Tool ohne `annotations`; readOnly-Tools tragen KEIN
   `destructiveHint`/`idempotentHint`, da laut N-01 nur bei `readOnlyHint === false`
   sinnvoll).
2. `place_call`s Beschreibung verspricht die Live-Karte nicht mehr unbedingt, nennt die
   Kostenwirkung, und widerspricht `await_call_event` bei aktivem Consult-Kanal nicht mehr.
3. `get_transcript`s Beschreibung behauptet keine Aufbewahrungsregel mehr, die der Code
   nicht haelt.
4. `get_call_status`s Beschreibung wiederholt die widerlegte Live-Karten-Zusage nicht mehr.
5. Ein neuer, expliziter Test haelt alle 12 Annotation-Objekte byte-genau fest (Regressions-
   Anker gegen Wegdrift, wie von der Aufgabe verlangt).
6. `npm test` bleibt vollstaendig gruen; die drei Fake-Server-Unit-Tests, deren `tool()`-
   Attrappe den vierten Positionsparameter als Handler nimmt, brechen NICHT (siehe Blast
   Radius).

## Aenderungen

**1. `src/mcp-tools.js:650` - lokaler `tool()`-Helfer bekommt Annotations, OHNE die
Parameterzahl zu erhoehen.** Statt eines 5. benannten Parameters (der die bereits gepinnte
`max-params`-Ausnahme fuer diese Zeile von "(4)" auf "(5)" verschieben und damit einen NEUEN
Lint-Fund erzeugen wuerde, siehe Blast Radius) wird der 4. Parameter zu einem Objekt
`{ annotations, handler }`:
```js
const tool = (name, desc, schema, { annotations, handler }) =>
  server.tool(name, desc, schema, annotations, wrapHandler(handler));
```
Beide Aufrufer (`cancel_call`, `list_action_items`) wechseln auf diese Form. Warum so und
nicht ein 5. Parameter: haelt die Signatur bei 4 Parametern (CLAUDE.md-Richtwert, siehe
Blast Radius zum Lint-Pin), und macht am Aufruf sichtbar, dass Annotations und Handler
zusammengehoeren.

**2. `src/mcp-tools.js:1057-1062` - `cancel_call`:** neue Modul-Konstante
`CANCEL_CALL_ANNOTATIONS` (neben `CANCEL_CALL_DESCRIPTION`, :548-550) und Umbau des Aufrufs
auf die neue `tool()`-Form:
```js
const CANCEL_CALL_ANNOTATIONS = {
  title: "Cancel a call",
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
...
tool("cancel_call", CANCEL_CALL_DESCRIPTION,
  { call_id: z.string().describe("The call_id from place_call") },
  { annotations: CANCEL_CALL_ANNOTATIONS,
    handler: async ({ call_id }) => text(await call("POST", `/api/calls/${call_id}/cancel`)) },
);
```

**3. `src/mcp-tools.js:1149-1163` - `list_action_items`:** neue Modul-Konstante
`LIST_ACTION_ITEMS_ANNOTATIONS`, gleiche Umbauform:
```js
const LIST_ACTION_ITEMS_ANNOTATIONS = {
  title: "List action items",
  readOnlyHint: true,
  openWorldHint: false,
};
...
tool("list_action_items", "Lists open action items from all calls.", {},
  { annotations: LIST_ACTION_ITEMS_ANNOTATIONS, handler: async () => { /* unveraendert */ } },
);
```

**4. Die 10 `uiTool(...)`-Registrierungen bekommen je einen neuen Schluessel
`annotations: {...}` im Config-Objekt** (Wert direkt inline, keine Modul-Konstante - jede
Nutzung ist einmalig, ein Name mehr waere Indirektion ohne Nutzen). Werte exakt:

| Tool | Zeile (config beginnt) | title | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|---|---|---|---|---|---|---|
| place_call | :666 | "Place a phone call" | false | true | false | true |
| await_call_event | :859 (nur consultAllowed) | "Wait for call update" | true | - | - | true |
| answer_consult | :893 (nur consultAllowed) | "Answer call question" | false | false | false | true |
| get_call_status | :1000 | "Get call status" | true | - | - | true |
| get_transcript | :1016 | "Get call transcript" | true | - | - | true |
| get_my_number | :1070 | "Agent phone number" | true | - | - | false |
| list_calls | :1097 | "List calls" | true | - | - | false |
| check_inbox | :1127 | "Check inbox" | false | false | false | false |
| get_calendar | :1174 (nur allowCalendar) | "Get calendar" | true | - | - | false |
| get_agent_status | :1211 | "Get agent status" | true | - | - | false |

Werte uebernommen aus `tasks/openai-audit/03-tool-semantik-annotations.md` PP-D3-08
(dort mit datei:zeile-Beleg je Tool). "-" = Feld weglassen (nicht `undefined` explizit
setzen - N-01: nur bei `readOnlyHint === false` sinnvoll). `title`-Texte sind neu (die
Tabelle dort schlaegt nur fuer `get_my_number` einen Text vor, PP-D3-13) - kurze,
lesbare Titel Case-Form, editoriale Wahl ohne Sicherheitsbezug; die Anzeige-Reihenfolge
selbst (`title` > `annotations.title` > `name`, W-09) ist unabhaengig davon korrekt, weil
`annotations.title` fuer BEIDE Registrierwege identisch funktioniert (der Legacy-Pfad hat
kein eigenes Top-Level-`title`, s. `mcp.js:704` destrukturiert nur aus `config`, waehrend
`tool()` gar kein `title` kennt) - ein einziger Ort fuer den Titel ueber alle 12 Tools,
statt zwei verschiedener je nach Registrierweg.

**5. `src/mcp-tools.js:529` - `PLACE_CALL_DESCRIPTION` neu:**
```
Starts a real phone call by the AI agent to a phone number, pursuing the given objective. The call is billed per minute to the caller's account and is NOT reversible once placed. Which destinations are allowed is decided by the server through its safety gates (permission profile/allowlist, denylist, country, limits) - just call it; disallowed destinations are refused by the server with a clear message. Returns a call_id immediately; some clients also show a live card that updates itself, but this is NOT guaranteed - ALWAYS poll get_call_status with the call_id until it reports a final status.
```
Loest PP-D3-01 (keine unbedingte Karten-Zusage mehr), PP-D3-03 (Kostensatz) und PP-D3-06
(kein "you do NOT need to poll" mehr, das dem angehaengten `PLACE_CALL_CONSULT_LOOP`
widersprach) in EINER Aenderung - dieselben zwoelf Deskriptoren einmal statt mehrfach
anzufassen, wie `OPENAI-MCP-READINESS.md` Etappe 3 selbst vorschlaegt.
`PLACE_CALL_CONSULT_LOOP` (:538) bleibt unveraendert; die startsWith-Invariante
(AL-P13-36, GQ-B1-02..04) haelt automatisch, weil nur die BASIS-Konstante geaendert wird,
der Anhaenge-Mechanismus (`placeCallDescription`, :539-540) nicht.

**6. `src/mcp-tools.js:1017-1019` - `get_transcript`-Beschreibung neu** (Format 2-zeilig
wie bisher beibehalten, damit `registerTools()` keine Zeile gewinnt):
```
After the call has ended, returns the result summary and whether the objective was achieved. This tool NEVER returns the raw transcript - whether the server keeps it afterwards on its own follows the diagnostic rule of place_call's diagnostic field and is independent of this response. Call this only once get_call_status reports status=completed.
```
Loest PP-D3-02: die falsche, allgemeine Aufbewahrungs-Zusicherung ("not kept after the
summary") ist raus; was bleibt, ist wahr (DIESES Tool liefert das Roh-Transkript nie) und
verweist korrekt auf die tatsaechliche Regel statt sie zu behaupten.

**7. `src/mcp-tools.js:1002` - `get_call_status`-Beschreibung neu** (1-zeilig, wie
bisher):
```
Returns the live state of a call: status (dialing|in_progress|completed|failed|cancelled), duration and the last transcript lines. Some clients also show a live card that updates itself; call this tool regardless whenever the current state is needed, it always reflects it.
```
Vermeidet, dass diese zweite Stelle die in (5) korrigierte Ueberzusage in schwaecherer
Form fortfuehrt (sonst haetten zwei Tool-Beschreibungen im selben Katalog widerspruechliche
Aussagen ueber dieselbe Karte).

**8. `test/mcp-tool-annotations.test.js` (NEU) - der Regressions-Anker fuer die
Annotations.** Faengt beide Registrierwege ueber einen fakeServer ab (Muster
`test/p15-mcp-tool-descriptions-en.test.js:53-60`, aber `tool()`s viertes Argument ist
jetzt `{ annotations, handler }`, nicht mehr der Handler direkt):
```js
const fakeServer = {
  tool: (name, _desc, _schema, { annotations }) => found.set(name, annotations),
  registerTool: (name, config) => found.set(name, config.annotations),
  registerResource() {},
};
```
Drei Faelle: (a) alle 10 Bestands-Tools ohne Consult-Kanal tragen exakt die Tabelle aus
Punkt 4 (`assert.deepEqual`); (b) mit `consultAllowed: true` tragen `await_call_event` und
`answer_consult` zusaetzlich exakt ihre Werte, UND sind ohne Faehigkeit gar nicht erst
registriert (bestehende AL-P13-35-Invariante gilt unveraendert); (c) JEDES registrierte
Tool traegt ueberhaupt ein `annotations`-Objekt (verhindert, dass ein 13. Tool spaeter
ohne Annotations durchrutscht). **Namens-Falle:** Test-Namen duerfen NICHT mit
`MCP-<Ziffer>` (oder einem der anderen Katalog-Praefixe `DID|E2E|FMT|GAP|LANG|LAW|ORIG|
OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD`, `package.json` Feld `i18nCatalogPattern`) beginnen -
das wuerde den Test aus `npm test` heraus- und in `npm run test:gates` hineinrouten, wo er
als Regressionsschutz NICHT laeuft. Namen mit `P0-1: ...` sind sicher (P0 ist nicht in der
Praefixliste).

**9. `test/p15-mcp-tool-descriptions-en.test.js` - `EXPECTED_MARKERS` aktualisieren:**
`place_call: ["NOT"]` -> `["NOT", "NOT", "ALWAYS"]` (aus (5): "NOT reversible", "NOT
guaranteed", "ALWAYS poll"); `get_transcript: ["NOT"]` -> `["NEVER"]` (aus (6): "NEVER
returns"). `get_call_status: []` bleibt `[]` (aus (7) enthaelt keine neuen
Grossschrift-Marker - pruefen, nicht raten). Kein weiterer Pfad im Marker-Katalog ist
betroffen.

**10. `test/gq-b1-briefing-openness.test.js` - PRUEFEN, vermutlich KEINE Aenderung noetig.**
Gemessen (Stand vor diesem Schnitt, `node`-Probe gegen die echte `captureDescriptions()`-
Logik): `ohneKanal` = 6139 von 6300, `mitKanal` = 6541 von 6700. Der neue
`PLACE_CALL_DESCRIPTION`-Text (5) ist um 68 Zeichen laenger; `get_transcript`/
`get_call_status` liegen ausserhalb des `place_call`-Praefix-Filters und zaehlen nicht
mit. Neue Summen: 6207 (<=6300) und 6609 (<=6700) - beide Budgets halten ohne Aenderung.
Trotzdem nach der Implementierung neu messen (Text kann beim Schreiben von der hier
geplanten Fassung abweichen) statt sich auf diese Rechnung zu verlassen.

**11. Drei Fake-Server-Unit-Tests bekommen ihre `tool()`-Attrappe korrigiert** (sonst
brechen sie hart, siehe Blast Radius): `test/mcp-tools.test.js:26`,
`test/mcp-tools-i18n.test.js:45`, `test/mcp-tools-language.test.js:35` - jeweils
`tool(name, _desc, _schema, handler)` -> `tool(name, _desc, _schema, { handler })`
(diese drei Dateien brauchen die Annotations selbst nicht, nur den Handler - Objekt-
Destrukturierung mit einem Feld reicht, keine neue Variable fuer `annotations` noetig).

**12. `eslint-legacy-exceptions.json`, Eintrag `src/mcp-tools.js` - Pin neu vermessen.**
Heutiger Stand (gemessen mit dem im Eintrag selbst vorgeschriebenen Befehl, siehe
Verifikation): `max-lines-per-function :: Function 'registerTools' has too many lines
(480). Maximum allowed is 100.`: 1; `max-params :: Arrow function has too many parameters
(4). Maximum allowed is 3.`: 1 (das ist exakt der `tool()`-Helfer aus Punkt 1, Zeile 650).
Die Annotations-Objekte fuegen `registerTools()` Zeilen hinzu (10x ein einzeiliger
`annotations: {...}`-Schluessel bei den `uiTool`-Aufrufen; `cancel_call`/
`list_action_items` wachsen je um die `{ annotations, handler }`-Klammerung); der
`tool()`-Helfer bleibt dank Punkt 1 bei 4 Parametern, die `max-params`-Zeile bewegt sich
NICHT. Nach der Umsetzung: exakte neue Zeilenzahl messen, `480` im `findings`-Schluessel
durch die neue Zahl ersetzen, EINEN Reasoning-Satz im Bestandsformat anhaengen ("PIN
KORRIGIERT <Datum> (S1): registerTools waechst um N Zeilen (480 -> X) - annotations an
allen 12 Tool-Deskriptoren (P0-1). Dieselbe bereits gepinnte Regel mit neu gemessener
Zahl - kein neuer Eintrag, keine neue Regel, keine neue Ausnahme; id-length/no-magic-
numbers/no-restricted-syntax/max-params unveraendert."). Ohne diesen Schritt lehnt der
Pre-Commit-Hook (`scripts/check-staged-suppressions.js`) den Commit ab, sobald
`src/mcp-tools.js` gestaged wird - kein Bug, das Gate funktioniert wie dokumentiert.

## Erwartungsergebnis und Verifikation

| Aenderung | Erwartungsergebnis | Verifikation |
|---|---|---|
| Annotations (Punkte 1-4) | `tools/list` liefert fuer jedes der 12 Tools genau das `annotations`-Objekt aus der Tabelle in Punkt 4 (bzw. der Konstanten aus 2/3) | `node --test test/mcp-tool-annotations.test.js` (neu, Punkt 8) gruen |
| Kein Tool ohne annotations | jedes registrierte Tool traegt ein nicht-leeres `annotations`-Objekt | derselbe Test, dritter Fall |
| place_call-Beschreibung (Punkt 5) | Text enthaelt "billed per minute", "NOT reversible", "NOT guaranteed", "ALWAYS poll get_call_status"; enthaelt NICHT mehr "you do NOT need to poll" | `grep -n "billed per minute\|ALWAYS poll" src/mcp-tools.js`; `node --test test/p15-mcp-tool-descriptions-en.test.js` (EXPECTED_MARKERS, Punkt 9) gruen |
| get_transcript-Beschreibung (Punkt 6) | Text enthaelt "NEVER returns the raw transcript", verweist auf die diagnostic-Regel statt eine eigene Aufbewahrungszusage zu machen | `node --test test/p15-mcp-tool-descriptions-en.test.js` gruen (Marker `["NEVER"]`) |
| get_call_status-Beschreibung (Punkt 7) | keine unbedingte Live-Karten-Zusage mehr, Marker bleiben `[]` | `node --test test/p15-mcp-tool-descriptions-en.test.js` gruen |
| Zeichen-Budget place_call (Punkt 10) | `ohneKanal <= 6300`, `mitKanal <= 6700` (rechnerisch 6207/6609) | `node --test test/gq-b1-briefing-openness.test.js` gruen |
| startsWith-Invariante | `withConsult.place_call` beginnt weiterhin mit `plain.place_call` | `node --test test/al-p13-consult-channel.test.js` (AL-P13-36) gruen |
| Fake-Server-Faenger (Punkt 11) | `list_action_items`/andere Handler-Aufrufe in den drei Dateien liefern wieder echte Ergebnisse statt "is not a function" | `node --test test/mcp-tools.test.js test/mcp-tools-i18n.test.js test/mcp-tools-language.test.js` gruen |
| eslint-Pin (Punkt 12) | Pin-Zahl entspricht der tatsaechlich gemessenen; Commit wird nicht vom Aufraeum-Gate abgelehnt | `npx eslint src/mcp-tools.js --suppressions-location eslint-suppressions.empty.json --format json` (max-lines-per-function/max-params-Zeilen mit dem Eintrag abgleichen); nach `git add src/mcp-tools.js eslint-legacy-exceptions.json`: `node scripts/check-staged-suppressions.js src/mcp-tools.js eslint-legacy-exceptions.json` exit 0 |
| Gesamtregression | keine der ca. 3044 Regressionstests (`npm test`-Bahn) faellt neu aus | `npm test` (siehe CLAUDE.md, `--test-concurrency=4` bei Verdacht auf Parallelitaets-Flake) |
| Syntax | Datei parst | `node --check src/mcp-tools.js` |

## Blast Radius

- **Aufrufer von `tool()`:** ausschliesslich `cancel_call` (:1057) und `list_action_items`
  (:1149) - `grep -n "^  tool(" src/mcp-tools.js` bestaetigt genau diese zwei. Beide werden
  in diesem Schnitt selbst umgebaut (Punkte 2/3).
- **Fake-Server-Tests mit 4-Positions-Signatur `tool(name, _desc, _schema, handler)`:**
  gefunden in 8 Dateien (`grep -n "^\s*tool(name" test/*.test.js`). Davon rufen DREI den
  `list_action_items`-Handler tatsaechlich auf (`test/mcp-tools.test.js:235/254/273`,
  `test/mcp-tools-i18n.test.js` ueber die `GERMAN_STAGE0_PROBES`-Tabelle, `:131-133`,
  `test/mcp-tools-language.test.js:465-481`) - diese brechen OHNE Punkt 11 hart, weil der
  vierte Positionsparameter dann das `{ annotations, handler }`-Objekt ist, nicht die
  Funktion selbst (`handlers.get("list_action_items")()` wirft "is not a function"). Die
  uebrigen fuenf (`al-p11-result-card.test.js`, `mcp-ui.test.js`,
  `mcp-ui-i18n-divergence.test.js`, `place-call-context-bridge.test.js`,
  `al-p13-consult-channel.test.js`) rufen weder `cancel_call`- noch
  `list_action_items`-Handler auf (geprueft: `grep -n '"cancel_call"\|"list_action_items"'`
  in diesen Dateien = 0 Treffer bzw. nur Namenslisten) - bleiben unangefasst, bleiben aber
  mit derselben latenten Luecke stehen (kosmetisch, nicht Teil dieses Schnitts).
  `test/mcp-fehlergrund-rueckweg.test.js` und `test/el-action-items.test.js` nutzen bereits
  Restparameter (`rest[rest.length-1]` bzw. `args.at(-1)`) - robust, keine Aenderung noetig.
- **Echte SDK-Integrationstests** (`test/mcp-tools.test.js` und Geschwister laufen teils
  gegen einen echten Server-Prozess/-Client, nicht nur den fakeServer; genauer: mehrere
  Dateien wie `el-action-items.test.js`, `mcp-ui-w1-call-widget.test.js` haben KEINEN
  fakeServer und sprechen die echte SDK-Registrierung an) - das ist zugleich der
  staerkste Regressionsschutz: eine falsch geformte `tool()`/`registerTool()`-Annotation
  wuerde dort mit einem SDK-Wurf auffallen, nicht still durchrutschen.
- **`eslint-legacy-exceptions.json` + `scripts/check-staged-suppressions.js`:** siehe
  Punkt 12 - ohne die Pin-Aktualisierung lehnt der Pre-Commit-Hook jeden Commit ab, der
  `src/mcp-tools.js` beruehrt (nicht nur diesen Schnitt - ein bestehendes, funktionierendes
  Gate).
- **Keine Aenderung an:** Safety-Gates (`src/telephony/outbound-gates.js` unberuehrt),
  Offenlegungspfad (`src/claude.js`, `disclosureSentence` unberuehrt), Auth-Middleware,
  REST-Routen (`src/routes/api-calls.js` unberuehrt - nur die MCP-Deskriptoren aendern
  sich, nicht die dahinterliegende Logik), Store/DB, i18n-Lokalisierung (die
  Beschreibungen bleiben bewusst einsprachig Englisch, Systemgrenze am Dateikopf
  unveraendert).
- **Live-Wirkung:** `tools/list` liefert nach dem Deploy fuer jeden MCP-Client (Claude UND
  ein spaeterer ChatGPT-Host) andere `annotations`/`title`-Werte und drei geaenderte
  Beschreibungstexte. Nach N-03 der Spec sind Annotations ohnehin nur Hints, auf die ein
  Client seine Nutzungsentscheidung nicht verlassen soll - ein KI-Client wie Claude, der
  heute ohne Annotations funktioniert, verliert dadurch keine Faehigkeit, gewinnt aber
  ehrlichere Metadaten.

## Beruehrte absolute Regeln

Keine. Safety-Gates, Offenlegungssatz und Auth-Fail-Closed werden von diesem Schnitt nicht
angefasst - er aendert ausschliesslich Tool-Deskriptoren (Metadaten + Beschreibungstext),
keine Ausfuehrungslogik. Eine Naehe zu Regel 2 (Offenlegung) besteht NICHT: die neue
`place_call`-Beschreibung nennt Kosten und Poll-Pflicht, sie aendert nichts an
`disclosureSentence` oder der Owner-Self-Call-Ausnahme.

## Abhaengigkeiten

- **PP-D3-04/PP-D3-05** (`03-tool-semantik-annotations.md`, beide P1/C: fehlende
  Rechtswirkungs-Nennung gegenueber dem Dritten, "just call it" laedt zum Raten ein) sind
  BEWUSST NICHT Teil dieses Schnitts, obwohl sie ebenfalls P1 sind und in derselben
  `place_call`-Beschreibung sitzen: sie betreffen Ziel-Auswahl/Einwilligung des
  Angerufenen, nicht Tool-Metadaten - inhaltlich naeher an einem Sicherheits-/Consent-
  Schnitt. Wer die 7 Specs zusammenfuehrt, muss pruefen, dass sie IRGENDWO landen (aktuell
  in keinem der bekannten S2/S4/S5 gesehen).
- **PP-D3-12(d)** (cancel_call reicht den REST-Body ungefiltert durch, kein
  `outputSchema`) und die eng verwandten **P1-5/P1-6/P1-7/P1-8/P1-9** (fehlende
  Output-Whitelists/-Validierung) sind NICHT Teil dieses Schnitts - das ist
  Antwort-Filterung/-Validierung (D2/D4-Familie), keine Beschreibungs- oder
  Annotation-Frage. Gehoert in einen eigenen Schnitt (Response-Leaks/Output-Vertraege).
- **P1-4** (`securitySchemes` fehlt, SDK-Versionsluecke 1.29.0 vs. Spec) ist NICHT Teil
  dieses Schnitts - reine SDK-/Protokollfrage, keine Metadaten-Frage.
- Kein Schnitt muss VOR diesem stehen. S1 ist in sich abgeschlossen (nur
  `src/mcp-tools.js` + die genannten Testdateien + `eslint-legacy-exceptions.json`).

## Offene Fragen

- Ob ein echter ChatGPT-Host `annotations` tatsaechlich als Ablehnungsgrund prueft oder
  nur Best-Effort auswertet, ist am Repo nicht entscheidbar (`00-openai-anforderungen.md`
  N-8 fuehrt es selbst als UNKNOWN). Die Umsetzung hier folgt dem woertlichen
  OpenAI-Zitat (N-6) unabhaengig davon.
- Die vorgeschlagenen `title`-Texte (Punkt 4) sind eine editoriale, keine sicherheits-
  relevante Entscheidung - der Implementierungs-Workflow kann sie unveraendert
  uebernehmen; wer sie aendert, muss `test/mcp-tool-annotations.test.js` (Punkt 8)
  synchron aktualisieren.
- Die STUMME Live-Karte fuer einen echten ChatGPT-Host (`src/ui/registry.js:23-33`) ist
  eine bewusst offene, dokumentierte Luecke aus einer fruehen Phase ("kein Rueckbau in
  einem Blocker-Fix ohne Owner-Auftrag") - dieser Schnitt repariert sie NICHT technisch,
  er macht nur die Beschreibung ehrlich. Ein Owner-Auftrag fuer eine echte
  Host-Capability-Erkennung waere ein eigener Schnitt.
