# P5a — Datenminimierung im Output, rein subtraktiv (Spec)

Stand: 2026-09-21. Grundlage: `tasks/PLAN-OPENAI-TECHNIK.md` (Abschnitt P5a, Zeilen 530-581),
`tasks/openai-p0-entscheidungen.md`, `tasks/openai-audit/00-openai-anforderungen.md:108-109`.
Massgeblich ist die OpenAI-Fassung der Anforderungen, NICHT `00-mcp-spec.md`.

**IDs.** O-13 Teil 1 (`voiceEngine` + LLM-Modell-ID aus dem Tool-Output), Kommentar-Praezisierung
ueber `pickCallStatus`; dazu O-14 als **Nachweis ohne Code** (so der Plan; der Kickoff-Auftrag
nennt O-14 nicht — aufgeloest in Abschnitt "Widersprueche", Punkt 4).

**Was diese Phase NICHT ist.** Kein Geldpfad (`failure_reason` → P5b), kein tenant-sichtbarer
Hinweistext (`consultPermissionHint` → P5b), kein Instruktionstext (→ P4, gemergt), keine
Auth-, CORS- oder Live-Verhaltens-Aenderung. Rein subtraktiv: es verschwinden Felder, es
entsteht kein neues Verhalten, kein Schalter, kein Env.

---

## 0. Ist-Stand, selbst am Code nachgesehen (nicht aus dem Plan abgeschrieben)

Die zwei Felder `voiceEngine` und `model` stehen an **sieben** Stellen, nicht an zwei:

| # | Stelle | Was dort steht |
|---|---|---|
| 1 | `src/mcp-tools.js:385-386` | `voiceEngine: s.agent.voiceEngine,` / `model: s.agent.model,` in `pickAgentStatus` |
| 2 | `src/mcp-tools.js:401-402` | `voiceEngine: z.string(),` / `model: z.string(),` in `AGENT_STATUS_OUTPUT` |
| 3 | `src/mcp-tools.js:1500` | Stufe-0-Textblock: `` `${A.voiceEngine}: ${data.voiceEngine}\n${A.model}: ${data.model}\n` `` |
| 4 | `src/mcp-tools.js:1483` | Tool-Beschreibung: "Status of the phone agent: phone number, **voice engine, model**, monthly usage, permissions." |
| 5 | `src/i18n/mcp-texts.js:102-103` (de), `:158-159` (en), `:209-210` (fr) | die Labels `agentStatus.voiceEngine` / `agentStatus.model` |
| 6 | `src/ui/widgets/agent-status.html:47-48` | zwei Widget-Zeilen mit `data-mcp="voiceEngine"` / `data-mcp="model"` |
| 7 | `src/ui/widget-i18n.js:37-38` (de), `:78-79` (fr) | die Widget-Chrome-Labels `"Voice engine"` / `"Model"` |

Quelle der Werte ist `src/routes/api-read.js:92-93` (`model: config.llm.claudeModel`,
`voiceEngine: config.voice.voiceEngine`) — die REST-Innenkante, die **bleibt** (Abschnitt 2).

Bestehende Pins, die brechen werden (gemessen, nicht vermutet):

- `test/mcp-ui.test.js:776-790` — `AGENT_KEYS` (Schluesselliste, `deepEqual` bei `:812`) und die
  lokale Zod-Kopie `agentStatusOutput`.
- `test/mcp-tools-language.test.js:284` — Schleife ueber `agentStatus`-Labels inkl.
  `"voiceEngine"`, `"model"`.

Baseline dieser drei Dateien heute gruen gefahren:
`NODE_ENV=test node --test --test-concurrency=4 test/mcp-ui.test.js test/mcp-tools-language.test.js test/mcp-ui-widget-i18n.test.js`
→ `tests 92 / pass 92 / fail 0` (2026-09-21).

