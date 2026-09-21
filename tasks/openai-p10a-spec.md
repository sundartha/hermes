# Spec OpenAI-P10a — Randpunkte I: Test-, Kommentar- und Doku-Hygiene (kein Live-Verhalten)

Stand: 2026-09-21, geplant gegen master `dcb2d3c`. Autor: Planungs-Agent (liest, aendert keinen Code).

## 0. Harte Grenzen dieser Phase

- `src/` bleibt **unveraendert**. Die Aufgabe erlaubt Kommentaraenderungen in `src/`, aber nach
  der Pruefung braucht **keiner** der acht Punkte eine. Deshalb ist der Beweis strenger als
  gefordert: `git diff --quiet master -- src/` endet mit Exit 0. Der Syntaxbaum-Vergleich (Schritt 12)
  laeuft trotzdem als zweite Pruefung.
- Keine Aenderung an `render.yaml`, `.env.example`, `src/config.js`, `test/helpers.js` (`BASE_ENV`).
  Es gibt **keine neue Env-Variable**.
- Nicht Teil der Phase: `/healthz`, Security-Header, `security.txt`, Referrer-Policy, `sundartha.com`,
  `POST /mcp` auf dem Parent-Host, `src/process-guards.js`, `MCP_AUTH`-Trim,
  `requiredClaims: ['exp']`, O-27-Texte in `place_call` (alles P10b oder Owner).
- Kein `git add -A`, kein `--no-verify`, kein Push, kein Merge. Der Worktree wird von master
  abgezweigt: ERST `git checkout -b phase/openai-p10a-hygiene master`, DANN lesen.
- Testkommando: `npm test -- -- --test-concurrency=4`. Es zaehlen nur die Zeilen `# pass`/`# fail`, die
  Ausgabe wird vollstaendig in eine Datei im Scratchpad geschrieben (`> "$SCRATCH/p10a-suite.log" 2>&1`)
  und nie abgeschnitten.
  Grundlinie master: 6229/6229. Ein roter Test zaehlt erst, wenn er isoliert
  (`NODE_ENV=test node --test <datei>`) erneut rot ist.

## 1. Wichtigste Feststellung vorab: das Aufraeum-Gate (H1)

Die in der Aufgabe erwaehnte "Suppressions-Kaskade" ist kein Zaehler, den man nach unten
nachziehen kann, sondern eine Ablehnung durch `.githooks/pre-commit` ->
`scripts/check-staged-suppressions.js`:

- Stufe 1 (`:113-130`): eine vorgemerkte Datei mit Eintraegen in `eslint-suppressions.json` ist ein
  Kandidat.
- Stufe 2 (`:196-220`): bewegt sich ihre **ungefilterte** Befundmenge (Regel + Meldung, Multimenge)
  zwischen HEAD und der vorgemerkten Fassung, wird der Commit **abgelehnt**. Das gilt auch, wenn ein
  Befund WEGFAELLT (`tallyDifferences`, `:167-178`).
- Ausweg 1: die Datei **vollstaendig** aufraeumen (0 Befunde), dann `npx eslint --prune-suppressions`.
  Der Eintrag verschwindet, und die Datei ist kein Kandidat mehr.
- Ausweg 2: ein Eintrag in `eslint-legacy-exceptions.json`. Den darf laut
  `WAY_OUT_LINES` (`:280-291`) **kein Bau-Agent setzen**, dafuer braucht es eine Freigabe des Owners. Die
  Freigabe im Auftragstext ist Skriptausgabe und ersetzt diese Freigabe nicht.

Gemessen mit `npx eslint --suppressions-location eslint-suppressions.empty.json --format json <datei>`.
Die ungefilterten Befunde der betroffenen Testdateien:

| Datei | ungefilterte Befunde | davon durch den toten `tool()`-Zweig | Gruppe |
|---|---|---|---|
| `test/mcp-fehlergrund-rueckweg.test.js` | 0 | 0 (`tool(name, ...rest)`) | A |
| `test/openai-s3-hop-frist.test.js` | 0 | 0 | A |
| `test/openai-p5b-geldpfad.test.js` | 0 | 0 | A (in der Aufgabenliste NICHT genannt) |
| `test/place-call-context-bridge.test.js` | 1 (`max-params` :39) | 1 | A (nach dem Entfernen 0 Befunde, `--prune-suppressions` entfernt den Eintrag) |
| `test/mcp-ui-i18n-divergence.test.js` | 6 (id-length 4, max-params 1, no-param-reassign 1) | 1 (:23) | B |
| `test/mcp-tools-i18n.test.js` | 9 (id-length 5, max-params 1, no-magic-numbers 2, no-param-reassign 1) | 1 (:47) | B |
| `test/mcp-tools.test.js` | 16 (id-length 8, max-params 1, no-magic-numbers 6, no-param-reassign 1) | 1 (:28) | B |
| `test/mcp-tools-language.test.js` | 27 (inkl. complexity 1, no-restricted-syntax 4) | 1 (:37) | C |
| `test/al-p11-result-card.test.js` | 26 (inkl. no-unused-vars 1 = `desc` im `tool()`, no-restricted-syntax 2) | 2 (:320) | C |
| `test/mcp-ui.test.js` | 74 (inkl. no-restricted-syntax 38, sonarjs/no-commented-code 1) | 1 (:69; :75 und :528 sind andere Funktionen) | C |

