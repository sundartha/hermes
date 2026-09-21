# P4 — Spezifikation: `get_transcript` ohne `structuredContent` + Server-`instructions`

IDs: **T-19, T-20, T-21, O-27 (Teil 1)**.
Quellen in Rangfolge: `tasks/PLAN-OPENAI-TECHNIK.md` (Abschnitt "P4", Zeilen 413-528),
`tasks/openai-p0-entscheidungen.md`, `tasks/openai-audit/00-openai-anforderungen.md`
(Zeilen 52, 53, 54, 122). **Nicht** massgeblich: `tasks/openai-audit/00-mcp-spec.md`.

Diese Datei ist eine Spezifikation. **In dieser Phase wurde kein Produktionscode
geaendert.** Alle unten genannten Messungen sind lesend bzw. gegen einen lokal
gespawnten Testserver mit Gateway-Attrappe gefahren — kein echter Anruf, keine SMS,
kein Deploy, kein Schreibzugriff auf Produktion.

---

## 0. Vorher-Messung (selbst gefahren, 2026-09-21)

Alle drei Defekte sind reproduziert, bevor eine Zeile geplant wurde. Die Sonde lag
temporaer unter `test/zz-p4-probe.test.js` und ist **geloescht**; die Befehle sind unten
je Schritt als Nachbau-Anleitung hinterlegt.

| Messung | Ergebnis |
|---|---|
| `tools/call get_transcript` ueber die echte `/mcp`-Route, Anruf im Zustand `active` | `isError: true`, Text = `MCP error -32602: Output validation error: Tool get_transcript has an output schema but no structured content was provided`, `structuredContent` fehlt. **Der tenant-sprachige Satz erreicht den Client nie.** |
| `initialize` ueber die echte `/mcp`-Route, Tenant ohne Consult-Freigabe | `result.instructions === undefined` |
| `initialize` ueber den echten stdio-Kindprozess (`src/mcp-server.js`, `StdioClientTransport`) | `client.getInstructions() === undefined` |
| `MCP_CONSULT_INSTRUCTIONS` | Laenge **1238**, `indexOf("not-placed")` = **1073** (ausserhalb der ersten 512), `includes("calendar, mail, files")` = **true** |

Der Plan hatte die letzten beiden Zahlen behauptet; sie stimmen exakt. Die ersten drei
Zeilen waren im Plan nur hergeleitet und sind jetzt gemessen.

---

## 1. Arbeitsschritte

Reihenfolge ist bindend: erst die Code-Aenderung, dann der Bestandstest, der durch sie
faellt, dann der neue Beleg. Kein Zwischenzustand ueber einen Commit hinaus.

### Schritt 1 — Defekt 1: `get_transcript` liefert bei laufendem Anruf ein Fehlerergebnis

**Stelle:** `src/mcp-tools.js:1267`.

```
      if (c.status === "active") return text({ error: loc.mcp.callStillRunning });
```
wird zu
```
      // T-19/T-20: das Werkzeug deklariert ein outputSchema (:1263). text() (:79-81)
      // liefert weder structuredContent noch isError - der SDK-Validator wirft dann
      // "Output validation error", und der Client sieht die Systemmeldung statt des
      // Hinweises. "Anruf laeuft noch" IST ein Fehlerergebnis im MCP-Sinn, also errText.
      if (c.status === "active") return errText(loc.mcp.callStillRunning);
```

`errText` liegt bereits in derselben Datei (`src/mcp-tools.js:84`) und setzt
`isError: true`; der SDK-Validator nimmt Fehlerergebnisse ausdruecklich aus
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`, `if (result.isError) return;`).

**Bewusste, sichtbare Nebenwirkung:** der Textblock ist danach der nackte Satz statt des
JSON-Objekts `{"error": "..."}`. Das ist der Punkt von T-19 ("nur `structuredContent`
und `content` erreichen das Modell") — der Satz selbst bleibt byte-identisch, nur seine
JSON-Huelle faellt weg.

**IDs:** T-19, T-20.
**Pfade:** HTTP `/mcp` **und** stdio (beide rufen dieselbe `registerTools()`,
`src/routes/mcp.js:151` bzw. `src/mcp-server.js:26`). **mcp-nativ und ChatGPT-Adapter
sind beide gedeckt und zwar strukturell**, nicht zufaellig: `get_transcript` ist ein
reines Stufe-0-Werkzeug (`src/mcp-tools.js:1250-1264`, kein `...enableWidgetUi(...)`),
der Adapter kann sein Ergebnis gar nicht anfassen — die Renderer liefern ausschliesslich
`_meta` an den **Tool-Deskriptor** (`src/mcp-tools.js:853-859`), nie an ein Handler-Ergebnis.

**Beweis (Art b + c):** ein neuer gruener Test (Schritt 6, Fall 1) prueft am HTTP-Response.
Zusaetzlich reproduzierbar per lesender Messung:

```
NODE_ENV=test node --test test/openai-p4-ergebnisstruktur-instructions.test.js
```

Erwartete Ausgabe: `# fail 0`, darin der Fall
`P4 (T-19/T-20): get_transcript bei laufendem Anruf liefert isError + den lokalisierten Satz, nicht "Output validation error"`.

---

### Schritt 2 — Bestandstest anpassen, der durch Schritt 1 faellt

**Stelle:** `test/mcp-tools-language.test.js:376-390`
(`get_transcript bei laufendem Anruf: Hinweistext folgt der Tenant-Sprache (P15/T3a)`).

