# MCP - MCP-Schicht und Widgets in claude.ai

Bereich: Tool-Definitionen, Fehlermeldungen, Rueckgabetexte (Text + structuredContent)
und Widget-i18n fuer die 8 MCP-Tools (`place_call`, `get_call_status`, `get_transcript`,
`cancel_call`, `get_my_number`, `list_calls`, `list_action_items`, `get_calendar`,
`get_agent_status` - neun, `list_action_items` wurde im Recon mitgezaehlt) und die
5 Widgets (`call.html`, `agent-status.html`, `my-number.html`, `calls.html`,
`calendar.html`).

Der Recon-Befund wurde stichprobenartig (deutlich mehr als die geforderten 3-5 Belege,
siehe unten) am echten Code nachvollzogen. Alle geprueften Zeilenangaben stimmten;
keine Korrektur noetig. Eine zusaetzliche, im Recon nicht erwaehnte Tatsache kam beim
Nachvollziehen hinzu: `src/i18n/locales.js` traegt pro Sprachbuendel bereits ein
`dateLocale`-Feld (de -> "de-DE", fr -> "fr-FR", en -> "en-GB") und `src/claude.js:43`
nutzt es bereits fuer `toLocaleString` - `src/mcp-tools.js:48-55` (fmt) ignoriert dieses
existierende Feld und haengt stattdessen fest an `"de-DE"`. Der Fix-Pfad existiert also
bereits im Code, wird von der MCP-Schicht nur nicht benutzt. Zusaetzlich faellt auf:
selbst ein korrekter Fix wuerde fuer `language="en"` auf `dateLocale="en-GB"` abbilden
(DD/MM, nicht das in den USA erwartete MM/DD) - es gibt kein separates `en-US`-Buendel.

Gepruefte Stichproben (Beleg-Verifikation, nicht erschoepfend):
- `src/mcp-tools.js` komplett gelesen (717 Zeilen) - alle vom Recon zitierten Zeilen
  (48-55, 65-79, 108-110, 194-199, 307-310, 339-342, 365-467, 529-530, 545-546,
  580-581, 596, 623-624, 641-651, 662, 690-691, 707-710) stimmen exakt.
- `src/routes/mcp.js` komplett gelesen (112 Zeilen) - Zeilen 51 und 85-90 bestaetigt:
  `registerTools()` bekommt `identity`, `scopedTenant`, `allowCalendar`, `uiHost` - kein
  Sprach-/Locale-Parameter.
- `src/ui/widget-i18n.js` komplett gelesen (175 Zeilen) - Zeile 20 (`DEFAULT_LOCALE = "en"`),
  Zeilen 26-103 (`WIDGET_DICT` de/fr), Zeilen 124-129 (`translate`), Zeile 161
  (`resolveLocale([navigator.language], WIDGET_DICT)`) bestaetigt.
- `src/ui/widgets/agent-status.html` komplett gelesen (67 Zeilen) - Zeile 55 ist exakt
  die Permissions-Zeile (`data-mcp="permissions"`).
- `src/config.js:362` (`paymentCurrency` Default `"eur"`) und `:369` (`providerCurrency`
  Default `"USD"`) bestaetigt.
- `src/claude.js:665` (`localeFor(call.language).summarySystem(owner)`) bestaetigt -
  einzige MCP-nahe Stelle, an der die Anrufsprache tatsaechlich wirkt (liegt aber
  ausserhalb von `mcp-tools.js`).
- `test/mcp-ui.test.js:682` (`PERMISSIONS_STR = "Summaries=true, PersoenlicheDaten=false,
  Bankdaten=false"`) bestaetigt - byte-genauer Pin auf deutsche Feldnamen.
- `test/mcp-ui-widget-i18n.test.js` komplett gelesen (116 Zeilen, 6 Tests) - deckt
  ausschliesslich `widget-i18n.js` ab, keine Zeile prueft `mcp-tools.js`-Text,
  Datumsformat oder Waehrungslabel. `grep -n "language" test/mcp-ui.test.js
  test/mcp-tools.test.js` lieferte 0 Treffer - bestaetigt den Recon-Befund, dass keine
  bestehende Datei die Sprachdimension prueft.
- `src/mcp-server-info.js` komplett gelesen (66 Zeilen) - tatsaechlich keine
  lokalisierungsbeduerftigen Strings (name/version/websiteUrl/icons), kein Gap.
- `src/store/state-ops.js:648-651` (`resolveCallLanguage`, Praezedenz
  settings.language > number.language > tenant.defaultLanguage > DEFAULT_LANGUAGE) und
  `src/i18n/locales.js:260` (`SUPPORTED_LANGUAGES`), `:268-279` (`LANGUAGE_FOR_COUNTRY`,
  KEIN "US"-Eintrag -> faellt auf DE zurueck), `:285-286` (`localeFor`, fail-safe DE)
  bestaetigt.
- `src/ui/widget-bind.js:99-118` (`applyField`/`bind`, kein `translate()`-Aufruf) und
  `src/ui/widgets/calls.html:50` (`data-mcp-row="direction,counterparty,status,
  startedAt,summary"`, rohe Tokens) bestaetigt.
- `render.yaml:186-187` setzt `PAYMENT_CURRENCY: "eur"` explizit (Blueprint-Absicht);
  `.env.example:231` ebenfalls `eur` als Default. Der TATSAECHLICHE Live-Wert ist damit
  NICHT bewiesen (Render-Dienste sind laut Team-Gedaechtnis Dashboard-managed,
  Blueprint != Live) - das bleibt eine offene operative Pruefung (siehe MCP-19).

## Ist-Stand (belegt)

- Alle 9 Tool-Beschreibungen und deren Parameter-`.describe()`-Texte sind hart Deutsch,
  ohne jede Sprachverzweigung (`src/mcp-tools.js:365-467` place_call,
  `:529-530` get_call_status, `:545-546` get_transcript, `:580-581` cancel_call,
  `:596` get_my_number, `:623-624` list_calls, `:641` list_action_items, `:662`
  get_calendar, `:690-691` get_agent_status).