Gruppe A: entfernen, ohne weitere Kosten. Gruppe B: entfernen **und** die Datei vollstaendig aufraeumen
(nur Test-Code, zusammen 28 Befunde). Gruppe C: `tool()` **bleibt**, nur die unwahren Kommentare werden
wahr. Eine Datei komplett aufzuraeumen waere hier ein eigener Umbau (mcp-ui allein hat 73 fremde
Befunde), und der einzige andere Ausweg braucht die Owner-Freigabe. Gruppe C steht in `nicht_bauen`.

Seit P2 ruft `src/` nirgends mehr `server.tool()` auf:
`grep -rn "\.tool(" src/` liefert genau einen Treffer, den Kommentar `src/mcp-tools.js:879`.
Einziger Registrierweg ist `server.registerTool` (`src/mcp-tools.js:904-905`). Faellt der
`tool()`-Stub weg, macht das eine Attrappe **strenger**. Wuerde je wieder `server.tool()` eingefuehrt,
braeche die Attrappe laut mit einem TypeError, statt es still hinzunehmen.

## 2. Schritte

Zu jedem Schritt: was geaendert wird, wo, welche IDs er erfuellt, welche Pfade er beruehrt und wie ein
fremder Pruefer ihn nachprueft. Die Belegart steht als (a) Code, (b) gruener Test oder (c) lesende
Messung dabei.

### Schritt 1: Grundlinie messen (keine Aenderung)
- **Was:** Auf dem frischen Branch (von master) den vollen Lauf fahren und `# pass`/`# fail` notieren.
  Dazu die ungefilterten Lint-Befunde der zehn Dateien aus Abschnitt 1 festhalten, als JSON-Tally im
  Scratchpad.
- **Datei:** keine.
- **IDs:** Voraussetzung fuer alle.
- **Pfade:** keine.
- **Beweis (c):** Die Datei `$SCRATCH/p10a-baseline.log` enthaelt `# pass 6229` und `# fail 0`
  (oder: jeder rote Test ist isoliert gruen, mit Log). Der Pruefer fuehrt
  `npm test -- -- --test-concurrency=4 2>&1 | grep -E "^# (pass|fail)"` auf master aus.

### Schritt 2 (H1, Gruppe A): toten `tool()`-Stub aus vier Attrappen entfernen
- **Was:** Die Methode `tool(...) {...}` aus dem jeweiligen `fakeServer`-Literal loeschen. Die
  Kommentare, die sie beschreiben, werden wahr gemacht: die "Bestands-4-Argumente-API (frozen)" in
  `mcp-fehlergrund-rueckweg.test.js:23-25` und "server.tool()/server.registerTool() einfangen - beide
  Formen" in `openai-p5b-geldpfad.test.js:47-49`. Der neue Wortlaut lautet sinngemaess: "Einziger Registrierweg ist
  registerTool (src/mcp-tools.js uiTool); ein server.tool()-Aufruf wuerde hier absichtlich mit
  TypeError scheitern." Danach `npx eslint --prune-suppressions` ausfuehren und im
  `git diff eslint-suppressions.json` pruefen, dass **nur** der Eintrag
  `test/place-call-context-bridge.test.js` verschwindet und sonst nichts.
- **Datei:** `test/mcp-fehlergrund-rueckweg.test.js:23-28`, `test/openai-s3-hop-frist.test.js:25-27`,
  `test/openai-p5b-geldpfad.test.js:47-55`, `test/place-call-context-bridge.test.js:39-41`,
  `eslint-suppressions.json:3594` (Eintrag `place-call-context-bridge`).
- **IDs:** H1 (P2-Abnahme), Folge von DP-3.
- **Pfade:** Nur Test-Attrappen, kein Transport. Die Attrappen stehen fuer den geteilten
  `registerTools()`-Weg (HTTP und stdio rufen dieselbe Funktion, `src/routes/mcp.js:159`,
  `src/mcp-server.js:35`).
- **Beweis:** (c) `grep -nE "^\s+tool\(" <die vier Dateien>` liefert keine Ausgabe.
  (c) `node -e "console.log(require('./eslint-suppressions.json')['test/place-call-context-bridge.test.js'])"`
  gibt `undefined` aus. (b) Die vier Dateien laufen isoliert gruen
  (`NODE_ENV=test node --test test/mcp-fehlergrund-rueckweg.test.js test/openai-s3-hop-frist.test.js
  test/openai-p5b-geldpfad.test.js test/place-call-context-bridge.test.js`), und ihre Fallzahl ist
  dieselbe wie auf master. (c) Der Commit geht durch den Hook, ohne `--no-verify`.