Der Fall liest heute `JSON.parse(toolText(r)).error`. Nach Schritt 1 ist der Text kein
JSON mehr. Anzupassen auf:
- `assert.equal(r.isError, true, ...)` je Sprache (die neue Zusicherung, additiv),
- `assert.equal(toolText(r), MCP_TEXTS[language].callStillRunning)` statt `JSON.parse(...).error`,
- der DE-Fall behaelt den vollen Wortlaut-Vergleich (`"Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen."`), nur ohne JSON-Huelle. Der Kommentar
  "DE bleibt byte-identisch zum Bestand" wird praezisiert auf "der SATZ bleibt
  byte-identisch, die JSON-Huelle faellt weg (T-19)".

**Nicht** entfernen, **nicht** entschaerfen: der Fall ist der einzige Ort, an dem der
Hinweistext ueber alle `SUPPORTED_LANGUAGES` geprueft wird, und er deckt zugleich die
Pre-Mortem-Auflage des Plans ab ("der Review prueft den Wortlaut in allen Sprachfassungen").

**IDs:** T-19, T-20 (Regressionsschutz).
**Pfade:** In-Process-Handler (beide Transporte teilen ihn).
**Beweis (Art b):**
```
NODE_ENV=test node --test test/mcp-tools-language.test.js
```
Erwartete Ausgabe: `# fail 0` bei 30 Faellen. Ein fremder Pruefer sieht im Diff, dass die
Assertion auf `isError` **hinzugekommen** und keine Sprache entfallen ist.

---

### Schritt 3 — Die Regel: kein Werkzeug mit `outputSchema` gibt je ohne `structuredContent` **und** ohne `isError` zurueck

Ein Ein-Zeilen-Fix wiederholt sich beim naechsten fruehen `return`. Deshalb ein
**tabellengetriebener Test ueber alle** Werkzeuge mit `outputSchema` (heute 10 von 12,
`src/mcp-tools.js:1061, 1116, 1171, 1246, 1263, 1322, 1351, 1381, 1437, 1477`).

**Stelle:** neue Testdatei aus Schritt 6, Fall 2. **Kein Produktionscode.** Ein
Laufzeit-Waechter wird ausdruecklich **nicht** gebaut (Begruendung in Abschnitt 2).

Aufbau:
1. `registerTools()` gegen den Attrappen-Server aus `test/mcp-tools.test.js:24-39`
   (faengt `registerTool(name, config, handler)` ein) — **mit** `config`, nicht nur dem
   Handler, damit die Pruefmenge aus der **gelieferten Registrierung** entsteht und nicht
   aus einer gepflegten Namensliste.
2. Die Pruefmenge = alle eingefangenen Werkzeuge mit `config.outputSchema`.
   `assert.equal(menge.size, TOOLS_WITH_OUTPUT_SCHEMA)` (`test/helpers.js:62`, Wert 10).
3. Eine Szenario-Tabelle mit **genau einem Eintrag je Werkzeug** der Pruefmenge; ein
   Werkzeug in der Pruefmenge ohne Eintrag laesst den Test **rot** werden
   (`assert.ok(tabelle.has(name), ...)`). So kann ein kuenftiges elftes Schema-Werkzeug
   nicht still durchrutschen.
4. Je Eintrag zwei Laeufe gegen die Gateway-Attrappe aus `test/mcp-tools.test.js:58-64`:
   - **Erfolgslauf** (Positiv-Kontrolle, Lehre `pruefkommando-ohne-positiv-kontrolle`):
     der Eintrag nennt einen Antwortkoerper, mit dem der Handler durchlaeuft.
     Zusicherung: `result.isError !== true` **und** `Object.hasOwn(result, "structuredContent")`.
     Ohne diesen Lauf waere der Test gruen, obwohl jeder Handler nur noch Fehler liefert.
   - **Fehlerlauf**: leerer Antwortkoerper (`body: null` -> `api()` degradiert zu `{}`).
     Zusicherung: `result.isError === true`.
5. **Ein dritter, gezielter Lauf** fuer den heute einzigen bekannten fruehen
   Rueckgabepfad: `get_transcript` mit `{ status: "active" }` -> `isError === true`.
   Dieser Lauf ist die Positiv-Kontrolle der Regel selbst: macht jemand Schritt 1
   rueckgaengig, faellt er.

**Kein echter Anruf:** `place_call` laeuft in diesem Test ausschliesslich gegen die
lokale HTTP-Attrappe (`GATEWAY_URL` zeigt darauf), die Telefonie-Ports werden nie erreicht.

**IDs:** T-19, T-20 (die Regel hinter dem Einzelfall).
**Pfade:** In-Process-Handler = beide Transporte. Renderer-unabhaengig (Schritt 1).
**Beweis (Art b):** der Fall
`P4 (T-19/T-20 Regel): jedes Werkzeug mit outputSchema liefert in jedem Rueckgabepfad structuredContent ODER isError`
ist gruen. Ein fremder Pruefer liest den Test und bestaetigt: die Pruefmenge entsteht aus
der Registrierung, sie umfasst 10 Werkzeuge, und `get_transcript` ist nicht der einzige
gepruefte Name.

---

### Schritt 4 — Defekt 2a: `instructions` umstellen, immer setzen, Aufzaehlung streichen

**Stelle:** `src/mcp-server-info.js:73-123`.

**4a. Zwei Bausteine statt eines Textes.**

```
export const MCP_BASE_INSTRUCTIONS = ...   // NEU, gilt IMMER
export const MCP_CONSULT_INSTRUCTIONS = MCP_BASE_INSTRUCTIONS + " " + <Consult-Block>
```