Nicht betroffen, geprueft:
- `test/mcp-ui-widget-i18n.test.js:112` (`T-i18n-keys-covered`) prueft nur Markup → Dict, nicht
  umgekehrt; die Menge faellt von 32 auf 30 Markup-Keys und bleibt weit ueber der Schwelle
  `used.size >= 20` (`:118`). Gemessen mit einem Nachbau der Extraktion.
- `test/mcp-ui-widget-i18n.test.js:79` (`T-i18n-parity`) bleibt gruen, weil der Key in **beiden**
  Tabellen (`de`, `fr`; `en` hat bewusst keine) faellt.
- `test/p15-mcp-tool-descriptions-en.test.js:130` (`get_agent_status: []`) pinnt nur
  Grossschreib-Marker — die gekuerzte Beschreibung traegt weiterhin keine.
- `test/mcp-tool-annotations.test.js:79-83` pinnt Titel/Hints, nicht die Beschreibung.
- `TOOLS_WITH_OUTPUT_SCHEMA = 10` (`test/helpers.js:62`) bleibt unveraendert: das Schema geht
  nicht weg, es schrumpft.

---

## 1. Arbeitsschritte

Reihenfolge ist bindend: 1-3 gehoeren in **einen** Commit (Schema, Pick und Text duerfen nie
auseinanderfallen — das ist das Plan-Pre-Mortem). 4-7 und 8-10 danach.

### Schritt 1 — `pickAgentStatus` entkernen
- **Datei:** `src/mcp-tools.js:385-386`
- **Was:** beide Zeilen ersatzlos loeschen. Sonst nichts an der Funktion.
- **IDs:** O-13 Teil 1
- **Pfade:** HTTP `/mcp`, stdio, mcp-nativ, ChatGPT (eine `registerTools()`, eine Whitelist)
- **Beweis:** `grep -c "voiceEngine" src/mcp-tools.js` → nach Schritt 2 `0`; der tragende Beweis
  ist Schritt 9 (HTTP-Antwort), nicht dieser grep.

### Schritt 2 — `AGENT_STATUS_OUTPUT` entkernen
- **Datei:** `src/mcp-tools.js:401-402`
- **Was:** `voiceEngine: z.string(),` und `model: z.string(),` ersatzlos loeschen.
- **IDs:** O-13 Teil 1
- **Pfade:** HTTP `/mcp`, stdio (`tools/list`-Deskriptor + SDK-Ausgabevalidierung)
- **Beweis:** Schritt 9, Fall B/C: `tools/list` liefert fuer `get_agent_status` ein
  `outputSchema`, dessen `properties` weder `voiceEngine` noch `model` enthaelt, waehrend
  `number` weiter da ist (Positiv-Kontrolle).

### Schritt 3 — Stufe-0-Textblock kuerzen
- **Datei:** `src/mcp-tools.js:1500`
- **Was:** die Zeile `` `${A.voiceEngine}: ${data.voiceEngine}\n${A.model}: ${data.model}\n` + ``
  ersatzlos loeschen. Die Zeilen darueber/darunter (`number`/`owner`, `calls`) bleiben
  byte-identisch.
- **IDs:** O-13 Teil 1
- **Pfade:** alle vier (der Textblock ist der Backward-Compat-Kanal jedes Hosts)
- **Warum zwingend:** ohne diesen Schritt liest der Text `data.voiceEngine` = `undefined` und
  der Chat zeigt "Voice-Engine: undefined". Der Plan nennt diese Stelle nicht (Widerspruch 1).
- **Beweis:** Schritt 9, Fall A und B: der Text der `get_agent_status`-Antwort enthaelt weder
  `undefined` noch das Label aus `MCP_TEXTS.de.agentStatus` (das es dann nicht mehr gibt) noch
  den Wert des Upstream-Feldes; `Agent-Nummer:` und `Berechtigungen:` sind weiter da.

### Schritt 4 — Tool-Beschreibung wahrheitsfaehig machen
- **Datei:** `src/mcp-tools.js:1483`
- **Was:** `"Status of the phone agent: phone number, voice engine, model, monthly usage, permissions."`
  → `"Status of the phone agent: phone number, monthly usage, permissions."`
  Englisch bleibt englisch (O14-Systemgrenze, `test/p15-mcp-tool-descriptions-en.test.js`).
