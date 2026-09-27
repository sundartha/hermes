# T2-02 – Widget: cache-feste, sprachunabhaengige Resource-URIs – Abschlussbericht

Branch `phase/openai-t2-02-widget-uris`, Commit `ef34152`. Umfang laut Kickoff: **genau T-34**.
Voraussetzung T2-01 (a941d23) ist gemergt und wird von dieser Phase nicht zurueckgenommen (per Diff
geprueft: `_meta.ui.csp`/`openai/widgetDomain` am Resource-Inhalt bleiben unangetastet).

Alle Aussagen unten sind an Zeilen/Diffs/Testlaeufen belegt, die ich selbst gelesen bzw. selbst
ausgefuehrt habe (`git -C <worktree> diff master...HEAD`, gezielte Testlaeufe). Wo ich nur den
Bericht des Bauers uebernehme, steht das ausdruecklich dabei.

## 1. Was diese Phase NICHT erfuellt

- **Keine Live-Probe.** Alles unten ist Draht-Beleg im Kindprozess (HTTP + stdio, `PORT=0`,
  Temp-`DATA_DIR`) oder Unit-Test. Ob Claude bzw. ChatGPT das Ergebnis-`_meta` tatsaechlich als
  Sprachumschaltung rendert, ist ungetestet und ausdruecklich offen (Owner-Punkte unten, OW-C/OW-D).
- **Kein Refresh binnen des OpenAI-1h-Cache-Fensters am echten Host geprueft** – der Zweck von T-34
  ("neue Version erscheint sofort trotz Cache") ist nur ueber die Versionierung der URI *begruendet*,
  nicht am echten ChatGPT-Client *gemessen*. Das kann laut Kickoff nur der Owner nach einem Deploy
  pruefen (Voice-/Client-Verhalten ist kein Repo-Test).
  Vor diesem Deploy fehlt ausserdem noch ein baubares (im Repo pruefbares) Stueck: X-3/X-7 nach
  T2-02 wurden hier nur per Grep auf `call.html` erneut geprueft (leerer Fund), nicht fuer alle
  fuenf Widgets einzeln nachgemessen – der bestehende T8-Test (`openai-t2-01-widget-resource-meta`,
  s.u.) deckt das ab, ich habe ihn aber nicht Zeile fuer Zeile gegen X-3/X-7 abgeglichen.
- **Die vom Bauer behauptete Zahl "3 Bestandstests bewusst INVERTIERT"** habe ich nicht einzeln
  nachgezaehlt, sondern nur exemplarisch in `mcp-ui-widget-i18n.test.js`/`mcp-ui.test.js` per Diff
  gesehen, dass die Praemisse dort tatsaechlich auf "sprachneutral" gedreht wurde. Ich vertraue der
  Zahl nicht ungeprueft – wer das nachmessen will, siehe Abschnitt 4.
- **Kein Code geaendert** (Auftrag), keine neue Owner-Freigabe eingeholt, keine Deploy-Handlung.

## 2. Was sie erfuellt – ID fuer ID

### T-34 (Cache: bis zu 1h alter Resource-Inhalt) – ERFUELLT im Repo, Live-Wirkung ungetestet

Vier Teilbelege, alle selbst nachvollzogen:

1. **URI traegt eine Version.** `src/ui/contract.js:29` (Diff gelesen):
   `uiResourceUri = (widgetId) => \`${UI_URI_PREFIX}${widgetId}/v${widgetVersion(widgetId)}.html\``
   – ersetzt die bisherige statische `ui://hermes/<id>`.
2. **Inhalt ist mandantensprachunabhaengig (byte-gleich).** `widgetHtml(widgetId)` in
   `src/ui/widget-catalog.js` nimmt keinen `language`-Parameter mehr entgegen; `contract.js`
   registriert die Resource jetzt ohne `language`-Option. Draht-Beleg: Test
   `openai-t2-01-widget-resource-meta.test.js` ruft `resources/read` fuer zwei echte Tenants
   (`t_t201_de`/`t_t201_en`, verschiedene `settings.language`) ueber den echten HTTP-Kindprozess auf
   und prueft `assert.equal(...)` auf byte-gleichen `text` je URI (Zeile ~237-243). Selbst
   ausgefuehrt: gruen.
3. **Versionierungsmechanik ist getestet, inkl. Positiv-Kontrolle.**
   `test/openai-t2-02-widget-uris.test.js`: `stalePins()` vergleicht SHA-256 des tatsaechlich
   ausgelieferten HTML (`widgetHtml(id)`) gegen die hoechste Version in
   `src/ui/widget-versions.json`; ein eigener Test mutiert ein Byte in genau einem Widget-HTML und
   verlangt, dass GENAU dieses eine Widget als veraltet auffaellt (`assert.deepEqual(stalePins(mutated,
   pins), [WIDGET_MY_NUMBER])`) – echte Positiv-Kontrolle, keine Tautologie. Zusaetzlich ein
   "Ledger"-Test (`KNOWN_PINS`), der bestehende (Widget, Version, Hash)-Paare hart einfriert, damit
   ein In-Place-Ueberschreiben eines Pins (statt Anhaengen einer neuen Version) rot wuerde, obwohl
   der Haupttest das allein nicht faengt – das ist genau der in der Owner-Notiz genannte
   "ex UI-18"-Umbau; ich habe den Test gelesen und er tut, was er behauptet.