Der Consult-Block bleibt modul-intern (kein dritter Export, keine dritte Wahrheit).
`MCP_CONSULT_INSTRUCTIONS` behaelt Namen und Bedeutung: **der Text, der im Consult-Fall
ausgeliefert wird.** Damit bleiben die Pruefkommandos aus dem Plan (Abnahmekriterien 3
und 6) an genau dem Symbol pruefbar, das sie nennen, und die drei Bestandspins auf
dieser Konstante (`test/mcp-fehlergrund-rueckweg.test.js:191`,
`test/gq-b1-briefing-openness.test.js:152/199/223`) bleiben sachlich tragfaehig.

**4b. Inhalt `MCP_BASE_INSTRUCTIONS` (305 Zeichen, nachgerechnet).** Zwei Saetze, beide
ohne Consult-Werkzeug — sie muessen fuer einen Tenant gelten, der `await_call_event`
und `answer_consult` gar nicht registriert bekommt:

1. Der Geld-Satz: `` `If a call reports a failure_reason starting with "${NOT_PLACED}", the call could not be placed because of a problem on our side. Do NOT retry the call: tell the user what failed, using the result_summary text as it is.` ``
   **`${NOT_PLACED}` bleibt Template-Einsetzung** (`src/mcp-server-info.js:28`, Regel G22)
   — kein zweites Mal getippt. Der Satz nennt jetzt **kein** Werkzeug mehr: ohne Consult
   liefert `get_call_status` dasselbe Feld (`CALL_STATUS_OUTPUT`, `src/mcp-tools.js:182`).
2. Der Nicht-Erfinden-Satz: `Never invent facts about the principal or the call: if you do not know something, say so.`

**4c. Inhalt Consult-Block.** Byte-identisch zum Bestand mit **genau einer** Streichung:
`(calendar, mail, files, this chat)` entfaellt ersatzlos, der Satz lautet danach
`answer from your own tools and context first; only ask the user when they are actually
present right now, and never invent an answer.` Der abschliessende `not-placed`-Absatz
(heute `src/mcp-server-info.js:105-112`) wandert nach `MCP_BASE_INSTRUCTIONS` und
verschwindet aus dem Consult-Block (keine Dopplung).

**4d. `mcpServerOptions()` (`src/mcp-server-info.js:118-123`).**

```
  if (uiEnabled) options.capabilities = { extensions: uiServerExtension() };
  // T-21: instructions sind IMMER gesetzt - der Basis-Block gilt auch fuer einen Tenant
  // ohne Consult-Freigabe. Damit ist der Rueckgabewert nie mehr undefined.
  options.instructions = consultLoop ? MCP_CONSULT_INSTRUCTIONS : MCP_BASE_INSTRUCTIONS;
  return options;
```

`Object.keys(options).length ? options : undefined` entfaellt — mit der immer gesetzten
`instructions` ist der Zweig toter Code. Die Kopfkommentare bei `:73-77`
("eingesetzt wird er in `routes/mcp.js`") und `:115-117` ("byte-identisch ... undefined")
werden im selben Zug korrigiert; beide waeren danach falsch.

**Messung, die der Bauende vor dem Commit selbst fuehrt:**
```
node -e 'import("./src/mcp-server-info.js").then(m=>{const s=m.MCP_CONSULT_INSTRUCTIONS;console.log(s.length, s.indexOf("not-placed"), s.includes("calendar, mail, files"));})'
```
Erwartet: Laenge ~1283, `indexOf` **50** (< 512), `includes` **false**.
Vorausgerechnet aus dem obigen Wortlaut: Basis 305 + Consult 977 + ein Leerzeichen = 1283.

**IDs:** T-21, O-27 Teil 1.
**Pfade:** HTTP `/mcp` sofort (`src/routes/mcp.js:136-142`), stdio ueber Schritt 5.
Der Text ist einsprachig Englisch (Systemgrenze O14, Kopfkommentar `:77`) — es gibt
keine zweite Sprachfassung, die auseinanderlaufen koennte.
**Beweis (Art a + c):** die Konstanten an genannter Stelle plus die zwei Kommandos aus
den Abnahmekriterien 3 und 6 des Plans, die ein fremder Pruefer selbst ausfuehrt:
```
node -e 'import("./src/mcp-server-info.js").then(m=>console.log(m.MCP_CONSULT_INSTRUCTIONS.slice(0,512)))'
node -e 'import("./src/mcp-server-info.js").then(m=>console.log(m.MCP_CONSULT_INSTRUCTIONS.includes("calendar, mail, files")))'
```
Erwartet: der `not-placed`-Satz steht im ersten Ausdruck ganz vorn; der zweite gibt `false`.

---

### Schritt 5 — Defekt 2b: stdio ruft denselben Options-Bauer

**Stelle:** `src/mcp-server.js:11` (Import) und `:19-21`.

```
const serverOptions = config.tenancy.mcpUiEnabled
  ? { capabilities: { extensions: uiServerExtension() } }
  : undefined;
```
wird zu
```
// T-21: derselbe Options-Bauer wie der HTTP-Connector (routes/mcp.js) - sonst traegt der
// initialize-Response ueber stdio strukturell NIE instructions. mcpServerOptions() nimmt
// ausschliesslich zwei Booleans und beruehrt KEINEN Store (wichtig: dieser Prozess darf
// keinen zweiten pg-Pool oeffnen, s. Kommentar unten).
// Der Consult-Block bleibt aus, weil dieser Prozess registerTools() ohne consultAllowed
// aufruft (:26-28, Default false) - await_call_event/answer_consult existieren hier gar
// nicht, und eine Instruktion auf ein nicht registriertes Werkzeug waere eine Falschangabe.
const STDIO_CONSULT_LOOP = false;
const serverOptions = mcpServerOptions({
  uiEnabled: config.tenancy.mcpUiEnabled,
  consultLoop: STDIO_CONSULT_LOOP,
});
```