- `registerTools(server, ctx)` kennt `identity`/`scopedTenant`/`allowCalendar`/`uiHost`,
  aber keinen `language`/`locale`-Parameter (`src/mcp-tools.js:307-310`). Der Aufrufer
  `src/routes/mcp.js:85-90` reicht trotz aufgeloestem `scopedTenant` (Zeile 51) keine
  Sprache durch. Kein Aufruf von `resolveCallLanguage`/`localeFor` in `mcp-tools.js`
  oder `routes/mcp.js` (grep bestaetigt 0 Treffer).
- Generische Fehlermeldungen sind fest Deutsch und werden 1:1 als `isError`-Text an den
  claude.ai-Chat gereicht: `requireFields` (`src/mcp-tools.js:65-67`, `:77-79`),
  `wrapHandler`-Catch-all (`:339-342`).
- Transkriptzeilen in `get_call_status`/`place_call` tragen das feste deutsche
  Sprecher-Label `"Gegenseite"` (`src/mcp-tools.js:108-110`), unabhaengig von
  Tenant-Sprache oder Widget-UI-Sprache.
- `list_calls`/`get_calendar` formatieren Datum/Zeit serverseitig fest mit
  `toLocaleString("de-DE", ...)` (`src/mcp-tools.js:48-55`) - obwohl `dateLocale` pro
  Sprache bereits existiert (`src/i18n/locales.js:98,170,219`) und anderswo im
  selben Modul-Baum schon so verwendet wird (`src/claude.js:43`).
- `get_agent_status` zeigt Kosten/Budget immer mit Label `"EUR"`, Text
  (`src/mcp-tools.js:707-710`) UND Widget-i18n-Keys (`src/ui/widget-i18n.js:40-44`),
  unabhaengig von `config.billing.paymentCurrency` (Default `"eur"`,
  `src/config.js:362`; render.yaml setzt ihn explizit auf `"eur"`, `render.yaml:186-187`)
  waehrend die Web-Preise laut CLAUDE.md/Team-Gedaechtnis in USD stehen.
- `permissionsSummary()` erzeugt einen String mit deutschen Feldnamen
  (`"PersoenlicheDaten"`, `"Bankdaten"`, `src/mcp-tools.js:194-199`), sichtbar in der
  agent-status-Widget-Zeile `"Permissions"` (`src/ui/widgets/agent-status.html:55`,
  `data-mcp="permissions"`) und byte-genau als Sollzustand gepinnt
  (`test/mcp-ui.test.js:682`).
- `list_action_items` ist komplett unlokalisiert und ohne outputSchema/Widget
  (`src/mcp-tools.js:641-651`).
- `widget-i18n.js` loest die Widget-Sprache ausschliesslich aus `navigator.language`
  des Host-Browsers auf (`src/ui/widget-i18n.js:161`), NICHT aus
  Tenant-/Anruf-Sprache. Deckt en (Default/eingebauter Fallback, Zeile 20) + de + fr ab
  (Zeilen 26-103); fehlender Key/Sprache faellt fail-safe auf den englischen Key selbst
  zurueck (Zeilen 124-129).
- Statische Markup-Labels (`data-i18n`) werden uebersetzt; die rohen dynamischen
  Datenwerte aus `structuredContent` (Status-Tokens, `direction`, `counterparty`)
  laufen NICHT durch `widget-i18n` - `widget-bind.js:99-118` bindet sie per
  `textContent` ohne `translate()`. Einzige Ausnahme: `call.html` uebersetzt
  Status/Failure-Reason/Objective manuell ueber `window.HermesI18n.t()`
  (`src/ui/widgets/call.html:300-341`, `:413-427`).
- Die tatsaechliche Gespraechs-Zusammenfassung (`c.summary`, die `get_transcript`
  unveraendert durchreicht, `src/mcp-tools.js:132-140`) WIRD sprachabhaengig erzeugt -
  aber ausserhalb von `mcp-tools.js`, in `src/claude.js:665`
  (`localeFor(call.language).summarySystem(owner)`). Das ist die einzige MCP-nahe
  Stelle, an der die Tenant-Sprache tatsaechlich greift.
- Kein bestehender Test in `test/mcp-tools.test.js`, `test/mcp-ui.test.js` oder
  `test/mcp-ui-widget-i18n.test.js` prueft ein englisches/US-Szenario (grep nach
  `"language"` in den ersten beiden Dateien: 0 Treffer; die dritte Datei deckt nur
  `widget-i18n.js`, nicht `mcp-tools.js`).
- Nachrichtlich, kein Gap dieser Dimension: `src/mcp-server-info.js` (keine
  lokalisierungsbeduerftigen Strings) und `src/ui/contract.js`/`src/ui/registry.js`
  (reine Protokoll-/Host-Logik, keine Nutzertexte).

## Luecken

