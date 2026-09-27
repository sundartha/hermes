# T2-11 - Ehrliche Werkzeug-Namen, Titel und Beschreibungen (Serverseite) - Bau-Spec

Stand: Planung 2026-09-24. Basis-Commit `6b3f9d1` (master, T2-01..T2-10 + T2-23 gemergt).
Worktree: `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-11`,
Branch `phase/openai-t2-11-honest-tool-names`. Diese Datei ist UNGETRACKT und bleibt es.

Umfang = GENAU die IDs N-12, N-13, N-11. Keine Produktionswerte, keine Secrets.

## Anforderungen (OpenAI-Fassung, `tasks/openai-audit/00-openai-anforderungen.md`)

- N-11: "Side effects should never be hidden or implicit." (app-guidelines)
- N-12: Tool-Namen eindeutig, Klartext, moeglichst Verb; "Avoid misleading, overly promotional, or comparative language".
- N-13: Beschreibungen bilden Verhalten exakt ab; kein Bevorzugen/Herabsetzen anderer Plugins; keine ueberbreite Ausloesung.

## Feste Vorgaben (Plan T2-11, kein Ermessen)

| heute | neu | Titel | invoking | invoked |
|---|---|---|---|---|
| `get_transcript` | `get_call_result` | "Get call result" | "Reading the call result" | "Call result read" |
| `get_my_number` | `get_agent_number` | "Agent phone number" (bleibt) | "Looking up the agent number" (bleibt) | "Agent number read" (bleibt) |

`get_calendar`, `allowCalendar` und alles unter `src/ui/**` bleiben unangetastet (T2-12).
Owner-Entscheidung 2026-09-22 (b): Umbenennung erlaubt, Breaking Change gewollt - KEIN Alias,
kein stilles Weiterleiten des alten Namens.

## Schritte

### S1 - Umbenennung `get_transcript` -> `get_call_result` (Registrierung, Titel, Statuszeilen)
- Wo: `src/mcp-tools.js:1504` (Registrierung + `TOOL_ANNOTATIONS.get_transcript` an :1508),
  `TOOL_ANNOTATIONS`-Schluessel + `title` an :876-881, `TOOL_INVOCATION_STATUS` an :945.
- Was: Schluessel/Name auf `get_call_result`; `title: "Get call result"`;
  `invoking: "Reading the call result"`, `invoked: "Call result read"`. Handler unveraendert.
  Interne Bezeichner `TRANSCRIPT_OUTPUT`/`pickTranscript` bleiben (s. "Nicht bauen").
- IDs: N-12, N-13. Pfade: HTTP /mcp (Legacy-Token und OAuth, mit/ohne Consult), No-Tenant-Stub-Pfad
  (`src/mcp-no-tenant.js:79`, erbt die Namen ueber `registerTools`), stdio (`src/mcp-server.js:35`).
- Beweis (b): neuer Test T11-a/T11-b (S8) am echten `tools/list`.

### S2 - Beschreibung `get_call_result` ehrlich und vollstaendig (N-13)
- Wo: `src/mcp-tools.js:1505-1507` (heute inline). Als Modulkonstante `CALL_RESULT_DESCRIPTION`
  auslagern (Muster `CANCEL_CALL_DESCRIPTION`, :783) - haelt `registerTools` klein (Lint-Pin, S9).
- Was: bestehender Wortlaut bleibt (inkl. des Satzes "This tool NEVER returns the raw transcript -
  whether the server keeps it afterwards on its own follows the diagnostic rule of place_call's
  diagnostic field and is independent of this response." - er wird woertlich in
  `docs/OPENAI-POLICY-ABGLEICH.md` zitiert und in `p15` mit `["NEVER"]` gepinnt). NEU: die Felder
  werden beim Namen genannt, weil die Antwort acht Felder traegt und die Beschreibung heute nur
  zwei nennt: z.B. "Returns call_id, result_summary, objective_achieved and the result card:
  outcome, commitments, counterparty_commitments, open_points, next_step." Kein
  Grossbuchstaben-Wort neu (p15-Emphase-Pin), "transcript" nur im Verneinungssatz.