- **IDs:** O-13 Teil 1 (mittelbar N-3/N-4: eine Beschreibung, die Felder verspricht, die das
  Werkzeug nicht liefert, ist eine Falschangabe gegenueber dem Reviewer und dem Host-Modell)
- **Pfade:** HTTP `/mcp`, stdio (die Beschreibung steht im `tools/list`-Deskriptor beider)
- **Beweis:** Schritt 9, Fall D: die aus `tools/list` gelesene Beschreibung von
  `get_agent_status` enthaelt weder `voice engine` noch `model` (case-insensitiv), aber
  weiterhin `phone number` (Positiv-Kontrolle).

### Schritt 5 — Labels aus `MCP_TEXTS` entfernen
- **Datei:** `src/i18n/mcp-texts.js:102-103` (de), `:158-159` (en), `:209-210` (fr)
- **Was:** `voiceEngine`- und `model`-Eintrag in **allen drei** `agentStatus`-Tabellen loeschen.
  Mit-zu-aendern im selben Commit: `test/mcp-tools-language.test.js:284` — `"voiceEngine"` und
  `"model"` aus der Pflichtschluessel-Liste nehmen.
- **IDs:** O-13 Teil 1 (Folgeschritt; unterlassen = toter Code, CLAUDE.md hart verboten)
- **Pfade:** alle vier (die Labels speisen nur den Textblock aus Schritt 3)
- **Beweis:** `grep -c "voiceEngine" src/i18n/mcp-texts.js` → `0`; `grep -n "model:" src/i18n/mcp-texts.js`
  → keine Zeile innerhalb eines `agentStatus`-Blocks. Dazu gruen:
  `NODE_ENV=test node --test --test-concurrency=4 test/mcp-tools-language.test.js`
  (`MCP_TEXTS ist fuer jede unterstuetzte Sprache vollstaendig`, `:252`).

### Schritt 6 — Widget-Zeilen entfernen
- **Datei:** `src/ui/widgets/agent-status.html:47-48`
- **Was:** beide `<div class="row">` ersatzlos loeschen.
- **IDs:** O-13 Teil 1 (Folgeschritt)
- **Pfade:** mcp-nativ **und** ChatGPT — beide Adapter liefern dasselbe Widget-HTML
  (`src/ui/contract.js:87-104`: nur `mimeType` und die `_meta`-Form unterscheiden sich).
- **Warum zwingend:** die Slots wuerden nie mehr gefuellt; das Widget zeigte dauerhaft zwei
  Zeilen mit `—`. Genau dieses Widget ist Einreichungsflaeche.
- **Beweis:** `grep -c 'data-mcp="voiceEngine"\|data-mcp="model"' src/ui/widgets/agent-status.html`
  → `0`; `grep -c 'data-mcp="planUsagePercent"' …` → `1` (Positiv-Kontrolle, dass die Datei nicht
  versehentlich leergeraeumt wurde). Dazu gruen: `test/mcp-ui.test.js` (`T-W3-AC6`).

### Schritt 7 — Widget-Chrome-Labels entfernen
- **Datei:** `src/ui/widget-i18n.js:37-38` (de), `:78-79` (fr)
- **Was:** die Keys `"Voice engine"` und `"Model"` in **beiden** Sprachtabellen loeschen
  (`en` hat keine Tabelle — die Keys sind dort der Text).
- **IDs:** O-13 Teil 1 (Folgeschritt; sonst toter Wortschatz)
- **Pfade:** mcp-nativ, ChatGPT
- **Beweis:** `grep -c '"Voice engine"\|"Model"' src/ui/widget-i18n.js` → `0`; dazu gruen:
  `NODE_ENV=test node --test --test-concurrency=4 test/mcp-ui-widget-i18n.test.js`
  (`T-i18n-parity` + `T-i18n-keys-covered` decken beide Richtungen des Schnitts ab, die der
  Schnitt beruehrt).

