# P10a — Abschlussbericht: Randpunkte I: Test-, Kommentar- und Doku-Hygiene (kein Live-Verhalten)

Branch: `phase/openai-p10a-hygiene`. Spec: `tasks/openai-p10a-spec.md`.

**Commit-Hinweis:** der Auftrag nennt Commit `ae7ab7051716c5e57b743064f53ddda3806c4f18`. Der
tatsaechliche Branch-HEAD ist **`f3d33b6c39e57340a4e8928ceb9d1f48dea2cd18`** — einen Commit
weiter:

```
ae7ab70  docs+test(p10a): englisches Werkzeug-Inventar mit Begruendung je Annotation (H7+H8)  <- Auftrag nennt DIESEN
f3d33b6  docs(p10a): Section 6 der englischen Auth-Abweichungen ergaenzt (Runde-1-Befund)      <- tatsaechlicher HEAD
```

Das deckt sich mit der mitgelieferten Review-Historie: Runde 1 hatte 1 Blocker, Runde 2 hatte 0.
`f3d33b6` ist genau der Fix-Commit, der den Runde-1-Blocker beseitigt (er ergaenzt Abschnitt 2c.6
in `docs/OPENAI-AUTH-ABWEICHUNGEN.md` — das "Was aendert sich, wenn ..."-Gegenstueck zum
deutschen Abschnitt 6). Dieser Bericht bewertet **`f3d33b6`**, den echten HEAD, nicht `ae7ab70`.
Nur eine Branch-Kopie existiert (`git branch -a | grep p10a`), kein abgebrochener Parallellauf.

Alle Datei- und Zeilenangaben unten habe ich selbst im per `git worktree` ausgecheckten HEAD
(`f3d33b6`) nachgeschlagen, nicht nur aus dem Auftrag uebernommen.

---

## 1. Was NICHT erfuellt ist — zuerst, nicht versteckt

- **`tool()`-Stub in Gruppe C bleibt** (`test/mcp-tools-language.test.js:39`,
  `test/mcp-ui.test.js:77`, `test/al-p11-result-card.test.js:320` unveraendert). Grund:
  Entfernen wuerde ueber `.githooks/pre-commit` -> `scripts/check-staged-suppressions.js` ein
  vollstaendiges Aufraeumen von 26 (`mcp-tools-language`) bis 74 (`mcp-ui`) fremden,
  ungefilterten Lint-Befunden je Datei verlangen — ein eigener Umbau — oder einen Eintrag in
  `eslint-legacy-exceptions.json`, den laut `WAY_OUT_LINES` (`scripts/check-staged-suppressions.js:280-291`)
  nur der Owner setzen darf, keine Bau-Session. Selbst verifiziert:
  `git diff master..HEAD -- eslint-suppressions.json` zeigt fuer `test/mcp-tools-language.test.js`
  und `test/mcp-ui.test.js` **keine** Aenderung der Eintraege (Zahl der Befunde vorher = nachher),
  waehrend sie fuer die sieben anderen Testdateien (Gruppe A+B) verschwinden oder auf 0 sinken.
  Statt Entfernen wurden nur die unwahren Kopfkommentare wahr gemacht (Schritt 4 der Spec) — die
  Code-Zeilen selbst sind byte-gleich (selbst per `git diff` an den Stub-Zeilen geprueft).
- **Keine Aufloesung der Werkzeug-Mengen-Varianz** (H7/I-4/DP-5): dass ein Reviewer 9, 10, 11 oder
  12 Werkzeuge sieht, ist bewusst dokumentiert (`docs/OPENAI-TOOL-INVENTORY.md`), nicht technisch
  angeglichen. Eine Angleichung (z. B. alle 12 immer registrieren und unberechtigte mit Fehler
  beantworten) waere Live-Verhalten und wuerde N-13 verletzen — ausserhalb der Phasengrenze.