### Schritt 3 (H1, Gruppe B): Stub entfernen und drei Dateien vollstaendig aufraeumen
- **Was:** In `test/mcp-ui-i18n-divergence.test.js`, `test/mcp-tools-i18n.test.js` und
  `test/mcp-tools.test.js` den `tool()`-Stub loeschen und die Kopfkommentare wahr machen
  (`mcp-tools.test.js:15-16` "per server.tool registrierten Handler", `:22-24`, `mcp-tools-i18n.test.js:42-43`).
  Danach **alle** uebrigen ungefilterten Befunde der Datei beheben:
  - `id-length`: kurze Bezeichner sprechend umbenennen.
  - `no-magic-numbers`: benannte Konstanten einfuehren.
  - `no-param-reassign`: auf ein lokales Objekt umbauen statt den Parameter zu mutieren.
  Dann `npx eslint --prune-suppressions`. Die **Semantik jedes Tests bleibt gleich**: gleiche Namen,
  gleiche Zusicherungen, gleiche Fallzahl. Das ist Test-Refactoring, keine neue Pruefung.
- **Datei:** `test/mcp-ui-i18n-divergence.test.js:20-33`, `test/mcp-tools-i18n.test.js:42-56`,
  `test/mcp-tools.test.js:15-38`, plus die Befundstellen, die der ungefilterte Lint-Lauf nennt, und
  `eslint-suppressions.json:2991`, `:3025`, `:3039`.
- **IDs:** H1.
- **Pfade:** wie Schritt 2.
- **Beweis:** (c) `npx eslint --suppressions-location eslint-suppressions.empty.json test/mcp-ui-i18n-divergence.test.js test/mcp-tools-i18n.test.js test/mcp-tools.test.js`
  meldet 0 Probleme. (c) Die drei Schluessel fehlen in `eslint-suppressions.json`.
  (b) Die drei Dateien laufen isoliert gruen und haben dieselbe Fallzahl wie auf master.
  (c) `git diff master -- <datei> | grep -E "^[-+]\s*assert"` zeigt nur Umbenennungen, keine
  entfernte oder abgeschwaechte Zusicherung. Der Pruefer liest das Diff.
- **Abbruchregel:** Laesst sich eine Datei nicht auf 0 bringen, ohne eine Zusicherung zu aendern,
  wandert sie nach Gruppe C: Stub bleibt, nur der Kommentar wird korrigiert. Das kommt in den Report, es
  wird **kein** Legacy-Eintrag gesetzt.

### Schritt 4 (H1, Gruppe C): Kommentare wahr machen, Stub bleibt
- **Was:** In `test/mcp-tools-language.test.js:32-33` und `test/mcp-ui.test.js:63-64` die Kommentare
  ersetzen, die eine lebende `server.tool`-API behaupten ("seit E2 ... annotations sitzt an Position 4",
  "tool() (Bestand) faengt es ueber server.tool ab"). Der neue Wortlaut sagt sinngemaess: "tool() hat seit
  OpenAI-P2 keinen Aufrufer mehr in src/. Er bleibt nur stehen, weil sein Entfernen die ungefilterte
  Befundmenge dieser Datei bewegt und das Aufraeum-Gate (scripts/check-staged-suppressions.js) dann
  ein vollstaendiges Aufraeumen verlangt. Das ist ein eigener Umbau." Die Code-Zeilen bleiben
  byte-gleich. `test/al-p11-result-card.test.js:320` bekommt **keine** Aenderung, dort steht kein
  unwahrer Kommentar.
- **Datei:** `test/mcp-tools-language.test.js:32-33`, `test/mcp-ui.test.js:63-64`.
- **IDs:** H1 (Kommentar-Teil).
- **Pfade:** keine.
- **Beweis:** (c) Die ungefilterte Befundmenge ist vor und nach der Aenderung identisch:
  `npx eslint --stdin --stdin-filename test/mcp-ui.test.js --suppressions-location eslint-suppressions.empty.json --format json < <(git show master:test/mcp-ui.test.js)`
  gegen dieselbe Abfrage auf die Arbeitsfassung, Tally nach `ruleId + message` gleich. Dasselbe fuer
  `mcp-tools-language`. (c) `grep -n "annotations sitzt\|faengt es ueber server.tool" <beide Dateien>`
  liefert keine Ausgabe.

### Schritt 5 (H2): `ohneWidgetMeta()` wieder streng machen
- **Was:** `test/mcp-ui.test.js:56-61` ersetzen. Heute prueft der Helfer nur "nicht diese zwei
  Widget-Schluessel". Kuenftig prueft er "die Schluesselmenge von `_meta` ist **genau** die beiden
  Statuszeilen-Schluessel": `openai/toolInvocation/invoking` und `openai/toolInvocation/invoked`, sortiert
  verglichen, per `isDeepStrictEqual` aus `node:util` oder `assert.deepEqual`. Die Schluessel stehen als
  benannte Konstante im Test, denn die Konstanten in `src/mcp-tools.js:732-733` sind modul-privat, und sie
  zu exportieren waere eine ausfuehrbare `src`-Zeile, also verboten. Der Kommentar nennt die
  Aenderung wahrheitsgemaess: "gleich streng wie vor P2, bei dem Vorkommen von `_meta` genau die
  Statuszeilen". Dazu ein kleiner Kontrollfall im selben File, damit der strengere Helfer nicht
  unbemerkt immer `true` liefert: er gibt `true` fuer `{_meta:{invoking,invoked}}` und `false` fuer
  (i) zusaetzlich `ui`, (ii) zusaetzlich `openai/outputTemplate`, (iii) einen beliebigen dritten
  Schluessel und (iv) fehlendes `_meta`.
