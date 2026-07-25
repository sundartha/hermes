# UI - Sprachachsen der Chat-Oberflaeche (Widgets + Wire-Vertrag)

Owner-Anforderung (woertlich): "Das Widget im Chat soll englisch sein, wenn der Nutzer
englisch spricht, franzoesisch wenn er in Frankreich ist." Dieses Dokument kartiert JEDE
unabhaengige Sprachachse, die im claude.ai-Chat sichtbar wird, prueft die Anforderung
gegen den Ist-Stand und listet die Test-Luecke.

Verwandte Dokumente in diesem Verzeichnis: `04-mcp-und-widgets.md` deckt die MCP-Tool-
Text-Achse (Achse C unten) bereits mit 21 eigenen Tests (MCP-01..MCP-21) sehr detailliert
ab - dieses Dokument dupliziert sie NICHT, sondern referenziert sie und fokussiert auf die
Widget-Chrome-/Wire-Vertrags-Achsen (A, B, E) sowie die hier zentrale Kernfrage 2
(Host-Signal fuer Chat-Sprache/Land).

## Ist-Stand je Achse

| Achse | Sprachquelle | Fallback | Beleg |
| --- | --- | --- | --- |
| A) Widget-Chrome (`data-i18n`-Labels, alle 5 Widgets) | `navigator.language` DES IFRAME-BETRACHTERS, gegen `WIDGET_DICT` (nur `de`+`fr`) aufgeloest via `resolveLocale` | `DEFAULT_LOCALE = "en"` (Dict-Keys SIND die englischen Texte) | `src/ui/widget-i18n.js:20,26-103,113-120,161` |
| B1) call.html Status-Pill/HUD-Phase/Failure-Reason/Objective | dieselbe Locale wie A, einmalig bei Iframe-Skriptstart via `window.HermesI18n.t()` aufgeloest | wie A (unbekannter Key/Sprache -> Key selbst = Englisch) | `src/ui/widgets/call.html:257-262,300-341,412-427` |
| B2) Transkriptzeilen (`last_transcript_lines`, call.html) | KEINE Sprachquelle - Server haengt das Rollen-Praefix fest als deutsches Wort an, BEVOR der Text den Widget-Bind-Pfad erreicht | keiner (immer `"Agent: "`/`"Gegenseite: "`, unabhaengig von A/C/D) | `src/mcp-tools.js:103-115` (Zeile 110) |
| B3) calls.html/calendar.html Row-Werte (`status`,`direction`,`startedAt`,`title`,...) | roh vom Server (Whitelist-Felder `pickCall`/`pickCalendarEntry`), der geteilte Bind-Pfad ruft NIRGENDS `translate()` auf | keiner (Rohwert erscheint unveraendert: z.B. Status-Enum `"completed"` oder ein de-DE-formatiertes Datum) | `src/ui/widget-bind.js:78-118` (kein `translate`-Import/Aufruf); `src/ui/widgets/calls.html:50`; `src/ui/widgets/calendar.html:40` |
| C) MCP-Tool-Text (Beschreibungen, Fehlermeldungen, `content[0].text`-Bloecke) | KEINE - `registerTools` kennt keinen `language`/`locale`-Parameter | keiner (immer Deutsch) | `src/mcp-tools.js:307-310` (Signatur); `:365-467` (place_call-Describe); `:65-79` (requireFields); `:333-344` (wrapHandler); `:705-710` (get_agent_status-Textblock); vertieft in `04-mcp-und-widgets.md` MCP-01..MCP-15 |
| D) Agenten-/Anruf-Sprache (was der Agent am TELEFON spricht + `c.summary`) | Praezedenz: `settings.language` (Tenant-Override) -> `number.language` -> `tenant.defaultLanguage` -> `DEFAULT_LANGUAGE` | `"de"` | `src/store/state-ops.js:648-651`; Bundle `src/i18n/locales.js:95-257`; `DEFAULT_LANGUAGE` in `src/store/defaults.js:331` |
| E1) Datum/Zeit in `list_calls`/`get_calendar` | KEINE - hart `toLocaleString("de-DE", ...)`, obwohl je Sprache ein `dateLocale`-Feld existiert und andernorts (`claude.js`) schon genutzt wird | keiner (immer de-DE-Format: `TT.MM.`, 24h) | `src/mcp-tools.js:48-55`; Gegenbeleg `src/i18n/locales.js:98,170,219` (`dateLocale`); `src/claude.js:43` (nutzt es bereits) |
| E2) Waehrungslabel `"(EUR)"` (Widget-Chrome UND MCP-Text) | KEINE - Literal in JEDEM `WIDGET_DICT`-Eintrag (auch im EN-Key selbst) UND im `get_agent_status`-Textblock, unabhaengig von `config.billing.paymentCurrency` | keiner (immer `"EUR"`) | `src/ui/widget-i18n.js:40-44`; `src/mcp-tools.js:707-710`; `src/config.js:362` (`paymentCurrency`, Default `"eur"`) |

Alle sechs Achsen sind strukturell voneinander ENTKOPPELT - keine liest den Wert einer
anderen. Achse A kennt Achse D nicht (und umgekehrt); Achse C kennt weder A noch D; Achse
E1/E2 kennt keine von beiden. Es gibt keinen gemeinsamen Resolver, der sie synchron
haelt.

## Kernfrage 2: Host-Signal fuer Chat-Sprache/Land im MCP-Wire-Vertrag

**Antwort: Es gibt KEIN solches Signal.** Gepruefte Stellen und Belege:

- `src/ui/registry.js:43-50` (`uiRendererFor`): der einzige Host-Kontext, den der Server
  je Request erhaelt, ist `hostHint = { enabled, capabilities }`. `capabilities` ist
  `req.body?.params?.capabilities` aus dem MCP-`initialize`-Handshake des Clients
  (`src/routes/mcp.js:84`) - das sind MCP-PROTOKOLL-Capabilities (z.B. ob der Client die
  `io.modelcontextprotocol/ui`-Extension mit welchem `mimeType` unterstuetzt,
  `src/ui/contract.js:27-32`), KEIN Locale- oder Land-Feld.
- `src/ui/contract.js` (kompletter Vertrag: `UI_MIME`, `UI_CAPABILITY_KEY`, `UI_META_KEY`,
  `makeCapabilityDetector`, `makeUiRenderer`, `uiServerExtension`) enthaelt an keiner
  Stelle einen Locale-/Land-/Sprach-String.