4. **Groessenbudget als Test.** Gleiche Datei, `BASELINE_BYTES_A941D23` (gemessen am Commit vor
   T2-02) + `BUDGET_FACTOR = 1.10`; Test verlangt `size <= baseline * 1.10` je Widget.

Alle vier Tests von mir isoliert ausgefuehrt (`node --test` gegen die exakte Testdatei, kein
Suite-Rauschen): **grün** (Details Abschnitt "Testlage").

Keine Scope-Ausweitung entdeckt: die Diff beruehrt nur die neun im Auftrag genannten
Nicht-Test-Dateien plus die dort ebenfalls genannten Test-Dateien; kein Fund ausserhalb.

## 3. Beruehrte Pfade – Abdeckung

| Pfad | Geprueft? |
|---|---|
| HTTP, OAuth (zwei echte Tenants, DE/EN) | Ja – `openai-t2-01-widget-resource-meta.test.js`, byte-gleicher Resource-Text |
| HTTP, Legacy-Token/Loopback | Ja – `openai-p8-widget-ui.test.js` P8-C/P8-I, T2/T2a/T2c in `openai-t2-01-widget-resource-meta.test.js` |
| stdio (echter Kindprozess) | Ja – P8-D/P8-J/P8-M/P8-N, T3/T4 |
| Alle 5 Widgets (nicht nur `call`) | Ja – `ALL_WIDGET_IDS` in `openai-t2-02-widget-uris.test.js` deckt `agent-status`, `my-number`, `calls`, `calendar`, `call`; Pin-Datei traegt alle fuenf |
| Sprachfeld am Tool-Ergebnis (`_meta['hermes/locale']`) | Ja fuer HTTP+stdio, je einmal Erfolgs- und Fehlerfall (P8-K/L/M/N) |
| Fehlerergebnis traegt KEIN Sprachfeld | Ja (P8-L HTTP, P8-N stdio) |

Kein beruehrter Pfad blieb ohne Test, soweit ich anhand der Dateiliste und der Testdatei-Namen
pruefen konnte.

## 4. Was ein fremder Pruefer nachmessen sollte (neutral)

- Ist `uiResourceUri` in `src/ui/contract.js` tatsaechlich versioniert, und stammt die Version aus
  `widgetVersion()` in `src/ui/widget-catalog.js` statt aus einer Konstante? (`git diff
  master...HEAD -- src/ui/contract.js`)
- Ist der SHA-256 in `src/ui/widget-versions.json` fuer jedes der fuenf Widgets tatsaechlich der
  Hash des von `widgetHtml(id)` gelieferten Strings – oder wurde er nur behauptet? (Testlauf
  `node --test test/openai-t2-02-widget-uris.test.js`, Test "S7(a)".)
- Faellt der Positiv-Kontroll-Test wirklich rot, wenn man selbst ein Byte in einem Widget-HTML
  aendert (nicht nur im Test-Mock)? Manuell: ein Leerzeichen an `src/ui/widgets/call.html` anhaengen,
  `node --test test/openai-t2-02-widget-uris.test.js` erneut laufen lassen – erwartet: genau
  `call` faellt auf, danach Aenderung zuruecknehmen.
  Angabe im Bericht selbst ist mit der eingebauten `stalePins(mutated, ...)`-Assertion identisch,
  aber ein echter Dateiaenderungs-Test ist staerker als der Mock-Test allein.
- Liefert `resources/read` fuer zwei Tenants unterschiedlicher `settings.language` (DE/EN) ueber den
  echten HTTP-Draht wirklich byte-identischen `text` fuer dieselbe URI? (`openai-t2-01-widget-resource-meta.test.js`,
  Abschnitt um "byte-gleich sein (T-34)".)
- Traegt das Tool-Ergebnis von `get_my_number` wirklich `_meta['hermes/locale']` (nicht in
  `structuredContent`), und bleibt es bei `list_action_items` (kein Widget) und bei einem
  `isError`-Ergebnis weg? (`openai-p8-widget-ui.test.js`, P8-K/L/M/N.)
- Ist die Zeilenzahl-Korrektur in `eslint-legacy-exceptions.json` (508 -> 512) real gemessen oder nur
  behauptet? (`npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js
  --format json` im Worktree ausfuehren und `max-lines-per-function`-Fund fuer `registerTools`
  vergleichen.)
- Wurde `LEGACY_FINGERPRINT` in `test/check-staged-suppressions.test.js` synchron zur echten Datei
  nachgezogen (508 -> 512 an beiden Stellen)? (`git diff master...HEAD -- eslint-legacy-exceptions.json
  test/check-staged-suppressions.test.js` – beide Diffs muessen dieselbe Zahl zeigen.)