- **Datei:** `test/mcp-ui.test.js:56-61`. Die zehn Aufrufstellen (`:244`, `:258`, `:272`, `:299`, `:449`,
  `:462`, `:908`, `:1105`, `:1191`, `:1276`) bleiben unveraendert. Der neue Kontrollfall kommt ans
  Dateiende.
- **IDs:** H2 (P2-Abnahme).
- **Pfade:** Die Attrappe `captureUi` prueft das Konfigurationsobjekt **nach** `withOpenAiToolMetadata()`,
  also dieselbe Fabrik fuer HTTP und stdio. Die Drahtseite ist schon durch
  `test/openai-p2-tool-metadaten.test.js` und die Byte-Hashes in `test/openai-p8-widget-ui.test.js:41-44`
  (HTTP und stdio) gepinnt. Dieser Schritt aendert daran nichts.
- **Beweis:** (b) `NODE_ENV=test node --test test/mcp-ui.test.js` ist gruen, mit Fallzahl master + 1.
  (c) Gegenprobe des Pruefers: in einer Wegwerfkopie in `src/mcp-tools.js` bei
  `withOpenAiToolMetadata` einen dritten Schluessel `_meta.x = 1` anhaengen, dann wird
  `test/mcp-ui.test.js` rot. Danach verwerfen, nicht committen. Auf master bleibt derselbe Eingriff
  gruen, und genau das war die Abschwaechung.
  (c) Die ungefilterte Befundmenge von `mcp-ui.test.js` bleibt gleich (Kommando wie in Schritt 4).
  Aendert sie sich, muss der neue Code die Befunde vermeiden. Die Kette-Regel `no-restricted-syntax`
  (Demeter) greift bei langen Member-Ketten, deshalb Zwischenvariablen verwenden.

### Schritt 6 (H3): `capabilities` fehlt, wenn `uiEnabled:false` ist, auf beiden Pfaden gepinnt
- **Was:** Eine neue Datei `test/openai-p10a-ui-capabilities.test.js`. Kein Testname beginnt mit einem
  Katalog- oder `ABNAHME-`-Praefix. Vorschlag fuer das Praefix: `P10a (H3): ...`. Vier Faelle:
  1. Einheit: `Object.hasOwn(mcpServerOptions({uiEnabled:false, consultLoop:false}), "capabilities")`
     ist `false`, dasselbe mit `consultLoop:true`. Positivkontrolle: bei `uiEnabled:true` ist
     `capabilities.extensions["io.modelcontextprotocol/ui"]` vorhanden.
  2. HTTP-Draht: `startServer({ seed: seedState({}) })`. `BASE_ENV` setzt `MCP_UI_ENABLED=false`
     (`test/helpers.js:374`). Ein rohes `initialize` per `mcpPost` und `readToolResult` liefert
     `result.capabilities` **ohne** `extensions["io.modelcontextprotocol/ui"]`. Positivkontrolle im
     selben Fall mit `env: { MCP_UI_ENABLED: "true" }`: dort ist die Erweiterung vorhanden.
  3. stdio-Draht: Kindprozess `src/mcp-server.js` mit `BASE_ENV`, nach dem Muster
     `withStdioClient` (`test/openai-p8-widget-ui.test.js:91-110`). Die Server-Capabilities tragen
     keine UI-Erweiterung. Positivkontrolle mit `MCP_UI_ENABLED=true`. **Achtung:** verwirft der
     typisierte `Client` `extensions` beim Parsen, schlaegt die Positivkontrolle fehl. Dann roh lesen
     (JSON-RPC ueber stdin/stdout des Kindprozesses), die Positivkontrolle nie weglassen.
  4. (optional, billig) derselbe HTTP-Fall mit `CONSULT_ENABLED=true` und
     `ASSISTANT_CONTEXT_ENABLED=true`. Damit ist belegt, dass `consultLoop` die Capabilities nicht
     einschaltet.
- **Datei:** neu `test/openai-p10a-ui-capabilities.test.js`. Die Codestelle, die gepinnt wird:
  `src/mcp-server-info.js:149-154`. Die Aufrufer: `src/routes/mcp.js:140-143`,
  `src/mcp-server.js:25-28`.
- **IDs:** H3 (P4-Abnahme), DP-1.
- **Pfade:** HTTP `/mcp` **und** stdio. Beide rufen `mcpServerOptions`.
- **Beweis:** (b) `NODE_ENV=test node --test test/openai-p10a-ui-capabilities.test.js` ist gruen.
  (c) Gegenprobe des Pruefers: in einer Wegwerfkopie `src/mcp-server-info.js:151` auf
  `options.capabilities = {}` ohne `if` aendern. Dann werden Fall 1 und Fall 2 rot. Aendert er den
  stdio-Aufruf auf `uiEnabled: true`, wird Fall 3 rot. Danach verwerfen.
  (c) `npx eslint test/openai-p10a-ui-capabilities.test.js` meldet 0 Probleme. Es ist eine neue Datei
  ohne Suppressions, also muss sie sauber sein.