- `src/ui/adapters/mcp-native.js` und `src/ui/adapters/chatgpt.js` unterscheiden sich NUR
  in `mimeType`/`metaKey`/`buildMeta` (Wire-Format der `_meta`-Resource-Referenz) - keine
  Locale-Dimension.
- `src/ui/widget-bind.js:173-207` (`run`, der Iframe-Bootstrap): die an den Host gesendete
  `ui/initialize`-Nachricht traegt NUR `appCapabilities`, `appInfo`, `protocolVersion`
  (Zeilen 181-190) - kein `locale`/`language`/`country`-Feld. `handleHostMessage`
  (Zeilen 153-168) liest aus der Host-Antwort ebenfalls nur `result` (Handshake-Bestaetigung)
  bzw. `params.structuredContent` (Tool-Daten) - kein Locale-Feld wird je aus einer
  Host-Nachricht extrahiert.
- `src/ui/widget-catalog.js` (Katalog + alle Injektions-Funktionen `withI18nScript`,
  `withBindScript`, `withWingAssets`, ...) uebergibt beim Bauen des Widget-HTML KEINEN
  Request-/Host-Kontext - das HTML ist byte-identisch fuer jeden Request (`WIDGET_HTML`
  wird EINMAL beim Modul-Load gebaut, `src/ui/widget-catalog.js:140-150`).
- `grep -rn "Accept-Language" src/` liefert 0 Treffer im gesamten Repo - der Server liest
  den Standard-HTTP-Sprachheader nirgends.
- `src/ui/widget-i18n.js:152-160` dokumentiert explizit, dass ein FRUEHERER Kandidat
  (`window.openai.locale`, ein ChatGPT-Host-Objekt) bewusst ENTFERNT wurde, weil das
  ausgelieferte HTML seit `widget-wire` kein `window.openai` mehr referenzieren darf
  (Spec-Konformitaet). Der einzige verbliebene Kandidat ist `navigator.language` des
  Browsers, in dem das Iframe laeuft (Zeile 161).

`navigator.language` ist damit die EINZIGE Sprachquelle im gesamten Wire-Vertrag - und sie
ist weder "die Sprache, in der der Nutzer im Chat schreibt" (das ist ein separates,
serverseitig unbekanntes LLM-Kontextfeld) noch "das Land des Nutzers" (Browser-Locale
!= Standort; ein Nutzer in Frankreich mit `en-US`-Systemsprache liefert `"en-US"`, kein
Land-Signal).

**Ersatzquellen, die es geben WUERDE (keine davon ist heute verdrahtet):**

1. **Browser-Locale** (`navigator.language`) - bereits genutzt fuer Achse A. Naeherung an
   "Sprache", NICHT an "Land". Beste verfuegbare Proxy fuer "der Nutzer spricht X", aber
   nur so gut wie die Systemeinstellung des Geraets (siehe Divergenz-Zeile 1 unten).
2. **Tenant-Sprache aus dem Store, serverseitig ins Widget gerendert.** Der Server kennt
   `settings.language`/`tenant.defaultLanguage` bereits (`resolveCallLanguage`,
   `src/store/state-ops.js:648-651`) - dieser Wert erreicht aber weder `registerTools`
   (keine `language`-Prop in der Signatur, `src/mcp-tools.js:307-310`) noch
   `widget-catalog.js` (statisches HTML ohne Request-Kontext). Ein serverseitiger
   Locale-Hint muesste NEU durch `structuredContent` (z.B. ein `locale`-Feld je
   Tool-Antwort) oder eine parametrisierte `ui://`-Resource-URI transportiert werden.
3. **Land aus dem Tenant-/Nummern-Record.** `tenant.country` existiert bereits
   (`setTenantGeo`/`tenantGeo`, `src/store/state-ops.js:1187-1201`), ebenso
   `number.country` (`seedBootstrapNumber`, `src/store/state-ops.js:668-686`) und eine
   fertige Land->Sprache-Abbildung (`LANGUAGE_FOR_COUNTRY`,
   `src/i18n/locales.js:268-275`, DE/AT/CH->de, FR->fr, GB/IE->en). Diese Infrastruktur
   ist fuer die Anruf-Sprachwahl (Achse D) gebaut, aber NICHT an die Widget-Chrome (Achse
   A) angeschlossen - genau die Land->Sprache-Abbildung, die die Owner-Anforderung
   ("franzoesisch, wenn er in Frankreich ist") braeuchte, existiert im Code, zeigt aber
   auf die falsche Achse.

## Divergenz-Matrix