- **`render.yaml:431-432` (`CONSULT_ENABLED: "false"`) bleibt unangeglichen.** Die Datei ist
  Infra, die Live-Werte sind Dashboard-gepflegt; ein Resync auf diesen Wert wuerde den
  Consult-Kanal live abschalten. Owner-Punkt, im Pre-Mortem der Spec benannt.
- **`tasks/PLAN-OPENAI-TECHNIK.md` und `tasks/openai-p0-entscheidungen.md` (Baseline
  "Produktion heute 10/9") wurden nicht korrigiert.** Selbst verifiziert: beide Pfade existieren
  im ausgecheckten Branch-Worktree nicht (`ls tasks/PLAN-OPENAI-TECHNIK.md
  tasks/openai-p0-entscheidungen.md` -> "No such file or directory") — sie sind laut Git-Status
  untrackt und ausserhalb des Worktrees. Zustaendigkeit liegt laut Spec beim Lead.
- **Die Zahl in `CLAUDE.md` (2930 + 114 = 3044) ist unangefasst** — ausdruecklich nicht Teil
  dieser Phase.
- **Alles aus P10b** (`/healthz`, Security-Header, `security.txt`, Referrer-Policy,
  `sundartha.com`, `POST /mcp` auf dem Parent-Host, `src/process-guards.js`, `MCP_AUTH`-Trim,
  `requiredClaims: ['exp']`, O-27-Texte in `place_call`) ist unberuehrt — ausserhalb dieser Phase.
- **Kein Legacy-Eintrag, keine Pin-Erhoehung, kein `--no-verify`.** Selbst verifiziert:
  `git diff master..HEAD -- eslint-legacy-exceptions.json` ist leer, und
  `git diff master..HEAD -- eslint-suppressions.json | grep -E "^\+" | grep -v "^+++"` liefert
  **keine** Ausgabe — es gibt in der ganzen Datei nur Entfernungen, keine neue oder erhoehte Zahl.

Kurz: diese Phase liefert acht Hygiene-Punkte (H1–H8) fuer den Testcode und zwei Doku-Abschnitte
— keine Live-Verhaltensaenderung, keine Aufloesung der strukturellen Varianz, und drei benannte
Dateien bleiben mit dem alten, jetzt korrekt beschrifteten Zustand stehen.

---

## 2. Was diese Phase erfuellt — ID fuer ID mit Beweisstelle

### H1 (P2-Abnahme) — toter `server.tool()`-Stub: entfernt wo moeglich, sonst Kommentar wahr gemacht

**Status: erfuellt**, mit der oben benannten, spec-vorgesehenen Ausnahme (Gruppe C).

- **Gruppe A** (Stub ersatzlos entfernt, 0 fremde Lint-Befunde vorher wie nachher):
  `test/mcp-fehlergrund-rueckweg.test.js:23-28`, `test/openai-s3-hop-frist.test.js:25-27`,
  `test/openai-p5b-geldpfad.test.js:47-55`, `test/place-call-context-bridge.test.js:39-41`.
  Beweis: selbst per `git diff master..HEAD -- <je Datei>` gelesen — die Methode
  `tool(name, ...rest) { handlers.set(...) }` ist in allen vier Dateien weg, durch den Kommentar
  "Einziger Registrierweg ist registerTool ... TypeError" ersetzt. `eslint-suppressions.json`
  verliert dabei genau den Eintrag `test/place-call-context-bridge.test.js` (einzige Gruppe-A-Datei,
  die vorher einen Eintrag trug), sonst nichts — selbst per Diff nachgezaehlt.