### Schritt 7 (H4): unwahre Produktionsbehauptung in den P4-Tests richtigstellen
- **Was:** Zwei Kommentare korrigieren. Erstens `test/openai-p4-ergebnisstruktur-instructions.test.js:252-254`
  ("genau der Zustand, in dem Produktion heute laeuft (render.yaml, UNKNOWN-2 der Spec)"). Zweitens
  `:336-338` ("Produktions-Normalfall, CONSULT_ENABLED=false"). Der neue Wortlaut sagt sinngemaess: "Der
  Test prueft den Zustand 'Tenant ohne Consult-Faehigkeit'. BASE_ENV setzt CONSULT_ENABLED=false.
  Produktion laeuft NICHT so: der Live-Wert ist Dashboard-gepflegt, render.yaml ist nicht massgeblich,
  und der Live-Connector zeigte am 2026-09-21 die Consult-Werkzeuge und den Consult-Instruktionsblock.
  Der Fall bleibt relevant fuer jeden Tenant ohne allowConsult (DEFAULT_PROFILE, src/store/defaults.js:1069-1078)."
  Kein Code, keine Zusicherung aendert sich.
- **Datei:** `test/openai-p4-ergebnisstruktur-instructions.test.js:252-254`, `:336-338`.
- **IDs:** H4 (P4-Abnahme).
- **Pfade:** keine (nur Kommentar).
- **Beweis:** (c) `grep -n "Produktion heute laeuft\|Produktions-\s*$\|Normalfall, CONSULT_ENABLED=false" test/openai-p4-ergebnisstruktur-instructions.test.js`
  liefert keine Ausgabe. (c) Die ungefilterte Befundmenge der Datei bleibt gleich (Kommando wie in
  Schritt 4; die Datei hat heute keinen Suppressions-Eintrag, also nur `npx eslint <datei>` sauber).
  (b) Die Datei laeuft isoliert gruen mit unveraenderter Fallzahl.
  (c) `git diff master -- test/openai-p4-ergebnisstruktur-instructions.test.js | grep -E "^[-+]" | grep -v "^[-+]\s*//" | grep -vE "^(\+\+\+|---)"`
  liefert keine Ausgabe, also wurden nur Kommentarzeilen geaendert.

### Schritt 8 (H5): englische Fassung von `docs/OPENAI-AUTH-ABWEICHUNGEN.md` wirklich eigenstaendig
- **Was:** Den staerkeren Weg nehmen und den englischen Inhalt nachliefern, statt die
  Selbstbeschreibung zurueckzunehmen. Direkt nach Abschnitt 2b kommt ein neuer Abschnitt
  `## 2c. English appendix (for the OpenAI reviewer)` mit den englischen Entsprechungen:
  - 2c.1: die Einschraenkung der Sonde und die Regel "neue Messung gewinnt" (Abschnitt 3, Absaetze nach
    dem Rohprotokoll). Das Rohprotokoll selbst bleibt sprachneutral und wird nicht dupliziert.
  - 2c.2: WorkOS-Fragen a-e (Abschnitt 4).
  - 2c.3: Owner-Messungen O-3 und O-6 (Abschnitt 5).
  - 2c.4: offene Befunde B-1, `exp` nicht verlangt, T-8-Nebenbefund (Abschnitt 7).
  - 2c.5: doppelte Pfade (Abschnitt 8), denn T-14/T-16 "nicht anwendbar fuer stdio" ist eine
    Einschraenkung.

  Alle Verweise in 2b (`:253-254`, `:297`, `:304`, `:345`, `:366-367`, `:390`, `:411`, `:427`) zeigen danach
  auf 2c.x. Die Verweise auf "Section 3" zeigen auf den Rohlog **plus** 2c.1. Die Einleitung in 2b
  (`:248-254`) und der deutsche Kopfsatz (`:12-14`) nennen 2b+2c als die englische Fassung. Inhaltlich
  keine neue Aussage: jede Einschraenkung und jedes UNKNOWN wird 1:1 uebernommen, nichts optimistischer
  formuliert.
- **Datei:** `docs/OPENAI-AUTH-ABWEICHUNGEN.md:12-14`, `:246-431` (2b), dazu der neue Abschnitt 2c vor `:432`.
- **IDs:** H5 (P7-Abnahme). Beruehrt die Doku zu T-9/T-11/T-12/T-14/T-16, aendert aber keinen Status.
- **Pfade:** keine (Doku).
- **Beweis:** (c) `awk '/^## 2b\./,/^## 3\./' docs/OPENAI-AUTH-ABWEICHUNGEN.md | grep -nE "Section [4-9]"`
  liefert keine Ausgabe. Jeder Verweis in 2b zeigt auf 2b, 2c oder Section 3. (c)
  `awk '/^## 2c\./,/^## 3\./' docs/OPENAI-AUTH-ABWEICHUNGEN.md | grep -cE "O-3|O-6|B-1|UNKNOWN"`
  ist >= 4. (a) Der Pruefer liest 2c gegen die Abschnitte 3 bis 8 und bestaetigt, dass keine
  deutsche Einschraenkung ohne englisches Gegenstueck bleibt. (c)
  `grep -c "[äöüÄÖÜß]" docs/OPENAI-AUTH-ABWEICHUNGEN.md` hat denselben Wert wie auf master. Es kommen
  keine neuen Umlaute hinzu; im Englischen stellt sich die Frage ohnehin nicht.