| Luecke | Schaden | Beleg | Schwere |
| --- | --- | --- | --- |
| Alle Tool-/Parameter-Beschreibungen fest Deutsch, kein language-Parameter in registerTools | Claude bekommt bei JEDEM Tool-Aufruf deutschen Kontext; US-Nutzer, die Tool-Details einsehen, verstehen sie eingeschraenkt | mcp-tools.js:365-467, :307-310; routes/mcp.js:85-90 | S1 |
| Generische Fehlermeldungen (requireFields, wrapHandler) fest Deutsch, direkt im Chat sichtbar | US-Nutzer sieht bei jedem Gateway-Ausfall/Timeout eine deutsche Fehlermeldung mitten im englischen Chat | mcp-tools.js:65-67, :77-79, :339-342 | S1 |
| "Gegenseite:"-Praefix in jeder Transkriptzeile, unabhaengig von Sprache | Deutsches Wort mitten in sonst englischer Live-Karte bei JEDEM laufenden Anruf - sofort sichtbarer Bruch | mcp-tools.js:108-110 | S1 |
| list_calls/get_calendar formatieren Datum/Zeit fest de-DE, obwohl dateLocale je Sprache existiert und anderswo genutzt wird | US-Nutzer sieht TT.MM./24h statt MM/DD/AM-PM in Anrufliste und Kalender | mcp-tools.js:48-55; locales.js:98,170,219; claude.js:43 | S2 |
| get_agent_status zeigt Kosten/Budget immer als "EUR" (Text + Widget-Key), unabhaengig von paymentCurrency | US-Kunde sieht fremde Waehrung bei seiner eigenen Kosten-/Budgetanzeige; render.yaml setzt paymentCurrency selbst explizit auf eur | mcp-tools.js:707-710; widget-i18n.js:40-44; config.js:362; render.yaml:186-187 | S1 |
| permissionsSummary() liefert deutsche Feldnamen (PersoenlicheDaten/Bankdaten), byte-gepinnt als Sollzustand | US-Kunde sieht in sonst englischer Karte ploetzlich deutsche Feldnamen; jede Korrektur muss den bestehenden Test bewusst mit-aendern | mcp-tools.js:194-199; agent-status.html:55; mcp-ui.test.js:682 | S1 |
| list_action_items komplett unlokalisiert (Beschreibung, Leertext, Praefix), kein outputSchema/Widget | US-Nutzer, die das Tool nutzen, bekommen durchgehend deutsche Ausgabe ohne jede Uebersetzungsmoeglichkeit | mcp-tools.js:641-651 | S2 |
| Dynamische Werte in calls.html/calendar.html laufen nicht durch widget-i18n (nur call.html tut das) | Architektonischer Fleck: inkonsistentes Muster, fuer DE/FR-Nutzer bleiben diese Tokens dauerhaft Englisch | widget-bind.js:99-118; widgets/calls.html:50 | S3 |
| Kein Test verifiziert, dass ein EN-/US-Tenant tatsaechlich englische MCP-Ausgabe bekommt | Regressionen oder der jetzige Ist-Zustand fallen in der Suite gruen durch; niemand kann sich vor Launch verifizieren | mcp-tools.test.js:83-260; mcp-ui.test.js:682; mcp-ui-widget-i18n.test.js:1-116 (grep language: 0 Treffer) | S1 |
| widget-i18n.js voellig entkoppelt von Tenant-/Anruf-Sprache (nur navigator.language) | Architektonischer Bruch zwischen Anruf-Sprachachse und Widget-Sprachachse, nirgends dokumentiert/getestet | widget-i18n.js:161; state-ops.js:648-651 | S3 |

## Tests

### MCP-01 - place_call Tool-Beschreibung und Parameter-Describe-Texte sind fest Deutsch
- **Prioritaet**: P1
- **Modus**: offline (node:test)
- **Vorbedingung**: keine (Tool-Metadaten sind statisch, unabhaengig von jedem Tenant/Request)
- **Schritte**:
  1. `registerTools(fakeServer, { scopedTenant: "tenant-en-us", allowCalendar: true })` ueber den `captureUi`-Harness aus `test/mcp-ui.test.js:55-71` aufrufen (fakeServer faengt `registerTool`-Configs ein).
  2. `tools.get("place_call").config.description` sowie alle `inputSchema`-Feld-`.describe()`-Texte (to/objective/briefing/constraints/mandate/context/language/max_duration_s/diagnostic) einsammeln.
  3. Pruefen, ob die Texte deutsche Stoppwoerter (`/\b(der|die|das|einen|und|nicht|wird|liefert|frage)\b/i`) enthalten.
- **Erwartetes Ergebnis**: Fuer einen als `en`/US konfigurierten Tenant sollten die Beschreibungen KEINE deutschen Stoppwoerter enthalten (englische oder sprachneutrale Ausgabe). Deterministisch pruefbar: Trefferzahl der Regex-Matches == 0.
- **Verifikation**: Neue Datei `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-01`; `node --test test/mcp-tools-i18n.test.js`.
- **Heute erwartbar**: rot - `description`/`.describe()` sind byte-identisch fuer jeden `scopedTenant`-Wert, die Regex trifft mehrfach (z.B. "Startet einen echten Telefonanruf...", mcp-tools.js:366).
- **Belegt durch**: src/mcp-tools.js:365-467 (place_call description + alle Parameter-describe())

### MCP-02 - Alle uebrigen 8 Tool-Beschreibungen sind fest Deutsch
- **Prioritaet**: P1
- **Modus**: offline (node:test)
- **Vorbedingung**: keine
- **Schritte**:
  1. `captureUi`/`captureTools` mit `scopedTenant="tenant-en-us"` aufrufen.
  2. Fuer jedes der 8 Tools (get_call_status, get_transcript, cancel_call, get_my_number, list_calls, list_action_items, get_calendar, get_agent_status) `desc`/`config.description` einsammeln.
  3. Denselben Deutsch-Stoppwort-Regex-Test wie MCP-01 anwenden.
