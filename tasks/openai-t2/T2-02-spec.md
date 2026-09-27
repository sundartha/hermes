# T2-02 - Widget: cache-feste, sprachunabhaengige Resource-URIs (Spec fuer den Bau-Agenten)

- Umfang: GENAU T-34 ("ChatGPT may continue serving cached resource contents for up to one hour.",
  developers.openai.com/plugins/deploy/app-review; Plan 2.1: "version resource identifiers when HTML,
  JavaScript, or CSS changes").
- Branch/Worktree: `phase/openai-t2-02-widget-uris`, Worktree unter dem Scratchpad (`wt-t2-02`), Basis a941d23.
- T2-01 (csp/Alias am Resource-Inhalt, `ui.domain` nur bei ChatGPT-Egress-IP) bleibt unangetastet.
- Keine neue Env-Variable. Keine Safety-Gates, kein Offenlegungssatz beruehrt.
- Baseline im Worktree (a941d23): die 9 betroffenen UI-Testdateien 144/144 gruen.

## Kernentscheidungen (am Code begruendet)

1. **URI-Form:** `ui://hermes/<widgetId>/v<N>.html` (Muster des OpenAI-Beispiels `ui://project-board/v1.html`).
   Version PRO Widget, nicht global.
2. **Pin-Datei:** `src/ui/widget-versions.json`, je Widget eine Abbildung Version -> SHA-256 des
   AUSGELIEFERTEN HTML (`widgetHtml(id)`, also inkl. aller Injektionen: HUD-CSS, Wing-Assets,
   Wing-Engine, Mount, I18N-Script, BIND_SCRIPT). Die hoechste Version ist die aktive. Laufzeit liest
   nur die Version (readFileSync-Muster wie `chatgpt-egress.js:28-35`). Fehlt fuer ein Widget ein
   Eintrag -> `hasWidget()` false -> Stufe-0-only (fail-closed, KEIN Boot-Abbruch).
3. **Sprachunabhaengiges HTML:** ein einziges I18N-Script mit ALLEN Tabellen aus `WIDGET_DICT`
   (de, fr; en = Keys). Start-Locale `en` (sichtbar bis zum ersten Tool-Ergebnis - bewusste Folge,
   s. Pre-Mortem). Die Sprache wird im Iframe umgeschaltet.
4. **Sprachkanal = Ergebnis-`_meta`, NICHT `structuredContent`:** Schluessel
   `WIDGET_LOCALE_META_KEY = "hermes/locale"` am `CallToolResult._meta` der 5 Widget-Werkzeuge.
   Gruende: (a) `structuredContent` ist eine gepinnte Whitelist mit outputSchema - ein Feld mehr
   aendert 5 outputSchemas im tools/list-Snapshot (T-33) und bricht ~13 `deepEqual(Object.keys(
   structuredContent))`-Tests in `test/mcp-ui.test.js` (u.a. :183, :318, :760, :1037, :1287);
   (b) `_meta` am Ergebnis ist laut OpenAI nur fuer die Komponente, nicht fuers Modell;
   (c) MCP Apps: `ui/notifications/tool-result` traegt das CallToolResult als params -> `params._meta`.
   Das Widget liest den Wert NUR ueber die MCP-Apps-Bruecke (postMessage), NIE ueber `window.openai`
   (UI-03 verbietet `window.openai`/`navigator` im ausgelieferten HTML).
5. **Umschalten im Iframe:** das I18N-Script (im `<head>`, laeuft VOR call.html-Inline-Skript und
   BIND_SCRIPT) registriert als ERSTER einen `message`-Listener; bei `ui/notifications/tool-result`
   mit String in `params._meta["hermes/locale"]` -> `setLocale()` (Aufloesung wie `resolveLocale`,
   unbekannt -> en), `documentElement.lang`, `HermesI18n.locale`, statische `[data-i18n]` neu.
   Listener-Reihenfolge = Registrierungsreihenfolge -> die Sprache steht, bevor dieselbe Nachricht
   gebunden wird.

## Schritte

### S1 - Pin-Datei + Versionszugriff + URI-Fabrik
- Was: `src/ui/widget-versions.json` anlegen (5 Widgets, je `{ "1": "<sha256 des NEUEN html>" }`,
  Kopf-`_comment` mit Regel "HTML-Aenderung = neue Version, alte Eintraege nie ueberschreiben");
  `widget-catalog.js` exportiert `widgetVersion(id)` (hoechster Schluessel), `hasWidget` zusaetzlich an
  vorhandene Version gebunden; `contract.js` `uiResourceUri(widgetId)` -> `ui://hermes/<id>/v<N>.html`.
- Wo: `src/ui/contract.js:19-22` (UI_URI_PREFIX/uiResourceUri), `src/ui/widget-catalog.js:170-177`.
- IDs: T-34. Pfade: HTTP /mcp (OAuth + Token/Legacy) und stdio (beide ueber `makeUiRenderer`).
- Beweis: (b) neuer Test ueber den echten Draht: jede `_meta.ui.resourceUri` aus `tools/list` steht in
  `resources/list`, matcht `/^ui:\/\/hermes\/[a-z-]+\/v\d+\.html$/` - HTTP OAuth (Interface-IP),
  HTTP Token (Loopback mit Bearer, Muster T2-01 T2a) und stdio (Kindprozess).

### S2 - Ein I18N-Script fuer alle Sprachen, Umschalten per Tool-Ergebnis
- Was: `widget-i18n.js`: `buildI18nScript()` ohne Locale-Parameter, bettet volles `WIDGET_DICT` ein,
  projiziert `primaryLanguage`/`resolveLocale` (toString-Muster), Start `en`, `setLocale`, eigener
  message-Listener (Methodenname `ui/notifications/tool-result` als benannte Konstante; EINE Quelle
  mit widget-bind.js `METHOD_TOOL_RESULT` - exportieren statt Literal duplizieren),
  `export const WIDGET_LOCALE_META_KEY`. `I18N_SCRIPT_BY_LOCALE` -> ein `I18N_SCRIPT`;
  `widgetDictFor` entfaellt, falls ohne Aufrufer (kein toter Code).
- Wo: `src/ui/widget-i18n.js:135-194`.
- IDs: T-34. Pfade: Widget-intern (fuer alle Hosts gleich).
- Beweis: (b) vm-Test (Muster UI-04, `test/mcp-ui-widget-i18n.test.js:296-316`): Script ausfuehren ->
  `lang==="en"`, `t("Duration")==="Duration"`; danach Fake-message `{method:"ui/notifications/tool-result",
  params:{_meta:{"hermes/locale":"de"}, structuredContent:{}}}` -> `lang==="de"`, `t("Duration")==="Dauer"`,
  ein `[data-i18n]`-Fake-Element traegt den DE-Text; dasselbe fuer fr; "xx"/fehlend -> bleibt en;
  Nicht-String/Objekt -> bleibt en (kein Wurf).

### S3 - Katalog liefert EINE Fassung je Widget
- Was: `WIDGET_HTML_BY_LOCALE` (Stufe 2) entfaellt; `widgetHtml(widgetId)` ohne Sprache;
  `withI18nScript(html)` ohne Sprache. Kopfkommentare (P13/E4-Aussagen "Sprache ist Teil des
  Schluessels") nachziehen.
- Wo: `src/ui/widget-catalog.js:82-94`, `:158-176`.
- IDs: T-34. Pfade: HTTP + stdio (eine Quelle).
- Beweis: (b) HTTP-OAuth-Drahttest: `resources/read` fuer DE- und EN-Tenant (zwei Tokens, Interface-IP,
  Seed wie `twoTenantSeed` in `test/openai-t2-01-widget-resource-meta.test.js:133-160`) liefert fuer
  alle 5 Widgets byte-gleichen `contents[0].text`; zusaetzlich stdio-`text` == HTTP-`text`.

### S4 - Resource-Registrierung ohne Sprache
- Was: `makeUiRenderer.registerResource(server, widgetId, { chatgptEgress })` - `language` raus;
  `widgetResourceOptions(uiHost)` in mcp-tools; JSDoc in `src/ui/ports.js:12`; Kommentar
  `src/ui/registry.js:9`, `contract.js:130-138`.
- Wo: `src/ui/contract.js:139-151`, `src/mcp-tools.js:822-824`, `:892`.
- IDs: T-34. Pfade: HTTP + stdio.
- Beweis: (a) `git grep -n "language" src/ui/contract.js` zeigt keinen Sprachparameter mehr an
  registerResource; (b) S3-Drahttest.

### S5 - call.html: Status-Labels erst beim Anwenden uebersetzen
- Was: `STATUS_VIEW` traegt Keys statt vorab uebersetzter Strings (`pillLabel: t("Connecting")` ->
  Key), `updateStatusPill`/`updateHudPhase` rufen `t(view.<key>)` zur Anwendezeit. Sonst bleiben
  Pill/HUD-Unterzeile nach dem Umschalten englisch (heute: `call.html:323-361` rechnet t() beim Laden).
- Wo: `src/ui/widgets/call.html:323-361`, `:531-543`.
- IDs: T-34. Pfade: Widget-intern.
- Beweis: (b) vm-Test mit I18N_SCRIPT + call.html-Inline-Skript (Harness `test/mcp-ui-w1-call-widget.
  test.js:150-160` erweitern): tool-result mit `_meta de` + `structuredContent.status="in_progress"`
  -> `[data-status-label]` = "Live", `[data-hud-phase]` = "Im Gespräch"; ohne `_meta` -> "In call".
  Bestandstest `:345` (ohne I18N -> "Yes") bleibt gruen.

### S6 - Sprachfeld am Ergebnis der Widget-Werkzeuge
- Was: modulweiter Helfer `withWidgetLocale(config, handler, language)` in `src/mcp-tools.js`:
  traegt `config._meta?.[UI_META_KEY]?.resourceUri` (also nur die 5 Widget-Werkzeuge bei faehigem
  Host), setzt bei Nicht-Fehler-Ergebnis `_meta: { ...result._meta, [WIDGET_LOCALE_META_KEY]:
  loc.language }`; sonst Handler unveraendert. Eingehaengt in `uiTool` (`:928-929`) VOR `wrapHandler`
  -> Fehlerergebnisse tragen nichts. Zeilenzahl von `registerTools` (Lint-Pin 508,
  `eslint-legacy-exceptions.json:142`) NICHT erhoehen; aendert sie sich doch: mit
  `npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js --format json`
  neu messen und den Pin-Text nach Bestandsmuster nachziehen.
- Wo: `src/mcp-tools.js:822-829` (Helfer daneben), `:928-929`.
- IDs: T-34. Pfade: HTTP /mcp (OAuth + Token/Legacy) und stdio (stdio: `loc.language` = Weltdefault).
- Beweis: (b) Drahttest HTTP OAuth: `tools/call get_my_number` (oder `get_agent_status`) fuer DE-Tenant
  -> `result._meta["hermes/locale"]==="de"`, EN-Tenant -> "en"; stdio -> vorhanden und = Weltdefault;
  ein Nicht-Widget-Werkzeug (z.B. `list_action_items`) traegt den Schluessel NICHT; ohne UI-Host
  (`MCP_UI_ENABLED=false`) traegt ihn kein Werkzeug; `structuredContent`-Schluessel unveraendert
  (Bestandstests `mcp-ui.test.js` bleiben gruen).

### S7 - Pin-Test mit Positiv-Kontrolle + Groessenbudget
- Was: neuer Test (a) fuer jedes Widget: SHA-256(`widgetHtml(id)`) == Pin der hoechsten Version,
  Meldung nennt die Regel ("Version hochzaehlen, neuen Eintrag anhaengen"); Prueflogik als reine
  Funktion `stalePins(htmlById, pins)`, Positiv-Kontrolle: ein Byte im HTML geaendert -> genau ein
  Fund; (b) keine zwei Versionen eines Widgets mit gleichem Hash; (c) jedes Widget hat einen Pin,
  kein Pin ohne Widget. Groesse: benannte Baseline-Konstanten (gemessen a941d23, groesste Fassung je
  Widget: agent-status 214943, my-number 213294, calls 214450, calendar 213767, call 247763 Bytes),
  Test `Buffer.byteLength(widgetHtml(id)) <= Baseline * 1.10` (Faktor als benannte Konstante).
  Erwartung: ca. +2-3 KB je Widget (~1 %). Bestandsgrenze `mcp-ui-w1-call-widget.test.js:807`
  (< 260 KB) bleibt gueltig.
- Wo: neue Datei `test/openai-t2-02-widget-uris.test.js`.
- IDs: T-34. Pfade: in-process (Hash ist quellgebunden, transportunabhaengig; Draht deckt S3 ab).
- Beweis: (b) der Test selbst, und Positiv-Kontrolle von Hand: ein Leerzeichen in
  `src/ui/widgets/my-number.html` einfuegen -> Test rot, zuruecknehmen -> gruen (im Bericht).

### S8 - Bestandstests auf den neuen Mechanismus umstellen (nicht loeschen)
- `test/mcp-ui-widget-i18n.test.js`: T-i18n-server-locale (:194), -fallback (:212), -inject-locale
  (:227), "ex UI-14" (:239), "ex UI-18" (:254), UI-03 (:276, Schleife ueber Locales entfaellt), UI-04
  (:296, jetzt: Start en + Umschalten per tool-result). Die Garantie "FR-Tenant sieht FR" wandert:
  Tenant FR -> `registerTools(language:"fr")` -> Ergebnis-`_meta` "fr" -> I18N-Script schaltet auf fr.
- `test/mcp-ui.test.js:816-832` ("Sprache erreicht die Resource") -> invertiert: Resource fuer de und
  en identisch; Sprache erreicht das ERGEBNIS.
- Hartkodiertes `"ui://hermes/call"` in `test/openai-p2-tool-metadaten.test.js:42`,
  `test/openai-p3-security-schemes.test.js:42`, `test/openai-p8-widget-ui.test.js:28` ->
  `uiResourceUri(WIDGET_CALL)`.
- `test/openai-t2-01-widget-resource-meta.test.js` T8 (:430ff, Schleife `widgetHtml(id, language)`)
  -> eine Fassung.
- Aufrufer `widgetHtml(id, lang)` in den uebrigen Testdateien (hud-card, wing-*, w1-bind) greifen
  schon einsprachig zu - nur pruefen.
- Beweis: (b) `npm test -- -- --test-concurrency=4 > log` -> `# fail 0`; rot nur, wenn isoliert rot.
  `npm run test:gates` vorher/nachher: Zahl der gruenen Katalogtests darf nicht sinken (UI-03/UI-04).

### S9 - Abschluss
- `node --check` fuer alle geaenderten src-Dateien; Lint (Commit-Hook) gruen ohne `--no-verify`.
- X-7-Nachmessung: `git grep -nE "openExternal|window\.open|href=" src/ui/widgets src/ui/*.js`
  -> keine neuen Treffer gegenueber a941d23 (Positiv-Kontrolle: Suchmuster gegen eine Probezeile).
- Bericht: Groesse je Widget vorher/nachher (Tabelle), Hash-Pins, Liste umgestellter Tests.

## Nicht bauen (mit Grund)
- Kein Sprachfeld in `structuredContent`/outputSchema (s. Kernentscheidung 4).
- Keine Sprache in der URI (Plan 2.1: tools/list-Snapshot waere mandantenabhaengig).
- Keine Auslieferung alter Versionen unter alten URIs (Aufwand; bewusst akzeptiert, s. Pre-Mortem 3).
- Kein automatisch aus dem Hash abgeleiteter URI (Plan verlangt explizite Pin-Datei + roten Test;
  der Versionssprung soll eine bewusste, reviewbare Entscheidung sein).
- Kein Lesen von `window.openai.toolResponseMetadata` (UI-03 verbietet es; eine Bruecke fuer alle Hosts).
- Keine Aenderung an `ui.domain`/csp/Alias (T2-01), keine Aenderung an widget-bind.js-Logik
  (Sprache hat einen eigenen Listener im I18N-Script; widget-bind nur, falls METHOD_TOOL_RESULT
  exportiert wird).
- Keine Aktualisierung von `tasks/openai-technik-schlussabnahme.md` (Schlussphase), keine Doku-Datei
  unter docs/ nennt die URIs (git grep leer).
- Keine neue Env-Variable.

## Pre-Mortem (ein Jahr spaeter war T2-02 ein Fehler - was passierte?)
1. **Deutsche Nutzer sahen in Claude ploetzlich englische Widgets.** Claude reicht `_meta` des
   Tool-Ergebnisses nicht an `ui/notifications/tool-result` durch. Entschaerft: fail-safe en (nie kaputt),
   Live-Probe OW-D prueft genau das; Rueckfall waere ein zusaetzliches Feld in structuredContent
   (eigene Entscheidung, nicht vorab).
2. **Flackern:** Karte startet englisch und springt beim Ergebnis auf DE. Bewusst akzeptiert (Plan);
   der Sprung passiert in derselben Nachricht wie das erste Daten-Binding, also vor jedem Inhalt.
3. **Alte Chats zeigen leere Karten nach einem Versionssprung** (alte URI nicht mehr registriert).
   Akzeptiert: genau die von OpenAI empfohlene Versionierung; Cache-Fenster 1 h.
4. **Versionssprung ohne Hash-Neuberechnung / Hash ohne Versionssprung ueberschrieben.** Der Test faengt
   "Hash geaendert, Version gleich"; das Ueberschreiben eines alten Eintrags faengt nur das Review
   (git diff der Pin-Datei) - Restrisiko, benannt.
5. **Widget komplett weg nach Deploy:** Pin fehlt -> `hasWidget` false -> Stufe 0 (Text) statt Absturz.
   Test S7(c) verhindert das vor dem Merge.
6. **Tool-Metadaten-Snapshot (T-33) aendert sich bei jedem Widget-Update** (resourceUri traegt die
   Version) -> nach Einreichung ggf. erneute Pruefung. Bewusste Folge von T-34.
7. **Groesse:** alle Tabellen eingebettet, ~+1 %; Budget-Test (<= +10 %) + Bestandsgrenze 260 KB.
8. **Kein Anruf-/Kosten-/Auth-Risiko:** Werkzeug-Handler, Gates, Offenlegung unveraendert;
   `withWidgetLocale` fasst nur das Ergebnis an, nie die Eingabe; Fehlerergebnisse unveraendert.
   Transkript-Leak: `_meta` traegt nur den Sprachcode.

## Widersprueche Plan <-> Code
- Plan nennt `src/ui/contract.js:18-20` fuer die URI - heute `:19-22`; `:158` (Sprache) - heute `:147`
  (T2-01 hat die Datei verschoben). `widget-catalog.js:175` stimmt.
- Plan-Dateiliste nennt `src/ui/widget-i18n.js` NICHT - dort sitzt die Einbettung aber
  (`buildI18nScript`/`I18N_SCRIPT_BY_LOCALE`, `:135-194`).
- Plan nennt `widget-bind.js` und `widgets/*.html` pauschal; tatsaechlich muss nur `call.html`
  (STATUS_VIEW `:323-361` uebersetzt beim Laden) geaendert werden, widget-bind.js nicht.
- Plan: "Sprachfeld am Tool-Ergebnis" - konkretisiert als Ergebnis-`_meta`, nicht structuredContent.
- Bestandstests aus P13/E4 pinnen das Gegenteil ("Sprache ist Teil des Cache-Schluessels") - Umstellung
  ist Teil dieser Phase.
- `tasks/openai-technik-schlussabnahme.md:82` fuehrt T-34 als "nur mit UI" - ueberholt durch
  Owner-Entscheidung (a) 2026-09-22.

## Owner-Punkte (nur Live-Proben, keine Deploy-Vorbedingung)
- OW-D (Claude, nach Deploy): Hermes-Connector in claude.ai mit einem DE-Tenant, "Wie ist meine
  Nummer?" -> Karte zeigt "Hermes · Agent-Nummer". Zeigt sie "Hermes · Agent Number", reicht Claude
  das Ergebnis-`_meta` nicht durch (Pre-Mortem 1) -> melden.
- OW-C (ChatGPT Developer Mode, nach Deploy): dasselbe; zusaetzlich nach Deploy einer neuen
  Widget-Version pruefen, dass die neue Karte sofort (nicht erst nach 1 h) erscheint.
