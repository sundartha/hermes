# P2 — Registrierweg vereinheitlichen: `title` + `toolInvocation`

IDs: **T-18** (Name / Title / Description / expliziter `inputSchema` / `outputSchema` nur wo
`structuredContent`), **T-22** (`_meta["openai/toolInvocation/invoking"]` + `/invoked`, je `<= 64`).

Quellen in dieser Rangfolge: `tasks/PLAN-OPENAI-TECHNIK.md` (Abschnitt P2, Zeilen 233-323),
`tasks/openai-p0-entscheidungen.md` (D0-5 / U-2 / U-4), `tasks/openai-audit/00-openai-anforderungen.md`
(Zeilen 51, 55, 134). `00-mcp-spec.md` ist NICHT massgeblich.

Diese Spec ist am Code nachgemessen (Stand `72fbc78`, 2026-09-20). Jede Zeilenangabe stammt aus
einem eigenen `sed`/`grep`-Lauf, nicht aus dem Plan — der Plan ist aelter als P1 und seine
Zeilennummern sind durchgehend um ~60-70 Zeilen verschoben (s. Abschnitt "Widersprueche").

---

## 0. Ist-Zustand, gemessen (nicht behauptet)

Gemessen mit einem echten `tools/list` gegen einen realen `McpServer` ueber den
`InMemoryTransport` des SDK (Wegwerf-Skript, danach geloescht; genau dieser Harness wird in
Schritt 12/13 zum Test):

| Tool | `title` (Top-Level) | `_meta` | `outputSchema` |
|---|---|---|---|
| place_call | **undefined** | `{ui:{resourceUri:"ui://hermes/call",csp:…}}` | ja |
| await_call_event | **undefined** | — | ja |
| answer_consult | **undefined** | — | ja |
| get_call_status | **undefined** | — | ja |
| get_transcript | **undefined** | — | ja |
| cancel_call | **undefined** | — | **nein** |
| get_my_number | **undefined** | `{ui:{…my-number}}` | ja |
| list_calls | **undefined** | `{ui:{…calls}}` | ja |
| check_inbox | **undefined** | — | ja |
| list_action_items | **undefined** | — | **nein** |
| get_calendar | **undefined** | `{ui:{…calendar}}` | ja |
| get_agent_status | **undefined** | `{ui:{…agent-status}}` | ja |

Daraus folgt dreierlei, und Punkt 2 widerspricht dem Plan:

1. `outputSchema` liegt an **genau 10** von 12 (`grep -c "outputSchema:" src/mcp-tools.js` -> `10`;
   Zeilen 1001, 1056, 1111, 1186, 1203, 1260, 1289, 1319, 1369, 1409). Die zwei ohne sind
   `cancel_call` und `list_action_items`.
2. `title` fehlt **an allen zwoelf**, nicht nur an den zwei Legacy-Tools. Der Plan legt nahe,
   die 10 `uiTool()`-Tools trugen es bereits ("2 Tools wechseln den Registrierweg") — sie tun
   es nicht, weil kein Config-Literal ein `title`-Feld setzt. P1 hat `title` bewusst NUR unter
   `annotations` abgelegt (Begruendung im Bestandskommentar `src/mcp-tools.js:625-627`).
3. `_meta` traegt heute ausschliesslich Widget-Daten und nur an den 5 Widget-Tools.