| # | Szenario | Was der Nutzer SIEHT | Bewertung |
| --- | --- | --- | --- |
| 1 | Deutscher Tenant, macOS/Browser auf Englisch (sehr verbreitet) | Chrome (A) englisch: Kartentitel, Labels. Transkript-Zeilen (B2) und alle Fehlermeldungen/Tool-Texte (C) trotzdem Deutsch ("Gegenseite:", "Der Telefon-Agent hat..."). Anruf (D) korrekt Deutsch. | FEHLER - sichtbarer Sprachmix in JEDER einzelnen Karte, unabhaengig vom Nutzerwunsch |
| 2 | US-Tenant, `en-US`-Browser, aber `settings.language`/`number.language`/`tenant.defaultLanguage` alle leer -> D faellt auf `"de"` zurueck | Chrome (A) englisch. Der KI-Agent fuehrt das TELEFONAT selbst auf Deutsch, spricht also mit dem Angerufenen deutsch, obwohl Tenant/Browser durchgehend englisch sind. | FEHLER, schwerwiegend - falsche Gespraechssprache am echten Telefon, nicht nur ein UI-Label |
| 3 | Franzoesischer Nutzer, `fr-FR`-Browser, aber `settings.language="en"` (bewusste Tenant-Wahl) | Chrome (A) franzoesisch, Anruf (D) englisch, MCP-Fehlermeldungen/Tool-Text (C) deutsch, Datum (E1) de-DE-Format, Waehrungslabel (E2) "EUR". Bis zu VIER Sprachen/Formate gleichzeitig sichtbar. | FEHLER (C/E-Anteil) - A/D-Divergenz waere fuer sich akzeptabel (explizite Tenant-Wahl), C/E kennen aber ueberhaupt keine Sprachverzweigung |
| 4 | Nutzer physisch in Frankreich, aber `en-US`-Systemsprache (z.B. Firmenlaptop) | Chrome bleibt englisch - es gibt kein Land-Signal (Kernfrage 2), nur Browser-Locale. | FEHLER gegen die Owner-Anforderung, direkt widerlegt: "franzoesisch, wenn er in Frankreich ist" wird NIE erfuellt, weil kein Land je geprueft wird |
| 5 | Browser-Locale ohne Dict-Eintrag (`es`,`it`,`nl`,`pt`,`ja`, ...) | Chrome (A) faellt komplett auf Englisch zurueck (fail-safe by design, Keys=EN-Text). Anruf (D) laeuft unabhaengig in de/fr/en. MCP-Text (C) bleibt Deutsch. | A allein: AKZEPTABEL (bewusster, sauberer Fallback statt kaputter Roh-Keys). In Kombination mit C: FEHLER (deutscher Text bleibt so oder so sichtbar, unabhaengig vom Fallback-Erfolg von A) |
| 6 | Geteilter Chat/Widget-Link, zwei Betrachter mit unterschiedlicher Browser-Locale | Jede Iframe-Instanz loest `navigator.language` LOKAL beim eigenen Laden auf (`resolveLocale` ist eine reine Funktion ohne geteilten/serverseitigen Zustand, `src/ui/widget-i18n.js:161`) - beide Betrachter sehen potenziell unterschiedliche Chrome-Sprachen derselben Karte. | NEUTRAL/erwartbar fuer sich (jeder sieht seine eigene Sprache), zeigt aber: Chrome-Sprache ist rein BETRACHTER-lokal, nie "die Sprache dieses Tenants/Anrufs" - relevant fuer die Produktentscheidung unten |
| 7 | Deutscher Tenant + `de-DE`-Browser (Normalfall/Baseline) | Alles Deutsch: Chrome, Transkript, MCP-Text, Datum, Anruf. | AKZEPTABEL - der einzige Fall, in dem alle sechs Achsen zufaellig uebereinstimmen |
| 8 | EN-Tenant VOLLSTAENDIG korrekt konfiguriert (`settings.language="en"`) + `en-US`-Browser (Best Case fuer den Owner) | Chrome (A) englisch, Anruf (D) englisch - beides korrekt. MCP-Text (C) bleibt Deutsch, Datum/Zeit (E1) bleibt de-DE-Format, Waehrungslabel (E2) bleibt "EUR". | FEHLER trotz lueckenloser Konfiguration - selbst der Best Case ist heute kaputt, weil C/E1/E2 serverseitig UEBERHAUPT keine Sprachverzweigung besitzen (nicht mal ein fehlendes Signal-Problem, sondern schlicht nicht implementiert) |

## Tests

### UI-01 - Dict-Key-Paritaet ueber alle WIDGET_DICT-Sprachen (Bestandstest, Regressions-Anker)
- **Prioritaet**: P1
- **Modus**: offline (npm test / node)
- **Vorbedingung**: keine
- **Schritte**:
  1. `Object.keys(WIDGET_DICT.de).sort()` und `Object.keys(WIDGET_DICT.fr).sort()` vergleichen.
- **Erwartetes Ergebnis**: Identische Key-Mengen (Laenge und Inhalt) fuer `de` und `fr`.
- **Verifikation**: `node --test test/mcp-ui-widget-i18n.test.js` (Testfall `T-i18n-parity`).
- **Heute erwartbar**: gruen - bestehender, bereits gruener Test.
- **Belegt durch**: `src/ui/widget-i18n.js:26-103`; `test/mcp-ui-widget-i18n.test.js:46-57`

### UI-02 - EN-Fallback: unbekannter Key/unbekannte Sprache liefert den Key selbst
- **Prioritaet**: P1
- **Modus**: offline (npm test / node)
- **Vorbedingung**: keine
- **Schritte**:
  1. `translate(WIDGET_DICT, "en", "Duration")` aufrufen.
  2. `translate(WIDGET_DICT, "de", "Unbekannter Key")` aufrufen.
- **Erwartetes Ergebnis**: `translate(..., "en", "Duration") === "Duration"`; `translate(..., "de", "Unbekannter Key") === "Unbekannter Key"`.
- **Verifikation**: `node --test test/mcp-ui-widget-i18n.test.js` (Testfall `T-i18n-translate`).
- **Heute erwartbar**: gruen - bestehender, bereits gruener Test.
- **Belegt durch**: `src/ui/widget-i18n.js:124-129`; `test/mcp-ui-widget-i18n.test.js:70-75`

### UI-03 - Fallback-Kette bei fehlendem/leerem navigator.language
- **Prioritaet**: P1
- **Modus**: offline (node)
- **Vorbedingung**: keine
- **Schritte**:
  1. `resolveLocale([], WIDGET_DICT)` aufrufen (leere Kandidatenliste, entspricht `navigator.language === undefined` im Iframe-Kontext).
  2. `resolveLocale([""], WIDGET_DICT)` aufrufen (leerer String).
  3. `resolveLocale([undefined, null, "de"], WIDGET_DICT)` aufrufen (fuehrende leere Kandidaten).
- **Erwartetes Ergebnis**: (1) und (2) liefern `"en"` (DEFAULT_LOCALE); (3) liefert `"de"` (erster gueltiger Kandidat, leere uebersprungen).
- **Verifikation**: `node --test test/mcp-ui-widget-i18n.test.js` (Testfall `T-i18n-locale`, deckt (1)/(3) bereits ab; (2) ist eine noch fehlende Ergaenzung).
- **Heute erwartbar**: gruen fuer (1)/(3) (bestehend); unbekannt fuer (2) - kein expliziter Testfall fuer leeren String, aber `primaryLanguage("")` liefert `""`, `hasOwnProperty(dict, "")` ist false -> Code-Pfad legt gruen nahe, ist aber nicht gepinnt.
- **Belegt durch**: `src/ui/widget-i18n.js:107-120`; `test/mcp-ui-widget-i18n.test.js:59-68`

### UI-04 - documentElement.lang wird auf die aufgeloeste Locale gesetzt
- **Prioritaet**: P2
- **Modus**: offline (node, jsdom-freier Fake-DOM oder echter Iframe-Test)
- **Vorbedingung**: `I18N_SCRIPT` in ein Test-DOM eingebettet, `navigator.language` auf `"fr-CH"` simuliert
- **Schritte**:
  1. `I18N_SCRIPT`-IIFE in einer Fake-`document`/`navigator`-Umgebung ausfuehren (Muster wie bestehende Bind-Tests, die `Function.prototype.toString`-Projektionen pruefen).
  2. `document.documentElement.lang` nach Ausfuehrung lesen.