- **Gruppe B** (Stub entfernt UND Datei vollstaendig lintbereinigt): `test/mcp-ui-i18n-divergence.test.js`,
  `test/mcp-tools-i18n.test.js`, `test/mcp-tools.test.js`. Beweis: die drei Eintraege
  verschwinden komplett aus `eslint-suppressions.json` (selbst per Diff bestaetigt — vorher
  `id-length`/`max-params`/`no-magic-numbers`/`no-param-reassign`-Eintraege, danach kein Schluessel
  mehr). Die Zusicherungen selbst sind unveraendert: `git diff` zeigt nur Umbenennungen
  (`c`→`item`, `r`→`resolve`, `l`→`line`, `s`→`state`, `t`→`tenant`) und neue benannte
  Konstanten (`HTTP_OK`, `TEN_SECONDS_AGO_MS` etc.) statt Magic Numbers — keine geloeschte oder
  abgeschwaechte `assert`-Zeile, selbst Zeile fuer Zeile im Diff geprueft.
- **Gruppe C** (Stub bleibt, nur Kommentar korrigiert): `test/mcp-tools-language.test.js:39`,
  `test/mcp-ui.test.js:77`. Beweis: `git diff master..HEAD -- test/mcp-ui.test.js` zeigt am Stub
  nur eine Kommentaraenderung ("tool() hat seit OpenAI-P2 keinen Aufrufer mehr in src/ ... Das
  ist ein eigener Umbau"), die Stub-Zeile selbst ist unveraendert. `test/al-p11-result-card.test.js`
  ist laut `git diff master..HEAD` fuer diese Datei komplett leer — nicht angefasst, wie die Spec
  vorschreibt (dort steht kein unwahrer Kommentar).

### H2 (P2-Abnahme) — `ohneWidgetMeta()` wieder streng

**Status: erfuellt.** `test/mcp-ui.test.js`: der Helfer prueft jetzt per `isDeepStrictEqual`
gegen die exakte Schluesselmenge `["openai/toolInvocation/invoking", "openai/toolInvocation/invoked"]`
statt nur "nicht diese zwei Widget-Schluessel". Neuer Kontrollfall am Dateiende
(`test("P10a (H2): ohneWidgetMeta() ist streng ...")`), selbst gelesen: prueft `true` fuer genau
die beiden Statuszeilen-Schluessel und `false` fuer (i) zusaetzlich `ui`, (ii) zusaetzlich
`openai/outputTemplate`, (iii) einen beliebigen dritten Schluessel, (iv) fehlendes `_meta` — damit
kann der strengere Helfer nicht unbemerkt immer `true` liefern. Die zehn bestehenden
Aufrufstellen sind unveraendert (kein Treffer in `git diff` an diesen Zeilen).

### H3 (P4-Abnahme, DP-1) — `capabilities` fehlt bei `uiEnabled:false`, auf beiden Draehten neu gepinnt

**Status: erfuellt**, mit einer Methoden-Abweichung gegenueber der Spec (staerker als verlangt,
siehe unten). Neue Datei `test/openai-p10a-ui-capabilities.test.js` (177 Zeilen), vier Faelle,
selbst gelesen:
- Fall 1 (Einheit): `mcpServerOptions({uiEnabled:false, consultLoop:false|true})` traegt kein
  `capabilities`-Feld; Positivkontrolle `uiEnabled:true` traegt die
  `io.modelcontextprotocol/ui`-Extension.
- Fall 2 (HTTP-Draht): `/mcp initialize` unter `BASE_ENV` (`MCP_UI_ENABLED=false`) liefert keine
  UI-Extension; Positivkontrolle mit `MCP_UI_ENABLED=true`.
- Fall 3 (stdio-Draht): echter Kindprozess `src/mcp-server.js`. Hier weicht die Umsetzung von der
  Spec-Empfehlung ab — die Spec verlangte nur "notfalls roh lesen", falls der typisierte SDK-Client
  das Feld verwirft. Gemessen wurde: er verwirft es tatsaechlich still (`ServerCapabilitiesSchema`
  in `@modelcontextprotocol/sdk` ist ein `z.object(...)` ohne `.passthrough()`). Also wurde
  durchgehend ein roher, selbstgeschriebener NDJSON-stdio-Client gebaut (`rawStdioInitialize`,
  direkte `child.stdin`/`child.stdout`-Pipe, kein `StdioClientTransport`), damit die
  Positivkontrolle ueberhaupt gruen werden kann. Das beantwortet UNKNOWN-2 der Spec definitiv:
  NEIN, der typisierte Client laesst `extensions` nicht durch.
- Fall 4 (billig, optional): derselbe HTTP-Fall mit `CONSULT_ENABLED=true` +
  `ASSISTANT_CONTEXT_ENABLED=true` zeigt, dass `consultLoop` die UI-Capabilities nicht einschaltet.

Gegenprobe laut Commit-Nachricht (`e804f54`) durchgefuehrt: `options.capabilities = {}` ohne `if`
in einer Wegwerfkopie macht alle vier betroffenen Faelle rot, danach verworfen — `src/`
unveraendert (selbst per `git diff --quiet master -- src/` bestaetigt, s. Abschnitt 3).

### H4 (P4-Abnahme) — unwahre Produktionsbehauptung in den P4-Tests richtiggestellt

**Status: erfuellt.** `test/openai-p4-ergebnisstruktur-instructions.test.js:252-256` und
`:337-339` (selbst gelesen): die Behauptung "genau der Zustand, in dem Produktion heute laeuft"
bzw. "Produktions-Normalfall, CONSULT_ENABLED=false" ist ersetzt durch: der Live-Wert ist
Dashboard-gepflegt, `render.yaml` ist nicht massgeblich, und der Live-Connector zeigte am
2026-09-21 die Consult-Werkzeuge und den Consult-Instruktionsblock — der Testfall bleibt relevant
fuer jeden Tenant ohne `allowConsult` (`DEFAULT_PROFILE`, `src/store/defaults.js:1069-1078`), ist
aber kein Produktions-Normalfall mehr. Keine Code- oder Assert-Zeile geaendert (nur
Kommentarzeilen, selbst per Diff geprueft).

### H5 (P7-Abnahme) — englische Fassung von `docs/OPENAI-AUTH-ABWEICHUNGEN.md` wirklich eigenstaendig

**Status: erfuellt.** Neuer Abschnitt `## 2c. English appendix` (selbst gelesen, +142 Zeilen im
Datei-Diff) mit sechs Unterabschnitten (2c.1–2c.6), die die deutschen Abschnitte 3–8 spiegeln:
Sonden-Einschraenkung + "neuere Messung gewinnt" (2c.1), WorkOS-Fragen a–e (2c.2), Owner-Messungen
O-3/O-6 (2c.3), offene Befunde B-1/`exp`/T-8 (2c.4), doppelte Pfade HTTP-vs-stdio (2c.5), und —
das ist der Runde-1-Nachtrag, der den HEAD von `ae7ab70` auf `f3d33b6` treibt — "Was aendert sich,
wenn ..." (2c.6). Alle Verweise in Abschnitt 2b (vorher auf "Section 4/5/7/8") zeigen jetzt auf
2c.x. Kein neuer Status, keine neue Aussage — jede Einschraenkung/jedes UNKNOWN 1:1 uebernommen.

### H6 (P7-Abnahme) — T-14-Status in `PLAN-SECURITY.md` angeglichen

**Status: erfuellt.** `PLAN-SECURITY.md:5068-5072` (selbst gelesen): "T-14 ... gegenstandslos
(P0 D0-6, kein Ausloesepfad), gehoert zu P7" ist ersetzt durch "T-14 ... bewusst nicht erfuellt,
Ersatz durch den Transport-Pfad UNKNOWN; Stand und Begruendung s. Abschnitt OpenAI-P7, Punkt 2
(P0 D0-6 hielt ihn zum Zeitpunkt dieser Phase noch fuer gegenstandslos; P7 hat das revidiert)."
Damit steht an dieser Stelle derselbe aktuelle Status wie bereits an `:5102` (Abschnitt
OpenAI-P7) — kein Widerspruch mehr zwischen den beiden Stellen im selben Dokument.

### H7 (Kickoff I / I-4 / DP-5) + H8 (N-5) — englisches Werkzeug-Inventar mit Begruendung je Annotation, gegen den Draht getestet

**Status: erfuellt.** Zwei neue Dateien, beide selbst gelesen:
- `docs/OPENAI-TOOL-INVENTORY.md` (177 Zeilen): Tabelle A (alle 12 Werkzeuge, Registrierreihenfolge,
  Bedingung, alle vier Hints, ein Begruendungssatz je Annotation-Gruppe mit `datei:zeile`-Beleg),
  Tabelle B (Namensmenge + Anzahl je Konfiguration K1–K6, von 9 bis 12 Werkzeugen), ein Abschnitt
  "What the reviewer will see" (Varianz haengt am Account, kein "production runs with X").
  Maschinenlesbare `TABLE-A-BEGIN/END`- und `TABLE-B-BEGIN/END`-Bloecke fuer den Draht-Test.
- `test/openai-p10a-tool-inventar.test.js` (264 Zeilen, 7 Tests, Namen mit Praefix
  `P10a (H7/H8): ...`): parst beide Tabellen aus der Doku und prueft sie **am echten `tools/list`**
  — HTTP legacy (K1/K2), HTTP OAuth mit drei Profil-Varianten (K3/K4/K5, `planProfileFor("starter")`
  importiert statt abgeschrieben), stdio (K6). Zusichert: Namensmenge exakt, Anzahl exakt, fuer K1
  alle vier Hints je Werkzeug exakt gegen Tabelle A, Tabelle A hat genau 12 Zeilen mit derselben
  Namensmenge wie K1. Kein Test liest das `registerTool`-Konfigobjekt (das wuerde nichts beweisen,
  weil das SDK unbekannte Felder dort still verwirft) — jede Zusicherung geht ueber den echten
  `tools/list`-Draht, selbst per `grep -n "tools/list"` (Treffer) und `grep -n "registerTool"`
  (kein Treffer in Assert-Pfaden) nachvollzogen.

Beleg fuer die Selbstkorrektur aus den "Abweichungen": `src/mcp-tools.js:637-711`
(`TOOL_ANNOTATIONS`) selbst gelesen — `answer_consult` traegt **kein** `idempotentHint`-Feld
(also "-" in Tabelle A), `check_inbox` traegt `idempotentHint: false`. Beide Werte stimmen mit der
jetzigen Fassung von `docs/OPENAI-TOOL-INVENTORY.md` ueberein — der im Auftragstext genannte,
zwischenzeitlich falsche Stand ("-" statt "false" bei beiden) ist nicht mehr im Dokument.

### PLAN-SECURITY.md, H6 ausgenommen keine weitere Aenderung

Nur der eine H6-Absatz ist betroffen (`git diff master..HEAD -- PLAN-SECURITY.md` ist 5 Zeilen
lang, ausschliesslich an dieser Stelle) — reine Ergaenzung/Praezisierung, keine geloeschte
inhaltliche Aussage.

---

## 3. Beruehrte Pfade — vollstaendig?

| Pfad | Beruehrt? | Punkt erfuellt? |
|---|---|---|
| `src/` (jede Datei) | **nein** | vollstaendig unberuehrt — `git diff --quiet master -- src/ && echo SRC-UNVERAENDERT` gibt `SRC-UNVERAENDERT` aus, selbst ausgefuehrt. Das ist die harte Grenze der Phase (Abschnitt 0 der Spec), strenger als gefordert eingehalten. |
| HTTP `/mcp`, legacy Bootstrap-Owner (K1/K2) | ja (nur gemessen, nicht veraendert) | ja — H3 Fall 2, H7/H8 K1/K2, gegen den echten Draht |
| HTTP `/mcp`, OAuth-Tenant (K3/K4/K5) | ja (nur gemessen) | ja — H7/H8 K3-K5, inkl. Plan-Profil aus `src/plans.js` importiert |
| stdio (`src/mcp-server.js`) | ja (nur gemessen) | ja — H3 Fall 3 (roher NDJSON-Client, staerker als Spec-Minimum) UND H7/H8 K6 (typisierter SDK-Client reicht dort, weil nur Namen gebraucht werden, keine `extensions`) |
| `render.yaml`, `.env.example`, `test/helpers.js` (`BASE_ENV`), `eslint-legacy-exceptions.json` | **nein** | ausdruecklich unangetastet, selbst per `git diff master..HEAD -- <die vier Dateien>` bestaetigt (0 Zeilen) — keine neue Env-Variable |
| `eslint-suppressions.json` | ja | nur Entfernungen, keine Erhoehung/kein neuer Schluessel — selbst per `git diff` + `grep -E "^\+"` bestaetigt (leer) |
| Safety-Gates, Offenlegungssatz, Auth-Middleware, Billing, Provider-Adapter | **nein** | ausserhalb des Diffs — `git diff master..HEAD --stat` listet ausschliesslich die 16 Dateien aus dem Auftrag (test/*, eslint-suppressions.json, docs/*, PLAN-SECURITY.md), selbst nachgezaehlt |

Fuer H3 und H7/H8 — die beiden Punkte mit echtem Mehr-Pfad-Anspruch (HTTP und stdio) — ist die
Zusicherung auf **beiden** Draehten durch je einen eigenen, am echten Draht laufenden Test belegt,
nicht nur einseitig. Kein Punkt dieser Phase ist auf einem Pfad erfuellt und auf einem anderen
offen.

---

## 4. Was ein fremder Pruefer nachmessen sollte

Neutral formuliert — jede Zeile beschreibt eine pruefbare Behauptung, nicht deren Bestaetigung.

1. **Steht der zu bewertende Code wirklich auf `f3d33b6`, nicht auf `ae7ab70`?**
   `git log --oneline ae7ab70..phase/openai-p10a-hygiene` (Erwartung laut diesem Bericht: genau
   ein weiterer Commit, "Section 6 der englischen Auth-Abweichungen ergaenzt").
2. **Ist `src/` wirklich byte-identisch zu `master`?** `git diff --quiet master -- src/ && echo
   SRC-UNVERAENDERT` im Worktree.
3. **Sind wirklich genau die 16 im Auftrag genannten Dateien betroffen?**
   `git diff master..phase/openai-p10a-hygiene --stat`.
4. **Bleiben `render.yaml`, `.env.example`, `test/helpers.js` und
   `eslint-legacy-exceptions.json` wirklich unangetastet?**
   `git diff master..phase/openai-p10a-hygiene -- render.yaml .env.example test/helpers.js eslint-legacy-exceptions.json`
   — leer?
5. **Enthaelt `eslint-suppressions.json` wirklich nur Entfernungen, keine neue oder erhoehte
   Zahl?** `git diff master..phase/openai-p10a-hygiene -- eslint-suppressions.json | grep -E "^\+" | grep -v "^+++"`
   — leer?
6. **Ist der `tool()`-Stub in Gruppe A/B wirklich weg, in Gruppe C wirklich noch da?**
   `grep -nE "^\s+tool\(" test/mcp-fehlergrund-rueckweg.test.js test/openai-s3-hop-frist.test.js test/openai-p5b-geldpfad.test.js test/place-call-context-bridge.test.js test/mcp-ui-i18n-divergence.test.js test/mcp-tools-i18n.test.js test/mcp-tools.test.js`
   (Erwartung: keine Ausgabe) gegen
   `grep -n "tool(name" test/mcp-tools-language.test.js test/mcp-ui.test.js test/al-p11-result-card.test.js`
   (Erwartung: drei Treffer).
7. **Sind die sieben Gruppe-A/B-Dateien wirklich lintsauber und fallzahlgleich zu `master`?**
   `npx eslint --suppressions-location eslint-suppressions.empty.json test/mcp-fehlergrund-rueckweg.test.js test/openai-s3-hop-frist.test.js test/openai-p5b-geldpfad.test.js test/place-call-context-bridge.test.js test/mcp-ui-i18n-divergence.test.js test/mcp-tools-i18n.test.js test/mcp-tools.test.js`
   und `NODE_ENV=test node --test <dieselben Dateien>` gegen denselben Lauf auf `master`.
8. **Ist `ohneWidgetMeta()` in `test/mcp-ui.test.js` wirklich streng, und faengt der neue
   Kontrollfall eine Abschwaechung?** `NODE_ENV=test node --test test/mcp-ui.test.js`, danach in
   einer Wegwerfkopie `withOpenAiToolMetadata()` in `src/mcp-tools.js` einen dritten
   `_meta`-Schluessel anhaengen lassen und pruefen, ob `test/mcp-ui.test.js` dabei rot wird.
9. **Traegt `mcpServerOptions({uiEnabled:false, ...})` wirklich kein `capabilities`-Feld, auf
   HTTP und stdio?** `NODE_ENV=test node --test test/openai-p10a-ui-capabilities.test.js`, danach
   in einer Wegwerfkopie `src/mcp-server-info.js` die `if`-Bedingung entfernen und pruefen, ob
   Fall 1/2/3 rot werden.
10. **Verwirft der typisierte SDK-`Client` `capabilities.extensions` wirklich still?**
    `sed -n '1,100p' test/openai-p10a-ui-capabilities.test.js` lesen — nutzt Fall 3 tatsaechlich
    einen rohen `child.stdin`/`child.stdout`-NDJSON-Client statt `StdioClientTransport`?
11. **Stimmt `docs/OPENAI-TOOL-INVENTORY.md` wirklich mit `src/mcp-tools.js:637-711`
    (`TOOL_ANNOTATIONS`) und dem echten `tools/list` ueberein, fuer alle sechs Konfigurationen
    K1-K6?** `NODE_ENV=test node --test test/openai-p10a-tool-inventar.test.js`, danach in der
    Doku-Tabelle probeweise einen Hint umdrehen (z. B. `get_calendar readOnlyHint` auf `false`)
    oder eine K-Zahl aendern und pruefen, ob der Test rot wird.
12. **Ist Abschnitt 2c von `docs/OPENAI-AUTH-ABWEICHUNGEN.md` wirklich vollstaendig, ohne
    verwaiste Verweise auf die alten Abschnittsnummern?**
    `awk '/^## 2b\./,/^## 3\./' docs/OPENAI-AUTH-ABWEICHUNGEN.md | grep -nE "Section [4-9]"`
    (Erwartung: keine Ausgabe) und `docs/OPENAI-AUTH-ABWEICHUNGEN.md` Abschnitt 2c gegen die
    deutschen Abschnitte 3-8 gegenlesen.
13. **Steht der T-14-Status in `PLAN-SECURITY.md` wirklich nicht mehr im Widerspruch zwischen
    `:5068-5075` und `:5102`?** Beide Stellen lesen.
14. **Laeuft die volle Testsuite wirklich fallzahlgleich zur genannten Zahl, ohne roten Fall?**
    `npm test -- -- --test-concurrency=4` im Worktree neu fahren, nur `# pass`/`# fail` zaehlen.
15. **Ist `npm run lint` wirklich fehlerfrei (0 Fehler, Warnungen erlaubt)?** `npm run lint` im
    Worktree.
16. **Gibt es wirklich keinen dokumentierten Legacy-Eintrag und keine Pin-Erhoehung?**
    `git diff master..phase/openai-p10a-hygiene -- eslint-legacy-exceptions.json` (leer) und
    `git log --oneline master..phase/openai-p10a-hygiene` auf `--no-verify`-Hinweise in den
    Commit-Nachrichten durchsehen.

---

## 5. Restrisiko

Das Risiko fuer laufenden Produktionsverkehr ist praktisch null: `src/` ist byte-identisch zu
`master` (selbst per `git diff --quiet` bestaetigt, keine Ausnahme wie bei frueheren Phasen), der
Diff besteht ausschliesslich aus Testdateien, einer generierten Lint-Buchhaltungsdatei
(nur Entfernungen) und zwei Doku-Dateien — keine Route, kein Gate, kein Prompt-Baustein ist
beruehrt. Das Restrisiko liegt an drei anderen Stellen. **Erstens, strukturell:** der
`tool()`-Stub bleibt in drei Dateien technisch tot, aber lebendig im Code — sein einziger Schutz
gegen Verrotten ist der jetzt korrigierte Kommentar; ein kuenftiger Wartender, der das Aufraeum-Gate
nicht kennt, koennte versucht sein, ihn "schnell mal" zu entfernen und damit unbeabsichtigt in
einen 26-74-Befunde-Umbau laufen, den diese Phase bewusst nicht angefasst hat. **Zweitens,
inhaltlich:** die Werkzeug-Mengen-Varianz (9-12 Werkzeuge je nach Konfiguration) ist jetzt zwar
dokumentiert und gegen den Draht getestet, aber nicht aufgeloest — ein OpenAI-Reviewer, der mit
einem Demo-Account eine andere Zahl sieht als ein zahlender Account, koennte das als Inkonsistenz
lesen, wenn er `docs/OPENAI-TOOL-INVENTORY.md` nicht kennt; das Dokument existiert jetzt genau
dafuer, aber es setzt voraus, dass der Reviewer es findet und liest. **Drittens, methodisch:** die Testzahl ist nicht nur aus der Zulieferung uebernommen, sondern
selbst im Worktree neu gefahren (`npm test -- -- --test-concurrency=4`, volle Laufzeit ca. 416 s)
und roh nachgezaehlt: `# tests 6243`, `# pass 6243`, `# fail 0`, `# cancelled 0`, `# skipped 0` —
deckungsgleich mit der gemeldeten Zahl. Die `testbaenke-run`-eigene Korrektur ("20 Datei-Wrapper
ohne echten Test abgezogen") liefert zusaetzlich `tests 6223 / pass 6223 / fail 0`; das ist eine
Buchhaltungs-Normalisierung desselben Laufs, kein zweiter, abweichender Befund. `npm run lint`
lief ebenfalls selbst im Worktree: 0 Fehler, 69 Warnungen (unveraendert zu vorbestehenden,
nicht von dieser Phase beruehrten Dateien).

---

## Testzahlen (selbst nachgemessen)

- Voller Testlauf, exakt das im Auftrag vorgeschriebene Kommando (`npm test -- --
  --test-concurrency=4`), selbst im Worktree (`f3d33b6`) gestartet und bis zum Ende durchgelaufen
  (ca. 416 s): **`# tests 6243`, `# suites 80`, `# pass 6243`, `# fail 0`, `# cancelled 0`,
  `# skipped 0`, `# todo 0`**, danach die `testbaenke-run`-eigene Korrektur ("20 Datei-Wrapper
  ohne echten Test abgezogen"): `tests 6223 / pass 6223 / fail 0`. Deckungsgleich mit der
  gemeldeten Zahl (6243 gruen / 0 rot).
- `npm run lint` selbst im Worktree: **0 Fehler**, 69 Warnungen (`no-unused-vars`,
  `no-regex-spaces` in vorbestehenden, von dieser Phase nicht beruehrten Testdateien).
- `git diff --quiet master -- src/ && echo SRC-UNVERAENDERT`: gibt `SRC-UNVERAENDERT` aus.
- `git diff master..HEAD -- eslint-suppressions.json | grep -E "^\+" | grep -v "^+++"`: leer
  (nur Entfernungen).
- `git diff master..HEAD -- render.yaml .env.example test/helpers.js
  eslint-legacy-exceptions.json`: leer (0 Zeilen).
- `git diff master..HEAD --stat`: genau die 16 im Auftrag genannten Dateien, keine weitere.
- `git status --short` im Branch-Worktree: sauber, keine unversionierten Reste.