- IDs: N-13. Pfade: wie S1.
- Beweis (b): T11-b (Verneinungssatz herausgeschnitten -> 0 Treffer `/transcript/i`) und T11-e2
  (jeder Schluessel aus `outputSchema.properties` von `get_call_result`, AM DRAHT gelesen, steht
  woertlich in der Beschreibung).

### S3 - Umbenennung `get_my_number` -> `get_agent_number`
- Wo: `src/mcp-tools.js:1568` (Registrierung, `TOOL_ANNOTATIONS.get_my_number` an :1571),
  `TOOL_ANNOTATIONS`-Schluessel :889, `TOOL_INVOCATION_STATUS` :951. Titel/Statuszeilen/Beschreibung
  ("Returns the phone number of the phone agent.") bleiben woertlich.
- Widget-Anhang `enableWidgetUi(WIDGET_MY_NUMBER)` bleibt - die Bindung laeuft ueber die
  Widget-Kennung `my-number` (`src/ui/widget-catalog.js:23,109`), nicht ueber den Toolnamen; die
  `_meta.ui.resourceUri` loest also weiter auf.
- IDs: N-12. Pfade: wie S1.
- Beweis (b): T11-a, T11-b (vier Texte enthalten `/agent/i`, keiner `/\bmy\b/i`), T11-r
  (resourceUri-Aufloesung, S8).