- **Erwartetes Ergebnis**: `document.documentElement.lang === "fr"` (primaerer Subtag der aufgeloesten Locale, nicht `"fr-CH"`).
- **Verifikation**: Neue/erweiterte Assertion in `test/mcp-ui-widget-i18n.test.js` (aktuell keine Zeile prueft `documentElement.lang` direkt - nur der Injektions-Ort wird geprueft).
- **Heute erwartbar**: unbekannt - der Code setzt es (`src/ui/widget-i18n.js:164`), aber kein bestehender Test liest den Wert zurueck.
- **Belegt durch**: `src/ui/widget-i18n.js:163-166` (`localizeDocument`)

### UI-05 - I18N_SCRIPT in allen 5 Widgets injiziert, im head vor Inline-Skripten
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. Fuer jede der 5 Widget-Ids `widgetHtml(id)` lesen.
  2. Pruefen: `window.HermesI18n` vorhanden, `"__I18N__"`-Platzhalter NICHT mehr vorhanden, Position vor `<body`.
- **Erwartetes Ergebnis**: Fuer alle 5 Ids (`agent-status`,`my-number`,`calls`,`calendar`,`call`) alle drei Bedingungen erfuellt.
- **Verifikation**: `node --test test/mcp-ui-widget-i18n.test.js` (Testfall `T-i18n-inject`).
- **Heute erwartbar**: gruen - bestehender, bereits gruener Test.
- **Belegt durch**: `src/ui/widget-catalog.js:85-90,101-107,140-150`; `test/mcp-ui-widget-i18n.test.js:106-115`

### UI-06 - Statische data-i18n-Markup-Defaults sind byte-identisch zum Key (Fail-Safe ohne Script)
- **Prioritaet**: P2
- **Modus**: offline (npm test)
- **Vorbedingung**: keine
- **Schritte**:
  1. Alle `data-i18n="X"` Elemente in den 5 `.html`-Quellen einsammeln.
  2. Innentext des Elements mit `X` vergleichen.
- **Erwartetes Ergebnis**: Innentext == Key fuer jedes Element (faellt das I18N_SCRIPT aus, bleibt die Karte lesbar-englisch statt leer/kaputt).
- **Verifikation**: `node --test test/mcp-ui-widget-i18n.test.js` (Testfall `T-i18n-en-default`).
- **Heute erwartbar**: gruen - bestehender, bereits gruener Test.
- **Belegt durch**: `src/ui/widget-i18n.js:14-16`; `test/mcp-ui-widget-i18n.test.js:94-104`

### UI-07 - OCP: eine neue Widget-Sprache braucht genau EINEN WIDGET_DICT-Eintrag
- **Prioritaet**: P2
- **Modus**: offline (node)
- **Vorbedingung**: keine
- **Schritte**:
  1. `WIDGET_DICT` um einen synthetischen Eintrag `es: { ...alle Keys aus de mit Platzhaltertexten... }` erweitern (im Test, nicht im Produktivcode).
  2. `resolveLocale(["es-ES"], erweitertesDict)` aufrufen.
  3. Pruefen, dass KEINE andere Quelldatei (`widget-catalog.js`, `widget-bind.js`, Widget-HTMLs) angefasst werden musste, damit `es` funktioniert.
- **Erwartetes Ergebnis**: `resolveLocale(["es-ES"], erweitertesDict) === "es"`; keine zweite Code-Aenderung noetig - ausschliesslich der Dict-Eintrag traegt die neue Sprache (belegt die OCP-Absicht aus dem Kopfkommentar).
- **Verifikation**: Neuer Testfall, der `WIDGET_DICT` NICHT importiert-mutiert, sondern eine lokale Kopie mit Zusatz-Key baut und gegen `resolveLocale`/`translate` direkt testet (reine Funktionen, kein Modul-Patch noetig).
- **Heute erwartbar**: gruen - die Funktionen (`resolveLocale`,`translate`) sind bereits datengetrieben (kein Sprachen-Enum/Switch im Code), der Test faengt aber eine kuenftige Regression (z.B. ein hartes `if (locale === "de" || locale === "fr")`), die diese Eigenschaft brechen wuerde.
- **Belegt durch**: `src/ui/widget-i18n.js:22-25` (Kopfkommentar OCP-Absicht), `:113-120,124-129` (datengetriebene Implementierung)

### UI-08 - call.html: Chrome uebersetzt, Transkript-Rollen-Praefix "Gegenseite:" bleibt hart Deutsch
- **Prioritaet**: P0
- **Modus**: offline (npm test, MCP-Handler-Ebene)
- **Vorbedingung**: `settings.language = "en"`, Gateway-Mock liefert ein Transkript mit einer Callee-Zeile (Muster `RICH_CALL` aus `test/mcp-ui.test.js:75-88`)
- **Schritte**:
  1. `get_call_status` bzw. `place_call` fuer einen als EN konfigurierten Tenant aufrufen.
  2. `structuredContent.last_transcript_lines` inspizieren (das ist exakt das Array, das `call.html`s `renderTranscriptLines` unveraendert per `textContent` rendert).
- **Erwartetes Ergebnis**: HEUTE enthaelt jede Zeile der Gegenseite das Woertliche Praefix `"Gegenseite: "`, UNABHAENGIG von `settings.language`. Deterministisch: `assert.ok(lines.some(l => l.startsWith("Gegenseite: ")))`.
- **Verifikation**: `test/mcp-tools-i18n.test.js` (siehe `04-mcp-und-widgets.md` Testfall MCP-06, dort bereits spezifiziert) - dieser Testfall ist der Widget-seitige Nachweis, dass der Rohwert 1:1 in der Live-Karte landet (kein zusaetzlicher Uebersetzungsschritt im Widget-Bind-Pfad).
- **Heute erwartbar**: rot (als Soll fuer einen EN-Tenant) / gruen (als Beweis der heutigen Luecke) - `pickCallStatus` verzweigt nicht nach Sprache (`src/mcp-tools.js:110`), und `renderTranscriptLines` in `call.html` haengt keine Uebersetzung an (`src/ui/widgets/call.html:511-524` bindet nur die geteilte `.turn`-Klasse, ruft nirgends `t()` fuer den Zeileninhalt auf).
- **Belegt durch**: `src/mcp-tools.js:103-115` (Zeile 110); `src/ui/widgets/call.html:511-524` (`renderTranscriptLines`, kein `t()`-Aufruf)