SDK-Grenze (P0/U-4 bestaetigt): `registerTool()` destrukturiert `title` und `_meta`
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:703`), der ListTools-Handler gibt
beide aus (`:72`, `:85`). Der Legacy-Weg `server.tool()` uebergibt beide hart als `undefined`
(`:694`). **T-18 hat kein SDK-Problem, nur ein Nutzungsdefizit.**

---

## 1. Bauvorgabe (der eine Merge-Ort)

**Weder `title` noch die Statuszeilen werden in die 12 Config-Literale geschrieben.** Grund
(DP-7, am Code belegt): die 5 Widget-Tools spreaden `...enableWidgetUi(WIDGET_X)` als **letztes**
Feld (z. B. `src/mcp-tools.js:1002`), und `enableWidgetUi()` liefert ein komplettes
`{_meta:{…}}` (`:791-798`). Ein vorher gesetztes `_meta` wuerde von diesem Spread **still und
vollstaendig** ueberschrieben (Objekt-Literal-Semantik, kein Deep-Merge) — und zwar genau auf den
5 sichtbarsten Werkzeugen.

Deshalb: eine **Modul-Ebene**-Funktion `withOpenAiToolMetadata(name, config)`, die die
`uiTool()`-Fabrik (`:834-835`) auf jedes Config-Objekt anwendet, NACHDEM das Literal fertig
gebaut ist. Modul-Ebene (nicht in `registerTools`), weil `registerTools` unter der Owner-Auflage
"darf NICHT wachsen" steht und bereits mit 506 Zeilen gepinnt ist.

- `title` kommt aus `config.annotations?.title` — **keine zweite, namensindizierte Tabelle**.
  Damit gibt es weiterhin genau EINE Titel-Quelle (`TOOL_ANNOTATIONS`), und ein Tippfehler im
  Tool-Namen kann die beiden nicht auseinanderlaufen lassen.
- `_meta` entsteht als `{ ...statusMeta, ...config._meta }` — der Widget-Anteil steht **hinten**
  und gewinnt bei (heute unmoeglicher) Kollision; die Namensraeume sind disjunkt
  (`ui` / `openai/outputTemplate` vs. `openai/toolInvocation/*`).
- `annotations.title` bleibt, wo es ist. W-09 (`title > annotations.title > name`) macht beide
  Felder vertraeglich; das Entfernen wuerde die P1-Tabellen in
  `test/mcp-tool-annotations.test.js` brechen, ohne irgendeine ID zu erfuellen.

---

## 2. Arbeitsschritte

### Schritt 1 — Grundlinie messen, bevor irgendetwas angefasst wird
`npm test -- -- --test-concurrency=4` auf dem Branch-Ausgangsstand, Zahlen `# pass` / `# fail`
notieren. Grund: der Auftrag nennt 6153/6152, der P1-Bericht misst nach dem P1-Merge 6155/6155.
Ohne eigene Messung ist am Ende nicht entscheidbar, ob eine Abweichung von dieser Phase stammt.

### Schritt 2 — Statuszeilen-Tabelle + Schluessel-Konstanten (Modul-Ebene)
Direkt nach `TOOL_ANNOTATIONS` (`src/mcp-tools.js:715`) einfuegen:

```js
const OPENAI_INVOKING_KEY = "openai/toolInvocation/invoking";
const OPENAI_INVOKED_KEY = "openai/toolInvocation/invoked";
const TOOL_INVOCATION_STATUS = { … };   // 12 Eintraege, Reihenfolge = Registrierreihenfolge
```

Texte (einsprachig Englisch wie alle Tool-Metadaten, Systemgrenze O14; laengster Eintrag 32
Zeichen, Grenze 64):

| Tool | `invoking` | `invoked` |
|---|---|---|
| place_call | Placing the call | Call started |
| await_call_event | Waiting for the next call event | Call event received |
| answer_consult | Sending your answer to the agent | Answer delivered |
| get_call_status | Checking the call status | Call status read |
| get_transcript | Reading the call transcript | Transcript read |
| cancel_call | Cancelling the call | Cancellation requested |
| get_my_number | Looking up the agent number | Agent number read |
| list_calls | Listing recent calls | Recent calls listed |
| check_inbox | Checking the call inbox | Inbox checked |
| list_action_items | Listing open action items | Action items listed |
| get_calendar | Reading the calendar | Calendar read |
| get_agent_status | Checking the agent status | Agent status read |

`cancel_call.invoked` lautet bewusst "Cancellation requested", nicht "Call cancelled": der
REST-Pfad sichert seit S1-4 keinen bestaetigten Leitungsabbruch zu (dieselbe Wahrheit wie
`CANCEL_CALL_DESCRIPTION`). Eine Statuszeile darf nicht mehr behaupten als die Beschreibung.

**Kein Laengen-Check zur Laufzeit.** Die Werte sind Literale in dieser Datei; ein
Runtime-Waechter waere Code, der im Betrieb nie etwas tut. Die 64 prueft der Test (Schritt 10).

### Schritt 3 — `withOpenAiToolMetadata()` auf Modul-Ebene + Einhaengen in `uiTool()`
Neue reine Funktion unter der Tabelle; `uiTool()` (`src/mcp-tools.js:834-835`) ruft sie:

```js
const uiTool = (name, config, handler) =>
  server.registerTool(name, withOpenAiToolMetadata(name, config), wrapHandler(handler));
```

Fehlt ein Tool in `TOOL_INVOCATION_STATUS`, entstehen **keine** halben Schluessel (leeres
Fragment). Bewusst kein `throw`: eine fehlende Statuszeile ist kosmetisch, ein Wurf an dieser
Stelle wuerde `/mcp` fuer alle Mandanten zerlegen. Die Luecke faengt der Vollstaendigkeitstest
(Schritt 10), der ueber die AUSGELIEFERTE Liste iteriert, nicht ueber eine Namensliste.

### Schritt 4 — `cancel_call` auf `uiTool()` migrieren
`src/mcp-tools.js:1240-1248`. `description: CANCEL_CALL_DESCRIPTION`, `annotations` unveraendert,
`inputSchema: { call_id: … }`, Handler unveraendert als drittes Argument.
**KEIN `outputSchema`** — das Tool liefert nur `text(...)` (`:79-81`, `content` ohne
`structuredContent`); ein `outputSchema` wuerde den SDK-Validator werfen lassen (genau der
Defekt, den P4 fuer `get_transcript` repariert).

### Schritt 5 — `list_action_items` auf `uiTool()` migrieren
`src/mcp-tools.js:1338-1355`. `description: "Lists open action items from all calls."`,
`inputSchema: {}`, Handler unveraendert. **KEIN `outputSchema`** (beide Rueckgabepfade sind
`text(...)`, `:1344` und `:1346-1352`).

### Schritt 6 — Legacy-Fabrik entfernen, ueberholte Kommentare berichtigen
- `src/mcp-tools.js:825-829`: Kommentarblock + `const tool = …` loeschen (DP-3 aufgeloest; nach
  Schritt 4/5 ist die Fabrik toter Code, und toter Code ist in diesem Repo verboten).
- `src/mcp-tools.js:625-627`: die Begruendung "der Legacy-Weg kennt kein eigenes Top-Level-title,
  deshalb steht er hier bewusst NICHT bei den uiTool-Konfigs" ist ab jetzt falsch. Ersetzen durch:
  `title` steht weiterhin genau hier, wird aber von `withOpenAiToolMetadata()` zusaetzlich auf
  Top-Level gehoben (T-18); `annotations.title` bleibt als W-09-Rueckfall.
- `src/mcp-tools.js:831-833` (Kommentar an `uiTool`): der Satz "Wie tool(), aber …" verliert
  seinen Bezugspunkt und wird umformuliert.

### Schritt 7 — Lint-Buchhaltung nachziehen (sonst ist der Commit nicht moeglich)
Mit Schritt 6 verschwindet der **einzige** `max-params`-Befund der Datei
(`src/mcp-tools.js:828`, Arrow mit 4 Parametern — am Lauf gemessen). Das hat drei Folgen:

1. `eslint-suppressions.json`: den Schluessel `max-params` unter `src/mcp-tools.js` entfernen.
   Bleibt er stehen, bricht `npm run lint` mit *"There are suppressions left that do not occur
   anymore"* und Ausgang 2 (mit einer Attrappe gegengeprueft, positiv reproduziert).
2. `eslint-legacy-exceptions.json`, Eintrag `src/mcp-tools.js`: aus `findings` den
   `max-params`-Schluessel entfernen und die `max-lines-per-function`-Zeile auf die **neu
   gemessene** Zeilenzahl von `registerTools` setzen (heute 506). Nicht schaetzen —
   `npx eslint src/mcp-tools.js --suppressions-location eslint-suppressions.empty.json --format json`.
   Dazu ein `reason`-Nachtrag im Bestandsstil ("ZAHL KORRIGIERT 2026-09-20 (P2, …)").
3. `test/check-staged-suppressions.test.js` pinnt den **echten** Inhalt der Altlast-Liste
   (`assert.deepEqual(REAL_LEGACY_EXCEPTIONS, …)`, Zeile 1069 ff.; Literal ab Zeile ~766). Der
   Pin und die Buchhaltungsliste im Kopfkommentar (Zeile ~390 ff.) werden im selben Zug
   nachgezogen.

### Schritt 8 — `test/mcp-ui.test.js`: zehn `_meta`-Assertionen praezisieren
Diese Assertionen bedeuten "kein **Widget**-`_meta`", pruefen aber heute "gar kein `_meta`". Mit
den Statuszeilen traegt jedes Tool ein `_meta`, also brechen sie:
Zeilen **233, 247, 261, 289, 439, 452, 892, 1089, 1175, 1260**.

Ersatz: EIN lokaler Helfer, zehn Aufrufstellen —
`const ohneWidgetMeta = (config) => !config._meta?.ui && !config._meta?.[CHATGPT_META_KEY];`
Das ist eine **Verschaerfung**, keine Abschwaechung: bisher war "kein Objekt" der Beweis, jetzt
sind die beiden Widget-Schluessel namentlich benannt. Den Helfer mit dem `config`-Objekt
aufrufen (`ohneWidgetMeta(tools.get("get_call_status").config)`), nicht mit einer langen
Zugriffskette — die Datei ist gegen die Demeter-Regel gepinnt.

**Zwingend vor dem Commit:** `node scripts/check-staged-suppressions.js test/mcp-ui.test.js`.
Die Datei traegt Suppressions und steht **nicht** auf der Altlast-Liste; Stufe 2 laesst sie nur
durch, wenn ihre ungefilterte Befundmenge **unveraendert** bleibt. Bewegt sich ein Befund, ist
die Formulierung zu aendern — nicht die Liste.

### Schritt 9 — `test/mcp-tool-annotations.test.js`: ueberholten Kommentar berichtigen
Zeilen 179-183 nennen `cancel_call`/`list_action_items` "die zwei Werkzeuge auf dem
Legacy-Registrierweg". Nach Schritt 4-6 gibt es keinen Legacy-Weg mehr. **Die Assertion bleibt
unveraendert** (beide muessen weiterhin in `tools/list` erscheinen), nur die Begruendung wird
nachgezogen. Ebenso die Harness-Kommentare Zeilen 11-14 und 112-114.

### Schritt 10 — Neuer Test: `title` + `toolInvocation` ueber die echte HTTP-`/mcp`-Route
Neue Datei `test/openai-p2-tool-metadaten.test.js`. Gespawnter Server, Muster
`test/mcp-tool-annotations.test.js:164-186`, aber mit
`env: { MCP_UI_ENABLED: "true", CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" }`.

`MCP_UI_ENABLED: "true"` ist **nicht optional**: `test/helpers.js:363` setzt im `BASE_ENV`
`MCP_UI_ENABLED: "false"`. Ohne den Override haette **kein** Tool ein Widget-`_meta`, die
Spread-Falle waere nicht vorhanden, und der Test waere gruen, ohne irgendetwas zu beweisen.

Der Test iteriert ueber `result.tools` (die gelieferte Liste, nie ueber eine Namensliste) und
prueft je Tool: `typeof tool.title === "string"`, `tool.title.length > 0`,
`tool._meta[OPENAI_INVOKING_KEY]` und `[OPENAI_INVOKED_KEY]` nicht-leere Strings mit
`length <= MAX_INVOCATION_CHARS` (benannte Konstante `64`).

**Positiv-Kontrolle im selben Test** (sonst beweist die Schleife nur, dass nichts gemessen wurde):
`place_call._meta.ui.resourceUri === "ui://hermes/call"` — das Widget-`_meta` ist also
tatsaechlich da und wurde vom Statuszeilen-Merge NICHT verdraengt. Dazu namentlich
`cancel_call` (Nicht-Widget, migriert) in der Pruefmenge.

Testname darf **nicht** mit `DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD`
+ Ziffer beginnen (`package.json config.i18nCatalogPattern`) — sonst wandert er in den
Gates-Lauf. Praefix `P2 (T-18/T-22): …` ist sicher.

### Schritt 11 — Neuer Test: der Rest des T-18-Wortlauts am selben Response
Ueber dieselbe gelieferte Liste: `name` eindeutig (Set-Groesse == Listenlaenge), `description`
nicht-leerer String, `inputSchema` ein Objekt. Dazu die `outputSchema`-Bilanz: **genau 10** der
12 tragen eines, und `cancel_call`/`list_action_items` sind nicht darunter.

### Schritt 12 — Neuer Test: `structuredContent`-Beleg fuer die zwei Tools ohne `outputSchema`
Statt der im Plan vorgesehenen Report-Behauptung ein Test: beide Handler ueber den
Gateway-Mock aufrufen (Muster `test/mcp-tools.test.js` `captureTools` + lokaler HTTP-Mock) und
`result.structuredContent === undefined` pruefen. Damit ist Abnahmekriterium 6 des Plans nicht
nur mit `datei:zeile` behauptet, sondern am Verhalten belegt.

### Schritt 13 — Neuer Test: stdio-Pfad am echten SDK-`tools/list`
`McpServer` + `InMemoryTransport.createLinkedPair()` + `Client.listTools()`, `registerTools()`
mit **genau** dem ctx aus `src/mcp-server.js:26-28` (`{ uiHost: { enabled: … } }`, keine
Consult-Faehigkeit, `allowCalendar` per Default). Geprueft wird dasselbe wie in Schritt 10.

Das ist bewusst **staerker** als der P1-Ersatz (Attrappen-Server): es laeuft durch den echten
ListTools-Handler des SDK. Ein Feld, das `registerTool()` still verwirft (P0/U-2), faellt hier
auf. Kein Kindprozess, keine Pipe — dafuer ohne Transport-Serialisierung; das bleibt die eine
verbleibende Luecke und gehoert so in den Bericht.

### Schritt 14 — Neuer Test: ChatGPT-Adapter traegt beide `_meta`-Familien nebeneinander
Derselbe In-Memory-Harness, `uiHost: { enabled: true, capabilities: { extensions: {
"io.modelcontextprotocol/ui": { mimeTypes: ["text/html+skybridge"] } } } }` (Muster
`test/mcp-ui.test.js:509-512`). Geprueft: `place_call._meta["openai/outputTemplate"]` ist der
flache URI-String **und** beide `toolInvocation`-Schluessel stehen daneben, **und** `_meta.ui`
fehlt weiterhin (die bestehende Adapter-Invariante, `test/mcp-ui.test.js:563`).

### Schritt 15 — Gesamtlauf, Lint-Lauf, Gate-Lauf
`node --check src/mcp-tools.js`, `npm run lint`,
`node scripts/check-staged-suppressions.js src/mcp-tools.js test/mcp-ui.test.js …`,
`npm test -- -- --test-concurrency=4`, `npm run test:gates`. Zahlen gegen Schritt 1 stellen.

---

## 3. Was diese Phase NICHT baut

1. **Kein `outputSchema` fuer `cancel_call`/`list_action_items`.** T-18 verlangt es nur fuer
   Tools, die `structuredContent` liefern; beide liefern ausschliesslich `text(...)`. Ein
   hinzugefuegtes Schema erzeugte den P4-Defekt neu.
2. **Kein `annotations.title`-Rueckbau.** Erfuellt keine ID, bricht die P1-Tabellen.
3. **Kein stdio-Kindprozess-Harness.** Die Pipe-Serialisierung bleibt ungetestet; der
   In-Memory-Lauf deckt alles darunter ab. Ein echter Prozess-Harness ist eigener Bau und war
   schon in P1 bewusst vertagt.
4. **Kein `securitySchemes`** (T-15, P3), **keine `instructions`** (T-21, P4), **keine
   Widget-Aenderung** (P8), **keine Beschreibungs-/Schema-Aenderung** (P1/P4).
5. **Keine neue Env-Variable.** Damit entfaellt die Vier-Orte-Pflicht
   (`config.js`/`.env.example`/`render.yaml`/`BASE_ENV`) fuer diese Phase vollstaendig.
6. **Kein Laufzeit-Waechter auf 64 Zeichen.**
7. **Kein Ausbau der nun ungenutzten `tool`-Attrappen in ~15 Testdateien.** Gemessen: die
   betroffenen Dateien (`test/mcp-tools.test.js`, `test/mcp-tools-i18n.test.js`,
   `test/mcp-tools-language.test.js`, `test/al-p11-result-card.test.js`,
   `test/al-p13-consult-channel.test.js`, `test/mcp-ui-i18n-divergence.test.js`,
   `test/place-call-context-bridge.test.js`) tragen Suppressions und stehen **nicht** auf der
   Altlast-Liste; das Entfernen der 4-Parameter-Attrappe senkt ihren `max-params`-Befund, und
   Stufe 2 des Aufraeum-Gates lehnt **jede** Bewegung ab — auch eine Verbesserung. Der Ausbau
   zoege also die vollstaendige Suppressions-Raeumung von sieben fremden Testdateien nach sich.
   Das ist ein eigenes Paket. Bestandsbefund, nicht von P2 erzeugt.

---

## 4. Pre-Mortem — ein Jahr spaeter war P2 ein Fehler

1. **Die Statuszeilen fehlen genau auf den 5 Widget-Tools.** Sie wurden doch in die
   Config-Literale geschrieben, `...enableWidgetUi()` hat sie ueberschrieben, und der Test lief
   mit dem `BASE_ENV`-Default `MCP_UI_ENABLED=false` — kein Tool hatte ein Widget, die Falle war
   gar nicht im Raum, der Test war gruen und leer. *Entschaerfung:* Schritt 3 (ein Merge-Ort
   ausserhalb der Literale) **und** Schritt 10 (Env-Override + Positiv-Kontrolle auf
   `place_call._meta.ui.resourceUri`). Ohne die Positiv-Kontrolle beweist der Testlauf nichts.
2. **`cancel_call` antwortet "Output validation error" statt der Absage.** Die Migration auf
   `registerTool()` hat ein `outputSchema` mitgenommen, weil die Config-Form es erlaubt.
   *Entschaerfung:* Schritt 4/5 verbieten es ausdruecklich, Schritt 11 zaehlt am Wire (10, nicht
   12) und Schritt 12 belegt das Verhalten. Nicht `grep -c "outputSchema"` (liefert 21 inkl.
   Konstanten und Kommentaren), sondern `grep -c "outputSchema:"` -> 10.
3. **Der Commit war nur mit `--no-verify` moeglich.** Das Entfernen der `tool()`-Fabrik hat den
   `max-params`-Befund getilgt, `eslint-suppressions.json` blieb stehen, `npm run lint` brach
   mit Ausgang 2, und unter Zeitdruck wurde das Gate umgangen — womit die Ratsche fuer alle
   spaeteren Phasen wertlos ist. *Entschaerfung:* Schritt 7 nennt alle drei Stellen
   (Suppressions, Altlast-Pin, Pin-Spiegel im Test) **vor** dem Bau.
4. **`title` und `annotations.title` sind auseinandergelaufen.** Jemand hat eine zweite,
   namensindizierte Titel-Tabelle angelegt; ein Jahr spaeter zeigt ChatGPT einen anderen
   Anzeigenamen als Claude. *Entschaerfung:* `title` wird aus `config.annotations.title`
   abgeleitet — es gibt strukturell keine zweite Quelle.
5. **Die `mcp-ui`-Assertionen wurden weggeschrieben statt praezisiert.** Aus
   `assert.equal(config._meta, undefined)` wurde ein `assert.ok(true)`-Aequivalent; zwei Phasen
   spaeter haengt ein Widget an `get_transcript` und niemand merkt es. *Entschaerfung:* Schritt 8
   schreibt den Ersatz vor, der die Widget-Schluessel **namentlich** ausschliesst.
6. **Der ChatGPT-Pfad ist leer ausgeliefert worden.** Der Adapter wird nur bei explizit
   deklarierter Skybridge-Capability gewaehlt; kein Test hat ihn mit den neuen Feldern gesehen,
   und in der Einreichung fehlt entweder `openai/outputTemplate` oder die Statuszeile.
   *Entschaerfung:* Schritt 14.

---

## 5. Widersprueche zwischen Plan und Messung

| # | Plan sagt | Gemessen | Aufloesung |
|---|---|---|---|
| W2-1 | `TOOL_ANNOTATIONS` :599-642, Fabriken :755-762, `enableWidgetUi()` :718-725, Widget-Spread :929, `cancel_call` :1173-1181, `list_action_items` :1269-1287/:1271-1287 | :637-715, :828-835, :791-798, :1002, :1240-1248, :1338-1355 | Messung. Der Plan ist vor dem P1-Merge (`72fbc78`) geschrieben; alles ist um ~60-70 Zeilen verschoben. Diese Spec nennt durchweg die gemessenen Zeilen. |
| W2-2 | P2 sei "2 Tools wechseln den Registrierweg", `title` also an den anderen 10 vorhanden | `title` ist an **allen 12** `undefined` (echtes `tools/list`) | Messung. Der Umfang ist groesser als geplant: die Fabrik hebt `title` fuer alle zwoelf, nicht nur fuer die zwei migrierten. |
| W2-3 | Abnahmekriterium 4: "keine geaenderte Assertion" (bezogen auf `test/mcp-tools.test.js`) | `test/mcp-ui.test.js` bricht an **10** Stellen, weil dort "kein `_meta`" als Stellvertreter fuer "kein Widget" steht | Beides gilt. `test/mcp-tools.test.js` bleibt unveraendert (Kriterium 4 erfuellt); `test/mcp-ui.test.js` wird in Schritt 8 praezisiert. Der Plan hat diese Datei nicht gesehen. |
| W2-4 | Abnahmekriterium 3: `grep -n "server.tool("` liefert "nur noch die Fabrik-Definition **oder** 0 Treffer" | Die Fabrik waere nach der Migration toter Code (CLAUDE.md: verboten) | Strengere Variante: 0 Treffer. Der Plan nennt die Lint-Folge (`max-params`-Suppression) nicht — Schritt 7 holt sie nach. |
| W2-5 | Grundlinie laut Auftrag 6153 / 6152 gruen | P1-Bericht misst nach dem P1-Merge 6155 / 6155 | Schritt 1: eigene Messung auf dem Ausgangsstand. Keine der beiden Zahlen wird ungeprueft uebernommen. |
| W2-6 | Auftrag: "Der Exit-Code von `npm test` LUEGT" | P0/W-3: in der P0-Messung war der Exit-Code korrekt (1 bei `# fail 1`) | Praxis bleibt: nur `# pass`/`# fail` zaehlen. Die aeltere Beobachtung ist nicht widerlegt, nur nicht reproduziert. |
| W2-7 | Plan behandelt T-22 als Pflichtfeld an allen 12 | Der massgebliche Wortlaut (Zeile 55) ist eine **Obergrenze** (`<= 64 chars`), keine Setzpflicht; X-3 fuehrt `openai/toolInvocation/*` als *optional* | Kein Konflikt, aber ehrlich zu benennen: das Setzen an allen 12 ist eine Produktentscheidung des Plans, die 64-Zeichen-Grenze ist die eigentliche Anforderung. Gebaut wird wie geplant. |

## 6. UNKNOWN

- **U-P2-1:** Ob ChatGPT den Top-Level-`title` oder `annotations.title` bevorzugt, ist nicht aus
  selbst gelesenem Rohtext belegt (die W-09-Reihenfolge stammt aus einem Bestandskommentar).
  Folgenlos: beide Felder werden gesetzt.
- **U-P2-2:** Ob `_meta` an einem Tool, das nur `toolInvocation` traegt, von ChatGPT anders
  behandelt wird als ein fehlendes `_meta`, ist nicht gepruefbar ohne echten Host. Fail-safe:
  die Schluessel sind namensraeumig und "ignore-if-unknown".