- Der Bezeichner `serverOptions` **bleibt**: `test/mcp-server-icon.test.js:43` pinnt die
  Zeile `new McpServer(HERMES_SERVER_INFO, serverOptions)` als Quelltext.
- Der Import `uiServerExtension` (`:11`) wird danach nicht mehr benutzt und **muss weg**
  (kein toter Code). `mcpServerOptions` kommt aus `./mcp-server-info.js`, das diese Datei
  bereits importiert (`:12`) — **keine neue Import-Abhaengigkeit, kein neuer Modulgraph,
  kein Store**. Das ist die Entschaerfung der Plan-Pre-Mortem-Sorge, und sie ist am Import
  nachweisbar, nicht nur behauptet.

**IDs:** T-21 (DP-1, der doppelte Pfad — hier ist er der Kern).
**Pfade:** stdio. Der HTTP-Pfad bleibt unberuehrt (`src/routes/mcp.js:136-142` ruft
denselben Bauer schon).
**Beweis (Art b + c):** der Spawn-Test aus Schritt 6, Fall 5. Zusaetzlich Syntax und
Start-Smoke, die der Pruefer selbst fahren kann:
```
node --check src/mcp-server.js && node --check src/mcp-server-info.js && node --check src/mcp-tools.js
echo "" | node src/mcp-server.js; echo "exit=$?"
```
Erwartet: `node --check` still, der Start-Smoke gibt auf stderr
`[hermes] MCP-Server bereit (stdio). ...` und endet ohne Crash.

---

### Schritt 6 — Neue Testdatei `test/openai-p4-ergebnisstruktur-instructions.test.js`

Namenskonvention: **jeder** Fall beginnt mit `P4 (...)`. `P4` trifft weder
`package.json config.i18nCatalogPattern` noch `config.abnahmePattern` — die Faelle
landen in der Regressionsbank (`npm test`), wo sie hingehoeren. Ein Name, der mit
`MCP-<Ziffer>` beginnt, ist verboten (Lehre `catalog-id-prefix-misroutes-tests`).

| Fall | Abnahmekriterium des Plans | Aufbau | Zusicherung |
|---|---|---|---|
| 1 | 1 | `startServer({seed: seedState({calls:[seedCall({id:"call_active1"})]})})`, dann `mcpPost(url, null, toolCall("get_transcript", {call_id:"call_active1"}))`, `readToolResult` | `isError === true`; `content[0].text === MCP_TEXTS.<tenantsprache>.callStillRunning`; `assert.doesNotMatch(text, /Output validation error/)`. **Die Assertion geht auf den Textinhalt, nicht nur auf `isError`** — sonst waere der Bestandsdefekt (der ebenfalls `isError:true` liefert) nicht unterscheidbar. |
| 2 | 2 | s. Schritt 3 | Regel ueber alle 10 Schema-Werkzeuge, mit Positiv-Kontrolle |
| 3 | 3 + 6 | reiner Konstanten-Test | `MCP_CONSULT_INSTRUCTIONS.slice(0,512).includes(NOT_PLACED)`; `!MCP_CONSULT_INSTRUCTIONS.includes("calendar, mail, files")`; Positiv-Kontrolle: `MCP_CONSULT_INSTRUCTIONS.includes("await_call_event")` |
| 4 | 4 | `startServer({seed: seedState({})})` **ohne** `CONSULT_ENABLED`-Override (BASE_ENV setzt `CONSULT_ENABLED:"false"`, `test/helpers.js:416`), `initialize` ueber `mcpPost` | `typeof result.instructions === "string"` und `result.instructions.length > 0`; zusaetzlich `result.instructions === <Basis-Block-Literal>` und `!result.instructions.includes("await_call_event")` — der Beleg, dass ein Tenant ohne Consult-Freigabe den **Basis**-Block bekommt und nicht den Consult-Text |
| 5 | 5 | `StdioClientTransport({command: process.execPath, args:["src/mcp-server.js"], cwd: ROOT, env: BASE_ENV, stderr:"pipe"})` + `Client`, Muster `test/openai-p3-security-schemes.test.js:278-303` | `client.getInstructions()` ist ein nicht-leerer String. **Echter Kindprozess, echtes Protokoll ueber die Pipe** — keine Quelltext-Inspektion, kein InMemory-Transport. `stderr` wird mitgeschnitten und in die Fehlermeldung gehaengt (sonst ist ein Startfehler nicht diagnostizierbar). Dieser Fall ist zugleich der Start-Smoke aus dem Plan-Pre-Mortem. |
| 6 | 7 | gegen den **ausgelieferten** Text, nicht gegen die Konstante: `mcpServerOptions({uiEnabled:false, consultLoop:true}).instructions` | vier Wirkungen: (a) Poll-Schleife bis `done` — `/until it returns event="done"/`; (b) Quittung `working` binnen Sekunden — `/status="working"/` **und** `/within seconds/`; (c) eigene Quellen zuerst + nur bei echter Anwesenheit fragen + nichts erfinden — `/answer from your own tools and context first/`, `/only ask the user when they are actually present/`, `/never invent an answer/`, **und** `assert.doesNotMatch(text, /calendar, mail, files/)`; (d) `not-placed` nicht wiederholen — `includes(NOT_PLACED)` **und** `/Do NOT retry the call/` |

Fall 6 erfuellt die Auflage des Plans, dass Aussage (c) **die Wirkung** prueft und nicht
die Aufzaehlung: die letzte Zusicherung desselben Falls verbietet die Aufzaehlung
ausdruecklich. Ein Pin auf `calendar, mail, files` waere mit Kriterium 6 unvereinbar —
dieser Fall macht den Widerspruch unmoeglich, statt ihn nur zu vermeiden.

