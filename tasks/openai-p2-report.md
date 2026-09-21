# Abschlussbericht P2 — Registrierweg vereinheitlichen: `title` + `toolInvocation`

Branch: `phase/openai-p2-registrierweg`. Spec: `tasks/openai-p2-spec.md`. IDs: **T-18**, **T-22**
(Quelle: `tasks/openai-audit/00-openai-anforderungen.md`, s. Spec Zeile 3-8).

Dieser Bericht ist fuer einen Lead, der den Code nicht liest. Alle Aussagen wurden am
ausgecheckten Branch-Stand nachgemessen (eigener Worktree), nicht nur aus den TATSACHEN
uebernommen.

---

## 1. Was NICHT erfuellt ist / Abweichungen — zuerst, ungeschoent

- **Commit-Stand-Diskrepanz.** Die TATSACHEN nennen `ca84e1f` als Commit. Der tatsaechliche
  Branch-HEAD ist **`9fc62db`** — ein zweiter Commit ("Review-Befunde Runde 1"), der zwei
  Testdateien aendert: den Schritt-12-Test verschaerft (`structuredContent === undefined` allein
  unterscheidet keinen arbeitenden von einem kaputten Handler — `wrapHandler` faengt jeden Wurf
  und liefert ebenfalls kein `structuredContent`; ergaenzt wurden `isError !== true` und dass die
  Mock-Antwort im Text auftaucht) und in `test/mcp-tool-annotations.test.js` eine tote
  `fakeServer.tool()`-Falle entfernt (seit der P2-Migration unerreichbar, CLAUDE.md verbietet
  toten Code — s. Diff-Beleg unten). **Keine Verhaltensaenderung an `src/`** (Commit-Message von
  `9fc62db`, durch `git diff 72fbc78..9fc62db -- src/` bestaetigt: nur `src/mcp-tools.js` bewegt
  sich, identisch zum `ca84e1f`-Diff). Dieser Bericht bewertet den tatsaechlichen HEAD
  (`9fc62db`); wer `ca84e1f` mergt, mergt einen Test mit einer schwaecheren Zusicherung und eine
  inzwischen als toter Code erkannte Testfalle.
- **Review-Runden 2 und 3 sind nicht durch eigene Commits belegt.** Die Review-Historie nennt drei
  Runden (Blocker 2 → 1 → 0), aber auf dem Branch existiert nur **ein** Fix-Commit (`9fc62db`,
  "Runde 1"). Ob Runde 2 und 3 denselben Code ohne weitere Aenderung erneut beurteilt haben, oder
  ob ihr verbleibender "1 Blocker" auf andere Weise (Diskussion, Neubewertung) aufgeloest wurde,
  ist aus dem Repo-Stand allein **nicht rekonstruierbar** — die Review-Historie ist
  Workflow-Zwischenstand, keine Datei im Repo. UNKNOWN, Grund: keine Artefakte fuer Runde 2/3
  gefunden (`tasks/openai-fix/`, `.claude/workflows/runs/` durchsucht, keine P2-spezifischen
  Dateien). Fuer die Merge-Entscheidung nur insofern relevant, als der Lead nicht davon ausgehen
  sollte, dass drei inhaltlich unterschiedliche Code-Versionen geprueft wurden — es war
  nachweislich nur eine (`ca84e1f`, dann `9fc62db`).