### Schritt 8 — Bestandspin nachziehen und in eine Positiv-Kontrolle drehen
- **Datei:** `test/mcp-ui.test.js:776-790` (Liste `AGENT_KEYS`, Zod-Kopie `agentStatusOutput`)
  und `:792-818` (`T-W3-AC1`)
- **Was:** (a) `"model"` und `"voiceEngine"` aus `AGENT_KEYS` nehmen, die zwei Zod-Zeilen
  loeschen. (b) `RICH_STATE` (`:742-746`) behaelt `voiceEngine`/`model` **unveraendert** — sie
  werden damit zu Kanarienvoegeln wie `secretAgentField`. (c) In `T-W3-AC1` zwei Zusicherungen
  ergaenzen: `structuredContent` traegt keinen der beiden Schluessel, und der Textblock enthaelt
  weder `"budget"` noch `"claude-haiku"` (die Fixture-Werte).
- **IDs:** O-13 Teil 1
- **Pfade:** in-process (beide Adapter ueber `captureUi`)
- **Warum so:** der Pin zu loeschen waere Testabbau; ihn umzudrehen macht aus dem alten
  Kontrakt den Beweis fuer den neuen — der Upstream-Body liefert die Felder weiter, die
  Whitelist wirft sie weg.
- **Beweis:** `NODE_ENV=test node --test --test-concurrency=4 test/mcp-ui.test.js` gruen, und
  `T-W3-AC1` faellt rot, wenn man Schritt 1 zurueckdreht (vom Umsetzer einmal gegenzuprobieren
  und im Report zu nennen).

### Schritt 9 — Neuer Test: der echte Ausgang, ueber HTTP `/mcp`
- **Datei (neu):** `test/openai-p5a-datenminimierung.test.js`
- **Was:** vier Faelle. Harness wie `test/openai-p4-ergebnisstruktur-instructions.test.js`
  (`startServer`, `mcpPost`, `toolCall`, `readToolResult`, `BASE_ENV` aus `test/helpers.js`).
  - **Fall A (in-process, Whitelist-Wirkung):** Gateway-Mock liefert einen `/api/state`-Body
    **mit** `agent.voiceEngine` und `agent.model`; `get_agent_status` liefert
    `structuredContent` ohne beide Schluessel, und der Textblock enthaelt keinen der beiden
    Werte. Positiv-Kontrolle: `number` und `permissions` sind da.
  - **Fall B (HTTP `/mcp`, echter Serverprozess):** `tools/call get_agent_status` gegen einen
    gespawnten Server. Der Upstream `/api/state` traegt die Felder real
    (`src/routes/api-read.js:92-93`), die MCP-Antwort darf sie nicht tragen. Zusaetzlich:
    `tools/list` → der `get_agent_status`-Deskriptor hat `outputSchema.properties` ohne
    `voiceEngine`/`model`, aber mit `number` (Positiv-Kontrolle), und `required` nennt keinen
    der beiden.
  - **Fall C (stdio, DP-1):** derselbe `tools/list`-Test ueber den echten stdio-Kindprozess
    (`StdioClientTransport`, Muster `openai-p4-…:273-311`).
  - **Fall D (Beschreibung):** die Beschreibung aus dem **`tools/list`-Ausgang** (nicht aus dem
    Registrierungsobjekt) enthaelt `voice engine`/`model` nicht mehr, `phone number` schon.
- **IDs:** O-13 Teil 1
- **Pfade:** HTTP `/mcp` (A/B/D), stdio (C), mcp-nativ + ChatGPT (der gepruefte
  `structuredContent` entsteht vor der Adapter-Wahl, `src/ui/contract.js:87-104`)