- **Erwartetes Ergebnis**: 0 Treffer je Tool fuer einen EN-Tenant.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-02`; `node --test test/mcp-tools-i18n.test.js`.
- **Heute erwartbar**: rot - z.B. "Bricht einen laufenden Anruf sauber ab." (cancel_call, mcp-tools.js:581) und "Zeigt die naechsten Kalendereintraege des Besitzers." (get_calendar, mcp-tools.js:662) sind unveraendert Deutsch.
- **Belegt durch**: src/mcp-tools.js:529-530, :545-546, :580-581, :596, :623-624, :641, :662, :690-691

### MCP-03 - registerTools() hat keinen language/locale-Parameter (Regressions-/Fix-Waechter)
- **Prioritaet**: P1
- **Modus**: offline (node:test bzw. grep)
- **Vorbedingung**: keine
- **Schritte**:
  1. `registerTools.length` bzw. die destrukturierten Keys der zweiten Funktions-Parameter pruefen (Quelltext-Introspektion oder direkter Aufruf mit `{ language: "en" }` und Beobachtung, ob sich irgendein Tool-Text aendert).
  2. `grep -n "resolveCallLanguage\|localeFor" src/mcp-tools.js src/routes/mcp.js` ausfuehren.
- **Erwartetes Ergebnis**: Nach einem Fix sollte `registerTools` einen `language`/`locale`-Wert entgegennehmen UND mindestens eine der beiden Funktionen (`resolveCallLanguage`/`localeFor`) referenzieren. Deterministisch: grep-Trefferzahl > 0.
- **Verifikation**: `grep -n "resolveCallLanguage\|localeFor" src/mcp-tools.js src/routes/mcp.js | wc -l` (erwartet > 0 nach Fix).
- **Heute erwartbar**: rot - der grep liefert heute 0 Treffer in beiden Dateien (verifiziert), `registerTools`-Signatur ist `{ identity, scopedTenant, allowCalendar, uiHost }` ohne Sprachfeld.
- **Belegt durch**: src/mcp-tools.js:307-310; src/routes/mcp.js:51, :85-90

### MCP-04 - requireFields-Fehlermeldungen sind fest Deutsch und laufen 1:1 in den Chat
- **Prioritaet**: P0
- **Modus**: offline (node:test, erweitert bestehendes Muster)
- **Vorbedingung**: Gateway-Mock liefert einen degradierten Body (leer -> `api()` degradiert zu `{}`), analog `test/mcp-tools.test.js:83-114` (T-P4-06), aber mit `scopedTenant`/Settings, die einen EN-Tenant simulieren.
- **Schritte**:
  1. `startGatewayMock({ body: null })` wie in `test/mcp-tools.test.js:61-64`.
  2. `captureTools({ identity: null, scopedTenant: "tenant-en-us", allowCalendar: true })`.
  3. `handlers.get("get_calendar")()` aufrufen, `result.isError` und `toolText(result)` pruefen.
- **Erwartetes Ergebnis**: Fuer einen EN-Tenant sollte die Fehlermeldung NICHT den deutschen Text "Der Telefon-Agent hat keine gueltige Antwort geliefert. Bitte spaeter erneut versuchen." enthalten, sondern eine englische Entsprechung. Deterministisch: `assert.doesNotMatch(text, /gueltige Antwort geliefert/)`.
- **Verifikation**: Erweiterung von `test/mcp-tools.test.js` (Testfall `T-MCP-i18n-04`, direkt neben T-P4-06) oder `test/mcp-tools-i18n.test.js`; `node --test test/mcp-tools.test.js`.
- **Heute erwartbar**: rot - `requireFields` wirft unabhaengig von `scopedTenant` immer exakt den deutschen String.
- **Belegt durch**: src/mcp-tools.js:63-82 (requireFields), :65-67, :77-79

### MCP-05 - wrapHandler-Catch-Fallback bei Netzwerkfehler ist fest Deutsch
- **Prioritaet**: P0
- **Modus**: offline (node:test, simuliert Verbindungsabbruch)
- **Vorbedingung**: `GATEWAY_URL` zeigt auf einen Port ohne lauschenden Server (ECONNREFUSED), `scopedTenant` simuliert einen EN-Tenant.
- **Schritte**:
  1. `process.env.GATEWAY_URL = "http://127.0.0.1:1"` (kein Server) setzen.
  2. `captureTools({ scopedTenant: "tenant-en-us" })`, `handlers.get("get_my_number")()` aufrufen.
  3. `toolText(result)` pruefen.
- **Erwartetes Ergebnis**: Fuer einen EN-Tenant sollte der Text NICHT "Der Telefon-Agent ist momentan nicht erreichbar. Bitte spaeter erneut versuchen." lauten, sondern eine englische Entsprechung; `result.isError === true` bleibt in jedem Fall wahr.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-05`; `node --test test/mcp-tools-i18n.test.js`.
- **Heute erwartbar**: rot - `wrapHandler` faengt den `fetch`-Wurf und gibt unabhaengig vom Tenant den fest verdrahteten deutschen Fallback-Text zurueck.
- **Belegt durch**: src/mcp-tools.js:333-344 (wrapHandler), :339-342

### MCP-06 - "Gegenseite:"-Praefix in Transkriptzeilen ist sprachunabhaengig hart Deutsch
- **Prioritaet**: P0
- **Modus**: offline (node:test, erweitert RICH_CALL-Fixture)
- **Vorbedingung**: Gateway-Mock liefert `RICH_CALL` (wie `test/mcp-ui.test.js:75-88`, Transkript mit Rolle `"callee"`), `scopedTenant`/Settings simulieren einen EN-Tenant (`settings.language = "en"`).
- **Schritte**:
  1. `withGateway(RICH_CALL, ...)` mit `captureUi({ scopedTenant: "tenant-en-us", ... })`.
  2. `get_call_status`-Handler mit `call_id` aufrufen.
  3. `structuredContent.last_transcript_lines` inspizieren.