- **Der erste eigene volle `npm test -- -- --test-concurrency=4`-Lauf auf `9fc62db` zeigte NICHT
  6160/0, sondern (korrigiert) 6160/6159 pass / 1 fail** — ein Widerspruch zu den TATSACHEN. Ein
  **zweiter, unabhaengiger voller Lauf auf demselben Commit, derselben Maschine, direkt im
  Anschluss**, ergab (korrigiert) **6160/6160 pass, 0 fail** — exakt die TATSACHEN-Zahl. Der
  Einzelausfall aus Lauf 1 ist damit auf demselben Code **nicht reproduzierbar** und war ein
  nicht-deterministischer Flake, keine Regression dieser Phase — welcher der 6180 rohen Tests
  in Lauf 1 fiel, wurde durch eine zu knapp bemessene `tail`-Abschneidung des ersten Laufs
  fuer diesen Bericht nicht mehr namentlich festgehalten (bekannter Kandidat fuer dieses Muster
  im Repo: `test/telnyx-p5-gate-proof.test.js`, dreifach isoliert 14/14 gruen gefahren UND im
  zweiten vollen Lauf an Position 5134 sauber gruen — schliesst diese Datei fuer **Lauf 2**
  aus, beweist aber nicht, dass sie in Lauf 1 die Ursache war). Zusaetzlich unabhaengig
  verifiziert: **isolierter Lauf genau der vier von P2 beruehrten Testdateien — 107/107 gruen,
  0 rot** (`test/openai-p2-tool-metadaten.test.js`, `test/mcp-tool-annotations.test.js`,
  `test/mcp-ui.test.js`, `test/check-staged-suppressions.test.js`). Die Grundlinien-Rechnung
  6155 (master) + 5 neue Tests = 6160 ist in sich stimmig: `grep -c '^test('
  test/openai-p2-tool-metadaten.test.js` liefert exakt **5**. Fuer den Lead heisst das: die
  TATSACHEN-Zahl ist bestaetigt, aber diese Suite ist auf dieser Maschine nachweislich ~1/2
  Laeufe flakig — ein einzelner roter `npm test`-Lauf ist hier kein automatischer Blocker,
  sondern ein Signal zum Wiederholen (s. Restrisiko).