- **Warum ueber `tools/list`/`tools/call` und nicht ueber das Registrierungsobjekt:**
  `registerTool()` verwirft unbekannte Felder **still** (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:703`);
  ein Test am Registrierungsobjekt belegt deshalb nichts ueber den ausgelieferten Deskriptor.
  Der Deskriptor wird im ListTools-Handler neu gebaut (`…/mcp.js:67-96`, `outputSchema` bei
  `:88-95`) und von `src/mcp-security-schemes.js:50` nur angereichert, nicht ersetzt.
- **Beweis:** `NODE_ENV=test node --test --test-concurrency=4 test/openai-p5a-datenminimierung.test.js`
  → `# fail 0`, alle vier Faelle gruen.

### Schritt 10 — Kommentar-Praezisierung ueber `pickCallStatus`
- **Datei:** `src/mcp-tools.js:160-163` (der Block direkt ueber `function pickCallStatus`, `:164`)
- **Was:** den Block um eine Aussage ergaenzen, die (a) das Wort `last_transcript_lines`
  woertlich nennt, (b) sagt, dass dieses eine Feld **woertliche Zeilen der Gegenseite** traegt,
  (c) klarstellt, dass die Aussage darueber ueber FELDER geht und nicht ueber den INHALT dieses
  Feldes, und (d) den Punkt als bewusst offenen Befund markiert. Deutsch, ohne Umlaute.
  Der Satz ist **selbsttragend** zu formulieren — kein Verweis auf `tasks/PLAN-OPENAI-TECHNIK.md`
  (die Datei wird nach dem Merge der Kette aufgeraeumt, CLAUDE.md; ein Zeiger darauf waere
  binnen Tagen tot).
- **IDs:** Kommentar-Praezisierung (Plan-Abnahmekriterium 2)
- **Pfade:** keine (reiner Kommentar, kein Verhalten)
- **Beweis:** `grep -B8 "^function pickCallStatus" src/mcp-tools.js | grep -c "last_transcript_lines"`
  → `1` (zeilenzahl-robust, anders als ein `sed -n '160,163p'`). **Kein Test** — ein Test, der
  einen Kommentarwortlaut pinnt, pinnt kein Verhalten und macht jede spaetere Umformulierung zur
  falschen Regression.

### Schritt 11 — O-14: Nachweis statt Aenderung (kein Code)
- **Datei:** `tasks/openai-p5a-report.md` (Abschlussbericht der Phase)
- **Was:** die vier Whitelist-Funktionen mit `datei:zeile` nennen —
  `pickCallStatus` (`src/mcp-tools.js:164`), `pickTranscript` (`:206`),
  `pickAgentStatus` (`:381`), `pickCall` (`:421`) — und festhalten: es sind Positivlisten, kein
  Feld daraus traegt PCI-DSS-Daten, PHI, staatliche Identifikatoren oder Zugangsdaten. **Mit der
  ausdruecklichen Einschraenkung**, dass `last_transcript_lines` woertliche Gegenrede
  durchreicht und O-14 deshalb fuer selbst erzeugte Daten erfuellt, fuer woertliche Gegenrede
  aber **nicht abschliessend** ist. Ein Satz "O-14 vollstaendig erfuellt" gilt als nicht
  erfuellt.
- **IDs:** O-14
- **Pfade:** alle vier (Aussage ueber die geteilten Filter)
- **Beweis:** der Bericht nennt die vier Stellen; ein fremder Pruefer oeffnet
  `src/mcp-tools.js` an genau diesen Zeilen und sieht vier Objekt-Literale mit fester
  Feldliste. Gegenprobe des Pruefers: `grep -n "\.\.\.c\b\|\.\.\.s\b\|Object.assign" src/mcp-tools.js`
  findet keinen Spread des Upstream-Objekts in eine dieser Funktionen.

### Schritt 12 — Gesamtlauf
- **Datei:** —
- **Was:** `npm test -- -- --test-concurrency=4` (nur der **doppelte** `--`-Trenner kommt an).
- **IDs:** alle dieser Phase
- **Pfade:** alle
- **Beweis:** `# fail 0` und `# pass` >= Grundlinie. Grundlinie master: 6195 Faelle, 6194 gruen
  (ein bekannter Flake, isoliert gruen). Der Exit-Code zaehlt NICHT. Ausgabe vollstaendig
  aufheben, nie abschneiden. Ein roter Test zaehlt erst, wenn er **isoliert** erneut rot ist
  (`NODE_ENV=test node --test <datei>`). Erwartete Netto-Bewegung: Schritt 9 bringt vier Faelle
  hinzu, Schritt 8 aendert bestehende Faelle, ohne ihre Zahl zu aendern.

---

## 2. Was in dieser Phase NICHT gebaut wird

1. **`/api/state` bleibt unveraendert** (`src/routes/api-read.js:92-93`). Grund: das ist die
   Innenkante hinter der Tenant-Sitzung, nicht der Tool-Output an den Host — O-13 adressiert
   Tool-Antworten. Zugleich ist das der Kanal, ueber den ein Betreiber die Information weiter
   sehen kann; genau deshalb ist ihr Verlust im Tool tragbar. **Offener Befund fuer den
   Bericht:** nach P5a liest diese zwei Felder produktiv niemand mehr (`grep -rn voiceEngine apps/`
   → 0 Treffer); es bleiben `test/api-read-parity.test.js:105/:183` und
   `test/read-scope-tenant.test.js:168`. Das aufzuloesen heisst, einen REST-Kontrakt zu aendern —
   eigene Entscheidung, nicht Nebenwirkung einer Minimierungsphase.
2. **`last_transcript_lines` bleibt** (`src/mcp-tools.js:169-171`). Live-Konsument belegt:
   `src/ui/widgets/call.html` bindet und rendert das Feld; waehrend eines laufenden Anrufs gibt
   es keine Zusammenfassung als Ersatz (`src/mcp-tools.js:190-191`, `AWAIT_SUMMARY_PLACEHOLDER`,
   gelesen in `pickTranscript`, `:206-213`).
   Schliessen heisst: entschaerften Ersatz bauen **und** das Widget im selben Commit umstellen —
   eigene Phase mit Live-Probe. O-13 bleibt danach **teilweise** erfuellt.
3. **`failure_reason` und `consultPermissionHint`** — P5b, Geldpfad und tenant-sichtbarer Text,
   mit eigener Gegenprobe. Hier wird keine Zeile davon angefasst.
4. **Kein neues Env, kein Flag, keine Migration.** Die Aenderung ist subtraktiv; ein Schalter
   haette zwei Wahrheiten erzeugt und braeuchte vier Orte (`config.js`, `.env.example`,
   `render.yaml`, `BASE_ENV`).
5. **`config.voice.voiceEngine` und das Boot-Banner** (`src/boot.js:901`) bleiben. Das ist
   Betriebswahrheit im Serverlog, kein Kundentool.
6. **Kein Test, der den Kommentarwortlaut pinnt** (Begruendung in Schritt 10).
7. **Keine Aenderung an der Widget-Bind-Logik.** Es fallen zwei Markup-Zeilen weg, mehr nicht;
   das generische W1-Binding bleibt unberuehrt.

---

## 3. Pre-Mortem — ein Jahr spaeter war P5a ein Fehler

1. **"Output validation error" neu erzeugt.** Jemand entfernt die Felder aus `pickAgentStatus`,
   nicht aus `AGENT_STATUS_OUTPUT` (oder umgekehrt). Das Zod-Schema verlangt zwei Felder, die
   `structuredContent` nicht traegt; der SDK-Validator wirft, `get_agent_status` liefert die
   Systemmeldung statt der Antwort — exakt der Defekt T-19, den P4 gerade behoben hat.
   *Entschaerfung:* Schritt 1-3 in einem Commit; Schritt 9 Fall B prueft am echten
   HTTP-`tools/call`, nicht an der Pick-Funktion.
2. **"Voice-Engine: undefined" im Chat.** Schema und Pick sind sauber, der Textblock `:1500`
   bleibt stehen und liest `data.voiceEngine`. Der Reviewer sieht im Screenshot das Wort
   `undefined`. *Entschaerfung:* Schritt 3 ist ein eigener, benannter Schritt, und Fall A/B
   pruefen den Text, nicht nur `structuredContent`.
3. **Der Einreichungs-Screenshot zeigt ein kaputtes Widget.** Die Markup-Zeilen bleiben, die
   Slots sind leer, das Agent-Status-Widget zeigt zwei Zeilen `—`. *Entschaerfung:* Schritt 6
   mit eigenem grep-Beweis inkl. Positiv-Kontrolle.
4. **Nur HTTP geprueft, stdio vergessen.** Genau dort ist der letzte Anlauf auseinandergegangen
   (DP-1). Claude Desktop laeuft ueber stdio und liefert weiter das alte Schema, weil niemand
   hinsah. *Entschaerfung:* Schritt 9 Fall C faehrt den echten Kindprozess.
5. **Die Beschreibung luegt weiter.** `voice engine, model` bleibt in `:1483` stehen; das
   Host-Modell ruft das Werkzeug fuer eine Frage, die es nicht mehr beantworten kann, und der
   Reviewer liest eine Falschangabe in `tools/list` — in einer Phase, deren Zweck
   Wahrhaftigkeit ist. *Entschaerfung:* Schritt 4 + Fall D.
6. **Tote Woerter bleiben liegen.** `MCP_TEXTS.*.agentStatus.voiceEngine` und die
   `WIDGET_DICT`-Keys ueberleben, weil kein Test sie einfordert (die Drift-Gates pruefen nur
   Markup → Dict). Der naechste Clean-Code-Audit meldet toten Code, den diese Phase erzeugt hat.
   *Entschaerfung:* Schritte 5 und 7 mit `grep -c … → 0`.
7. **Betriebsdiagnose verloren.** Es faellt auf, dass niemand mehr im Chat sieht, welches
   LLM laeuft — ausgerechnet nachdem der Anbieter gewechselt wurde. *Bewusst akzeptiert und
   entschaerft:* `/api/state` behaelt die Felder (Abschnitt 2, Punkt 1), das Boot-Banner
   ebenfalls. Zusatzargument fuer das Entfernen statt Pflegen: der ausgelieferte Wert kommt aus
   `config.llm.claudeModel` (`src/config.js:531`, gespeist nur aus `CLAUDE_MODEL`), waehrend die
   Anbieterwahl an `config.llm.llmProvider` haengt (`:514`) — bei `LLM_PROVIDER=deepseek` haette
   das Tool schon heute einen falschen Modellnamen behauptet. Ein Feld, das falsch sein kann und
   das niemand pflegt, ist schlechter als kein Feld.
8. **Der Kommentar zeigt ins Leere.** Der neue Satz verweist auf `PLAN-OPENAI-TECHNIK.md`; die
   Datei wird nach dem Merge der Kette aufgeraeumt (CLAUDE.md), der Verweis ist tot, und der
   naechste Leser haelt den Befund fuer erledigt. *Entschaerfung:* Schritt 10 verlangt
   ausdruecklich einen selbsttragenden Wortlaut ohne Dateiverweis.
9. **Die Phase wurde fuer erledigt erklaert, obwohl O-13 offen ist.** Der Schlussagent zaehlt
   O-13 als "done", weil P5a und P5b gruen sind — `last_transcript_lines` faellt unter den
   Tisch, und die Einreichung behauptet Datenminimierung, die es nicht gibt.
   *Entschaerfung:* Schritt 11 verlangt den Einschraenkungssatz woertlich im Bericht; O-13 gilt
   nach P5a/P5b als **teilweise** erfuellt.

---

## 4. Widersprueche zwischen Plan, P0 und Code

1. **Die Dateiliste des Plans ist unvollstaendig.** P5a nennt `src/mcp-tools.js`
   (`pickAgentStatus`, `AGENT_STATUS_OUTPUT`, Kommentarblock) und `test/mcp-tools.test.js`.
   Am Code liegen dieselben zwei Felder an fuenf weiteren Stellen (Abschnitt 0, Zeilen 3-7),
   und der brechende Bestandspin liegt in **`test/mcp-ui.test.js:776-790`**, nicht in
   `test/mcp-tools.test.js` (dort kommt `get_agent_status` nur im Guard-Test `:105-110` vor,
   ohne Feldliste). *Aufloesung:* Schritte 3-8; die Schrittliste ist der Massstab, nicht die
   Plan-Dateiliste.
2. **Der Plan formuliert die Aenderung als abgeschlossen** ("Die Felder verschwinden aus
   `pickAgentStatus` **und** aus `AGENT_STATUS_OUTPUT`"). Am Code ist sie das nicht: `:1500`
   liest `data.voiceEngine`/`data.model` weiter. Das Plan-Pre-Mortem beschreibt denselben
   Fehlertyp nur fuer die Schema-Seite, nicht fuer die Text-Seite. *Aufloesung:* Schritt 3 mit
   eigenem Beweis, Pre-Mortem-Punkt 2.
3. **Abnahmekriterium 1 des Plans greift zu kurz.** `grep -c "voiceEngine" src/mcp-tools.js` und
   `grep -c "agent.model" src/mcp-tools.js` treffen die Prosa der Tool-Beschreibung (`:1483`,
   "voice engine, model") nicht — beide greps waeren `0`, waehrend `tools/list` weiter zwei
   Felder verspricht. Heute gemessen: `voiceEngine` = 2 Treffer (`:385`, `:401`), `agent.model`
   = 1 Treffer (`:386`). *Aufloesung:* Fall D in Schritt 9 als zusaetzlicher, fremd-pruefbarer
   Beweis.
4. **Der Kickoff-Auftrag nennt O-14 nicht, der Plan schon** (dort: "Nachweis statt Aenderung").
   *Aufloesung:* O-14 bleibt in der Phase, aber ausschliesslich als Bericht-Schritt ohne Code
   (Schritt 11) — damit bleibt die Phase rein subtraktiv und der Plan-Abnahmepunkt 3 erfuellt.
5. **P0 sagt zu P5a nichts.** `grep -n "P5a\|O-13\|O-14\|voiceEngine" tasks/openai-p0-entscheidungen.md`
   → 0 Treffer. Es gibt also keinen P0-Befund, der den P5a-Plan aendert; die P0-Baseline wirkt
   nur als Handwerksregel und ist eingearbeitet: doppelter `--`-Trenner (Schritt 12), Exit-Code
   ignorieren (Schritt 12), `registerTool()` verwirft still → Beweis ueber `tools/list`
   (Schritt 9), DP-1 HTTP + stdio (Fall B/C), DP-2 ueber die geteilte `structuredContent`-Quelle.
6. **Der Kickoff-Vorwurf "falscher Kommentar bei `:163`" bleibt widerlegt** — am Code
   nachgesehen: `:163` lautet "Kein Secret/Identitaet/Audio/Cross-Tenant-Feld passiert diese
   Funktion" (Aussage ueber FELDER, wahr), und der Satz ueber das Roh-Transkript steht bei
   `:193-195` im Kontrakt von `get_transcript`, wo er korrekt ist. Das deckt sich mit P0
   Abschnitt 0. Irrefuehrend ist nur das Nebeneinander — Schritt 10 praezisiert genau das.
   *Zeilenangaben des Plans nachgeprueft:* `:160-163` (Kommentarblock), `:164-173`
   (`pickCallStatus`), `:193-195` (Roh-Transkript-Satz), `:385-386` (`pickAgentStatus`) stimmen
   alle unveraendert — der Plan ist hier trotz P4 nicht verdriftet.
7. **`registerTool` vs. Testpin.** `test/mcp-ui.test.js:795` prueft `config.outputSchema` am
   Registrierungsobjekt. Nach der Betriebslehre beweist das nichts ueber den ausgelieferten
   Deskriptor. Der Pin bleibt (er ist kein Schaden), traegt aber die Beweislast nicht; sie liegt
   bei Schritt 9.