### UI-09 - Achsen-Divergenz in EINER call.html-Karte (drei Sprachen gleichzeitig)
- **Prioritaet**: P0
- **Modus**: offline (npm test, kombiniert Fixture)
- **Vorbedingung**: Tenant mit `settings.language = "fr"` (Anrufsprache Franzoesisch, Achse D), Gateway-Mock liefert `c.summary` auf Franzoesisch (wie `claude.js summarizeCall` es fuer FR erzeugen wuerde) und ein Transkript mit Callee-Zeile; Test simuliert `navigator.language = "en-US"` fuer die Widget-Chrome-Achse (A).
- **Schritte**:
  1. `place_call`/`get_call_status`/`get_transcript` mit obiger Fixture ueber die Handler-Ebene aufrufen.
  2. `structuredContent.result_summary` (franzoesisch, Achse D), `structuredContent.last_transcript_lines` (deutsches Praefix, Achse B2/keine Achse) UND die per `resolveLocale(["en-US"], WIDGET_DICT)` aufgeloeste Chrome-Locale (englisch, Achse A) gemeinsam pruefen.
- **Erwartetes Ergebnis**: Alle drei Werte liegen gleichzeitig vor und sind in DREI verschiedenen Sprachen: Chrome-Label `"Result"` (Achse A, englisch) neben dem Wert `data.result_summary` (Achse D, franzoesisch) neben einer Transkriptzeile `"Gegenseite: ..."` (fest deutsch). Deterministisch: drei unabhaengige Assertions in einem Testlauf.
- **Verifikation**: Neue Datei `test/mcp-ui-i18n-divergence.test.js` (kombiniert bestehende Fixtures aus `test/mcp-ui.test.js` und `test/mcp-ui-widget-i18n.test.js`, importiert `resolveLocale`/`WIDGET_DICT` direkt statt einen echten Iframe zu bauen).
- **Heute erwartbar**: gruen (als Beweis der Divergenz - der Test soll HEUTE zeigen, dass alle drei Sprachen gleichzeitig auftreten, nicht dass sie synchron sind).
- **Belegt durch**: `src/mcp-tools.js:110` (deutsches Praefix); `src/mcp-tools.js:132-140` (result_summary = `c.summary`, sprachabhaengig via `src/claude.js:665`); `src/ui/widget-i18n.js:113-120` (Chrome-Locale unabhaengig davon)

### UI-10 - Waehrungslabel "(EUR)" ist in JEDEM WIDGET_DICT-Eintrag hart, unabhaengig von paymentCurrency
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: keine (reine Quelldaten-Pruefung)
- **Schritte**:
  1. Alle Keys aus `WIDGET_DICT.de` (oder `.fr`) filtern, die `"(EUR)"` im KEY-NAMEN tragen.
  2. Pruefen, dass die zugehoerigen Uebersetzungen ebenfalls `"(EUR)"` bzw. `"EUR"` enthalten.
- **Erwartetes Ergebnis**: 4 Keys tragen `"(EUR)"` im Key selbst (`"AI cost, lifetime (EUR)"`, `"Your budget, lifetime (EUR)"`, `"AI cost, this month (EUR)"`, `"Reserved now (EUR)"`); ALLE zugehoerigen de/fr-Uebersetzungen enthalten ebenfalls `"(EUR)"`. Deterministisch: `assert.equal(count, 4)` und ein `assert.match(/\(EUR\)/)` je Uebersetzung.
- **Verifikation**: Neuer Testfall in `test/mcp-ui-widget-i18n.test.js` oder `test/mcp-ui-widget-i18n-currency.test.js`; `grep -c "(EUR)" src/ui/widget-i18n.js` (erwartet: 8 = 4 Keys x 2 Sprachen, plus der EN-Fallback ueber den Key selbst macht es effektiv in JEDER Sprache sichtbar).
- **Heute erwartbar**: rot als Soll (waehrungsparametrisiert) / gruen als Beweis der Luecke (Literal ueberall vorhanden) - siehe `04-mcp-und-widgets.md` Testfall MCP-08 fuer die Text-Seite derselben Luecke.
- **Belegt durch**: `src/ui/widget-i18n.js:40-44,78-82`; `src/config.js:362` (`paymentCurrency`, Default `"eur"`, per Env `PAYMENT_CURRENCY` uebersteuerbar - Widget-Dict liest diesen Wert NIE)

### UI-11 - fmt() in list_calls/get_calendar ignoriert dateLocale, immer de-DE-Format
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: Gateway-Mock liefert einen Call mit fixem ISO-Datum `"2026-07-22T14:30:00.000Z"`, `settings.language = "en"`
- **Schritte**:
  1. `list_calls` fuer den EN-Tenant aufrufen.
  2. `structuredContent.calls[0].startedAt` pruefen.
- **Erwartetes Ergebnis**: HEUTE ein de-DE-formatierter String (Wochentagskuerzel `Mo/Di/Mi/Do/Fr/Sa/So`, `TT.MM.`-Datum, 24h-Zeit), UNABHAENGIG von `settings.language`. Deterministisch: `assert.match(startedAt, /^(Mo|Di|Mi|Do|Fr|Sa|So)\./)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js` (siehe `04-mcp-und-widgets.md` Testfall MCP-07, dort bereits spezifiziert inkl. Fix-Hinweis auf das bereits vorhandene `dateLocale`-Feld).
- **Heute erwartbar**: rot als Soll (EN-Format erwartet) / gruen als Beweis der Luecke - `fmt()` ruft immer `toLocaleString("de-DE", ...)`.
- **Belegt durch**: `src/mcp-tools.js:48-55` (`fmt`); `src/i18n/locales.js:98,170,219` (`dateLocale` existiert bereits je Sprache)

### UI-12 - calls.html/calendar.html: dynamische Row-Werte laufen NICHT durch translate()
- **Prioritaet**: P1
- **Modus**: offline (npm test, statische Quellanalyse)
- **Vorbedingung**: keine
- **Schritte**:
  1. `src/ui/widget-bind.js` (`applyField`,`renderRows`,`bind`) nach einem Aufruf von `translate(`/`HermesI18n` durchsuchen.
  2. Zum Vergleich `src/ui/widgets/call.html` nach `HermesI18n.t(` durchsuchen (positiv erwartet, als Gegenbeispiel).