- **Erwartetes Ergebnis**: Bei `settings.language = "en"` sollte keine Zeile das Wort `"Gegenseite"` enthalten (z.B. `"Counterparty:"` oder `"Other:"` erwartet). Deterministisch: `assert.ok(!lines.some(l => l.includes("Gegenseite")))`.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-06`; `node --test test/mcp-tools-i18n.test.js`.
- **Heute erwartbar**: rot - `pickCallStatus` haengt das Label fest an `t.role === "agent" ? "Agent" : "Gegenseite"`, unabhaengig von jedem Sprachfeld (nicht mal gelesen).
- **Belegt durch**: src/mcp-tools.js:103-115 (pickCallStatus), :108-110

### MCP-07 - Datum/Zeit in list_calls/get_calendar ignorieren das existierende dateLocale-Feld
- **Prioritaet**: P1
- **Modus**: offline (node:test)
- **Vorbedingung**: Gateway-Mock liefert `calls`/`calendar` mit fixem ISO-Datum (z.B. `"2026-07-22T14:30:00.000Z"`), `scopedTenant`-Settings simulieren `language = "en"`.
- **Schritte**:
  1. `withGateway({ calls: [{ id: "c1", direction: "outbound", to: "+1...", status: "completed", startedAt: "2026-07-22T14:30:00.000Z" }] }, ...)`.
  2. `list_calls`-Handler aufrufen, `structuredContent.calls[0].startedAt` pruefen.
- **Erwartetes Ergebnis**: Bei `language = "en"` sollte `startedAt` NICHT das deutsche Wochentagskuerzel-Muster (`/^(Mo|Di|Mi|Do|Fr|Sa|So)\./`) tragen, sondern ein englisches Format (`loc.dateLocale = "en-GB"`, also z.B. `"Wed, 22/07, 14:30"`-artig). Deterministisch: `assert.doesNotMatch(startedAt, /^(Mo|Di|Mi|Do|Fr|Sa|So)\./)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-07`; `node --test test/mcp-tools-i18n.test.js`. Hinweis fuer die Implementierung des Fixes: `loc.dateLocale` existiert bereits (`src/i18n/locales.js:98,170,219`) und wird in `src/claude.js:43` bereits fuer denselben Zweck (`toLocaleString`) verwendet - keine neue Infrastruktur noetig, nur `fmt()` in mcp-tools.js muss sie konsumieren.
- **Heute erwartbar**: rot - `fmt()` ruft immer `new Date(iso).toLocaleString("de-DE", ...)`, unabhaengig von jedem Sprachfeld.
- **Belegt durch**: src/mcp-tools.js:48-55 (fmt); src/i18n/locales.js:98,170,219 (dateLocale je Sprache); src/claude.js:43 (bereits genutztes Vorbild)

### MCP-08 - get_agent_status zeigt Kosten immer als "EUR", unabhaengig von paymentCurrency
- **Prioritaet**: P0
- **Modus**: offline (node:test mit env-Override)
- **Vorbedingung**: `PAYMENT_CURRENCY=usd` gesetzt (simuliert eine Live-Config, in der US-Kunden in USD abgerechnet werden), Gateway-Mock liefert `agent`/`usage`/`settings`.
- **Schritte**:
  1. `process.env.PAYMENT_CURRENCY = "usd"` setzen, Config neu laden (`src/config.js` liest `process.env` beim Modul-Import - Test muss ggf. `config.billing.paymentCurrency` direkt inspizieren statt nur env zu setzen, da `config.js` ein Singleton-Import ist).
  2. `get_agent_status`-Handler aufrufen.
  3. `content[0].text` UND `structuredContent` auf das Waehrungslabel pruefen.
- **Erwartetes Ergebnis**: Der Textblock sollte `"USD"` statt `"EUR"` enthalten, wenn `paymentCurrency === "usd"`. Deterministisch: `assert.doesNotMatch(text, /\bEUR\b/)` bzw. `assert.match(text, /\bUSD\b/)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-08`; `node --test test/mcp-tools-i18n.test.js`. Zusaetzlich Widget-seitig: `src/ui/widget-i18n.js:40-44` (Keys `"AI cost, lifetime (EUR)"` etc.) muessten waehrungsparametrisiert werden - separater Testfall gegen `test/mcp-ui-widget-i18n.test.js` (Key-Paritaet wuerde sonst brechen, falls `(EUR)` fest im Key-Namen bleibt).
- **Heute erwartbar**: rot - der Textblock (mcp-tools.js:707-710) und alle Widget-i18n-Keys (widget-i18n.js:40-44) tragen `"EUR"` als Literal, unabhaengig von `config.billing.paymentCurrency`.
- **Belegt durch**: src/mcp-tools.js:707-710; src/ui/widget-i18n.js:40-44; src/config.js:362 (paymentCurrency Default eur); render.yaml:186-187 (Blueprint setzt eur explizit)

### MCP-09 - permissionsSummary() liefert deutsche Feldnamen, byte-gepinnt als Sollzustand
- **Prioritaet**: P0
- **Modus**: offline (node:test)
- **Vorbedingung**: `settings = { allowSummaries: true, allowPersonalData: false, allowBankData: false }`, `scopedTenant` simuliert EN-Tenant.
- **Schritte**:
  1. `get_agent_status`-Handler mit obigen Settings aufrufen.
  2. `structuredContent.permissions` pruefen.
- **Erwartetes Ergebnis**: Bei `language = "en"` sollte der String NICHT `"PersoenlicheDaten"`/`"Bankdaten"` enthalten, sondern englische Feldnamen (z.B. `"PersonalData"`/`"BankData"`). Deterministisch: `assert.doesNotMatch(permissions, /PersoenlicheDaten|Bankdaten/)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-09`; `node --test test/mcp-tools-i18n.test.js`. WICHTIG: Ein Fix MUSS gleichzeitig `test/mcp-ui.test.js:682` (`PERMISSIONS_STR`) anpassen, sonst bricht der bestehende, aktuell gruene Test T-W3 - das ist der Migrations-Edge-Case dieser Luecke (Bestandsdaten/Vertrag aendert sich, kein additiver Fix moeglich).
- **Heute erwartbar**: rot (fuer den neuen EN-Test) - `permissionsSummary()` erzeugt den String unabhaengig von jedem Sprachfeld immer mit den deutschen Konstanten-Namen `PersoenlicheDaten`/`Bankdaten`. Der BESTEHENDE Test (mcp-ui.test.js:682) ist heute gruen, weil er exakt diesen deutschen String als Soll pinnt.
- **Belegt durch**: src/mcp-tools.js:194-199 (permissionsSummary); src/ui/widgets/agent-status.html:55 (Permissions-Zeile); test/mcp-ui.test.js:682 (bestehender Pin)

### MCP-10 - list_action_items ist komplett unlokalisiert
- **Prioritaet**: P1
- **Modus**: offline (node:test)
- **Vorbedingung**: `scopedTenant` simuliert EN-Tenant; einmal Gateway-Mock mit `actionItems: []`, einmal mit einem offenen Termin-Item.
- **Schritte**:
  1. `list_action_items`-Handler mit leerem `actionItems`-Array aufrufen -> Text pruefen.
  2. Mit `actionItems: [{ id: "a1", type: "appointment", text: "Friseurtermin", done: false }]` aufrufen -> Text pruefen.
  3. `config`/Registrierung pruefen: hat das Tool ein `outputSchema`? (`tool()` statt `uiTool()` verwendet, siehe mcp-tools.js:641)
- **Erwartetes Ergebnis**: Bei `language = "en"`: Leer-Text NICHT `"Keine offenen Action Items."`, Termin-Praefix NICHT `"(Termin) "`. Deterministisch: `assert.notEqual(text, "Keine offenen Action Items.")` und `assert.doesNotMatch(text, /\(Termin\)/)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-10`; `node --test test/mcp-tools-i18n.test.js`.
- **Heute erwartbar**: rot - beide Strings sind Literal, `list_action_items` liest kein Sprachfeld und hat kein outputSchema (registriert ueber `tool()`, nicht `uiTool()`).
- **Belegt durch**: src/mcp-tools.js:641-651

### MCP-11 - Dynamische Werte in calls.html/calendar.html laufen nicht durch widget-i18n
- **Prioritaet**: P2
- **Modus**: offline (node:test, statische Quellanalyse)
- **Vorbedingung**: keine (reine Quelltext-/Bind-Mechanik-Pruefung)
- **Schritte**:
  1. `src/ui/widgets/calls.html` nach `data-mcp-row` durchsuchen, die referenzierten Feldnamen (`direction,counterparty,status,startedAt,summary`) sammeln.
  2. `src/ui/widget-bind.js` (`applyField`/`renderRows`) nach einem `translate()`-Aufruf durchsuchen.
  3. Zum Vergleich: `src/ui/widgets/call.html` nach `HermesI18n.t(` durchsuchen (positiv erwartet).
- **Erwartetes Ergebnis**: Fuer Konsistenz mit call.html sollte `renderRows`/`applyField` (oder ein Wrapper in calls.html/calendar.html) `status`/`direction`-Tokens durch `window.HermesI18n.t()` schicken. Deterministisch: `grep -c "HermesI18n.t(" src/ui/widgets/calls.html` > 0.
- **Verifikation**: `grep -c "HermesI18n.t(" src/ui/widgets/calls.html` (heute 0, Soll > 0 nach Fix); zusaetzlich Erweiterung von `test/mcp-ui-widget-i18n.test.js` um einen Testfall, der die Uebersetzung von `status`-Werten in calls.html prueft, analog dem bestehenden Muster fuer call.html.
- **Heute erwartbar**: rot - `widget-bind.js:99-118` bindet Arrays/Skalare ausschliesslich per `textContent`, kein `translate()`-Aufruf irgendwo ausserhalb von call.html.
- **Belegt durch**: src/ui/widget-bind.js:99-118; src/ui/widgets/calls.html:50; src/ui/widgets/call.html:300-341 (Gegenbeispiel, das es richtig macht)

### MCP-12 - Kanarien-Test: keine bestehende Testdatei prueft ein EN-/US-Szenario der MCP-Schicht
- **Prioritaet**: P0
- **Modus**: offline (grep-basiert)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -rl "language\s*[:=]\s*[\"']en" test/mcp-tools.test.js test/mcp-ui.test.js` ausfuehren.
  2. Trefferzahl zaehlen.
- **Erwartetes Ergebnis**: Nach Umsetzung dieses Testkatalogs sollte die Trefferzahl > 0 sein (mindestens die in MCP-01 bis MCP-11 beschriebenen neuen Testfaelle). Deterministisch: `wc -l` auf den grep-Output.
- **Verifikation**: `grep -c "language" test/mcp-tools.test.js test/mcp-ui.test.js test/mcp-ui-widget-i18n.test.js` (Soll nach Fix: Summe > 0; heute: 0 fuer die ersten beiden Dateien, laut Kopie-Verifikation im Ist-Stand-Abschnitt).
- **Heute erwartbar**: rot als Gate gedacht - der grep liefert HEUTE 0 Treffer in `test/mcp-tools.test.js`/`test/mcp-ui.test.js` (verifiziert). Dieser Test ist bewusst so konstruiert, dass er erst gruen wird, sobald echte EN-Testfaelle existieren - ein reines "0 heute" waere sonst falsch beruhigend.
- **Belegt durch**: test/mcp-tools.test.js:83-260 (alle Assertions deutsch); test/mcp-ui.test.js:682; grep-Lauf waehrend dieser Verifikation (0 Treffer)

### MCP-13 - widget-i18n.js ist strukturell entkoppelt von Tenant-/Anruf-Sprache
- **Prioritaet**: P2
- **Modus**: offline (node:test, statische Quellanalyse)
- **Vorbedingung**: keine
- **Schritte**:
  1. `src/ui/widget-i18n.js` (`buildI18nScript`) nach Referenzen auf `structuredContent`, `settings.language`, einem Server-Push-Mechanismus oder einem `data-*`-Locale-Attribut durchsuchen.
  2. Bestaetigen, dass `resolveLocale` ausschliesslich mit `[navigator.language]` aufgerufen wird (Zeile 161).
- **Erwartetes Ergebnis**: Dokumentiert den aktuellen (bewussten, aber ungetesteten) Architektur-Zustand: 0 Treffer fuer eine tenant-/serverseitige Locale-Quelle im I18N_SCRIPT.
- **Verifikation**: `grep -n "structuredContent\|settings.language\|data-locale" src/ui/widget-i18n.js` (erwartet 0 Treffer).
- **Heute erwartbar**: gruen - dokumentiert korrekt den heutigen (bewussten) Zustand; wird zum Regressions-Waechter, falls jemand versucht, die Kopplung ohne bewusste Entscheidung/Test einzufuehren.
- **Belegt durch**: src/ui/widget-i18n.js:161; src/store/state-ops.js:648-651 (komplett getrennter Pfad)

### MCP-14 - Deutsche Text-Artefakte tauchen AUCH ohne Widget-Host-Faehigkeit auf (Stufe-0-Text)
- **Prioritaet**: P1
- **Modus**: offline (node:test)
- **Vorbedingung**: `uiHost: null` (kein `_meta`, kein Widget-Anhang, reiner Text-Pfad), `scopedTenant` simuliert EN-Tenant, RICH_CALL-Fixture.
- **Schritte**:
  1. `captureUi({ scopedTenant: "tenant-en-us", uiHost: null })` (Host erklaert keine UI-Capability).
  2. `get_call_status` aufrufen, `content[0].text` pruefen.
  3. Vergleichen mit demselben Aufruf bei `uiHost: capableHost()`.
- **Erwartetes Ergebnis**: Der JSON-Text in `content[0].text` enthaelt in BEIDEN Faellen identisch "Gegenseite" (bzw. nach einem reinen Widget-Fix weiterhin, da Text-Pfad unabhaengig vom Widget ist) - zeigt, dass ein alleiniger Fix an widget-i18n.js NICHT ausreicht, um das Problem zu loesen. Deterministisch: beide Texte enthalten (heute) `/Gegenseite/`, byte-identisch zueinander.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-14`; `node --test test/mcp-tools-i18n.test.js`.
- **Heute erwartbar**: gruen (als Beweis der Kopplungs-These) - `content[0].text` wird in `callStatusResult` (mcp-tools.js:498-519) unabhaengig von `uiRenderer`/`uiHost` gebaut, die Whitelist-Funktion `pickCallStatus` kennt keinen Host-Parameter. Ein Fix NUR in widget-i18n.js wuerde diesen Text nicht aendern.
- **Belegt durch**: src/mcp-tools.js:494-519 (callStatusResult, Text unabhaengig von uiHost), :103-115 (pickCallStatus)

### MCP-15 - mcp-tools.js ignoriert JEDEN Sprachwert vollstaendig (null/leer/unbekannt/Gross-Klein)
- **Prioritaet**: P1
- **Modus**: offline (node:test, parametrisiert)
- **Vorbedingung**: Parametrisierte Laeufe mit `settings.language` in `[undefined, null, "", "en", "EN", "fr", "xx-unknown", "DE"]`.
- **Schritte**:
  1. Fuer jeden Wert `get_agent_status` mit identischem `settings`/`usage`/`agent`-Body aufrufen (nur `language` variiert).
  2. `content[0].text` je Lauf sammeln.
- **Erwartetes Ergebnis**: HEUTE (dokumentiert die Luecke): alle 8 Text-Outputs sind byte-identisch, unabhaengig vom `language`-Wert - der Wert wird an keiner Stelle in `mcp-tools.js` gelesen. Deterministisch: `assert.equal(new Set(texts).size, 1)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js`, Testfall `T-MCP-i18n-15`; `node --test test/mcp-tools-i18n.test.js`. Nach einem Fix sollte dieser Test umgekehrt werden (Set-Groesse > 1 fuer unterschiedliche unterstuetzte Sprachen, aber weiterhin 1 fuer `null`/unbekannt -> Fallback).
- **Heute erwartbar**: gruen (dokumentiert exakt die Luecke: Identitaet der Ausgabe ist der Fehler selbst) - kein Codepfad in mcp-tools.js liest `settings.language`.
- **Belegt durch**: src/mcp-tools.js (kein Treffer fuer `.language` in der gesamten Datei ausser dem ignorierten place_call-Schema-Feld, Zeile 448); src/mcp-tools.js:213-229 (pickAgentStatus liest settings nur fuer permissions, nie language)

### MCP-16 - Parallele /mcp-Requests zweier Tenants: kein Sprach-Leak (Nebenlaeufigkeits-Waechter)
- **Prioritaet**: P2
- **Modus**: offline (node:test, Integrationstest gegen echten Server)
- **Vorbedingung**: Server lokal mit `PORT=0`, `DATA_DIR`-Override (Temp-Verzeichnis, wie in bestehenden Integrationstests), zwei Tenants mit `settings.language = "de"` bzw. `"en"`.
- **Schritte**:
  1. Zwei parallele POST `/mcp`-Requests (`tools/call get_agent_status`) mit unterschiedlichem `X-Internal-Tenant`/Auth gleichzeitig absetzen (`Promise.all`).
  2. Antworten den jeweiligen Tenants zuordnen.
- **Erwartetes Ergebnis**: Da `registerTools` pro Request frisch in einer eigenen Closure gebaut wird (`src/routes/mcp.js:76-90`, stateless INV-8) und kein Sprachfeld gelesen wird, gibt es HEUTE strukturell keinen Cross-Tenant-Sprach-Leak (weil es keine Sprach-Verarbeitung gibt, die leaken koennte). Deterministisch: jede Antwort enthaelt exakt die Daten des eigenen Tenants (number/owner), keine Vermischung.
- **Verifikation**: neue Datei `test/mcp-i18n-concurrency.test.js`, Muster wie bestehende Integrationstests (Server als Kindprozess, `PORT=0`); `node --test test/mcp-i18n-concurrency.test.js`.
- **Heute erwartbar**: gruen - die Stateless-Architektur (kein Hoisting ueber Requests, `src/routes/mcp.js:7-11`) verhindert das strukturell; bleibt aber ein wichtiger Regressions-Waechter, sobald ein Sprach-Parameter eingefuehrt wird (dann koennte ein Caching-Fehler genau diesen Leak erzeugen).
- **Belegt durch**: src/routes/mcp.js:7-11 (INV-8 Kommentar), :76-90 (Server pro Request)

### MCP-17 - Claude-Tool-Nutzungsqualitaet bei rein englischer Chat-Session (deutsche Tool-Beschreibungen als Kontext)
- **Prioritaet**: P1
- **Modus**: manuell (echte claude.ai-Session mit englischem Chat-Verlauf)
- **Vorbedingung**: Ein claude.ai-Account mit verbundenem Hermes-Connector, Chat vollstaendig auf Englisch gefuehrt, Tenant-Settings auf `language = "en"`.
- **Schritte**:
  1. In claude.ai einen englischen Chat starten: "Please call +1... and ask about opening hours."
  2. Beobachten, ob Claude `place_call` mit sinnvoll befuellten Feldern (objective/briefing) aufruft, obwohl deren `.describe()`-Texte Deutsch sind.
  3. Wiederholen mit 3-5 verschiedenen englischen Formulierungen/Auftraegen (Bench-Prinzip, `npm run convo-bench` als Vorbild fuer n>=5, siehe Team-Gedaechtnis).
- **Erwartetes Ergebnis**: Kein deterministisches Kriterium moeglich (LLM-Verhalten) - qualitative Beobachtung: fuellt Claude `objective`/`briefing` weiterhin korrekt auf Englisch, oder rutscht es in deutsche Formulierungen/Verwirrung ab, weil die Tool-Beschreibung Deutsch vorgibt?
- **Verifikation**: Manuelles Protokoll (Screenshot/Transkript) der 3-5 Sessions, kein automatisiertes Kommando.
- **Heute erwartbar**: unbekannt - reine LLM-Verhaltensfrage, im Code nicht pruefbar (deckt sich mit openQuestion #1 des Recon-Befunds).
- **Belegt durch**: src/mcp-tools.js:365-467 (Kontext, den Claude sieht) - Wirkung selbst ist nicht code-basiert nachweisbar

### MCP-18 - navigator.language-Verlaesslichkeit im claude.ai-Iframe-Sandbox
- **Prioritaet**: P2
- **Modus**: manuell (echte claude.ai-Session, Browser-Locale wechseln)
- **Vorbedingung**: claude.ai-Session mit Hermes-Connector, ein Widget (z.B. agent-status) wird im Chat gerendert.
- **Schritte**:
  1. Browser-Sprache auf `en-US` stellen, Widget rendern lassen, `document.documentElement.lang` sowie sichtbare Labels im Iframe pruefen (DevTools).
  2. Browser-Sprache auf `de-DE` stellen, denselben Chat/dasselbe Widget neu laden, erneut pruefen.
  3. Vergleichen, ob `navigator.language` im sandboxed Iframe tatsaechlich den echten Browser-Wert widerspiegelt oder einen Default/leeren Wert liefert.
- **Erwartetes Ergebnis**: `window.HermesI18n.locale` im Iframe entspricht der jeweils eingestellten Browser-Sprache (`en` bzw. `de`). Deterministisch pruefbar per DevTools-Konsole (`window.HermesI18n.locale === "de"` etc.), aber nur live beobachtbar.
- **Verifikation**: Manuelles DevTools-Protokoll, kein automatisiertes Kommando (deckt sich mit openQuestion #4 des Recon-Befunds).
- **Heute erwartbar**: unbekannt - haengt vom Verhalten des claude.ai-Hosts ab, nicht im Repo-Code pruefbar.
- **Belegt durch**: src/ui/widget-i18n.js:161 (Code-seitiger Mechanismus) - Host-Verhalten selbst nicht code-basiert nachweisbar

### MCP-19 - Tatsaechlicher Live-Wert von PAYMENT_CURRENCY im Render-Dashboard
- **Prioritaet**: P0
- **Modus**: manuell (Render-Dashboard-Pruefung, operativ)
- **Vorbedingung**: Zugriff auf das Render-Dashboard des Live-Dienstes.
- **Schritte**:
  1. Im Render-Dashboard des produktiven Web-Service die Environment-Variable `PAYMENT_CURRENCY` nachsehen (NICHT nur `render.yaml` lesen - laut Team-Gedaechtnis sind Render-Dienste Dashboard-managed und `render.yaml` kann vom Live-Stand abweichen).
  2. Mit dem in `apps/web` beworbenen Preis-Modell (USD, Starter $4.99/Business $9.99) abgleichen.
- **Erwartetes Ergebnis**: Deterministisch pruefbar als Ja/Nein-Frage: ist `PAYMENT_CURRENCY` live auf `"usd"` gesetzt? Falls NEIN (weiterhin `"eur"` wie im Blueprint), ist Gap MCP-08 nicht nur ein Anzeige-Label-Bug, sondern zeigt eine echte Waehrungs-Diskrepanz zwischen Marketing (USD) und Abrechnung (EUR) - das waere ein eigenstaendiges, schwerwiegenderes Billing-Thema ausserhalb dieser MCP-Dimension.
- **Verifikation**: Render-Dashboard-Screenshot/Notiz, kein automatisiertes Kommando aus diesem Repo heraus (bewusst: keine Netzwerkaufrufe an Render/Stripe im Rahmen dieser Aufgabe).
- **Heute erwartbar**: unbekannt - render.yaml/​.env.example setzen beide `"eur"`, der tatsaechliche Live-Wert ist aus dem Repo NICHT ablesbar.
- **Belegt durch**: render.yaml:186-187; .env.example:231; src/config.js:362 (Code-Default)

### MCP-20 - Live-Outbound-Anruf eines EN-Tenants zeigt "Gegenseite:" in der echten Live-Karte
- **Prioritaet**: P0
- **Modus**: live (echter Anruf, kostet Geld)
- **Vorbedingung**: Verifizierter EN-Tenant (settings.language = "en"), echte DID, `place_call` an eine erreichbare Testnummer.
- **Schritte**:
  1. Via claude.ai (oder MCP-Client) `place_call` mit einem englischen `objective` an eine reale Testnummer ausloesen.
  2. Waehrend/nach dem Gespraech `get_call_status` beobachten (Live-Karte oder Fallback-Text).
  3. `last_transcript_lines` im Chat/Widget pruefen.
- **Erwartetes Ergebnis**: Aus dem Code (MCP-06) deterministisch vorhersagbar: JEDE Zeile der Gegenseite traegt das Praefix `"Gegenseite:"`, unabhaengig vom EN-Tenant. Live-Bestaetigung ist der End-to-End-Beweis fuer MCP-06 unter echten Bedingungen (Netzwerk, echter Gateway, kein Mock).
- **Verifikation**: Manuelles Transkript-Protokoll des Testanrufs; kein automatisiertes Kommando (kostenpflichtig, daher nicht in CI).
- **Heute erwartbar**: rot - mit hoher Sicherheit aus dem unveraenderlichen Code vorhersagbar (mcp-tools.js:108-110 hat keine Verzweigung), die Live-Ausfuehrung dient nur der Bestaetigung unter realen Bedingungen.
- **Belegt durch**: src/mcp-tools.js:108-110 (Code-Beweis); Live-Ausfuehrung nicht Teil dieser Recherche

### MCP-21 - agent-status-Widget zeigt im echten Browser bei EN-Locale trotzdem deutsche Permission-Feldnamen
- **Prioritaet**: P0
- **Modus**: manuell (echte claude.ai-Session oder lokal gerendertes Widget-HTML im Browser)
- **Vorbedingung**: claude.ai-Session mit Hermes-Connector, Browser-Sprache `en-US`, Tenant mit `allowPersonalData=false`, `allowBankData=false`.
- **Schritte**:
  1. `get_agent_status` im Chat ausloesen, Widget rendern lassen.
  2. Zeile "Permissions" im gerenderten Widget ablesen.
- **Erwartetes Ergebnis**: Aus dem Code deterministisch vorhersagbar: die Zeile "Permissions" (englisch uebersetzt via widget-i18n, `src/ui/widget-i18n.js:45`) zeigt als WERT trotzdem `"Summaries=true, PersoenlicheDaten=false, Bankdaten=false"` - der Zeilen-Titel ist Englisch, der Inhalt Deutsch. Sichtbarer, sofort erkennbarer Bruch mitten im Widget.
- **Verifikation**: Manueller Screenshot-Vergleich (Zeilen-Titel vs. Zeilen-Wert); kein automatisiertes Kommando fuer das reale Rendering, aber der zugrunde liegende String ist bereits offline in MCP-09 geprueft.
- **Heute erwartbar**: rot - mit hoher Sicherheit aus dem Code vorhersagbar (widget-i18n.js uebersetzt nur das `data-i18n`-Label "Permissions" (Zeile 36 in de, entspricht Key an Position der agent-status.html-Zeile 55), NICHT den `data-mcp="permissions"`-Wert selbst, der aus `permissionsSummary()` kommt).
- **Belegt durch**: src/mcp-tools.js:194-199 (permissionsSummary, Code-Beweis); src/ui/widgets/agent-status.html:55; src/ui/widget-i18n.js:45 (uebersetzt nur das Label, nicht den Wert)