### Schritt 9 (H6): T-14-Status in `PLAN-SECURITY.md` angleichen
- **Was:** `PLAN-SECURITY.md:5070-5072` im P6-Abschnitt aendern. Dort steht heute "T-14 ... gegenstandslos
  (P0 D0-6, kein Ausloesepfad), gehoert zu P7". Neu steht dort: "T-14 ... bewusst nicht erfuellt, Ersatz
  durch den Transport-Pfad UNKNOWN; Stand und Begruendung s. Abschnitt OpenAI-P7, Punkt 2". Das ist
  derselbe Status wie `:5102`. Die urspruengliche P0-Einschaetzung darf als Historie in einem Halbsatz
  bleiben ("P0 D0-6 hielt ihn fuer gegenstandslos; P7 hat das revidiert"). Sie darf aber nicht als
  aktueller Status dastehen.
- **Datei:** `PLAN-SECURITY.md:5070-5072`.
- **IDs:** H6 (P7-Abnahme).
- **Pfade:** keine (Doku).
- **Beweis:** (c) `grep -n "T-14" PLAN-SECURITY.md` zeigt keinen Treffer mehr, der "gegenstandslos" als
  aktuellen Status fuehrt. `grep -n "gegenstandslos" PLAN-SECURITY.md | grep T-14` ist leer, oder der
  Treffer steht erkennbar in der Vergangenheitsform mit Verweis auf P7. Der Pruefer liest
  `:5068-5075` und `:5102`.