### S4 - Server-instructions und Beschreibungs-Querverweise
- Wo: `src/mcp-server-info.js:99` ("call get_transcript" -> "call get_call_result"), Kommentar
  :90-96 mitziehen; `src/mcp-tools.js:799` (`AWAIT_CALL_EVENT_DESCRIPTION`: "no need to call
  get_transcript separately" -> `get_call_result`).
- IDs: N-12, N-13. Pfade: HTTP /mcp (Basis- und Consult-instructions), stdio (`mcpServerOptions`,
  `src/mcp-server.js:27-30`, Consult aus).
- Beweis (b): T11-b2: `initialize.result.instructions` (HTTP mit und ohne Consult, stdio) enthaelt
  weder `get_transcript` noch `get_my_number`; Positiv-Kontrolle: enthaelt `get_call_result`.
  Kein sichtbarer Text irgendeines Tools (description, title, annotations.title, beide
  toolInvocation-Zeilen, alle `inputSchema.properties.*.description`) enthaelt die alten Namen.

### S5 - N-11: `answer_consult` nennt die Weitergabe an die Gegenseite
- Wo: `src/mcp-tools.js:1393-1394` (Ende der inline-Beschreibung). Als Modulkonstante
  `ANSWER_CONSULT_DESCRIPTION` auslagern (Lint-Pin, S9; `KEY_FACTS_LIMITS.maxLen` bleibt drin).
- Was: "...Answers reach the agent as background information only." wird zu
  "...Answers reach the agent as background information. The agent may relay your answer to the
  person on the call." Das "only" faellt, weil es der neuen, zutreffenden Aussage widerspraeche
  (der Agent spricht mit dem Hintergrundwissen weiter mit dem Angerufenen; Annotation schon
  `destructiveHint: true`/`openWorldHint: true`). Die p15-Emphase-Liste
  `["FIRST","THEN","SHORT","REJECTED","NOT"]` bleibt unveraendert gueltig.
- IDs: N-11. Pfade: nur HTTP /mcp MIT Consult (answer_consult ist auf stdio und ohne Consult nicht
  registriert - `src/mcp-server.js:23-26`).
- Beweis (b): T11-d: `tools/list` HTTP mit Consult (Legacy UND OAuth): Beschreibung enthaelt
  den Satz woertlich, und NICHT mehr "background information only".

### S6 - N-13: `get_agent_status` nennt jedes Feld seines outputSchema
- Wo: `src/mcp-tools.js:1727-1728` (heute "Status of the phone agent: phone number, monthly usage,
  permissions."). Als Modulkonstante `AGENT_STATUS_DESCRIPTION` auslagern.
- Was: Felder `number`, `owner`, `calls`, `planUsagePercent`, `permissions`
  (`AGENT_STATUS_OUTPUT`, :605-611) woertlich nennen, mit Bedeutung. Vorschlag:
  "Returns the status of the phone agent with these fields: number (the agent's phone number, or
  null), owner (the account owner's name, or null), calls (number of calls so far),
  planUsagePercent (share of the monthly minute quota used, in percent, or null if no quota is
  set), permissions (what the agent may share: summaries, personal data, bank data)."
  VOR dem Festschreiben am Code bestaetigen: `calls` = `usage.calls` des Tenant-Buckets
  (`src/routes/api-read.js:42`, Label "Calls bisher" in `src/i18n/mcp-texts.js:155`) - NICHT
  "this month" schreiben, solange kein Monats-Reset belegt ist (UNKNOWN, s.u.);
  `permissions` = `permissionsSummary` (:578-583). Kein Grossbuchstaben-Wort (p15 pinnt `[]`).
- IDs: N-13. Pfade: HTTP /mcp (alle), stdio.
- Beweis (b): T11-e: der Test liest `outputSchema.properties` von `get_agent_status` AM DRAHT und
  prueft jeden Schluessel woertlich in `description` (keine gepflegte Liste); Positiv-Kontrolle:
  Schluesselmenge nicht leer und enthaelt `planUsagePercent`.

### S7 - Kommentare und Doku ziehen mit (ausserhalb `src/ui/`)
- Kommentare in `src/`: `src/mcp-tools.js:223,257,543,613,657,822,1142,1495`;
  `src/mcp-server-info.js:90-96`; `src/store/json.js:664`; `src/store/state-ops.js:101,779,1169`;
  `src/elevenlabs/outbound.js:35,1056`; `src/conversation/conversation-ports.js:16`;
  `src/routes/_tenant.js:139`; `src/routes/api-read.js:61`; `src/routes/api-inbox.js:14`;
  `src/i18n/failure-reason-texts.js:99`. Nur Namen tauschen; stimmt der umgebende Satz dann nicht
  mehr, Satz korrigieren.
- Root-Doku/Konfig-Kommentare (vom Plan nicht genannt, vom grep gefunden): `README.md:124,150,152,189`,
  `ONBOARDING.md:40`, `PLAN-SECURITY.md:1174,1209`, `.env.example:932,1035`, `render.yaml:376`
  (NUR Kommentarzeile, kein Wert).
- `docs/OPENAI-TOOL-INVENTORY.md`: Tabelle A (Zeilen :36,:38) und maschinenlesbarer Block (:57,:59),
  Tabelle B (Prosatabelle UND Block :262-267, je K1..K6), Abschnitte :166 und :189 (Registrier-
  zeilen neu messen), Zitat :146-147 ("background information only" -> neuer Wortlaut). NEU:
  Tabelle "Renamed tools" (alter Name -> neuer Name, je ein Satz warum) - ohne interne Kennungen
  (keine Phasen-/ID-Kuerzel wie T2-11/N-12, keine Owner-Namen).
- `docs/OPENAI-POLICY-ABGLEICH.md`: Namen an :267,268,374,540,542,552,553 und im Block
  WERKZEUGZITAT (:892 `get_call_result | This tool NEVER returns the raw transcript`,
  :907 neues `get_agent_status`-Zitat, :908 `get_agent_number`); Absatz :549-554 und Luecke 14
  (:692-696) sind nach S6 erledigt -> Absatz neu fassen (Beschreibung nennt jetzt alle Felder,
  Zitat des neuen Wortlauts) und Luecke 14 entfernen bzw. als geschlossen umformulieren, dabei
  die Nummerierung konsistent halten. ALLE `src/mcp-tools.js:<zeile>`-Anker im ANKER-Block und im
  Fliesstext neu messen (Zeilen verschieben sich durch S2/S5/S6). Keine internen Kennungen.
- IDs: N-12, N-13. Pfade: -.
- Beweis (c): `grep -rn "get_transcript\|get_my_number" src scripts --exclude-dir=ui` -> 0 Zeilen;
  `grep -rn "get_transcript\|get_my_number" README.md ONBOARDING.md PLAN-SECURITY.md .env.example render.yaml`
  -> 0 Zeilen; `grep -n "get_transcript\|get_my_number" docs/OPENAI-*.md` -> Treffer NUR in der
  Tabelle "Renamed tools". Beweis (b): `test/openai-p10a-tool-inventar.test.js` und
  `test/openai-policy-abgleich-doku.test.js` gruen (beide messen am Draht bzw. an den Ankerzeilen).

### S8 - Neuer Test `test/openai-t2-werkzeugtexte.test.js` (Draht, kein Registrierungsobjekt)
Kindprozess `PORT=0`, Temp-`DATA_DIR` (Muster `test/openai-p10a-tool-inventar.test.js`); Pfade:
HTTP Legacy-Token ohne Consult, HTTP Legacy-Token mit Consult (`CONSULT_ENABLED=true`,
`ASSISTANT_CONTEXT_ENABLED=true`), HTTP OAuth mit Test-IdP (`startIdp`) mit und ohne Consult,
stdio-Kindprozess (`src/mcp-server.js`, `StdioClientTransport` + permissives Ergebnis-Schema
`z.object({tools: z.array(z.any())})`, sonst strippt der SDK-Client Felder). Testnamen OHNE
Katalog-/ABNAHME-Praefix.
- T11-a: je Pfad: `get_call_result` und `get_agent_number` vorhanden, `get_transcript`,
  `get_my_number` fehlen; Anzahl je Pfad unveraendert gegenueber Tabelle B vor der Phase
  (K1 12, K2 10, K3 9, K4 11, K5 9, K6 10 - `get_calendar` bleibt, wo er heute ist).
- T11-b: fuer `get_call_result`: `title`, `annotations.title`, `_meta["openai/toolInvocation/invoking"]`,
  `_meta["openai/toolInvocation/invoked"]` ohne `/transcript/i`; `description` nach Herausschneiden
  GENAU des Verneinungssatzes (beginnend "This tool NEVER returns the raw transcript", endend am
  naechsten ". ") ohne `/transcript/i` - Positiv-Kontrolle: vor dem Schnitt >= 1 Treffer. Fuer
  `get_agent_number`: dieselben vier Texte + `description` enthalten `/agent/i`, keiner `/\bmy\b/i`.
- T11-b2: kein sichtbarer Text irgendeines Tools und keine `initialize.result.instructions` (HTTP
  mit/ohne Consult, stdio) enthaelt `get_transcript`/`get_my_number`; Positiv-Kontrolle:
  instructions enthalten `get_call_result`.
- T11-d: S5. T11-e / T11-e2: S6 / S2.
- T11-f: `tools/call get_call_result` (geseedeter abgeschlossener Anruf, `seedState`) liefert
  `structuredContent` mit GENAU den Schluesseln von `outputSchema.properties` aus `tools/list`
  (call_id, result_summary, objective_achieved, outcome, commitments, counterparty_commitments,
  open_points, next_step); `tools/call get_transcript` liefert einen Fehler (JSON-RPC-Fehler ODER
  `isError: true`, beides akzeptiert), nie `structuredContent` - der Breaking Change ist belegt.
- T11-r: jede `_meta.ui.resourceUri` aus `tools/list` (HTTP Legacy, OAuth, stdio, mit
  `MCP_UI_ENABLED` an) steht in `resources/list` und liefert per `resources/read` Inhalt; Positiv-
  Kontrolle: `get_agent_number` traegt eine resourceUri. (Das ist "Widget-Verweise loesen auf".)
- T11-n: Namen und Titel am Draht enthalten keines von `/\b(best|official|pick_me|recommended)\b/i`
  (N-12, nur Namen/Titel - Beschreibungen tragen legitim "the best offer" in `place_call`).
- Server hinterher beenden, mit `ps` pruefen (pgrep ist blind).

### S9 - Bestehende Tests nachziehen + Lint-Pin
Tests, die den ALTEN Namen aufrufen/erwarten (brechen sonst):
`test/mcp-tool-annotations.test.js:35,48` (Schluessel), `test/p15-mcp-tool-descriptions-en.test.js:111,112,119`
(Schluessel `get_call_result`, `get_call_result.call_id`, `get_agent_number`),
`test/mcp-tools.test.js:152,175`, `test/mcp-tools-i18n.test.js:119`,
`test/mcp-tools-language.test.js:378-389`, `test/mcp-ui.test.js:408-509,1033-1075`,
`test/mcp-ui-i18n-divergence.test.js:103`, `test/openai-t2-09-neutrale-fehlertexte.test.js:578`,
`test/al-p11-result-card.test.js:293,329`, `test/openai-p4-ergebnisstruktur-instructions.test.js`
(:57-404, u.a. Regex `/call get_transcript/` -> `/call get_call_result/`),
`test/openai-p5b-geldpfad.test.js:251-252` (Positiv-Kontrolle auf den neuen Namen),
`test/am6-oauth-tenant.test.js`, `test/e4-mandantentrennung-default.test.js:234`,
`test/request-tenant.test.js:93,117`, `test/openai-t2-05-reauth-challenge.test.js:284-401`,
`test/openai-p8-widget-ui.test.js:459-577`, `test/openai-t2-01-widget-resource-meta.test.js:68-72`,
`test/elevenlabs-anrufstart.test.js:593-657`. Nur-Kommentar: `a8-abschluss-zusammenfassung`,
`mcp-fehlergrund-rueckweg`, `read-scope-tenant`, `el-fixtures-echte-antworten`,
`elevenlabs-data-collection`. Doku-gebunden: `openai-p10a-tool-inventar`, `openai-policy-abgleich-doku`.
NICHT anfassen: `test/mcp-ui-w1-call-widget.test.js` (prueft das Widget isoliert gegen
"get_transcript", gehoert zu T2-12; bleibt gruen).
- Lint: `eslint-legacy-exceptions.json` pinnt `registerTools` auf "(494)" Zeilen (Schluessel
  enthaelt die Zahl). Durch S2/S5/S6 (Auslagerung) schrumpft `registerTools`; der Pin wird mit
  der GEMESSENEN kleineren Zahl korrigiert (`npx eslint --suppressions-location
  eslint-suppressions.empty.json src/mcp-tools.js --format json` bzw. der findings-Block von
  `scripts/check-staged-suppressions.js`), Begruendung im bestehenden reason-Feld anhaengen
  ("ZAHL KORRIGIERT ..."). NIE anheben; waechst die Zahl, weiter auslagern. Keine
  Mehrfach-Anweisungen je Zeile.
- Beweis (b)+(c): `npm test -- -- --test-concurrency=4 > <log> 2>&1`, nur `# pass`/`# fail`
  zaehlen; jeder rote Test isoliert nachpruefen
  (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`). Baseline vor der
  Phase: siehe Abschnitt "Baseline". `npx eslint src/mcp-tools.js src/mcp-server-info.js` sauber.
  `node --check` auf jede geaenderte Datei.

## Nicht bauen (mit Grund)
- Alles unter `src/ui/**` (Call-Widget-Konstante `TOOL_GET_TRANSCRIPT`, My-Number-Beschriftung,
  Hash-Pins): Plan-Grenze, T2-12. Folge: am Zwischenstand ruft die Anruf-Karte nach Abschluss
  `get_transcript` und bekommt einen Fehler -> Ergebnis erscheint nicht in der Karte (Text-Tool
  `get_call_result` fuer das Modell funktioniert). Nie ohne T2-12 deployen.
- `get_calendar` / `allowCalendar` / Kalender-Karte: T2-12.
- `design-system/mcp/my-number.html`, `design-system/_ds_manifest.json` (Spiegel des Widgets,
  nennen `get_my_number`): Widget-Haelfte, T2-12 (dessen grep (e) deckt `design-system/` nicht ab -
  s. Widersprueche).
- `apps/web/src/components/HermesDemo.astro:39,69`: Website nur ueber das Labor, T2-19.
- `place_call`-Beschreibungen: an convo-bench kalibriert; N-11/N-12/N-13 verlangen hier nichts
  (Name ist Verb, Seiteneffekt "Starts a real phone call" steht schon drin). Nicht angefasst.
- `get_call_status`-Beschreibung ("the last transcript lines"): zutreffend, liefert
  `last_transcript_lines` (`src/mcp-tools.js:199`).
- Interne Bezeichner `TRANSCRIPT_OUTPUT`, `pickTranscript`, `pickMyNumber`, `MY_NUMBER_OUTPUT`:
  fuer Modell/Nutzer unsichtbar, N-12 verlangt nichts; `pickTranscript` wird ausserdem in
  `src/ui/widgets/call.html:603` und drei Tests zitiert - eine Umbenennung waere Churn ueber die
  Phasengrenze.
- Kein Alias fuer die alten Namen: Owner-Entscheidung (b) + Plan-Abnahme (f) verlangen den Fehler.
- `.claude/workflows/runs/*`, `tasks/**`: Prozesshistorie, nicht Produkt.
- Keine neue Env-Variable.

## Pre-Mortem (ein Jahr spaeter war T2-11 ein Fehler)
1. Reviewer sieht im Bestaetigungsdialog weiter "Reading the call transcript" -> Ablehnung nach
   N-13, obwohl Namen stimmten. Entschaerft: T11-b liest ALLE sichtbaren Texte vom Draht.
2. instructions nennen weiter `get_transcript`; nach einem "not-placed" ruft das Modell ein
   unbekanntes Tool, der Nutzer erfaehrt den Fehlergrund nie und das Modell waehlt womoeglich neu
   (echte Anbieterkosten). Entschaerft: S4 + T11-b2 mit Positiv-Kontrolle; `p5b-geldpfad`
   Positiv-Kontrolle auf neuen Namen.
3. Owner deployt T2-11 ohne T2-12: Anruf-Karte zeigt nach Anrufende nie ein Ergebnis. Entschaerft:
   Deploy-Vorbedingung (owner_punkte), Gegenprobe T2-12 (d) ist am Zwischenstand rot.
4. Nach Deploy haben bestehende Claude-/ChatGPT-Verbindungen eine gecachte Toolliste und rufen
   `get_transcript`/`get_my_number` -> Fehler. Keine echten Nutzer (Owner-Entscheidung);
   entschaerft durch OW-A (Connector neu verbinden).
5. `get_my_number`-Umbenennung reisst die Widget-Bindung ab (Karte der Agentennummer verschwindet)
   oder aendert still die Tool-Menge eines Profils. Entschaerft: Bindung laeuft ueber
   `WIDGET_MY_NUMBER` (belegt), T11-r und T11-a messen resourceUri-Aufloesung und Anzahl je Pfad.
6. Auth-/Tenant-Tests (am6, e4, request-tenant, t2-05) werden beim Umbenennen "gruen gebogen",
   indem Assertions gelockert werden -> Mandantentrennung/Re-Auth-Challenge nicht mehr bewiesen.
   Entschaerft: in diesen Tests NUR den Toolnamen tauschen, keine Assertion aendern; Review
   prueft per `git diff` dieser Dateien, dass nur Namens-Tokens wechseln.
7. Die neue `get_agent_status`-Beschreibung behauptet "this month" fuer `calls`, das Feld ist aber
   ein Lebenszeit-Zaehler -> neue N-13-Unwahrheit. Entschaerft: S6 verlangt Beleg am Code, sonst
   neutral "so far".
8. N-11-Satz macht das Modell zurueckhaltender beim Beantworten -> Agent bleibt ohne Antwort,
   Anruf wird schlechter. Akzeptiert: der Satz ist wahr und von OpenAI gefordert; Verhalten des
   Consult-Loops steht in den instructions, nicht in diesem Satz.
Kein Pfad dieser Phase beruehrt Safety-Gates, Offenlegungssatz, Kostendecke oder Signaturpruefung
(nur Metadaten-Strings und Namen; Handler unveraendert). Kein Anruf, keine SMS, kein Prod-Zugriff.

## Owner-Punkte (nur Deploy/Push und Live-Proben)
- Deploy NUR zusammen mit T2-12 (beide gemergt). Erwartet: Anruf-Karte zeigt nach Anrufende das
  Ergebnis; `tools/list` des Live-Servers nennt `get_call_result`/`get_agent_number`.
- Nach dem Deploy (OW-A): eigenen Claude-Connector (und ChatGPT Developer Mode) neu verbinden.
  Erwartet: Werkzeugliste zeigt `get_call_result` und `get_agent_number`, nicht mehr
  `get_transcript`/`get_my_number`; Bestaetigungsdialog fuer `get_call_result` zeigt
  "Reading the call result".

## Widersprueche Plan <-> Code
- Plan-Zeilenangaben stammen von Basis `288376b` und sind verschoben: Titel `get_transcript`
  :682 -> real :876-881; Statuszeilen :750 -> :945 (und :756 -> :951); `_meta`-Schluessel
  :737-738,785 -> :932-933 und `withOpenAiToolMetadata` :977-988; Registrierung get_transcript
  :1276/1280/1292-1294 -> :1504-1522; get_my_number :1340-1362 -> :1568-1590; `TRANSCRIPT_OUTPUT`
  :243-248 -> :259; Karten-Fragment :220-228 -> :223-257; answer_consult :630 -> :1382-1394.
  Inhalt an den neuen Stellen wie im Plan beschrieben.
- Plan-Testliste unvollstaendig: es fehlen `am6-oauth-tenant`, `e4-mandantentrennung-default`,
  `request-tenant`, `openai-t2-05-reauth-challenge`, `openai-p8-widget-ui`,
  `openai-t2-01-widget-resource-meta`, `openai-t2-09-neutrale-fehlertexte`, `mcp-ui`,
  `mcp-ui-i18n-divergence`, `mcp-tools-language`, `mcp-tools-i18n`, `openai-policy-abgleich-doku`
  (alle rufen/zitieren die alten Namen, brechen sonst).
- Plan-Dateiliste unvollstaendig: `docs/OPENAI-POLICY-ABGLEICH.md` (zitiert Werkzeugtexte woertlich
  und fuehrt 66 `src/mcp-tools.js`-Zeilenanker - verschieben sich zwangslaeufig; Luecke 14 wird
  durch S6 geschlossen), `README.md`, `ONBOARDING.md`, `PLAN-SECURITY.md`, `.env.example`,
  `render.yaml` (Kommentare).
- Lint-Pin: `registerTools` ist mit exakter Zeilenzahl "(494)" gepinnt; jede Laengenaenderung
  bricht Lint. Plan erwaehnt das nicht -> S9.
- Lead-Notiz "Widget-Verweise loesen auf" vs. Plan "nach T2-11 ruft das Call-Widget noch
  get_transcript": gelesen als `_meta.ui.resourceUri` loest in `resources/list` auf (T11-r). Die
  Laufzeit-Referenz der Anruf-Karte auf `get_transcript` bleibt am Zwischenstand kaputt
  (plan-gewollt, Deploy-Gate). Soll auch sie am Zwischenstand aufloesen, muesste T2-11 die eine
  Konstante in `src/ui/widgets/call.html:231` aendern (neuer Hash-Pin, T2-02-Tests) - das
  widerspraeche der Plan-Grenze "beruehrt src/ui/** NICHT". Entscheidung Lead.
- T2-12-Abnahme (e) greppt nur `src scripts`; `design-system/mcp/my-number.html` und
  `design-system/_ds_manifest.json` nennen `get_my_number` und fallen dort durch das Raster.
- UNKNOWN: ob `usage.calls` monatlich zurueckgesetzt wird (Label "Calls bisher" spricht fuer
  Lebenszeit) - Bau-Agent belegt am Store vor dem Wortlaut (S6).

## Baseline
`npm test -- -- --test-concurrency=4` auf `6b3f9d1` im Worktree: `# tests 6385`, `# pass 6385`,
`# fail 0` (Log `.../scratchpad/logs-t2-11/baseline.log`). Nach der Phase: `# fail 0` und
`# pass` = 6385 + Zahl der neuen T11-Tests (keine Tests loeschen).