**IDs:** T-19, T-20, T-21, O-27 Teil 1.
**Pfade:** Fall 1/4 = HTTP `/mcp`; Fall 5 = stdio; Fall 2/3/6 = geteilte Quelle beider
Pfade. Adapter-Achse: Schritt 1 (`get_transcript` traegt kein Widget-`_meta`, der
Renderer erreicht Handler-Ergebnisse strukturell nicht).
**Beweis (Art b):**
```
NODE_ENV=test node --test test/openai-p4-ergebnisstruktur-instructions.test.js
```
Erwartet: `# fail 0`, sechs Faelle.

---

### Schritt 7 — Die zwei weiteren Bestandstests, die durch Schritt 4/5 fallen

**7a. `test/al-p13-consult-channel.test.js:799-810` (`AL-P13-37`).**
Der Fall pinnt heute `mcpServerOptions({uiEnabled:false, consultLoop:false}) === undefined`
und `...({uiEnabled:true, consultLoop:false}).instructions === undefined`. **Beides kippt
T-21 absichtlich.** Umzuschreiben auf:
- `mcpServerOptions({uiEnabled:false, consultLoop:false}).instructions === MCP_BASE_INSTRUCTIONS`
  (der neue Vertrag: immer gesetzt),
- `...({uiEnabled:false, consultLoop:true}).instructions === MCP_CONSULT_INSTRUCTIONS` (bleibt),
- `...({uiEnabled:true, consultLoop:false}).capabilities` vorhanden (bleibt),
- `...({uiEnabled:true, consultLoop:false}).instructions === MCP_BASE_INSTRUCTIONS` (statt `undefined`).
Der Testname traegt die alte Praemisse ("Bestand byte-identisch") und wird auf
"`mcpServerOptions` setzt instructions immer, Consult-Block nur am Schalter (T-21)"
geaendert. Die Byte-Identitaets-Zusage von AL-P13 gilt fuer diese eine Zeile nicht mehr —
das gehoert in den Abschlussbericht, nicht in eine stille Loeschung.

**7b. `test/gq-b1-briefing-openness.test.js:152-161` (`GQ-B1-05`).**
Zeile 154 pinnt `consultInstructions.startsWith("While a call placed with place_call is running")`.
Ein `startsWith`-Pin und T-21 ("Wichtigstes in die ersten 512") schliessen einander aus.
Umzuschreiben auf `assert.ok(consultInstructions.includes("While a call placed with place_call is running"), ...)`
mit Kommentar: der Satz bleibt erhalten, nur seine **Position** aendert sich, weil der
Geld-Satz nach vorn muss. Die uebrigen drei Zusicherungen des Falls (Bestandssatz
"Staying in that loop pays off", "answer within seconds", **keine Sekundenzahl**) bleiben
unangetastet und sind gegen den neuen Wortlaut geprueft: der Basis-Block enthaelt keine
Ziffer.

**Nicht** betroffen und ausdruecklich nachgesehen: `GQ-B2-03/04/05`
(`test/gq-b1-briefing-openness.test.js:199-241`) pinnen `answer from your own tools and
context first`, `say with answer_consult that you do not know`, `instead of waiting`,
`doesNotMatch(/ask the user first/i)` — alle vier ueberleben den Wortlaut aus 4c
unveraendert. `test/mcp-fehlergrund-rueckweg.test.js:191-204` pinnt `await_call_event`
(Positiv-Kontrolle), `NOT_PLACED` und `Do NOT retry the call` — alle drei ueberleben,
weil `MCP_CONSULT_INSTRUCTIONS` weiterhin Basis **und** Consult-Block traegt.

**IDs:** T-21 (Regressionsschutz).
**Pfade:** geteilte Quelle.
**Beweis (Art b):**
```
NODE_ENV=test node --test test/al-p13-consult-channel.test.js test/gq-b1-briefing-openness.test.js test/mcp-fehlergrund-rueckweg.test.js
```
Erwartet: `# fail 0`.

---

### Schritt 8 — Gesamtlauf und Abschlussbericht

```
npm test -- -- --test-concurrency=4
```
**Nur der doppelte `--`-Trenner reicht das Flag durch.** Nur die Zeilen `# pass` und
`# fail` zaehlen, nie der Exit-Code. Grundlinie vor P4: **6166 gruen / 0 rot**. Nach P4
erwartet: 6166 + 6 neue Faelle aus Schritt 6, `# fail 0`; die drei angepassten
Bestandsfaelle bleiben in der Zahl (sie werden geaendert, nicht entfernt).

Ein roter Test zaehlt erst, wenn er **isoliert** erneut rot ist
(`NODE_ENV=test node --test <datei>`). Die Ausgabe wird **nicht** abgeschnitten.

Ausserdem, weil P4 die Datei `src/mcp-server-info.js` und den `/mcp`-Pfad beruehrt:
```
NODE_ENV=test node --test --test-concurrency=4 test/openai-p2-tool-metadaten.test.js test/openai-p3-security-schemes.test.js test/mcp-server-icon.test.js test/mcp-tool-annotations.test.js test/mcp-tools.test.js test/mcp-ui.test.js
```
Erwartet: `# fail 0` (Frueherkennung, bevor der 7-Minuten-Lauf startet).

Der Abschlussbericht (`tasks/openai-p4-report.md`) nennt: die Vorher-/Nachher-Messung aus
Abschnitt 0, die drei geaenderten Bestandstests **mit Begruendung**, die Zahl aus dem
Gesamtlauf, und den offenen Befund aus Abschnitt 3 (`src/mcp-tools.js:940`).