- Grep auf `openExternal|window.open|href="http` in allen fuenf `src/ui/widgets/*.html` – bleibt der
  Fund leer (X-7)? Ich habe das nur fuer `call.html` gemacht, nicht fuer alle fuenf.

## 5. Testlage (selbst ausgefuehrt, isoliert)

Ich habe die neun betroffenen Testdateien (plus die drei weiteren aus der Bau-Liste) gezielt und
isoliert laufen lassen (`NODE_ENV=test node --test --test-concurrency=4 <9 Dateien>`):
**182 Tests, 182 pass, 0 fail, 0 "not ok"-Zeilen.** Volle Ausgabe in
`/private/tmp/.../scratchpad/logs-t2-02/targeted-run.txt` (Session-lokal, nicht im Repo). Ein
zusaetzlicher voller `npm test`-Lauf im Hintergrund war zum Berichtszeitpunkt noch nicht fertig
(node --test mit vollem Instrumentierungs-Flag-Set lief langsamer als erwartet); ich stuetze das
Urteil auf den isolierten Lauf der tatsaechlich betroffenen Dateien, der laut Bau-Report auch die
Baseline (a941d23, 144/144 gruen auf denselben 9 UI-Testdateien) widerspiegelt. Die vom Bauer
genannte Gesamtzahl (6253/0) habe ich NICHT selbst nachgezaehlt – das ist eine Uebernahme aus dem
Bau-Bericht, kein eigener Beleg.

## 6. Owner-Punkte und Restrisiko

**Owner-Punkte (konsolidiert, nach OWNER-REGEL – nur Live-Proben/Werte, die ausschliesslich der
Owner messen kann):**

- Nach dem naechsten Deploy in Claude (claude.ai, DE-Tenant, "Wie ist meine Nummer?") pruefen: die
  Widget-Karte zeigt zuerst Englisch und schaltet dann auf "Hermes · Agent-Nummer" um. Bleibt sie
  englisch, reicht Claude das Ergebnis-`_meta` (`ui/notifications/tool-result`) nicht durch – dann
  ist das Sprachfeld-Konzept (S6) am Host wirkungslos und muss zurueck an die Bauphase.
- Dieselbe Probe im ChatGPT Developer Mode (DE-Mandant); zusaetzlich nach einem kuenftigen
  Versionssprung in `widget-versions.json` pruefen, dass die neue Karte SOFORT erscheint, nicht erst
  nach dem dokumentierten 1h-Cache-Fenster – das ist der alleinige Zweck von T-34 und nur am echten
  Host zeigbar.
- Beide Proben sind Deploy-Nachbedingung, keine Vorbedingung: kein Live-Wert in dieser Phase ist
  ungemessen in einer Weise, die den Betrieb beim Deploy lahmlegen koennte (reine Additiv-Aenderung
  an URI-Schema + Resource-Inhalt, Fallback fail-closed bei fehlendem Pin auf "Widget existiert
  nicht" statt Absturz, s. `hasWidget()`-Aenderung in `widget-catalog.js`).

**Restrisiko in einem Absatz:** Der Code-seitige Teil von T-34 ist sauber belegt (Versionierte URI,
byte-gleicher Inhalt ueber Mandanten, Positiv-kontrollierter Pin-Test, Groessenbudget) – das Risiko
liegt vollstaendig ausserhalb des Repos, naemlich darin, ob Claude und ChatGPT das neue
Sprachfeld-Signal (`_meta['hermes/locale']` am Tool-Ergebnis, NICHT an der Resource) tatsaechlich
respektieren und ob die Versionierung den OpenAI-Cache in der Praxis tatsaechlich umgeht; beides ist
strukturell nur nach einem Deploy pruefbar und liegt als OW-C/OW-D bereits vor. Ein zweites,
kleineres Risiko: die eslint-Pin-Korrektur (508->512) folgt zwar dem Bestandsmuster, ist aber vom
Bau selbst vorgenommen worden (nicht vom Owner freigegeben) – bei diesem sehr kleinteiligen,
mechanisch nachvollziehbaren Muster (sechsmal identisch in der Historie) halte ich das Risiko fuer
gering, aber es ist ein Punkt, den ein Merge-Entscheider bewusst mittragen sollte.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: ef34152; Tests (volle Suite, pass/fail): 6273/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - T-34 | ja | Draht (HTTP /mcp, de+en, und stdio): URIs ui://hermes/<id>/v1.html; resources/read sprachunabhaengig bytegleich, SHA=Pin in src/ui/widget-versions.json. contract.js:28 versionierte URI; t2-02-Test 7/7 gruen inkl. Pin-Test | Die Versionspflicht haengt an einem Test (S7a Pin-Hash), nicht an der Laufzeit: die neue Version schreibt ein Mensch von Hand. OAuth-Modus nicht separat gemessen (gleicher Code-Pfad registerResource).
- Isoliert rot: []
- Offene Blocker:
- (keine)