- **Erwartetes Ergebnis**: 0 Treffer fuer `translate`/`HermesI18n` in `widget-bind.js`; >0 Treffer in `call.html`.
- **Verifikation**: `grep -c "translate\|HermesI18n" src/ui/widget-bind.js` (erwartet 0, tatsaechlich verifiziert: 0); `grep -oc '\bt("' src/ui/widgets/call.html` (erwartet >0, tatsaechlich verifiziert: 13 - `t()` ist der lokale Alias fuer `window.HermesI18n.t`, siehe Zeile 260-262).
- **Heute erwartbar**: gruen als Beweis der Inkonsistenz (die architektonische Luecke besteht tatsaechlich).
- **Belegt durch**: `src/ui/widget-bind.js:78-118` (kein translate-Aufruf); `src/ui/widgets/call.html:260-262,300-341` (Gegenbeispiel)

### UI-13 - XSS-Disziplin: uebersetzte UND dynamische Strings laufen ausschliesslich ueber textContent
- **Prioritaet**: P1
- **Modus**: offline (npm test, statische Quellanalyse + DOM-Verhaltenstest)
- **Vorbedingung**: keine
- **Schritte**:
  1. `src/ui/widget-i18n.js` (`localizeStaticLabels`) und `src/ui/widget-bind.js` (`renderLines`,`renderRows`,`applyField`) nach `innerHTML`/`insertAdjacentHTML` durchsuchen.
  2. Funktionsverhalten pruefen: ein Wert wie `"<img src=x onerror=alert(1)>"` durch `applyField`/`translate` schicken, DOM-Ergebnis inspizieren (Fake-DOM: `textContent`-Zuweisung, kein Parsing).
- **Erwartetes Ergebnis**: 0 Treffer fuer `innerHTML`/`insertAdjacentHTML` in beiden Dateien; ein bewusst boesartiger String erscheint im Fake-DOM als reiner Text (kein `<img>`-Element wird erzeugt).
- **Verifikation**: `grep -c "\.innerHTML\s*=\|insertAdjacentHTML(" src/ui/widget-i18n.js src/ui/widget-bind.js` (erwartet 0 in beiden - tatsaechlich verifiziert: 0/0; ein simpler `grep -c "innerHTML"` ohne Praezisierung liefert faelschlich 1/2 Treffer, weil beide Dateien die Disziplin selbst in Kommentaren benennen, z.B. `widget-bind.js:12` "NIE ueber innerHTML" - das ist Dokumentation, keine Nutzung); ergaenzender Node-Test mit Fake-DOM-Element, das `textContent`-Zuweisungen zaehlt statt HTML zu parsen.
- **Heute erwartbar**: gruen - Kopfkommentare beider Dateien benennen die Disziplin explizit, der praezisierte `grep` bestaetigt 0 tatsaechliche Nutzungsstellen.
- **Belegt durch**: `src/ui/widget-i18n.js:11-16,131-137` (`localizeStaticLabels`); `src/ui/widget-bind.js:10-12,52-118` (Kopfkommentar + `renderLines`/`renderRows`/`applyField`)

### UI-14 - Kein Host-Signal fuer Chat-Sprache/Land im gesamten MCP-Wire-Vertrag
- **Prioritaet**: P0
- **Modus**: offline (npm test, statische Quellanalyse ueber mehrere Dateien)
- **Vorbedingung**: keine
- **Schritte**:
  1. `grep -rn "locale\|language\|country" src/ui/registry.js src/ui/contract.js src/ui/adapters/mcp-native.js src/ui/adapters/chatgpt.js` ausfuehren.
  2. `grep -rn "Accept-Language" src/` ausfuehren.
  3. Die `ui/initialize`-Nachricht in `src/ui/widget-bind.js:177-191` (`params`-Objekt) auf ein Locale-/Land-Feld inspizieren.
- **Erwartetes Ergebnis**: (1) liefert 0 Treffer (verifiziert: nicht mal ein Kommentar in diesen 4 Dateien erwaehnt locale/language/country); (2) liefert 0 Treffer; (3) das `params`-Objekt enthaelt exakt `{ appCapabilities, appInfo, protocolVersion }`, kein weiteres Feld.
- **Verifikation**: die drei obigen `grep`/Lese-Kommandos direkt; ergaenzend ein `node --test`, das `contract.js`/`registry.js` importiert und `Object.keys` der von `uiRendererFor`/`makeUiRenderer` konsumierten/erzeugten Objekte gegen eine feste Whitelist ohne Locale-Feld prueft.
- **Heute erwartbar**: gruen - dies ist der zentrale, direkt aus dem Code belegte Beweis fuer Kernfrage 2 (kein Host-Signal vorhanden).
- **Belegt durch**: `src/ui/registry.js:43-50`; `src/ui/contract.js` (komplett, keine Locale-Konstante); `src/ui/widget-bind.js:177-191`; `src/routes/mcp.js:84` (`capabilities` = MCP-Protokoll-Capabilities, nicht Locale)

### UI-15 - Fehlende Widget-Dict-Sprache faellt komplett auf Englisch, Agentensprache bleibt unberuehrt
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: `settings.language = "fr"` (gueltige, unterstuetzte Anrufsprache), simulierte Browser-Locale `es-ES`/`it-IT`/`nl-NL`/`pt-PT`/`ja-JP` (kein Dict-Eintrag)
- **Schritte**:
  1. Fuer jede der 5 Browser-Locales `resolveLocale([locale], WIDGET_DICT)` aufrufen.
  2. Parallel `resolveCallLanguage`/`localeFor` mit `settings.language = "fr"` aufrufen.
- **Erwartetes Ergebnis**: Alle 5 Chrome-Locale-Aufloesungen liefern `"en"` (DEFAULT_LOCALE); die Anrufsprache bleibt in JEDEM Fall `"fr"` - die beiden Werte sind unabhaengig (keiner beeinflusst den anderen).
- **Verifikation**: Parametrisierter Node-Test ueber `["es-ES","it-IT","nl-NL","pt-PT","ja-JP"]`; `assert.equal(resolveLocale([locale], WIDGET_DICT), "en")` je Iteration, plus ein separater Assert `localeFor("fr").language === "fr"`.
- **Heute erwartbar**: gruen - `resolveLocale` ist bereits fail-safe implementiert; die Unabhaengigkeit von D ist ebenfalls strukturell korrekt (zwei getrennte Module).
- **Belegt durch**: `src/ui/widget-i18n.js:113-120`; `src/i18n/locales.js:285-287` (`localeFor`)