**IDs:** alle.
**Beweis (Art c):** die Zahlen `# pass` / `# fail` im Bericht, vom Pruefer wiederholbar.

---

## 2. Was in dieser Phase NICHT gebaut wird

| Nicht gebaut | Grund |
|---|---|
| **Ein Laufzeit-Waechter, der jedes Handler-Ergebnis gegen die `outputSchema`-Regel prueft** (z.B. in `wrapHandler`) | Waere Code, der im Betrieb nie etwas tut — dieselbe Begruendung, die im Bestand schon bei der 64-Zeichen-Grenze steht (`src/mcp-tools.js:727-729`). Der SDK-Validator wirft bereits; ein zweiter Waechter davor verdoppelt die Wahrheit. Die Regel wird als **Test** gebaut (Schritt 3), nicht als Produktionscode. |
| **`securitySchemes`, `WWW-Authenticate`, Scope, CORS, Widget-UI** | Fremde Phasen (P3 erledigt, P6/P7/P8/P9). Jede Beruehrung hier waere ein Zwischenzustand, den eine spaetere Phase reparieren muesste. |
| **Kuerzen des Instruktionstextes** | Der Plan verlangt ausdruecklich *umstellen und umformulieren, nicht kuerzen*: der GQ-B2-Satz ("eigene Quellen zuerst") ist der Nutzen des Consult-Kanals. Gestrichen wird **genau eine** Aufzaehlung (O-27), sonst nichts. Die Zeichenzahl steigt sogar leicht (1238 -> 1283); T-21 fordert keine Obergrenze, nur die Reihenfolge. |
| **`consultPermissionHint` neutral formulieren (O-27 Teil 2)** | Liegt in P5b. Anderer Text (`src/i18n/mcp-texts.js:71-73`), **tenant-sichtbar und sprachabhaengig** (vier Sprachfassungen), anderes Risiko. |
| **Die Aufzaehlung `(calendar, mail, files, chat)` in der `place_call`-Briefing-Beschreibung (`src/mcp-tools.js:940`)** | Siehe Abschnitt 3, Widerspruch W-3. Kurzfassung: der Plan schneidet O-27 Teil 1 ausdruecklich auf `MCP_CONSULT_INSTRUCTIONS` zu; die Briefing-Beschreibung ist ein GQ-B2-kalibrierter Anruf-Qualitaetstext mit eigener Bench-Historie, und eine Aenderung daran gehoert nicht ohne Auftrag in eine Phase, die den Fehlerkanal repariert. **Der Befund wird nicht verschwiegen, sondern im Abschlussbericht als offen ausgewiesen.** |
| **`OWNER_PROFILE` vs. `DEFAULT_PROFILE`-Varianz der Tool-MENGE** | P10 (DP-5). P4 loest die Varianz nur fuer `instructions` auf — das ist der Teil, den T-21 verlangt. |
| **Eine neue Env-Variable** | P4 braucht keine. Damit entfaellt auch die Vier-Orte-Pflicht (`src/config.js`, `.env.example`, `render.yaml`, `BASE_ENV`). Wer sie doch einfuehrt, hat den Auftrag verlassen. |
| **`PLAN-SECURITY.md`-Eintrag** | Kein Safety-Gate beruehrt: weder Verifikationspflicht, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer noch die Telnyx-Signaturpruefung. Der Offenlegungssatz (`disclosureSentence`) wird nicht angefasst — er lebt in `src/claude.js`/dem EL-Prompt, nicht in `mcp-server-info.js`. |

---

## 3. Widersprueche zwischen Plan, P0-Messung und Code

**W-1 — Zeilennummern des Plans sind ueberholt (P1-P3 haben die Datei verschoben).**
Der Plan nennt den Defekt bei `src/mcp-tools.js:1140` und `text()` bei `:79-81`,
`errText` bei `:84`. Gemessen auf master (`8f8de37`): der Defekt steht bei **`:1267`**,
`text()` bei `:79-81` (stimmt), `errText` bei `:84` (stimmt), `outputSchema` von
`get_transcript` bei **`:1263`**. Ebenso: `mcp-server-info.js:78-123` (Plan) ist heute
`:73-123`; `src/mcp-server.js:19-28` stimmt. **Aufloesung:** die Spec nennt die heute
gemessenen Stellen; der Bauende prueft sie vor dem Edit erneut, weil P4 selbst nichts an
diesen Zeilen verschiebt, ein Rebase aber schon.