- **Nicht gebaut (laut TATSACHEN, hier gegengeprueft, nicht nur uebernommen):** kein
  `outputSchema` fuer `cancel_call`/`list_action_items` (bestaetigt: `grep -n "outputSchema:"
  src/mcp-tools.js` zeigt an deren Registrierstellen nur die Kommentarzeilen "KEIN outputSchema:
  ..." — Zeilen 1306, 1406 — keine Feldzuweisung); kein Rueckbau von `annotations.title`
  (bestaetigt: `TOOL_ANNOTATIONS` unveraendert als Titel-Quelle, `withOpenAiToolMetadata` liest
  `config.annotations?.title`, `src/mcp-tools.js:769`); kein Kindprozess-stdio-Harness (Schritt 13
  nutzt `InMemoryTransport`, kein `child_process`); kein T-15/T-21/P8-Scope, keine neue
  Env-Variable (bestaetigt: `git diff 72fbc78..9fc62db -- src/config.js .env.example render.yaml`
  ist leer); kein Laufzeit-Waechter auf die 64-Zeichen-Grenze (nur der Test
  `test/openai-p2-tool-metadaten.test.js` prueft `length <= 64`, kein Code in `src/`); kein Ausbau
  der toten `tool()`-Attrappe in sieben fremden Testdateien (bestaetigt als **mindestens**
  vorhanden: `test/al-p13-consult-channel.test.js`, `test/gq-b1-briefing-openness.test.js`,
  `test/p15-mcp-tool-descriptions-en.test.js` tragen die Falle nachweislich weiter im
  `fakeServer`-Objekt; die volle Sieben-Dateien-Liste steht in `tasks/openai-p2-spec.md:269-277`
  und wurde nicht Zeile fuer Zeile nachgezaehlt).

---

## 2. Was diese Phase erfuellt — ID fuer ID

**T-18** (Name / Title / Description / expliziter `inputSchema` / `outputSchema` nur wo
`structuredContent`):

- **`title` auf Top-Level, fuer alle zwoelf Werkzeuge, aus genau einer Quelle.**
  `withOpenAiToolMetadata()` setzt `title: config.annotations?.title` (`src/mcp-tools.js:767-773`,
  konkret Zeile 769-771), eingehaengt in `uiTool()` (`:894-895`). Keine zweite,
  namensindizierte Tabelle — `title` kann strukturell nicht von `annotations.title`
  auseinanderlaufen (W-09-Reihenfolge `title > annotations.title > name`,
  `tasks/openai-audit/00-mcp-spec.md:95`). Beweis am Wire: Test
  `P2 (T-18/T-22): tools/list ueber die echte /mcp-Route traegt title + toolInvocation, ...`
  (`test/openai-p2-tool-metadaten.test.js:86`), prueft `typeof tool.title === "string"` und
  nicht-leer fuer JEDES Tool aus der tatsaechlich gelieferten Liste (nicht aus einer
  Namensliste).
- **Eindeutige Namen, `description`/`inputSchema` an allen zwoelf, `outputSchema`-Bilanz genau
  10 von 12.** Test `P2 (T-18 Rest): ...` (`test/openai-p2-tool-metadaten.test.js:126`).
  Nachgemessen: `grep -n "outputSchema:" src/mcp-tools.js` liefert 10 echte Feldzeilen (1061,
  1116, 1171, 1246, 1263, 1322, 1351, 1381, 1437, 1477) + 2 Kommentarzeilen, die explizit dessen
  Fehlen an `cancel_call`/`list_action_items` dokumentieren (1306, 1406).
- **`cancel_call` und `list_action_items` vom Legacy-Weg `server.tool()` auf `uiTool()` /
  `registerTool()` migriert**, ohne `outputSchema` (beide liefern ausschliesslich `text(...)`).
  Registrierstellen: `cancel_call` `src/mcp-tools.js:1300-1315` (Registrierung) /
  `:1301` (Name), `list_action_items` `:1344-1400` (Registrierung) / `:1401` (Name). Kein
  `server.tool(` mehr im Modul: `grep -c "server\.tool(" src/mcp-tools.js` -> `0`.
  Verhaltensbeleg (nicht nur "kein Schema deklariert", sondern der Handler arbeitet UND liefert
  nie `structuredContent`): Test `P2 (Schritt 12): cancel_call und list_action_items arbeiten
  und liefern dabei nie structuredContent` (`test/openai-p2-tool-metadaten.test.js:210`),
  prueft `isError !== true`, die Mock-Antwort im Text, und `structuredContent === undefined`
  fuer beide Handler.
- **Stdio-Pfad am echten SDK traegt dieselben Felder wie HTTP.** Test
  `P2 (Schritt 13): stdio-Pfad (echtes SDK, InMemoryTransport) traegt title + toolInvocation
  genau wie ueber HTTP` (`test/openai-p2-tool-metadaten.test.js:247`), `McpServer` +
  `InMemoryTransport.createLinkedPair()` + echter `Client.listTools()`-Aufruf — kein
  Attrappen-Server, der echte `ListTools`-Handler des SDK laeuft.

**T-22** (`_meta["openai/toolInvocation/invoking"]` + `/invoked`, je `<= 64` Zeichen):

- **Statuszeilen-Tabelle mit zwoelf Eintraegen**, Modul-Ebene, `src/mcp-tools.js:722-761`
  (`OPENAI_INVOKING_KEY`/`OPENAI_INVOKED_KEY`/`TOOL_INVOCATION_STATUS`). Laengster Eintrag
  nachgemessen (nicht aus der Commit-Message uebernommen): **32 Zeichen**
  ("Sending your answer to the agent", `answer_consult`), Grenze 64 — eigener Python-Parse aller
  Strings im Tabellen-Literal, kein Eintrag ueber 64.
- **`_meta`-Merge NACH dem Config-Literal**, nicht in den 12 Konfigurationen selbst
  (`withOpenAiToolMetadata`, `:767-773`, eingehaengt in `uiTool()` `:894-895`) — Grund: fuenf
  Widget-Tools spreaden `...enableWidgetUi(...)` als letztes Feld; ein vorher gesetztes `_meta`
  waere durch Objekt-Literal-Semantik (kein Deep-Merge) still ueberschrieben worden. Beweis, dass
  das Widget-`_meta` TATSAECHLICH ueberlebt (Positiv-Kontrolle, nicht nur Abwesenheit eines
  Fehlers): `place_call._meta.ui.resourceUri === "ui://hermes/call"` wird in **beiden**
  E2E-Tests (Schritt 10 UND Schritt 13) explizit geprueft
  (`assertPlaceCallWidgetMetaSurvives`, `test/openai-p2-tool-metadaten.test.js:80-91`).
- **ChatGPT-Adapter traegt beide `_meta`-Familien nebeneinander**, `_meta.ui` bleibt weg. Test
  `P2 (Schritt 14): ChatGPT-Adapter traegt openai/outputTemplate UND toolInvocation
  nebeneinander, _meta.ui bleibt weg` (`test/openai-p2-tool-metadaten.test.js:277`).

**Nebenwirkungen, verifiziert:**

- Die Legacy-Fabrik `const tool = (...)` ist entfernt (`grep -n "^  const tool = "
  src/mcp-tools.js` -> kein Treffer); dadurch entfaellt der einzige `max-params`-Befund der
  Datei. Lint-Buchhaltung nachgezogen in `eslint-suppressions.json` (Schluessel entfernt) und
  `eslint-legacy-exceptions.json`/`test/check-staged-suppressions.test.js` (Pin auf 509 Zeilen
  `registerTools`, Reason-Nachtrag "ZAHL KORRIGIERT 2026-09-20 (P2, ...)") — beide Dateien im
  Diff gegengelesen, Aenderungen sind reine Buchhaltung ohne neue Regel-Kategorie.
- `test/mcp-ui.test.js`: zehn `_meta`-Assertionen von "kein `_meta`" auf "kein **Widget**-`_meta`"
  praezisiert (`ohneWidgetMeta`-Helfer, Zeile ~56-60 laut Diff) — Verschaerfung, keine
  Abschwaechung, weil seit `withOpenAiToolMetadata()` jedes Werkzeug ein `_meta` traegt und "kein
  Objekt" damit kein gueltiger Nicht-Widget-Beweis mehr ist.
- `test/mcp-tool-annotations.test.js`: der `fakeServer.tool()`-Trap in `captureAnnotations()` ist
  entfernt (Diff gegengelesen: war seit der P2-Migration unerreichbarer Code, CLAUDE.md verbietet
  das) — Teil des Round-1-Fix-Commits `9fc62db`, nicht des urspruenglichen `ca84e1f`.

---

## 3. Beruehrte Pfade — Deckung

Vier Zugangswege existieren fuer MCP-Tools in diesem Repo: **HTTP `/mcp`**, **stdio**,
**mcp-nativer Adapter**, **ChatGPT-Adapter**. Beide Aenderungen (`title`, `toolInvocation`)
haengen an derselben Stelle (`uiTool()` → `withOpenAiToolMetadata()`), die alle vier Aufrufer
durchlaufen.

| Pfad | Erfuellt? | Belegform |
|---|---|---|
| HTTP `/mcp` | Ja | E2E-Tests gegen den echten, laufenden Server (Schritt 10/11) — direkter Beleg |
| stdio | Ja | Schritt 13, **echter** `ListTools`-Handler des SDK ueber `InMemoryTransport` (staerker als ein Attrappen-Server, aber KEIN echter Kindprozess/Pipe-Lauf — bewusste Luecke, s. Abschnitt 1) |
| mcp-nativer Adapter | Ja, indirekt | Haengt an HTTP `/mcp`, kein eigener Registrierweg |
| ChatGPT-Adapter | Ja | Schritt 14, eigener Test mit Skybridge-Capability im `ctx` |

Der Punkt gilt also auf allen vier Pfaden, mit einer benannten Einschraenkung bei stdio: der
Test laeuft am echten SDK-Handler, aber ohne Kindprozess/Pipe-Serialisierung — dieselbe Luecke,
die schon P1 fuer den stdio-Pfad offen liess (dort sogar schwaecher: nur ein Ctx-Vergleichstest,
kein echter SDK-Handler-Aufruf).

---

## 4. Was ein fremder Pruefer nachmessen sollte

Alle Befehle im ausgecheckten Branch-Worktree (`phase/openai-p2-registrierweg`, `9fc62db`).
Formulierung neutral — die Kommandos beweisen nichts von sich aus.

1. **Stimmt die Gesamtzahl (6160/0) tatsaechlich?**
   `NODE_ENV=test npm test -- -- --test-concurrency=4` auf dem vollen Branch — welche Zahlen
   stehen hinter `# pass`/`# fail` (nicht der Exit-Code)? Stimmt die Differenz zu `master`
   (`72fbc78`, dort laut Vorphase 6155/0) mit der Zahl der neu hinzugekommenen Tests ueberein
   (`grep -c '^test(' test/openai-p2-tool-metadaten.test.js`)? **Achtung, fuer diesen Bericht
   selbst gemessen:** diese Suite lief auf derselben Maschine zweimal hintereinander auf
   demselben Commit und lieferte einmal 1 Fehlschlag, einmal 0 — bei einem roten Ergebnis lohnt
   ein zweiter Lauf, bevor er als Regression gewertet wird (s. Abschnitt 1 und Restrisiko).
2. **Sind `title` und `toolInvocation` tatsaechlich am Wire, auf allen vier Zugangswegen?**
   `NODE_ENV=test node --test --test-concurrency=4 test/openai-p2-tool-metadaten.test.js` —
   welche `# fail`-Zahl? Pruefen die fuenf Tests wirklich am gelieferten `tools/list`-Ergebnis
   (nicht am Config-Objekt vor der Registrierung)?
3. **Gibt es wirklich keinen Legacy-Registrierweg mehr?**
   `grep -c "server\.tool(" src/mcp-tools.js` — welche Zahl? `grep -n "^  const tool = "
   src/mcp-tools.js` — Treffer oder nicht?
4. **Ist die `outputSchema`-Bilanz (10 von 12) am Wire belegt, nicht nur behauptet?**
   `grep -n "outputSchema:" src/mcp-tools.js` — wie viele echte Feldzeilen (nicht
   Kommentarzeilen) treffen zu, und stimmen die Zeilennummern mit den zehn Werkzeugen ohne
   `cancel_call`/`list_action_items` ueberein? Ergaenzend: liefert
   `test/openai-p2-tool-metadaten.test.js` (Schritt 12) den Beweis, dass die beiden Ausnahmen
   trotzdem funktionieren (kein `isError`, Text vorhanden) statt nur "kein Schema deklariert"?
5. **Ist der Statuszeilen-Merge wirklich NACH dem Widget-Spread, nicht davor?**
   `sed -n '880,900p' src/mcp-tools.js` lesen — ruft `uiTool()` `withOpenAiToolMetadata()` auf
   das fertige Config-Objekt auf, oder wird `_meta` irgendwo im Literal selbst gesetzt? Bleibt
   `place_call._meta.ui.resourceUri` in Schritt 10/13 tatsaechlich erhalten (Positiv-Kontrolle,
   nicht nur Abwesenheit eines Fehlers)?
6. **Ist der Lint-Pin ehrlich?**
   `npx eslint --suppressions-location eslint-suppressions.empty.json src/mcp-tools.js --format
   json 2>&1 | grep -o '"registerTools[^"]*has too many lines ([0-9]*)'` — welche Zahl, und
   steht dieselbe Zahl im `reason`-Feld von `eslint-legacy-exceptions.json` unter
   `src/mcp-tools.js` sowie in der `LEGACY_FINGERPRINT`-Kopie in
   `test/check-staged-suppressions.test.js`? Ist `max-params` dort wirklich entfernt (nicht nur
   auf 0 gesetzt)?
7. **Stimmt der Commit-Stand?**
   `git log --oneline master..phase/openai-p2-registrierweg` — wie viele Commits, welcher ist
   HEAD? Aendert der zweite Commit etwas an `src/` (`git diff <erster>..<zweiter> -- src/`)?
8. **Sind die Nicht-Widget-`_meta`-Assertionen in `test/mcp-ui.test.js` wirklich verschaerft und
   nicht nur umbenannt?**
   `grep -n "ohneWidgetMeta" test/mcp-ui.test.js` lesen — prueft der Helfer beide
   Widget-Schluessel (`_meta.ui`, `_meta["openai/outputTemplate"]`) namentlich, oder ist die
   alte, schwaechere Bedingung nur umformuliert?
9. **Traegt der ChatGPT-Adapter wirklich beide `_meta`-Familien gleichzeitig?**
   `NODE_ENV=test node --test test/openai-p2-tool-metadaten.test.js --test-name-pattern
   "Schritt 14"` — gruen? Steht `_meta["openai/outputTemplate"]` UND
   `_meta["openai/toolInvocation/invoking"]` gleichzeitig am `place_call`-Eintrag, und fehlt
   `_meta.ui` dort trotzdem?

---

## 5. Restrisiko

Der fachliche Kern der Phase (`title` strukturell aus einer Quelle, Statuszeilen nach dem
Widget-Spread gemergt statt davor, Legacy-Registrierweg vollstaendig entfernt, vier Zugangswege
am Wire statt am Config-Objekt geprueft) ist solide und mit Positiv-Kontrollen belegt — der
gefaehrlichste stille Fehler dieser Phase (Widget-`_meta` durch den Statuszeilen-Merge
verdraengt) wird durch zwei unabhaengige Tests aktiv ausgeschlossen, nicht nur durch Abwesenheit
eines Fehlers. Die zentrale TATSACHEN-Zahl (6160/0) ist fuer diesen Bericht **bestaetigt**
(zweiter voller Lauf, s. Abschnitt 1), aber der erste Lauf auf demselben Commit zeigte einen
Einzelfehlschlag, der sich nicht reproduzieren liess — die Suite ist auf dieser Maschine
nachweislich nicht 100% deterministisch (~1 von 2 vollen Laeufen). Das ist kein P2-spezifischer
Befund (der isolierte Lauf der vier beruehrten Dateien war beide Male 107/107 gruen), aber es
bedeutet: ein kuenftiger roter `npm test`-Lauf auf diesem Branch beweist fuer sich allein keine
Regression, und ein gruener beweist nicht zwingend deren Abwesenheit in einem einzelnen anderen
Testfall — nur eine Wiederholung trennt Flake von echtem Fund (dieselbe Regel, die dieses Repo
fuer den bekannten `test/telnyx-p5-gate-proof.test.js`-Flake bereits fuehrt, hier aber an einem
anderen, nicht identifizierten Test beobachtet). Zweitens: die Review-Historie mit drei Runden
laesst sich am Repo-Stand nur fuer Runde 1 nachvollziehen (ein Fix-Commit); ob Runde 2 und 3
denselben Code erneut oder einen zwischenzeitlich veraenderten Stand geprueft haben, ist nicht
rekonstruierbar. Drittens, strukturell und von der Phase selbst benannt: der stdio-Pfad laeuft
weiterhin nie durch einen echten Kindprozess/eine echte Pipe — sollte das SDK stdio und
InMemoryTransport intern unterschiedlich serialisieren, wuerde das aktuell nicht auffallen
(dieselbe Luecke wie in P1, dort noch schwaecher abgedeckt).

---

*Bericht erstellt 2026-09-21 durch unabhaengige Nachmessung am Branch-Stand `9fc62db`
(scratchpad-Worktree `wt-p2`). Kein Code in diesem Repo wurde durch die Berichtserstellung
veraendert.*