### UI-16 - permissionsSummary()-Wert bleibt deutsch, obwohl das Zeilen-Label uebersetzt ist
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `settings = { allowSummaries: true, allowPersonalData: false, allowBankData: false }`, simulierte Browser-Locale `en-US`
- **Schritte**:
  1. `get_agent_status` aufrufen, `structuredContent.permissions` lesen.
  2. Parallel `resolveLocale(["en-US"], WIDGET_DICT)` und `translate(WIDGET_DICT, "en", "Permissions")` aufrufen (das Zeilen-Label).
- **Erwartetes Ergebnis**: Das Zeilen-Label ist `"Permissions"` (Achse A, Englisch), der WERT ist `"Summaries=true, PersoenlicheDaten=false, Bankdaten=false"` (Achse C, hart Deutsch) - Label und Wert derselben Widget-Zeile stehen in verschiedenen Sprachen. Deterministisch: `assert.match(structuredContent.permissions, /PersoenlicheDaten|Bankdaten/)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js` (siehe `04-mcp-und-widgets.md` Testfall MCP-09/MCP-21).
- **Heute erwartbar**: gruen als Beweis der Luecke (der deutsche Wert steht bereits byte-gepinnt in `test/mcp-ui.test.js:682`, `PERMISSIONS_STR`).
- **Belegt durch**: `src/mcp-tools.js:194-199` (`permissionsSummary`); `src/ui/widgets/agent-status.html:55` (`data-mcp="permissions"` neben `data-i18n="Permissions"`); `test/mcp-ui.test.js:682` (bestehender Pin)

### UI-17 - get_agent_status-Textblock (content[0].text) ist vollstaendig hart Deutsch
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `settings.language = "en"`, `navigator.language` irrelevant (dieser Text ist Stufe-0, kein Widget noetig)
- **Schritte**:
  1. `get_agent_status` fuer einen EN-Tenant aufrufen.
  2. `content[0].text` (der Fallback-Text ohne Widget-Host bzw. der vom Modell zitierte Text) inspizieren.
- **Erwartetes Ergebnis**: HEUTE enthaelt der Text deutsche Labels (`"Agent-Nummer:"`, `"Besitzer:"`, `"Berechtigungen:"`), unabhaengig von `settings.language` oder Browser. Deterministisch: `assert.match(text, /Agent-Nummer:/)`.
- **Verifikation**: `test/mcp-tools-i18n.test.js` (siehe `04-mcp-und-widgets.md` Testfall MCP-15).
- **Heute erwartbar**: gruen als Beweis der Luecke - `content[0].text` wird unabhaengig von jedem Kontext identisch gebaut.
- **Belegt durch**: `src/mcp-tools.js:702-715` (Textblock-Konstruktion, Zeilen 705-710)

### UI-18 - "Land = Frankreich" ohne Browser-Locale-Wechsel aendert die Widget-Sprache NICHT (Owner-Anforderung widerlegt)
- **Prioritaet**: P0
- **Modus**: offline (npm test, kombiniert mit Kernfrage-2-Beweis)
- **Vorbedingung**: Tenant mit `tenant.country = "FR"` (gesetzt via `setTenantGeo`), simulierte Browser-Locale `en-US` (kein FR-Signal im Browser)
- **Schritte**:
  1. `tenantGeo(s, tenantId)` aufrufen -> `{ country: "FR", ... }` bestaetigen.
  2. `resolveLocale(["en-US"], WIDGET_DICT)` aufrufen (das ist der einzige Chrome-Locale-Pfad, der existiert - `tenant.country` fliesst dort NICHT ein, siehe UI-14).
- **Erwartetes Ergebnis**: `tenantGeo` liefert korrekt `"FR"` (der Server KENNT das Land), aber die Widget-Chrome-Locale bleibt `"en"` - `tenant.country` wird an KEINER Stelle im Widget-Rendering-Pfad gelesen. Deterministisch: `assert.equal(resolveLocale(["en-US"], WIDGET_DICT), "en")` trotz `tenant.country === "FR"`.
- **Verifikation**: Neuer Testfall, kombiniert `state-ops.js` (`setTenantGeo`/`tenantGeo`) mit `widget-i18n.js` (`resolveLocale`) in einem gemeinsamen Testlauf, der zeigt: kein Datenfluss zwischen beiden.
- **Heute erwartbar**: gruen als direkter Beweis, dass die woertliche Owner-Anforderung ("franzoesisch, wenn er in Frankreich ist") strukturell nicht erfuellbar ist, ohne Code zu aendern - das Land ist bekannt, wird aber nirgends konsultiert.
- **Belegt durch**: `src/store/state-ops.js:1187-1201` (`setTenantGeo`/`tenantGeo`); `src/ui/widget-i18n.js:161` (einziger Locale-Pfad, liest `navigator.language`, nicht `tenant.country`)

### UI-19 - Geteilte Karte: zwei Betrachter mit unterschiedlicher Browser-Locale sehen unterschiedliche Chrome-Sprache
- **Prioritaet**: P2
- **Modus**: offline (node, reine Funktionspruefung)
- **Vorbedingung**: keine
- **Schritte**:
  1. `resolveLocale(["de-DE"], WIDGET_DICT)` (Betrachter A) und `resolveLocale(["en-GB"], WIDGET_DICT)` (Betrachter B) fuer dieselbe (identische) `structuredContent`-Fixture aufrufen.
- **Erwartetes Ergebnis**: Betrachter A erhaelt `"de"`, Betrachter B `"en"` - fuer EXAKT dieselben Server-Daten unterschiedliche Chrome-Sprachen, weil die Locale rein pro-Iframe-Instanz aus der jeweils LOKALEN `navigator.language` aufgeloest wird (kein serverseitiger/geteilter Zustand).
- **Verifikation**: Direkter Aufruf von `resolveLocale` mit zwei verschiedenen Kandidatenlisten im selben Testlauf, `assert.notEqual` der beiden Ergebnisse.
- **Heute erwartbar**: gruen - strukturell zwingend aus der reinen, zustandslosen Funktion `resolveLocale` (`src/ui/widget-i18n.js:113-120`) und der Tatsache, dass `WIDGET_HTML` byte-identisch fuer jeden Request ist (`src/ui/widget-catalog.js:140-150`).
- **Belegt durch**: `src/ui/widget-i18n.js:113-120,161`; `src/ui/widget-catalog.js:140-150`