**W-2 — Der Plan zaehlt `text(`-Treffer, das Kommando ist zweideutig.**
Plan: "grep `text(` in `src/mcp-tools.js`: 4 Treffer, davon 1 in einem
`outputSchema`-Tool". `grep -n "text(\|errText(" src/mcp-tools.js` liefert **6** Zeilen
(`:881`, `:1267`, `:1309`, `:1406`(Kommentar), `:1412`, `:1413`). Die Plan-Aussage
stimmt **fuer `text(` allein** (`:1267`, `:1309`, `:1412`, `:1413` = 4, davon `:1267` im
Schema-Tool). **Aufloesung:** Plan behaelt recht, aber das Kommando gehoert praezisiert —
`grep -n "return text(\| text(" ...` ist das, was er meint. Die Regel aus Schritt 3
haengt ohnehin nicht an dieser Zaehlung, sondern an der gelieferten Registrierung.

**W-3 — O-27 hat eine zweite, im Plan nicht genannte Oberflaeche.**
Der Plan beschraenkt O-27 Teil 1 auf `MCP_CONSULT_INSTRUCTIONS`. Gemessen
(`grep -rn "calendar, mail, files" src/`) gibt es **zwei** Fundstellen:
`src/mcp-server-info.js:94` (im Plan) und **`src/mcp-tools.js:940`**, die
`briefing`-Beschreibung von `place_call`: *"could you answer it yourself during the call
(calendar, mail, files, chat)?"*. Das ist ebenfalls ein modell-lesbares Feld, das fremde
Werkzeugklassen benennt. **Aufloesung: der Plan gewinnt, die Stelle wird NICHT geaendert**
— drei Gruende: (1) die Phasen-IDs schneiden O-27 Teil 1 ausdruecklich auf den
Instruktionstext zu (SCOPE-Regel 6); (2) die Briefing-Beschreibung ist ein an
`convo-bench` kalibrierter Anruf-Qualitaetstext (GQ-B2) mit eigenen Zeichenbudget-Tests
(`test/gq-b1-briefing-openness.test.js:140-150`) — eine Aenderung daran ohne
Vorher-Messung ist genau das Muster, das die Lehre
`bench-must-reproduce-defect` verbietet; (3) O-27 ist ohnehin schon geteilt (Teil 2 in
P5b), eine dritte Teilung ohne Auftrag waere eine stille Plan-Aenderung.
**Der Befund geht als offener Punkt in den Abschlussbericht und muss vor der Einreichung
entschieden werden** — sonst schliesst jemand O-27 mit halber Abdeckung.

**W-4 — Testbestand-Grundlinie: Auftrag vs. P0.**
P0 (`tasks/openai-p0-entscheidungen.md`, Abschnitt "Baseline") nennt **6153/6152 gruen,
1 Flake**; der Auftrag dieser Phase nennt **6166 gruen / 0 rot**. **Aufloesung: der
Auftragswert gewinnt** — er ist juenger (P1-P3 sind seither gemergt und haben Faelle
hinzugefuegt) und P0 selbst haelt fest, dass der eine rote Fall ein Flake war
(`test/sec-p4-mandanten-token.test.js`, isoliert gruen). Der Bauende misst die Grundlinie
**vor** der ersten Aenderung erneut; alles andere macht ein fremdes Flake zu P4s Schuld.

**W-5 — "Der Exit-Code luegt" ist als Naturgesetz zu stark.**
`MEMORY.md` und der Auftrag sagen es absolut; P0 (W-3 dort) hat bei `# fail 1` Exit 1
gemessen, also korrekt. **Aufloesung:** die Vorsichtsregel bleibt in Kraft (zaehle
`# pass`/`# fail`), die Begruendung wird nicht als bewiesen ausgegeben.

**W-6 — Der Plan nennt nur EINEN Bestandstest, der faellt; es sind DREI.**
Der Plan-Pre-Mortem erwaehnt keinen brechenden Bestandstest. Selbst gemessen (alle drei
sind heute gruen, `NODE_ENV=test node --test` ueber die vier Dateien: 89 pass / 0 fail):
`test/mcp-tools-language.test.js:376` faellt an Schritt 1,
`test/al-p13-consult-channel.test.js:799` und
`test/gq-b1-briefing-openness.test.js:152` fallen an Schritt 4.
**Aufloesung:** alle drei sind in der Spec als eigene Schritte (2 und 7) benannt, mit
Begruendung, warum die alte Zusicherung bewusst faellt. Keiner wird geloescht.

**W-7 — Abnahmekriterium 3 des Plans setzt voraus, dass `MCP_CONSULT_INSTRUCTIONS` den
`not-placed`-Satz behaelt, Kriterium 4 verlangt einen Basis-Block ohne Consult.**
Beides zugleich geht nur, wenn `MCP_CONSULT_INSTRUCTIONS` die **Komposition** ist
(Basis + Consult) und nicht der Consult-Block allein. **Aufloesung:** genau so gebaut
(Schritt 4a). Die Alternative — `MCP_CONSULT_INSTRUCTIONS` auf den Consult-Block
verkuerzen — haette Kriterium 3 und `test/mcp-fehlergrund-rueckweg.test.js:197`
(Wiederhol-Riegel, Geldpfad) gebrochen. Der Namens-Kompromiss ist bewusst: die Konstante
heisst nach dem **Fall**, in dem sie ausgeliefert wird, nicht nach ihrem letzten Absatz.

**UNKNOWN-1 — Ob OpenAIs realer Client die `instructions` ueberhaupt liest, und ob die
512-Zeichen-Grenze hart oder weich ist.** Grund: T-21 ist Kategorie **C**
(Empfehlung/"should", `tasks/openai-audit/00-openai-anforderungen.md:54`), und es gibt
keine Messung gegen einen echten ChatGPT-Host (D0-8 ist Owner-Sache, OW-4). Wir bauen
nach dem Wortlaut der Doku. Keine Auswirkung auf die Schritte.

**UNKNOWN-2 — Ob ein Tenant ohne Consult den Basis-Block ueberhaupt braucht.** Grund:
in Produktion ist `CONSULT_ENABLED` laut `render.yaml:424-425` **aus**, der Live-Wert ist
aber Dashboard-gepflegt und aus dem Repo nicht lesbar (P0, OWNER-Zeile O-6). Wenn er aus
ist, bekommt **jeder** Tenant nur den Basis-Block — dann ist Schritt 4b der Text, der
live wirkt, und nicht ein Randfall. Das erhoeht die Sorgfaltspflicht am Wortlaut, aendert
aber keinen Schritt.

---

## 4. Pre-Mortem — ein Jahr spaeter war P4 ein Fehler

1. **Das Host-Modell liest `isError` bei `get_transcript` als endgueltiges Scheitern und
   bricht den laufenden Anruf ab.** Der Anrufer wird mitten im Gespraech aufgelegt, weil
   ein Werkzeug "Fehler" sagte, das nur "noch nicht fertig" meinte.
   *Entschaerfung:* der Satz sagt woertlich, was zu tun ist —
   `"Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen."`
   (`src/i18n/mcp-texts.js:67`, EN `:141`, FR `:190`). Schritt 2 prueft den Wortlaut in
   **allen** Sprachfassungen, und erst durch Schritt 1 erreicht dieser Satz den Client
   ueberhaupt — heute sieht das Modell `Output validation error` und hat **gar keine**
   Handlungsanweisung. Das Risiko sinkt also, es steigt nicht.

2. **Der Basis-Block wird live wirksam und steuert 100 % der Anrufe, aber er wurde nur an
   der Doku entworfen, nie an einem echten Gespraech gemessen.** Wenn `CONSULT_ENABLED`
   in Produktion aus ist (UNKNOWN-2), ist der Basis-Block der einzige Instruktionstext,
   den jeder Host sieht — und der Satz "Never invent facts" koennte ein Modell dazu
   bringen, ein Briefing so duenn zu schreiben, dass der Agent am Telefon nichts weiss.
   *Entschaerfung:* der Satz ist die knappe Fassung einer Regel, die an der naeheren
   Stelle schon steht und dort gemessen ist (`src/mcp-tools.js:940`, "Write only what you
   KNOW: never script an answer for a detail you are missing") — er widerspricht ihr
   nicht, er wiederholt sie auf Server-Ebene. Die Lehre `call-quality-chain` (enge
   Anweisungen am Entscheidungspunkt wirken, breite kippen) sagt: die Wirkung kommt
   ohnehin aus der Werkzeugbeschreibung, der Instruktionstext ist der Rahmen.
   **Bewusst akzeptiertes Restrisiko**, mit einem Owner-Punkt im Abschlussbericht:
   wird der Consult-Kanal je live geschaltet, gehoert der kombinierte Text einmal durch
   `npm run convo-bench` (n>=5).

3. **`instructions` ist ab jetzt immer gesetzt — und irgendein Host stolpert darueber.**
   Ein Client, der bisher `undefined` bekam, sieht ploetzlich 305 bis 1283 Zeichen
   zusaetzlichen Kontext in **jedem** `initialize`. Bei Claude Desktop (stdio) ist das
   neu; bisher gab es dort strukturell nie Instruktionen.
   *Entschaerfung:* `instructions` ist ein Standardfeld der MCP-Initialization, kein
   Sonderweg; Schritt 6 Fall 5 spawnt den echten stdio-Prozess und belegt, dass er
   startet und antwortet. Der Start-Smoke (`echo "" | node src/mcp-server.js`) ist der
   zweite, unabhaengige Beleg. **Rollback-Regel** (Lehre
   `iel-inbound-elevenlabs-live`, "Prompt vor Code"): faellt Claude Desktop aus, wird
   zuerst der stdio-`consultLoop`/`instructions`-Zweig in `src/mcp-server.js:19-21`
   zurueckgedreht — eine Zeile, ohne `mcp-server-info.js` anzufassen.

4. **Die Regel aus Schritt 3 ist gruen und beweist nichts.** Jeder Szenario-Eintrag
   laeuft in den Fehlerpfad, jedes Ergebnis traegt `isError:true`, die Regel ist erfuellt
   — und niemand merkt, dass kein einziger Erfolgspfad je geprueft wurde. Genau das
   Muster aus der Lehre `pruefkommando-ohne-positiv-kontrolle`.
   *Entschaerfung:* der Erfolgslauf je Werkzeug ist **Pflichtbestandteil** des Tests
   (`isError !== true` UND `structuredContent` vorhanden), und der gezielte
   `get_transcript`-Lauf mit `status:"active"` faellt, sobald jemand Schritt 1 zurueckdreht.

5. **Ein elftes Werkzeug mit `outputSchema` kommt dazu und die Regel deckt es nicht.**
   Die Szenario-Tabelle ist handgepflegt; ein neues Werkzeug wuerde sie nicht kennen.
   *Entschaerfung:* die Pruefmenge entsteht aus der **gelieferten Registrierung**, und
   ein Werkzeug ohne Tabelleneintrag laesst den Test **rot** werden. Zusaetzlich pinnt
   Fall 2 die Zahl gegen `TOOLS_WITH_OUTPUT_SCHEMA` (`test/helpers.js:62`), die auch P2
   schon nutzt — eine Quelle, kein zweiter Zaehler.

6. **O-27 wurde als erledigt abgehakt, obwohl die zweite Fundstelle
   (`src/mcp-tools.js:940`) stehen blieb.** Bei der Einreichung faellt genau sie auf, und
   die Antwort "steht so im Plan" traegt nicht.
   *Entschaerfung:* Widerspruch W-3 benennt die Stelle mit `datei:zeile`, und der
   Abschlussbericht fuehrt sie als **offen**, nicht als erledigt. O-27 gilt erst mit
   Teil 2 (P5b) **und** einer Entscheidung zu W-3 als geschlossen.

7. **Der `startsWith`-Pin aus GQ-B1-05 wurde aufgeweicht, und sechs Monate spaeter hat
   jemand den Consult-Text beliebig umsortiert, weil "der Test ja nur `includes` sagt".**
   *Entschaerfung:* Fall 6 pinnt danach **vier Wirkungen** statt einer Position — das ist
   die staerkere, nicht die schwaechere Sicherung. Der Kommentar an GQ-B1-05 nennt T-21
   als Grund, damit der naechste Leser nicht auf "Pin wurde halt gelockert" schliesst.