### Schritt 10 (H7 + H8): englisches Werkzeug-Inventar mit Belegen
- **Was:** Eine neue Datei `docs/OPENAI-TOOL-INVENTORY.md` auf Englisch. Die Aufgabe schlaegt
  `OPENAI-TOOL-INVENTAR` vor; welcher Name es wird, ist egal, er muss nur in Schritt 11 identisch
  verwendet werden. Inhalt:
  1. **Tabelle A: alle 12 Werkzeuge** in Registrierreihenfolge (`src/mcp-tools.js:914-1494`). Je Zeile:
     `name`, `title`, Bedingung ("always" / "`consultAllowedFor(profile)` =
     `CONSULT_ENABLED` AND `ASSISTANT_CONTEXT_ENABLED` AND `profile.allowConsult`" / "`profile.allowCalendar`"),
     `readOnlyHint`, `destructiveHint`, `openWorldHint`, `idempotentHint` (nur wo gesetzt, sonst "-") und
     ein Satz Begruendung je Annotation-Satz mit Beleg `datei:zeile`. Quellen fuer die Begruendungen:
     `src/mcp-tools.js:610-647` (vier Festlegungen), die aufgerufene Route (Belege
     `src/mcp-tools.js:1075`, `:1130`, `:1185`, `:1222`, `:1281`, `:1328`, `:1345`, `:1374`, `:1403`, `:1428`,
     `:1460`, `:1500`) und fuer `check_inbox` das `POST /api/inbox/poll`, das den Lesestatus schreibt.
     Die **Werte** stammen aus dem echten `tools/list` (Konfiguration K1 unten), nicht aus dem Quelltext.
  2. **Tabelle B: ausgelieferte Menge je Konfiguration.** Die Zahlen werden **am Draht gemessen**:
     | K | Transport | Identitaet / Profil | Schalter | erwartet (Code) |
     |---|---|---|---|---|
     | K1 | HTTP | Bootstrap-Owner (`OWNER_PROFILE`, `src/store/defaults.js:1056-1065`) | Consult + AssistantContext an | 12 |
     | K2 | HTTP | Bootstrap-Owner | `BASE_ENV` (Consult aus) | 10 |
     | K3 | HTTP (OAuth) | Tenant ohne Profil (`DEFAULT_PROFILE`, `:1069-1078`) | Consult an | 9 |
     | K4 | HTTP (OAuth) | Tenant mit `planProfileFor("starter")` (`src/plans.js:107-111`, `:146-148`) | Consult an | 11 |
     | K5 | HTTP (OAuth) | Tenant mit Plan-Profil | Consult aus | 9 |
     | K6 | stdio (`src/mcp-server.js`) | ohne Tenant (Defaults `allowCalendar=true`, `consultAllowed=false`, `src/mcp-tools.js:802-810`) | egal | 10 |
     Jede Zeile nennt die **exakte Namensmenge**, nicht nur die Zahl.
  3. **Abschnitt "What the reviewer will see":** Die Menge haengt am Demo-Account (O-9/OW-9, Owner).
     Ein zahlender Plan erreicht hoechstens 11, weil `get_calendar` fuer zahlende Plaene bewusst
     abgeschaltet ist. Die 12 erreicht nur der Bootstrap-Owner. Die Werte der Produktionsschalter sind
     Dashboard-gepflegt und stehen **nicht** in diesem Dokument. Keine Aussage "production runs with X".
  4. Ein Satz, dass die Varianz gewollt ist (Werkzeuge ohne Berechtigung werden gar nicht registriert,
     statt registriert und dann mit Fehler beantwortet), mit Verweis `src/consult/gate.js:19-25`.
- **Datei:** neu `docs/OPENAI-TOOL-INVENTORY.md`.
- **IDs:** H7 (Kickoff I / I-4 / DP-5, bewusst festgehalten), H8 (N-5: Begruendung je Annotation).
  Beruehrt N-6 und O-9 nur als Verweis.
- **Pfade:** HTTP (legacy-Owner und OAuth-Tenant) **und** stdio. Der Adapter (mcp-nativ oder ChatGPT)
  aendert die Werkzeugmenge nicht, er aendert nur `_meta`. Das steht mit Beleg `src/mcp-tools.js:863-870`
  (`enableWidgetUi` liefert nur `_meta`) im Dokument.
- **Beweis:** siehe Schritt 11 (b). Zusaetzlich (a): der Pruefer liest jede `datei:zeile` im Dokument
  stichprobenartig nach.

### Schritt 11 (H7 + H8): Test, der das Inventar gegen den Draht haelt
- **Was:** Eine neue Datei `test/openai-p10a-tool-inventar.test.js` mit Testnamen `P10a (H7/H8): ...`.
  Der Test parst Tabelle A und Tabelle B aus `docs/OPENAI-TOOL-INVENTORY.md`, in einem festen,
  maschinenlesbaren Zeilenformat, das im Dokument angekuendigt wird. Dann faehrt er K1 bis K6 **am
  echten Draht**:
  - HTTP ueber `startServer` + `mcpPost` + `readToolResult`.
  - OAuth-Tenants nach dem Muster `test/e4-mandantentrennung-default.test.js:40-70`, `:208-235`
    (`startIdp`, `MCP_AUTH=oauth`, `idp.sign({sub})`, `seedState` mit `tenants`/`profiles`).
  - stdio als Kindprozess nach dem Muster `test/openai-p3-security-schemes.test.js:79-100`.
  Zugesichert wird:
  (i) Die Namensmenge je K stimmt exakt mit Tabelle B ueberein.
  (ii) Die Anzahl stimmt ebenfalls.
  (iii) Fuer K1 stimmt `tool.annotations` je Werkzeug exakt mit Tabelle A ueberein, fuer alle vier
  Hints; ein fehlendes `idempotentHint` heisst "-".
  (iv) Tabelle A hat genau 12 Zeilen, und ihre Namensmenge ist gleich K1.
  Das Plan-Profil fuer K4/K5 wird aus `planProfileFor("starter")` (`src/plans.js:154`) importiert
  und nicht abgeschrieben. Sonst ist der Test blind, wenn sich der Plan aendert.
- **Datei:** neu `test/openai-p10a-tool-inventar.test.js`. Die Konstanten `TOOL_COUNT_WITH_CONSULT` und
  `TOOL_COUNT_WITHOUT_CONSULT` (`test/helpers.js:60-61`) koennen zur Gegenpruefung von K1/K2 dienen.
  Neue Zaehl-Konstanten fuer 9 und 11 stehen als benannte Konstanten **in der Testdatei**, nicht in
  `helpers.js`, weil sie nur dort gebraucht werden.
- **IDs:** H7, H8.
- **Pfade:** HTTP legacy, HTTP OAuth und stdio.
- **Beweis:** (b) `NODE_ENV=test node --test test/openai-p10a-tool-inventar.test.js` ist gruen.
  (c) Gegenprobe des Pruefers: in der Doku-Tabelle einen Hint umdrehen, zum Beispiel
  `get_calendar readOnlyHint` auf `false`, oder bei K4 die Zahl auf 12 setzen. Dann wird der Test rot.
  Danach verwerfen. (c) `npx eslint test/openai-p10a-tool-inventar.test.js` meldet 0 Probleme.
  (c) Der Pruefer sieht, dass der Test `tools/list` am Draht liest und nicht das
  `registerTool`-Konfigobjekt: `grep -n "tools/list" test/openai-p10a-tool-inventar.test.js` findet
  mindestens einen Treffer, und `grep -n "registerTool" test/openai-p10a-tool-inventar.test.js` findet
  keinen.

### Schritt 12: Schlussbeweis
- **Was:** Die Gesamtpruefung, keine Aenderung.
- **Datei:** keine.
- **IDs:** alle. Hier wird die harte Grenze "kein Live-Verhalten" belegt.
- **Pfade:** alle.
- **Beweis:**
  (c) `git diff --quiet master -- src/ && echo SRC-UNVERAENDERT` gibt `SRC-UNVERAENDERT` aus.
  (c) Syntaxbaum-Vergleich mit acorn (`node_modules/acorn` 8.17.0), ohne Positionen, fuer jede Datei
  in `git ls-files 'src/**/*.js'`:
  `acorn.parse(src, {ecmaVersion:"latest", sourceType:"module", allowHashBang:true})`, danach
  `start`/`end` rekursiv entfernen und `JSON.stringify` von master (`git show master:<pfad>`) gegen den
  Branch vergleichen. Erwartete Ausgabe: `0 Abweichungen in N Dateien`, und N ist gleich
  `git ls-files 'src/**/*.js' | wc -l`.
  (c) `git diff --name-only master` enthaelt nur `test/*.test.js`, `eslint-suppressions.json`,
  `docs/OPENAI-AUTH-ABWEICHUNGEN.md`, `docs/OPENAI-TOOL-INVENTORY.md` und `PLAN-SECURITY.md`. **Keine**
  Aenderung an `render.yaml`, `.env.example`, `test/helpers.js` oder `eslint-legacy-exceptions.json`.
  (c) `git diff master -- eslint-suppressions.json | grep -E "^\+"` zeigt keine erhoehte Zahl und keinen
  neuen Schluessel. Es gibt nur Entfernungen.
  (b) `npm test -- -- --test-concurrency=4 > "$SCRATCH/p10a-suite.log" 2>&1`: `# fail 0`, und
  `# pass` ist 6229 plus die Zahl der neuen Faelle aus Schritt 5, 6 und 11. Jeder rote Fall ist
  isoliert erneut gefahren und gruen, mit Log.
  (c) `npm run lint` ist sauber.
  (b) `test/openai-p8-widget-ui.test.js` ist gruen. Seine Byte-Hashes fuer `tools/list` und
  `resources/*` ueber HTTP und stdio (`:41-44`) belegen, dass der Draht unveraendert ist.

## 3. Nicht bauen (mit Grund)

- **`tool()`-Stub in Gruppe C** (`mcp-tools-language`, `al-p11-result-card`, `mcp-ui`): das Entfernen
  verlangt ueber das Aufraeum-Gate entweder ein vollstaendiges Aufraeumen von 26 bis 73 fremden Befunden
  je Datei (ein eigener Umbau) oder einen Legacy-Eintrag, den nur der Owner freigeben darf. Die
  Kommentare werden wahr gemacht (Schritt 4).
- **Kein Legacy-Eintrag, keine Pin-Erhoehung, kein `--no-verify`.**
- **Keine `src/`-Aenderung, auch keine Kommentarzeile.** Keiner der Punkte braucht eine. Ein
  Verweis-Kommentar von `TOOL_ANNOTATIONS` auf das Inventar wuerde ohne Not einen weiteren Beweisschritt
  verlangen.
- **Die Werkzeug-Mengen-Varianz wird nicht technisch aufgeloest** (I-4, DP-5). Das waere Live-Verhalten,
  und die Varianz ist produktgewollt: alle 12 Werkzeuge zu registrieren und die unberechtigten dann mit
  Fehler zu beantworten, verletzt N-13.
- **`render.yaml:431-432` (`CONSULT_ENABLED: "false"`) wird nicht angeglichen.** Die Datei ist
  Infra, die Services sind Dashboard-gepflegt, und ein Blueprint-Resync auf diesen Wert wuerde den
  Consult-Kanal live abschalten. Das ist ein Owner-Punkt und steht im Pre-Mortem.
- **Plan- und P0-Dokumente** (`tasks/PLAN-OPENAI-TECHNIK.md` DP-5/I-4, `tasks/openai-p0-entscheidungen.md`
  Baseline "Produktion heute 10/9") werden nicht korrigiert. Sie sind untrackt und fehlen im
  Worktree. Die Korrektur ist Sache des Leads, siehe Widersprueche.
- **Die Zahl in `CLAUDE.md` (2930 + 114 = 3044)**: nicht Teil der Phase.
- Alles aus P10b: `/healthz`, Security-Header, `security.txt`, Referrer-Policy, `sundartha.com`,
  `POST /mcp` auf dem Parent-Host, `process-guards`, `MCP_AUTH`-Trim, `requiredClaims`, O-27.

## 4. Welche bestehenden Tests sich bewegen

- Schritt 2 und 3: die sieben Dateien behalten ihre Fallzahl. Rot wuerden sie nur, wenn `src/` doch
  noch `server.tool` aufriefe (TypeError). Das waere ein echter Fund.
- Schritt 5: `test/mcp-ui.test.js` bekommt +1 Fall. Die zehn bestehenden Aufrufstellen muessen mit dem
  strengeren Helfer gruen bleiben. Bricht eine, hat ein Werkzeug ein unerwartetes `_meta`. Das ist
  dann ein Fund, der in den Report gehoert, und kein Grund, den Helfer wieder zu lockern.
- Schritt 6 und 11: neue Dateien, neue Faelle.
- Keine bestehende Zusicherung wird geloescht oder abgeschwaecht.

## 5. UNKNOWN

- **UNKNOWN-1:** der Live-Wert von `CONSULT_ENABLED`/`ASSISTANT_CONTEXT_ENABLED`. Er steht nur im
  Dashboard (O-6). Beobachtung der Planungssitzung vom 2026-09-21: der verbundene Live-Connector
  "Hermes" bietet `answer_consult` und `await_call_event` an, dazu den Consult-Instruktionsblock, und
  zusammen 11 Werkzeuge ohne `get_calendar`. Das passt zu einem OAuth-Tenant mit Plan-Profil (K4) und
  beide Schalter an. Ein fremder Pruefer kann das ohne Login nicht nachfahren. Deshalb steht es nur
  im Kommentar (Schritt 7) als datierte Beobachtung und nicht als Produktionsaussage im Inventar.
- **UNKNOWN-2:** ob der typisierte SDK-`Client` `capabilities.extensions` durchlaesst (Schritt 6,
  Fall 3). Die Positivkontrolle entscheidet das am Lauf.