### UI-20 - navigator.language-Verlaesslichkeit im echten claude.ai-Iframe-Sandbox
- **Prioritaet**: P1
- **Modus**: manuell (echte claude.ai-Session, Browser-Systemsprache wechseln)
- **Vorbedingung**: claude.ai-Session mit Hermes-Connector, `MCP_UI_ENABLED`/`mcpUiEnabled=true`, ein Widget (z.B. `agent-status`) wird im Chat gerendert
- **Schritte**:
  1. Browser-/System-Sprache auf `en-US` stellen, Widget rendern lassen, per DevTools `window.HermesI18n.locale` im Iframe auslesen.
  2. Browser-/System-Sprache auf `fr-FR` stellen, denselben Chat neu laden, erneut auslesen.
  3. Ergebnis mit dem erwarteten Wert (`"en"` bzw. `"fr"`) vergleichen; insbesondere pruefen, ob claude.ai den Iframe evtl. in einer eigenen Sandbox mit ANDERER `navigator.language` rendert (z.B. fixe Werksprache des Renderers statt System-/Browser-Sprache).
- **Erwartetes Ergebnis**: `window.HermesI18n.locale` entspricht der jeweils eingestellten Systemsprache. Deterministisch pruefbar per DevTools-Konsole, aber nur live beobachtbar - dies ist eine grundlegende, bisher UNGEPRUEFTE Annahme, auf der Achse A vollstaendig beruht.
- **Verifikation**: Manuelles DevTools-Protokoll (Screenshot der Konsolen-Ausgabe je Sprachstellung), kein automatisiertes Kommando.
- **Heute erwartbar**: unbekannt - haengt vom claude.ai-Host-Verhalten ab, im Repo-Code nicht pruefbar. Falls der Host den Iframe in einer eigenen, vom System entkoppelten Sandbox rendert, ist selbst die heutige Achse-A-Implementierung wirkungslos.
- **Belegt durch**: `src/ui/widget-i18n.js:161` (Code-seitiger Mechanismus) - Host-Verhalten selbst nicht code-basiert nachweisbar

## Nicht testbar - Produktentscheidung noetig

1. **Soll die Widget-Chrome (Achse A) der Chat-/Browser-Sprache des Betrachters folgen
   oder der Tenant-/Anruf-Sprache (Achse D)?** Heute folgt sie ausschliesslich A (Browser).
   Empfehlung: A BEIBEHALTEN fuer die Chrome (Labels/Buttons) - `navigator.language` ist
   die einzige tatsaechlich verfuegbare Naeherung an "die Sprache, in der der Nutzer
   gerade chattet", und mehrere Betrachter derselben Karte (Divergenz-Zeile 6) koennen
   ohnehin nur pro-Betrachter bedient werden. ABER: alle serverseitig erzeugten Inhalte
   (Transkript-Praefix, Fehlermeldungen, Tool-Beschreibungen, `content[0].text`-Bloecke,
   Datumsformat) sollten der TENANT-Sprache (Achse D, dem Server bereits bekannt ueber
   `scopedTenant`) folgen, nicht hart Deutsch bleiben - das ist kein Signal-Problem
   (anders als Chrome), sondern schlicht unimplementiert (Achse C/E1 lesen `settings.language`
   an KEINER Stelle, obwohl `resolveCallLanguage`/`localeFor` fertig vorliegen).
2. **Soll "Land des Nutzers" ueberhaupt eine Signalquelle fuer die Widget-Chrome werden,
   und wenn ja, ueber welchen Kanal?** Ein sandboxed Iframe hat kein verlaessliches
   Land-Signal (keine IP-Geolocation ohne neuen Netzwerkaufruf aus dem Iframe heraus, was
   der Wire-Vertrag/CSP nicht vorsieht). Die einzige belastbare Quelle ist
   `tenant.country`/`number.country` (bereits im Store, `state-ops.js:1187-1201`) -
   das beschreibt aber den Tenant/die angerufene Nummer, NICHT zwingend den physischen
   Standort des gerade chattenden Betrachters (kann eine andere Person sein, z.B. ein
   Support-Mitarbeiter, der den Hermes-Tenant eines Kunden verwaltet). Empfehlung: die
   woertliche Owner-Formulierung "Land des Nutzers" AUFGEBEN und durch "Land/Sprache des
   TENANTS" ersetzen (technisch bereits vorhanden, siehe Punkt 1) - eine echte
   Betrachter-Geolocation ist im MCP-Wire-Vertrag heute nicht vorgesehen und wuerde einen
   neuen, review-pflichtigen Mechanismus brauchen (z.B. serverseitiges IP-Lookup beim
   `/mcp`-POST-Request selbst, NICHT im Iframe).
3. **Soll `"(EUR)"` waehrungsparametrisiert werden, und was ist der tatsaechliche
   Live-Wert von `PAYMENT_CURRENCY`?** Diese Frage ist rein operativ (Render-Dashboard,
   nicht aus dem Repo pruefbar) und bereits in `04-mcp-und-widgets.md` Testfall MCP-19
   offengelegt - keine neue Entscheidung, nur ein Verweis, um Doppelarbeit zu vermeiden.
4. **Soll `fmt()` (Datum/Zeit) `dateLocale` konsumieren - und aus welcher Achse?** Der
   MCP-Tool-Layer kennt NIE die Browser-Locale des Betrachters (die erreicht den Server
   nie, siehe Kernfrage 2) - nur die Tenant-/Anrufsprache (Achse D) ist ihm bekannt.
   Empfehlung: `fmt()` auf `localeFor(resolveCallLanguage(...)).dateLocale` umstellen
   (Achse D als Quelle, analog zu `src/claude.js:43`) - eine Umstellung auf Achse A ist
   architektonisch gar nicht moeglich, ohne die Browser-Locale zum Server zu transportieren.
5. **Sollen die dynamischen Row-Werte in `calls.html`/`calendar.html` (Status-Enum,
   Direction) analog zu `call.html` durch `window.HermesI18n.t()` laufen?** Das wuerde
   Konsistenz herstellen (heute uebersetzt NUR `call.html` seine dynamischen Werte selbst,
   `widget-bind.js` fuer die anderen 4 Widgets nie). Empfehlung: JA, mit denselben
   Status-Token-Keys, die `call.html` bereits definiert (`STATUS_VIEW`,
   `src/ui/widgets/call.html:300-341`) - Wiederverwendung statt Neuerfindung.
